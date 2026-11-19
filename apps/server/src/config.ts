export interface Config {
  env: string;
  isProd: boolean;
  port: number;
  databaseUrl: string | null;
  databaseSsl: boolean;
  databasePoolMax: number;
  pgliteDir: string | null;
  redisUrl: string | null;
  redisAdapter: boolean;
  hashSecret: string;
  allowedOrigins: string[];
  idleMs: number;
  absoluteMs: number;
  roomIdleMs: number;
  cleanupIntervalMs: number;
  cardsPath: string | null;
  sessionCookie: string;
}

const HOUR = 60 * 60 * 1000;

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  if (isProd && !databaseUrl) throw new Error('DATABASE_URL is required in production');

  const hashSecret = env.SESSION_HASH_SECRET?.trim() || '';
  if (isProd && hashSecret.length < 32) {
    throw new Error('SESSION_HASH_SECRET must be at least 32 characters in production');
  }

  const origins = (env.ALLOWED_ORIGIN || env.RENDER_EXTERNAL_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (!isProd) {
    origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
    const port = env.PORT ?? '3000';
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  if (isProd && origins.length === 0) {
    throw new Error('ALLOWED_ORIGIN is required in production');
  }

  return {
    env: nodeEnv,
    isProd,
    port: num(env.PORT, 3000),
    databaseUrl,
    databaseSsl: env.DATABASE_SSL === '1',
    databasePoolMax: num(env.DATABASE_POOL_MAX, 10),
    pgliteDir: nodeEnv === 'test' ? null : (env.PGLITE_DIR ?? '.data/pglite'),
    redisUrl: env.REDIS_URL?.trim() || null,
    redisAdapter: env.FEATURE_REDIS_ADAPTER === '1',
    hashSecret: hashSecret || 'dev-only-insecure-secret-change-me-0000',
    allowedOrigins: [...new Set(origins)],
    idleMs: num(env.SESSION_IDLE_HOURS, 3) * HOUR,
    absoluteMs: num(env.SESSION_ABSOLUTE_HOURS, 24) * HOUR,
    roomIdleMs: num(env.ROOM_IDLE_HOURS, 6) * HOUR,
    cleanupIntervalMs: 10 * 60 * 1000,
    cardsPath: env.CARDS_PATH?.trim() || null,
    sessionCookie: isProd ? '__Host-nc_session' : 'nc_session',
  };
}
