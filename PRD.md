# PRD: Night Cards (Adult Couples' Card Game Web App)

Version 1.0 | Status: Ready for build | Audience: Product owner, Claude Code (primary implementer)

---

## 0. Instructions for Claude Code (read first)

You are implementing this PRD end to end. Follow these rules.

1. **Read this whole file before writing code.** Build in the milestone order in Section 14. Commit after each milestone.
2. **Stack is fixed** (Section 11). Do not substitute frameworks without asking.
3. **Create `CLAUDE.md` in the repo root** on first run, summarizing: stack, folder layout, run/test/build commands, and the "Hard Rules" below. Keep it under 80 lines and update it as the project evolves.
4. **Card content lives in `data/cards.json`**, never hardcoded in components. The owner supplies the card text (100 cards, taxonomy in Appendix A). Until it arrives, generate `data/cards.sample.json` with 2 placeholder cards per category using neutral text such as "PLACEHOLDER: describe task", and build everything against that. Do not invent explicit card text yourself.
5. **Hard Rules (never violate):**
   - No user can reach any card content unless the server-side session has `ageVerified = true` (age >= 18). Enforce on the server, not only in the UI.
   - Never store email, name, phone, IP address in the database, or precise location. Store only the fields in Section 6.
   - Never log card text, room contents, or registration answers. Logs may contain request IDs, status codes, and timings only.
   - No third-party analytics, ad SDKs, or trackers. No external fonts or CDNs that leak visits (self-host assets).
   - Every card screen must show **Skip**, **Pause**, and **Stop (Safe Signal)** controls (Section 8.4).
   - All secrets come from environment variables. Never commit `.env`.
6. **Quality gates before each milestone is "done":** TypeScript strict passes, ESLint clean, unit tests for session and deck-matching logic pass, Playwright smoke test of the registration-to-first-card flow passes.
7. **Deployment target is Render** via `render.yaml` Blueprint (Section 12). Verify `npm run build && npm start` works locally with `NODE_ENV=production` before declaring deployment ready.
8. When a requirement is ambiguous, make the smallest reasonable choice, note it in `DECISIONS.md`, and continue.

---

## 1. Product Summary

Night Cards is a mobile-first web app that replaces a physical deck of intimate challenge cards for adult couples and groups. Players register anonymously in under a minute (age, gender, orientation, preferred genres), enter a shared room, and draw animated cards containing specific, timed, physical challenges. There is no login, no email, and no account. Identity lives only in a short-lived server-side session.

### 1.1 Goals
- Reproduce the physical card-draw experience: shuffle, deal, flip, reveal, timer, next card.
- Match the deck automatically to each player's orientation and chosen genres.
- Provide a sensual, immersive, dark UI with tasteful animation.
- Be private by design: anonymous, minimal data, auto-expiring sessions.
- Deploy cleanly on Render with one Blueprint.

### 1.2 Non-Goals (v1)
- Accounts, passwords, social login, friends lists, chat, or in-app media/photo/video sharing.
- User-generated cards (v2 candidate).
- Payments or subscriptions.
- Native mobile apps (PWA install is in scope).
- Lesbian and other pairings not in the card set (Section 5.2 says how to extend).

---

## 2. Users and Personas

| Persona | Description | Need |
|---|---|---|
| Couple | Two adults, same room or long distance | Fresh, specific ideas without awkward planning |
| Group host | 3+ adults playing a threesome or group genre | One device or room code to run the session |
| Solo browser | One adult previewing | See how the app works before inviting a partner |

All users must be 18 or older.

---

## 3. User Flow (end to end)

1. **Landing screen**: Logo, tagline, "I am 18 or older. Enter" gate and a discreet exit link.
2. **Registration** (single multi-step form, no login):
   1. Age (number or date of birth). Under 18 means hard block (Section 7).
   2. Gender: Man, Woman, Non-binary / other.
   3. Sexual preference: Men, Women, Both.
   4. Genres (multi-select): Intimate/Erotic, Oral, Anal, Threesome, Group, Master & Slave.
   5. Display name (optional nickname, 2 to 20 chars, never required to be real).
