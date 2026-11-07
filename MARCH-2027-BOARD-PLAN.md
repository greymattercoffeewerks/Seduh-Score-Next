# March 2027 Board plan: BTC beta (shadow scoring), Petrol V2, UX and Tour

_Planning document, 2026-11-07, updated the same day with the owner's answers (see "What the owner has told us"). Read-only research; nothing in this file has been built. Not a spec: each
work item below becomes its own task with its own reviewers. `state.json` does not exist locally, so this
plan starts from `ROADMAP.md` and `CHANGELOG.md` (v3.6.3, `package.json:3`)._

---

## What the owner has told us (2026-11-07)

- **Field:** tentatively 20 teams, 2 to 3 from each participating country (roughly 7 to 10 countries). Each team has a
  team name (Brunei's 2025 teams: Bean Bandits, The Alley, Tampd) and represents a country; four members each.
- **Format:** two preliminary rounds. Round 1 pairings are a random selection; round 2's rule is still to be confirmed.
  After round 2 the committee chooses the top 8 "after looking at the scores", and those go to the knockout.
- **Same-country teams** may meet if the random selection puts them together.
- **No draw or schedule exists yet.** Registration opens in January 2027, so the real team list arrives after the
  build window starts; rehearsals use fictional teams.

What this changes: a full round robin (190 matches) is not the format, so the schedule generator becomes a random
draw plus a round-2 rule (about 10 matches per round, 20 in all); the engine needs a way to tell preliminary round 1
from round 2 (the schema has one `preliminary` value); there is no one-team-per-country rule; and "choose the top 8
after looking at the scores" needs a decision on how much is automatic (D1).

---

## Summary

The pitch landed; the next milestones are the **Board presentation in March 2027** and, possibly, a **beta run
of BTC at the real competition in SHADOW mode**: judges and officials stay manual and authoritative, Seduh Score
records the same competition in parallel, and the two are compared afterwards.

The recommendation, in priority order:

1. **Confirm round 2's rule and how the top 8 are chosen before building the BTC schedule.** The field is
   tentatively 20 teams (2 to 3 per country) in two preliminary rounds, round 1 drawn at random, then the committee
   picks the top 8 from the scores. That clears the shipped bracket's 8-team minimum
   (`supabase/migrations/20260922130000_btc_bracket_generate_rpc.sql:68-69`) and fits `btc_standings`, which sums every
   preliminary match, but the engine was designed around a round robin (`btc_tables.sql:51` says so) and has no notion
   of preliminary round 1 versus 2. Two open questions (D1) decide the generator: how round 2 pairs teams, and whether
   the top 8 are strictly by score or by committee choice.
2. **Make a shadow run trustworthy before making it pretty.** Add a shadow-event flag (results never public, never
   archived, never in the Seduh ID feed, but still change-logged, which `is_test` is not), close the
   `btc_matches_write FOR ALL` gap (any member can mark a match confirmed without the RPC), add the BTC
   dispute-pack/CSV export, and produce a comparison report. That report is the Board's evidence.
3. **Team name and country first; members later and optional.** One forward migration adds `country_code` to
   `btc_teams` (the per-event row is already the "yearly entry"). Member backfill is a separate, opt-in table whose
   only route to Seduh ID is the existing `people` row and `link_person_identity`, never a new identity path. BTC
   does not feed Seduh ID before the owner's Section 8 sign-offs.
4. **Petrol V2 ("RON 95") is a token-layer tune-up, not a rebrand.** Seven concrete changes: a smaller, firmer
   type scale with a 16px floor for body copy on phones, a 3:1 input border token, state tokens (pressed, selected,
   disabled without opacity), motion tokens, a density token, opacity tokens, and a marketing fluid-type set. All at
   360px first.
5. **UX: the BTC organiser path has three real friction points** (no schedule generator: every
   preliminary is created by hand, about 20 matches for the 20-team field with no random draw; no "what next" on the event dashboard; scoring cannot load offline). Fix those,
   then update the Tour with real rehearsal screenshots and a country-flavoured BTC section.

The phased timeline (section 4) ends with a code freeze two weeks before the Board and two rehearsal events with a
paper-versus-app comparison. Decisions the owner must make are in section 5; reviewer triggers per phase in
section 6.

---

## 1. BTC team model and Seduh ID

### 1.1 Findings (verified in code)

- **A team is a name in one event, nothing more.** `btc_teams` is `id, event_id, name, created_at`,
  `unique (event_id, name)` (`supabase/migrations/20260918090000_btc_tables.sql:27-33`). No country, no members, no
  link across years. It is scoped through `event_id` (no `org_id`), its `event_id` is frozen
  (`20260922092000_btc_cross_event_integrity.sql:128-129`), and `(id, event_id)` is unique
  (`20261010100000_btc_seeding_tiebreak.sql:57-58`).
- **Every annual championship is already its own `events` row**, so `btc_teams` already IS the per-year entry. The
  thing that persists across years is the **country** (the delegation), not the team: teams change annually.
- **Judges are also name-only** (`btc_judges`, same file, lines 37-43) and their names are published to the live
  payload for the next two matches (`ROADMAP.md:1909`).
- **Seduh ID links people by phone, nothing else.** `people.phone` is `NOT NULL` (`20260821200000_core_tables.sql:68`)
  with an E.164 CHECK (`20261030110000_people_phone_e164_check.sql`); `people.country` exists as free text (line 71).
  `link_person_identity(org, person)` finds an existing identity for the person's phone and never creates one
  (`20261030140000_seduh_identity_link.sql`, header points 5 and "DECISION 1"). Identities are created only by the
  B4 backfill and the archive feed, from **published, non-test podiums matched to `event_entries`**
  (`20261103100000_seduh_feed.sql`, "THE RULES ARE B4's EXACTLY"). BTC has no `event_entries` and no
  `public_results` publisher (only `src/formats/cup-taster/resultsPublishing.js` exists), so **BTC creates no
  identities today and should not, yet.**
- `org_person_affiliations` (staff/affiliate roster, `20261030130000_org_person_affiliations.sql`) is the model to
  copy for a new tenant table: column-level grants, a `refuse_non_member` cross-reference trigger, frozen parents,
  matrices `040`/`041`.
- **A country picker already exists**: `phoneCountryOptions()` in `src/core/phone.js:214-229` uses
  `Intl.DisplayNames` (no new dependency, works offline), Brunei first.
- **Shadow-relevant integrity gaps, all pre-existing and documented:**
  - `btc_matches_write` is `FOR ALL`: any member can set `status = 'confirmed'` or the tie-break columns directly,
    bypassing `confirm_btc_match` (`ROADMAP.md:1304-1305`, `1819`, `2002`).
  - `btc_match_judges` can be edited after confirmation (`ROADMAP.md:1306-1307`).
  - `processed_operations.id` is a global primary key (`ROADMAP.md:1301-1302`).
  - `is_test` and `p_snapshot_at` are client-supplied to `publish_session` (`ROADMAP.md:1900-1901`).
  - A test event can take the display over from a real one (`ROADMAP.md:1902`).
- **`is_test` cannot be the shadow flag**: test events are not written to `score_change_log`
  (`20260924100000_score_change_log.sql:36-38`). A shadow run needs the change log, because every correction during
  the day is evidence for the comparison.
- **Gating**: `btc_format` is checked at first go-live (`20261023130000_entitlement_open_events.sql:27-29`); the key
  is currently off (`ROADMAP.md:99`). If it is flipped before the competition, the organising org needs a Per-event
  or Annual grant first.

### 1.2 Proposal

**A. Team name and country (build first, Phase 1).** One forward migration, `btc_team_country`:

| Column         | Shape                                              | Why                                                                                                  |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `country_code` | `text null`, `CHECK (country_code ~ '^[A-Z]{2}$')` | ISO 3166-1 alpha-2. Nullable so non-country BTC events (club leagues) keep working.                  |
| `represents`   | `text null`, 1–60 chars                            | Optional free label when a team represents a region or federation, not a country.                    |
| (no unique)    | none on `country_code`                             | **A country sends 2 to 3 teams (owner, 2026-11-07), so no uniqueness.** Names stay unique per event. |

- Names are stored, never derived: the display name comes from `Intl.DisplayNames` at render time (no country
  table to maintain, offline-safe). Flags: **do not use emoji flags** (Windows renders two letters); show the code
  and the name in text. A flag set can be a later asset.
- Extract `countryOptions()` / `countryName()` from `core/phone.js` into `src/core/country.js` (second-use rule;
  phone keeps calling it). `module-boundary-checker` signs off.
- Surfaces: setup form gets a country select (Brunei first, as the phone picker); the payload gains `country`
  (`code`, `name`) per team; projector, phone and bracket show "Brunei · Team Kopi" style labels; the
  `assembleBtcLivePayload` field-pin test is updated deliberately (the payload is public).
- **Cross-year continuity is derived, not stored**: "Brunei's results across 2026–2027" is a read over
  `events` (format `btc`, same org) joined to `btc_teams` by `country_code`. No org-level team registry until a real
  need appears (a team that keeps its identity across years with changing country, or a club league). If it comes,
  it is a nullable `btc_teams.org_team_id` pointing at an org-scoped `org_teams` table, added later without touching
  existing rows.
- Grants: follow the column-level rule for the new columns (`CONVENTIONS.md:185-193`), even though `btc_teams`
  predates it.

**B. Optional member backfill (Phase 3, only on the owner's yes, after Section 8).** New tenant table
`btc_team_members`:

| Column                      | Notes                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`, `event_id`, `team_id` | `(team_id, event_id)` references `btc_teams (id, event_id)` (the composite key already exists)             |
| `person_id uuid null`       | references `people(id)` of the event's org; **nullable**                                                   |
| `display_name text`         | required when `person_id` is null; a member can be recorded by name alone                                  |
| `role text`                 | `member` / `captain` / `coach` / `alternate`, free text with a format check (the `relationship` precedent) |
| `seat smallint null`        | 1–4 if the committee wants order; no hard cap of 4 in SQL (alternates)                                     |
| `created_at`, `created_by`  | defaults; not client-writable                                                                              |

- Checklist from `CONVENTIONS.md:165-213` in full: RLS on `app.is_org_member` via `app.org_id_for_event`, frozen
  `event_id`/`team_id`/`person_id`, a `refuse_non_member` trigger that checks the person belongs to the event's org,
  column-level grants, matrices `040` (and `041` if an RPC is added).
- **The only route to Seduh ID is the existing one**: a member who has a `people` row with a phone gets linked by
  calling `link_person_identity` exactly as the People screen does (T-ID.C1). No identity is created from BTC. A
  name-only member is never linked.
- **Why nullable `person_id`**: `people.phone` is `NOT NULL` and E.164-checked. Forcing a phone for every
  foreign team member is a privacy cost the committee may not accept and data it may not have. Name-only is enough
  for "who was on Brunei's 2027 team".
- **Not shown on any public surface** in this phase. The live payload stays team name + country.
- Extending the archive feed (or a BTC podium) to create identities for team members is a **separate decision**
  (D7), needs Section 8 sign-off, a Privacy page change in the same PR, and its own spec. Recommend: not before the
  Board.

**C. Shadow mode (Phase 1, needed for the beta).** One forward migration, `events_shadow_run`:

- `events.is_shadow boolean not null default false`, logged on change like `is_test` (both directions), frozen
  once the event's first BTC match is confirmed (so results cannot be re-labelled official afterwards).
- Effects, each held by a test: excluded from `public_live_now()`, from `public_results` publishing and the archive
  tick, from the Seduh ID feed; **still** in `score_change_log` and `get_dispute_pack`.
- Rendering (D9's discipline, separate meaning): a persistent "UNOFFICIAL · SHADOW RUN · Official results are the
  judges' sheets" band on every organiser and audience surface. **Do not reuse violet** (`--color-test` is reserved,
  `DESIGN.md` "is_test is violet"). Proposed new reserved token pair `--color-shadow` (graphite hatch on
  `--clr-petrol-700`, white text) defined in both surface modes and contrast-checked.
- Recommended default: **no audience surface during the real competition** (organiser screens only). If the
  committee wants a room display, it carries the band (decision D4).

**D. Integrity hardening before the beta (Phase 1).**

1. Split `btc_matches_write` into read + insert/delete for members and route every status, tie-break and judge
   change through `SECURITY DEFINER`/`INVOKER` RPCs, as Throwdown already does (API roles hold SELECT only:
   `20261103111000_throwdown_tables.sql:19-20`). Freeze `btc_match_judges` once the match is confirmed.
2. `publish_session` reads `is_test` (and the new `is_shadow`) and `format` from `events`, and clamps
   `p_snapshot_at` to `now()` (`ROADMAP.md:1900-1901`).
3. Test-event takeover guard (`ROADMAP.md:1902`), now that the stale 4 Oct session can be replaced.

### 1.3 "Seduh ID properly online": what is still owed

Layer 1a is built and in the cloud; Layer 1b (the archive feed) is in `queue` mode with nothing queued
(`ROADMAP.md:1960`, `CHANGELOG.md:88-94`). To call it properly online:

| #   | Item                                                                                                        | Owner / builder        | Source                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------- |
| 1   | First real Community event ends after the 2026-11-02 floor; watch the archive publish ~24 h later           | Owner (needs an event) | `ROADMAP.md:1979`, `1983`        |
| 2   | That publish puts one row on the feed queue; review it and run `app.seduh_identity_feed` for the trusted id | Owner (SQL runbook)    | `CONVENTIONS.md` "Seduh ID feed" |
| 3   | Weekly queue review habit recorded (decided 2026-11-03), and replies from `hello@`                          | Owner                  | `CHANGELOG.md:86`                |
| 4   | Publish the C4 wording (`design/copy/seduh-id-wording-DRAFT.md`)                                            | Owner edits, then a PR | `ROADMAP.md:1957`                |
| 5   | Section 8 sign-offs (`HANDOFF-CORRECTION-004.md`, local only)                                               | Owner                  | `ROADMAP.md:1958`                |
| 6   | Legal read KIV: controller/processor, PDPO commencement, minors, Singapore cross-border wording             | Owner                  | `ROADMAP.md:1956`, `1985`        |
| 7   | `pg_cron` run-details purge (about 288 rows a day)                                                          | Build, small migration | `ROADMAP.md:1983` item 4         |
| 8   | Row-id existence oracle on 24 tenant tables (low)                                                           | Build, per table       | `ROADMAP.md:1959`                |

Recommendation: **items 1–4 before the Board** (they are what lets the owner say "live and reviewed"); 5 and 6 gate
any BTC member feed; `auto` mode stays off through March (it removes the human who closes the forgery gap,
`20261103100000_seduh_feed.sql`, "THE FORGERY GAP IS NOT CLOSED"). If no Community event happens naturally, run a
small real one (a café Cup Taster) in December to produce the first publish.

### 1.4 Privacy implications

- **Team name + country** is organisational data; little personal-data risk. It becomes personal when a team is
  named after a person: the setup hint should say "team or country name, not a person's name".
- **Judge names** are already public in the payload. For a real competition the judges are another body's
  officials: ask the committee before showing them (D5), or hide judge names when `is_shadow`.
- **Members** (backfill) are personal data of foreign nationals: cross-border transfer (Supabase,
  `ap-southeast-1`, Singapore), possibly minors (D6), and the Privacy page must change in the same PR
  (`src/marketing/CLAUDE.md`, "Trust pages"). Name-only, organiser-visible, no phone by default.
- **Shadow results must not leak as results**: no archive row, no homepage listing, no Seduh ID identity, and the
  dispute pack stays organiser-only.

### 1.5 Risks

- The real rules differ from the shipped engine (team count, cups per round, bonus rules, 3 judges). Highest risk;
  addressed by D1 before any build.
- Transcription noise: in shadow mode a Seduh scorer copies the judges' token cards. Differences will mostly be
  transcription, not engine faults. The comparison report must classify each difference (section 4, gate G1).
- Splitting the `btc_matches` write policy touches every BTC write path and the demo loader; it needs a full
  regression and both gate reviewers.
- Scope creep into Seduh ID Layer 2 (member claims, profiles). Out of scope until after March.

### 1.6 Open questions

1. How many teams, how many cups per round, what bonuses, how many judges, is there a third-place match? (D1)
2. ~~One team per country?~~ Answered: 2 to 3 per country, each with its own team name; same-country pairings are allowed when drawn. (D3, closed)
3. Does the committee want any member data at all this year? If yes, names only or with phones? (D6, D7)
4. Room display during the beta: none, or with the Unofficial band? (D4)

---

## 2. Petrol V2 ("RON 95": more refined, higher octane)

### 2.1 Findings (verified)

- **Small type dominates.** Usage counts across `src/**/*.css`: `--text-3xs` (11px) 13, `--text-2xs` (12px) 44,
  `--text-xs` (13px) 44, `--text-sm` (14px) 113, against `--text-base` (16px) **15**. Every form label is 12px
  uppercase (`src/ui/tokens/components.css:139-144`). On a 360px phone in a venue that is the weakest part of the
  system.
- **Thirteen type steps**, four of them between 11 and 14px (`src/ui/tokens/typography.css:29-44`), and no fluid
  steps: marketing invents its own `clamp()`s and literals (`src/marketing/landing.css:353`, `363`, `389` is
  `10.5px`, `474`, `690`, `809`; `src/marketing/tour.css:115`, `184`, `302`, `424` is `0.65rem`, `431`).
- **Input boundary fails WCAG 1.4.11**: `.field-input` uses `--color-border` (petrol-300 on petrol-50, 2.47:1)
  (`components.css:157-168`, recorded at `ROADMAP.md:1859`).
- **Disabled is opacity**: `.btn:disabled` at 0.6 (`components.css:94-97`); ~3.1:1 for the one control a card is
  explaining (`ROADMAP.md:1863`). There are **13 distinct opacity literals** in the CSS (0.16 to 0.7).
- **No state tokens**: `:active` appears in only five stylesheets; selected/pressed states (BTC's 0/1/2/3 segmented
  control, nav current page) are styled per screen.
- **No motion tokens**: durations 0.2s, 0.28s, 0.45s, 0.5s, 0.72s, 0.8s, 1.1s and easings are literals; 25
  `prefers-reduced-motion` blocks, one of them in tokens.
- **Density is fixed loose**: `.screen-container` gap is `--space-6` (32px) at every width (`components.css:30`);
  on a 360px scoring screen that is a lot of scrolling between cups.
- **Raw px**: `landing.css` 110 occurrences, `appShell.css` 42, `publicHeader.css` 31; breakpoints are literals
  (640, 1366, 480, 1439) with no documented set; 21 literal `font-weight` values.
- **Every card is framed in 2px graphite** (`components.css:57-62`) because canvas (petrol-100) and surface
  (petrol-50) are one step apart. It works, but heavy frames on every card make primary actions and status harder
  to find.
- **Docs drift**: `CONVENTIONS.md:508-537` still describes the clay ramp and Cabinet Grotesk/Switzer/JetBrains Mono;
  `DESIGN.md` open item 2 says only Login and Setup were restyled.
- No paper dark mode exists (no `prefers-color-scheme` anywhere); "dark" in reviews means the stage surface. Keep it
  that way for V2.

### 2.2 Proposal (token-level; no new palette, fonts or shape language)

Each change lands in `src/ui/tokens/` first, with `preview.html` and `DESIGN.md` updated and checked at 360px,
then screens adopt it.

1. **Type scale, firmer.** Keep the names so nothing breaks, retune and retire:
   - Body floor: `--text-base` stays 16px; **phones (below 640px) use `--text-sm` = 15px** instead of 14px.
   - `--text-xs` becomes an alias of `--text-2xs` (13px) and is deprecated; `--text-3xs` (11px) is legal/print only
     (a lint-style test like `components.test.js` fails new uses).
   - Form labels: `--text-xs` (13px), sentence case, `--font-weight-semibold`, `--color-text` (not secondary). Keep
     uppercase only for kickers.
   - Add fluid display tokens for the public pages: `--text-fluid-hero: clamp(2.25rem, 6vw + 1rem, 4.5rem)`,
     `--text-fluid-h2: clamp(1.75rem, 3vw + 1rem, 2.75rem)`, `--text-fluid-h3: clamp(1.375rem, 2vw + 0.8rem, 1.875rem)`;
     replace the marketing literals (and the 10.5px / 0.65rem labels become `--text-2xs`).
2. **Contrast and borders.**
   - New `--color-border-input`: petrol-500 in paper (≈6:1 on petrol-50), petrol-400 in stage; `.field-input` uses
     it. Closes 1.4.11.
   - New `--color-border-subtle` (petrol-200 paper / petrol-800 stage) for passive, non-interactive cards; keep the
     2px strong frame for cards that are actions or live state. Verify the passive card still separates from canvas
     (if not, darken canvas to petrol-200 in paper and recheck the whole contrast table).
   - Stage `--color-text-muted` is at 4.5:1 exactly (`DESIGN.md`): move it to petrol-300 or forbid it on stage text
     smaller than 18px.
3. **State tokens.** `--color-state-hover`, `--color-state-pressed`, `--color-state-selected` (+ `-contrast`) per
   surface mode; `--color-disabled-fg` / `--color-disabled-bg` replacing opacity (disabled stays recognisable and
   still exempt from contrast, but stops looking "broken"). A shared `[aria-pressed='true']` / `[aria-current]`
   rule in `components.css` for segmented controls and nav.
4. **Motion tokens.** `--duration-instant 80ms`, `--duration-fast 160ms`, `--duration-base 240ms`,
   `--duration-slow 480ms`, `--duration-stage 800ms`; `--ease-out`, `--ease-in-out`, `--ease-linear`. One global
   `@media (prefers-reduced-motion: reduce)` in `base.css` that sets the durations to `0ms` (replacing most of the 25
   per-file blocks). Stage moments keep their holds (they are timing, not motion).
5. **Density.** `--density-gap` = `--space-4` below 640px, `--space-6` above; `.screen-container` uses it. Tap targets:
   `--tap-target-min` stays 44px; add `--tap-target-score: 3rem` (48px) for scoring buttons used standing up.
6. **Opacity and elevation.** `--opacity-scrim`, `--opacity-ghost`, `--opacity-dim` (three values replacing 13). Still
   no shadows (D31).
7. **Breakpoints documented** in `spacing.css` as comments plus a JS constant (`core/breakpoints.js`) since CSS
   custom properties cannot be used in media queries: 360 (design floor), 640, 1024, 1366.
8. **Docs**: rewrite `CONVENTIONS.md` "Design tokens" to Petrol (V2), close `DESIGN.md` open item 2 by listing which
   screens have been checked.

Order of rollout: tokens + preview (one PR), then components.css (one PR), then screens in the order the beta uses
them: BTC scoring, matches, setup, bracket, standings, BTC phone/projector, then Cup Taster, then marketing.

### 2.3 Risks

- A type retune changes every screen's height; projector layouts with fixed canvases (`--text-5xl/6xl`) must not
  move (V2 leaves those two untouched).
- Changing `--color-canvas` re-themes the console and the stage-mode marketing pages at once; recheck the full
  `DESIGN.md` contrast table and the brand-accent engine (`core/brandColor.js` keeps 4.5:1 per surface).
- Fifth identity fatigue: the marketing `CLAUDE.md` warns against another palette swap. V2 must stay token tuning;
  no hue changes except borders and the new shadow-run token.

### 2.4 Open questions

1. Is 15px the phone body size the owner wants, or 16px everywhere (more scrolling)? (D9)
2. Keep uppercase micro-labels in marketing kickers (part of the telemetry look) while the console drops them?

---

## 3. UX audit and the Tour

### 3.1 BTC organiser flow: findings, in the order an organiser meets them

| #   | Step      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Severity for the beta |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 1   | Rules     | Bracket requires at least 8 teams (`20260922130000_btc_bracket_generate_rpc.sql:68-69`), met by the tentative 20; it needs every preliminary confirmed, then takes the top 8 by points and wins. Two preliminary rounds fit the standings view, but the schema has one `preliminary` round value and no round number. Preliminary 15 cups, knockouts 20 (`src/formats/btc/scoring.js:36-40`). Round 2's rule and whether the cut is strictly by score are unknown. | Blocking              |
| 2   | Dashboard | The BTC event hub is four links (Setup, Matches, Standings, Bracket) and a test banner (`src/formats/btc/eventDashboardScreen.js:99-131`); no progress ("12 of 28 preliminaries confirmed"), no next step, no Live-now badge (Cup Taster has one, `src/formats/cup-taster/eventDashboardScreen.js:44`), no "show this event" control (`ROADMAP.md:1908`).                                                                                                          | High                  |
| 3   | Setup     | Teams are name-only; no country (section 1). Judges name-only. Demo-data card is good.                                                                                                                                                                                                                                                                                                                                                                             | High (country)        |
| 4   | Matches   | **No schedule generator.** Each preliminary is created by hand: two team selects plus three judge checkboxes (`src/formats/btc/matchesScreen.js`); the 20-team field is about 20 matches (10 per round) at 5 clicks each, with a random draw done off-screen, with no duplicate-pair warning (`create_btc_match` has no idempotency key by design, `src/formats/btc/CLAUDE.md:100-111`).                                                                           | High                  |
| 5   | Scoring   | Solid: drafts in IndexedDB, confirm state machine, stale-draft handling (`scoringScreen.js:13-19`). But the **screen cannot load without the network** (`ROADMAP.md:1318`), and the confirm waits for the display publish (`ROADMAP.md:1905`).                                                                                                                                                                                                                     | High (offline)        |
| 6   | Standings | Good empty state (`standingsScreen.js:166`). Fine.                                                                                                                                                                                                                                                                                                                                                                                                                 | Low                   |
| 7   | Bracket   | Blocked state explains itself (`bracketScreen.js:1014`). Seeding tie-break works. Provisional lists are tall at 360px (`ROADMAP.md:1865`).                                                                                                                                                                                                                                                                                                                         | Low                   |
| 8   | Records   | **No BTC dispute-pack button** (`ROADMAP.md:1811`), though `get_dispute_pack` already reads the `btc_*` tables (`src/core/disputePack.js:1-5`). No CSV. This is the shadow comparison's input.                                                                                                                                                                                                                                                                     | Blocking for G1       |
| 9   | Live      | Projector and phone are built. Open: body live region re-read on every update (`ROADMAP.md:1874`), no publish coalescing (`1906`), a stuck publish can block a confirm (`1904`), and moments not yet seen on the real TV (`1790`).                                                                                                                                                                                                                                 | Medium                |

### 3.2 Cup Taster flow (live since 4 Oct, lower priority for March)

Proven at a real event; the open items are known and listed in `ROADMAP.md` (projector moments `1786-1798`, publish
path `1900-1913`). For the Board only two matter: thread `allOutboxHandlers` into Cup Taster's timing, manual-timing
and standings routes (`ROADMAP.md:1903`, a cross-format head-of-line block that also hits BTC on a shared device),
and the "played before confirmed" standings signal (`1793`). Everything else waits.

### 3.3 Proposals (prioritised)

1. **Preliminary draw and schedule** (`generate_btc_preliminaries(org, event, round, ...)`): creates one preliminary
   round in one transaction, refuses if that round already has matches. **Round 1: a random draw** (20 teams, 10
   matches; same-country pairings allowed, as the owner said), with a manual override and a shown, saved seed so the
   draw can be explained. The repo already has a live draw board (the Random Selector's split-flap board, with a
   "lift it into core" item in `ROADMAP.md`), so the draw can be a visible ceremony rather than a hidden shuffle.
   **Round 2: rule to be confirmed (D1)**; the likely options are a second random draw avoiding repeat opponents, or
   pairing by round-1 results. Needs a `round_number` (or label) on preliminary matches so the dashboard and the draw
   know which round they are in; `btc_standings` already sums both. A full round robin by the circle method stays as an
   option for small fields. The manual form stays for corrections. Needs `schema-guardian` + `security-reviewer` +
   `scoring-auditor` (it decides who plays whom).
2. **Dashboard as a run sheet**: progress per phase, the next action as the primary button, Live-now badge, the
   audience links card, and the Unofficial band when `is_shadow`.
3. **Offline scoring load**: mirror the event's teams, judges and matches into IndexedDB on dashboard load (Cup
   Taster's mirror pattern, `core/db.js`), so a scorer who opened the event once can reopen a match with no network.
4. **Records card**: "Download the record (JSON)" (dispute pack) and "Download scores (CSV)" (one row per cup: match,
   round, cup, team1 tokens, team2 tokens, plus a row per match for bonuses, times and totals, via `core/export.js`).
5. **Copy pass** (with `intent:articulate`-style review): "Match scheduled — not yet scored", "Confirmed", the
   tie-break and seeding prompts are good; tighten the setup demo paragraph (`setupScreen.js:325`, 60+ words) and
   make every refusal hint map to a sentence that says what to do next (the `REFUSALS` tables).

### 3.4 The Tour (`/tour/`) for the Board

Current state (`src/marketing/tourScreen.js`): hero says three formats are live (line 106); BTC is text-only
(`buildBtc`, 174-208) because no real BTC photo exists; Throwdown likewise (213-244); Liga Seduh is the planned card
(279-286); Community is section 05.

Proposed updates, in order:

1. **BTC section rewritten for the competition story**: "Countries field teams. Teams play two preliminary rounds, the
   top eight go through to a seeded knockout" (adjust to D1's answer), name and country on the bracket, the shadow-run
   framing only if the owner wants it public (D10).
2. **Real screenshots, honestly labelled**: capture from rehearsal 1 (test event, demo roster, fictional teams) the
   scoring screen at 360px, the bracket, and the projector champion screen. Label as "Seduh Score screens from a
   rehearsal", `alt` text describing the screen, never implying a real match. Images in `public/marketing/`,
   compressed, with width/height to avoid layout shift. Same for Throwdown.
3. **Planned formats**: keep Liga Seduh; add "Seduh ID" only as a short, careful line if the Section 8 sign-offs
   allow it (the "free" claim is dropped, `ROADMAP.md:1958`).
4. **Board-only material does not go on the public Tour.** The comparison report and roadmap live in a private
   Board pack (an artifact or PDF), not on `/tour/`.
5. Mechanics: section numbering, `tourScreen.test.js` (it keeps unbuilt modules out of copy), the prerender route,
   the smoke test and the Privacy page if any real person appears in a screenshot.

### 3.5 Risks and open questions

- Screenshots go stale if Petrol V2 lands after capture: capture after V2's BTC screens (Phase 3).
- The committee has no published draw yet (registration opens January 2027), so the generator's input is the team
  list as registered; still support a manual override of any pairing, in case the committee draws on stage and the
  app records it. (D2)

---

## 4. Timeline, November 2026 to March 2027

Assumes the Board meets in **mid-March 2027** and the competition date is unknown (D11). Dates are targets.

| Phase                         | Dates             | Work                                                                                                                                                                                                                                                                                                                                                                       | Exit                                                           |
| ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **P0 Decide and specify**     | 9–22 Nov          | Owner answers D1–D11. Write three short specs (local): BTC country + shadow mode, preliminary draw and schedule, Petrol V2 tokens. Quick wins with no migration: BTC records card (dispute-pack JSON + CSV), dashboard progress + Live-now badge, docs drift fix in `CONVENTIONS.md`.                                                                                      | Rules confirmed; specs approved                                |
| **P1 Trustworthy shadow run** | 23 Nov – 20 Dec   | Migrations: `btc_team_country`, `events_shadow_run`, `btc_matches` write-policy split + judge freeze, `publish_session` reads flags and clamps time, preliminary draw and schedule with a round number (round 2's rule per D1); no bracket-size change needed for 20 teams. UI: country select, Unofficial band, payload country. Seduh ID items 1–3 (first real publish). | All gate reviewers clean; cloud migrations pushed and compared |
| **P2 Petrol V2 + offline**    | 4 Jan – 31 Jan    | V2 tokens and components, BTC screens first. Offline: scoring load from mirror, publish coalescing, give-up rule for a stuck publish, `allOutboxHandlers` in Cup Taster routes. **Rehearsal 1** (mid-January): internal, 8 fictional country teams, paper scoresheets scored in parallel by a second person.                                                               | G2 offline soak passed; rehearsal 1 report                     |
| **P3 Rehearsal 2 + Tour**     | 1 Feb – 28 Feb    | Fix rehearsal 1 findings. **Rehearsal 2** on the real venue's wifi and devices, with someone from the committee if possible, on a real non-test event with `is_shadow`. Tour update with screenshots. Optional member backfill (only if D6 = yes and Section 8 signed).                                                                                                    | G1, G3, G4 passed                                              |
| **P4 Freeze and Board pack**  | 1 Mar – Board day | Code freeze two weeks before the Board (bug fixes only). Board pack: comparison report, screenshots, roadmap. `kb-sync`, version bump (BTC with countries is a minor bump; Liga Seduh would be the next nameplate).                                                                                                                                                        | G5                                                             |

### Beta-run readiness gates (all must pass before the real competition)

- **G1 Shadow comparison report.** From rehearsal 2: for every match, cup-level token agreement, bonus agreement,
  totals, winners, standings order, bracket and podium. Each difference classified as transcription, rules
  interpretation, manual arithmetic, or system defect. **Pass: zero system defects; every transcription difference
  traceable in `score_change_log`.** The same template is used on competition day.
- **G2 Offline hardening.** A scorer device in airplane mode can open an already-visited match, score it, confirm,
  and the confirm drains on reconnect with no lost write; a 30-minute soak with the network toggled every few
  minutes (Phase 6's soak method, `ROADMAP.md:1041`) on two devices at once; the sync chip tells the truth
  throughout. Reviewed by `offline-sync-auditor`.
- **G3 Rehearsal event.** A full event run end to end (setup with countries, drawn round 1, round 2, all
  preliminaries, seeding, knockout, podium) by someone other than the developer, on venue hardware, inside the
  committee's real schedule.
- **G4 Shadow isolation.** Proven by test and by a live check: a shadow event never appears on `/results/`, the
  homepage live bar, the archive ledger or the Seduh ID queue, and every surface shows the Unofficial band.
- **G5 Operations.** Cloud migrations match the repo (`list_migrations`), advisors re-run, previous deployment one
  click from rollback, `btc_format` gating decision made (D8), a named on-site operator and a paper fallback the
  committee already uses.

---

## 5. Decisions needed from the owner

| #   | Decision                                                                                                                                                                                                                                                                                                                     | Recommendation                                                                                                     | Needed by   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| D1  | Real competition rules. Known: ~20 teams, 2 to 3 per country, two preliminary rounds, round 1 random, the top 8 chosen after round 2. Open: **round 2's pairing rule; whether the top 8 are strictly by score (and the tie rule at 8th/9th) or by committee choice**; cups per round, bonuses, judges per match, third place | Get the committee's rulebook; adapt the engine only where it differs. **Blocks the generator and the cut design.** | 15 Nov      |
| D2  | Round 1 draw: a seeded random draw in the app (a visible draw ceremony), or recorded from a draw the committee makes?                                                                                                                                                                                                        | App draw with a saved seed and manual override; no import needed, as there is no published draw yet                | 22 Nov      |
| D3  | ~~Same-country teams~~ Answered: each team has its own name (Bean Bandits, The Alley, Tampd for Brunei in 2025), and same-country teams may meet if drawn together                                                                                                                                                           | Country code plus unique team name per event; no country uniqueness; no pairing restriction                        | Closed      |
| D4  | Room display during the shadow run                                                                                                                                                                                                                                                                                           | None; organiser screens only                                                                                       | 22 Nov      |
| D5  | Show judge names on any surface for a real competition                                                                                                                                                                                                                                                                       | Hide when `is_shadow`                                                                                              | 22 Nov      |
| D6  | Member backfill this year? Names only, or with phones?                                                                                                                                                                                                                                                                       | Not before the Board; if yes, names only                                                                           | 31 Jan      |
| D7  | May BTC ever create Seduh ID identities?                                                                                                                                                                                                                                                                                     | Not before Section 8 sign-offs and a separate spec                                                                 | After March |
| D8  | `btc_format` gating key: flip before the competition, and with which plan for the committee's org?                                                                                                                                                                                                                           | Keep off until after the beta; or grant Per-event first                                                            | 31 Jan      |
| D9  | Phone body size 15px or 16px                                                                                                                                                                                                                                                                                                 | 15px under 640px                                                                                                   | 4 Jan       |
| D10 | Mention the shadow beta publicly on the Tour?                                                                                                                                                                                                                                                                                | No; Board pack only                                                                                                | 1 Feb       |
| D11 | Board date and competition date                                                                                                                                                                                                                                                                                              | Needed to fix the freeze date                                                                                      | 15 Nov      |
| D12 | Seduh ID: publish C4 wording; run a December Community event to get the first archive publish                                                                                                                                                                                                                                | Yes to both                                                                                                        | 1 Dec       |

---

## 6. Reviewer triggers by phase (CLAUDE.md "Delegation strategy" and "Review protocol")

| Phase / item                                                   | Reviewers (run in parallel; gate findings get an independent check)                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 records card, dashboard, docs                               | `module-boundary-checker`, `ui-accessibility-reviewer` (360px first), `test-auditor`, `code-reviewer`; docs-only parts `code-reviewer`                          |
| P1 `btc_team_country`, `events_shadow_run`                     | `schema-guardian` (rollback run in a transaction), `security-reviewer` (non-member reads zero rows; matrices `040`/`041`), `code-reviewer`                      |
| P1 `btc_matches` policy split, judge freeze, `publish_session` | `security-reviewer`, `schema-guardian`, `scoring-auditor` (confirm path), `offline-sync-auditor` (queued confirms still drain), `test-auditor`, `code-reviewer` |
| P1 preliminary draw and schedule                               | `scoring-auditor`, `schema-guardian`, `security-reviewer`, `test-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`, `code-reviewer`              |
| P1 country select, payload country, Unofficial band            | `module-boundary-checker` (`core/country.js` extraction), `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`                                          |
| P2 Petrol V2 tokens and screens                                | `ui-accessibility-reviewer` (every pairing re-measured, 360px first), `module-boundary-checker`, `code-reviewer`                                                |
| P2 offline scoring load, coalescing, give-up rule              | `offline-sync-auditor` (blocking), `test-auditor`, `code-reviewer`                                                                                              |
| P3 member backfill (if approved)                               | `schema-guardian`, `security-reviewer`, `test-auditor`, `code-reviewer`; Privacy page in the same PR                                                            |
| P3 Tour update                                                 | `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`                                                                                                    |
| End of every task                                              | `kb-sync`; push each migration to the cloud as its own owner-approved step and compare `list_migrations`                                                        |

A cross-cutting change (the policy split, V2's tokens) gets every applicable reviewer and a second pass if the first
finds a 🔴. Three review rounds on one change, then stop and rethink (`CLAUDE.md`, "Re-review must converge").

---

## 7. Invariants this plan keeps

- `src/core/` gains only format-agnostic pieces (`country.js`, `breakpoints.js`, tokens); BTC logic stays in
  `src/formats/btc/`.
- Tenancy: every new table follows the eight-point checklist; nothing reads `org_members` directly; no client can
  write `people.global_person_id`.
- Totals, standings and winners stay derived (`correct` is a count, never a column); the comparison report reads the
  views and the dispute pack, never a stored tally.
- Migrations are forward-only, each with a rollback block, never edited after the cloud push.
- `is_test` stays violet and unmistakable; the shadow band is a separate, reserved treatment.
- The word "set" means set; the banned vocabulary stays out of new copy and identifiers.
