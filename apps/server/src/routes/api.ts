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
  ActionRequestSchema,
  ConnectSchema,
  TabIdSchema,
  type MeResponse,
} from '@nc/shared';
import type { AppDeps } from '../app';
import { sessions } from '../db/schema';
import { BUCKETS, hit } from '../rateLimit';
import { createSession, deleteSession, hmac, toProfile, type SessionRow } from '../sessions';
import { maybeCleanup, runCleanup } from '../cleanup';
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

const ENGINE_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  NOT_MEMBER: 404,
  KICKED: 403,
  BAD_REQUEST: 400,
  BAD_ASSIGNMENT: 400,
  BAD_TRACK: 400,
  UNKNOWN_EVENT: 400,
};

/** Game-rule errors become HTTP errors with the same code (most are 409 state conflicts). */
function engineToHttp(e: unknown): never {
  if (e instanceof EngineError) throw new HttpError(ENGINE_STATUS[e.code] ?? 409, e.code);
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
    await maybeCleanup(deps);
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

  app.get('/api/me', async (req) => {
    const s = requireVerifiedSession(req);
    await maybeCleanup(deps);
    return meResponse(s);
  });

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

  /** Room code from the URL; anything malformed is indistinguishable from a missing room. */
  const roomCode = (raw: string): string => {
    const code = RoomCodeSchema.safeParse(raw);
    if (!code.success) throw new HttpError(404, 'NOT_FOUND');
    return code.data;
  };
  const tabOf = (req: { headers: Record<string, unknown> }): string => {
    const tab = TabIdSchema.safeParse(req.headers['x-nc-tab']);
    if (!tab.success) throw new HttpError(400, 'INVALID_INPUT');
    return tab.data;
  };

  /** Make this tab the active one and get the first snapshot (replaces the socket "join"). */
  app.post<{ Params: { code: string } }>('/api/rooms/:code/connect', async (req) => {
    const s = requireVerifiedSession(req);
    const { tabId } = parse(ConnectSchema, req.body);
    try {
      return await rooms.connect(roomCode(req.params.code), s, tabId);
    } catch (e) {
      engineToHttp(e);
    }
  });

  /**
   * Poll: the authoritative room snapshot (members only). Card text is included only for this
   * verified member, and only after roles are confirmed (Hard Rule 1).
   */
  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (req, reply) => {
    const s = requireVerifiedSession(req);
    reply.header('Cache-Control', 'no-store');
    try {
      return await rooms.poll(roomCode(req.params.code), s, tabOf(req));
    } catch (e) {
      engineToHttp(e);
    }
  });

  /** Every room mutation: { event, payload: { actionId, ... } }. Returns the new snapshot. */
  app.post<{ Params: { code: string } }>('/api/rooms/:code/actions', async (req, reply) => {
    const s = requireVerifiedSession(req);
    if (!(await hit(db, hmac(cfg.hashSecret, `actions:${s.id}`), BUCKETS.actions))) {
      throw new HttpError(429, 'RATE_LIMITED');
    }
    const body = parse(ActionRequestSchema, req.body);
    reply.header('Cache-Control', 'no-store');
    try {
      const snapshot = await rooms.act(roomCode(req.params.code), s, tabOf(req), body.event, body.payload);
      return { snapshot };
    } catch (e) {
      engineToHttp(e);
    }
  });

  app.post<{ Params: { code: string } }>('/api/rooms/:code/leave', async (req) => {
    const s = requireVerifiedSession(req);
    await rooms.leave(roomCode(req.params.code), s.id);
    return { ok: true };
  });

  /** Optional daily backstop for hosts with cron (Vercel Cron sends Authorization: Bearer CRON_SECRET). */
  app.get('/api/cron/cleanup', async (req) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'UNAUTHORIZED');
    return runCleanup(deps);
  });
}
