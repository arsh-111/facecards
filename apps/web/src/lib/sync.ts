import { POLL_MS, type AckResponse, type RoomAction, type RoomSnapshot } from '@nc/shared';
import { api, ApiError } from './api';
import { useApp, type Conn } from '../store';

/**
 * Room sync over plain HTTPS (works on serverless hosts such as Vercel):
 * - the tab "connects" once (becoming the active tab for this player),
 * - then polls the authoritative snapshot (~1 s during play, slower in the lobby or background),
 * - every action returns the new snapshot immediately, so the actor sees it with no delay.
 */

let code: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let lastKey = '';
let failures = 0;

/** One id per page load; the most recently connected tab wins (Section 7.5). */
const tabId = (() => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
})();

const listeners = new Set<(event: string, payload: unknown) => void>();
export function onRoomEvent(fn: (event: string, payload: unknown) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (event: string, payload: unknown = {}) => listeners.forEach((fn) => fn(event, payload));

function newActionId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Apply a snapshot, skipping identical ones, and derive the old socket events from changes. */
function apply(next: RoomSnapshot): void {
  const app = useApp.getState();
  const prev = app.room;
  const { serverNow: _ignored, ...rest } = next;
  const key = JSON.stringify(rest);
  if (key !== lastKey || prev?.code !== next.code) {
    lastKey = key;
    app.setRoom(next);
    if (prev && prev.code === next.code) {
      if ((next.active?.dealSeq ?? 0) > (prev.active?.dealSeq ?? 0)) emit('card:dealt', {});
      if (next.state === 'stopped' && prev.state !== 'stopped') emit('game:stopped', {});
    }
  }
  if (app.conn !== 'online') app.setConn('online');
  failures = 0;
}

/** Map an API failure to a connection state. Returns true when polling should stop. */
function handleError(e: unknown): boolean {
  const app = useApp.getState();
  const err = e instanceof ApiError ? e.code : 'UNREACHABLE';
  const terminal: Record<string, Conn> = {
    NO_SESSION: 'expired',
    NOT_MEMBER: 'notMember',
    KICKED: 'kicked',
    NOT_FOUND: 'closed',
    SUPERSEDED: 'superseded',
  };
  const conn = terminal[err];
  if (conn) {
    app.setConn(conn);
    if (conn === 'expired') app.setMe(null);
    return true;
  }
  failures += 1;
  app.setConn('offline');
  return false;
}

function interval(): number {
  if (typeof document !== 'undefined' && document.hidden) return POLL_MS.background;
  const state = useApp.getState().room?.state;
  const base = state === 'lobby' || state === 'ended' ? POLL_MS.lobby : POLL_MS.playing;
  // Back off while the server is unreachable (max ~10 s).
  return failures ? Math.min(10_000, base * 2 ** Math.min(failures, 4)) : base;
}

function schedule(gen: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void poll(gen), interval());
}

async function poll(gen: number): Promise<void> {
  if (gen !== generation || !code) return;
  try {
    apply(await api.room(code, tabId));
  } catch (e) {
    if (gen !== generation) return;
    if (handleError(e)) return;
  }
  if (gen === generation) schedule(gen);
}

function onVisible(): void {
  if (!document.hidden && code) {
    if (timer) clearTimeout(timer);
    void poll(generation);
  }
}

/** Start syncing a room. Safe to call again (e.g. "Play here" after another tab took over). */
export function connectRoom(roomCode: string): void {
  const gen = ++generation;
  code = roomCode;
  lastKey = '';
  failures = 0;
  const app = useApp.getState();
  if (app.room?.code !== roomCode) app.setRoom(null);
  app.setConn('connecting');
  document.addEventListener('visibilitychange', onVisible);
  void (async () => {
    try {
      const snap = await api.connect(roomCode, tabId);
      if (gen !== generation) return;
      apply(snap);
      schedule(gen);
    } catch (e) {
      if (gen !== generation) return;
      if (!handleError(e)) schedule(gen); // transient: keep retrying through poll()
    }
  })();
}

export function rejoin(): void {
  if (code) connectRoom(code);
}

export function disconnectRoom(): void {
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  code = null;
  lastKey = '';
  document.removeEventListener('visibilitychange', onVisible);
  useApp.getState().setRoom(null);
  useApp.getState().setConn('idle');
}

/** Send a room action with a fresh idempotency key; applies the returned snapshot at once. */
export async function act(event: RoomAction, payload: Record<string, unknown> = {}): Promise<AckResponse> {
  if (!code) return { ok: false, error: 'OFFLINE' };
  try {
    const { snapshot } = await api.action(code, tabId, event, { actionId: newActionId(), ...payload });
    if (snapshot) apply(snapshot);
    return { ok: true };
  } catch (e) {
    const err = e instanceof ApiError ? e.code : 'UNREACHABLE';
    if (['NO_SESSION', 'NOT_MEMBER', 'KICKED', 'NOT_FOUND', 'SUPERSEDED'].includes(err)) handleError(e);
    return { ok: false, error: err };
  }
}
