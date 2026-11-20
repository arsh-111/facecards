import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { loadCards } from './cards';
import { buildApp } from './app';

/**
 * Vercel Function entry. One Fastify instance per warm function instance; every request is
 * handed to it. Migrations run during the build (scripts/vercel-build.mjs), not here.
 */
let ready: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const cards = loadCards(cfg.cardsPath);
  const database = await openDatabase({
    databaseUrl: cfg.databaseUrl,
    ssl: cfg.databaseSsl,
    poolMax: cfg.databasePoolMax,
    pgliteDir: null,
    migrate: false,
  });
  // Static files are served by Vercel's CDN, so the app needs no public directory here.
  const { app } = await buildApp({ cfg, db: database.db, cards, publicDir: '/nonexistent' });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= init();
    const app = await ready;
    app.server.emit('request', req, res);
  } catch (e) {
    ready = null; // retry initialisation on the next request
    const err = e as Error & { cause?: Error };
    console.error(`init failed: ${err.message}${err.cause ? ` (cause: ${err.cause.message})` : ''}`);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'SERVER_ERROR' }));
  }
}
