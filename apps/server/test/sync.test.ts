import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { RoomSnapshot } from '@nc/shared';
import { adult, cookieFrom, H, HN, makeApp } from './helpers';
import { roomPlayers } from '../src/db/schema';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function register(body = adult()) {
  const res = await t.app.inject({ method: 'POST', url: '/api/register', headers: H, payload: body });
  return cookieFrom(res, 'nc_session') as string;
}

function client(sid: string, tab = randomUUID().replace(/-/g, '')) {
  const cookies = { nc_session: sid };
  return {
    tab,
    connect: (code: string) =>
      t.app.inject({ method: 'POST', url: `/api/rooms/${code}/connect`, headers: H, cookies, payload: { tabId: tab } }),
    poll: (code: string) =>
      t.app.inject({ method: 'GET', url: `/api/rooms/${code}`, headers: { 'x-nc-tab': tab }, cookies }),
    act: (code: string, event: string, payload: Record<string, unknown> = {}, actionId = randomUUID()) =>
      t.app.inject({
        method: 'POST',
        url: `/api/rooms/${code}/actions`,
        headers: { ...H, 'x-nc-tab': tab },
        cookies,
        payload: { event, payload: { actionId, ...payload } },
      }),
  };
}

const snap = (res: { json(): unknown }) => res.json() as RoomSnapshot;
const actSnap = (res: { json(): unknown }) => (res.json() as { snapshot: RoomSnapshot }).snapshot;

async function twoPlayerRoom() {
  const a = await register();
  const b = await register(adult({ displayName: 'Ari', preference: 'both' }));
  const created = await t.app.inject({ method: 'POST', url: '/api/rooms', headers: H, cookies: { nc_session: a }, payload: { mode: 'online' } });
  const { code } = created.json() as { code: string };
  await t.app.inject({ method: 'POST', url: '/api/rooms/join', headers: H, cookies: { nc_session: b }, payload: { code } });
  const ca = client(a);
  const cb = client(b);
  expect((await ca.connect(code)).statusCode).toBe(200);
  expect((await cb.connect(code)).statusCode).toBe(200);
  const lobby = snap(await ca.poll(code));
  expect(lobby.blockers).toEqual([]); // the joiner's genres count immediately
  return { a, b, ca, cb, code };
}

describe('room sync over HTTP polling', () => {
  it('requires a session and membership', async () => {
    const { code } = await twoPlayerRoom();
    const anon = await t.app.inject({ method: 'GET', url: `/api/rooms/${code}`, headers: { 'x-nc-tab': 'abcdefgh12' } });
    expect(anon.statusCode).toBe(401);
    const outsider = client(await register());
    const res = await outsider.connect(code);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_MEMBER' });
  });

  it('two players see the same card; one draw wins; Stop reaches everyone; actions are idempotent', async () => {
    const { ca, cb, code } = await twoPlayerRoom();

    expect((await cb.act(code, 'room:start')).json()).toEqual({ error: 'HOST_ONLY' });
    const started = actSnap(await ca.act(code, 'room:start'));
    expect(started.state).toBe('playing');
    const drawer = started.currentPlayerId === started.youId ? ca : cb;

    // Two simultaneous draws produce exactly one card (row lock = single writer).
    const [d1, d2] = await Promise.all([drawer.act(code, 'card:draw'), drawer.act(code, 'card:draw')]);
    expect([d1.statusCode, d2.statusCode].sort()).toEqual([200, 409]);

    // Card text stays hidden until roles are confirmed.
    const before = snap(await cb.poll(code));
    expect(before.active?.cardId).toBeTruthy();
    expect(before.active?.text).toBeNull();

    expect((await cb.act(code, 'roles:confirm')).statusCode).toBe(200);
    const [pa, pb] = [snap(await ca.poll(code)), snap(await cb.poll(code))];
    expect(pa.active?.cardId).toBe(pb.active?.cardId);
    expect(pa.active?.text).toBeTruthy();

    // Stop from either device stops everyone.
    await cb.act(code, 'game:stop');
    expect(snap(await ca.poll(code)).state).toBe('stopped');

    // The same actionId twice is applied once (no NO_ACTIVE_CARD error on the retry).
    await ca.act(code, 'game:resume');
    const id = randomUUID();
    const first = await ca.act(code, 'card:done', {}, id);
    const retry = await ca.act(code, 'card:done', {}, id);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(actSnap(retry).stats.completed).toBe(1);
  });

  it('the latest tab wins; older tabs are told they were superseded', async () => {
    const { a, ca, code } = await twoPlayerRoom();
    const newer = client(a);
    expect((await newer.connect(code)).statusCode).toBe(200);
    const old = await ca.poll(code);
    expect(old.statusCode).toBe(409);
    expect(old.json()).toEqual({ error: 'SUPERSEDED' });
    expect((await ca.act(code, 'game:pause')).json()).toEqual({ error: 'SUPERSEDED' });
    expect((await newer.poll(code)).statusCode).toBe(200);
  });

  it('a player away for 2+ minutes pauses the game once (pause-on-away)', async () => {
    const { ca, cb, code } = await twoPlayerRoom();
    actSnap(await ca.act(code, 'room:start'));
    // Simulate B's device going silent 3 minutes ago.
    const me = snap(await cb.poll(code));
    await t.db
      .update(roomPlayers)
      .set({ lastSeenAt: new Date(Date.now() - 3 * 60_000), joinedAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(roomPlayers.id, me.youId as string));
    const seenByA = snap(await ca.poll(code));
    expect(seenByA.state).toBe('paused');
    expect(seenByA.players.find((p) => p.id === me.youId)?.away).toBe(true);
    // The host resumes; the same absence must not pause again.
    await ca.act(code, 'game:resume');
    expect(snap(await ca.poll(code)).state).toBe('playing');
    // B comes back: no longer away.
    expect(snap(await cb.poll(code)).players.find((p) => p.isYou)?.away).toBe(false);
  });

  it('kicked players get KICKED; deleted sessions get 401', async () => {
    const { b, ca, cb, code } = await twoPlayerRoom();
    const bId = snap(await cb.poll(code)).youId;
    expect((await ca.act(code, 'host:kick', { playerId: bId })).statusCode).toBe(200);
    expect((await cb.poll(code)).json()).toEqual({ error: 'KICKED' });
    await t.app.inject({ method: 'DELETE', url: '/api/me', headers: HN, cookies: { nc_session: b } });
    expect((await cb.poll(code)).statusCode).toBe(401);
  });

  it('pass and play: one device drives every local player', async () => {
    const a = await register();
    const created = await t.app.inject({ method: 'POST', url: '/api/rooms', headers: H, cookies: { nc_session: a }, payload: { mode: 'pass_and_play', solo: true } });
    const { code } = created.json() as { code: string };
    const ca = client(a);
    expect(snap(await ca.connect(code)).players).toHaveLength(2);
    expect(actSnap(await ca.act(code, 'room:start')).state).toBe('playing');
    const drawn = actSnap(await ca.act(code, 'card:draw'));
    expect(drawn.active).not.toBeNull();
  });
});
