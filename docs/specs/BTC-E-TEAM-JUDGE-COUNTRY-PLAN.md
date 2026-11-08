# Build E: team and judge country — spec and build plan

_2026-11-08. Status: **approved to build** (owner asked for this plan to be executed). First of the March 2027 engine
items, in the order of [`BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md`](BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md) section 8 (E, A,
D, B, C). Sources: that spec's section 7 and [`MARCH-2027-BOARD-PLAN.md`](../../MARCH-2027-BOARD-PLAN.md) section
1.2.A. Where this plan decides something those two leave open, it says so ("Decided here"); the owner can overrule
any of those before the PR merges._

## 1. Why

The real competition fields about 20 teams, 2 to 3 per country, each with its own team name. The owner wants a judge
kept off any match with a team from the judge's own country. Today `btc_teams` and `btc_judges` are a name in one
event and nothing else (`20260918090000_btc_tables.sql:27-43`). Build E adds the country to both, lets the organiser
set it, and warns when a hand-picked judge shares a team's country. The draw (B) builds on the same data and on the
pure conflict helper written here.

## 2. Scope

**In:** one migration; `src/core/country.js` (extracted from `core/phone.js`); team and judge country (and the team's
optional "represents" label) on the setup screen, at creation and editable afterwards; a judge-country warning on the
manual match form; then, as a second PR, the country in the live payload and on the audience surfaces.

