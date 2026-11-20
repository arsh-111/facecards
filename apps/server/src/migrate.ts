import { openDatabase } from './db/client';

/**
 * Apply /drizzle migrations and exit. Used by the Vercel build. Prefers the direct (unpooled)
 * connection string that Neon's Vercel integration provides, because migrations use DDL.
 */
async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set: connect a Postgres database (e.g. Neon) first');
  const database = await openDatabase({
    databaseUrl: url,
    ssl: process.env.DATABASE_SSL === '1',
    poolMax: 1,
    pgliteDir: null,
  });
  await database.close();
  console.error('migrations applied');
}

main().catch((e: unknown) => {
  const err = e as Error & { cause?: Error };
  console.error(err instanceof Error ? err.message : err);
  if (err?.cause?.message) console.error(`cause: ${err.cause.message}`);
  process.exit(1);
});
