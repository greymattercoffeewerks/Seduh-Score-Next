# Seduh Score Next — Roadmap

_State: Phase 0 done; Phase 1 done (T1.1–T1.4); Phase 2 done (T2.1–T2.6) — matches
CHANGELOG.md as of 2026-08-21_

The living tracker for the handoff's build plan (§14). The handoff itself stays frozen
as the original spec — this file is what's actually shipped, updated as tasks and phases
close. If the two ever disagree, this file is right about status; the handoff is right
about original design intent.

---

## Current state

| Phase                               | Status      | What it covers                                                                                |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Phase 0 — Foundation                | ✅ Done     | Scaffold, Claude Code tooling, Supabase local stack + CI, doc seed                            |
| Phase 1 — Schema and security       | ✅ Done     | Core tables, Cup Taster tables, RLS, `WITH CHECK` gate                                        |
| Phase 2 — Core libraries            | ✅ Done     | `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`, `entitlements`               |
| Phase 3 — Registry and offline      | Not started | `registry`, IndexedDB mirror + outbox, sync state panel                                       |
| Phase 4 — Cup Taster                | Not started | Setup, heat generation, timing (app + manual), scoring, standings/advancement, report, export |
| Phase 5 — Live surfaces             | Not started | `publish`, `viewer-shell`, projector, phone summary                                           |
| Phase 6 — Guess the Bean, hardening | Not started | Booth game, accessibility pass, offline soak, dry run                                         |

**Deadline: 4 October 2026, Cup Tasters event.**

---

## Phase 0 — Foundation

Per handoff §14.

| Task                     | Verifier          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 Scaffold            | `code-reviewer`   | ✅ Done — all six AC commands (`dev`, `build`, `test`, `test:e2e`, `lint`, `format:check`) verified passing; no Firebase references; no framework in `package.json`. Found and fixed a real Windows IPv6/IPv4 loopback bug in Vite's dev/preview server that broke Playwright's readiness check                                                                                                                                                                                |
| T0.2 Claude Code tooling | `code-reviewer`   | ✅ Done — 9 subagents, the PostToolUse hook, 4 custom ESLint rules. Every AC check demonstrated live: `trioCount` blocked by both the rule and the hook; a `core/`→`formats/` import caught by both the rule and a live `module-boundary-checker` run; an assertion-free test caught by a live `test-auditor` run. Caught and fixed a real word-boundary bug in `no-trio-vocabulary` during verification                                                                       |
| T0.3 Supabase local + CI | `schema-guardian` | ✅ Done — local stack verified working (migrations apply from empty, pgTAP suite runs), CI confirmed green on real GitHub Actions runs (not just locally), `dev`/`main` with `main` protected — verified genuinely: a direct push to `main` was rejected (`GH006`) after fixing an `enforce_admins` gap that had let the first proof attempt silently bypass the rule. Required making the repo public (branch protection needs GitHub Pro for private repos on the free plan) |
| T0.4 Doc seed            | `code-reviewer`   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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

## Known open items carried into Phase 3

- **Supabase cloud project not yet linked.** Phases 0–2 only set up and verified the
  local stack. Linking a cloud project (and the `supabase db push` step CLAUDE.md's Git
  section refers to) is Phase 3+ work, once the schema is stable enough to push.
- **Design tokens (`src/ui/tokens/`) are an empty placeholder directory.** Real tokens
  land starting Phase 4, when UI work begins.
- **No org/membership management UI or RPC exists.** `orgs`/`org_members` are
  deliberately read-only at the RLS+GRANT layer; provisioning the single org for
  October happens via `service_role` outside the app, not through a built flow. Revisit
  if a self-serve org-setup flow is ever needed.
