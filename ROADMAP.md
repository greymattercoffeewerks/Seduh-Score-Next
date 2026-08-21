# Seduh Score Next — Roadmap

_State: Phase 0 in progress (T0.1–T0.3 done, T0.4 landing this entry) — matches
CHANGELOG.md as of 2026-08-21_

The living tracker for the handoff's build plan (§14). The handoff itself stays frozen
as the original spec — this file is what's actually shipped, updated as tasks and phases
close. If the two ever disagree, this file is right about status; the handoff is right
about original design intent.

---

## Current state

| Phase                               | Status                          | What it covers                                                                                |
| ----------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Phase 0 — Foundation                | 🚧 In progress (T0.1–T0.3 done) | Scaffold, Claude Code tooling, Supabase local stack + CI, doc seed                            |
| Phase 1 — Schema and security       | Not started                     | Core tables, Cup Taster tables, RLS, `WITH CHECK` gate                                        |
| Phase 2 — Core libraries            | Not started                     | `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`, `entitlements`               |
| Phase 3 — Registry and offline      | Not started                     | `registry`, IndexedDB mirror + outbox, sync state panel                                       |
| Phase 4 — Cup Taster                | Not started                     | Setup, heat generation, timing (app + manual), scoring, standings/advancement, report, export |
| Phase 5 — Live surfaces             | Not started                     | `publish`, `viewer-shell`, projector, phone summary                                           |
| Phase 6 — Guess the Bean, hardening | Not started                     | Booth game, accessibility pass, offline soak, dry run                                         |

**Deadline: 4 October 2026, Cup Tasters event.**

---

## Phase 0 — Foundation

Per handoff §14.

| Task                     | Verifier          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 Scaffold            | `code-reviewer`   | ✅ Done — all six AC commands (`dev`, `build`, `test`, `test:e2e`, `lint`, `format:check`) verified passing; no Firebase references; no framework in `package.json`. Found and fixed a real Windows IPv6/IPv4 loopback bug in Vite's dev/preview server that broke Playwright's readiness check                                                                                                                                                                                |
| T0.2 Claude Code tooling | `code-reviewer`   | ✅ Done — 9 subagents, the PostToolUse hook, 4 custom ESLint rules. Every AC check demonstrated live: `trioCount` blocked by both the rule and the hook; a `core/`→`formats/` import caught by both the rule and a live `module-boundary-checker` run; an assertion-free test caught by a live `test-auditor` run. Caught and fixed a real word-boundary bug in `no-trio-vocabulary` during verification                                                                       |
| T0.3 Supabase local + CI | `schema-guardian` | ✅ Done — local stack verified working (migrations apply from empty, pgTAP suite runs), CI confirmed green on real GitHub Actions runs (not just locally), `dev`/`main` with `main` protected — verified genuinely: a direct push to `main` was rejected (`GH006`) after fixing an `enforce_admins` gap that had let the first proof attempt silently bypass the rule. Required making the repo public (branch protection needs GitHub Pro for private repos on the free plan) |
| T0.4 Doc seed            | `code-reviewer`   | 🚧 In progress — this entry                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Known open items carried into Phase 1

- **Supabase cloud project not yet linked.** T0.3 only set up and verified the local
  stack. Linking a cloud project (and the `supabase db push` step CLAUDE.md's Git
  section refers to) is Phase 1+ work, once real schema exists to push.
- **`supabase/tests/000_sanity.sql` is a placeholder.** Phase 1 (T1.1) adds the real
  schema/RLS pgTAP suite; the sanity file can be renumbered or kept as a basic
  "pgTAP is wired up" check once real coverage exists.
- **Design tokens (`src/ui/tokens/`) are an empty placeholder directory.** Real tokens
  land starting Phase 4, when UI work begins.
