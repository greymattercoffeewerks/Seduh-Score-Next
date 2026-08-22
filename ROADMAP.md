# Seduh Score Next — Roadmap

_State: Phase 0 done; Phase 1 done (T1.1–T1.4); Phase 2 done (T2.1–T2.6); Phase 3 done
(T3.1–T3.3); Phase 4 in progress (T4.1 done) — matches CHANGELOG.md as of 2026-08-22_

The living tracker for the handoff's build plan (§14). The handoff itself stays frozen
as the original spec — this file is what's actually shipped, updated as tasks and phases
close. If the two ever disagree, this file is right about status; the handoff is right
about original design intent.

---

## Current state

| Phase                               | Status                     | What it covers                                                                                |
| ----------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------- |
| Phase 0 — Foundation                | ✅ Done                    | Scaffold, Claude Code tooling, Supabase local stack + CI, doc seed                            |
| Phase 1 — Schema and security       | ✅ Done                    | Core tables, Cup Taster tables, RLS, `WITH CHECK` gate                                        |
| Phase 2 — Core libraries            | ✅ Done                    | `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`, `entitlements`               |
| Phase 3 — Registry and offline      | ✅ Done                    | `registry`, IndexedDB mirror + outbox, sync state panel                                       |
| Phase 4 — Cup Taster                | 🚧 In progress (T4.1 done) | Setup, heat generation, timing (app + manual), scoring, standings/advancement, report, export |
| Phase 5 — Live surfaces             | Not started                | `publish`, `viewer-shell`, projector, phone summary                                           |
| Phase 6 — Guess the Bean, hardening | Not started                | Booth game, accessibility pass, offline soak, dry run                                         |

**Deadline: 4 October 2026, Cup Tasters event.**

**Not tied to a phase task**: the `src/ui/tokens/` design system (colors, typography,
spacing, base styles, self-hosted fonts, `DESIGN.md`, `preview.html`) shipped
2026-08-22, ahead of Phase 4 — see CHANGELOG.md's "Design system foundation" entry.
Closes the open item that used to sit below. No real screen consumes it yet.

---

## Phase 0 — Foundation

Per handoff §14.

| Task                     | Verifier          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 Scaffold            | `code-reviewer`   | ✅ Done — all six AC commands (`dev`, `build`, `test`, `test:e2e`, `lint`, `format:check`) verified passing; no Firebase references; no framework in `package.json`. Found and fixed a real Windows IPv6/IPv4 loopback bug in Vite's dev/preview server that broke Playwright's readiness check. **Amended 2026-08-21** (Handoff Correction 001, applied between Phase 2 and 3): Cloudflare Workers Static Assets configured (`wrangler.jsonc`), not Cloudflare Pages — a pre-existing gap this closed, since Cloudflare Pages config had never actually been built despite §15.4 referring to it. Not deployed, not connected |
| T0.2 Claude Code tooling | `code-reviewer`   | ✅ Done — 9 subagents, the PostToolUse hook, 4 custom ESLint rules. Every AC check demonstrated live: `trioCount` blocked by both the rule and the hook; a `core/`→`formats/` import caught by both the rule and a live `module-boundary-checker` run; an assertion-free test caught by a live `test-auditor` run. Caught and fixed a real word-boundary bug in `no-trio-vocabulary` during verification                                                                                                                                                                                                                       |
| T0.3 Supabase local + CI | `schema-guardian` | ✅ Done — local stack verified working (migrations apply from empty, pgTAP suite runs), CI confirmed green on real GitHub Actions runs (not just locally), `dev`/`main` with `main` protected — verified genuinely: a direct push to `main` was rejected (`GH006`) after fixing an `enforce_admins` gap that had let the first proof attempt silently bypass the rule. Required making the repo public (branch protection needs GitHub Pro for private repos on the free plan)                                                                                                                                                 |
| T0.4 Doc seed            | `code-reviewer`   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Phase 1 — Schema and security

Per handoff §14.

