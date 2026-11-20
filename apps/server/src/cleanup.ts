import type { AppDeps } from './app';
import { deleteExpiredSessions } from './sessions';
import { hit, purgeRateLimits } from './rateLimit';

/** Section 7.3: hard-delete expired sessions, rooms and children. */
export async function runCleanup(deps: AppDeps, now = Date.now()) {
  const expired = await deleteExpiredSessions(deps.db, deps.cfg, now);
  const roomsDeleted = await deps.rooms.deleteExpiredRooms(now);
  await purgeRateLimits(deps.db, now);
  return { sessions: expired.length, rooms: roomsDeleted };
}

/**
 * Serverless-friendly trigger: runs the cleanup at most once per interval across all instances,
 * using a rate-limit row as the shared "last run" marker. Called from ordinary requests, because
 * serverless hosts have no long-running timer.
 */
export async function maybeCleanup(deps: AppDeps): Promise<void> {
  try {
    const due = await hit(deps.db, 'system', {
      name: 'cleanup',
      limit: 1,
      windowMs: deps.cfg.cleanupIntervalMs,
    });
    if (due) await runCleanup(deps);
  } catch (e) {
    deps.log.error({ err: (e as Error).name }, 'cleanup failed');
  }
}

/** In-process scheduler for long-running servers (every 10 minutes by default). */
export function startCleanupJob(deps: AppDeps): () => void {
  const tick = () => {
    const t0 = Date.now();
    runCleanup(deps)
      .then((r) => deps.log.info({ ...r, ms: Date.now() - t0 }, 'cleanup'))
      .catch((e: Error) => deps.log.error({ err: e.name }, 'cleanup failed'));
  };
  const timer = setInterval(tick, deps.cfg.cleanupIntervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