3. **Session created** server-side; cookie set; user lands on Home.
4. **Home**: choose **Play Solo Preview**, **Create Room**, or **Join Room** (6-character code).
5. **Lobby** (rooms): list of players, each player's roles, host picks genres (limited to the intersection of all players' genres), set card timer behavior, host taps **Start**.
6. **Play**: shuffle animation, deck on screen, active player draws, card flips, task shown with timer, Done / Skip / Pause / Stop.
7. **Round summary**: cards completed, skipped, time spent. Option to play again or end.
8. **End**: session can be wiped immediately with "Delete my data now".

---

## 4. Functional Requirements

### 4.1 Registration and Profile
- FR-1: Registration collects exactly the fields in Section 6.1. All except display name are required.
- FR-2: Age under 18 blocks registration and shows an exit screen. No data is stored for blocked attempts beyond a server rate-limit counter keyed by a hashed, salted client token.
- FR-3: Profile can be edited from Settings during the session (gender, preference, genres, name). Editing age to under 18 ends the session.
- FR-4: Returning within the session lifetime restores the profile and room automatically with no re-registration.

### 4.2 Deck Matching
- FR-5: Each card has `track` (`gay`, `straight`), `genre`, and `roles` metadata.
- FR-6: Track selection per room is computed from the players' gender and preference (Section 5).
- FR-7: Only genres selected by **all** players in the room are offered. If the intersection is empty, the lobby shows an explanation and lets players adjust genres.
- FR-8: Cards that need more players than are in the room are excluded (e.g. threesome needs 3).
- FR-9: Each card is dealt at most once per round. Deck reshuffles when empty, with a prompt.

### 4.3 Roles and Personalization
- FR-10: Cards use role placeholders (`{giver}`, `{receiver}`, `{top}`, `{bottom}`, `{master}`, `{slave}`, `{A}`, `{B}`, `{C}`). The app assigns them to players, who confirm or swap roles before the card is revealed.
- FR-11: In the lobby each player may mark role comfort: Top / Bottom / Versatile, Giver / Receiver / Both, Master / Slave / Switch. Role assignment honors these.
- FR-12: Display names replace role placeholders in the rendered text.

### 4.4 Card Play
- FR-13: Draw action triggers shuffle, deal and flip animations (Section 8.2).
- FR-14: Each card shows genre badge, title, task text, and a countdown timer when the card includes `durationSeconds`.
- FR-15: Timer starts on **Start Task**; completes with a soft chime and haptic buzz (user toggles).
- FR-16: Actions: **Done**, **Skip** (unlimited, no penalty), **Swap** (draw a replacement from the same genre), **Pause**, **Stop**.
- FR-17: Turn order modes: Alternate, Random, Host-picks.
- FR-18: Intensity filter (Warm, Hot, Intense) is available in the lobby when the card file supplies `intensity`.

### 4.5 Rooms and Multiplayer
- FR-19: A room is created by a registered user and gets a 6-character code (A-Z, 2-9, no ambiguous characters) and a shareable link.
- FR-20: Max players: 2 for couple tracks; up to 8 for group genres.
- FR-21: Real-time sync over WebSocket: draw, flip, timer start/pause/stop, skip, turn changes, player join/leave.
- FR-22: Same-device **Pass and Play** mode runs a room with one client and no code.
- FR-23: Host can remove a player. Any player can leave at any time. If the host leaves, host passes to the longest-present player.
- FR-24: Rooms expire after 6 hours of inactivity and are hard-deleted.

