# Seduh Score Next

Competition-management tooling for specialty-coffee events, rebuilt from scratch rather
than iterated from the legacy Seduh Score app. Live at
[www.seduhscore.com](https://www.seduhscore.com/).

**Current release:** v3.0.x, the "Gadong" cycle. **Next real event:** Cup Tasters,
4 October 2026.

## What's in it

| Surface                             | Status                | Where                                                                         |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| **Cup Taster**                      | Live                  | `src/formats/cup-taster/`: roster to champion, timing, scoring, live surfaces |
| **BTC** (Barista Team Championship) | Live (2026-09-23)     | `src/formats/btc/`: setup, matches, standings, bracket                        |
| Throwdown, Liga Seduh               | Planned, not started  | `src/formats/throwdown/`, `src/formats/liga-seduh/`                           |
| **Guess the Bean**                  | Live (Community tool) | `src/community/guess-the-bean/`, plus an Android widget in `android/`         |
| **Competition Timer**               | Live (Community tool) | `src/tools/timer/`: no auth, no Supabase                                      |
| Marketing & trust pages             | Live                  | `src/marketing/`: landing, Tour, About, Contact, Privacy, Terms, Neutrality   |

Every format shares the format-agnostic modules in `src/core/`, including ranking,
advancement, time clamping, the registry, the offline outbox and IndexedDB mirror, live
publishing, and the viewer shell. Organisers can keep working offline. Projector and
phone views update live through Supabase Realtime, and public results include an
append-only scoring record.

### Public routes

| Path                                                           | Page                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `/`                                                            | Marketing landing page                                      |
| `/app/`                                                        | Organiser console (sign-in required) and `#/live/*` viewers |
| `/tour/`                                                       | Public format tour                                          |
| `/results/`                                                    | Public results archive                                      |
| `/community/`                                                  | Community hub                                               |
| `/tools/timer/`                                                | Competition Timer                                           |
| `/guess-the-bean/`                                             | Guess the Bean (plus `play/` and `display/`)                |
| `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/neutrality/` | Trust pages                                                 |

## Stack

Vite with vanilla ES modules (no framework), and Supabase for Postgres, Auth, Realtime
and Storage. Every table sits behind RLS, and schema changes go through forward-only
migrations. The project uses ESLint (with four custom rules in `eslint-rules/`) and
Prettier, Vitest for unit tests, pgTAP for database tests, and Playwright for end-to-end
tests. Cloudflare Workers with Static Assets deploys automatically on every merge to
`main`.

## Getting started

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DEFAULT_ORG_ID
npm run dev
```

Local Supabase stack (requires Docker). Its ports are offset by +100 from the CLI
defaults, so Studio is at `http://127.0.0.1:54423`:

```bash
npm run supabase -- start
npm run db:reset   # apply all migrations + supabase/seed.sql to a fresh local database
npm run db:test    # pgTAP suite
```

`seed.sql` provisions a fixed local org and organiser login for development and CI only.

## Scripts

| Command                           | Does                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                     | Vite dev server (`127.0.0.1:5273`)                           |
| `npm run build`                   | Production build; prerenders stable public pages             |
| `npm run preview`                 | Serve the production build locally (`127.0.0.1:4173`)        |
| `npm run prerender:public`        | Prerender the landing, Tour, Community, and Timer pages      |
| `npm test`                        | Vitest unit tests                                            |
| `npm run test:watch`              | Vitest in watch mode                                         |
| `npm run test:e2e`                | Playwright: `built-app`, `dev-harnesses`, `dev-app` projects |
| `npm run lint`                    | ESLint                                                       |
| `npm run format` / `format:check` | Prettier                                                     |
| `npm run db:reset`                | Reset the local Supabase database from migrations            |
| `npm run db:test`                 | Run the pgTAP suite against the local database               |

The `dev-app` Playwright project drives the real organiser app, so it needs the local
Supabase stack running with the seed applied.

## Workflow

- `dev` is the working branch. `main` is protected, so changes reach it through pull
  requests.
- **Merging to `main` deploys only the frontend. It never touches the cloud database.**
  After merging a PR that adds a migration, push that migration to the cloud Supabase
  project as a separate step.
- A migration that has reached the cloud project is never edited again. Fixes go in a
  new migration.

## Documentation

- [`Handoffs and Specs/SEDUH-NEXT-HANDOFF.md`](<Handoffs and Specs/SEDUH-NEXT-HANDOFF.md>):
  the frozen original spec, covering vocabulary, schema, the permission model and the
  build plan.
- [`ROADMAP.md`](ROADMAP.md): current phase status and known open items.
- [`CHANGELOG.md`](CHANGELOG.md): what shipped, in what order, and why.
- [`CONVENTIONS.md`](CONVENTIONS.md): how this codebase builds things day to day.
- [`CLAUDE.md`](CLAUDE.md) and the directory-scoped `CLAUDE.md` files: orientation and
  cross-format non-negotiables.

## License

See [`LICENSE.md`](LICENSE.md). The code is publicly viewable for transparency and
portfolio purposes only. No license to copy, modify, or deploy it is granted.
