import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, or } from 'drizzle-orm';
import {
  DEFAULT_BOUNDARIES,
  DEFAULT_SETTINGS,
  type Boundaries,
  type Genre,
  type Profile,
  type Settings,
} from '@nc/shared';
import type { DB } from './db/client';
import { sessions } from './db/schema';
import type { Config } from './config';

export type SessionRow = typeof sessions.$inferSelect;

export const TOUCH_INTERVAL_MS = 60 * 1000;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type ExpiryState = 'ok' | 'idle' | 'absolute';

/** Section 7.3: idle timeout since last_seen_at, absolute lifetime since created_at. */
export function sessionExpiryState(
  row: Pick<SessionRow, 'createdAt' | 'lastSeenAt' | 'expiresAt'>,
  now: number,
  cfg: Pick<Config, 'idleMs' | 'absoluteMs'>,
): ExpiryState {
  if (now >= row.expiresAt.getTime() || now - row.createdAt.getTime() >= cfg.absoluteMs) {
    return 'absolute';
  }
  if (now - row.lastSeenAt.getTime() >= cfg.idleMs) return 'idle';
  return 'ok';
}

export function shouldTouch(row: Pick<SessionRow, 'lastSeenAt'>, now: number): boolean {
  return now - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}

export function toProfile(row: SessionRow): Profile {
  return {
    gender: row.gender as Profile['gender'],
    preference: row.preference as Profile['preference'],
    genres: row.genres as Genre[],
    displayName: row.displayName,
    ageBand: row.ageBand,
    settings: { ...DEFAULT_SETTINGS, ...row.settings },
    boundaries: { ...DEFAULT_BOUNDARIES, ...row.boundaries },
  };
}

export interface NewSessionInput {
  ageBand: string;
  gender: string;
  preference: string;
  genres: Genre[];
  displayName: string | null;
  settings?: Settings;
  boundaries?: Boundaries;
}

export async function createSession(
  db: DB,
  input: NewSessionInput,
  cfg: Pick<Config, 'absoluteMs'>,
  now = Date.now(),
): Promise<{ token: string; row: SessionRow }> {
  const token = newToken();
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      ageVerified: true, // only created after the server-side age gate passes
      ageBand: input.ageBand,
      gender: input.gender,
      preference: input.preference,
      genres: input.genres,
      displayName: input.displayName,
      settings: input.settings ?? DEFAULT_SETTINGS,
      boundaries: input.boundaries ?? DEFAULT_BOUNDARIES,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + cfg.absoluteMs),
    })
    .returning();
  if (!row) throw new Error('session insert failed');
  return { token, row };
}

/**
 * Resolve a raw cookie token to a live session. Expired sessions are hard-deleted and null is
 * returned. `last_seen_at` is refreshed at most once per minute.
 */
export async function findSessionByToken(
  db: DB,
  token: string | undefined,
  cfg: Pick<Config, 'idleMs' | 'absoluteMs'>,
  now = Date.now(),
): Promise<SessionRow | null> {
  if (!token || token.length > 128) return null;
  const hash = hashToken(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, hash)).limit(1);
  if (!row || !safeEqualHex(row.tokenHash, hash)) return null;
  return validateRow(db, row, cfg, now);
}

export async function findSessionById(
  db: DB,
  id: string,
  cfg: Pick<Config, 'idleMs' | 'absoluteMs'>,
  now = Date.now(),
  touch = true,
): Promise<SessionRow | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  return validateRow(db, row, cfg, now, touch);
}

async function validateRow(
  db: DB,
  row: SessionRow,
  cfg: Pick<Config, 'idleMs' | 'absoluteMs'>,
  now: number,
  touch = true,
): Promise<SessionRow | null> {
  if (sessionExpiryState(row, now, cfg) !== 'ok') {
    await db.delete(sessions).where(eq(sessions.id, row.id));
    return null;
  }
  if (touch && shouldTouch(row, now)) {
    const lastSeenAt = new Date(now);
    await db.update(sessions).set({ lastSeenAt }).where(eq(sessions.id, row.id));
    return { ...row, lastSeenAt };
  }
  return row;
}

export async function deleteExpiredSessions(
  db: DB,
  cfg: Pick<Config, 'idleMs' | 'absoluteMs'>,
  now = Date.now(),
): Promise<string[]> {
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, new Date(now)),
        lt(sessions.createdAt, new Date(now - cfg.absoluteMs)),
        lt(sessions.lastSeenAt, new Date(now - cfg.idleMs)),
      ),
    )
    .returning({ id: sessions.id });
  return deleted.map((d) => d.id);
}

export async function deleteSession(db: DB, id: string): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.id, id)));
}
