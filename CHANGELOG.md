# Changelog — Seduh Score Next

Backfilled 2026-08-21 for Phase 0 (this file didn't exist while T0.1–T0.3 shipped, all in
the same session). From here forward, an entry lands before any session that ships code
closes.

---

## Handoff correction 001 — hosting target · 2026-08-21

Applied `HANDOFF-CORRECTION-001.md` (user-supplied, filed against the frozen spec) between
Phase 2 and Phase 3, per its own "apply after Phase 2 completes" instruction. Not a
progress edit — a correction to §0's own stated exception ("only to correct an error").

**What changed**: hosting target is **Cloudflare Workers with Static Assets**, not
Cloudflare Pages (D29). Cloudflare's own guidance moved Workers-first for new projects
once feature parity was reached (March 2026); Pages remains supported but no longer gets
new platform investment. Greenfield repo, so no migration cost — a config choice made
once, not a re-platform.

Folded into `SEDUH-NEXT-HANDOFF.md`: §3 (Stack), §12 (D29 appended to the decision
record), §14 T0.1's task body, §15.4 item 3. `HANDOFF-CORRECTION-001.md` deleted per its
own instruction once folded.

**T0.1 had a pre-existing gap this surfaced**: the original handoff's §15.4 referred to
"Cloudflare Pages deployment... configured in T0.1," but T0.1's own task body never
actually described that clause — Phase 0's real T0.1 work only mentioned Cloudflare in
README prose, no config file ever existed. Closed now, with the corrected target: added
`wrangler` as a devDependency, `wrangler.jsonc` (an `assets` block pointing at `./dist`,
`compatibility_date` set to today), and `.wrangler/`/`.dev.vars*` to `.gitignore`. Not
deployed, repo not connected — configuration only, matching the correction's explicit
instruction. Validated genuinely: `npx wrangler deploy --dry-run` reads the real `dist/`
build output and exits cleanly without deploying or requiring auth. `README.md`'s stack
line updated to match. Confirmed T0.1's AC still holds unchanged post-amendment:
`dev`/`build`/`test`/`test:e2e`/`lint`/`format:check` all re-run and passing.

Verifier: `code-reviewer`, per the correction's own verification section (a documentation
change). `grep -c "Cloudflare Pages" SEDUH-NEXT-HANDOFF.md` returns 1, and that one hit is
D29's own text explaining the change — matching the correction's exact acceptance
criterion ("returns 0 except where the record deliberately explains the change").

---

## Phase 2 — Core libraries · 2026-08-21

Six pure modules in `src/core/`, per handoff §14 T2.1–T2.6 — no UI, no I/O. 116
tests passing across the whole suite.

### T2.1 `partition`

`partition(n, { target = 4, min = 2 })` → heat sizes: `heats = ceil(n / target)`,
reduced if it would force a heat below `min`, then `n` distributed as evenly as
possible across that many heats (sizes differ by at most 1, larger heats first).

Verifier: `scoring-auditor` + `test-auditor`. AC's exact `N=2..12` table tested
case by case (11 separate assertions, not a loop that could silently pass on a
subset), invariants (sum=N, min≥2, max−min≤1) tested individually across
`N=2..64`, `n < min` throws. `scoring-auditor` additionally fuzzed 2,796
`n`/`target`/`min` combinations beyond the AC's own requirement — zero failures.

### T2.2 `ranking`

