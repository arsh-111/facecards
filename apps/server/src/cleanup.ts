import type { AppDeps } from './app';
import { deleteExpiredSessions } from './sessions';
import { purgeRateLimits } from './rateLimit';

/** Section 7.3: hard-delete expired sessions, rooms and children. */
export async function runCleanup(deps: AppDeps, now = Date.now()) {
  const expired = await deleteExpiredSessions(deps.db, deps.cfg, now);
  for (const id of expired) deps.realtime?.disconnectSession(id);
  await deps.rooms.sessionsExpired(expired);
  const roomsDeleted = await deps.rooms.deleteExpiredRooms(now);
  await purgeRateLimits(deps.db, now);
  return { sessions: expired.length, rooms: roomsDeleted };
}

/** In-process scheduler (every 10 minutes by default). */
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