### 4.6 Safety and Control
- FR-25: **Stop (Safe Signal)** is a persistent button. Any player pressing it stops the timer for everyone, dims the screen, and shows a calm "Take a breath" screen with options: Resume, Skip card, End session.
- FR-26: Stop events are never counted against anyone or shown as failures.
- FR-27: A "Boundaries" screen in the lobby lets each player mark genres or card IDs as **Never** for them. Those cards are removed from the room deck for everyone.
- FR-28: Panic hide: a double-tap on the logo or a shake gesture instantly replaces the screen with a neutral calculator or notes decoy page and pauses the game.
- FR-29: Responsible-use note on first play: this app is for adults only, requires clear willingness from all players, and encourages condoms and testing for anal and oral cards. Text must be short and shown once per session.

### 4.7 Settings
Sound, haptics, animation level (Full / Reduced), language (English v1; i18n-ready), theme intensity, Delete my data now.

### 4.8 PWA
Installable, offline shell (static assets only; the game requires a connection to sync), app icon that does not reveal the app's nature (neutral name option: "Nights").

---

## 5. Deck Matching Logic

### 5.1 Track Resolution
Let each player have `gender` and `preference`.

| Players | Condition | Track |
|---|---|---|
| 2 | Both men and each prefers Men or Both | `gay` |
| 2 | One man and one woman, each prefers the other's gender or Both | `straight` |
| 2+ | Any mix that fits neither | Show "No matching deck", suggest editing preference, or select a track manually only if all players confirm |
| 3+ | All men, all prefer Men or Both | `gay` |
| 3+ | Mixed with men and women, each prefers all or both | `straight` (MMF / MFF aware) |

Non-binary / other users are matched by their stated preference and treated as the role they pick in the lobby. When in doubt, ask the players to choose a track together.

### 5.2 Genre Mapping
| UI genre | `genre` value | Min players |
|---|---|---|
| Intimate / Erotic | `erotic` | 2 |
| Oral | `oral` | 2 |
| Anal | `anal` | 2 |
| Threesome | `threesome` | 3 |
| Group | `group` | 4 |
| Master & Slave | `master_slave` | 2 |

To add a new track (e.g. `lesbian`), add cards to `cards.json` with the new `track`, add it to the track-resolution table, and add tests. No other code changes should be required. Design the code so this is true.

---

## 6. Data Model

PostgreSQL. No PII. All timestamps UTC.

### 6.1 Tables

**sessions**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| token_hash | text unique | SHA-256 of the cookie token; raw token never stored |
| age_verified | boolean | true only if declared age >= 18 |
| age_band | text | `18-24`, `25-34`, `35-44`, `45+` (do not store exact age) |
| gender | text | `man`, `woman`, `nonbinary` |
| preference | text | `men`, `women`, `both` |
| genres | text[] | selected genres |
| display_name | text | optional, 2-20 chars |
| settings | jsonb | sound, haptics, animation level |
| boundaries | jsonb | never-genres and never-card-ids |
| created_at | timestamptz | |
| last_seen_at | timestamptz | rolling idle timer |
| expires_at | timestamptz | absolute expiry |

**rooms**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| code | char(6) unique | |
| host_session_id | uuid FK | |
| mode | text | `online`, `pass_and_play` |
| track | text | `gay`, `straight` |
| genres | text[] | host-selected within the intersection |
| intensity | text | optional |
| turn_mode | text | `alternate`, `random`, `host` |
| state | text | `lobby`, `playing`, `paused`, `stopped`, `ended` |
| created_at, last_activity_at | timestamptz | |

**room_players**: `room_id`, `session_id`, `role_prefs jsonb`, `joined_at`, `left_at`. Unique on (`room_id`, `session_id`).

**room_deck_state**: `room_id`, `card_id`, `status` (`unseen`, `active`, `done`, `skipped`), `position`, `assigned_roles jsonb`, `started_at`, `completed_at`.

**rate_limits** (or Redis keys): hashed client token + bucket + count + window_end.

