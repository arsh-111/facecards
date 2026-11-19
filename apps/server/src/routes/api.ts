import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  ageBand,
  ageFromDob,
  CreateRoomSchema,
  DEFAULT_BOUNDARIES,
  DEFAULT_SETTINGS,
  isAdult,
  JoinRoomSchema,
  ProfilePatchSchema,
  RegisterSchema,
  RoomCodeSchema,
  type MeResponse,
} from '@nc/shared';
import type { AppDeps } from '../app';
import { sessions } from '../db/schema';
import { BUCKETS, hit } from '../rateLimit';
import { createSession, deleteSession, toProfile, type SessionRow } from '../sessions';
import {
  clearSessionCookie,
  clientKey,
  cookieNames,
  HttpError,
  requireVerifiedSession,
  setBlockCookie,
  setSessionCookie,
} from '../http';
import { EngineError } from '../rooms/engine';

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'INVALID_INPUT');
  return r.data;
}

function engineToHttp(e: unknown): never {
  if (e instanceof EngineError) {
    const status =
      e.code === 'NOT_FOUND' ? 404 : e.code === 'ROOM_FULL' || e.code === 'IN_PROGRESS' ? 409 : e.code === 'KICKED' ? 403 : 400;
    throw new HttpError(status, e.code);
  }
  throw e;
}

export async function apiRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, cfg, rooms, cards, metrics } = deps;

  const meResponse = async (s: SessionRow): Promise<MeResponse> => {
    const profile = toProfile(s);
    return {
      profile,
      currentRoom: await rooms.currentRoomCode(s.id),
      neverCards: profile.boundaries.neverCardIds.flatMap((id) => {
        const c = cards.byId.get(id);
        return c ? [{ id, title: c.title }] : [];
      }),
      expiresAt: s.expiresAt.toISOString(),
    };
  };

  /** End a session completely: leave rooms, delete rows, clear cookie. */
  const wipe = async (s: SessionRow, reply: Parameters<typeof clearSessionCookie>[0]) => {
    await rooms.purgeSession(s.id);
    await deleteSession(db, s.id);
    deps.realtime?.disconnectSession(s.id);
    clearSessionCookie(reply, cfg);
  };

  app.post('/api/register', async (req, reply) => {
    const key = clientKey(req, reply, cfg);
    if (req.cookies[cookieNames(cfg).block]) throw new HttpError(403, 'AGE_BLOCKED');
    if (!(await hit(db, key, BUCKETS.register))) throw new HttpError(429, 'RATE_LIMITED');
    const body = parse(RegisterSchema, req.body);
    const age = body.age ?? (body.dob ? ageFromDob(body.dob) : null);
    if (age === null) throw new HttpError(400, 'INVALID_INPUT');
    if (!isAdult(age)) {
      // FR-2: nothing stored except the hashed rate-limit counter.
      await hit(db, key, BUCKETS.blocked);
      setBlockCookie(reply, cfg);
      throw new HttpError(403, 'AGE_BLOCKED');
    }
    if (req.session) await wipe(req.session, reply);
    const { token, row } = await createSession(
      db,
      {
        ageBand: ageBand(age),
        gender: body.gender,
        preference: body.preference,
        genres: [...new Set(body.genres)],
        displayName: body.displayName ?? null,
      },
      cfg,
    );
    setSessionCookie(reply, cfg, token);
    void metrics.inc('sessions_created');
    reply.code(201);
    return meResponse(row);
  });

  app.get('/api/me', async (req) => meResponse(requireVerifiedSession(req)));

  app.patch('/api/me', async (req, reply) => {
    const s = requireVerifiedSession(req);
    const patch = parse(ProfilePatchSchema, req.body);
    if (patch.age !== undefined && !isAdult(patch.age)) {
      // FR-3: editing age below 18 ends the session.
      await wipe(s, reply);
      setBlockCookie(reply, cfg);
      throw new HttpError(403, 'AGE_BLOCKED');
    }
    const update: Partial<typeof sessions.$inferInsert> = {};
    if (patch.age !== undefined) update.ageBand = ageBand(patch.age);
    if (patch.gender) update.gender = patch.gender;
    if (patch.preference) update.preference = patch.preference;
    if (patch.genres) update.genres = [...new Set(patch.genres)];
    if (patch.displayName !== undefined) update.displayName = patch.displayName;
    if (patch.settings) update.settings = { ...DEFAULT_SETTINGS, ...s.settings, ...patch.settings };
    if (patch.boundaries) {
      update.boundaries = { ...DEFAULT_BOUNDARIES, ...s.boundaries, ...patch.boundaries };
    }
    const [row] = await db.update(sessions).set(update).where(eq(sessions.id, s.id)).returning();
    if (!row) throw new HttpError(401, 'NO_SESSION');
    await rooms.profileChanged(row);
    return meResponse(row);
  });

  app.delete('/api/me', async (req, reply) => {
    if (req.session) await wipe(req.session, reply);
    else clearSessionCookie(reply, cfg);
    reply.code(204);
    return null;
  });

  app.post('/api/rooms', async (req) => {
    const s = requireVerifiedSession(req);
    const body = parse(CreateRoomSchema, req.body);
    const room = await rooms.create(s, body.mode, body.solo ?? false);
    return { code: room.code, mode: room.mode };
  });

  app.post('/api/rooms/join', async (req, reply) => {
    const s = requireVerifiedSession(req);
    const key = clientKey(req, reply, cfg);
    if (!(await hit(db, key, BUCKETS.join))) throw new HttpError(429, 'RATE_LIMITED');
    const body = parse(JoinRoomSchema, req.body);
    try {
      const room = await rooms.join(body.code, s);
      return { code: room.code, mode: room.mode };
    } catch (e) {
      if (e instanceof EngineError && e.code === 'NOT_FOUND') {
        if (!(await hit(db, key, BUCKETS.joinFail))) throw new HttpError(429, 'RATE_LIMITED');
      }
      engineToHttp(e);
    }
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (req) => {
    const s = requireVerifiedSession(req);
    const code = RoomCodeSchema.safeParse(req.params.code);
    if (!code.success) throw new HttpError(404, 'NOT_FOUND');
    const room = await rooms.getByCode(code.data);
    // Members only; non-members get the same 404 as a missing room.
    if (!room || !rooms.isMember(room, s.id)) throw new HttpError(404, 'NOT_FOUND');
    return rooms.snapshotFor(room, s.id);
  });

  app.post<{ Params: { code: string } }>('/api/rooms/:code/leave', async (req) => {
    const s = requireVerifiedSession(req);
    const code = RoomCodeSchema.safeParse(req.params.code);
    if (!code.success) throw new HttpError(404, 'NOT_FOUND');
    const room = await rooms.getByCode(code.data);
    if (room) await rooms.leave(room, s.id);
    return { ok: true };
  });
}
