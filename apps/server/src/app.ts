import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import type { Config } from './config';
import type { DB } from './db/client';
import type { CardStore } from './cards';
import { createMetrics, type Metrics } from './metrics';
import { RoomService } from './rooms/service';
import { findSessionByToken } from './sessions';
import { HttpError } from './http';
import { apiRoutes } from './routes/api';
import { PUBLIC_DIR } from './paths';

export interface AppDeps {
  cfg: Config;
  db: DB;
  cards: CardStore;
  rooms: RoomService;
  metrics: Metrics;
  log: FastifyBaseLogger;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);


export async function buildApp(opts: {
  cfg: Config;
  db: DB;
  cards: CardStore;
  logger?: boolean;
  publicDir?: string;
}): Promise<{ app: FastifyInstance; deps: AppDeps }> {
  const { cfg, db, cards } = opts;
  const app = Fastify({
    trustProxy: true,
    genReqId: () => randomUUID(),
    // Built-in request logs include URLs/headers; we log our own minimal line instead.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 32 * 1024,
    // Hard Rule: logs carry request ids, status codes and timings only.
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.isProd ? 'info' : 'debug',
            base: null, // no hostname/pid
            serializers: { req: () => ({}), res: () => ({}) },
          },
  });

  const metrics = createMetrics(db);
  const rooms = new RoomService(db, cards, cfg, metrics);
  const deps: AppDeps = { cfg, db, cards, rooms, metrics, log: app.log };

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // animation libraries set inline style attributes
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  app.decorateRequest('session', null);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        // reqId is already attached by Fastify's per-request logger.
        route: req.routeOptions.url ?? 'static',
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  // CSRF (Section 7.7): custom header + Origin check on mutating API requests.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (MUTATING.has(req.method)) {
      if (req.headers['x-nc-client'] !== '1') throw new HttpError(403, 'CSRF');
      const origin = req.headers.origin;
      if (origin && !cfg.allowedOrigins.includes(origin)) throw new HttpError(403, 'ORIGIN');
    }
    req.session = await findSessionByToken(db, req.cookies[cfg.sessionCookie], cfg);
  });

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code });
    }
    const status = err.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'BAD_REQUEST' });
    }
    // Name + driver code only: messages can echo values (Hard Rule: no content in logs).
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    req.log.error({ err: err.name, code }, 'unhandled error');
    return reply.code(500).send({ error: 'SERVER_ERROR' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(async (api) => apiRoutes(api, deps));

  // Built SPA (production). Same origin keeps cookies first-party (Section 12.1).
  const publicDir = opts.publicDir ?? PUBLIC_DIR;
  if (existsSync(path.join(publicDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'NOT_FOUND' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
  }


  return { app, deps };
}