### 6.2 Cards File Schema (`data/cards.json`)
```json
{
  "version": 1,
  "cards": [
    {
      "id": "gay-anal-01",
      "track": "gay",
      "genre": "anal",
      "title": "Spooning Slow Burn",
      "text": "Task text with {top} and {bottom} placeholders.",
      "roles": ["top", "bottom"],
      "minPlayers": 2,
      "durationSeconds": 180,
      "intensity": "hot",
      "tags": ["spooning"]
    }
  ]
}
```
- Validate this file with Zod at server start. Fail fast with a clear error if invalid.
- Card IDs are stable: `<track>-<genre>-<nn>`.
- The server sends card text only to sessions with `age_verified = true` that are in the relevant room.

---

## 7. Session Management (accurate and strict)

### 7.1 Principles
No login, no email, no password. The server owns the session. The client holds only an opaque token.

### 7.2 Mechanism
- On successful registration the server creates a `sessions` row and a random 256-bit token (`crypto.randomBytes(32)`, base64url).
- Token is sent as cookie `nc_session` with `HttpOnly; Secure; SameSite=Lax; Path=/`. In production the cookie uses the `__Host-` prefix.
- Only `SHA-256(token)` is stored. Lookups compare hashes in constant time.
- Session state lives in Postgres. Hot-path caching in Redis (Render Key Value) is optional.

### 7.3 Lifetimes
| Rule | Value |
|---|---|
| Idle timeout | 3 hours since `last_seen_at` |
| Absolute lifetime | 24 hours since `created_at` |
| Rolling refresh | `last_seen_at` updated at most once per minute on activity |
| Room link lifetime | Room ends 6 hours after its last activity |
| Cleanup job | Every 10 minutes, hard-delete expired sessions, rooms and children (cron on Render or in-process scheduler) |

### 7.4 Age Gate Enforcement
- Age is validated server-side on `POST /api/register`. Under 18: respond 403, create no session, set a `nc_block` cookie (24 h) and a hashed-token rate limit so repeated retries are throttled. This is a speed bump, not true verification.
- Every card endpoint and every WebSocket event that reveals card content calls `requireVerifiedSession()`.

### 7.5 WebSocket Authentication
- WebSocket handshake reads the session cookie. Reject with 401 on missing or invalid session.
- A socket is bound to one `session_id` and re-validated when the session expires; expired sessions are disconnected with a clear `SESSION_EXPIRED` event.
- Multiple tabs: allowed; the latest socket becomes the active one for that room and earlier tabs show "Playing in another tab".

### 7.6 Reconnect and Concurrency
- Reconnect within 2 minutes restores the player to the room and current state. After that the player is marked away, and the game continues or pauses per the host's choice.
- Room actions are serialized per room (single-writer) so two simultaneous "Draw" requests produce one card.
- All room mutations are idempotent with an `actionId` from the client.

### 7.7 Security
- CSRF: SameSite=Lax cookie plus a custom header (`X-NC-Client`) required on mutating requests, and Origin check against allowed origin.
- Rate limits: registration 10/hour per client token, room join attempts 20/hour, WebSocket messages 20/sec per socket.
- Room codes are random, 6 characters from a 32-character alphabet; wrong-code attempts are throttled.
- Helmet-style headers, strict CSP (no inline scripts), `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, and `robots.txt` disallowing all.
- All input validated with Zod. Parameterized queries only.
- "Delete my data now" removes the session row and all related rows immediately and clears the cookie.

---

## 8. UX and UI Design

### 8.1 Visual Language
- Dark, sensual, luxurious: near-black backgrounds (`#0B0710`), deep wine and crimson (`#7A0E2B`, `#B3123F`), rose gold accents (`#E8B4A0`), soft candlelight glow.
- Typography: an elegant display serif for titles (self-hosted, e.g. Playfair Display) and a clean sans for body (e.g. Inter).
- Glassmorphism panels, soft inner glows, subtle film-grain texture, slow ember or smoke particles in the background.
- Tone of copy: confident, warm, playful. Never crude in UI chrome; card text is the only explicit content and sits behind the age gate.

