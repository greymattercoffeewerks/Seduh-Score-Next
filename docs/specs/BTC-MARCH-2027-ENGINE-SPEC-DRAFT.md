# BTC engine changes for March 2027: spec draft

_Draft, 2026-11-07. Status: **for the owner's review; nothing here is built.** Follows from
[`MARCH-2027-BOARD-PLAN.md`](../../MARCH-2027-BOARD-PLAN.md) (section 3.3 proposals 1 and 1b) and the owner's answers
of 2026-11-07. Each work item below becomes its own task with the reviewers named in section 8. Not part of the frozen
handoff; it is a correction-level spec for one format, so it lives here and not in `Handoffs and Specs/`._

## 1. Purpose and scope

The real competition (tentatively March 2027) fields about **20 teams, 2 to 3 per country**, plays **two preliminary
rounds**, then the committee takes the **top 8 by points** to the knockout, breaking ties by the **sum of each team's
two finish times**. The shipped BTC engine assumes a full round robin of hand-entered matches and breaks ties on
points then wins. This spec covers the engine changes needed to run the real format, in shadow mode, with the least
new code.

**In scope**

- A: a round number on preliminary matches.
- B: a seeded **draw** for round 1 and **two modes** for round 2, creating a whole round atomically, with judge
  assignment.
- C: **ties on points only**, with the tie card showing each team's recorded finish times (manual confirmation).
- D: a **finish-time input check** (formatter and verifier).
- E: the team country column, as a dependency (specified in the plan, section 1; summarised in 6).

**Out of scope** (separate tasks, listed in the plan): the shadow-event flag, the `btc_matches_write` policy split,
the records export, offline scoring load, Petrol V2, the Tour. Numeric match times and automatic time ranking stay a
later option (section 9).

## 2. Decisions this rests on

| Fact                                                                                                                                                                                | Source            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 20 teams, 2 to 3 per country, each with its own team name                                                                                                                           | owner, 2026-11-07 |
| Two preliminary rounds; round 1 a random draw; same-country pairings allowed when drawn                                                                                             | owner             |
| Round 2: build **both** methods, selectable per event: seeded random without repeat opponents, and strongest against weakest by points                                              | owner             |
| Top 8 chosen by points after round 2; a tie is broken by **points first, then time**, not wins; time is the sum of the team's two finish times; confirmed manually by the organiser | owner             |
| A judge must **not score a team from their own country** (avoid it)                                                                                                                 | owner, 2026-11-07 |
| Round 2 needs every earlier preliminary round fully confirmed                                                                                                                       | owner             |
| Every preliminary finish time **must be recorded** (needed for the tie-break)                                                                                                       | owner             |
| An odd team count (a withdrawal) is **KIV**: the committee decides; until then the draw refuses                                                                                     | owner             |
| Whether a round-2 rematch may be avoided is to be checked with the committee; avoiding is the default and can be switched off                                                       | owner             |
| No draw or schedule exists before registration opens in January 2027                                                                                                                | owner             |

Still to confirm with the committee (none blocks the build): which round-2 method they use; the odd-count bye
rule (KIV); whether a round-2 rematch is allowed (rematch avoidance is a setting, default on).

## 3. A: the preliminary round number

**Today.** `btc_matches.round` is one of `preliminary | quarterfinal | semifinal | final | third_place`
(`btc_tables.sql:56-68`); both preliminary rounds would be `preliminary` and nothing tells them apart.

**Change** (migration `btc_prelim_round`, forward-only, with a tested rollback block):

- `alter table btc_matches add column prelim_round smallint null`.
- `check (prelim_round is null or (round = 'preliminary' and prelim_round >= 1))`. Nullable on purpose: existing
  preliminary matches (demo and test events) keep working and read as round 1 in the UI. No fixed upper bound, so a
  committee that later wants three rounds needs no migration.
- A partial index on `(event_id, prelim_round)` where `round = 'preliminary'`.
- `btc_standings` is unchanged: it sums every confirmed preliminary match, so two rounds add up correctly.
- Tenancy: `event_id` is already frozen by its parent trigger; a new column on an existing tenant table needs no
  new matrix entry, but test `040` is re-run to confirm.

**Acceptance.** A preliminary match can carry `prelim_round` 1 or 2; a knockout match with a `prelim_round` is
refused (23514); existing rows are untouched; standings for an event with matches in both rounds are the sum.

## 4. B: the draw

### 4.1 Pure functions (`src/formats/btc/draw.js`, no I/O, fully unit-tested)

Reuse `src/core/seededShuffle.js` (`newSeed`, `seededShuffle`), the same recorded-seed approach Throwdown uses
(`td_draws.seed`). Nothing format-specific goes into `core/`.

