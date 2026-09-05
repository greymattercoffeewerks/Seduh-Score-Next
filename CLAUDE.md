# Seduh Score Next — Claude Code orientation

_State: Phase 0–5 done. See `ROADMAP.md` for current phase and `CHANGELOG.md` for
what's shipped, in what order, and why — this file no longer narrates that history
(it used to; see below for where it moved)._

Read these before touching anything:

1. `Handoffs and Specs/SEDUH-NEXT-HANDOFF.md` — the frozen spec. Vocabulary, schema,
   permission model, the full build plan (§14, T0.1–T6.x), Definition of Done (§11). This
   never gets edited to reflect progress (§0) — it's the original brief.
2. `CONVENTIONS.md` — how this codebase actually builds things, backfilled from what's
   shipped.
3. `CHANGELOG.md` — what's shipped, in what order, and why. The ground truth for "where
   are we."
4. `ROADMAP.md` — living phase-status tracker (the handoff's build plan, kept current —
   unlike the handoff itself).

This file carries only the rules that apply everywhere in the repo. Directory-scoped
`CLAUDE.md` files carry the module-specific conventions and history — Claude Code loads
them automatically once you're working in that subtree, so day-to-day work only pays for
the context it actually touches:

- [src/core/CLAUDE.md](src/core/CLAUDE.md) — shared, format-agnostic modules and `main.js`
  wiring.
- [src/formats/cup-taster/CLAUDE.md](src/formats/cup-taster/CLAUDE.md) — Cup Taster.
- [src/formats/throwdown/CLAUDE.md](src/formats/throwdown/CLAUDE.md) — Throwdown (not started).
- [src/formats/liga-seduh/CLAUDE.md](src/formats/liga-seduh/CLAUDE.md) — Liga Seduh (not started).
- [src/formats/bbtc/CLAUDE.md](src/formats/bbtc/CLAUDE.md) — BBTC (not started).

Any invariant that applies across _every_ format (not just one) belongs here, in
Non-negotiables — not duplicated into each scoped file.

---

## Session state

Read `state.json` first, before Handoff/CONVENTIONS/CHANGELOG. Rewrite it after
every step — current task state only, never a narrative of what happened.
When kb-sync closes a task, state.json resets to the next task's skeleton.

## Delegation strategy

The 9 subagents in `.claude/agents/` per handoff §13:

- **After any migration/schema change** → `schema-guardian` (constraints, indexes,
  rollback blocks — and _verify_ the rollback by actually running it in a transaction,
  not just reading it).
- **After any RLS policy, RPC, or Storage change** → `security-reviewer`. Blocking, per
  the Definition of Done — never skip it.
- **After `core/ranking`, `core/advancement`, `core/timeclamp`, or `formats/*/scoring`
  changes** → `scoring-auditor`. Nothing in Phase 4 may start before these three pass
  this review (handoff §14).
- **After any change under `src/**`** → `module-boundary-checker` — the §6 test is "can
  a future format reuse this module without editing it?"
- **After any test file changes** → `test-auditor` — checks that tests assert the
  invariant, not merely pass.
- **After any UI change** → `ui-accessibility-reviewer`, verified at 360px first, before
  wider breakpoints.
- **After outbox/IndexedDB/sync changes** (Phase 3 onward) → `offline-sync-auditor`.
- **After any code change, any file** → `code-reviewer`.
- **End of every task** → `kb-sync`.

Run the relevant reviewers in parallel (single message, multiple Agent calls) when a
change touches more than one concern — e.g. a migration that's both schema and RLS gets
`schema-guardian` + `security-reviewer` together.

**Every review this project runs should be expected to find something** (handoff §13).
Treat a clean review as the surprising outcome, not the expected one.