### 8.2 Animation (Framer Motion, GPU-friendly)
- **Landing:** slow breathing glow behind the logo; button with a pulsing rim light.
- **Registration:** steps slide with a soft blur-in; selected chips ignite with a glow ripple.
- **Shuffle:** deck splits into two stacks and riffles together (about 1.2 s), light haptic on completion.
- **Deal and flip:** top card lifts, rotates in 3D (`rotateY` 180°) with a light sweep and shadow, revealing the face.
- **Timer:** circular ring that fills with a gradient; final 10 seconds pulse faster.
- **Stop:** screen dims and blurs, ring of light fades, calm message appears.
- **Reduced motion:** honor `prefers-reduced-motion` and the in-app Animation Level setting; replace transforms with simple fades.
- Keep 60 fps on mid-range phones; no heavy video backgrounds; particle count capped.

### 8.3 Key Screens
1. Landing and 18+ gate
2. Registration (5 steps, progress dots)
3. Home (Solo Preview, Create Room, Join Room)
4. Lobby (players, roles, genres, boundaries, intensity, timer options, Start)
5. Table (deck, active card, timer, controls, player turn indicator)
6. Safe Signal screen
7. Round summary
8. Settings and Delete my data

Mobile-first (360 px up), one-thumb reachable controls at the bottom, large tap targets (min 48 px), tablet and desktop layouts supported.

### 8.4 Mandatory Controls on the Table Screen
Skip, Swap, Pause, Stop (Safe Signal), Panic Hide. These must never be hidden behind menus.

### 8.5 Sound and Haptics
Optional low-volume ambient pad and soft interaction sounds (off by default, remembered per session). Vibration API for flip and timer end where supported.

### 8.6 Accessibility
WCAG AA contrast, keyboard operable, screen-reader labels on all controls, focus rings, timer announced via `aria-live`, no color-only meaning.

---

## 9. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | LCP < 2.5 s on 4G mid-range phone; JS bundle < 250 KB gzipped initial |
| Realtime | State sync latency < 300 ms p95 |
| Availability | Single Render instance acceptable for v1; WebSocket-safe design for future horizontal scale (Redis adapter ready) |
| Privacy | No PII, no third-party calls, no analytics on content, auto-expiry, delete-now |
| Compatibility | Latest 2 versions of Chrome, Safari (iOS 16+), Firefox, Edge |
| Testing | Unit (deck matching, session expiry), integration (API + WS), E2E smoke (Playwright) |
| i18n | All UI strings in a resource file; card text also keyed for future translation |

---

## 10. Legal, Policy and Risk Notes (owner action required)

This section is a checklist, not legal advice. Have a lawyer review before public launch.

1. **Age verification:** a self-declared age is not real verification. Some jurisdictions require stronger checks for adult content. Decide whether to add a third-party age-assurance provider later.
2. **Local law:** laws on publishing or transmitting sexually explicit material online differ by country. In India, for example, the IT Act and related provisions restrict publishing or transmitting obscene or sexually explicit material electronically. Check the rules for where you host, where you live, and where your users are, before making the site publicly reachable.
3. **Hosting terms:** confirm Render's current Acceptable Use Policy allows adult content for your use case before deploying. If it does not, use a host that does.
4. **Domain and payment providers** can also restrict adult content; check their policies.
5. **Consent and safety:** the Safe Signal, Skip and Boundaries features are product requirements, not optional extras. Keep the responsible-use note and condom/testing reminders.
6. **Privacy policy and terms** pages are required (short, plain-language, linked in footer). State: adults only, no accounts, what is stored, auto-deletion periods.
7. **Takedown and abuse contact:** a monitored contact address in the footer.

---

## 11. Technical Architecture

