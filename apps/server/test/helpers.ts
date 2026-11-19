import { loadConfig, type Config } from '../src/config';
import { openDatabase, type Database } from '../src/db/client';
import { loadCards } from '../src/cards';
import { buildApp } from '../src/app';

export async function makeApp(over: Partial<Config> = {}) {
  const cfg = { ...loadConfig({ NODE_ENV: 'test', PORT: '0' }), ...over };
  const database: Database = await openDatabase({ databaseUrl: null, pgliteDir: null });
  const cards = loadCards();
  const { app, deps } = await buildApp({ cfg, db: database.db, cards, logger: false, publicDir: '/nonexistent' });
  return {
    app,
    deps,
    cfg,
    cards,
    db: database.db,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export const H = { 'x-nc-client': '1', 'content-type': 'application/json' };
/** For bodiless mutating requests. */
export const HN = { 'x-nc-client': '1' };

export const adult = (over: Record<string, unknown> = {}) => ({
  age: 30,
  gender: 'man',
  preference: 'men',
  genres: ['oral', 'anal', 'erotic', 'threesome'],
  displayName: 'Sam',
  ...over,
});

/** Extract the session cookie from a light-my-request response. */
export function cookieFrom(res: { cookies: { name: string; value: string }[] }, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}