- `drawRound1({ teamIds, seed })`: shuffle with the seed and pair consecutive teams. An **odd** number of teams is
  refused with a message (a bye would give one team fewer matches and make points unfair); see open question O1.
- `drawRound2Random({ teamIds, priorPairs, seed, avoidRematches = true })`: seeded shuffle, then pair; when
  `avoidRematches` is on and a pair repeats a round-1 opponent, the repair step swaps with the next unpaired team until no repeat remains or no swap helps. Returns the
  pairs plus `rematches` (a count) so the screen can say "1 rematch could not be avoided".
- `drawRound2ByResults({ standings, priorPairs, avoidRematches = true })`: order by round-1 points (descending; equal points ordered by a
  fixed seeded shuffle so the result is explainable), then pair **strongest against weakest** (1st with last, 2nd
  with second last, ...), repairing rematches by a minimal swap. The standings must be complete (every round-1
  match confirmed).
- `assignJudges({ pairs, judges, teamCountry })`: deterministic rotation giving each match **3 distinct judges**,
  each judge's load within one match of any other's, and **no judge from the country of either team in the match**
  (a judge or team with no country never conflicts). It returns a `conflicts` list when the pool is too small to
  avoid every conflict (few judges, many teams from one country) instead of failing silently. Pure and re-runnable;
  the organiser edits the result.
- Every function returns the pairs, the seed used, and `warnings` (rematch count, same-country pairs as an
  information count only, since they are allowed).

### 4.2 Database

