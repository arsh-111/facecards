import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { hashToken } from '../src/sessions';
import { adult, cookieFrom, H, HN, makeApp } from './helpers';
import { runCleanup } from '../src/cleanup';
import { sessions } from '../src/db/schema';

let t: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function register(body = adult(), cookies: Record<string, string> = {}) {
  const res = await t.app.inject({ method: 'POST', url: '/api/register', headers: H, payload: body, cookies });
  return { res, sid: cookieFrom(res, 'nc_session'), client: cookieFrom(res, 'nc_client') };
}

describe('health and headers', () => {
  it('GET /healthz has no auth and no data', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("script-src 'self'");
  });
});

describe('registration and age gate (Section 7.4)', () => {
  it('requires the CSRF header on mutating requests', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/register', payload: adult() });
    expect(res.statusCode).toBe(403);
  });

  it('rejects foreign origins', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/register',
      headers: { ...H, origin: 'https://evil.example' },
      payload: adult(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('under 18: 403, no session row, block cookie set', async () => {
    const before = await t.db.select({ n: sql<number>`count(*)::int` }).from(sessions);
    const { res, sid } = await register(adult({ age: 17 }));
    expect(res.statusCode).toBe(403);
    expect(sid).toBeUndefined();
    expect(cookieFrom(res, 'nc_block')).toBe('1');
    const after = await t.db.select({ n: sql<number>`count(*)::int` }).from(sessions);
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('under 18 by date of birth is blocked too; a block cookie blocks retries', async () => {
    const dob = new Date(Date.now() - 10 * 365 * 24 * 3600_000).toISOString().slice(0, 10);
    const { res } = await register({ ...adult(), age: undefined, dob } as never);
    expect(res.statusCode).toBe(403);
    const retry = await register(adult(), { nc_block: '1' });
    expect(retry.res.statusCode).toBe(403);
  });

  it('adult registration creates a session; DB holds only the hash and an age band', async () => {
    const { res, sid } = await register();
    expect(res.statusCode).toBe(201);
    expect(sid).toBeTruthy();
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const rows = await t.db.select().from(sessions);
    const json = JSON.stringify(rows);
    expect(json).not.toContain(sid as string);
    expect(rows.every((r) => r.ageVerified && /^\d|45\+/.test(r.ageBand))).toBe(true);
    expect(Object.keys(rows[0] ?? {})).not.toEqual(expect.arrayContaining(['email', 'ip', 'age']));
  });

  it('validates input', async () => {
    const { res } = await register(adult({ genres: [] }));
    expect(res.statusCode).toBe(400);
    const bad = await register(adult({ gender: 'robot' }));
    expect(bad.res.statusCode).toBe(400);
  });

  it('rate limits registration to 10/hour per client token', async () => {
    const client = 'rate-limit-test-token';
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const { res } = await register(adult(), { nc_client: client });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('/api/me', () => {
  it('requires a session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });

  it('returns, updates and deletes the profile', async () => {
    const { sid } = await register();
    const cookies = { nc_session: sid as string };
    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies });
    expect(me.json().profile.displayName).toBe('Sam');
    const patched = await t.app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: H,
      cookies,
      payload: { displayName: 'Kai', settings: { sound: true } },
    });
    expect(patched.json().profile.displayName).toBe('Kai');
    expect(patched.json().profile.settings.sound).toBe(true);

    const del = await t.app.inject({ method: 'DELETE', url: '/api/me', headers: HN, cookies });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', cookies })).statusCode).toBe(401);
  });

  it('editing age below 18 ends the session (FR-3)', async () => {
    const { sid } = await register();
    const cookies = { nc_session: sid as string };
    const res = await t.app.inject({ method: 'PATCH', url: '/api/me', headers: H, cookies, payload: { age: 16 } });
    expect(res.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/me', cookies })).statusCode).toBe(401);
  });
});

describe('rooms over REST', () => {
  it('create, join, members-only state, leave', async () => {
    const a = await register();
    const b = await register(adult({ displayName: 'Ari', preference: 'both' }));
    const ca = { nc_session: a.sid as string };
    const cb = { nc_session: b.sid as string };
    const created = await t.app.inject({ method: 'POST', url: '/api/rooms', headers: H, cookies: ca, payload: { mode: 'online' } });
    expect(created.statusCode).toBe(200);
    const { code } = created.json();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    // non-member cannot read room state
    expect((await t.app.inject({ method: 'GET', url: `/api/rooms/${code}`, cookies: cb })).statusCode).toBe(404);
    // no session cannot read either
    expect((await t.app.inject({ method: 'GET', url: `/api/rooms/${code}` })).statusCode).toBe(401);

    const joined = await t.app.inject({ method: 'POST', url: '/api/rooms/join', headers: H, cookies: cb, payload: { code } });
    expect(joined.statusCode).toBe(200);
    const state = await t.app.inject({ method: 'GET', url: `/api/rooms/${code}`, cookies: cb });
    expect(state.json().players).toHaveLength(2);
    expect(state.json().track).toBe('gay');

    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies: cb });
    expect(me.json().currentRoom).toBe(code); // FR-4

    await t.app.inject({ method: 'POST', url: `/api/rooms/${code}/leave`, headers: HN, cookies: cb });
    expect((await t.app.inject({ method: 'GET', url: `/api/rooms/${code}`, cookies: cb })).statusCode).toBe(404);
  });

  it('wrong codes are rejected', async () => {
    const a = await register();
    const res = await t.app.inject({ method: 'POST', url: '/api/rooms/join', headers: H, cookies: { nc_session: a.sid as string }, payload: { code: 'ZZZZZZ' } });
    expect(res.statusCode).toBe(404);
  });

  it('delete-now leaves no rows for the session', async () => {
    const a = await register();
    const cookies = { nc_session: a.sid as string };
    await t.app.inject({ method: 'POST', url: '/api/rooms', headers: H, cookies, payload: { mode: 'pass_and_play', solo: true } });
    const [row] = await t.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(a.sid as string)));
    const id = row?.id as string;
    expect(id).toBeTruthy();
    await t.app.inject({ method: 'DELETE', url: '/api/me', headers: HN, cookies });
    const leftovers = await t.db.execute(
      sql`SELECT (SELECT count(*) FROM sessions WHERE id = ${id})::int + (SELECT count(*) FROM room_players WHERE session_id = ${id})::int + (SELECT count(*) FROM rooms WHERE host_session_id = ${id})::int AS n`,
    );
    expect((leftovers as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0);
  });
});

describe('expiry cleanup', () => {
  it('idle sessions are rejected and hard-deleted', async () => {
    const { sid } = await register();
    await t.db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 4 * 3600_000) });
    expect((await t.app.inject({ method: 'GET', url: '/api/me', cookies: { nc_session: sid as string } })).statusCode).toBe(401);
    const r = await runCleanup(t.deps);
    expect(r.sessions).toBeGreaterThanOrEqual(0);
    expect((await t.db.select().from(sessions)).length).toBe(0);
  });
});
