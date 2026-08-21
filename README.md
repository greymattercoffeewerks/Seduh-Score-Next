# Seduh Score Next

The next generation of Seduh Score's competition-management tooling — a ground-up
rebuild, not an iteration on the live app. In scope: **Cup Taster** (full competition
management, roster to champion) and **Guess the Bean** (a temporary Coffee Con booth
game). Live Seduh Score's Throwdown, Liga, and BTC stay where they are, in maintenance
mode.

First real run: **4 October 2026, Cup Tasters event.**

For the full design rationale, schema, and build plan, see
[`Handoffs and Specs/SEDUH-NEXT-HANDOFF.md`](<Handoffs and Specs/SEDUH-NEXT-HANDOFF.md>)
— the frozen spec this project builds against. For how this codebase actually builds
things day to day, see [`CONVENTIONS.md`](CONVENTIONS.md). For orientation if you're
Claude Code, see [`CLAUDE.md`](CLAUDE.md).

## Stack

Vite + vanilla ES modules (no framework). Supabase — Postgres, Auth, Storage, Edge
Functions. ESLint + Prettier. Vitest for unit tests, Playwright for end-to-end. Deployed
to Cloudflare Workers with Static Assets via git push (configured, not connected).

## Getting started

```bash
npm install
npm run dev
```

Local Supabase stack (requires Docker):

```bash
npm run supabase -- start
npm run db:reset   # apply all migrations to a fresh local database
```

## Scripts

| Command                           | Does                                              |
| --------------------------------- | ------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                   |
| `npm run build`                   | Production build                                  |
| `npm run preview`                 | Serve the production build locally                |
| `npm test`                        | Vitest unit tests                                 |
| `npm run test:watch`              | Vitest in watch mode                              |
| `npm run test:e2e`                | Playwright end-to-end tests                       |
| `npm run lint`                    | ESLint                                            |
| `npm run format` / `format:check` | Prettier                                          |
| `npm run db:reset`                | Reset the local Supabase database from migrations |
| `npm run db:test`                 | Run the pgTAP suite against the local database    |

## Status

Phase 0 (Foundation) — see [`ROADMAP.md`](ROADMAP.md) for current phase status and
[`CHANGELOG.md`](CHANGELOG.md) for what's shipped and why.

## License

See [`LICENSE.md`](LICENSE.md) — publicly viewable for transparency and portfolio
purposes only; no license to copy, modify, or deploy is granted.