`rank(items, compareFn)` — competition ranking (ties share a position, the next
distinct row's position is its 1-based sort index, which skips by tie size
automatically). `chainComparators(...)` combines sort keys in priority order
(e.g. §7.3's "most correct, then fastest time").

Verifier: `scoring-auditor` + `test-auditor`. Both AC-named cases tested
separately: a three-way tie at the front, and a two-way tie in the middle of the
list (not first) — the AC's own point that a tie-at-position-1 test alone can
pass even with the classic off-by-one bug present. Non-mutation of the input
array proven by both value and referential-identity checks.

### T2.3 `advancement`

`computeAdvancement(rankedEntries, cutoff)` — walks position groups in rank
order; a group that would push the cumulative count past `cutoff` is withheld
in full as `tiedAtBorder` rather than being resolved (D20's fixed-field rule,
§7.2).

Verifier: `scoring-auditor` + `test-auditor`. All AC-named cases proven
separately: exact-cutoff with no tie, a tie wholly above the cutoff (no
tiebreak flagged), a tie straddling the cutoff (tiebreak flagged, exact
membership), and — the specific "not the whole tie group when it starts above
the line" case — two earlier wholly-above tie groups plus a genuine border tie,
proving `tiedAtBorder` holds only the border group. `scoring-auditor`
additionally fuzzed 20,000 group-size/cutoff combinations against four
invariants; could not construct a breaking case.

### T2.4 `countdown`

`remainingSecs(startedAt, durationSecs, now)` / `isExpired(...)` — pure
arithmetic, no timer or DOM reference, matching §8.2's "publish `started_at` +
`duration_secs` once, every viewer computes locally" design.

Verifier: `scoring-auditor` + `test-auditor`. Engine-purity proven by a
grep-style test reading the module's own source — which required a fix
mid-task: the naive regex matched the module's own header comment explaining
_why_ no timers exist (the same self-referential trap the Phase 0
`no-trio-vocabulary` rule hit), fixed by requiring call-parens/property-access
rather than bare words. Clamp-at-zero, a background-gap resume, and two
readers' clocks landing on the same result all proven with an injected fake
clock throughout (no `Date.now()` anywhere in the test file).

**One finding from `test-auditor`, fixed**: a test titled "two instances …
different now-values … agree" passed the identical `now` value to both calls,
so it only proved determinism, not what its name claimed. Rewritten into two
tests — two close-but-different `now` reads within the same second agreeing,
plus a control case proving a `now` crossing a second boundary genuinely
changes the result (guarding the first test against a version of the function
that ignores `now` entirely).

### T2.5 `timeclamp`

`clampElapsed(secs, durationSecs)` → `{ elapsed, raw, maxed }` — the sole
`elapsed_secs` writer (§5.2, §6).

Verifier: `scoring-auditor`. At/beyond-duration boundary proven exactly
(`maxed: true`, `elapsed === durationSecs`, `raw` preserves the actual input).

**A real AC gap, caught independently by both `scoring-auditor` and
`test-auditor`**: the AC's second clause — "prove `no-raw-elapsed-write` fires
on a direct assignment bypassing it" — had only been demonstrated as a one-off
manual proof during Phase 0/2 work, not as a permanent, CI-enforced test. Added
`eslint-rules/no-raw-elapsed-write.test.js` using ESLint's `Linter` directly
(its `RuleTester` needs Mocha-style global `describe`/`it`, which this project
doesn't configure — tried first, got "No test found in suite" until switched to
`Linter.verify()` inside plain Vitest `it()` blocks). Also required adding
`eslint-rules/**/*.test.js` to `vite.config.js`'s `test.include`, which had only
covered `src/**` and `supabase/functions/**`.

### T2.6 `entitlements`

`canAccess(key)` — permissive stub (D14): five real keys
(`cup_taster_analytics`, `cup_taster_report`, `cup_taster_unlimited`,
`audience_enhanced`, `audience_branding`), each `minTier: null` with its own
intent comment; throws on an unregistered key rather than silently allowing it.

Verifier: `module-boundary-checker`. Confirmed live: all five keys present with
comments, zero `canAccess()` call sites anywhere outside `entitlements.js`
itself and its own test file (`grep -rn "canAccess"`), no `src/formats/`
imports anywhere in Phase 2's files, `core/timeclamp` remains the sole
duration-cap implementation (the only other `elapsed_secs`-adjacent hit is the
ESLint rule that _enforces_ this, not a second implementation).

---

## Phase 1 — Schema and security · 2026-08-21

### T1.1 Core tables

`orgs`, `org_members`, `people`, `person_merges`, `events`, `event_entries` — migration
`20260821200000_core_tables.sql`, per handoff §5.1. `updated_at` is trigger-owned
(`app.set_updated_at()`) on every table that has one, never client-supplied — matters for
the §9 offline conflict check, which compares the `updated_at` a write read against the
row's current value. RLS enabled on every table now (D11: "from day one"); no policies
yet — that's T1.3.

Verifier: `schema-guardian`, live-run via the Agent tool. Applies cleanly from empty and
rollback verified by actually running it inside `begin; … rollback;` (both confirmed
against the real local stack, not just read). pgTAP suite (`supabase/tests/001_core_tables.sql`)
proves both named negative cases: a duplicate phone within one org is rejected but the
same phone is allowed across two different orgs; a merge (unlink the losing entry to
`person_id = null`, log the `person_merges` row, delete the merged-away person) succeeds
and both entries survive — one linked to the kept person, one an orphaned historical
record.

**A real finding, not a clean review**: `schema-guardian` checked the AC's own claim —
"the case a table-level UNIQUE would have broken" — instead of taking it as given, built
an isolated table with a plain table-level `UNIQUE(event_id, person_id)`, and ran the same
operation sequence against it. It succeeded identically. Postgres treats NULL as distinct
under either constraint shape, so a table-level UNIQUE would **not** have broken this
scenario — the claim, which originated in the handoff's own §5.1 comment, doesn't hold.
The partial index is still the right choice (smaller index; names the "linked entries
only" intent explicitly for `ON CONFLICT`), just not for the reason originally stated.
Corrected in three places: the migration's comment, the pgTAP test's docstring, and —
with the user's explicit go-ahead — the handoff document itself at §5.1 (allowed per §0:
"only to correct an error, never for progress").

### T1.2 Cup Taster tables

`ct_stages`, `ct_sets`, `ct_stage_entries`, `ct_heats`, `ct_heat_entries`, `ct_results`,
plus the `ct_standings` view — migration `20260821210000_cup_taster_tables.sql`, per
handoff §5.2. The view's exact shape (`entry_id`, `stage_id`, `correct_count`,
`sets_scored`, `total_elapsed_secs`) isn't given verbatim in the handoff — designed to
satisfy "expose the tally as a view" and feed §7.3's champion rule (most correct, then
fastest time).