### 11.1 Stack (fixed)
- **Frontend:** React 18, TypeScript (strict), Vite, Tailwind CSS, Framer Motion, Zustand for state, React Router, vite-plugin-pwa.
- **Backend:** Node.js 20 LTS, Fastify, TypeScript, Socket.IO (WebSocket with fallback), Zod for validation.
- **Database:** PostgreSQL via Drizzle ORM (migrations checked in).
- **Cache / pub-sub (optional v1):** Render Key Value (Redis-compatible) with the Socket.IO Redis adapter, behind a feature flag.
- **Testing:** Vitest, Playwright.
- **Tooling:** ESLint, Prettier, Husky pre-commit (lint + typecheck).

### 11.2 Repository Layout
```
/
  CLAUDE.md
  PRD.md
  DECISIONS.md
  render.yaml
  package.json            (npm workspaces)
  /apps
    /web                  (Vite React app)
    /server               (Fastify + Socket.IO)
  /packages
    /shared               (Zod schemas, types, deck-matching logic, constants)
  /data
    cards.json
    cards.sample.json
  /drizzle                (migrations)
  /tests
    /e2e
```
Deck-matching and role-assignment logic live in `/packages/shared` and are unit-tested; both server and client import them.

### 11.3 REST API
| Method | Path | Purpose |
|---|---|---|
| POST | /api/register | Validate and create session (age gate here) |
| GET | /api/me | Current session profile |
| PATCH | /api/me | Update profile, settings, boundaries |
| DELETE | /api/me | Delete my data now |
| POST | /api/rooms | Create room |
| POST | /api/rooms/join | Join with code |
| GET | /api/rooms/:code | Room state (members only) |
| POST | /api/rooms/:code/leave | Leave room |
| GET | /healthz | Health check for Render (no auth, no data) |

### 11.4 WebSocket Events (Socket.IO namespace `/play`)
Client to server: `room:join`, `room:setGenres`, `room:start`, `card:draw`, `card:swap`, `card:startTimer`, `card:done`, `card:skip`, `game:pause`, `game:resume`, `game:stop`, `roles:confirm`, `host:kick`.
Server to client: `room:state` (full snapshot), `room:playerJoined`, `room:playerLeft`, `card:dealt`, `card:timer`, `game:stopped`, `session:expired`, `error`.
Every client action carries `actionId`; the server replies with the authoritative `room:state`.

### 11.5 Environment Variables
```
NODE_ENV=production
PORT=10000
DATABASE_URL=...
REDIS_URL=...                 (optional)
SESSION_HASH_SECRET=...       (random 32+ bytes; used to hash rate-limit tokens)
ALLOWED_ORIGIN=https://<your-domain>
SESSION_IDLE_HOURS=3
SESSION_ABSOLUTE_HOURS=24
ROOM_IDLE_HOURS=6
```

---

## 12. Deployment on Render

### 12.1 Approach
One **Web Service** serves both the API/WebSocket and the built frontend (Fastify static plugin), so cookies are first-party and there are no CORS issues. One **Render Postgres** database. Optional Render Key Value.

### 12.2 `render.yaml` (Blueprint, create in repo root)
```yaml
services:
  - type: web
    name: night-cards
    runtime: node
    plan: starter
    buildCommand: npm ci && npm run build
    startCommand: npm run start
    healthCheckPath: /healthz
    autoDeploy: true
    envVars:
      - key: NODE_VERSION
        value: 20
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: night-cards-db
          property: connectionString
      - key: SESSION_HASH_SECRET
        generateValue: true
      - key: ALLOWED_ORIGIN
        sync: false

databases:
  - name: night-cards-db
    plan: basic-256mb
```
Add a Render cron job (or in-process scheduler) for the 10-minute expiry cleanup.

### 12.3 Build Scripts (root `package.json`)
- `npm run build`: builds `/packages/shared`, then `/apps/web`, then `/apps/server`; copies web build into the server's static dir.
- `npm run start`: runs DB migrations (`drizzle-kit migrate`) then starts the server.
- `npm run dev`: runs web and server concurrently with hot reload.

