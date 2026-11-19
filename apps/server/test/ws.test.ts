import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { AckResponse, RoomSnapshot } from '@nc/shared';
import { adult, cookieFrom, H, HN, makeApp } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let base = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await makeApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await t.close();
});

async function register(body = adult()) {
  const res = await t.app.inject({ method: 'POST', url: '/api/register', headers: H, payload: body });
  return cookieFrom(res, 'nc_session') as string;
}

function connect(sid?: string): Socket {
  const s = ioc(`${base}/play`, {
    transports: ['websocket'],
    extraHeaders: sid ? { cookie: `nc_session=${sid}` } : {},
    reconnection: false,
  });
  sockets.push(s);
  return s;
}

const emit = (s: Socket, ev: string, payload: Record<string, unknown> = {}) =>
  new Promise<AckResponse>((resolve) => s.emit(ev, { actionId: randomUUID(), ...payload }, resolve));

function nextState(s: Socket, pred: (st: RoomSnapshot) => boolean = () => true) {
  return new Promise<RoomSnapshot>((resolve) => {
    const h = (st: RoomSnapshot) => {
      if (pred(st)) {
        s.off('room:state', h);
        resolve(st);
      }
    };
    s.on('room:state', h);
  });
}

describe('websocket /play', () => {
  it('rejects the handshake without a valid session', async () => {
    const s = connect();
    const err = await new Promise<Error>((r) => s.on('connect_error', r));
    expect(err.message).toBe('UNAUTHORIZED');
  });

  it('two players see the same card; Stop pauses everyone; actions are idempotent', async () => {
    const a = await register();
    const b = await register(adult({ displayName: 'Ari', preference: 'both' }));
    const created = await t.app.inject({ method: 'POST', url: '/api/rooms', headers: H, cookies: { nc_session: a }, payload: { mode: 'online' } });
    const { code } = created.json();
    await t.app.inject({ method: 'POST', url: '/api/rooms/join', headers: H, cookies: { nc_session: b }, payload: { code } });

    const sa = connect(a);
    const sb = connect(b);
    // A socket for a room it is not a member of is refused.
    expect((await emit(sa, 'room:join', { code: 'ZZZZZZ' })).ok).toBe(false);

    const firstA = nextState(sa);
    expect((await emit(sa, 'room:join', { code })).ok).toBe(true);
    expect((await firstA).players).toHaveLength(2);
    expect((await emit(sb, 'room:join', { code })).ok).toBe(true);

    // guest cannot start
    expect((await emit(sb, 'room:start')).error).toBe('HOST_ONLY');
    const playingB = nextState(sb, (st) => st.state === 'playing');
    expect((await emit(sa, 'room:start')).ok).toBe(true);
    const st = await playingB;
    const drawer = st.currentPlayerId === st.youId ? sb : sa;

    // two simultaneous draws produce one card
    const dealtB = nextState(sb, (x) => !!x.active);
    const [d1, d2] = await Promise.all([emit(drawer, 'card:draw'), emit(drawer, 'card:draw')]);
    expect([d1.ok, d2.ok].filter(Boolean)).toHaveLength(1);
    const dealt = await dealtB;
    expect(dealt.active?.text).toBeNull(); // hidden until roles confirmed

    const revealedA = nextState(sa, (x) => !!x.active?.revealed);
    const revealedB = nextState(sb, (x) => !!x.active?.revealed);
    expect((await emit(sb, 'roles:confirm')).ok).toBe(true);
    const [ra, rb] = await Promise.all([revealedA, revealedB]);
    expect(ra.active?.cardId).toBe(rb.active?.cardId);
    expect(ra.active?.text).toBeTruthy();

    // Stop from either device stops everyone
    const stoppedA = nextState(sa, (x) => x.state === 'stopped');
    const stoppedEvt = new Promise((r) => sa.once('game:stopped', r));
    expect((await emit(sb, 'game:stop')).ok).toBe(true);
    await Promise.all([stoppedA, stoppedEvt]);

    // idempotency: the same actionId twice applies once
    const actionId = randomUUID();
    const r1 = await new Promise<AckResponse>((r) => sa.emit('game:resume', { actionId }, r));
    const r2 = await new Promise<AckResponse>((r) => sa.emit('game:resume', { actionId }, r));
    expect(r1.ok && r2.ok).toBe(true);

    // latest tab wins
    const sa2 = connect(a);
    const superseded = new Promise((r) => sa.once('room:superseded', r));
    await emit(sa2, 'room:join', { code });
    await superseded;
    expect((await emit(sa, 'game:pause')).ok).toBe(false);

    // deleting the session disconnects its socket
    const expired = new Promise((r) => sb.once('session:expired', r));
    await t.app.inject({ method: 'DELETE', url: '/api/me', headers: HN, cookies: { nc_session: b } });
    await expired;
  });
});