**Out:** the draw and `assignJudges` (B); emoji flags (Windows shows two letters); country in `load_btc_demo` (the demo
stays country-less; B may add it); narrowing `btc_teams`/`btc_judges` to column-level grants (owner's call, see 4.3);
any cross-year "delegation" registry (derived later from `country_code`, plan 1.2.A); judge country on any public
surface.

## 3. Decisions

| #   | Decision                                                                                                                                                                                                                    | Source             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | `country_code` is ISO 3166-1 alpha-2, nullable, on both tables. No uniqueness (2 to 3 teams per country).                                                                                                                   | plan 1.2.A, spec 7 |
| 2   | Country names are never stored: `Intl.DisplayNames` at render time, falling back to the code.                                                                                                                               | plan 1.2.A         |
| 3   | `represents` (team only): optional free label, 1 to 60 characters after trimming, for a region or federation.                                                                                                               | plan 1.2.A         |
| 4   | A judge or team with no country never conflicts.                                                                                                                                                                            | spec 7             |
| 5   | The conflict is a **warning, never a refusal**, on the manual form and in the database (a committee may need an exception; B adds the explicit tick).                                                                       | spec 4.2, 7        |
| 6   | Display: `Country · Team name` (for example "Brunei · Team Kopi"); just the name when there is no country.                                                                                                                  | spec 7             |
| 7   | **Decided here:** country and represents stay editable after matches exist. They do not affect scoring, and a team in a match cannot be removed (`ON DELETE RESTRICT`), so editing is the only way to fix a typo.           | this plan          |
| 8   | **Decided here:** the country list is the same ISO list the phone picker uses (`getCountries()` from libphonenumber), Brunei first, then by name. One list for the whole app.                                               | this plan          |
| 9   | **Decided here:** the database checks the shape (`^[A-Z]{2}$`) only; the client checks membership of the list. A code outside the list is stored if the API is called directly, and renders as the code. Harmless.          | this plan          |
| 10  | **Decided here:** the live payload gets the **team** country only (`country: { code, name } \| null` on each team object). Judge country stays organiser-only (judges are another body's officials; plan 1.4, decision D5). | this plan          |

## 4. Database (PR 1)

### 4.1 Migration `2026110810xxxx_btc_team_judge_country.sql`

Forward-only, with a `-- rollback:` block that drops the constraints and columns (verify it by running it in a
transaction, then re-apply).

```sql
alter table public.btc_teams
  add column country_code text null,
  add column represents   text null,
  add constraint btc_teams_country_code_format check (country_code ~ '^[A-Z]{2}$'),
  add constraint btc_teams_represents_length
    check (represents is null or (represents = btrim(represents) and char_length(represents) between 1 and 60));

alter table public.btc_judges
  add column country_code text null,
  add constraint btc_judges_country_code_format check (country_code ~ '^[A-Z]{2}$');
```

A NULL passes a CHECK, so no `is null or` is needed on the regex. No index: nothing filters by country yet (B's
`assignJudges` works on rows already loaded).

### 4.2 What already holds, and must be confirmed rather than rebuilt

- **RLS:** `btc_teams_write`/`btc_judges_write` (`20260918091000_btc_rls_policies.sql:39-53`) cover UPDATE; the
  window-lock restrictive policies (`20261023140000_entitlement_window_lock.sql:310-311`) cover the new columns.
- **Frozen parent:** `event_id` is already frozen (`20260922092000_btc_cross_event_integrity.sql`). No new parent column.
- **Matrices:** no new table and no new RPC, so `040`/`041` need no new entries. Run them anyway.
- **Change log:** `btc_teams`/`btc_judges` are not logged in `score_change_log` (only matches, votes, bonuses,
  slots). A country edit is roster data, not a score; no logging. State it in the migration header.
- **Dispute pack:** `get_dispute_pack` emits `to_jsonb(x)` of each team and judge row
  (`20261011140000_tenancy_rpc_null_org_guard.sql:2001-2005`), so the new columns appear there automatically
  (organiser-only). Check that no pgTAP test pins those keys; if one does, update it deliberately.
- **Anonymous doors:** `get_scoring_record` and `public_event_summary` must not start returning judge country. Grep
  them; if either emits whole judge rows, stop and raise it before merging.

### 4.3 Grants (flag to the reviewers, do not change)

`btc_teams`/`btc_judges` hold a table-level `insert, update` grant to `authenticated`
(`20260918092000_btc_grants.sql:35-36`), so the new columns are writable with no grant change. A column-level grant
on just the new columns would be a no-op beside the table grant. Narrowing these two tables to column-level grants is
the owner's per-table decision (`CONVENTIONS.md`, "How to add a tenant table", item 4). Record it in
`docs/backlog/btc.md` as an open item; do not do it in this change.

### 4.4 pgTAP `073_btc_team_judge_country.sql`

- The columns exist with the right types and nullability; both constraints exist.
- A member can set `BN` on a team and a judge, set it back to NULL, and set `represents`.
- Refused with `23514`: `bn`, `BRN`, `B1`, `''`; `represents` of `''`, `'  x'` (untrimmed) and 61 characters.
- Two teams in one event can both be `BN`.
- **A non-member** (a member of another organisation, and a signed-in stranger) **updates zero rows and reads zero
  rows** (DoD negative case), and `anon` is refused.
- `load_btc_demo` still runs on a test event and leaves every `country_code` NULL.

## 5. Front end (PR 1)

### 5.1 `src/core/country.js` (new, format-agnostic)

- `countryOptions(locale = 'en')` → `[{ iso, name }]`: Brunei first, the rest by name (the body of today's
  `phoneCountryOptions`, minus the calling code).
- `countryName(iso, locale = 'en')` → the display name, or the code itself when `Intl` has none or throws; `null` for
  a null input.
- `isCountryCode(iso)` → whether it is in the list.
- `core/phone.js`'s `phoneCountryOptions` becomes `countryOptions()` plus the calling code; its existing tests must
  pass unchanged (`cup-taster/rosterScreen.js` uses it).
- Unit tests: Brunei first; sorted by name otherwise; `countryName` fallback when `Intl.DisplayNames` throws (stub
  it); null in, null out. `module-boundary-checker` confirms nothing BTC-specific went in.

### 5.2 `src/formats/btc/teams.js`, `judges.js`

- `createTeam(eventId, name, { countryCode = null, represents = null } = {}, client)` and
  `createJudge(eventId, name, { countryCode = null } = {}, client)`. Keep the race-recovery path; when it adopts an
  existing row, it returns that row as it is (do not overwrite its country).
- New `updateTeam(teamId, { countryCode, represents }, client)` and `updateJudge(judgeId, { countryCode }, client)`:
  update only the keys passed, `.select().single()`, throw on error.
- Keep the existing positional signature working for current callers, or update every caller in the same commit.

### 5.3 `src/formats/btc/countryConflicts.js` (new, pure, in BTC; B reuses it)

`judgeCountryConflicts({ judges, teams, team1Id, team2Id, judgeIds })` → `[{ judgeId, teamId }]`, one entry per
selected judge that shares a country with either team. No country on either side means no conflict. Tests: none, one,
a judge matching both teams (two entries), nulls, an unknown id.

### 5.4 `setupScreen.js`

- Add-team form: name, **Country** (native `<select>`, first option "No country", then `countryOptions()`), and
  **Represents (optional)**. The hint under the name: "A team or country name, not a person's name" (plan 1.4).
- Add-judge form: name and **Country**.
- Each team and judge row shows `Country · Name` (5.6) and an **Edit** button that opens an inline form with the same
  fields, Save and Cancel. One row edits at a time.
- Follow the screen's existing rules exactly: every control carries `data-field` (`withFocusPreservation`); errors are
  `role="alert"` and tied with `aria-describedby`; focus moves to the first field on Edit and back to the row's Edit
  button on Save or Cancel (pendingFocus keys, as `bracketScreen.js` does for its create form); `showToast` only sets
  state, the caller's trailing `render()` is the one render; `signal?.aborted` before any post-await DOM write.
- Live publish: a country or represents change republishes **only if the event is already live**
  (`requestLivePublish(false)`), as a team add does today. (Needed once PR 2 puts country in the payload; harmless
  before.)
- Reuse one cached array of `<option>` data for the selects (as `rosterScreen.js:200-210` does), not a rebuild of
  ~245 options per row per render.

### 5.5 `matchesScreen.js`

- Team selects show `Country · Name`.
- Judge checkboxes show the judge's country in text beside the name.
- When `judgeCountryConflicts` returns entries, a warning under the judge fieldset, in words: "Judge Siti is from
  Brunei, the same country as Team Kopi." One line per conflict, `role="status"` (polite; it is a warning, not an
  error), associated to the fieldset with `aria-describedby`. **Create match stays enabled.**

### 5.6 `src/formats/btc/words.js`

`teamLabel({ name, country_code })` → `"Brunei · Team Kopi"` or `"Team Kopi"`. The one place the format is written;
setup, matches and (PR 2) the audience surfaces call it. Use a middle dot `·` with normal spaces.

### 5.7 Previews and tests

- Update `setupScreen.preview.html` and `matchesScreen.preview.html` fixtures to carry countries (two teams from one
  country, a judge from it).
- Tests for: create with and without country; edit country and represents, and clearing them; validation errors
  (represents over 60); focus after Edit, Save and Cancel; the conflict warning appearing, listing the right names,
  disappearing when the judge is unticked, and **not** disabling Create.
- Verify at **360px first** in the preview harness, light and dark, then wider.

## 6. Live payload and audience surfaces (PR 2, after PR 1 merges)

- `buildBtcLivePayload` reads `btc_teams` as `'id, name, country_code'` (`liveSession.js:284`). Judges stay
  `'id, name'`.
- `assembleBtcLivePayload` adds `country: { code, name } | null` to every team object it emits (standings, up next,
  then next, recent results, bracket slots, podium). Name from `countryName`.
- The field-pin test in `liveSession.test.js` is updated deliberately; the PR description says the payload is public
  and lists the one new field.
- `projectorScreens.js`, `projectorMoments.js`, `viewerBody.js` and `words.js` render names through `teamLabel` (or
  the country beside the name where space is tight on the projector; a long country name must not push the name off
  a 1080p card: check the longest likely names, for example "Brunei Darussalam" if `Intl` gives it, and the
  Philippines).
- `demoLivePayload.js` fixtures get countries; the two preview harnesses show them.
- Reviewers: `test-auditor`, `ui-accessibility-reviewer` (projector and phone at 360px), `module-boundary-checker`,
  `code-reviewer`.

## 7. Reviews (CLAUDE.md "Review protocol")

| PR  | Reviewers (gates in bold)                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`schema-guardian`, `security-reviewer`** (migration, grants note, anon doors), `module-boundary-checker` (`core/country.js`), `ui-accessibility-reviewer` (360px first), `test-auditor`, `code-reviewer` |
| 2   | `test-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`, `code-reviewer`                                                                                                                    |

Run them in parallel. Every gate finding and every 🔴 gets an independent fresh-context check before it is reported.
Re-run only the reviewers that raised a 🔴, on the new diff; stop after three rounds. Parallel DB reviewers share the
local database: give fixtures unique ids and run `npm run db:reset` before trusting pgTAP.

## 8. Done when

- `npm run db:reset` applies cleanly from empty; all pgTAP passes (including `040`, `041`, `045`, `020`); the rollback
  ran in a transaction and the migration re-applied with the same schema.
- `npm test`, `npm run lint`, `npm run build` and `npm run check:docs` pass; the lint hook does not fire.
- The 360px checks are done and screenshotted in the PR.
- PR 1 open against `dev`; CHANGELOG entry and the `Reviews` line written by `kb-sync`; `src/formats/btc/CLAUDE.md`
  gains one paragraph for Build E; `docs/backlog/btc.md` gains the grants item (4.3).
- **Not done by the building session:** merging (the owner says CI is green, then the main session merges), and
  pushing the migration to the cloud project (owner-approved `apply_migration` after merge, then compare
  `list_migrations`).
