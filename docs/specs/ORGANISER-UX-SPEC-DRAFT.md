# Organiser UX for the March 2027 run: spec draft

_Draft, 2026-11-10. Build progress: S1 (core kit, PR #446) and S2 (BTC dashboard, PR #447) are merged into `dev`;
S3 to S5 not started (section 11). Source: [`MARCH-2027-BOARD-PLAN.md`](../../MARCH-2027-BOARD-PLAN.md)
section 3 (the UX audit) and its timeline, read against what has shipped since (Builds E, A, D and B part 1, see
`CHANGELOG.md`). The owner answered Q1 to Q12 on 2026-11-10 (section 9); the text below follows those answers. Only
Q10 (the committee's paper scoresheet) is waiting on a document._

---

## 1. Purpose and scope

The engine work (the draw, round numbers, finish times, points-only ties) is specified in
[`BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md`](BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md). This spec is **everything an organiser
sees and does around it**: how they find out where the event stands, what to do next, how they get the record out, and
how the console holds up on the day.

**In scope:** the BTC event dashboard, the matches list around the Draw panel, the cut to the top 8 (a section of
Standings) with its sign-off sheet, the records card, the live-surface controls an organiser needs, and a copy pass on
the BTC organiser screens. Offline loading of the scoring screen belongs to the offline track (Q11); this spec only
shows its status on the dashboard.

**Out of scope here (owned elsewhere):** the Draw panel itself (engine spec 4.3), the tie card's time evidence (engine
spec 5.2), the shadow-event flag's database work (plan P1, `events_shadow_run`), Petrol V2 tokens (shipped in 3.6.6),
the Tour. Cup Taster and Throwdown screens are not changed in this work.

**Built to be ported (owner, 2026-11-10).** BTC is the only format changed for March, but every organiser-facing piece
is built as a format-agnostic `src/core/` module that BTC feeds with its own data, so Cup Taster, Throwdown and Liga
Seduh adopt it later **without editing `core/`** (the handoff section 6 test). Section 3a lists the shared modules and
the contract each format supplies.

## 1a. Visual reference (approved by the owner, 2026-11-10)

The mockup canvas **"BTC Organiser UX"** (claude.ai artifact `FoPsg8HeygcHqeSFGBoWNv`, private to the owner; ask them
for access) is the approved design. **Build it exactly, or as close as the real app allows.** Where the canvas and this
text disagree on looks, the canvas wins. Where they disagree on behaviour, this text wins, and the canvas gets fixed. It has
five artboards, all with fictional data:

| Artboard                    | Spec item | What to match                                                                                                                                                                |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard, tablet landscape | U1        | Next-step card on top (3px accent edge, cut-corner primary button); run sheet as a 2-column grid of phase cards; right rail of 380px with Needs attention, Live now, Records |
| Dashboard, phone 360px      | U1        | The same content in one column; event links as a 2-by-2 grid at the bottom                                                                                                   |
| Matches by round            | U2        | Draw summary card; Round 1 collapsed with its count; Round 2 as rows (no., teams with flag and code, score, judges, status tag, actions)                                     |
| The cut                     | U3        | Points and times per round, the level teams tinted with a warning edge, a black "Cut line · top 8 go through" bar, the tie card and Lock card on the right                   |
| Sign-off sheet (A4)         | U3        | Beta band boxed at the top, the eight in seed order, "Ties settled" box, "Not going through" in two columns, two signature blocks                                            |

Visual rules taken from the canvas, all on existing Petrol V2 tokens (no new palette):

- **The beta band** (`core/statusBand.js`): graphite bar (`--color-text` paper value as fill), 4px amber bottom edge
  (stage warning tone), a small diagonal hazard stripe, display-face caps "Seduh Score ABTC Beta Test", and one line
  of plain text. Never violet. The test band keeps its own violet look; an event can never be both.
- **Phase cards**: 2px edge; the active phase 3px in the accent; a waiting phase dashed; a not-started phase on the
  lighter border with secondary text; a square status tag in the state's colour; progress as an 8px bar, with
  "scoring" shown as a hatched segment after the confirmed one.
- **Country flags** beside the two-letter code, 24 by 16, the code always shown as text too (the flag is decoration,
  `aria-hidden`). The canvas draws simplified flags in CSS; the app ships real **SVG** flags, self-hosted beside
  `core/country.js` (no CDN at a venue), from an openly licensed set, one file per code. A shared `core/countryFlag.js`
  renders flag plus code, used wherever `teamLabel` is. Team flags may reach the audience surfaces; judge flags stay
  organiser-only, as judge country does today. Licence and source are picked in the stage that adds them, recorded
  in the Privacy and credits page if the licence asks for attribution.
- Square corners everywhere, no shadows, cut corners only on the one primary button per screen, mono figures for
  every score, count and time.

## 2. Who uses it, and where

- **The organiser**: one person running the event from a **tablet in landscape** at the control table, with a **phone
  as the backup** (Q6). Creates rounds, assigns judges, confirms the cut, records tie-breaks, publishes to the room.
- **Scorers**: in March the organiser's device enters the scores (Q2). Nothing may assume one device, though: scorer
  tablets are a likely next step, so the shared modules take per-row actions and statuses from the format and never
  assume the viewer is the person who created a match. No scorer-only view is built now.
- **Venue conditions**: unreliable wifi (the plan's G2 gate), a shadow run where paper stays authoritative, a fixed
  committee schedule. A wrong number on screen costs trust in front of the committee, so every screen must say what
  is provisional.
- Check order: 360px first (repo rule, and the backup phone), then tablet landscape (about 1024 to 1366 by 768 to
  1024), which is the layout the run sheet is designed around: phase cards in two columns, warnings and the live card
  beside them.

## 3. U1: the event dashboard as a run sheet

**Problem.** `src/formats/btc/eventDashboardScreen.js` is four links (Setup, Matches, Standings, Bracket), the test
banner, a "N preliminary matches have no times" line and the homepage listing card. It does not say which phase the
event is in, what is left, or what to press next. Cup Taster's dashboard has a "Live now" badge; BTC's does not.

**Proposal.** One card per phase, in order, each with a status and a count, and **one primary button: the next
action**. The four existing links stay as secondary navigation.

| Phase    | Done when                                                                     | Count shown                                 | Next action                        |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| Setup    | an even number of teams, at least 3 judges, **every team has a country** (Q3) | "20 teams · 9 judges · 2 without a country" | Add teams / judges / Set countries |
| Round 1  | every round-1 match confirmed                                                 | "7 of 10 confirmed"                         | Draw round 1 / Score next          |
| Round 2  | every round-2 match confirmed                                                 | "0 of 10 confirmed"                         | Draw round 2                       |
| The cut  | top 8 settled (ties recorded), bracket generated                              | "2 ties to settle"                          | Settle ties / Generate bracket     |
| Knockout | final and third place confirmed                                               | "QF 4 of 4 · SF 1 of 2"                     | Assign judges / Score next         |
| Podium   | podium decided                                                                | champion, runner-up, third                  | Show the podium                    |

- Each phase is **not started / in progress / done / blocked**, and a blocked phase says why in one sentence that
  names the fix ("Round 2 waits for round 1: 3 matches not confirmed").
- **Country required before round 1 (Q3).** Round 1 cannot be drawn while any team has no country: the Round 1
  card is blocked with "2 teams have no country: set them in Setup", and the Draw panel's Create button is disabled
  with the same sentence. This is a screen rule, not a database one: `btc_teams.country_code` stays nullable so demo
  and older events keep working, and a judge-country conflict stays a ticked warning (Build E). **The engine spec's
  Draw panel (4.3) needs this line added before Build B part 2 starts.**
- **Warnings** collected in one place, each linking to the fix: matches without times (exists), judge-country
  conflicts ticked through, queued writes not yet sent. No "stuck in scoring" timer (Q4).
- **Offline status line**: "Ready offline · synced 2 minutes ago" once the offline track's mirror exists (Q11); until
  then the line is absent, never a false claim.
- **Live card**: "Live now on Projector / Phone" or "Not showing", the audience links (copy, QR), and a "Show this event"
  control (backlog `btc.md`: the org's current session stays on the last event until a BTC confirm takes over).
  **Shown during a shadow run** (Q12, which replaces the Board plan's D4 recommendation), with the band below on every
  surface.
- **The shadow band** when the event is a shadow run (depends on `is_shadow`; renders unmistakably, like `is_test`,
  D9), on every organiser and audience surface. Wording for now: **"Seduh Score ABTC Beta Test"** (Q12). The text is
  one constant in `core/statusBand.js`'s caller, so changing it later is a one-line edit; never violet
  (`--color-test` is reserved for `is_test`). Note for D10: showing it on the room display makes the beta public in
  the room, which the owner accepted on 2026-11-10; the Tour still does not mention it.
- All counts are **derived on load** from existing reads (matches, `btc_standings`, bracket slots); nothing stored.

**Module boundary.** The renderer is `core/runSheet.js` (section 3a); BTC only computes its phases in
`src/formats/btc/runSheet.js`.

**Acceptance.** For a demo event at each stage (empty, mid round 1, round 2 done with a tie at 8th/9th, mid knockout,
podium) the dashboard shows the right phase, counts and next action; tests per state; 360px first.

## 3a. Shared modules: what lives in `core/`, what a format supplies

Rule: `core/` renders, orders and announces; the format decides what a phase, a round, a qualifier or a record
**means**. No module below may import from `src/formats/`, name a format, or branch on `event.format`.

| Core module (new unless noted)                | Renders                                                                                                             | The format supplies                                                                                                       | BTC now / later ports                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `core/runSheet.js`                            | Ordered phase cards, status, count, one primary next action, blocked reason                                         | `derivePhases(eventData) → [{ id, label, status, count, nextAction: { label, href }, blockedReason }]` (pure)             | BTC: setup, R1, R2, cut, knockout, podium. Cup Taster: stages. Throwdown: rounds |
| `core/eventWarnings.js`                       | One warnings list, each with a link to its fix                                                                      | `deriveWarnings(eventData) → [{ id, severity, text, href }]` (pure)                                                       | BTC: missing times, judge-country ticks. Others: their own                       |
| `core/liveCard.js`                            | Live now / not showing, audience links, copy + QR, "Show this event"                                                | the event, the org slug, a `takeOver()` callback (the format's publish)                                                   | Cup Taster already has a badge; it moves onto this later                         |
| `core/recordsCard.js`                         | Download JSON / CSV buttons, file names, busy and error states                                                      | a list of `{ label, filename, build() }`; JSON uses existing `get_dispute_pack`, CSV rows via `core/export.js` (existing) | BTC: record + scores CSV. Cup Taster: replaces its dispute-pack card             |
| `core/groupedMatchList.js`                    | A list grouped by a key with per-group "N of M confirmed", status labels, one action per row, optional filter       | `groupKey(match)`, `groupLabel(key)`, `rowView(match) → { title, sides, status, action }`                                 | BTC: by `prelim_round`. Throwdown: by knockout round. Cup Taster: heats by stage |
| `core/cutLine.js`                             | A ranked table with a qualification line after place N, level groups across it highlighted, a slot for the tie card | ranked rows from `core/ranking.js` (existing), `qualifyCount`, columns, `isLevel(a, b)`                                   | BTC: top 8 by points. Cup Taster: advancement cut                                |
| `core/offlineMirror.js` (widens `core/db.js`) | "Ready offline · synced N min ago"; mirror on load, read when offline                                               | `mirrorSpec: [{ store, load(client, eventId) }]`                                                                          | BTC: teams, judges, matches. Cup Taster already mirrors; moves onto this later   |
| `core/signOffSheet.js`                        | A print-designed sign-off page (browser Save as PDF), signature lines                                               | title, rows, columns, notes (settled ties and reasons), signatories                                                       | BTC: top 8. Cup Taster: stage advancement. Throwdown: seeding                    |
| `core/statusBand.js`                          | The test band (exists today per screen) and the Unofficial band, one place                                          | the event's `is_test` / `is_shadow`                                                                                       | every format, every organiser and audience surface                               |

Each module: a pure part (unit-tested with fixtures from two different formats, even if only BTC uses it in March, to
prove it is not BTC-shaped) and a thin DOM part on `core/dom.js` with the repo's loading / error / retry / focus rules.
Its CSS goes in `src/ui/tokens/components.css` (Petrol V2), not a format's `shared.css`. `module-boundary-checker` is a
blocking reviewer on each, asked the section 6 question explicitly. Porting Cup Taster or Throwdown later is a
format-only change: write that format's `derivePhases`, `rowView` and so on, and delete its hand-built card.

## 4. U2: the matches screen around the Draw panel

**Problem.** `matchesScreen.js` lists every preliminary match in one list with a hand-entry form. With 20 matches
across two rounds and a Draw panel on top (Build B part 2), it becomes a long scroll.

**Proposal.**

- Group the list **by round** (Round 1, Round 2), each with its own "7 of 10 confirmed" header; unnumbered matches show
  under Round 1 (as Build A reads them).
- Each match row: number, "Country · Team" both sides (`words.js` `teamLabel`), judges, status (scheduled / scoring /
  confirmed), the score once confirmed, a missing-time marker, and one action (Score / View).
- No status filter (Q5): grouping with per-round counts is enough at about 10 matches a round. The shared list keeps
  an optional filter slot unused, for formats with longer lists.
- The hand-entry form moves into a collapsed "Add a match by hand" section below the rounds, labelled as the
  correction path.
- **Remove only before scoring starts (Q7).** Today every match has Remove, even when confirmed, and removing a
  confirmed match deletes its cup scores, bonuses and times for good (they cascade) and drops its points from the
  standings, which can change the top 8. Remove exists to undo a duplicate or a wrong pairing. New rule: Remove shows
  only while the match is `pending` with no scores; once scoring has started or the match is confirmed, the row offers
  Score / View only, and a mistake is fixed by re-scoring, which `score_change_log` records. The screen rule is not
  enough on its own: the database still lets any member delete through `btc_matches_write FOR ALL`, so the plan's P1
  policy split must also refuse deleting a match that has scores (`security-reviewer`, `schema-guardian`).

## 5. U3: the cut as a visible step

**Problem.** The top 8 is chosen on the bracket screen today: the seeding-tie card sits above "Generate bracket".
The committee's rule is points, then the sum of finish times, confirmed by a person. That decision is the most
contested moment of the event and currently has no screen of its own.

**Proposal.** A "The cut" section of the Standings screen (Q8), linked from the run sheet's cut phase; the bracket
screen keeps only the bracket. The section contains:

- Standings with columns **R1 pts, R2 pts, total, R1 time, R2 time, time sum** (sum labelled as a display aid when a
  note does not parse, per engine spec 5.2).
- A **cut line after 8th**, with any group level on points across it highlighted and the tie card inline.
- "Lock the top 8 and generate the bracket" as the one button, disabled with a reason until ties are recorded and both
  rounds are confirmed. A confirmation dialog names the eight teams.
- **A sign-off sheet as a PDF (Q9).** "Sign-off sheet (PDF)" opens a print-designed page: event name and date, the
  shadow band if any, the eight qualifiers in seed order with points per round, total and both finish times, every
  tie settled with the reason recorded, the teams 9th and below for context, the time it was generated, and signature
  lines (committee chair, organiser). The PDF is the browser's Print, then Save as PDF, as the results sheet already
  does (`src/core/CLAUDE.md`: no PDF library, deliberately). A generated PDF file would need a library and is not
  planned unless the owner asks. The page is a shared module, `core/signOffSheet.js` (section 3a): the format supplies
  the rows, columns and signatories.

## 6. U4: the records card

On the dashboard (or Podium phase): **Download the record (JSON)** (the existing `get_dispute_pack`, already reads
`btc_*`) and **Download scores (CSV)**: one row per cup (match, round, cup, team 1 tokens, team 2 tokens) plus a row per
match for bonuses, times and totals, via `core/export.js`. This is the shadow comparison's input (gate G1). **The columns follow the committee's paper
scoresheet so the comparison is row for row (Q10): the owner is getting a copy.** Until it arrives, build the JSON
button and the card; the CSV column order is fixed from the sheet before the CSV is built.

## 7. U5: offline loading of the scoring screen

**Moved to the offline track (Q11, plan P2).** The scoring screen saves drafts offline but cannot open without the
network (backlog `btc.md`). That track builds the mirror (`core/offlineMirror.js`, section 3a) under
`offline-sync-auditor`; this spec only consumes its status for the dashboard line in U1. It matters more once scorer
tablets arrive (Q2).

## 8. U6: copy pass

- Every refusal (`REFUSALS` tables keyed on hints) maps to a sentence that says what to do next.
- Shorten the setup demo paragraph (`setupScreen.js`, 60+ words).
- One vocabulary across screens: "match", "round 1 / round 2", "the cut", "knockout", "confirmed", "scheduled".
  Never "trio". Run through `intent:articulate`-style review; owner approves wording that the committee will see.

## 9. Owner decisions (2026-11-10)

| #   | Question                          | Answer                                                                                                       | Where              |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| Q1  | Scope                             | BTC only; every piece a shared `core/` module other formats port to                                          | 1, 3a              |
| Q2  | How many devices enter scores     | One organiser device in March; leave room for scorer tablets later                                           | 2                  |
| Q3  | Country required before round 1   | **Required**: round 1 cannot be drawn until every team has a country (screen rule, not database)             | 3; engine spec 4.3 |
| Q4  | Flag a match stuck in scoring     | No                                                                                                           | 3                  |
| Q5  | Status filter on the matches list | No; group by round with counts                                                                               | 4                  |
| Q6  | Main device                       | Tablet in landscape; phone as the backup                                                                     | 2                  |
| Q7  | Remove after confirm              | Remove only before scoring starts; fix by re-scoring (logged); the database refuses it too (P1 policy split) | 4                  |
| Q8  | Where the cut lives               | A section of Standings                                                                                       | 5                  |
| Q9  | Sign-off for the top 8            | A PDF sign-off sheet (browser Save as PDF, no library)                                                       | 5, 3a              |
| Q10 | The committee's paper scoresheet  | **Pending**: the owner is getting a copy; the CSV columns follow it                                          | 6                  |
| Q11 | Offline scoring load              | The offline track; this spec shows only its status line                                                      | 7                  |
| Q12 | Live controls during a shadow run | Shown, with the band "Seduh Score ABTC Beta Test" (replaces D4's recommendation)                             | 3                  |

**Knock-on changes to other documents (not made here):** the engine spec's Draw panel (4.3) gains the country rule
(Q3); the Board plan's D4 is answered "show, with the beta band" (Q12); the P1 `btc_matches` policy split gains "no
delete of a match with scores" (Q7).

## 10. Order, reviewers, and what each needs

| Item                | Depends on                          | Reviewers                                                                                                                           |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| U4 records card     | JSON now; CSV after Q10's sheet     | `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`, `module-boundary-checker`                                             |
| U1 run sheet        | Build B part 2 for the round phases | same, plus `module-boundary-checker` blocking for `core/runSheet.js`                                                                |
| U2 matches by round | Build B part 2                      | `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`                                                                        |
| U2 Remove rule (DB) | the P1 `btc_matches` policy split   | `security-reviewer`, `schema-guardian`, `test-auditor`                                                                              |
| U3 cut + sign-off   | Build C                             | `scoring-auditor` (it shows who qualifies), `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`, `module-boundary-checker` |
| U6 copy pass        | after U1 to U3                      | `code-reviewer`; owner approves wording                                                                                             |

All of it lands before rehearsal 1 (mid-January, plan P2). `kb-sync` at the end of each task.

## 11. Build stages (one session and one PR into `dev` each)

Split so that no two sessions running at the same time touch the same files. `src/ui/tokens/components.css`,
`matchesScreen.js` and `standingsScreen.js` are the shared hot spots, so each has exactly one owning stage at a time.

| Stage | What                                                                                                                                                                                                                            | Owns (files)                                                                              | Can start                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| S1    | **Core organiser kit**: `statusBand`, `countryFlag` with the SVG set, `recordsCard`, `liveCard`, `runSheet`, `eventWarnings` (renderers + pure parts, tested with two formats' fixtures, a `.preview.html` matching the canvas) | `src/core/` new files, `src/ui/tokens/components.css`, flag assets                        | Now                                                              |
| S2    | **U1 + U4 BTC dashboard**: `src/formats/btc/runSheet.js` (phases, warnings), the dashboard rebuilt on the kit, records card (JSON; CSV after Q10), `teamLabel` gains the flag                                                   | `src/formats/btc/eventDashboardScreen.*`, `src/formats/btc/runSheet.js`, `words.js`       | After S1 merges                                                  |
| S3    | **U2 matches by round**: `core/groupedMatchList`, the round grouping, Remove only before scoring, the hand form collapsed                                                                                                       | `src/formats/btc/matchesScreen.*`, `core/groupedMatchList.js`                             | After S1 and engine Build B part 2 (Draw panel, same file) merge |
| S4    | **U3 the cut**: `core/cutLine`, `core/signOffSheet`, the Standings cut section, Lock moves off the bracket screen                                                                                                               | `src/formats/btc/standingsScreen.*`, `bracketScreen.js` (Lock only), the two core modules | After S1 and engine Build C merge                                |
| S5    | **U6 copy pass** over every BTC organiser screen                                                                                                                                                                                | wording only                                                                              | After S2 to S4                                                   |

Database pieces stay with the Board plan's P1 tasks, not these stages: `is_shadow` (the band shows once it exists; S1
reads the flag and shows nothing without it) and refusing to delete a scored match (Q7). Every stage is checked at
360px, then tablet landscape, against its canvas artboard, and runs its reviewers from section 10 before its PR.

**Later, not this spec (owner, 2026-11-10):** redesign the platform admin console (`/admin/`) in the same style.
`src/admin/` may import `src/core/` (never a format), so it can reuse the S1 kit directly; nothing outside `src/admin/`
may import from it.