### 12.4 Deployment Notes
- Use a paid plan for always-on behavior; free instances sleep and drop WebSocket rooms.
- Trust the proxy (`trustProxy: true`) so `Secure` cookies and protocol detection work behind Render's load balancer.
- WebSockets are supported on Render web services; no special config needed.
- Set `ALLOWED_ORIGIN` to the final domain; custom domain and TLS are managed by Render.
- Run a smoke test against `/healthz` and the register flow after each deploy.

---

## 13. Analytics and Success Metrics

Privacy-first. Only anonymous, aggregate, server-side counters with no content and no identifiers: sessions created, rooms started, cards completed per genre bucket, Stop usage rate, D1 return via same-session reconnects.
Targets for v1 launch cohort: registration completion > 80%, first card drawn within 90 seconds of landing > 70%, crash-free sessions > 99%.

---

## 14. Milestones

| # | Milestone | Deliverables |
|---|---|---|
| M1 | Foundation | Monorepo, CI scripts, Fastify server, Postgres schema + migrations, `/healthz`, `CLAUDE.md` |
| M2 | Sessions and registration | Register API with age gate, cookie sessions, expiry job, `/api/me`, registration UI, tests |
| M3 | Deck engine | Zod card schema, loader, track and genre matching, role assignment, boundaries filter, unit tests |
| M4 | Solo and Pass and Play | Table UI, shuffle/deal/flip animations, timer, Skip/Swap/Pause/Stop, panic hide |
| M5 | Rooms and realtime | Room create/join, lobby, Socket.IO sync, reconnect, host controls |
| M6 | Polish | Sound, haptics, PWA, accessibility pass, reduced motion, settings, delete-now |
| M7 | Hardening and deploy | Rate limits, CSP, E2E tests, `render.yaml`, deploy to Render, smoke test |

---

## 15. Acceptance Criteria (summary)

- A user under 18 cannot create a session or fetch any card by any route (REST or WebSocket).
- A new adult user can register and see their first card in under 90 seconds.
- Two users on separate phones join one room by code and see the same card flip within 300 ms.
- Pressing Stop on any device pauses all devices instantly.
- A session idle for more than 3 hours, or older than 24 hours, is rejected and its data deleted.
- "Delete my data now" leaves no rows for that session.
- No email, name, IP, or exact age is present in the database.
- `render.yaml` deploys a working service from a clean repo with one click.

---

## Appendix A: Card Taxonomy (for `data/cards.json`)

100 cards total. IDs follow `<track>-<genre>-<nn>`.

| Track | Genre | Count | Min players |
|---|---|---|---|
| gay | anal | 6 | 2 |
| gay | oral | 8 | 2 |
| gay | erotic | 6 | 2 |
| gay | threesome | 10 | 3 |
| gay | group | 10 | 4 |
| gay | master_slave | 10 | 2 |
| straight | anal | 6 | 2 |
| straight | oral | 8 | 2 |
| straight | erotic | 6 | 2 |
| straight | threesome | 10 | 3 |
| straight | group | 10 | 4 |
| straight | master_slave | 10 | 2 |

Content rules for the card author:
- Every card is specific: position, duration, who does what, and any restriction.
- Use role placeholders from FR-10.
- Cards where the receiving partner must not be touched in a given way carry that restriction explicitly in the text.
- Set `durationSeconds` wherever the card names a time.
- Master and slave cards must assume the Stop (Safe Signal) mechanic exists; the UI provides it.

## Appendix B: First Prompts for Claude Code

1. "Read PRD.md fully. Create CLAUDE.md and the monorepo scaffold from Section 11.2, then complete Milestone M1."
2. "Implement Milestone M2 exactly as in Sections 4.1 and 7, including the age gate and cleanup job, with tests."
3. "Implement M3 in `/packages/shared` with full unit tests for Section 5."
4. Continue M4 through M7 one at a time, running the quality gates in Section 0 after each.
