import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { loadCards } from './cards';
import { buildApp } from './app';
import { startCleanupJob } from './cleanup';

async function main() {
  const cfg = loadConfig();
  // Fail fast on an invalid card file (Section 6.2).
  const cards = loadCards(cfg.cardsPath);
  // Runs pending /drizzle migrations before serving (Section 12.3).
  const database = await openDatabase({
    databaseUrl: cfg.databaseUrl,
    ssl: cfg.databaseSsl,
    poolMax: cfg.databasePoolMax,
    pgliteDir: cfg.pgliteDir,
  });
  const { app, deps } = await buildApp({ cfg, db: database.db, cards });
  app.log.info({ cards: cards.all.length, source: cards.source, db: database.driver }, 'starting');
  const stopCleanup = startCleanupJob(deps);

  const shutdown = async () => {
    stopCleanup();
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
}

main().catch((e: unknown) => {
  // Startup errors (config/card validation) are ours, not user content.
  const err = e as Error & { cause?: Error };
  console.error(err instanceof Error ? err.message : err);
  if (err?.cause?.message) console.error(`cause: ${err.cause.message}`);
  process.exit(1);
});