New table `btc_round_draws` (mirrors Throwdown's `td_draws`): `event_id`, `prelim_round`, `mode`
(`random` | `by_results` | `manual`), `seed text null`, `match_count smallint`, `avoid_rematches boolean`, `conflict_ticks jsonb` (matches where a judge
conflict was knowingly accepted), `created_by default auth.uid()`, `created_at`; primary key `(event_id, prelim_round)`; `check ((mode in ('random', 'by_results')) = (seed is not null))` (both
seeded modes record a seed; `by_results` uses it for equal-points order); frozen `event_id` (`app.forbid_parent_change`); RLS read and write through `app.is_org_member`; added
to matrices `040` and `041`. Its job is to answer "why did the draw produce this?" for a committee, an appeal, or the
Board comparison.

New RPC `create_btc_round(p_org_id, p_event_id, p_prelim_round, p_mode, p_seed, p_matches jsonb)`, **security
invoker**, one transaction:

1. Refuses a non-member with the standard not-found shape (`app.is_org_member`), takes the per-event advisory lock
   the bracket functions use, and refuses if the event already has a bracket.
2. Refuses if round `p_prelim_round` already has matches (`btc_round_exists`) or a draw row.
3. Validates `p_matches`: every team in the event appears **exactly once** in the round (`btc_round_incomplete`),
   teams and judges belong to this event, each match has 3 distinct judges, no team plays itself. A judge from a team's own country is **not refused by the
   database** (a committee may need an exception); the screen flags it and asks for an explicit tick (4.3).
4. For any `p_prelim_round` above 1 (both modes): requires every earlier preliminary round fully confirmed
   (`btc_prior_round_open`).
5. Inserts the matches with `prelim_round` and their judges (the same checks `create_btc_match` makes), the draw row,
   and returns the created matches. A failure anywhere creates nothing.

Grants follow the existing write RPCs (revoke from `public` and `anon`, grant to `authenticated`, and `service_role`
if the sibling RPCs do). Refusals carry a `hint`. The manual form (`create_btc_match`) stays for corrections.

### 4.3 Screen

`matchesScreen.js` gains a **Draw a round** panel (the existing hand-entry form stays below it):

- Choose the round (1 or 2). For round 2, choose the mode (random, or by results). Mode defaults are a per-event
  setting the organiser can change until the round is created.
- Show the **seed** (and let the organiser re-enter one to reproduce a draw, or press "New seed").
- A **preview table**: match number, team 1, team 2 (with country), three judge selects. Swap controls to change a
  pairing by hand; any manual change marks the draw `manual` and drops the seed requirement.
- Warnings in plain words (rematch, odd team count, **a judge from a team's own country**), no jargon. A judge
  conflict turns that match red and **Create** stays disabled until the organiser changes the judge or ticks "allow
  this conflict" for that match; the tick is kept in the draw record.
- A setting **Avoid repeat opponents** (default on) for round 2, so the committee's answer is a switch, not a rebuild.
- **Create N matches** is disabled until the preview is valid; one press calls `create_btc_round`.
- 360px first: the preview is a stacked card list, not a wide table; focus and live-region rules per
  `ui-accessibility-reviewer` (focus follows the pressed control, results announced).
- The live draw as a ceremony (the Random Selector's split-flap board) is a later enhancement, not part of this
  spec; the pure functions are the same either way.

### 4.4 Acceptance

- Same seed and same teams give the same round-1 pairs.
- Round 1 with 20 teams makes 10 matches, each team once; with 19 teams it refuses.
- With enough judges, no match has a judge from either team's country; with too few, the conflicts are listed and
  **Create** needs the tick.
- Round 2 needs round 1 fully confirmed in both modes; a draw before that is refused.
- Round 2 random never repeats a round-1 pair when a repeat-free arrangement exists; it reports the count when it
  cannot.
- Round 2 by results pairs rank 1 with rank 20, 2 with 19, and so on, unless that is a rematch.
- A non-member gets the standard not-found refusal; a second call for the same round refuses; a partial failure
  creates no match.

## 5. C: ties on points only, with the evidence on the tie card

### 5.1 Why this is a medium migration, not a one-liner

The shipped tie mechanism keys everything on **(points, wins)**: the snapshot columns and unique key of
`btc_seeding_tiebreaks`, the `btc_seeding_order` view partition and ordering, `record_btc_seeding_tiebreak`'s
"level" check, `generate_btc_bracket`'s 8th/9th check, and the client's `seedingTieGroups` (key `points-wins`)
(`20261010100000_btc_seeding_tiebreak.sql`, `src/formats/btc/seeding.js:49`). The committee's rule is points, then
time, so wins must stop ordering and stop defining a tie.

**Option A (recommended): redefine a tie as equal points.** One forward migration, `btc_seeding_points_only`:

- `btc_seeding_tiebreaks`: drop `wins` from the unique key and the snapshot (`unique (event_id, total_points,
tiebreak_rank)`; keep the column nullable and unused, or drop it). Existing decision rows keyed on wins are
  discarded by the migration; confirm in the cloud before pushing that none exist for a real event (only demo and
  test events have used it).
- `btc_seeding_order`: partition and order by points only (then the recorded rank, then team id). `wins` stays in
  the output for display.
- `record_btc_seeding_tiebreak`: "level" means equal points.
- `generate_btc_bracket`: the 8th/9th boundary check uses points only.
- Client: `seedingTieGroups` keys on points (`points-<n>`); `standings.js` sorts by points then wins only for
  display order before ties are recorded, never as a tie-break.
- Rollback block restores the previous definitions verbatim.

**Option B (rejected): keep wins in the ordering and rely on the organiser.** No migration, but a team with fewer
points and more wins could never be ranked by time against a team with equal points and fewer wins, which is not
the committee's rule.

### 5.2 The tie card shows the times

For each team in a tie group the card lists its **preliminary finish times** (round 1 and round 2 notes) and a
**best-effort sum** when both parse as minutes and seconds, labelled "for guidance, you decide". New read-only
view `btc_prelim_times` (`event_id`, `team_id`, `prelim_round`, `time_note`, from `btc_matches` by which side the
team was on; `security_invoker`, `authenticated` only) so the client does not reassemble it from raw matches.
Because a time is required for every confirmed preliminary match (section 6), a new event always has both times and
the sum; an unparseable or missing value (an old or demo row) is shown as typed, or "no time", and the sum is omitted. The organiser orders the group
as today (up and down buttons, a required reason; the reason text should say which rule was applied).

### 5.3 Acceptance

- Two teams with equal points and different wins are a tie group; their wins do not order them.
- A tie across the 8th and 9th places blocks `generate_btc_bracket` until ordered; ordering it unblocks it.
- A three-way tie is ordered as a whole; a half-recorded group is ignored (existing behaviour kept).
- The card shows both times per team and the sum when both parse; an old row with no time shows "no time" and never errors.
- Rollback restores the (points, wins) behaviour exactly.

## 6. D: the finish-time input check

**Today** (`src/formats/btc/scoringScreen.js:639-657`): plain optional text, placeholder "e.g. 8:42", no validation;
`scoring.js` sends it raw (`p_team1_time_note`), the confirm RPC trims it. The value in the tie card is only useful
if it is consistent.

**Change** (client only, no database change):

- `parseDuration(text)` in `src/core/duration.js` beside `formatDuration`: accepts `M:SS` and `MM:SS` (seconds 00
  to 59), returns total seconds or `null`. Pure, format-agnostic, unit-tested (Cup Taster can reuse it).
- On blur the box tidies a valid value (`08:42` to `8:42`) and, for anything else, shows an inline message
  ("Use minutes and seconds, like 8:42") with `aria-invalid="true"` and `aria-describedby`.
- **A time is required for each team in a preliminary match** (owner: "must have a time"): Confirm is blocked with a
  plain message until both boxes hold a valid time. An invalid value shows its own message. Knockout matches keep
  the time optional. The boxes' label drops "(optional)" for preliminary matches.
- **Client-side for March.** The confirm function is a scoring gate with its own idempotency, so the requirement is
  not added there yet (it would also affect the demo loader); recommended hardening, if wanted: refuse a preliminary
  confirm without both times in `confirm_btc_match`, with a hint, after `scoring-auditor` review. Meanwhile the
  event dashboard shows a checklist line "N preliminary matches have no times" before the bracket step, so a gap
  made by an old or odd flow is visible.
- The draft persistence (IndexedDB) and `buildRpcParams` carry the tidied text.
- 360px: the message sits under the box, no layout shift beyond one line; contrast per Petrol tokens.

**Acceptance.** `8:42`, `08:42`, `12:05` pass; `8.42`, `8:60`, `842`, `8 min` are refused with the message; empty
passes only for a knockout match; a preliminary Confirm is blocked while either time is missing or invalid.

## 7. E: the team country (dependency)

Specified in the plan (section 1.A, migration `btc_team_country`): `country_code` (ISO alpha-2, nullable) on
`btc_teams`, optional `represents`, **no uniqueness on country** (2 to 3 teams per country), display `Country ·
Team name` (names are unique per event already). **Judges also get a nullable `country_code`** in the same
migration (the owner wants a judge kept off teams from their own country), with a country select on the judge
setup form; `assignJudges` and the draw preview use it (section 4). A judge with no country never conflicts. The
manual match form (`matchesScreen.js`) shows the same conflict warning when the organiser picks a judge from a
chosen team's country. Built before the draw; it does not depend on anything above.

## 8. Reviews, tests and rollout

| Item                                                                      | Reviewers (hard gates in bold)                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A, B database (`btc_prelim_round`, `btc_round_draws`, `create_btc_round`) | **`schema-guardian`, `security-reviewer`**, `test-auditor`, `code-reviewer`                                   |
| B pure draw and judge rotation                                            | **`scoring-auditor`** (it decides who plays whom), `test-auditor`, `module-boundary-checker`, `code-reviewer` |
| B screen                                                                  | `ui-accessibility-reviewer` (360px first), `code-reviewer`, `test-auditor`                                    |
| C migration and view                                                      | **`schema-guardian`, `security-reviewer`, `scoring-auditor`**                                                 |
| C tie card                                                                | `ui-accessibility-reviewer`, `test-auditor`                                                                   |
| D parser and input                                                        | `ui-accessibility-reviewer`, `test-auditor`, `module-boundary-checker` (it lands in `core/`)                  |

Tests: pgTAP for every migration (a non-member reads zero rows; every refusal hint; rollback verified in a
transaction), unit tests for every pure function with the negative cases listed in each acceptance section, and a
Playwright run of: create 20 fictional teams and 3+ judges, draw round 1, confirm both rounds with times, resolve a
points tie by time, generate the bracket. Matrices `040`/`041` get the new table and RPC.

Rollout: local `db:reset` and pgTAP first, then push to the cloud project by hand (merging does not push
migrations), then compare `supabase/migrations/` with the cloud's migration list. Suggested order: E, A, D (no
database), B (database, then pure functions, then screen), C. All of it lands before the first rehearsal (plan
phase P1, December).

## 9. Later options (not for March)

- Numeric finish times written through `clampElapsed()` and automatic time ranking (the manual path becomes the
  fallback for missing times).
- The draw as a live ceremony on the shared draw board.
- Pairing round 2 by neighbours (one-line variant of `drawRound2ByResults`) if the committee prefers it.
- A third preliminary round (`prelim_round` has no upper bound).

## 10. Open questions and parked items

- **O1 Odd team count or a withdrawal: KIV** (owner: ask the committee). With 19 teams, or a team withdrawing
  between rounds, the draw **refuses** and says why. Options for later: the committee names a bye and the app
  records it as a no-match with the standings adjusted by their rule, or a fictional "bye" team. No build until the
  committee answers.
- **O2 Judge country: decided.** Avoid a judge scoring a team from their own country (sections 4 and 7). Still to
  settle: if the judge pool is too small to avoid every conflict, is an accepted exception allowed? The spec allows
  it with an explicit tick and records it.
- **O3 Round 2 on partial results: decided.** Round 2 needs round 1 fully confirmed.
- **O4 Time: decided.** Every preliminary finish time must be recorded (section 6). Open: what is recorded when a
  team does not finish (a "did not finish" value, or the cup limit)? A "must have a time" rule needs an answer or a
  confirm is impossible.
- **O5 Same opponent twice: KIV** (owner: check with the committee). Avoidance is a setting, default on; if the
  committee's format allows repeats, switch it off.
