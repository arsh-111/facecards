# Night Cards

A private, mobile-first card game for adult couples and groups, built as a web app you can install on your phone (PWA). It replaces a physical deck of intimate challenge cards. Players register anonymously in under a minute, join a shared room, and draw animated cards with specific, timed tasks.

> **Adults only (18+).** The age check is self-declared, which is a speed bump, not real verification. Before making the site public, read the legal checklist in [PRD.md §10](PRD.md#10-legal-policy-and-risk-notes-owner-action-required).

## Features

- **Anonymous by design.** No account, email or password. A short-lived server-side session sits in an HttpOnly cookie and deletes itself after 3 idle hours, or 24 hours at most. **Delete my data now** wipes it immediately.
- **Age gate on the server.** Users under 18 never get a session, and no route (REST or WebSocket) sends card content without a verified session.
- **Automatic deck matching.** The deck track (`gay` / `straight`) is chosen from each player's gender and preference. Genres are limited to the ones every player picked, and cards that need more players than are present are left out.
- **Roles and personalization.** Cards use placeholders such as `{giver}`, `{top}` or `{master}`. The app assigns players to roles based on the comfort each player sets in the lobby, and players can swap roles before the card is revealed.
- **Play modes.** Online rooms with a 6-character code or invite link (up to 8 players, synced in real time), Pass and Play on one device, and a Solo preview.
- **Safety built in.** Skip, Swap, Pause and **Stop (Safe Signal)** are always on screen. Stop pauses every device and shows a calm "Take a breath" screen. Players can mark genres or individual cards as **Never**. A double tap on the logo, a shake, or the Hide button switches to a working calculator.
- **Animated table.** Shuffle, deal, 3D flip and a countdown timer ring, with optional sound and vibration. Reduced motion is supported.
- **Private by default.** No analytics, ads or trackers. Fonts and assets are self-hosted, the CSP is strict, and search engines are told not to index the site.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript (strict), Vite 6, Tailwind CSS 3, Framer Motion 11, Zustand 5, React Router 6, vite-plugin-pwa |
| Backend | Node.js 20+, Fastify 5, Socket.IO 4, Zod 3 |
| Database | PostgreSQL through Drizzle ORM (SQL migrations in `/drizzle`). Local dev and tests can run on embedded PGlite instead. |
| Cache (optional) | Redis / Render Key Value through `@socket.io/redis-adapter`, behind a feature flag |
| Testing | Vitest (unit and integration), Playwright (end-to-end) |
| Tooling | ESLint 9, Prettier, Husky (runs lint and typecheck before each commit), tsup, tsx |
| Hosting | Render, defined in a Blueprint (`render.yaml`) |

### Libraries

**Server** (`apps/server`): `fastify`, `@fastify/cookie`, `@fastify/helmet`, `@fastify/static`, `socket.io`, `drizzle-orm`, `pg`, `@electric-sql/pglite`, `cookie`, `@socket.io/redis-adapter`, `redis`

**Web** (`apps/web`): `react`, `react-dom`, `react-router-dom`, `framer-motion`, `zustand`, `socket.io-client`, `@fontsource/inter`, `@fontsource/playfair-display`

**Shared** (`packages/shared`): `zod`

**Development tools:** `typescript`, `vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `tailwindcss`, `postcss`, `autoprefixer`, `tsup`, `tsx`, `vitest`, `@playwright/test`, `drizzle-kit`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, `husky`, `concurrently`

`npm install` installs all of them. Exact versions are pinned in `package-lock.json`.

## Project structure

```
.
├── apps/
│   ├── server/            Fastify API + Socket.IO + static hosting of the built web app
│   │   ├── src/
│   │   │   ├── app.ts            Fastify setup, security headers, CSRF and Origin checks
│   │   │   ├── routes/api.ts     REST endpoints
│   │   │   ├── realtime.ts       WebSocket namespace /play
│   │   │   ├── rooms/engine.ts   Game rules as pure functions
│   │   │   ├── rooms/service.ts  Room cache, one-at-a-time actions per room, persistence
│   │   │   ├── sessions.ts       Session tokens, expiry
│   │   │   ├── rateLimit.ts      Rate limits
│   │   │   ├── cleanup.ts        Expiry job (every 10 min)
│   │   │   └── db/schema.ts      Drizzle schema
│   │   └── test/          Vitest unit + integration tests
│   └── web/               React PWA
│       └── src/
│           ├── screens/   Landing, Register, Home, Lobby, Table, Settings, …
│           ├── components/
│           ├── lib/       API client, socket, sound/haptics, panic hide
│           └── i18n/en.json   Every UI string
├── packages/shared/       Zod schemas, types, deck matching, track rules, role assignment
├── data/
│   ├── cards.json         The real deck (owner-supplied)
│   ├── cards.sample.json  Placeholder deck used for tests and as a fallback
│   └── cards.template.json  100-card skeleton for authoring
├── drizzle/               SQL migrations
├── tests/e2e/             Playwright smoke tests
├── scripts/               Build and card helper scripts
├── render.yaml            Render Blueprint
├── CLAUDE.md              Guidance for AI-assisted development
├── DECISIONS.md           Record of judgement calls where the PRD was ambiguous
└── PRD.md                 Product requirements
```

## Getting started

### Prerequisites

- **Node.js 20 or newer** and npm 10 or newer
- **PostgreSQL 14+** for production. It is optional locally: when `DATABASE_URL` is not set, dev and test use an embedded PGlite database stored in `.data/pglite`.

### Setup

```bash
git clone <repo-url> night-cards
cd night-cards
npm install
cp .env.example .env        # optional for local dev; the defaults work
```

### Run in development

```bash
npm run dev
```

- Web app: http://localhost:5173 (hot reload). Vite forwards `/api` and `/socket.io` to the server.
- API and WebSocket: http://localhost:3000

To test on a phone on the same network, open `http://<your-computer-ip>:5173`.

### Run a production build locally

```bash
npm run build
npm start                    # http://localhost:3000
```

To run with `NODE_ENV=production`, you must set `DATABASE_URL`, `SESSION_HASH_SECRET` (32+ characters) and `ALLOWED_ORIGIN`. In production the server refuses to start without them.

```bash
NODE_ENV=production \
DATABASE_URL=postgres://user:pass@localhost:5432/night_cards \
SESSION_HASH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
ALLOWED_ORIGIN=http://localhost:3000 \
npm start
```

Database migrations run automatically when the server starts.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | | `development` | `production` turns on secure `__Host-` cookies, HSTS and the required-variable checks |
| `PORT` | | `3000` | HTTP port |
| `DATABASE_URL` | prod | – | Postgres connection string. If unset (dev/test only), PGlite is used. |
| `DATABASE_SSL` | | `0` | Set to `1` for SSL connections to the database |
| `DATABASE_POOL_MAX` | | `10` | Maximum number of database connections |
| `PGLITE_DIR` | | `.data/pglite` | Where the local embedded database is stored |
| `SESSION_HASH_SECRET` | prod | dev value | Secret used to hash rate-limit tokens (32+ characters) |
| `ALLOWED_ORIGIN` | prod | `RENDER_EXTERNAL_URL` | Allowed origin(s) for CSRF, CORS and WebSocket checks; separate several with commas |
| `SESSION_IDLE_HOURS` | | `3` | Session idle timeout |
| `SESSION_ABSOLUTE_HOURS` | | `24` | Maximum session lifetime |
| `ROOM_IDLE_HOURS` | | `6` | Rooms are deleted after this long without activity |
| `CARDS_PATH` | | – | Use a specific card file instead of `data/cards.json` |
| `REDIS_URL` / `FEATURE_REDIS_ADAPTER` | | – / `0` | Optional Socket.IO Redis adapter |
| `VITE_CONTACT_EMAIL` | build | `contact@example.com` | Contact address shown in the footer; set it when building |

Never commit `.env`.

## Card deck

The server loads `data/cards.json`, or `data/cards.sample.json` if that file doesn't exist. It validates the file when it starts and refuses to start if the file is invalid.

```json
{
  "version": 1,
  "cards": [
    {
      "id": "gay-oral-01",
      "track": "gay",
      "genre": "oral",
      "title": "Card title",
      "text": "Task text using {giver} and {receiver}.",
      "roles": ["giver", "receiver"],
      "minPlayers": 2,
      "durationSeconds": 120,
      "intensity": "hot",
      "tags": []
    }
  ]
}
```

- `id` must look like `<track>-<genre>-<nn>` and must never change once published, because players' "Never" choices refer to it.
- Every `{placeholder}` in `text` must be listed in `roles`.
- Set `durationSeconds` whenever the text names a time; it turns on the countdown timer.
- `intensity` can be `warm`, `hot` or `intense`. It drives the lobby's intensity filter.

```bash
npm run cards:template   # regenerate data/cards.template.json (100-card skeleton)
npm run cards:check      # validate data/cards.json and report authoring problems
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and web app with hot reload |
| `npm run build` | Typecheck shared code, build the web app, bundle the server, copy the web build into the server |
| `npm start` | Run migrations, then serve the API, WebSocket and app |
| `npm test` | Vitest unit and integration tests (shared and server) |
| `npm run test:e2e` | Playwright smoke tests against the built app; run `npm run build` first. The first time, also run `npx playwright install chromium`. |
| `npm run typecheck` | TypeScript strict check for all packages |
| `npm run lint` | ESLint, with zero warnings allowed |
| `npm run format` | Prettier |
| `npm run db:generate` | Generate a new SQL migration after editing `db/schema.ts` |
| `npm run cards:check` | Validate the card deck |
| `npm run icons` | Regenerate the neutral PWA icons |

## Deployment (Render)

1. Push the repository to GitHub or GitLab.
2. In Render, choose **New → Blueprint** and select the repository. `render.yaml` creates the `night-cards` web service and the `night-cards-db` Postgres database.
3. Set `ALLOWED_ORIGIN` to your final domain (for example `https://nights.example.com`). `SESSION_HASH_SECRET` is generated automatically.
4. After each deploy, check that `/healthz` returns `{"ok":true}`, then try registering.

Notes:
- Use a paid instance. Free instances go to sleep, which drops live rooms.
- Before deploying, confirm that Render's Acceptable Use Policy (and your domain and payment providers) allow adult content.
- v1 runs as a single instance. See `DECISIONS.md` #22 before scaling out.

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/register` | Age gate and session creation |
| GET / PATCH / DELETE | `/api/me` | Read, update or delete your profile, settings and boundaries |
| POST | `/api/rooms` | Create a room (`online` or `pass_and_play`) |
| POST | `/api/rooms/join` | Join a room by code |
| GET | `/api/rooms/:code` | Room state (members only) |
| POST | `/api/rooms/:code/leave` | Leave a room |
| GET | `/healthz` | Health check |

Requests that change data must send the header `X-NC-Client: 1`. Real-time play uses the Socket.IO namespace `/play`. Every action the client sends includes a unique `actionId`, so a repeated message is applied only once. The server then sends the full, authoritative `room:state` to everyone in the room. Event names are defined by `WsSchemas` in `packages/shared/src/schemas.ts`.

## Privacy and security

- The database stores only an age range, gender, preference, genres, an optional nickname, settings, boundaries and room progress. It never stores email, real name, phone, IP address, exact age or location.
- Session tokens are 256-bit random values; only their SHA-256 hash is stored. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and use the `__Host-` prefix in production.
- Rate limits are keyed on a hashed random cookie, never on IP address.
- Logs contain only request ID, route, status, timing and error name or code. They never contain card text, room contents or registration answers.

## Contributing

Contributions are welcome. Please keep the privacy and safety guarantees intact.

1. **Branch** from `main`: `git checkout -b feat/short-description`.
2. **Read** `CLAUDE.md` (conventions and hard rules) and the relevant section of `PRD.md`.
3. **Make the change**, following these conventions:
   - All UI text goes in `apps/web/src/i18n/en.json` and is used through `t('key')`.
   - Shared logic (deck matching, roles, schemas) belongs in `packages/shared`, with unit tests.
   - New real-time actions: add a Zod schema to `WsSchemas`, handle the action in `rooms/service.ts`, put the logic in `rooms/engine.ts` as a pure function, and add an engine test.
   - Schema changes: edit `apps/server/src/db/schema.ts`, run `npm run db:generate`, and commit the generated SQL.
   - Adding a deck track (for example `lesbian`): add a rule to `TRACK_RULES` in `packages/shared/src/tracks.ts`, add cards with that `track`, and add tests. No other code changes are needed.
   - Record any judgement call where the PRD is ambiguous in `DECISIONS.md`.
4. **Check** before pushing:
   ```bash
   npm run typecheck && npm run lint && npm test
   npm run build && npm run test:e2e
   ```
   The Husky pre-commit hook runs lint and typecheck automatically.
5. **Open a pull request** that explains what changed, why, and how you tested it. Include screenshots for UI changes.

### Hard rules (a pull request that breaks one will not be merged)

1. No card content reaches anyone without a server-verified adult session.
2. No personal data (email, real name, phone, IP, exact age, location) is stored.
3. No card text, room contents or registration answers appear in logs.
4. No third-party analytics, trackers, ads, external fonts or CDNs.
5. Skip, Swap, Pause, Stop (Safe Signal) and Hide stay visible on the table screen, never hidden in a menu.
6. Secrets come only from environment variables.
7. Card text lives only in `data/cards.json`, never in code.

Report security issues privately to the contact address in the app footer, not in a public issue.

## License

No license has been chosen yet. Until the owner adds one, all rights are reserved.