Verifier: `schema-guardian`, live-run via the Agent tool. Applies cleanly from empty,
rollback verified by actually running it. pgTAP suite (`supabase/tests/002_cup_taster_tables.sql`,
13 assertions total across the full suite) proves both named negative cases: `correct` is
nowhere a stored tally/count column on any `ct_*` base table (only `ct_results.correct`,
the atomic per-set fact — views excluded from that scan, since `ct_standings.correct_count`
is deliberately derived, not stored), and a negative `elapsed_secs` is rejected by its
`CHECK`.

**Two real findings from the review, not a clean pass:**

1. `ct_standings` originally summed across every heat kind with no filter — an entry that
   went to a tiebreak (§7.2, a separate heat among only the tied cuppers) would have its
   tiebreak set silently blended into its primary-stage tally, distorting the "most
   correct → fastest time" comparison §7.3 treats as _sequential_ criteria, not summed
   inputs. Fixed with `where h.kind = 'normal'`; added a regression test that inserts a
   tiebreak heat and proves the tally doesn't move.
2. The view had no `security_invoker`. On Postgres 15+ (this stack runs 17), a plain view
   evaluates permissions and RLS as its **owner**, not the querying role — meaning once
   T1.3 adds org-scoped RLS to the underlying tables, `ct_standings` would have silently
   bypassed it, leaking every org's rows to any authenticated user. This is exactly what
   Supabase's own linter flags as `security_definer_view`. Fixed with
   `create view ct_standings with (security_invoker = true) as …`; confirmed directly via
   `pg_class.reloptions` that the option actually took.

Also added two indexes (`ct_heat_entries(entry_id)`, `ct_results(set_id)`) matching query
shapes the migration's own design commits to (the standings view's `group by entry_id`,
the per-set difficulty aggregation `avg(correct) group by set_id` described in the
handoff's `ct_results` comment) but that weren't covered as the leading column of any
existing constraint.

