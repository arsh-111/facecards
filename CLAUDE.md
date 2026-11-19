# Night Cards — guide for Claude Code

Adult couples' card game (PWA). Spec: `PRD.md`. Ambiguity calls: `DECISIONS.md` (add to it).

## Stack (fixed — ask before substituting)
- Web: React 18, TypeScript strict, Vite 6, Tailwind 3, Framer Motion, Zustand, React Router 6, vite-plugin-pwa
- Server: Node 20+, Fastify 5, Socket.IO 4 (namespace `/play`), Zod
- DB: PostgreSQL via Drizzle ORM; migrations in `/drizzle`. Dev/test without `DATABASE_URL` use embedded PGlite.
- Tests: Vitest (unit + integration), Playwright (E2E smoke)

## Layout
- `packages/shared` — Zod schemas, types, constants, deck matching (`deck.ts`), track rules (`tracks.ts`), role assignment (`roles.ts`). Consumed as TS source by web and server.
- `apps/server/src` — `app.ts` (Fastify wiring, CSP, CSRF), `routes/api.ts` (REST), `realtime.ts` (Socket.IO), `rooms/engine.ts` (pure game state machine), `rooms/service.ts` (cache, per-room lock, persistence, idempotency), `sessions.ts`, `rateLimit.ts`, `cleanup.ts`, `db/schema.ts`
- `apps/web/src` — `screens/*`, `components/*`, `lib/socket.ts`, `lib/api.ts`, `store.ts`, `i18n/en.json` (ALL UI strings)
- `data/cards.json` (owner-supplied) or `data/cards.sample.json` (placeholders, regenerate with `node scripts/gen-sample-cards.mjs`)
- `tests/e2e` — Playwright

## Commands
- `npm install` · `npm run dev` (server :3000 + web :5173 with proxy)
- `npm run build` (shared typecheck → web → server bundle → copy web into `apps/server/dist/public`)
- `npm start` (runs migrations, then serves API + WS + SPA on `PORT`)
- `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` (needs `npm run build` first)
- `npm run db:generate` after editing `apps/server/src/db/schema.ts` (commit the SQL)
- Quality gate per milestone: typecheck + lint + unit/integration tests + Playwright smoke all green.

## Hard Rules (never violate)
1. No card content without a server-side session with `ageVerified = true` (age ≥ 18). Every REST card route uses `requireVerifiedSession()`; WS re-validates the session on every event and before broadcasting text.
2. Store only the Section 6 fields. Never email, real name, phone, IP, exact age or precise location. Rate limits key on an HMAC of a random cookie, never IP.
3. Never log card text, room contents or registration answers. Logs = request id, route pattern, status, timing, error name/code only.
4. No third-party analytics, ads, trackers, external fonts or CDNs. Fonts come from `@fontsource/*` (bundled).
5. The table screen always shows Skip, Swap, Pause, Stop (Safe Signal) and Hide — never behind a menu.
6. Secrets only from env vars. Never commit `.env`.
7. Card text lives only in `data/cards.json`. Never hardcode or invent explicit card text.

## Conventions
- Adding a track (e.g. `lesbian`): add a rule to `TRACK_RULES` in `packages/shared/src/tracks.ts`, add cards with that `track`, add tests. Nothing else.
- New WS action: add its Zod schema to `WsSchemas` (shared), handle it in `service.act` → a pure function in `engine.ts`, add an engine test. Every action carries `actionId`.
- Mutating REST calls need header `X-NC-Client: 1` and a matching Origin.
- New UI text goes in `apps/web/src/i18n/en.json`; use `t('key')`.
- Keep the initial JS under 250 KB gzipped (currently ~137 KB).

## Deploy
Render Blueprint `render.yaml` (web service + Postgres). Set `ALLOWED_ORIGIN` to the final domain (falls back to `RENDER_EXTERNAL_URL`). Health check: `/healthz`. In-process cleanup runs every 10 min.
