import { lt, sql } from 'drizzle-orm';
import type { DB } from './db/client';
import { rateLimits } from './db/schema';

export interface Bucket {
  name: string;
  limit: number;
  windowMs: number;
}

const HOUR = 60 * 60 * 1000;
/** Section 7.7 */
export const BUCKETS = {
  register: { name: 'register', limit: 10, windowMs: HOUR },
  join: { name: 'join', limit: 20, windowMs: HOUR },
  joinFail: { name: 'join_fail', limit: 10, windowMs: HOUR },
  blocked: { name: 'age_block', limit: 3, windowMs: 24 * HOUR },
  /** Replaces the old 20 msg/sec WebSocket limit: room actions per session. */
  actions: { name: 'actions', limit: 240, windowMs: 60 * 1000 },
} satisfies Record<string, Bucket>;

/** Atomically count a hit; returns true when the caller is still within the limit. */
export async function hit(db: DB, keyHash: string, bucket: Bucket, now = Date.now()): Promise<boolean> {
  const windowEnd = new Date(now + bucket.windowMs);
  const nowDate = new Date(now);
  const [row] = await db
    .insert(rateLimits)
    .values({ keyHash, bucket: bucket.name, count: 1, windowEnd })
    .onConflictDoUpdate({
      target: [rateLimits.keyHash, rateLimits.bucket],
      set: {
        count: sql`CASE WHEN ${rateLimits.windowEnd} < ${nowDate} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowEnd: sql`CASE WHEN ${rateLimits.windowEnd} < ${nowDate} THEN ${windowEnd} ELSE ${rateLimits.windowEnd} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= bucket.limit;
}

/** Peek without counting. */
export async function isLimited(db: DB, keyHash: string, bucket: Bucket, now = Date.now()) {
  const rows = await db
    .select()
    .from(rateLimits)
    .where(sql`${rateLimits.keyHash} = ${keyHash} AND ${rateLimits.bucket} = ${bucket.name}`)
    .limit(1);
  const r = rows[0];
  return !!r && r.windowEnd.getTime() > now && r.count >= bucket.limit;
}

export async function purgeRateLimits(db: DB, now = Date.now()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowEnd, new Date(now)));
}
