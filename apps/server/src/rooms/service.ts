import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import {
  ActionSchemas,
  DEFAULT_BOUNDARIES,
  DEFAULT_SETTINGS,
  generateRoomCode,
  ONLINE_WINDOW_MS,
  RECONNECT_GRACE_MS,
  type Genre,
  type Intensity,
  type RoomAction,
  type RoomMode,
  type RoomSnapshot,
  type TurnMode,
} from '@nc/shared';
import type { DB } from '../db/client';
import { roomDeckState, roomPlayers, rooms, sessions, type LocalProfile } from '../db/schema';
import type { CardStore } from '../cards';
import type { Config } from '../config';
import type { Metrics } from '../metrics';
import type { SessionRow } from '../sessions';
import * as E from './engine';
import { EngineError, type Room, type SessionInfo } from './engine';

/**
 * Stateless room service (works on serverless hosts such as Vercel).
 *
 * Postgres is the only source of truth. Every mutation runs in one transaction that locks the
 * room row (`SELECT … FOR UPDATE`), so actions on a room are applied one at a time even across
 * many server instances (Section 7.6 single-writer). Idempotency keys live in the room row.
 */

const RECENT_ACTIONS = 100;
/** Presence writes are throttled to one per player per this interval. */
const PRESENCE_WRITE_MS = 5000;
const cryptoRng = () => randomInt(0, 2 ** 32) / 2 ** 32;

type Where = { id: string } | { code: string };

interface Loaded {
  room: Room;
  sessions: Map<string, SessionInfo>;
}

function endIfLive(r: Room, ctx: E.EngineCtx): void {
  if (r.state === 'playing' || r.state === 'paused' || r.state === 'stopped') E.end(r, ctx);
}

function toSessionInfo(row: SessionRow): SessionInfo {
  return {
    displayName: row.displayName,
    gender: row.gender as SessionInfo['gender'],
    preference: row.preference as SessionInfo['preference'],
    genres: row.genres as Genre[],
    boundaries: { ...DEFAULT_BOUNDARIES, ...row.boundaries },
    seenNote: { ...DEFAULT_SETTINGS, ...row.settings }.seenNote,
  };
}

/** Derive connected/away flags from the last poll time. Local (same-device) players are present. */
function derivePresence(room: Room, now: number): void {
  for (const p of room.players) {
    if (p.local) {
      p.connected = true;
      p.away = false;
      continue;
    }
    const seen = p.lastSeenAt ?? p.joinedAt;
    p.connected = now - seen < ONLINE_WINDOW_MS;
    p.away = now - seen > RECONNECT_GRACE_MS;
    p.disconnectedAt = p.connected ? null : seen;
  }
}

export class RoomService {
  constructor(
    private readonly db: DB,
    private readonly cards: CardStore,
    private readonly cfg: Config,
    private readonly metrics: Metrics,
    private readonly rng: () => number = cryptoRng,
  ) {}

  private ctx(sessionsById: Map<string, SessionInfo>, now = Date.now()): E.EngineCtx {
    return { cards: this.cards, session: (id) => sessionsById.get(id), rng: this.rng, now };
  }

  /* ------------------------------------------------------------ loading */

