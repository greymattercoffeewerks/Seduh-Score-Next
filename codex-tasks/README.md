# Codex task pack — Seduh Score Next

Written 2026-10-10 by Claude Code for hand-off to Codex. Each file in this folder is one
self-contained task. Do them in any order; each is its own branch and its own PR.

Base state: everything below assumes `origin/dev` at or after PR #188 (BTC seeding
tie-break) and release v3.2.0 on `main`.

## Ground rules (apply to every task)

**Git**

- Work in your own clone or `git worktree`, never in a folder another session may share
  (other sessions switch its branch under you).
- Branch from `origin/dev`: `git fetch origin && git switch -c codex/<task-slug> origin/dev`.
- One PR per task, **base `dev`**, never `main`. Do not merge it, and do not enable
  auto-merge. The owner says when CI is green and merges.
- Conventional commit subjects, as in `git log` (`feat(btc): …`, `fix: …`, `chore: …`,
  `docs: …`, `test: …`, `refactor: …`).
- Never commit: `design/mockups/`, `.agents/`, `skills-lock.json`, the brag-output hunk in
  `.gitignore`, `state.json` (it is Claude Code's session scratch file), or this
  `codex-tasks/` folder.

**Read first** (they are short on the rules and long on history; skim, then read the
directory-scoped one for the code you touch)

1. `CLAUDE.md` (repo root) — the non-negotiables.
2. `CONVENTIONS.md` — how this codebase builds things.
3. The `CLAUDE.md` in the directory you are changing (`src/core/`, `src/formats/btc/`,
   `src/formats/cup-taster/`).
4. `Handoffs and Specs/SEDUH-NEXT-HANDOFF.md` is the frozen spec. Never edit it.

**Hard limits for every task here**

- **No new migrations, no `supabase/migrations/**` edits, and nothing against the cloud
  project** (`wxzwanprluqmgoagbkpv`) — no Supabase MCP, no `supabase db push`, no
  dashboard. Task 05 adds a pgTAP test only, run against the _local_ stack.
- No secrets, no `.env` edits, no new dependencies.
- The word **"trio"** is banned anywhere under `src/` (ESLint `no-trio-vocabulary`,
  case-insensitive, including comments).
- Module boundary: `src/core/` never imports from `src/formats/`; BTC never imports from
  Cup Taster and the reverse. Shared wording goes in `src/formats/btc/words.js`, shared
  mechanics in `src/core/`.
- `elapsed_secs` has one writer, `clampElapsed()`. `correct` is a count, never stored.
  `is_test` must stay unmistakable on live surfaces. Do not touch those paths.
- Keep the change as small as the task says. If you find something else wrong, put it in
  the PR description under "Noticed, not fixed" — do not widen the diff.

**Quality bar**

- Tests assert the _invariant_, not merely pass. For each behaviour you add or fix, prove
  the test bites: temporarily break the code, confirm the named test fails, restore it.
  Say in the PR body which mutations you tried.
- UI work: verify at **360px width first**, then wider. Respect the existing a11y
  patterns (`data-focus-key` + `withFocusPreservation`, the persistent `role="status"`
  announcer, `aria-disabled` rather than `disabled` where focus must stay put).
- Run, and paste the tail of the output in the PR body:
  - `npm test`
  - `npm run lint`
  - `npm run format:check` (fix with `npx prettier --write <files>`)
  - `npm run build`
- Docs, because the repo keeps a ground-truth log: add a dated `CHANGELOG.md` entry in the
  existing style (look at the top entries), and when a task closes a ROADMAP item, mark it
  `**CLOSED (<task id>, 2026-10-xx)**` in place — do not delete the line.
- Do not run a "review" yourself and call it done: the owner runs Claude's reviewer agents
  (`code-reviewer`, `test-auditor`, `ui-accessibility-reviewer`, …) on every PR afterwards,
  and those reviews are expected to find something.

**PR body** must have: What / Why, Files touched, How verified (commands + mutation
checks), Noticed-not-fixed, and any decision you had to make that the task text left open.

## Tasks

| #   | File                                                  | Size  | Touches                         |
| --- | ----------------------------------------------------- | ----- | ------------------------------- |
| 01  | `01-btc-round-names-and-score-reading.md`             | small | BTC wording, a11y               |
| 02  | `02-champion-name-clamp.md`                           | small | shared stage CSS (both formats) |
| 03  | `03-persistent-refresh-failure-note.md`               | small | BTC bracket screen UI           |
| 04  | `04-remove-superseded-publish-functions.md`           | small | `core/publish.js` + tests       |
| 05  | `05-pgtap-record-btc-tiebreak-row-lock.md`            | small | pgTAP only (needs local DB)     |
| 06  | `06-demo-payload-totals-from-scoring.md`              | small | BTC demo/test fixtures          |
| 07  | `07-core-reason-validator.md` (optional, medium risk) | med   | `core/` + three formats         |

## Deliberately NOT delegated (keep with Claude Code + the owner)

- Anything that is a migration, RLS policy, RPC or cloud push: the `publish_session`
  clock clamp (`p_snapshot_at`), making `publish_session` read `is_test`/`format` from
  `events`, logging seeding decisions in `score_change_log`. They need
  `schema-guardian` / `security-reviewer` sign-off and a deliberate cloud push.
- Merging PRs and releases.
- Anything on the live-event path that has not been tried on a real test event yet.
