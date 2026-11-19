import { sql } from 'drizzle-orm';
import type { DB } from './db/client';
import { metricsCounters } from './db/schema';

/**
 * Section 13: anonymous aggregate daily counters. No identifiers, no content. Failures are
 * swallowed: metrics must never break gameplay.
 */
export function createMetrics(db: DB) {
  return {
    async inc(key: string, by = 1): Promise<void> {
      const day = new Date().toISOString().slice(0, 10);
      try {
        await db
          .insert(metricsCounters)
          .values({ key, day, count: by })
          .onConflictDoUpdate({
            target: [metricsCounters.key, metricsCounters.day],
            set: { count: sql`${metricsCounters.count} + ${by}` },
          });
      } catch {
        /* ignore */
      }
    },
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
