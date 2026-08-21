# Changelog — Seduh Score Next

Backfilled 2026-08-21 for Phase 0 (this file didn't exist while T0.1–T0.3 shipped, all in
the same session). From here forward, an entry lands before any session that ships code
closes.

---

## Phase 0 — Foundation · 2026-08-21

### T0.4 Doc seed

`CLAUDE.md`, `CONVENTIONS.md` (this file's sibling, backfilled from what T0.1–T0.3
established), `CHANGELOG.md`, `ROADMAP.md`, and this README replacing the one-line stub.
Verifier: `code-reviewer`. All 9 agents named in `CLAUDE.md`'s delegation strategy exist
as files under `.claude/agents/` (confirmed T0.2) — none claimed as ported without a
read source; the ported six were read from the sibling Kira-Kira repo before adaptation.

### T0.3 Supabase local stack + CI

Local dev stack via `supabase init`/`supabase start`, verified working end to end:
migrations apply from an empty database, the pgTAP suite runs. Ports offset +100 from
the CLI defaults (54421–54429 instead of 54321–54329) — the sibling Kira-Kira repo's own
local stack was running on the default range during setup, and the two projects need to
coexist on this machine without a collision.

`supabase/tests/000_sanity.sql` added as a Phase 0 placeholder: with zero real schema
yet, `supabase test db` exits `NOTESTS`/1 against an empty `tests/` directory, which
would make CI red before any real work lands. Phase 1 (T1.1+) adds the actual schema/RLS
suite; this file can then be renumbered or left as a basic pgTAP sanity check.

`.github/workflows/ci.yml` runs two jobs — `app` (format/lint/test/build) and `supabase`
(migrations from an empty database, then the pgTAP suite) — ported from Kira-Kira's CI
shape, including its documented tree-shaking pitfall: `VITE_SUPABASE_URL`/`ANON_KEY`
must be set in the build step, or Vite's minifier proves `createClient()` unreachable
and silently drops `@supabase/supabase-js` from the bundle without failing the build.

`db:reset`/`db:test` npm scripts added as the migration-runner entry points.

**dev/main with main protected (D26).** Setting this up surfaced a real constraint: both
classic branch protection and the newer repository-rulesets API return 403 ("Upgrade to
GitHub Pro or make this repository public") on a private repo under the free plan.
Presented to the user as a genuine tradeoff — skip enforced protection, wait for a paid
upgrade, or make the repo public. The user chose public, which the handoff's own
`LICENSE.md` already frames as viewable-for-transparency, so this doesn't cut against
anything already decided. `gh` CLI installed via winget for this session (wasn't present
on the machine); authentication is inherently interactive, so the user ran
`gh auth login` themselves.

Protection was verified genuinely, not just configured: a first attempt at proving "push
to `main` rejected" actually **succeeded** silently, because `enforce_admins` had been
left `false` and the pushing account (repo owner) bypassed the rule entirely — a
false-positive proof that would have shipped unnoticed if not checked against the actual
push result. Fixed by enabling `enforce_admins`; a second direct push then failed with
the expected `GH006: Protected branch update failed for refs/heads/main`. The accidental
first commit was cleaned up through an actual PR (#1, squash-merged) rather than a force-
push, which doubled as a live proof that the intended `dev`→`main` PR workflow works —
CI ran and passed both jobs on GitHub itself before the merge, not just locally.

### T0.2 Claude Code tooling

Nine subagents in `.claude/agents/`: `code-reviewer`, `schema-guardian`,
`security-reviewer`, `ui-accessibility-reviewer`, `offline-sync-auditor`, `kb-sync`
adapted from the sibling Kira-Kira repo (read directly, then rewritten against this
project's own schema and rules — `code-reviewer` additionally merges in a
locked-contracts section modeled on live Seduh Score's own `code-reviewer` agent);
`scoring-auditor`, `module-boundary-checker`, `test-auditor` authored fresh for this
project's own concerns (`scoring-auditor` is Cup Taster's analogue to a money-correctness
gate; the other two have no Kira-Kira equivalent).

Four custom ESLint rules (`no-trio-vocabulary`, `no-derived-storage`,
`no-core-format-import`, `no-raw-elapsed-write`) plus the `.claude/hooks/lint-on-write.cjs`
PostToolUse hook, ported from Kira-Kira's hook essentially unchanged.

Every check named in the task's AC was demonstrated, not just written:

- Planted `const trioCount = 5` in `src/core/` and proved both the ESLint rule and the
  hook (invoked directly with a synthetic tool payload) block it, exit code 2. This
  caught a real bug in the first version of `no-trio-vocabulary`: a plain `\btrio\b`
  regex doesn't match inside `trioCount` — there's no word-boundary between "trio" and
  "Count" in one continuous identifier, which is exactly the AC's own test case. Fixed
  with proper camelCase/snake_case word segmentation before comparing.
- Planted a `src/core/` → `src/formats/` import and proved both the ESLint rule and a
  live run of the `module-boundary-checker` agent instructions (via a general-purpose
  agent following the exact charter, since custom project subagents aren't hot-loaded
  mid-session) catch it.
- Planted an assertion-free test (`expect(true).toBe(true)`) and proved a live run of
  the `test-auditor` instructions catches it.

Verifier: self-verified (no `code-reviewer` existed yet to review its own creation —
matches the same bootstrapping order Kira-Kira went through).

### T0.1 Scaffold

Vite + vanilla ES modules, ESLint 9 (flat config) + Prettier, Vitest, Playwright, the
folder tree (`src/core`, `src/formats/cup-taster`, `src/ui/tokens`, `supabase/migrations`,
`supabase/tests`, `eslint-rules`, `tests/e2e`), `LICENSE.md` copied verbatim from live
Seduh Score.

All six AC commands verified passing on a real run: `dev`, `build`, `test`, `test:e2e`,
`lint`, `format:check`. No Firebase references anywhere in the repo (`grep -ri firebase`
clean). No frontend framework in `package.json`.

Caught and fixed a real bug during verification: Vite's default host resolves to the
IPv6 loopback first on this Windows machine, so Playwright's readiness check against
`127.0.0.1` got connection-refused even though the server was actually listening.
`server.host`/`preview.host` pinned to `127.0.0.1` in `vite.config.js` fixes it.

Verifier: self-verified (same bootstrapping-order note as T0.2).