  private async load(ex: DB, where: Where, lock: boolean): Promise<Loaded | null> {
    const cond = 'id' in where ? eq(rooms.id, where.id) : eq(rooms.code, where.code);
    const base = ex.select().from(rooms).where(cond).limit(1);
    const [row] = lock ? await base.for('update') : await base;
    if (!row) return null;
    const now = Date.now();
    if (now - row.lastActivityAt.getTime() > this.cfg.roomIdleMs) return null; // expired (FR-24)

    const players = await ex.select().from(roomPlayers).where(eq(roomPlayers.roomId, row.id));
    const deck = await ex.select().from(roomDeckState).where(eq(roomDeckState.roomId, row.id));
    const sessionIds = players.flatMap((p) => (p.sessionId ? [p.sessionId] : []));
    const sessionsById = new Map<string, SessionInfo>();
    if (sessionIds.length) {
      const srows = await ex.select().from(sessions).where(inArray(sessions.id, sessionIds));
      for (const s of srows) sessionsById.set(s.id, toSessionInfo(s));
    }

    const { genresTouched, ...runtime } = row.runtime;
    const room: Room = {
      id: row.id,
      code: row.code,
      mode: row.mode as RoomMode,
      hostPlayerId: players.find((p) => p.sessionId && p.sessionId === row.hostSessionId)?.id ?? null,
      track: row.track,
      genres: row.genres as Genre[],
      genresTouched: !!genresTouched,
      intensity: row.intensity as Intensity | null,
      turnMode: row.turnMode as TurnMode,
      state: row.state as Room['state'],
      runtime: { ...E.newRuntime(), ...runtime },
      createdAt: row.createdAt.getTime(),
      lastActivityAt: row.lastActivityAt.getTime(),
      players: players.map((p) => ({
        id: p.id,
        sessionId: p.sessionId,
        local: p.localProfile,
        rolePrefs: p.rolePrefs,
        joinedAt: p.joinedAt.getTime(),
        leftAt: p.leftAt ? p.leftAt.getTime() : null,
        lastSeenAt: p.lastSeenAt ? p.lastSeenAt.getTime() : null,
        activeTab: p.activeTab,
        connected: false,
        disconnectedAt: null,
        away: false,
      })),
      deck: deck
        .map((d) => ({
          cardId: d.cardId,
          status: d.status as E.DeckEntry['status'],
          position: d.position,
          assignedRoles: d.assignedRoles,
          startedAt: d.startedAt ? d.startedAt.getTime() : null,
          completedAt: d.completedAt ? d.completedAt.getTime() : null,
        }))
        // Cards removed from the card file since the deck was built are dropped.
        .filter((d) => this.cards.byId.has(d.cardId)),
    };
    // Normalise after deletions elsewhere (expired sessions, edited card file).
    const ids = new Set(room.players.map((p) => p.id));
    const a = room.runtime.active;
    if (a && (!this.cards.byId.has(a.cardId) || Object.values(a.assignment).some((pid) => !ids.has(pid)))) {
      const entry = room.deck.find((d) => d.cardId === a.cardId);
      if (entry) entry.status = 'unseen';
      room.runtime.active = null;
    }
    if (!room.hostPlayerId) {
      room.hostPlayerId = E.activePlayers(room).find((p) => p.sessionId)?.id ?? null;
    }
    derivePresence(room, now);
    return { room, sessions: sessionsById };
  }

  /* -------------------------------------------------------- persistence */

  private async persist(tx: DB, room: Room): Promise<void> {
    const host = E.hostPlayer(room);
    const values = {
      id: room.id,
      code: room.code,
      hostSessionId: host?.sessionId ?? null,
      mode: room.mode,
      track: room.track,
      genres: room.genres,
      intensity: room.intensity,
      turnMode: room.turnMode,
      state: room.state,
      runtime: { ...room.runtime, genresTouched: room.genresTouched },
      createdAt: new Date(room.createdAt),
      lastActivityAt: new Date(room.lastActivityAt),
    };
    await tx
      .insert(rooms)
      .values(values)
      .onConflictDoUpdate({ target: rooms.id, set: { ...values, id: undefined } });

    const ids = room.players.map((p) => p.id);
    await tx
      .delete(roomPlayers)
      .where(
        ids.length
          ? and(eq(roomPlayers.roomId, room.id), notInArray(roomPlayers.id, ids))
          : eq(roomPlayers.roomId, room.id),
      );
    for (const p of room.players) {
      const pv = {
        id: p.id,
        roomId: room.id,
        sessionId: p.sessionId,
        localProfile: p.local,
        rolePrefs: p.rolePrefs,
        joinedAt: new Date(p.joinedAt),
        leftAt: p.leftAt === null ? null : new Date(p.leftAt),
        lastSeenAt: p.lastSeenAt ? new Date(p.lastSeenAt) : null,
        activeTab: p.activeTab ?? null,
      };
      await tx
        .insert(roomPlayers)
        .values(pv)
        .onConflictDoUpdate({ target: roomPlayers.id, set: { ...pv, id: undefined } });
    }

    await tx.delete(roomDeckState).where(eq(roomDeckState.roomId, room.id));
    if (room.deck.length) {
      await tx.insert(roomDeckState).values(
        room.deck.map((d) => ({
          roomId: room.id,
          cardId: d.cardId,
          status: d.status,
          position: d.position,
          assignedRoles: d.assignedRoles,
          startedAt: d.startedAt === null ? null : new Date(d.startedAt),
          completedAt: d.completedAt === null ? null : new Date(d.completedAt),
        })),
      );
    }
  }