| Task                   | Verifier            | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1.1 Core tables       | `schema-guardian`   | ✅ Done — `orgs`, `org_members`, `people`, `person_merges`, `events`, `event_entries`. Applies cleanly from empty, rollback verified live. Both named negative cases proven: duplicate phone within one org rejected (allowed across orgs); a merge (unlink losing entry → ledger row → delete merged person) succeeds, both entries survive. Review found the handoff's own §5.1 comment stated an incorrect technical rationale for the partial index (a table-level UNIQUE would _not_ actually have broken the merge case — proven empirically); corrected in the migration, the test, and — with the user's go-ahead — the handoff document itself |
| T1.2 Cup Taster tables | `schema-guardian`   | ✅ Done — `ct_stages`, `ct_sets`, `ct_stage_entries`, `ct_heats`, `ct_heat_entries`, `ct_results`, plus `ct_standings`. Applies cleanly, rollback verified. `correct` proven nowhere a stored tally column; negative `elapsed_secs` proven rejected. Review caught two real bugs before either shipped: `ct_standings` silently blending tiebreak-heat results into the primary tally (fixed with a `kind = 'normal'` filter + regression test), and the view missing `security_invoker` (a PG15+/17 RLS-bypass-via-view bug, fixed and confirmed via `pg_class.reloptions`)                                                                            |
| T1.3 RLS               | `security-reviewer` | ✅ Done — policies on all 13 tables, `live_sessions` open-read/org-write. Non-member proven to read zero rows from all 12 org-scoped tables; anon proven to read `live_sessions` but not write it. A missing-GRANTs gap found during my own testing (RLS alone insufficient without table privileges) fixed before review. Review (2 passes) caught a live-exploitable cross-org bug in `live_sessions` (org_id/event_id had no enforced relationship — fixed with a trigger + regression test) and flagged that every write policy being `FOR ALL` means `pg_policies.cmd = 'ALL'`, never `'INSERT'`/`'UPDATE'` — directly informed T1.4's gate query  |
| T1.4 `WITH CHECK` gate | `security-reviewer` | ✅ Done — `supabase/tests/000_with_check_gate.sql`, replacing the Phase 0 `000_sanity.sql` placeholder. AC proven directly: removed one `WITH CHECK` from the live schema, confirmed the gate fails (suite exit 1), restored via `supabase db reset`, confirmed green again                                                                                                                                                                                                                                                                                                                                                                             |

**28 pgTAP assertions total** across the Phase 1 suite (`000`–`003`), all passing.

---

## Phase 2 — Core libraries

Per handoff §14. No UI, no I/O — pure logic in `src/core/`.

| Task                | Verifier                           | Status                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2.1 `partition`    | `scoring-auditor` + `test-auditor` | ✅ Done — exact `N=2..12` table (11 individual cases), invariants across `N=2..64`, `n < min` throws. Fuzzed 2,796 combinations beyond the AC, zero failures                                                                                                                                                             |
| T2.2 `ranking`      | `scoring-auditor` + `test-auditor` | ✅ Done — three-way tie and a non-first tie both tested separately (the AC's own guard against a tie-at-position-1-only test passing with the classic off-by-one present); non-mutation proven by value and reference                                                                                                    |
| T2.3 `advancement`  | `scoring-auditor` + `test-auditor` | ✅ Done — exact-cutoff, tie-wholly-above (no tiebreak), tie-straddling (tiebreak, exact membership), and the "not the whole tie group when it starts above the line" case all proven separately. Fuzzed 20,000 combinations against four invariants; unbreakable                                                         |
| T2.4 `countdown`    | `scoring-auditor` + `test-auditor` | ✅ Done — engine-purity proven by reading the module's own source (hit and fixed the same self-referential-comment trap as Phase 0's `no-trio-vocabulary` rule); clamp-at-zero, background-gap resume, cross-reader agreement all proven with a fake clock. One misleading test title/assertion mismatch found and fixed |
| T2.5 `timeclamp`    | `scoring-auditor`                  | ✅ Done — exact `maxed`/`raw` boundary proven. AC's second clause (prove `no-raw-elapsed-write` fires) had only been a one-off manual check — caught independently by both reviewers, closed with a permanent `Linter`-based test                                                                                        |
| T2.6 `entitlements` | `module-boundary-checker`          | ✅ Done — all five D14 keys present with `minTier: null` and an intent comment; zero `canAccess()` call sites outside its own file/test, confirmed live                                                                                                                                                                  |

**116 tests total** across the whole suite, all passing.

---

## Phase 3 — Registry and offline

Per handoff §14. Verifier: `offline-sync-auditor` throughout.