### T1.3 RLS

Policies on all 13 tables (12 org-scoped + `live_sessions`), plus a small
prerequisite migration creating `live_sessions` itself — not an explicit
T1.1/T1.2 table (those lists are §5.1 core and §5.2 Cup Taster; `live_sessions`
is §5.3 "Live," and T1.3's own AC needs it to exist). Migrations:
`20260821220000_live_sessions_table.sql`, `20260821230000_rls_policies.sql`,
`20260821240000_grants.sql`.

The membership chokepoint (`app.is_org_member`, `SECURITY DEFINER STABLE`,
`set search_path = ''`) and a chain of `org_id` resolver functions
(`org_id_for_event` → `org_id_for_stage` → `org_id_for_heat` →
`org_id_for_heat_entry`) walking the FK graph for tables without a direct
`org_id` column — mirrors Kira-Kira's `app.can_read_tx` chokepoint pattern so
no policy re-implements the join chain inline. `orgs`/`org_members` are
deliberately read-only at the RLS+GRANT layer (no app-level org/membership
management is in scope yet; provisioning happens via `service_role` outside
RLS).

Verifier: `security-reviewer`, live-run via the Agent tool, twice (a second
pass after the first round's fixes). pgTAP suite (`supabase/tests/003_rls.sql`,
15 assertions) proves both named cases: a non-member reads zero rows from all
12 org-scoped tables; an unauthenticated (`anon`) client can read
`live_sessions` but a write throws `42501`.

**A missing-GRANTs gap found during my own verification, before review:**
RLS policies alone weren't sufficient — `authenticated`/`anon` had no underlying
table privileges at all (`permission denied for table orgs`, the exact
failure Kira-Kira's own CLAUDE.md warns about: "base GRANTs matter
independently of RLS"). Added `20260821240000_grants.sql`.

**Two real findings from the security-reviewer pass, not a clean review:**

1. `live_sessions.org_id` and `event_id` were independent FKs with nothing
   tying them together — confirmed **live-exploitable**: an org member could
   INSERT a row claiming their own `org_id` while pointing `event_id` at a
   different org's event, silently breaking the "one active session per org's
   own event" invariant the `live_sessions_one_active_per_org` partial index
   implies. Fixed with a `before insert or update` trigger
   (`app.check_live_session_org()`) resolving `event_id`'s actual owning org
   via the existing resolver chain and rejecting a mismatch; added a
   regression test proving a cross-org row is now rejected.
2. Every write policy is `FOR ALL`, so `pg_policies.cmd` is literally `'ALL'`,
   never `'INSERT'`/`'UPDATE'` — flagged as a landmine for T1.4's
   not-yet-written gate script (a naive `cmd IN ('INSERT','UPDATE')` filter
   would match zero rows and pass without checking anything). Kira-Kira's own
   `000_with_check_gate.sql` had already anticipated this by including `'ALL'`
   in its filter — confirmed and ported directly into T1.4 below rather than
   rediscovering the same gap.

### T1.4 `WITH CHECK` gate

`supabase/tests/000_with_check_gate.sql` — replaces the Phase 0
`000_sanity.sql` placeholder now that real schema/RLS coverage exists (as
flagged as the plan in ROADMAP.md's Phase 0 open items). Queries `pg_policies`
for any `public` schema policy with `cmd in ('INSERT','UPDATE','ALL')` and a
null `with_check`; fails the suite immediately (numbered 000, runs first) if
one exists. `cmd in (...)` deliberately includes `'ALL'`, not just
`'INSERT'`/`'UPDATE'` — per the T1.3 finding above.

Verifier: `security-reviewer`. AC proven directly, not just written: dropped
and recreated `people_write` on the live local database with its `WITH CHECK`
clause removed (not a migration edit — a deliberate live-schema mutation for
the proof), ran `npm run db:test`, confirmed the gate fails
(`have: 1, want: 0`, suite exit 1) — this is exactly what CI's `supabase` job
runs, so the same failure would occur there. Restored via `supabase db reset`
and confirmed the full 28-assertion suite is green again.

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
