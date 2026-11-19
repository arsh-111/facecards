import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { MIGRATIONS_DIR } from '../paths';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: DB;
  driver: 'pg' | 'pglite';
  close(): Promise<void>;
}

/**
 * Production uses PostgreSQL via `pg`. When DATABASE_URL is unset (dev/test only) an embedded
 * PGlite Postgres is used so the app runs without external services. Migrations from /drizzle
 * are applied on startup in both cases.
 */
export async function openDatabase(opts: {
  databaseUrl: string | null;
  ssl?: boolean;
  poolMax?: number;
  pgliteDir: string | null;
}): Promise<Database> {
  if (opts.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: opts.poolMax ?? 10,
      ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as DB, driver: 'pg', close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as DB, driver: 'pglite', close: () => client.close() };
}
