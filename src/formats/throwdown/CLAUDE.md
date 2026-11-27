# src/formats/throwdown/ — Throwdown format

**Phase TD.1 (core) built, 2026-11-03.** An individual 1v1 knockout: judges tap for one of two
competitors, the majority wins, the winner advances. Spec (local only, never edited for
progress): `Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md`. Modules (redemption, lucky loser,
revival, latte art) are later phases (TD.3 to TD.6); TD.1 ships only the toggle mechanism with
no module in it.

Root non-negotiables apply here unconditionally — see
[the repo root CLAUDE.md](../../../CLAUDE.md) for the full list, especially the module
boundary: this directory may import from `src/core/`, never the reverse, and never from
another format. [src/formats/cup-taster/CLAUDE.md](../cup-taster/CLAUDE.md) and
[src/formats/btc/CLAUDE.md](../btc/CLAUDE.md) are the worked examples.

## Rules that hold this format together

- **Votes are rows, results are derived.** `td_votes` has one row per tap and NO judge identity
  (a test pins the column list). Totals, the leader and the winner are computed (`votes.js`,
  `bracket.js`, and in SQL `td_match_results`); the only stored result facts are
  `td_matches.result_kind` (`votes | walkover | bye | scores`), `confirmed_at` and, for a walkover, the
  explicit winner's slot position. A walkover is never a tally.
- **Confirm is disabled while votes are level, and until every judge has voted** (4.30.4), in the UI
  (`canConfirm(tallies, judgeCount)`) and in the database (`td_votes_level`, `td_votes_incomplete`). `td_confirm_match` also takes the slot the organiser saw leading
  (`td_leader_changed` if the votes moved since).
