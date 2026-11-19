import { randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
import {
  DEFAULT_BOUNDARIES,
  DEFAULT_SETTINGS,
  generateRoomCode,
  RECONNECT_GRACE_MS,
  WsSchemas,
  type Genre,
  type Intensity,
  type RoomMode,
  type RoomSnapshot,
  type TurnMode,
  type WsEvent,
} from '@nc/shared';
import type { DB } from '../db/client';
import { roomDeckState, roomPlayers, rooms, sessions, type LocalProfile } from '../db/schema';
import type { CardStore } from '../cards';
import type { Config } from '../config';
import type { Metrics } from '../metrics';
import type { SessionRow } from '../sessions';
import * as E from './engine';
import { EngineError, type Room, type SessionInfo } from './engine';

export interface RoomEvent {
  type: 'card:dealt' | 'game:stopped' | 'room:playerJoined' | 'room:playerLeft' | 'room:kicked';
  payload: Record<string, unknown>;
}

interface CachedSession extends SessionInfo {
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

const RECENT_ACTIONS = 200;

function endIfLive(r: Room, ctx: E.EngineCtx): void {
  if (r.state === 'playing' || r.state === 'paused' || r.state === 'stopped') E.end(r, ctx);
}
const cryptoRng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export class RoomService {
  private rooms = new Map<string, Room>();
  private codes = new Map<string, string>();
  private locks = new Map<string, Promise<unknown>>();
  private sessionsCache = new Map<string, CachedSession>();
  private recent = new Map<string, string[]>();
  private awayTimers = new Map<string, NodeJS.Timeout>();

  /** Set by the realtime layer: broadcast a fresh snapshot (and optional event) for a room. */
  onChange: (room: Room, events: RoomEvent[]) => void = () => {};
  /** Set by the realtime layer: room hard-deleted. */
  onClosed: (roomId: string) => void = () => {};

  constructor(
    private readonly db: DB,
    private readonly cards: CardStore,
    private readonly cfg: Config,
    private readonly metrics: Metrics,
    private readonly rng: () => number = cryptoRng,
  ) {}

  /* --------------------------------------------------------- session cache */

  cacheSession(row: SessionRow): void {
    this.sessionsCache.set(row.id, {
      displayName: row.displayName,
      gender: row.gender as SessionInfo['gender'],
      preference: row.preference as SessionInfo['preference'],
      genres: row.genres as Genre[],
      boundaries: { ...DEFAULT_BOUNDARIES, ...row.boundaries },
      seenNote: ({ ...DEFAULT_SETTINGS, ...row.settings }).seenNote,
      createdAt: row.createdAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    });
  }

  /** Cheap in-memory check used before sending card content to a socket. */
  isSessionLive(sessionId: string, now = Date.now()): boolean {
    const s = this.sessionsCache.get(sessionId);
    if (!s) return false;
    return (
      now < s.expiresAt &&
      now - s.createdAt < this.cfg.absoluteMs &&
      now - s.lastSeenAt < this.cfg.idleMs
    );
  }

  private ctx(): E.EngineCtx {
    return {
      cards: this.cards,
      session: (id) => this.sessionsCache.get(id),
      rng: this.rng,
      now: Date.now(),
    };
  }

  snapshotFor(room: Room, sessionId: string | null): RoomSnapshot {
    return E.snapshot(room, this.ctx(), sessionId);
  }

  /** Called after a profile edit so lobbies reflect new names/genres/boundaries. */
  async profileChanged(row: SessionRow): Promise<void> {
    this.cacheSession(row);
    for (const room of this.rooms.values()) {
      if (!room.players.some((p) => p.sessionId === row.id && p.leftAt === null)) continue;
      await this.withRoom(room.id, (r) => {
        if (r.state === 'lobby') E.syncGenres(r, this.ctx());
      });
    }
  }

  /* ------------------------------------------------------------- locking */

  /** Single-writer per room (Section 7.6): mutations run strictly one after another. */
  private async withRoom<T>(
    roomId: string,
    fn: (room: Room) => T | Promise<T>,
    events: RoomEvent[] = [],
  ): Promise<T> {
    const prev = this.locks.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => next);
    this.locks.set(roomId, chained);
    await prev;
    try {
      const room = this.rooms.get(roomId);
      if (!room) throw new EngineError('NOT_FOUND');
      const result = await fn(room);
      room.lastActivityAt = Date.now();
      await this.persist(room);
      this.onChange(room, events);
      return result;
    } finally {
      release();
      if (this.locks.get(roomId) === chained) this.locks.delete(roomId);
    }
  }

  /* ---------------------------------------------------------- persistence */

  private async persist(room: Room): Promise<void> {
    const host = E.hostPlayer(room);
    await this.db.transaction(async (tx) => {
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
        runtime: { ...room.runtime, genresTouched: room.genresTouched } as typeof room.runtime,
        createdAt: new Date(room.createdAt),
        lastActivityAt: new Date(room.lastActivityAt),
      };
      await tx
        .insert(rooms)
        .values(values)
        .onConflictDoUpdate({ target: rooms.id, set: { ...values, id: undefined } });
      const ids = room.players.map((p) => p.id);
      if (ids.length) {
        await tx
          .delete(roomPlayers)
          .where(and(eq(roomPlayers.roomId, room.id), notInArray(roomPlayers.id, ids)));
      } else {
        await tx.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      }
      for (const p of room.players) {
        const pv = {
          id: p.id,
          roomId: room.id,
          sessionId: p.sessionId,
          localProfile: p.local,
          rolePrefs: p.rolePrefs,
          joinedAt: new Date(p.joinedAt),
          leftAt: p.leftAt === null ? null : new Date(p.leftAt),
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
    });
  }

  /** Rehydrate a room from Postgres (e.g. after a restart). */
  private async load(where: { id?: string; code?: string }): Promise<Room | null> {
    const cachedId = where.id ?? (where.code ? this.codes.get(where.code) : undefined);
    if (cachedId && this.rooms.has(cachedId)) return this.rooms.get(cachedId) as Room;
    const [row] = await this.db
      .select()
      .from(rooms)
      .where(where.id ? eq(rooms.id, where.id) : eq(rooms.code, where.code as string))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.lastActivityAt.getTime() > this.cfg.roomIdleMs) return null;
    const players = await this.db.select().from(roomPlayers).where(eq(roomPlayers.roomId, row.id));
    const deck = await this.db.select().from(roomDeckState).where(eq(roomDeckState.roomId, row.id));
    const sessionIds = players.flatMap((p) => (p.sessionId ? [p.sessionId] : []));
    if (sessionIds.length) {
      const srows = await this.db.select().from(sessions).where(inArray(sessions.id, sessionIds));
      srows.forEach((s) => this.cacheSession(s));
    }
    const { genresTouched, ...runtime } = row.runtime as typeof row.runtime & {
      genresTouched?: boolean;
    };
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
        connected: false,
        disconnectedAt: null,
        away: false,
      })),
      deck: deck.map((d) => ({
        cardId: d.cardId,
        status: d.status as E.DeckEntry['status'],
        position: d.position,
        assignedRoles: d.assignedRoles,
        startedAt: d.startedAt ? d.startedAt.getTime() : null,
        completedAt: d.completedAt ? d.completedAt.getTime() : null,
      })),
    };
    // Drop cards that no longer exist in the card file.
    room.deck = room.deck.filter((d) => this.cards.byId.has(d.cardId));
    if (room.runtime.active && !this.cards.byId.has(room.runtime.active.cardId)) {
      room.runtime.active = null;
    }
    if (!room.hostPlayerId) room.hostPlayerId = E.activePlayers(room).find((p) => p.sessionId)?.id ?? null;
    this.rooms.set(room.id, room);
    this.codes.set(room.code, room.id);
    return room;
  }

  async getByCode(code: string): Promise<Room | null> {
    return this.load({ code });
  }

  async getById(id: string): Promise<Room | null> {
    return this.load({ id });
  }

  isMember(room: Room, sessionId: string): boolean {
    return room.players.some((p) => p.sessionId === sessionId && p.leftAt === null);
  }

  /** FR-4: the most recent room this session is still in. */
  async currentRoomCode(sessionId: string): Promise<string | null> {
    const rows = await this.db
      .select({ code: rooms.code, lastActivityAt: rooms.lastActivityAt })
      .from(roomPlayers)
      .innerJoin(rooms, eq(rooms.id, roomPlayers.roomId))
      .where(
        and(eq(roomPlayers.sessionId, sessionId), isNull(roomPlayers.leftAt), ne(rooms.state, 'ended')),
      )
      .orderBy(desc(rooms.lastActivityAt))
      .limit(1);
    return rows[0]?.code ?? null;
  }

  /* -------------------------------------------------------------- create */

  private async uniqueCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode((n) => randomInt(0, n));
      if (this.codes.has(code)) continue;
      const [hit] = await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, code)).limit(1);
      if (!hit) return code;
    }
    throw new Error('could not allocate room code');
  }

  async create(session: SessionRow, mode: RoomMode, solo = false): Promise<Room> {
    this.cacheSession(session);
    const now = Date.now();
    const hostPlayer = E.newPlayer(randomUUID(), session.id, now);
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
      runtime: E.newRuntime(),
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
    E.syncGenres(room, this.ctx());
    this.rooms.set(room.id, room);
    this.codes.set(room.code, room.id);
    await this.persist(room);
    return room;
  }

  async join(code: string, session: SessionRow): Promise<Room> {
    this.cacheSession(session);
    const room = await this.getByCode(code);
    if (!room || room.state === 'ended' && !this.isMember(room, session.id)) {
      throw new EngineError('NOT_FOUND');
    }
    const wasMember = this.isMember(room, session.id);
    let playerId = '';
    await this.withRoom(
      room.id,
      (r) => {
        playerId = E.join(r, this.ctx(), session.id, randomUUID()).id;
      },
      wasMember ? [] : [{ type: 'room:playerJoined', payload: {} }],
    );
    void playerId;
    return room;
  }

  async leave(room: Room, sessionId: string): Promise<void> {
    const player = room.players.find((p) => p.sessionId === sessionId && p.leftAt === null);
    if (!player) return;
    let keep = true;
    await this.withRoom(
      room.id,
      (r) => {
        keep = E.removePlayer(r, this.ctx(), player.id);
        if (!keep) endIfLive(r, this.ctx());
      },
      [{ type: 'room:playerLeft', payload: { playerId: player.id } }],
    );
    if (!keep) await this.deleteRoom(room.id);
  }

  /** Remove every trace of a session from rooms before the session row is deleted. */
  async purgeSession(sessionId: string): Promise<void> {
    this.sessionsCache.delete(sessionId);
    const memberRooms = await this.db
      .select({ roomId: roomPlayers.roomId })
      .from(roomPlayers)
      .where(eq(roomPlayers.sessionId, sessionId));
    for (const { roomId } of memberRooms) await this.load({ id: roomId });
    for (const room of [...this.rooms.values()]) {
      if (!room.players.some((p) => p.sessionId === sessionId)) continue;
      let keep = true;
      await this.withRoom(room.id, (r) => {
        const p = r.players.find((pl) => pl.sessionId === sessionId);
        if (p) keep = E.removePlayer(r, this.ctx(), p.id);
        r.players = r.players.filter((pl) => pl.sessionId !== sessionId);
        r.runtime.kickedSessions = r.runtime.kickedSessions.filter((s) => s !== sessionId);
        if (!keep) endIfLive(r, this.ctx());
      }, [{ type: 'room:playerLeft', payload: {} }]);
      if (!keep) await this.deleteRoom(room.id);
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.db.delete(rooms).where(eq(rooms.id, roomId));
    const room = this.rooms.get(roomId);
    if (room) {
      this.codes.delete(room.code);
      for (const p of room.players) this.clearAway(room.id, p.id);
    }
    this.rooms.delete(roomId);
    this.recent.delete(roomId);
    this.onClosed(roomId);
  }

  /** FR-24 + cleanup job: hard-delete idle rooms and rooms with no human players. */
  async deleteExpiredRooms(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - this.cfg.roomIdleMs);
    const idle = await this.db.select({ id: rooms.id }).from(rooms).where(lt(rooms.lastActivityAt, cutoff));
    const orphan = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${roomPlayers} rp WHERE rp.room_id = ${rooms.id} AND rp.session_id IS NOT NULL AND rp.left_at IS NULL)`,
      );
    const ids = [...new Set([...idle, ...orphan].map((r) => r.id))];
    for (const id of ids) await this.deleteRoom(id);
    return ids.length;
  }

  /** Sessions deleted by the cleanup job: drop them from cached rooms. */
  async sessionsExpired(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    ids.forEach((id) => this.sessionsCache.delete(id));
    for (const room of [...this.rooms.values()]) {
      if (!room.players.some((p) => p.sessionId && gone.has(p.sessionId))) continue;
      let keep = true;
      // Remove all expired players in one pass so host never passes to another expired session.
      await this.withRoom(room.id, (r) => {
        r.players = r.players.filter((pl) => {
          if (!pl.sessionId || !gone.has(pl.sessionId)) return true;
          if (pl.leftAt === null) pl.leftAt = Date.now();
          return false;
        });
        r.runtime.kickedSessions = r.runtime.kickedSessions.filter((s) => !gone.has(s));
        const remaining = E.activePlayers(r);
        if (!r.players.some((pl) => pl.id === r.hostPlayerId)) {
          r.hostPlayerId = remaining.find((pl) => pl.sessionId)?.id ?? null;
        }
        keep = remaining.some((pl) => pl.sessionId);
        if (!keep) endIfLive(r, this.ctx());
        if (r.runtime.currentPlayerId && !remaining.some((pl) => pl.id === r.runtime.currentPlayerId)) {
          r.runtime.currentPlayerId = remaining[0]?.id ?? null;
        }
        const a = r.runtime.active;
        if (a && Object.values(a.assignment).some((pid) => !remaining.some((pl) => pl.id === pid))) {
          const entry = r.deck.find((d) => d.cardId === a.cardId);
          if (entry) entry.status = 'unseen';
          r.runtime.active = null;
        }
      });
      if (!keep) await this.deleteRoom(room.id);
    }
  }

  /* ------------------------------------------------------------ presence */

  private awayKey = (roomId: string, playerId: string) => `${roomId}:${playerId}`;
  private clearAway(roomId: string, playerId: string): void {
    const k = this.awayKey(roomId, playerId);
    const t = this.awayTimers.get(k);
    if (t) clearTimeout(t);
    this.awayTimers.delete(k);
  }

  async connected(room: Room, sessionId: string): Promise<void> {
    const p = room.players.find((pl) => pl.sessionId === sessionId && pl.leftAt === null);
    if (!p) return;
    this.clearAway(room.id, p.id);
    const wasAway = p.away || p.disconnectedAt !== null;
    await this.withRoom(room.id, (r) => {
      const pl = r.players.find((x) => x.id === p.id);
      if (!pl) return;
      pl.connected = true;
      pl.away = false;
      pl.disconnectedAt = null;
    });
    if (wasAway) void this.metrics.inc('reconnects');
  }

  async disconnected(room: Room, sessionId: string, graceMs = RECONNECT_GRACE_MS): Promise<void> {
    const p = room.players.find((pl) => pl.sessionId === sessionId && pl.leftAt === null);
    if (!p || !this.rooms.has(room.id)) return;
    await this.withRoom(room.id, (r) => {
      const pl = r.players.find((x) => x.id === p.id);
      if (!pl) return;
      pl.connected = false;
      pl.disconnectedAt = Date.now();
    });
    this.clearAway(room.id, p.id);
    const timer = setTimeout(() => {
      this.awayTimers.delete(this.awayKey(room.id, p.id));
      if (!this.rooms.has(room.id)) return;
      void this.withRoom(room.id, (r) => E.markAway(r, this.ctx(), p.id)).catch(() => {});
    }, graceMs);
    timer.unref?.();
    this.awayTimers.set(this.awayKey(room.id, p.id), timer);
  }

  /* -------------------------------------------------------------- actions */

  /**
   * Apply one client action. Every mutation is idempotent by `actionId` (Section 7.6) and
   * serialized per room. Returns the boundaries update for `card:never` so callers can persist.
   */
  async act(room: Room, session: SessionRow, event: WsEvent, raw: unknown): Promise<void> {
    const schema = WsSchemas[event];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new EngineError('BAD_REQUEST');
    const payload = parsed.data as Record<string, unknown> & { actionId: string };
    if (event === 'room:leave') return this.leave(room, session.id);

    const events: RoomEvent[] = [];
    let neverCardId: string | null = null;
    let kickedLast = false;
    await this.withRoom(
      room.id,
      (r) => {
        const seen = this.recent.get(r.id) ?? [];
        if (seen.includes(payload.actionId)) return; // duplicate delivery: no-op, state re-sent
        const actor = E.activePlayers(r).find((p) => p.sessionId === session.id);
        if (!actor) throw new EngineError('NOT_MEMBER');
        const ctx = this.ctx();
        const a = actor.id;
        switch (event) {
          case 'room:join':
            break;
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
          case 'card:draw':
            E.draw(r, ctx, a);
            events.push({ type: 'card:dealt', payload: { dealSeq: r.runtime.dealSeq } });
            break;
          case 'card:swap':
            E.swap(r, ctx);
            events.push({ type: 'card:dealt', payload: { dealSeq: r.runtime.dealSeq } });
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
          case 'card:never':
            neverCardId = E.never(r, ctx);
            break;
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
            events.push({ type: 'game:stopped', payload: {} });
            void this.metrics.inc('stop_used');
            break;
          case 'game:end':
            E.end(r, ctx);
            break;
          case 'host:kick': {
            const target = r.players.find((p) => p.id === payload.playerId);
            kickedLast = !E.kick(r, ctx, a, payload.playerId as string);
            events.push({
              type: 'room:kicked',
              payload: { sessionId: target?.sessionId ?? '' },
            });
            break;
          }
          default:
            throw new EngineError('UNKNOWN_EVENT');
        }
        seen.push(payload.actionId);
        if (seen.length > RECENT_ACTIONS) seen.splice(0, seen.length - RECENT_ACTIONS);
        this.recent.set(r.id, seen);
      },
      events,
    );
    if (kickedLast) await this.deleteRoom(room.id);
    if (neverCardId) await this.addNeverCard(session.id, neverCardId);
  }

  private async addNeverCard(sessionId: string, cardId: string): Promise<void> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (!row) return;
    const b = { ...DEFAULT_BOUNDARIES, ...row.boundaries };
    if (!b.neverCardIds.includes(cardId)) b.neverCardIds = [...b.neverCardIds, cardId].slice(-200);
    const [updated] = await this.db
      .update(sessions)
      .set({ boundaries: b })
      .where(eq(sessions.id, sessionId))
      .returning();
    if (updated) this.cacheSession(updated);
  }

  /** Test/ops helper. */
  get size(): number {
    return this.rooms.size;
  }
}
