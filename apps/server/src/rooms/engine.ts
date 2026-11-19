import {
  assignRoles,
  availableGenres,
  COUPLE_MAX_PLAYERS,
  deckHasIntensity,
  DEFAULT_ROLE_PREFS,
  filterDeck,
  isValidAssignment,
  MAX_ROOM_PLAYERS,
  renderCardText,
  resolveTrack,
  rotateAssignment,
  shuffle,
  TRACK_RULES,
  type Boundaries,
  type Card,
  type DeckStatus,
  type Gender,
  type Genre,
  type Intensity,
  type Preference,
  type RoleAssignment,
  type RolePrefs,
  type RoomMode,
  type RoomSnapshot,
  type RoomState,
  type TurnMode,
} from '@nc/shared';
import type { LocalProfile, RoomRuntime } from '../db/schema';

export class EngineError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface Player {
  id: string;
  sessionId: string | null;
  local: LocalProfile | null;
  rolePrefs: RolePrefs;
  joinedAt: number;
  leftAt: number | null;
  // ephemeral presence
  connected: boolean;
  disconnectedAt: number | null;
  away: boolean;
}

export interface DeckEntry {
  cardId: string;
  status: DeckStatus;
  position: number;
  assignedRoles: RoleAssignment | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface Room {
  id: string;
  code: string;
  mode: RoomMode;
  hostPlayerId: string | null;
  track: string | null;
  genres: Genre[];
  genresTouched: boolean;
  intensity: Intensity | null;
  turnMode: TurnMode;
  state: RoomState;
  runtime: RoomRuntime;
  createdAt: number;
  lastActivityAt: number;
  players: Player[];
  deck: DeckEntry[];
}

export interface SessionInfo {
  displayName: string | null;
  gender: Gender;
  preference: Preference;
  genres: Genre[];
  boundaries: Boundaries;
  seenNote: boolean;
}

export interface EngineCtx {
  cards: { all: Card[]; byId: Map<string, Card> };
  session(sessionId: string): SessionInfo | undefined;
  rng(): number;
  now: number;
}

export function newRuntime(): RoomRuntime {
  return {
    timerMode: 'manual',
    pauseOnAway: true,
    manualTrack: null,
    trackProposal: null,
    currentPlayerId: null,
    turnCursor: 0,
    active: null,
    dealSeq: 0,
    prevState: null,
    timerWasRunning: false,
    stats: { completed: 0, skipped: 0, byGenre: {}, startedAt: null, endedAt: null },
    kickedSessions: [],
    noteShown: false,
  };
}

export function newPlayer(
  id: string,
  sessionId: string | null,
  now: number,
  local: LocalProfile | null = null,
): Player {
  return {
    id,
    sessionId,
    local,
    rolePrefs: { ...DEFAULT_ROLE_PREFS },
    joinedAt: now,
    leftAt: null,
    connected: false,
    disconnectedAt: null,
    away: false,
  };
}

/* ---------------------------------------------------------------- helpers */

export const activePlayers = (room: Room) =>
  room.players.filter((p) => p.leftAt === null).sort((a, b) => a.joinedAt - b.joinedAt);

/** Players who can take turns / roles: present (online rooms exclude "away"). */
export const eligiblePlayers = (room: Room) => activePlayers(room).filter((p) => !p.away);

export function hostPlayer(room: Room): Player | undefined {
  return room.players.find((p) => p.id === room.hostPlayerId);
}

interface PlayerInfo {
  name: string;
  gender: Gender;
  preference: Preference;
  genres: Genre[];
  boundaries: Boundaries;
}

export function playerInfo(room: Room, p: Player, ctx: EngineCtx): PlayerInfo {
  const host = hostPlayer(room);
  const hostInfo = host?.sessionId ? ctx.session(host.sessionId) : undefined;
  if (p.local) {
    // Same-device players share the host's genres; host boundaries already apply to all.
    return {
      name: p.local.name,
      gender: p.local.gender,
      preference: p.local.preference,
      genres: hostInfo?.genres ?? [],
      boundaries: { neverGenres: [], neverCardIds: [] },
    };
  }
  const s = p.sessionId ? ctx.session(p.sessionId) : undefined;
  const index = activePlayers(room).indexOf(p);
  return {
    name: s?.displayName ?? `Player ${index >= 0 ? index + 1 : ''}`.trim(),
    gender: s?.gender ?? 'nonbinary',
    preference: s?.preference ?? 'both',
    genres: s?.genres ?? [],
    boundaries: s?.boundaries ?? { neverGenres: [], neverCardIds: [] },
  };
}

export function lobbyView(room: Room, ctx: EngineCtx) {
  const players = activePlayers(room);
  const infos = players.map((p) => playerInfo(room, p, ctx));
  const neverGenres = [...new Set(infos.flatMap((i) => i.boundaries.neverGenres))];
  const neverCardIds = [...new Set(infos.flatMap((i) => i.boundaries.neverCardIds))];
  const resolvedTrack = resolveTrack(infos);
  const effectiveTrack = resolvedTrack ?? room.runtime.manualTrack;
  const available = availableGenres({
    playerGenres: infos.map((i) => i.genres),
    playerCount: players.length,
    neverGenres,
  });
  const deck =
    effectiveTrack === null
      ? []
      : filterDeck(ctx.cards.all, {
          track: effectiveTrack,
          genres: room.genres,
          playerCount: players.length,
          maxIntensity: room.intensity,
          neverGenres,
          neverCardIds,
        });
  return { players, infos, neverGenres, neverCardIds, resolvedTrack, effectiveTrack, available, deck };
}

export function blockers(room: Room, ctx: EngineCtx): string[] {
  const v = lobbyView(room, ctx);
  const out: string[] = [];
  if (v.players.length < 2) out.push('needPlayers');
  if (v.players.length >= 2 && v.effectiveTrack === null) out.push('noTrack');
  if (v.players.length >= 2 && v.available.length === 0) out.push('noCommonGenres');
  else if (room.genres.length === 0) out.push('pickGenres');
  if (out.length === 0 && v.deck.length === 0) out.push('emptyDeck');
  return out;
}

/** Keep room genres inside the allowed set; default to "all available" until the host edits. */
export function syncGenres(room: Room, ctx: EngineCtx): void {
  const { available } = lobbyView(room, ctx);
  room.genres = room.genresTouched ? room.genres.filter((g) => available.includes(g)) : available;
}

function pauseTimer(room: Room, now: number): void {
  const t = room.runtime.active?.timer;
  if (t && t.status === 'running' && t.startedAt !== null) {
    t.remainingMs = Math.max(0, t.remainingMs - (now - t.startedAt));
    t.status = 'paused';
    t.startedAt = null;
  }
}

function runTimer(room: Room, now: number): void {
  const t = room.runtime.active?.timer;
  if (t && t.status !== 'running' && t.remainingMs > 0) {
    t.status = 'running';
    t.startedAt = now;
  }
}

function isTimerRunning(room: Room): boolean {
  return room.runtime.active?.timer?.status === 'running';
}

function requireState(room: Room, ...states: RoomState[]): void {
  if (!states.includes(room.state)) throw new EngineError('BAD_STATE');
}

function requireHost(room: Room, actorId: string): void {
  if (room.hostPlayerId !== actorId) throw new EngineError('HOST_ONLY');
}

function cardOf(ctx: EngineCtx, id: string): Card {
  const c = ctx.cards.byId.get(id);
  if (!c) throw new EngineError('CARD_MISSING');
  return c;
}

function advanceTurn(room: Room, ctx: EngineCtx): void {
  const players = eligiblePlayers(room);
  if (players.length === 0) {
    room.runtime.currentPlayerId = null;
    return;
  }
  const current = players.findIndex((p) => p.id === room.runtime.currentPlayerId);
  if (room.turnMode === 'alternate') {
    room.runtime.currentPlayerId = (players[(current + 1) % players.length] as Player).id;
  } else if (room.turnMode === 'random') {
    const pool = players.length > 1 ? players.filter((p) => p.id !== room.runtime.currentPlayerId) : players;
    room.runtime.currentPlayerId = (pool[Math.floor(ctx.rng() * pool.length)] as Player).id;
  } else if (current < 0) {
    room.runtime.currentPlayerId = (players[0] as Player).id;
  }
}

function clearActive(room: Room): void {
  room.runtime.active = null;
  room.runtime.timerWasRunning = false;
}

function finishActive(room: Room, ctx: EngineCtx, status: 'done' | 'skipped', count: boolean): Card {
  const a = room.runtime.active;
  if (!a) throw new EngineError('NO_ACTIVE_CARD');
  const card = cardOf(ctx, a.cardId);
  const entry = room.deck.find((d) => d.cardId === a.cardId);
  if (entry) {
    entry.status = status;
    entry.completedAt = ctx.now;
  }
  if (count) {
    const s = room.runtime.stats;
    if (status === 'done') {
      s.completed += 1;
      s.byGenre[card.genre] = (s.byGenre[card.genre] ?? 0) + 1;
    } else {
      s.skipped += 1;
    }
  }
  clearActive(room);
  return card;
}

function dealEntry(room: Room, ctx: EngineCtx, entry: DeckEntry, drawnBy: string | null): boolean {
  const card = cardOf(ctx, entry.cardId);
  const assignment = assignRoles(
    card.roles,
    eligiblePlayers(room).map((p) => ({ id: p.id, rolePrefs: p.rolePrefs })),
    { activePlayerId: drawnBy, rng: ctx.rng },
  );
  if (!assignment) return false;
  entry.status = 'active';
  entry.assignedRoles = assignment;
  entry.startedAt = ctx.now;
  room.runtime.active = {
    cardId: card.id,
    assignment,
    revealed: card.roles.length === 0,
    drawnBy,
    timer: card.durationSeconds
      ? {
          durationMs: card.durationSeconds * 1000,
          status: 'idle',
          startedAt: null,
          remainingMs: card.durationSeconds * 1000,
        }
      : null,
  };
  room.runtime.dealSeq += 1;
  return true;
}

const unseen = (room: Room) =>
  room.deck.filter((d) => d.status === 'unseen').sort((a, b) => a.position - b.position);

/* ---------------------------------------------------------------- actions */

export function start(room: Room, ctx: EngineCtx, actorId: string): void {
  requireState(room, 'lobby');
  requireHost(room, actorId);
  if (blockers(room, ctx).length) throw new EngineError('NOT_READY');
  const v = lobbyView(room, ctx);
  room.track = v.effectiveTrack;
  room.deck = shuffle(v.deck, ctx.rng).map((c, i) => ({
    cardId: c.id,
    status: 'unseen',
    position: i,
    assignedRoles: null,
    startedAt: null,
    completedAt: null,
  }));
  room.runtime.stats = {
    completed: 0,
    skipped: 0,
    byGenre: {},
    startedAt: ctx.now,
    endedAt: null,
  };
  clearActive(room);
  room.runtime.currentPlayerId = null;
  advanceTurn(room, ctx);
  room.state = 'playing';
}

export function draw(room: Room, ctx: EngineCtx, actorId: string): void {
  requireState(room, 'playing');
  if (room.runtime.active) throw new EngineError('CARD_ACTIVE');
  if (
    room.mode === 'online' &&
    room.runtime.currentPlayerId &&
    actorId !== room.runtime.currentPlayerId &&
    actorId !== room.hostPlayerId
  ) {
    throw new EngineError('NOT_YOUR_TURN');
  }
  for (const entry of unseen(room)) {
    if (dealEntry(room, ctx, entry, room.runtime.currentPlayerId)) return;
  }
  throw new EngineError('DECK_EMPTY');
}

export function swap(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing');
  const a = room.runtime.active;
  if (!a) throw new EngineError('NO_ACTIVE_CARD');
  const genre = cardOf(ctx, a.cardId).genre;
  const candidates = unseen(room).filter((d) => cardOf(ctx, d.cardId).genre === genre);
  if (candidates.length === 0) throw new EngineError('NO_SWAP');
  const drawnBy = a.drawnBy;
  finishActive(room, ctx, 'skipped', false);
  for (const entry of candidates) {
    if (dealEntry(room, ctx, entry, drawnBy)) return;
  }
  throw new EngineError('NO_SWAP');
}

export function rolesSwap(room: Room, ctx: EngineCtx): void {
  const a = room.runtime.active;
  if (!a || a.revealed) throw new EngineError('BAD_STATE');
  a.assignment = rotateAssignment(cardOf(ctx, a.cardId).roles, a.assignment);
}

export function rolesConfirm(room: Room, ctx: EngineCtx, assignment?: RoleAssignment): void {
  requireState(room, 'playing');
  const a = room.runtime.active;
  if (!a || a.revealed) throw new EngineError('BAD_STATE');
  const card = cardOf(ctx, a.cardId);
  if (assignment) {
    const ids = eligiblePlayers(room).map((p) => p.id);
    if (!isValidAssignment(card.roles, assignment, ids)) throw new EngineError('BAD_ASSIGNMENT');
    a.assignment = assignment;
  }
  a.revealed = true;
  const entry = room.deck.find((d) => d.cardId === a.cardId);
  if (entry) entry.assignedRoles = a.assignment;
  if (room.runtime.timerMode === 'auto') runTimer(room, ctx.now);
}

export function startTimer(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing');
  const a = room.runtime.active;
  if (!a || !a.revealed || !a.timer) throw new EngineError('NO_TIMER');
  runTimer(room, ctx.now);
}

export function done(room: Room, ctx: EngineCtx): Card {
  requireState(room, 'playing', 'paused');
  const card = finishActive(room, ctx, 'done', true);
  if (room.state === 'paused') room.state = 'playing';
  advanceTurn(room, ctx);
  return card;
}

/** FR-16 Skip (unlimited, no penalty). Also "Skip card" from the Safe Signal screen. */
export function skip(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing', 'paused', 'stopped');
  finishActive(room, ctx, 'skipped', true);
  room.state = 'playing';
  room.runtime.prevState = null;
  advanceTurn(room, ctx);
}

/** FR-27 "Never" on the current card: remove it (counted as neither done nor skipped). */
export function never(room: Room, ctx: EngineCtx): string {
  requireState(room, 'playing', 'paused', 'stopped');
  const a = room.runtime.active;
  if (!a) throw new EngineError('NO_ACTIVE_CARD');
  const id = a.cardId;
  finishActive(room, ctx, 'skipped', false);
  room.deck = room.deck.filter((d) => d.cardId !== id);
  room.state = 'playing';
  room.runtime.prevState = null;
  advanceTurn(room, ctx);
  return id;
}

/** FR-9: deck reshuffles when empty, after a prompt. */
export function reshuffle(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing');
  if (unseen(room).length > 0 || room.runtime.active) throw new EngineError('DECK_NOT_EMPTY');
  const { neverCardIds } = lobbyView(room, ctx);
  const ids = shuffle(
    room.deck.map((d) => d.cardId).filter((id) => !neverCardIds.includes(id)),
    ctx.rng,
  );
  room.deck = ids.map((cardId, i) => ({
    cardId,
    status: 'unseen',
    position: i,
    assignedRoles: null,
    startedAt: null,
    completedAt: null,
  }));
}

export function pause(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing');
  room.runtime.timerWasRunning = isTimerRunning(room);
  pauseTimer(room, ctx.now);
  room.state = 'paused';
}

export function resume(room: Room, ctx: EngineCtx): void {
  requireState(room, 'paused', 'stopped');
  room.state = 'playing';
  room.runtime.prevState = null;
  if (room.runtime.timerWasRunning) runTimer(room, ctx.now);
  room.runtime.timerWasRunning = false;
}

/** FR-25 Safe Signal: anyone, any time during play. Never counted against anyone (FR-26). */
export function stop(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing', 'paused', 'stopped');
  if (room.state === 'stopped') return;
  if (room.state === 'playing') room.runtime.timerWasRunning = isTimerRunning(room);
  room.runtime.prevState = room.state as 'playing' | 'paused';
  pauseTimer(room, ctx.now);
  room.state = 'stopped';
}

export function end(room: Room, ctx: EngineCtx): void {
  requireState(room, 'playing', 'paused', 'stopped');
  pauseTimer(room, ctx.now);
  const a = room.runtime.active;
  if (a) {
    const entry = room.deck.find((d) => d.cardId === a.cardId);
    if (entry) entry.status = 'unseen';
  }
  clearActive(room);
  room.runtime.stats.endedAt = ctx.now;
  room.runtime.prevState = null;
  room.state = 'ended';
}

export function playAgain(room: Room, ctx: EngineCtx, actorId: string): void {
  requireState(room, 'ended');
  requireHost(room, actorId);
  room.deck = [];
  clearActive(room);
  room.runtime.currentPlayerId = null;
  room.state = 'lobby';
  syncGenres(room, ctx);
}

export function setGenres(room: Room, ctx: EngineCtx, actorId: string, genres: Genre[]): void {
  requireState(room, 'lobby');
  requireHost(room, actorId);
  const { available } = lobbyView(room, ctx);
  room.genres = available.filter((g) => genres.includes(g));
  room.genresTouched = true;
}

export function setOptions(
  room: Room,
  actorId: string,
  opts: {
    intensity?: Intensity | null;
    turnMode?: TurnMode;
    timerMode?: 'manual' | 'auto';
    pauseOnAway?: boolean;
  },
): void {
  requireHost(room, actorId);
  if (opts.pauseOnAway !== undefined) room.runtime.pauseOnAway = opts.pauseOnAway;
  const lobbyOnly = opts.intensity !== undefined || opts.turnMode || opts.timerMode;
  if (lobbyOnly) requireState(room, 'lobby');
  if (opts.intensity !== undefined) room.intensity = opts.intensity;
  if (opts.turnMode) room.turnMode = opts.turnMode;
  if (opts.timerMode) room.runtime.timerMode = opts.timerMode;
}

export function setRolePrefs(room: Room, actorId: string, playerId: string, prefs: RolePrefs): void {
  const target = activePlayers(room).find((p) => p.id === playerId);
  if (!target) throw new EngineError('NO_PLAYER');
  const allowed = playerId === actorId || (target.local !== null && actorId === room.hostPlayerId);
  if (!allowed) throw new EngineError('FORBIDDEN');
  target.rolePrefs = prefs;
}

/** Section 5.1 fallback: pick a track manually only if all players confirm. */
export function proposeTrack(room: Room, ctx: EngineCtx, actorId: string, track: string): void {
  requireState(room, 'lobby');
  requireHost(room, actorId);
  if (!TRACK_RULES.some((r) => r.track === track)) throw new EngineError('BAD_TRACK');
  if (lobbyView(room, ctx).resolvedTrack !== null) throw new EngineError('TRACK_RESOLVED');
  room.runtime.trackProposal = { track, confirmedBy: [actorId] };
  // Same-device: everyone confirms together on the shared screen.
  if (room.mode === 'pass_and_play') {
    room.runtime.manualTrack = track;
    room.runtime.trackProposal = null;
  } else {
    checkTrackConfirmed(room);
  }
}

export function confirmTrack(room: Room, actorId: string): void {
  requireState(room, 'lobby');
  const p = room.runtime.trackProposal;
  if (!p) throw new EngineError('NO_PROPOSAL');
  if (!p.confirmedBy.includes(actorId)) p.confirmedBy.push(actorId);
  checkTrackConfirmed(room);
}

function checkTrackConfirmed(room: Room): void {
  const p = room.runtime.trackProposal;
  if (!p) return;
  if (activePlayers(room).every((pl) => p.confirmedBy.includes(pl.id))) {
    room.runtime.manualTrack = p.track;
    room.runtime.trackProposal = null;
  }
}

/** Any change in who is playing invalidates a manual track agreement. */
function resetTrackAgreement(room: Room): void {
  room.runtime.manualTrack = null;
  room.runtime.trackProposal = null;
}

export function addLocal(room: Room, ctx: EngineCtx, actorId: string, id: string, local: LocalProfile): void {
  if (room.mode !== 'pass_and_play') throw new EngineError('BAD_MODE');
  requireState(room, 'lobby');
  requireHost(room, actorId);
  if (activePlayers(room).length >= MAX_ROOM_PLAYERS) throw new EngineError('ROOM_FULL');
  room.players.push({ ...newPlayer(id, null, ctx.now, local), connected: true });
  resetTrackAgreement(room);
  syncGenres(room, ctx);
}

export function updateLocal(room: Room, ctx: EngineCtx, actorId: string, id: string, local: LocalProfile): void {
  requireState(room, 'lobby');
  requireHost(room, actorId);
  const p = activePlayers(room).find((pl) => pl.id === id && pl.local);
  if (!p) throw new EngineError('NO_PLAYER');
  p.local = local;
  resetTrackAgreement(room);
  syncGenres(room, ctx);
}

export function removeLocal(room: Room, ctx: EngineCtx, actorId: string, id: string): void {
  requireState(room, 'lobby');
  requireHost(room, actorId);
  const p = activePlayers(room).find((pl) => pl.id === id && pl.local);
  if (!p) throw new EngineError('NO_PLAYER');
  room.players = room.players.filter((pl) => pl.id !== id);
  resetTrackAgreement(room);
  syncGenres(room, ctx);
}

export function setTurn(room: Room, actorId: string, playerId: string): void {
  requireHost(room, actorId);
  if (room.turnMode !== 'host') throw new EngineError('BAD_MODE');
  if (!eligiblePlayers(room).some((p) => p.id === playerId)) throw new EngineError('NO_PLAYER');
  room.runtime.currentPlayerId = playerId;
}

/** Online join (FR-19/20). Returns the player (new or existing). */
export function join(room: Room, ctx: EngineCtx, sessionId: string, newId: string): Player {
  if (room.mode !== 'online') throw new EngineError('NOT_FOUND');
  if (room.runtime.kickedSessions.includes(sessionId)) throw new EngineError('KICKED');
  const existing = room.players.find((p) => p.sessionId === sessionId);
  if (existing && existing.leftAt === null) return existing;
  if (room.state !== 'lobby') throw new EngineError('IN_PROGRESS');
  if (activePlayers(room).length >= MAX_ROOM_PLAYERS) throw new EngineError('ROOM_FULL');
  let player: Player;
  if (existing) {
    existing.leftAt = null;
    existing.joinedAt = ctx.now;
    player = existing;
  } else {
    player = newPlayer(newId, sessionId, ctx.now);
    room.players.push(player);
  }
  resetTrackAgreement(room);
  syncGenres(room, ctx);
  return player;
}

/**
 * FR-23: leave/kick. Host passes to the longest-present player. Returns false when the room has
 * no remaining human (session) players and should be ended.
 */
export function removePlayer(room: Room, ctx: EngineCtx, playerId: string, kicked = false): boolean {
  const p = room.players.find((pl) => pl.id === playerId);
  if (!p || p.leftAt !== null) return activePlayers(room).some((pl) => pl.sessionId);
  p.leftAt = ctx.now;
  p.connected = false;
  if (kicked && p.sessionId) room.runtime.kickedSessions.push(p.sessionId);
  if (room.mode === 'pass_and_play' && p.sessionId) {
    // the owning device left: local players go too
    for (const pl of room.players) if (pl.local && pl.leftAt === null) pl.leftAt = ctx.now;
  }
  const remaining = activePlayers(room);
  if (room.hostPlayerId === playerId) {
    room.hostPlayerId = remaining.find((pl) => pl.sessionId)?.id ?? null;
  }
  resetTrackAgreement(room);
  const a = room.runtime.active;
  if (a && Object.values(a.assignment).includes(playerId)) {
    const entry = room.deck.find((d) => d.cardId === a.cardId);
    if (entry) entry.status = 'unseen';
    clearActive(room);
  }
  if (room.runtime.currentPlayerId === playerId) advanceTurn(room, ctx);
  if (room.state === 'lobby') syncGenres(room, ctx);
  else if (remaining.length < 2 && room.state === 'playing') pause(room, ctx);
  return remaining.some((pl) => pl.sessionId);
}

export function kick(room: Room, ctx: EngineCtx, actorId: string, playerId: string): boolean {
  requireHost(room, actorId);
  if (playerId === actorId) throw new EngineError('FORBIDDEN');
  const target = activePlayers(room).find((p) => p.id === playerId);
  if (!target || !target.sessionId) throw new EngineError('NO_PLAYER');
  return removePlayer(room, ctx, playerId, true);
}

/** Section 7.6: called after the reconnect grace period expires. */
export function markAway(room: Room, ctx: EngineCtx, playerId: string): void {
  const p = activePlayers(room).find((pl) => pl.id === playerId);
  if (!p || p.connected) return;
  p.away = true;
  if (room.runtime.currentPlayerId === playerId) advanceTurn(room, ctx);
  if (room.runtime.pauseOnAway && room.state === 'playing') pause(room, ctx);
}

/* --------------------------------------------------------------- snapshot */

export function snapshot(room: Room, ctx: EngineCtx, viewerSessionId: string | null): RoomSnapshot {
  const v = lobbyView(room, ctx);
  const you = v.players.find((p) => p.sessionId === viewerSessionId) ?? null;
  const names: Record<string, string> = {};
  v.players.forEach((p, i) => (names[p.id] = (v.infos[i] as PlayerInfo).name));
  // Also keep names of departed players referenced by a past assignment.
  for (const p of room.players) if (!(p.id in names)) names[p.id] = playerInfo(room, p, ctx).name;

  const a = room.runtime.active;
  const card = a ? ctx.cards.byId.get(a.cardId) : undefined;
  const viewer = viewerSessionId ? ctx.session(viewerSessionId) : undefined;
  const remaining = room.deck.filter((d) => d.status === 'unseen').length;

  return {
    code: room.code,
    mode: room.mode,
    state: room.state,
    youId: you?.id ?? null,
    isHost: !!you && you.id === room.hostPlayerId,
    players: v.players.map((p, i) => {
      const info = v.infos[i] as PlayerInfo;
      return {
        id: p.id,
        name: info.name,
        isHost: p.id === room.hostPlayerId,
        isYou: p.id === you?.id,
        local: p.local !== null,
        connected: p.local !== null || p.connected,
        away: p.away,
        gender: info.gender,
        preference: info.preference,
        rolePrefs: p.rolePrefs,
      };
    }),
    maxPlayers: room.genres.every((g) => ['erotic', 'oral', 'anal', 'master_slave'].includes(g)) &&
      room.genres.length > 0
      ? COUPLE_MAX_PLAYERS
      : MAX_ROOM_PLAYERS,
    track: room.state === 'lobby' ? v.effectiveTrack : room.track,
    resolvedTrack: v.resolvedTrack,
    trackProposal: room.runtime.trackProposal,
    knownTracks: TRACK_RULES.map((r) => ({ track: r.track, label: r.label })),
    availableGenres: v.available,
    genres: room.genres,
    intensity: room.intensity,
    intensityAvailable: deckHasIntensity(ctx.cards.all),
    turnMode: room.turnMode,
    timerMode: room.runtime.timerMode,
    pauseOnAway: room.runtime.pauseOnAway,
    currentPlayerId: room.runtime.currentPlayerId,
    active:
      a && card
        ? {
            cardId: a.cardId,
            genre: card.genre,
            roles: card.roles,
            assignment: a.assignment,
            revealed: a.revealed,
            title: a.revealed ? card.title : null,
            text: a.revealed ? renderCardText(card.text, a.assignment, names) : null,
            intensity: card.intensity ?? null,
            timer: a.timer ? { ...a.timer } : null,
            drawnBy: a.drawnBy,
            dealSeq: room.runtime.dealSeq,
          }
        : null,
    deck: {
      total: room.deck.length,
      remaining,
      empty: room.state === 'playing' && !a && remaining === 0,
    },
    stats: { ...room.runtime.stats, byGenre: { ...room.runtime.stats.byGenre } },
    serverNow: ctx.now,
    showResponsibleNote: !!viewer && !viewer.seenNote,
    blockers: room.state === 'lobby' ? blockers(room, ctx) : [],
  };
}
