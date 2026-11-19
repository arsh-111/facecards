import { io, type Socket } from 'socket.io-client';
import type { AckResponse, RoomSnapshot, WsEvent } from '@nc/shared';
import { useApp } from '../store';

let socket: Socket | null = null;
let roomCode: string | null = null;

function newActionId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const listeners = new Set<(event: string, payload: unknown) => void>();
export function onRoomEvent(fn: (event: string, payload: unknown) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function join(): void {
  if (!socket || !roomCode) return;
  socket.emit('room:join', { actionId: newActionId(), code: roomCode }, (r: AckResponse) => {
    if (!r.ok) useApp.getState().setConn(r.error === 'NOT_MEMBER' ? 'notMember' : 'offline');
  });
}

/** Connect to /play for a room. Socket.IO reconnects automatically and we re-join on connect. */
export function connectRoom(code: string): void {
  roomCode = code;
  const app = useApp.getState();
  if (socket) {
    join();
    return;
  }
  app.setConn('connecting');
  socket = io('/play', { withCredentials: true, transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    useApp.getState().setConn('online');
    join();
  });
  socket.on('disconnect', () => {
    const c = useApp.getState().conn;
    if (c === 'online' || c === 'connecting') useApp.getState().setConn('offline');
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'UNAUTHORIZED') {
      useApp.getState().setConn('expired');
      socket?.disconnect();
    } else useApp.getState().setConn('offline');
  });
  socket.on('room:state', (s: RoomSnapshot) => {
    useApp.getState().setRoom(s);
    if (useApp.getState().conn !== 'online') useApp.getState().setConn('online');
  });
  socket.on('room:superseded', () => useApp.getState().setConn('superseded'));
  socket.on('room:kicked', () => useApp.getState().setConn('kicked'));
  socket.on('room:closed', () => useApp.getState().setConn('closed'));
  socket.on('session:expired', () => {
    useApp.getState().setConn('expired');
    useApp.getState().setMe(null);
  });
  for (const ev of ['card:dealt', 'game:stopped', 'room:playerJoined', 'room:playerLeft']) {
    socket.on(ev, (p: unknown) => listeners.forEach((fn) => fn(ev, p)));
  }
}

export function rejoin(): void {
  useApp.getState().setConn('online');
  join();
}

export function disconnectRoom(): void {
  socket?.disconnect();
  socket = null;
  roomCode = null;
  useApp.getState().setRoom(null);
  useApp.getState().setConn('idle');
}

/** Emit a room action with a fresh idempotency key; resolves with the server ack. */
export function act(event: WsEvent, payload: Record<string, unknown> = {}): Promise<AckResponse> {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: 'OFFLINE' });
    const timer = setTimeout(() => resolve({ ok: false, error: 'TIMEOUT' }), 8000);
    socket.emit(event, { actionId: newActionId(), ...payload }, (r: AckResponse) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}
