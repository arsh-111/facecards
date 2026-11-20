// Builds the app in Vercel's Build Output API v3 format (.vercel/output):
//   static/          the React PWA (served by Vercel's CDN)
//   functions/api.func   the Fastify API bundled into one ESM file (a Vercel Function)
//   config.json      routing, security headers for static pages, and a daily cleanup cron
// It also applies database migrations against the connected Postgres before deploying.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
// Vercel reads the output from the project's Root Directory, which is the directory the build
// runs in: the repo root, or apps/server if the project was imported with that folder.
const out = new URL('.vercel/output/', pathToFileURL(`${process.cwd()}/`));
console.log(`building from ${process.cwd()} → ${fileURLToPath(out)}`);
const fn = new URL('functions/api.func/', out);
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });
const onVercel = !!process.env.VERCEL;

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

// 0. Fail fast on a misconfigured Vercel project instead of deploying an API that can't start.
if (onVercel && (process.env.SESSION_HASH_SECRET ?? '').trim().length < 32) {
  throw new Error(
    'SESSION_HASH_SECRET is missing or shorter than 32 characters: add it in Vercel → Settings → Environment Variables, then redeploy.',
  );
}

// 1. Quality gate that is cheap enough to run on every deploy.
run('npm run typecheck');

// 2. Database migrations (Neon's integration provides DATABASE_URL / DATABASE_URL_UNPOOLED).
const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (dbUrl) {
  run('npx tsx apps/server/src/migrate.ts');
} else if (onVercel) {
  throw new Error(
    'No DATABASE_URL: add a Postgres database to this Vercel project (Storage → Neon) and redeploy.',
  );
} else {
  console.warn('! DATABASE_URL not set locally: skipping migrations');
}

// 3. Static web app.
run('npm run build -w @nc/web');
cpSync(new URL('apps/web/dist/', root), new URL('static/', out), { recursive: true });

// 4. API function: one self-contained ESM bundle.
await build({
  entryPoints: [fileURLToPath(new URL('apps/server/src/vercel.ts', root))],
  outfile: fileURLToPath(new URL('index.mjs', fn)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // PGlite is the local-dev database only; keep it (and its Drizzle driver) out of the bundle.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'pg-native'],
  // Bundled CommonJS dependencies (fastify, pg) need a real `require` inside an ESM file.
  banner: {
    js: "import { createRequire as __ncRequire } from 'node:module'; const require = __ncRequire(import.meta.url);",
  },
  legalComments: 'none',
  logLevel: 'info',
});
// The function reads the card deck at runtime; /drizzle marks the app root for path lookup.
cpSync(new URL('data/', root), new URL('data/', fn), { recursive: true });
cpSync(new URL('drizzle/', root), new URL('drizzle/', fn), { recursive: true });
writeFileSync(
  new URL('.vc-config.json', fn),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      maxDuration: 15,
    },
    null,
    2,
  ),
);

// 5. Routing + headers. Same security headers as the API (Section 7.7).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const securityHeaders = {
  'Content-Security-Policy': csp,
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: securityHeaders, continue: true },
    { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(?:api/.*|healthz)$', dest: '/api' },
    { handle: 'filesystem' },
    // SPA fallback: every other path renders the app shell.
    { src: '/(.*)', dest: '/index.html' },
  ],
  // Daily backstop; ordinary requests also trigger cleanup at most every 10 minutes.
  crons: [{ path: '/api/cron/cleanup', schedule: '17 3 * * *' }],
};
writeFileSync(new URL('config.json', out), JSON.stringify(config, null, 2));

if (!existsSync(new URL('static/index.html', out))) throw new Error('static build missing');
console.log('✓ .vercel/output ready');