- **Nothing is projected.** A round exists only once the previous main round is fully decided
  (`app.td_advance`, in the same transaction as the result; idempotent, so a second Continue
  cannot duplicate a round). The 3rd place match is created together with the Final, only when
  the event has it on, there are exactly two winners from a round of exactly two matches, and
  BOTH semi-final losers exist and are active (`event_entries.withdrawn` false; T-TD.1.9, owner
  decision 2026-11-03). A walkover does not block it (its loser is the other slot's competitor);
  a bye does (no loser), and so does a withdrawn loser. Both are live at once.
- **Shape is general.** A match has 2..4 `td_slots` (a pair round's exactly 2); a round has
  `kind` (`pair` now, `pool` reserved) and `phase` (`main | third_place | redemption`). A module
  must not change these shapes; if it has to, the core was not ready.
- **All writes are SECURITY DEFINER functions** (`td_save_settings`, `td_start_event`,
  `td_cast_vote`, `td_undo_vote`, `td_confirm_match`, `td_record_walkover`, `td_reopen_match`); the API roles hold
  SELECT only on the six `td_*` tables. Each function opens with `app.td_guard` (membership,
  org/event agreement, format, Per-event window lock: one answer, "event not found"), takes an
  advisory lock per event, and is idempotent through `processed_operations` (an outbox replay of
  a tap, undo, confirm, walkover or start does nothing the second time).
- **Setup is locked when Round 1 exists** (trigger plus function). Module toggles live in
  `td_settings.modules`; `modules.js` and `app.td_module_registry()` are the registry (both
  empty), with declared dependencies and a per-module entitlement key slot. A module that is
  off leaves no trace on any surface (tested).
- **Writes go through the shared outbox** (`data.js`). The screen shows server counts plus the
  taps still waiting (`pendingSnapshot`); a queued confirm or walkover closes voting on that
  match and says so; the queue is read before and after the server read and re-read if it
  changed. `droppedErrorFor` compares the OUTBOX operation id, not the database's idempotency key.
- **Live payload is public** (`liveSession.js`): names and results only, vote counts only for a
  decided vote result. The TEST banner on the phone and projector is the shared viewer shell's
  (from the live row's `is_test`); the console and results page draw their own.
- **Entitlements**: `throwdown_participants` (Community 8) is enforced by the existing
  `event_entries` cap trigger (branch for `throwdown`); competitors are `event_entries`, so
  `withdrawn` is the status (whether a withdrawn competitor counts toward the cap is open, Q8b).
  Four module keys are declared (slots only). No code branches on a tier (D14).

## Assumed defaults (owner may overrule)

Timer display-only (nothing recorded, no `clampElapsed`); the random draw stores its shuffle
seed (`core/seededShuffle.js`; the browser shuffles, the database stores the seed and checks the
shape only, it cannot replay a browser PRNG); any judge count (1 to 15) is accepted, and a match takes
no more vote taps than `judge_count`, plus one tie-break vote only when every judge has voted and it is level (owner,
2026-11-20; `td_cast_vote` refuses with `td_votes_full`, the screen disables Vote); the 3rd place match
is skipped when a semi-final was a bye or a loser has withdrawn (a walkover does not skip it).

## Module history

TD.1 (2026-11-03): schema `20261103111000`, functions `20261103120000`, keys and cap branch
`20261103101000`, window lock `20261103130000`; pgTAP `072`, matrices `040`/`041`; pure modules
`votes`, `bracket`, `seeding`, `modules`; `data`, `liveSession`, `outboxHandlers`; console
`eventScreen`, `resultsScreen` (printable match log and podium); phone `viewerBody`, projector
`projectorScreens`/`projectorBody`; Playwright `dev-throwdown` (full 8-competitor test event).
Out of TD.1 by design: redemption, lucky loser, revival draw, latte art, formatted PDF report,
archive write, any lift of the Random Selector engine.

## Scoresheet module (stage 1, 2026-11-19)

Rounds decided by judges' paper scoresheets that a scorekeeper types in (spec, local only:
`Handoffs and Specs/THROWDOWN-SCORESHEET-SPEC.md`). Stage 1 is the backend and pure logic; the console, outbox handlers and
live surfaces are stage 2. It deliberately **extends two core facts**: `td_matches.result_kind` gains `scores`, and
`td_match_results` gains a `scores` arm (reads `app.td_scored_winner`).

- Pure: `src/core/scoresheet.js` (format-agnostic: presets, `validateSheet`, totals, `decideScored`, `sheetsProgress`) and
  `roundRole.js` here (a round's role, derived: third_place phase, or a main round of 1/2/4 matches = final/semi/quarter).
  The same rules are in SQL (`app.td_role_of`, `app.td_scored_decide`); `supabase/tests/fixtures/scoresheet-parity.json` drives
  both, and pgTAP `091` embeds it (a unit test fails when the copies differ).
- Data: `td_score_sheets` (points only, one row per match/slot/seat/cup/line; no total is ever stored) and
  `td_score_decisions` (an organiser's pick for a level match). Writers: `td_save_score_sheet`, `td_confirm_scored_match`
  (SECURITY DEFINER, idempotent, advance in the same transaction). Console read view: `td_score_standings`.
- A scored match takes no taps (`td_match_scored` on `td_votes`). Scores are never in any public door or live payload.

### Stage 2 (console, outbox, live surfaces; 2026-11-19)

- **Setup**: a "Scoresheet rounds" toggle in `eventScreen.js` (preset, cups per round role; 0 = tap-voted), saved through
  `td_save_settings` modules and locked with setup. Off saves no `scoresheet` key (no trace anywhere).
- **Console only**: `scoredMatch.js` (pure: `scoringContext`, `scoredView`, draft parsing), `scoreEntry.js` (the card: "Sheets in:
  n of m", a seat x competitor grid, the paper-sheet form with a live cup total, the confirm step and the organiser pick),
  `scoreAudit.js` (the read-only breakdown on the event screen and on `resultsScreen.js`). No public surface may import them
  (`scoreBoundary.test.js`). A match is scored when `scoredCups(config, match.roundPhase, match.roundSize)` is not null.
- **Data/outbox**: `data.js` reads `td_score_sheets`, `td_score_decisions` and the database's winner of each scored match
  (`td_match_results`, passed to `deriveBracket` as `scoreWinners`) only when the module is on; saves and confirm are outbox
  operations (`td_save_score_sheet`, `td_confirm_scored_match`) with client-made ids. A queued sheet replaces the saved one for
  its seat and counts in "Sheets in"; a queued confirm closes the match's sheets. `td_score_standings` is not read: the totals
  and the rule come from `core/scoresheet.js` and the database re-checks both at confirm.
- **Live payload**: a scored match in progress carries only `judging: true`; a decided one carries the winner flag and
  `resultKind: 'scores'`, never a number. Module off: no `judging` key (tested).

## Competitor phone (2026-11-20)

The Add competitor form takes a phone (required, D16, as Cup Taster) and links the competitor to Seduh ID. Shared code is in
`core/`: `phoneField.js`/`phoneField.css` and `registration.js` (`registerAndLink`: `registerEntry` by canonical phone, then a
best-effort `link_person_identity`). Throwdown-only: `competitorForm.js` (pure draft/validate/build/words). A phone links only to
an existing identity (the link never creates one). Throwdown publishes a results payload too (see "Publish results", below), so a
linked competitor's result reaches their profile once the organiser publishes and the archive feed runs. Tests: `competitorForm.test.js`,
`core/registration.test.js`, the `eventScreen` block; Playwright `throwdown-event` and `throwdown-scoresheet` type a phone per competitor.

## Publish results (2026-11-20)

The results screen's "Public results" card publishes a finished event through core's `publish_event_results` (the same door Cup
Taster uses; no migration, no RPC change). Seduh ID's archive feed reads only `podium` and `standings` (each element's trimmed
`name` and `cafe`), so the payload carries those two arrays and nothing else that is per-person. Full keys and the reasons for
them: `resultsPublishing.js`'s header.

- **Pure builder.** `resultsPublishing.js` takes the bracket and returns the payload; no reads, no clock. Places are derived at publish
  time and never stored in Throwdown's tables; the published payload is a snapshot the organiser chose to make.
- **Places.** By the round lost in, shared within a round (competition ranking). With no 3rd place match, the two semi-final losers
  share 3rd. **This is an assumption for the owner to confirm**, not a settled rule.
- **Withdrawals.** A withdrawn podium finisher stays listed; any other withdrawn competitor is counted in `notListed`, not listed.
- **Blockers.** Only a finished event publishes (a champion, and the 3rd place match decided if the event has one).
- **Test events** never publish (D9): the card says so and offers no button.
- **Scope.** Full standings is the default; "podium only" is the alternative. The card's wording states what becomes public.
- **Publish re-reads the event fresh** before it writes, so a stale screen cannot publish stale names.
- **Feed queue.** The first real publish lands in the archive feed's `queue` mode and waits for the owner's weekly review before
  anyone sees it (`CONVENTIONS.md`, "Seduh ID feed: the owner's runbook").

## Seduh ID profile (2026-11-20, T-ID2.TD)

A claimed person's profile shows their published Throwdown place and their knockout record. Database only (migration
`20261127120000`, pgTAP `092`) plus one payload key: a full-scope publish adds `matches` (`resultsPublishing.js`
`playedMatches`): each played match as `{round, sides: [{name, cafe, winner}]}`, a walkover, bye or undecided match left out, the
3rd place match in. The profile door reads that list and nothing in `td_*` (`app.seduh_knockout_record`). Joint 3rd for the two
semi-final losers and "walkovers do not count" are owner-confirmed (2026-11-20). "This isn't mine" on a Throwdown result also hides
that event's matches (owner to confirm at review). Details: `CONVENTIONS.md`, "Seduh ID profile door".

## Undo a confirmed match (2026-11-21)

Owner decisions, 2026-11-21 (all four recommended answers). Built as migration `20261129100000` (pgTAP `093`) and
`src/formats/throwdown/reopen.js`; CHANGELOG 4.27.0 has the review trail.

- **When.** `td_reopen_match` undoes a confirmed match only until the next round starts. Refused: `td_match_bye`,
  `td_next_round_started`, `td_third_place_changed` (a semi-final loser was withdrawn or restored since, which would add or
  drop the 3rd place match), `td_leader_changed`.
- **What is kept and removed.** Votes and score sheets are kept. The organiser's pick for a level scored match is removed. Later
  rounds, the 3rd place match and the Final included, are removed; `td_advance` rebuilds them when the match is confirmed again.
- **Record.** Every undo writes a row to `td_match_reopens` (kind, winner, confirmed time, positions, rounds removed, who, when),
  shown as a Corrections card on the results page. Published results are not touched; the confirm step reminds the organiser to
  publish again.
- **Client mirror.** `reopen.js` (`reopenState`, `reopenWords`, `matchesAwaitingUndo`) has the same rules. An offline-queued undo
  hides the later rounds it will remove, so their taps are not sent (they would be dropped as "event not found").
- **Offline screen.** A failed refresh keeps the last loaded screen and the device's queued taps (re-read from the local queue).
  "No connection…" is shown only for a connection failure; any other error shows its own words. The screen reloads on the browser
  `online` event, and `refreshSoon` returns the running reload to a caller that joins it.
- **UI.** "Undo result" on each undoable match in the Bracket card (aria-label names the match), two taps ("Yes, undo" /
  "Keep result"), "Undo waiting to sync." while queued. Focus returns to Undo result, or to the Bracket heading when a refusal
  removes the button.

## Projector on BTC's model (2026-11-21)

The venue display is a loop of pages (10 s each, with the ring) plus moments, on the shared projector kit (`core/CLAUDE.md`,
"Projector kit"). `projectorScreens.js` holds the pages: before Round 1 **Meet the competitors** (names only, 16 to a page)
and **How it works** (a scoresheet card only when `judgedRounds`, never a judge count); live **Up next** (VS card, each side's
route, footer "Then: A vs B"), the **round page** (8 matches to a page, words for every state), **Still in**, **Path to the
final** (columns only for rounds of 8 matches or fewer; a bigger round is one line; a future round is only "Drawn when the X is
complete") and **Latest results**. `projectorMoments.js` holds the 8 s moments: **Result recorded** (Champion/Runner-up,
"Plays for third place" only when the 3rd place match exists, vote split for tap rounds and the winner only for scoresheet
rounds) and **Round is set** (pairings revealed one by one). The champion uses `createChampionScreen` and holds 60 s.

- **Payload** (`liveSession.js`, pure): `upNext` / `thenNext` are the first two undecided playable matches in BRACKET order (owner
  decision: no console "call to stage" step); every match has `number`; `upNext`/`thenNext`/`recent` carry `roundLabel`,
  `roundPhase`, `roundSize`, `role`; `recent` adds `confirmedAt`; `stillIn`, `competitorNames` and `judgedRounds` (yes/no only).
  `roundLabel` ("Round of 16") is the projector's name; `label` ("Round 1") stays the console's. A scoresheet match still carries no
  score, total, judge count or rule (D8; its position in its round, "Match 2", is structure, not a score): `liveSession.test.js` checks `rounds`, `upNext`, `thenNext` and `recent` for any digit that is not structure.
- **Moments key on `id|confirmedAt`** (a republish repeats neither) and need a previous snapshot; `projectorFixtures.js` builds
  payloads through the real `deriveBracket` and assembler for the tests and `projectorSurface.preview.html` (`?s=<scenario>&page=N`).
- Not changed: the phone body, any migration, BTC's and Cup Taster's idle loops.

**Event dashboard (Phases B and C, 2026-11-22).** `eventDashboardScreen.js` is a copy of BTC's run-sheet dashboard on the core organiser
kit, with an optional `loadData` option so the preview and tests can supply data without the network. It is routed: `#/events/:id`
is the dashboard, and the console (setup, draw, vote cards, bracket) is `#/events/:id/throwdown/matches`, where organisers vote.
Copied, not shared, because `src/core/` was out of scope; extracting the shell to core is the follow-up (CHANGELOG 2026-11-22).