  /**
   * Run `fn` on a locked room inside one transaction and save the result (unless it returns
   * `{ save: false }`). Single writer per room across all instances.
   */
  private async withRoom<T>(
    where: Where,
    fn: (room: Room, ctx: E.EngineCtx, tx: DB, sessions: Map<string, SessionInfo>) => T | Promise<T>,
  ): Promise<{ room: Room; sessions: Map<string, SessionInfo>; result: T }> {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as DB;
      const loaded = await this.load(tx, where, true);
      if (!loaded) throw new EngineError('NOT_FOUND');
      const { room } = loaded;
      const ctx = this.ctx(loaded.sessions);
      const result = await fn(room, ctx, tx, loaded.sessions);
      if ((result as { save?: boolean } | undefined)?.save !== false) {
        room.lastActivityAt = Date.now();
        room.runtime.version = (room.runtime.version ?? 0) + 1;
        await this.persist(tx, room);
      }
      return { room, sessions: loaded.sessions, result };
    });
  }

  snapshotOf(room: Room, sessionsById: Map<string, SessionInfo>, viewerSessionId: string): RoomSnapshot {
    return E.snapshot(room, this.ctx(sessionsById), viewerSessionId);
  }

  /* -------------------------------------------------------------- queries */

  /** FR-4: the most recent room this session is still in. */
  async currentRoomCode(sessionId: string): Promise<string | null> {
    const rows = await this.db
      .select({ code: rooms.code })
      .from(roomPlayers)
      .innerJoin(rooms, eq(rooms.id, roomPlayers.roomId))
      .where(
        and(
          eq(roomPlayers.sessionId, sessionId),
          isNull(roomPlayers.leftAt),
          ne(rooms.state, 'ended'),
          sql`${rooms.lastActivityAt} > ${new Date(Date.now() - this.cfg.roomIdleMs)}`,
        ),
      )
      .orderBy(desc(rooms.lastActivityAt))
      .limit(1);
    return rows[0]?.code ?? null;
  }

  private memberOrThrow(room: Room, sessionId: string): E.Player {
    const me = E.activePlayers(room).find((p) => p.sessionId === sessionId);
    if (me) return me;
    if (room.runtime.kickedSessions.includes(sessionId)) throw new EngineError('KICKED');
    throw new EngineError('NOT_MEMBER');
  }

  /* ------------------------------------------------------------ lifecycle */

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode((n) => randomInt(0, n));
      const [hit] = await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, code)).limit(1);
      if (!hit) return code;
    }
    throw new Error('could not allocate room code');
  }

  async create(session: SessionRow, mode: RoomMode, solo = false): Promise<Room> {
    const now = Date.now();
    const hostPlayer = { ...E.newPlayer(randomUUID(), session.id, now), lastSeenAt: now };
    const room: Room = {
      id: randomUUID(),
      code: await this.uniqueCode(),
      mode,
      hostPlayerId: hostPlayer.id,
      track: null,
      genres: [],
      genresTouched: false,
      intensity: null,
      turnMode: 'alternate',
      state: 'lobby',
      runtime: { ...E.newRuntime(), version: 1 },
      createdAt: now,
      lastActivityAt: now,
      players: [hostPlayer],
      deck: [],
    };
    if (mode === 'pass_and_play' && solo) {
      // Solo preview: a placeholder partner the player can edit, matched to their preference.
      const gender: LocalProfile['gender'] =
        session.preference === 'men' ? 'man' : session.preference === 'women' ? 'woman' : 'nonbinary';
      const preference: LocalProfile['preference'] =
        session.gender === 'man' ? 'men' : session.gender === 'woman' ? 'women' : 'both';
      room.players.push({
        ...E.newPlayer(randomUUID(), null, now + 1, { name: 'Partner', gender, preference }),
        connected: true,
      });
    }
    const sessionsById = new Map([[session.id, toSessionInfo(session)]]);
    E.syncGenres(room, this.ctx(sessionsById, now));
    await this.db.transaction(async (tx) => this.persist(tx as unknown as DB, room));
    return room;
  }

  async join(code: string, session: SessionRow): Promise<Room> {
    const { room } = await this.withRoom({ code }, (r, ctx, _tx, sessionsById) => {
      if (r.state === 'ended' && !r.players.some((p) => p.sessionId === session.id && p.leftAt === null)) {
        throw new EngineError('NOT_FOUND');
      }
      // The room was loaded before this player joined, so add their profile for genre/track math.
      sessionsById.set(session.id, toSessionInfo(session));
      const p = E.join(r, ctx, session.id, randomUUID());
      p.lastSeenAt = Date.now();
    });
    return room;
  }

  /**
   * Make this browser tab the active one for the player (Section 7.5 multi-tab rule) and return
   * the snapshot. Earlier tabs get SUPERSEDED on their next poll or action.
   */
  async connect(code: string, session: SessionRow, tabId: string): Promise<RoomSnapshot> {
    const { room, sessions: s } = await this.withRoom({ code }, (r, ctx) => {
      const me = this.memberOrThrow(r, session.id);
      const returning = me.away;
      me.activeTab = tabId;
      me.lastSeenAt = Date.now();
      derivePresence(r, Date.now());
      E.applyPresence(r, ctx);
      if (returning) void this.metrics.inc('reconnects');
    });
    return this.snapshotOf(room, s, session.id);
  }

  /** Poll: authoritative snapshot for this player, refreshing their presence (throttled). */
  async poll(code: string, session: SessionRow, tabId: string): Promise<RoomSnapshot> {
    const loaded = await this.load(this.db, { code }, false);
    if (!loaded) throw new EngineError('NOT_FOUND');
    let { room } = loaded;
    let s = loaded.sessions;
    const me = this.memberOrThrow(room, session.id);
    if (me.activeTab && me.activeTab !== tabId) throw new EngineError('SUPERSEDED');

    const now = Date.now();
    if (!me.lastSeenAt || now - me.lastSeenAt > PRESENCE_WRITE_MS) {
      await this.db
        .update(roomPlayers)
        .set({ lastSeenAt: new Date(now) })
        .where(eq(roomPlayers.id, me.id));
      me.lastSeenAt = now;
      derivePresence(room, now);
    }
    // Someone went away or came back: apply it once, under the room lock.
    const handled = new Set(room.runtime.awayHandled ?? []);
    if (E.activePlayers(room).some((p) => p.away !== handled.has(p.id))) {
      ({ room, sessions: s } = await this.withRoom({ id: room.id }, (r, ctx) =>
        E.applyPresence(r, ctx) ? undefined : { save: false },
      ));
    }
    return this.snapshotOf(room, s, session.id);
  }

  async leave(code: string, sessionId: string): Promise<void> {
    let remove = false;
    try {
      await this.withRoom({ code }, (r, ctx) => {
        const p = r.players.find((pl) => pl.sessionId === sessionId && pl.leftAt === null);
        if (!p) return { save: false };
        remove = !E.removePlayer(r, ctx, p.id);
        if (remove) endIfLive(r, ctx);
        return undefined;
      });
    } catch (e) {
      if (e instanceof EngineError && e.code === 'NOT_FOUND') return;
      throw e;
    }
    if (remove) await this.deleteRoomByCode(code);
  }

  /** Delete-now: remove every trace of a session from its rooms before the session row goes. */
  async purgeSession(sessionId: string): Promise<void> {
    const memberRooms = await this.db
      .select({ roomId: roomPlayers.roomId })
      .from(roomPlayers)
      .where(eq(roomPlayers.sessionId, sessionId));
    for (const { roomId } of memberRooms) {
      let remove = false;
      try {
        await this.withRoom({ id: roomId }, (r, ctx) => {
          const p = r.players.find((pl) => pl.sessionId === sessionId);
          if (p && p.leftAt === null) remove = !E.removePlayer(r, ctx, p.id);
          else remove = !E.activePlayers(r).some((pl) => pl.sessionId && pl.sessionId !== sessionId);
          r.players = r.players.filter((pl) => pl.sessionId !== sessionId);
          r.runtime.kickedSessions = r.runtime.kickedSessions.filter((x) => x !== sessionId);
          if (remove) endIfLive(r, ctx);
        });
      } catch (e) {
        if (!(e instanceof EngineError && e.code === 'NOT_FOUND')) throw e;
      }
      if (remove) await this.deleteRoom(roomId);
    }
  }

  /** Lobby views reflect profile edits (names, genres, boundaries). */
  async profileChanged(row: SessionRow): Promise<void> {
    const memberRooms = await this.db
      .select({ roomId: roomPlayers.roomId })
      .from(roomPlayers)
      .innerJoin(rooms, eq(rooms.id, roomPlayers.roomId))
      .where(and(eq(roomPlayers.sessionId, row.id), isNull(roomPlayers.leftAt), eq(rooms.state, 'lobby')));
    for (const { roomId } of memberRooms) {
      await this.withRoom({ id: roomId }, (r, ctx) => E.syncGenres(r, ctx)).catch(() => {});
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.db.delete(rooms).where(eq(rooms.id, roomId));
  }

  private async deleteRoomByCode(code: string): Promise<void> {
    await this.db.delete(rooms).where(eq(rooms.code, code));
  }

  /** FR-24 + cleanup: hard-delete idle rooms and rooms with no human players left. */
  async deleteExpiredRooms(now = Date.now()): Promise<number> {
    const deleted = await this.db
      .delete(rooms)
      .where(
        sql`${rooms.lastActivityAt} < ${new Date(now - this.cfg.roomIdleMs)} OR NOT EXISTS (SELECT 1 FROM ${roomPlayers} rp WHERE rp.room_id = ${rooms.id} AND rp.session_id IS NOT NULL AND rp.left_at IS NULL)`,
      )
      .returning({ id: rooms.id });
    return deleted.length;
  }

  /* -------------------------------------------------------------- actions */

  /**
   * Apply one client action (idempotent by `actionId`) and return the actor's new snapshot, or
   * null when the actor is no longer in the room (left).
   */
  async act(
    code: string,
    session: SessionRow,
    tabId: string,
    event: RoomAction,
    raw: unknown,
  ): Promise<RoomSnapshot | null> {
    const parsed = ActionSchemas[event].safeParse(raw);
    if (!parsed.success) throw new EngineError('BAD_REQUEST');
    const payload = parsed.data as Record<string, unknown> & { actionId: string };

    let deleteAfter = false;
    const { room, sessions: s } = await this.withRoom({ code }, async (r, ctx, tx) => {
      const actor = this.memberOrThrow(r, session.id);
      if (actor.activeTab && actor.activeTab !== tabId) throw new EngineError('SUPERSEDED');
      const seen = r.runtime.recentActions ?? [];
      if (seen.includes(payload.actionId)) return { save: false }; // duplicate delivery
      actor.lastSeenAt = Date.now();
      const a = actor.id;
      switch (event) {
        case 'room:setGenres':
          E.setGenres(r, ctx, a, payload.genres as Genre[]);
          break;
        case 'room:setOptions':
          E.setOptions(r, a, payload as Parameters<typeof E.setOptions>[2]);
          break;
        case 'room:setRolePrefs':
          E.setRolePrefs(r, a, payload.playerId as string, payload.rolePrefs as never);
          break;
        case 'room:proposeTrack':
          E.proposeTrack(r, ctx, a, payload.track as string);
          break;
        case 'room:confirmTrack':
          E.confirmTrack(r, a);
          break;
        case 'room:addLocal':
          E.addLocal(r, ctx, a, randomUUID(), payload.player as LocalProfile);
          break;
        case 'room:updateLocal':
          E.updateLocal(r, ctx, a, payload.playerId as string, payload.player as LocalProfile);
          break;
        case 'room:removeLocal':
          E.removeLocal(r, ctx, a, payload.playerId as string);
          break;
        case 'room:start':
          E.start(r, ctx, a);
          void this.metrics.inc('rooms_started');
          break;
        case 'room:playAgain':
          E.playAgain(r, ctx, a);
          break;
        case 'room:leave':
          deleteAfter = !E.removePlayer(r, ctx, a);
          if (deleteAfter) endIfLive(r, ctx);
          break;
        case 'card:draw':
          E.draw(r, ctx, a);
          break;
        case 'card:swap':
          E.swap(r, ctx);
          break;
        case 'roles:swap':
          E.rolesSwap(r, ctx);
          break;
        case 'roles:confirm':
          E.rolesConfirm(r, ctx, payload.assignment as Record<string, string> | undefined);
          break;
        case 'card:startTimer':
          E.startTimer(r, ctx);
          break;
        case 'card:done': {
          const card = E.done(r, ctx);
          void this.metrics.inc(`cards_completed:${card.genre}`);
          break;
        }
        case 'card:skip':
          E.skip(r, ctx);
          break;
        case 'card:never': {
          const cardId = E.never(r, ctx);
          await this.addNeverCard(tx, session.id, cardId);
          break;
        }
        case 'deck:reshuffle':
          E.reshuffle(r, ctx);
          break;
        case 'turn:set':
          E.setTurn(r, a, payload.playerId as string);
          break;
        case 'game:pause':
          E.pause(r, ctx);
          break;
        case 'game:resume':
          E.resume(r, ctx);
          break;
        case 'game:stop':
          E.stop(r, ctx);
          void this.metrics.inc('stop_used');
          break;
        case 'game:end':
          E.end(r, ctx);
          break;
        case 'host:kick':
          deleteAfter = !E.kick(r, ctx, a, payload.playerId as string);
          break;
        default:
          throw new EngineError('UNKNOWN_EVENT');
      }
      seen.push(payload.actionId);
      r.runtime.recentActions = seen.slice(-RECENT_ACTIONS);
      return undefined;
    });
    if (deleteAfter) {
      await this.deleteRoom(room.id);
      return null;
    }
    if (event === 'room:leave') return null;
    return this.snapshotOf(room, s, session.id);
  }

  private async addNeverCard(tx: DB, sessionId: string, cardId: string): Promise<void> {
    const [row] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!row) return;
    const b = { ...DEFAULT_BOUNDARIES, ...row.boundaries };
    if (!b.neverCardIds.includes(cardId)) b.neverCardIds = [...b.neverCardIds, cardId].slice(-200);
    await tx.update(sessions).set({ boundaries: b }).where(eq(sessions.id, sessionId));
  }
}