**Cost note (2026-08-22, user decision):** `kb-sync` and `module-boundary-checker` run
on a cheaper model (`model: haiku` in their `.claude/agents/*.md` frontmatter) — both are
comparatively mechanical (session-log writing; import-path/grep-based boundary checks).
`schema-guardian`, `security-reviewer`, `scoring-auditor`, `offline-sync-auditor`, and
`code-reviewer` stay on the full model deliberately — these are the correctness/security
gates the "every review should find something" discipline above depends on, and Phase 4's
own review cycles (T4.1, T4.2) already surfaced real bugs on second and third passes that
a weaker reviewer could plausibly have missed. `test-auditor` and `ui-accessibility-reviewer`
were considered and kept on the full model too.

---

## Non-negotiables

These apply to every format — Cup Taster today, Throwdown/Liga Seduh/BBTC later. Keep
them here, once; a format's own scoped `CLAUDE.md` should link back to this section
rather than restate it.

### Vocabulary — "trio" is banned

`CUP-TASTER-SPEC.md` v4.0 used "trio" to mean _set_, and "set" to mean the stage's whole
collection of sets — that inversion is not carried forward (handoff §2). Enforced by the
`no-trio-vocabulary` ESLint rule under `src/`, case-insensitive, across identifiers,
strings, and comments.

### The module boundary (handoff §6)

**Can a future format reuse this module without editing it?** `src/core/` must never
import from `src/formats/`, and format-specific logic must never leak into `src/core/`.
Enforced by `no-core-format-import`; `module-boundary-checker` catches the subtler cases
a static rule can't (indirect coupling, reimplementing a `core/` primitive inside a
format). v4.x's parallel timer implementation — one in `shared/timer.js`, a second,
incompatible one hand-rolled inside Cup Taster because the first couldn't be reused — is
the specific defect this boundary exists to prevent from recurring. This is also the test
Throwdown/Liga Seduh/BBTC get held to on day one: if building one of them requires
editing something in `src/core/`, that's a signal the module wasn't actually
format-agnostic yet.

### `correct` is a count, never a column (handoff §5.2)

`ct_results` stores one row per cupper per set. Standings positions and tallies are
always derived (a view or a pure function), never persisted as a field. Enforced by
`no-derived-storage`; `scoring-auditor` verifies by reading, since the rule only catches
the obvious property/assignment shapes.

### `elapsed_secs` has exactly one writer: `clampElapsed()`

Both the tap path and the manual-entry path must call it — it's the sole duration cap
(handoff §5.2, §6). Enforced by `no-raw-elapsed-write`.

### Entitlements are a stub, not a system (D14)

`entitlements.js` returns permissive for every key. No call site should branch on a
tier or gate result anywhere in this repo yet — that's explicitly out of scope until a
real entitlement system is built.

### `is_test` renders unmistakably, from the first commit (D9)

Designed in from the first live-surface rendering task, not logged as a defect
afterward. v4.x demo mode was indistinguishable from a real event in the audience view —
that is the failure this project exists to close.

### Definition of Done (handoff §11, restated)

A task is done when: acceptance criteria are demonstrated, not asserted · tests pass
including the negative cases the task names · lint/format clean, hook not firing · no
new TODO without a linked issue · scoring/ranking/timing changes have `scoring-auditor`
sign-off · schema/policy/Storage changes have `security-reviewer` sign-off including a
negative test proving a non-member reads zero rows · UI changes have
`ui-accessibility-reviewer` sign-off at 360px first · outbox/sync changes have
`offline-sync-auditor` sign-off · a session log entry exists (`kb-sync`) · every
migration has a rollback block, applies cleanly from an empty database, and — once
pushed to the linked cloud project — is never edited again (a fix is a new migration).

---

## Git — dev/main, main protected

`dev` is the working branch; `main` is protected (D26) — direct pushes to `main` are
rejected (`GH006`), changes land via PR. This required making the GitHub repo public
(branch protection is a GitHub Pro feature for private repos on the free plan); the
handoff's own `LICENSE.md` already frames this repo as publicly viewable for
transparency/portfolio purposes, so this aligns with that, not against it.

