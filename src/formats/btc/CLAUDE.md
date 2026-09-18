# src/formats/btc/ — BTC (Barista Team Championship) format

Root non-negotiables apply here unconditionally — see
[the repo root CLAUDE.md](../../../CLAUDE.md) for the full list, especially the module
boundary: this directory may import from `src/core/`, never the reverse. Read
[src/formats/cup-taster/CLAUDE.md](../cup-taster/CLAUDE.md) first as the worked example
of what a format module actually looks like once built.

**Naming**: the format is **BTC**, not BBTC — BBTC is the Brunei-specific instance of the
BTC format, not the format's own name (directory renamed from `bbtc/` to `btc/` at the
start of Phase T-BTC.2, 2026-09-18; see the BTC Next Migration plan doc, §1, for the
full naming decision).

Before writing the first line of code here: check whether the thing you're about to
build already exists as a `core/` primitive (ranking, advancement, timeclamp, outbox,
viewer-shell, router, appShell, etc.) — reuse it unedited. If it _almost_ fits but not
quite, that's a signal to widen the `core/` primitive (with `module-boundary-checker`
sign-off) rather than fork a second implementation the way v4.x forked its timer.

Schema (Phase T-BTC.1, 2026-09-18): `btc_teams`, `btc_judges`, `btc_matches`,
`btc_match_judges`, `btc_cup_votes` (raw per-judge-per-cup vote fact — never
pre-aggregated), `btc_match_bonuses`, `btc_bracket_slots`, plus derived views
`btc_cup_totals`/`btc_match_totals`/`btc_standings`. See `supabase/migrations/
20260918090000_btc_tables.sql` and its sibling RLS/grants migrations for the full
account, including the schema-guardian review that caught and closed a
`correct`-is-a-count violation in an earlier draft.

## Module history

`teams`, `judges` (T-BTC.2, 2026-09-18) — roster CRUD for a BTC event: list/create/remove
against `btc_teams`/`btc_judges`, following `core/registry.js`'s own idempotent
create-with-race-recovery shape (`UNIQUE_VIOLATION` on the `(event_id, name)` unique
index resolves to the existing row rather than surfacing a raw constraint error — same
pattern as `registerPerson`/`createStage`). `setupScreen` (T-BTC.2, same date) — the
organiser-facing screen combining both: event `is_test` banner, add/remove forms for
teams and judges, built on `core/dom.js`/`core/errors.js`/`core/timeout.js` exactly like
Cup Taster's `rosterScreen.js`/`setupScreen.js` (loading/error/retry states, a bounded
`raceTimeout` against a hung request, rebuild-then-refocus on every action,
`signal?.aborted` guard before any post-await DOM write). Not yet wired into
`main.js`/`core/router.js` — Cup Taster's own app-wiring pass happened only after its
format screens existed (2026-08-30, well after T4.1), and BTC follows the same
precedent: build the screens standalone with their own `.preview.html` harness first,
wire routing once enough of the format exists to be worth reaching.

**Three review rounds, real findings, same day**: `module-boundary-checker` passed clean
(confirmed the CSS-duplication-over-cross-format-import call below was correct, and that
`teams.js`/`judges.js` reusing `core/registry.js`'s race-recovery shape is legitimate
reuse, not a pattern that should have been extracted to `core/` first). `code-reviewer`
found two real issues, both fixed: the roster inputs' `aria-label` used the plural
section heading ("Teams name") while `validateRosterName`'s own error text used the
singular ("Team name is required.") — a screen-reader user moving between the two heard
two different names for the same field; and `setupScreen.css`'s header comment claimed
"copied verbatim from heatsScreen.css" while actually omitting `.card:focus-visible`
(the fix for a real previously-documented bug where a focused `.card`'s own border and
focus ring fuse into one indistinguishable band) — added. `ui-accessibility-reviewer`
found three blocking gaps, all fixed: nothing on the screen carried a `data-field`/
`data-focus-key` for `core/dom.js`'s `withFocusPreservation` to find, so every render
after typing a name, submitting, or removing a row dropped keyboard focus to `<body>`;
a successful load (initial or Retry) never moved focus to the heading, unlike a failed
one; and validation errors had no `role="alert"`/`aria-describedby` association to their
field, so a screen-reader user submitting a blank name got no indication anything
happened. Fixing the toast's own focus-move surfaced a real, separate bug: every handler
already ends with its own trailing `state.busy = false; render()` AFTER calling
`showToast()`, and `showToast()` used to render immediately itself — the second render
tore the toast-focused DOM back down with `pendingFocus` already consumed, silently
dropping focus to `<body>` a moment after it was set. Fixed by having `showToast()` only
set state; the caller's own trailing `render()` is now the single authoritative one.
4 new regression tests cover all of this (heading focus on load, input focus surviving a
validation-error re-render via `data-field`, the `aria-describedby`/`role="alert"`
association, and toast focus after a successful add) — 51 tests total, still 1270/1270
across the full suite.