| Task                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T3.1 `registry`                | ✅ Done — `findPersonByPhone/Email`, `createPerson`, `registerPerson` (phone-then-email dedup), `createEntry` (snapshotting), `mergePeople` (atomic RPC). `security-reviewer` found and closed a **live-exploited cross-org bug**: `merge_people` didn't validate `p_kept_id`'s org, exploitable both via the RPC (when the merged-away person had zero event entries) and via a direct `insert into person_merges` bypassing the RPC entirely. Both closed, re-verified by re-attempting the live exploit. `offline-sync-auditor` independently caught a real contradiction between `registerPerson`'s dedup comment and the frozen schema's own email-uniqueness index, plus an unescaped `ilike` wildcard risk — both fixed |
| T3.2 IndexedDB mirror + outbox | ✅ Done — `db.js`/`outbox.js` (generic FIFO queue engine, injectable handlers — deliberately not hard-coded, since a Cup-Taster-specific handler in `src/core/` would fail §6's boundary test), `confirm_heat` RPC (one atomic transaction, `processed_operations` idempotency ledger, `P0002` conflict exception carrying both versions). All 3 AC clauses proven directly against the real database (53 pgTAP assertions). `security-reviewer` (2 rounds) found and closed a missing `GRANT` that would have broken every real call in production, a `ct_results.set_id`/stage gap matching two earlier precedents, and a test-methodology gap (superuser bypass) that had let both slip past the first review pass          |
| T3.3 Sync state panel          | ✅ Done — `computeSyncState()`, the pure off/live/not-synced derivation (no UI exists yet to render it into — that's Phase 4/5). `stuckOperation` closes T3.2's deferred "poison operation surfaces to a human" gap. `offline-sync-auditor` (2 rounds) found `enabled` was checked before real outbox state — a fail-open violation letting "off" mask genuinely pending/failed work — plus a **real bug in already-merged T3.2 code**: a missing outbox handler bypassed attempts/lastError persistence entirely, fixed in `outbox.js` alongside this task                                                                                                                                                                    |

---

## Phase 4 — Cup Taster

Per handoff §14. Verifiers: `scoring-auditor` + `ui-accessibility-reviewer` on every
task (T4.1 has no UI yet, so only `scoring-auditor` applied this task, plus
`module-boundary-checker`/`test-auditor`/`code-reviewer` per `CLAUDE.md`'s delegation
strategy).

| Task                                 | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.1 Setup: stage plan, sets, roster | ✅ Done — `core/events.createEvent` (format-agnostic), `core/registry.registerEntry` (composes existing registerPerson+createEntry), `formats/cup-taster/setup.js` (`validateStagePlan`, idempotent `createStage`/`ensureSetsForStage`/`createStagePlan`). Deliberately no UI this task (decided with the user — a real screen lands once more of Phase 4 exists to build one against). Not a clean pass across three review rounds: a blocking config-drift bug in `createStage` (a legitimate cutoff correction would be silently discarded as if it were a retry), missing cutoff-monotonicity and canonical-stage-order validation, a concurrent-caller race surfacing raw Postgres errors, six test-quality gaps, and — found in re-verification of the race fix — a bounded-retry loop that itself had an asymmetry (didn't recognize a race resolved in its favor on the final attempt). All closed; see CHANGELOG.md for the full account |

---

## Known open items carried into Phase 4

- **T4.1 shipped no UI.** `setup.js` is a tested logic module only — no screen exists yet
  for an organiser to actually build a roster or a stage plan. The design-tokens layer
  below is ready for one; the first Phase 4 UI task is the one to build it.
- **Supabase cloud project not yet linked.** Phases 0–3 only set up and verified the
  local stack. Linking a cloud project (and the `supabase db push` step CLAUDE.md's Git
  section refers to) is Phase 4+ work, once the schema is stable enough to push.
- **Design tokens shipped 2026-08-22, ahead of Phase 4** (`src/ui/tokens/`: colors,
  typography, spacing, base styles, self-hosted fonts, `DESIGN.md`, `preview.html`) —
  see CHANGELOG.md's "Design system foundation" entry for what shipped and what the
  three parallel reviews (`module-boundary-checker`, `ui-accessibility-reviewer`,
  `code-reviewer`) found and fixed. No real screen consumes it yet — `preview.html` and
  `index.html`'s stylesheet `<link>` are the only current consumers; Phase 4 tasks are
  the first to build a real screen on top of it.
- **No org/membership management UI or RPC exists.** `orgs`/`org_members` are
  deliberately read-only at the RLS+GRANT layer; provisioning the single org for
  October happens via `service_role` outside the app, not through a built flow. Revisit
  if a self-serve org-setup flow is ever needed.
- **Cloudflare Workers is now connected and auto-deploying** (2026-08-22, user action —
  ahead of §15.4's "not before Phase 5 at the earliest" default). The GitHub repo has the
  official "Cloudflare Workers and Pages" App installed; every push gets a Workers Build
  check and a live preview URL, and pushes to `main` build the production script. This
  happened between T3.2's PR being opened and merged — noticed via an unexpected third CI
  check, confirmed intentional with the user before merging. No app code is actually
  served yet (Phase 0's placeholder `main.js`/`index.html` only); revisit this note once
  Phase 4/5 ships something real to that URL.