Migrations: local dev (`npm run db:reset`) first, then push to the linked cloud project
once verified — see the Repo section below for the project details and how the first
push (2026-08-30) was actually done (the Supabase MCP's `apply_migration`, not
`supabase db push` — this machine isn't `supabase link`-ed to the cloud project yet).

---

## Architecture (map only — see scoped `CLAUDE.md` files for the "why")

```
Handoffs and Specs/SEDUH-NEXT-HANDOFF.md   ← frozen spec, never edited for progress
src/
  core/                         ← shared, format-agnostic modules + main.js wiring.
                                   See src/core/CLAUDE.md.
  formats/
    cup-taster/                 ← scoring, timing-surface, entry-surface, viewer-body,
                                   analytics. See src/formats/cup-taster/CLAUDE.md.
    throwdown/                  ← not started. See src/formats/throwdown/CLAUDE.md.
    liga-seduh/                 ← not started. See src/formats/liga-seduh/CLAUDE.md.
    bbtc/                       ← not started. See src/formats/bbtc/CLAUDE.md.
  ui/
    tokens/                     ← design tokens (plain CSS custom properties)
  main.js                       ← composition root; conventions live in
                                   src/core/CLAUDE.md alongside the rest of the wiring.
supabase/
  migrations/                   ← forward-only, each with a tested -- rollback: block
  seed.sql                      ← local-dev/CI-only: a fixed org + an authenticated
                                   login (bcrypt via pgcrypto). Applied by `db reset`/a
                                   fresh `start`, never by a bare `db push`.
  tests/                        ← pgTAP, one file per concern, numbered
                                   (000_with_check_gate.sql runs first, per T1.4)
  config.toml                   ← local stack, ports offset +100 (5442x) from the CLI
                                   default so this project's stack can run alongside
                                   the sibling Kira-Kira repo's stack
eslint-rules/                   ← the 4 custom rules enforcing this project's contracts
                                   (no-raw-elapsed-write has its own Linter-based test)
tests/e2e/                      ← Playwright — see CONVENTIONS.md for the three-project
                                   split (dev-harnesses / dev-app / prod smoke) and why.
.claude/
  agents/                       ← the 9 subagents
  hooks/lint-on-write.cjs       ← PostToolUse: ESLint on every .js write
```

## Repo

Local: `C:\Users\mfosa\OneDrive\Documents\seduh-score-next`
GitHub: `github.com/greymattercoffeewerks/Seduh-Score-Next` (public)
Supabase project: **linked, 2026-08-30** — cloud project "Seduh Score Next"
(`wxzwanprluqmgoagbkpv`, org "Grey Matter Coffee Werks", region `ap-southeast-1`), all
migrations pushed via the Supabase MCP's `apply_migration` (not yet linked locally via
`supabase link` — that needs the project's DB password from the dashboard, not set up
this session; pushing further migrations can keep using the MCP, or `supabase link` once
that password is in hand). A real org + organiser login were provisioned directly (see
CHANGELOG.md's dated entry) — credentials given to the user in chat, not committed
anywhere. Local dev still defaults to the local stack (`npm run supabase -- start`,
Studio at `http://127.0.0.1:54423`) — nothing about local dev changed.

**Pushing a migration to the cloud project is a separate, manual step from merging its
PR — merging to `main` only deploys the frontend (Cloudflare Workers Builds); it never
touches the cloud database.** Found the hard way, 2026-09-05: three migrations
(`events_anon_safe_read`, `record_heat_time_overwrite_scoped_to_manual`,
`delete_test_event_rpc`) landed on `main` across PRs #49–#51 and sat live-deployed on the
frontend for hours to a day+ before anyone noticed the cloud database was never updated
to match — surfaced only when a user hit "Something went wrong saving that" clicking the
brand-new Delete button in production, root-caused to the RPC function not existing on
the cloud project. **After merging any PR that adds/changes a migration, immediately
check whether it's been pushed to the cloud project too** — compare
`supabase/migrations/` against `mcp__<supabase-project>__list_migrations`'s own output,
and push whatever's missing via `apply_migration` before considering the task done.
Current phase: check `ROADMAP.md`.