**Known debt, not blocking**: `shared.css` (see below) still duplicates the shared
component-shape rules (`.screen-container`, `.card`, `.btn`, `.form-field`,
`.field-input`, `.roster-list`, `.screen-feedback`) that Cup Taster's own screens all
build on via `heatsScreen.css` — those rules physically live inside a Cup-Taster-specific
file today, not `src/ui/tokens/` or `src/core/`, so a second format reusing them without
duplicating would mean linking to another format's own CSS file, which the module
boundary rules out. Flagged for a future extraction into a shared, format-agnostic home
(e.g. `src/ui/tokens/components.css`) once a second format's needs make the shape of that
extraction clear — not done now to avoid risking a live-app regression to Cup Taster's
own screens by refactoring `heatsScreen.css` mid-task.

`matches` (T-BTC.2, 2026-09-18) — preliminary match creation. `create_btc_match`
(`supabase/migrations/20260918100000_btc_create_match_rpc.sql`) atomically writes a
`btc_matches` row plus its exactly-3-judges assignment in one transaction, closing the
validation gap the T-BTC.1 schema deliberately deferred; `SECURITY INVOKER` (explicit),
relies entirely on the caller's own RLS rather than a bespoke membership check — for a
non-member, RLS on `btc_teams`/`btc_judges` hides the row before the function's own
"belongs to this event" validation ever gets far enough to distinguish "doesn't exist"
from "you can't see it" (no enumeration oracle). `matches.js` wraps it (`createMatch`),
plus `listMatches`/`listJudgeIdsForMatch` (mirrors `heats.js`'s `listHeatsForStage`'s own
`{heat, entries}` composition, not a PostgREST embedded-resource select — no other module
in this codebase uses that feature). `matchesScreen` — a create-match form (2 team
`<select>`s, a 3-judge `<fieldset>` of checkboxes with a live "X of 3 selected" count and
a hard cap at 3) plus the round's match list, scoped to `'preliminary'` only
(quarterfinal/semifinal/final matches come from bracket slots in a later step, a
different flow). `shared.css` extracted from `setupScreen.css` on this 2nd screen needing
the same base shapes (mirrors `src/community/guess-the-bean/shared.css`'s own precedent
for a directory-local shared stylesheet) — `setupScreen.css`/`matchesScreen.css` now hold
only their own screen-specific rules.

**`create_btc_match` has no idempotency key, deliberately** — unlike `createTeam`/
`createStage`'s own `UNIQUE_VIOLATION`-recovers-to-existing-row shape, there's no unique
constraint identifying "the same match," because two real matches between the same two
teams in a round isn't forbidden by this format (unlike a duplicate team/judge name, which
always is). `schema-guardian`'s review caught that this left a genuine gap: a dropped
response after a real write, followed by a natural resubmit, could create an
indistinguishable duplicate match with **no recovery path anywhere in the app** — no
`removeMatch`, no delete UI. Closed same-day with `matches.js`'s `removeMatch` (a plain
delete — no new migration needed, since `btc_matches_write`'s existing `FOR ALL` RLS
policy already covers `DELETE` and `btc_match_judges`/`btc_cup_votes`/`btc_match_bonuses`
all cascade on `match_id`) plus a `window.confirm`-gated Remove button per match row,
matching `src/community/guess-the-bean/setupScreen.js`'s own danger-zone pattern.

**Five review passes across two rounds, real findings both times.** First round
(schema-guardian, security-reviewer, module-boundary-checker, ui-accessibility-reviewer,
code-reviewer, all parallel): module-boundary-checker and ui-accessibility-reviewer passed
clean; security-reviewer passed clean after independently re-deriving that
`create_btc_match`'s reliance on RLS-filtered reads (rather than `confirm_heat`'s own
explicit `p_org_id` check) is sound here, not a deviation — `confirm_heat` needs that
extra check because it writes an `org_id` column `create_btc_match` has no equivalent of;
code-reviewer found one dead `id` attribute on a judge checkbox (removed, nothing
referenced it); schema-guardian found the duplicate-match gap above. Second round (a
targeted re-review of just the `removeMatch` fix, three reviewers): all passed clean,
one trivial finding (the toast-vs-inline-error choice in `handleRemoveMatch`'s catch
block looked incidental rather than intentional — a one-line comment now explains it).
Final: 1293/1293 tests (60 BTC-specific across `teams`/`judges`/`setupScreen`/`matches`/
`matchesScreen`, plus 34 pgTAP assertions across `012_btc_tables.sql`/
`013_btc_create_match_rpc.sql`), ESLint clean, migration applies cleanly from empty and
its rollback verified live in a transaction (twice — once before, once after the
`removeMatch` fix, since the fix also added `security invoker` explicitly to the RPC).
