# Backlog: BTC

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from BTC Phase T-BTC.2 (2026-09-23)

- **No seeding-tie-break UI yet.** **CLOSED (T-BTC.seeding-tiebreak, 2026-10-10):** the organiser orders teams that are level in the standings from the bracket screen. Original note: when an unresolved tie exists at the 8th/9th qualifying boundary, `generate_btc_bracket` refuses to proceed; the organiser had to resolve it outside the app.

---

## Known open items from BTC Phase T-BTC.2 scoring (2026-09-22)

- **RPC JSONB casts lack numeric-type guard (pre-existing, found in correction pass 2026-09-22).**
  Both `confirm_btc_match` (the v->>'team1_tokens'::int cast) and the earlier vote-storage
  shape (cup_number extraction) lack a numeric-type guard, so a non-integer value surfaces
  as a raw Postgres cast error rather than a curated message. The JS client always validates
  (`withCupTokens` enforces 0–3 range for team1_tokens), so unreachable via the app today
  (same pattern already existed for cup_number before the correction migration). Deferred as
  a robustness improvement over a blocking defect — caught during review, deliberate not-to-fix
  per scoring-auditor assessment.
- **core/outbox.js buildRpcHandler treats 408/429/5xx as permanent (data-loss risk on flaky wifi;
  affects Cup Taster too) — CLOSED 2026-09-26 (PR #125).** Classified 408/429/5xx as transient,
  retried via periodic 15s drain and Web Lock safety; lost writes stay reported for the life of
  the tab (survive reload via sessionStorage as of 2026-09-27, cleared on tab close). See
  CHANGELOG.md for the full account.
- **processed_operations.id is a global primary key (op-id poisoning across orgs).** Suggest schema
  change to `(org_id, id)`.
- **app.org_id_for_btc_match is anon-executable.** Should require `authenticated` role. — CLOSED 2026-10-09 (`20260922120000_btc_small_cleanups.sql`: revoked from `public` and `anon`, granted to `authenticated` and `service_role`).
- **btc_matches_write is FOR ALL: a member can set status=confirmed directly, bypassing the RPC,**
  letting any member confirm a match without the full validation the RPC provides.
- **btc_match_judges can be edited after confirmation** and nothing outside the RPC caps them at 3,
  enabling race conditions between scoring and judge removal.
- **Unindexed foreign keys:** btc_cup_votes.team_id/judge_id, btc_match_bonuses.fastest_team_id,
  btc_bracket_slots.team1_id/team2_id (performance risk). — CLOSED 2026-10-09: `btc_cup_votes.team_id/judge_id` were dropped by `20260922100000` (per-cup token shape); the other three are indexed by `20260922120000`.
- **btc_cup_totals still counts out-of-range cup votes** (match totals and standings are filtered,
  but the view itself is inconsistent). — CLOSED 2026-10-09 (`20260922120000`: the view filters `cup_number <= btc_cups_for_round`).
- **btc_bracket_slots.event_id can still be moved; freeze it with forbid_btc_event_change** in the
  bracket step (feeder links must not be trusted blindly). — CLOSED (found 2026-10-10 by T-TEN.A2):
  `trg_btc_bracket_slots_parent_immutable` freezes `event_id` (with `id`, `round`, `slot_label`), and
  `trg_btc_bracket_slots_check_event` requires every team, match and feeder slot to be in the slot's event.
- **Nine older trigger functions keep PUBLIC/anon EXECUTE** (check_btc_cup_vote_participants,
  check_btc_match_bonus_teams, and 7 pre-BTC ones): unreachable, consistency cleanup only. — CLOSED 2026-10-09: `check_btc_cup_vote_participants` was dropped by `20260922100000`; the other eight were revoked from `public` and `anon` by `20260922120000`.
- **Scoring screen load needs the network** (no offline reload capability).
- **Four screens routed in app-wiring pass (2026-09-23) — CLOSED.** All 5 BTC screens
  (setup/matches/standings/bracket/scoring) now have routes in `main.js`; `allOutboxHandlers` is
  passed as `handlers` parameter throughout; cross-format head-of-line blocker fixed (Cup Taster
  scoring route now receives full handler map, not just Cup-Taster-only). See CHANGELOG.md for
  full account.
- **setBusyDisabled (core/dom.js) sets aria-busy on merely locked or incomplete controls,** not
  just genuinely disabled ones (semantically imprecise).
- **main.test.js has no assertion that btcOperationLabels reach the shell** (outboxHandlers.test.js
  asserts label/handler keys agree, but end-to-end flow is untested).
- **No pgTAP fixture pins btc_standings.wins for a token winner who is not the fastest team** (both
  paths valid but only one tested).
- **Bracket step must decide knockout winners on bonus-inclusive totals, leave total ties unresolved,
  and guard editing a confirmed match whose winner already advanced.** Deferred to bracket step. — CLOSED 2026-10-09 (T-HARDEN.btc-bracket-podium): winners on bonus-inclusive totals and the advanced-match guard by `20260922132000`; the tie and stale-seat gap by `20261009100000`, pushed to the cloud project 2026-10-09 and verified there.
- **Standings completeness rests on exactly 3 judges per match;** nothing outside the RPC caps
  btc_match_judges at 3 (see btc_match_judges editable gap above).

---

## Known open items from T-HARDEN.btc-bracket-podium (2026-10-09)

_The BTC podium card and the knockout re-confirm-as-tie fix shipped; these were flagged and documented, not blocking._

- **A tied knockout match has no resolution path (gap 1). CLOSED 2026-10-09 by T-BTC.knockout-tiebreak** (`20261009110000` pushed to the cloud project 2026-10-09 and verified there; see CHANGELOG.md). The product decision: the organiser records which team goes through, plus a reason; the app does not score a tie-break cup. The bracket screen's tied-match state exists now: a level confirmed match reads "Tied … Nobody advances until you record which team goes through", and the recorded winner decides the seat and the podium.
- **No parity test between the SQL advancement and the JS podium comparator.** One fixture should run through both `confirm_btc_match`'s advancement and `derivePodium`, so the podium and the bracket cannot disagree about a winner.
- **The semifinal-tie refusal wording for the "loser" branch is untested.** Reaching it needs a final or third-place match to exist, which needs sf1 seeded.
- **No podium on a live surface yet.** `derivePodium` is ready for T-BTC.3 and is meant to be reused unedited; that surface must carry its own `is_test` treatment (D9). **CLOSED (triage 2026-11-07):** the live payload assembler calls `derivePodium` for the projector and phone (src/formats/btc/liveSession.js:37, :215).
- **A missing team in the roster shows "Unknown team" as a decided name** (`podium.js`'s `nameOf` fallback). If that can happen, it should be a visible "missing" state, not a name.
- **BTC dispute-pack button is still missing.**

---

## Known open items from T-BTC.knockout-tiebreak (2026-10-09)

_The knockout tie-break shipped (organiser records the winner and a reason); these were flagged and documented, not blocking._

- **`btc_matches_write` is `FOR ALL`, so any member can write the tie-break columns directly.** The CHECK is the only guard. A winner pre-set on a not-yet-confirmed match would decide a tie once that match is confirmed level. Every direct write is logged with reason NULL. Same pre-existing gap as match status and bracket slots; closing it means splitting the write policy, which is a schema/RLS change needing its own `security-reviewer` pass.
- **A direct write to `btc_cup_votes` after a tie-break is recorded** leaves the seat following the stale decision, while the podium and the card follow the totals.
- **CLOSED (T-BTC.tiebreak-lock-test, 2026-10-11).** No test of `record_btc_tiebreak`'s row lock: `027` now uses `pgrowlocks` in one transaction to prove a fixture row is not held `FOR UPDATE` before an identical-decision no-op call and is held `FOR UPDATE` afterward; the no-op cannot rely on an ordinary `UPDATE` lock. Filtering by that row's `ctid` avoids unrelated locks and does not rely on `xmax`, which foreign-key checks also set.
- **Recorded tie-break reasons appear on the PUBLIC results page** via `get_scoring_record` (anon-callable). The form warns organisers; every consumer must render the reason as plain text.
- **The helper's downstream refusal still reads "confirm_btc_match: …"** even when raised from `record_btc_tiebreak` (pinned by `016` and `027`). The client keys on the hint, not the message. Cosmetic; changing the text means updating both suites.
- **The JS reason validator is slightly stricter than the SQL CHECK** (it trims NBSP, and it measures length in UTF-16 units). That is the safe direction: the client refuses something the database would accept, never the reverse.
- **The tie-break is organiser-screen only.** No projector, phone or results surface shows it yet (T-BTC.3). That surface needs its own `is_test` treatment (D9). **CLOSED (triage 2026-11-07):** the payload carries the recorded winner and reason (src/formats/btc/liveSession.js:104) and the projector and phone render it (projectorScreens.js:159-160, viewerBody.js:259).

---

## Known open items from T-BTC.demo-data (2026-10-09)

_The BTC demo-data loader shipped (roster plus scored preliminaries, 8 teams, test events only); these were flagged and documented, not blocking._

- **The `is_test` guard on `load_btc_demo` is an accident-prevention rail, not an authorisation boundary.** Any org member can flip `events.is_test` (every flip is logged) or write the BTC tables directly. That is the permission model every BTC RPC shares; closing it is a cross-cutting RLS and role decision, not a fix to this function.
- **The event lock's queueing is not shown by a test.** `028` asserts the lock itself (the event row is held `FOR UPDATE` until the transaction ends, via `pgrowlocks`, which works in one session), but two overlapping loads actually queueing, and `is_test` being unable to flip mid-call, would need two concurrent sessions.
- **Loading wipes matches, so offline writes queued for them will be dropped later.** Any queued `confirm_btc_match` operation, or a stale local scoring draft on another device, fails as a dropped write after a reload. Not handled: it only matters if a roster is reloaded while a device still holds unsent scoring writes. Needs `offline-sync-auditor` review if the loader is ever used on a live event.
- **The in-card status region is rebuilt on each render**, because the whole screen re-renders. A screen reader may not announce success or busy reliably. Failures use `role="alert"`, which is reliable. This is the same shared pattern as the other BTC screens.
- **If the event is the ACTIVE live session, a load does not republish.** The audience payload stays stale until the next publish.
- **Any member can wipe the event via the card**, with no role check. Same as the other BTC RPCs; see the first item above.
- **Only 8 teams.** The 24-team scale is not covered by the demo.

## Known open items from T-BTC.live-routing (2026-10-09)

_The audience surfaces now serve whichever format is live; no BTC screen exists yet. Publishing (stage 2) has shipped; the projector and phone are next._

- **A body outlives its session row.** When no session is active (`session` null) `viewer-shell`'s `computePhase` skips `hasContent`, so `formatBody` never reselects and the last format's display (page loop, ring, moment timers) keeps running behind the holding card until the format changes or the surface unmounts. Predates this change (Cup Taster had it); fix before BTC's projector body ships, e.g. a shell signal when the row goes away. **CLOSED (T-BTC.display-lifecycle, 2026-10-09):** the shell now tells the surface (`onNoContent`), the dispatcher keys its body on the event as well as the format (a direct move to another event, which has no gap, would otherwise have kept the old display and its memory), and `release()` destroys the display.
- **The second-use extraction is still owed before BTC's projector** (see "Known open items from T-HARDEN.projector-moments"): the shared venue vocabulary (`kicker`, `bigTitle`, the standings table, champion classes) moves into `core` with Cup Taster migrated and regression-tested, so BTC never imports Cup Taster's stylesheet. **CLOSED (T-BTC.venue-vocabulary, 2026-10-09).**
- **`mountStageSurface`'s `surfaceClass` option has no production caller.** Keep it as a hook or remove it when the BTC projector lands.
- **BTC payload fields are decided but unbuilt:** recent results ordered by confirmation time (Cup Taster had a bug here), bracket slots with winners and tie-break flags, podium via `derivePodium`, and `is_test` on every publish. **CLOSED (triage 2026-11-07):** the assembler builds winners and tie-break flags, the podium and an explicit boolean `is_test` on every publish (src/formats/btc/liveSession.js:104, :215, :336-343).

## Known open items from T-BTC.seeding-tiebreak (2026-10-10)

_The organiser can now order level teams; this lists what that does not do._

- **A recorded order is not in `score_change_log` or the dispute pack.** The table keeps who recorded the current decision and when (not forgeable: column-level privileges), but a re-record REPLACES it, so earlier decisions are lost. Who qualified and who plays whom is still logged through the bracket slots generation writes. Real logging means: add the table to the log's valid-table check, a `case` arm in `app.log_score_change` (its `row_id` comes from `team_id`, the table has no `id`), the trigger, the immutable/metadata buckets in `018_score_log_column_coverage.sql`, and what `get_dispute_pack`/`get_scoring_record` read.
- **A decision revives** when the same teams are level on the same numbers again (a result moves and moves back): intended (it is still the organiser's recorded order), and its reason is pre-filled when the group is opened again. If that is not wanted, a `recorded_at` check against the last result change would end it.
- **The projector still says "tie for 8th" after the tie is ordered** (the standings' shared position is a fact; the payload does not say the organiser settled it). It disappears when the bracket is generated.
- **The seeding order is not shown on the live displays or in the payload**, by design: its reason is for the event's own record, not the room.
- **Core extractions the boundary review named, not done here** (each also means editing Cup Taster or the other BTC tie-break code): (1) the tie-group / border-tie detection is `core/advancement.js`'s `tiedAtBorder` and the seeding groups re-derive it; (2) **CLOSED (07-core-reason-validator, 2026-10-11):** `core/reason.js` now owns the trim, non-empty and max-120 mechanics; `tiebreak.js`, `seeding.js` and Cup Taster's `timeCorrection.js` retain their own user-facing wording and return shape. SQL remains the real enforcement. (3) the hint-to-message `REFUSALS` table pattern is in `tiebreak.js`, `demo.js` and `seeding.js` (`core/errors.js` could own a `describeRefusal(table, err)`); (4) the move-up/move-down reorder is in Cup Taster's `setupScreen.js` too (it uses `disabled` at the ends; BTC uses `aria-disabled` so focus is kept).
- **`.field-input` borders are below 3:1 against the surface** (2.47:1 light, 1.25:1 dark, `shared.css`), so the reason field's boundary fails WCAG 1.4.11; project-wide (every BTC field), so not changed here.
- **The "saved but could not refresh" toast disappears after 1.5 s.** **CLOSED (T-BTC.refresh-note, 2026-10-10):** the bracket screen now keeps one attached, inline `role="status"` note with a Reload button until a successful screen-data load clears it. Original note: the transient toast made the actionable reload instruction disappear too quickly after either a seeding-order or knockout tie-break save.
- **`service_role` can no longer run `generate_btc_bracket` or the new RPC** (their membership test reads `auth.uid()`); the grants to it are inert. No caller uses it.
- **Toasts are fresh `role="status"` nodes inserted with their text** (the app's existing pattern); whether a screen reader announces them reliably is unverified (no real NVDA/VoiceOver run). The seeding card's own messages also go through its persistent live region, which stays attached, but "Order saved." and the post-save focus move to the button are the only confirmation.
- **A blocked Generate button is dimmed by the shared `.btn[aria-disabled]` rule (opacity 0.6)**, about 3.1:1 in the paper theme for the one control the card is explaining. Inactive controls are exempt from WCAG contrast, but a lighter treatment would be kinder.
- **Direct member writes to `btc_seeding_tiebreaks` are not serialised with `generate_btc_bracket`** (the policy cannot take the lock): a member racing themselves could commit a decision just after generation. Needs two actions in the same instant, affects only their own event, and a member can already delete slots.
- **Provisional lists are tall at 320 and 360px** ("Seed N (provisional)" and the team name take two rows each).
- **The form's error is both `role="alert"` and focused**, and the form and its list share the group's name: some screen readers will read them twice (the same pattern as the knockout tie-break form).
- **`btc_seeding_order` is a view over `btc_standings`**: a future migration that drops `btc_standings` without CASCADE will fail (earlier ones did).
- **The cloud project does not have the migration yet.** Merging the PR only ships the front end; the card hides itself (view not found) until `20261010100000` is pushed with `apply_migration`, and until then a tie across the cut-off still blocks generation exactly as before.

## Known open items from T-BTC.phone-view (2026-10-10)

_BTC's phone view is built; this lists what it does not do._

- **The shell's body is a polite live region that is rebuilt on every update**, so a screen reader may read a long BTC page again after each confirm (updates arrive a few an hour; Cup Taster's phone has the same behaviour). The cheap fix needs a real NVDA/VoiceOver check, because nested `aria-live="off"` support varies: keep one persistent wrapper, mutate it with `aria-live="off"`, and announce only a short summary line (the newest `outcomeLine`, "Champion: X"); or let the shell stop being a live region for a format that brings its own announcer (a core change).
- **The champion block on the phone is its own markup** (`btc-phone-champion*`), not `core/stageVocabulary.js`'s `renderChampion` (styled for the dark TV) or Cup Taster's `viewer-champion-*` (its own phone body). Two phones and a projector now draw a champion; extract if a third format needs one.
- **Round names are written three ways**: the projector's bracket columns ("Quarterfinals"), its slot labels ("Final", "Third place") and the phone's headings, while `roundLabel` from the payload says "Quarter-final". **CLOSED (T-BTC.wording, 2026-10-10):** `roundNames.js` is now the one vocabulary for payload labels, bracket columns and phone/organiser headings.
- **"Seed" is still not published** (see ROADMAP's T-BTC.projector-screens item). **CLOSED (T-BTC.payload-seeds, 2026-10-10):** the phone's up-next card says who meets whom by seed in the knockout.
- **The en dash in "47 – 20"** is read inconsistently by screen readers ("47 to 20" or a visually hidden "to" would be safer). **CLOSED (T-BTC.wording, 2026-10-10):** every BTC audience score keeps the visible dash and carries a labelled spoken form using “to”.
- **The phone has no results page link and no way to follow one team** (a "my team" filter is the obvious next thing a competitor asks for); it is the room's companion, not a team tracker.
- **`.card`, `.stage-meta` and `.btn` come from `btc/shared.css`**, which `app/index.html` loads after Cup Taster's copies, so BTC's win globally (the known debt in `src/formats/btc/CLAUDE.md`); `viewerBody.css` depends on `shared.css` being linked before it.

## Known open items from T-BTC.projector-screens (2026-10-09)

_The BTC projector is built (stage 3c); the phone view (stage 4) is not._

- **"Seed" is not published.** **CLOSED (T-BTC.payload-seeds, 2026-10-10):** `upNext`/`thenNext` teams now carry `seed` (from `btc_bracket_slots.seed_1`/`seed_2`, kept through the later rounds), and the projector and phone say "Seed 1 meets seed 8". Without a seed (a payload published before this, or a team the bracket never seeded) they fall back to "1st in the table", never "seed". Original note: `generate_btc_bracket` seeds by `row_number()` with a team-id tie-break, so teams tied on a place get distinct seeds that the standings place does not carry.
- **A queued stale moment can still play.** `core/momentPlayer.js` does not supersede an unplayed moment for the same match: a decisive result queued behind another moment and then re-scored to level shows the old card before the new one (bounded by the 8 s hold and the four-moment cap).
- **The champion screen can outlive a retraction for up to 60 s** if the final disappears with no new result (a match deleted, the bracket regenerated); a re-scored final is covered, because its result moment is urgent.
- **A very long champion name overflows at 4:3.** **CLOSED (T-HARDEN.champion-name-clamp, 2026-10-10):** names over 31 characters now receive the shared long-name fit step-down, which uses `--stage-fit` and balanced wrapping; names of 31 characters or fewer keep the original type size. A 60-character name stays fully visible; names are not truncated.
- **Replaying a demo load on a live display announces old results as new** (it recreates every match with new ids): up to three result moments and a rank moment against the old standings. Test events only.
- **Cup Taster and BTC still duplicate three small things**: the "what is new since the last snapshot" step of the detectors (the `seen` set, the fresh filter, the oldest-first sort), the result and rank moment mount boilerplate (frame, footer ring, destroy), and the idle loop's "same content, do not restart" signature guard. Extract when a third format needs them or one of them changes; the second-use rule was applied to the rank-impact logic, which carried the most behaviour.
- **`demoLivePayload.js` reimplements the +5/+2 formula and the standings aggregation** to build fixtures (demo and tests only; it runs through the real assembler). **CLOSED (T-BTC.demo-payload-derive, 2026-10-11):** each fixture now supplies cup votes to `scoring.js`'s `computeScores`; an invariant test recomputes every confirmed demo match and independently ranks the pinned preliminary standings.
- **Cup Taster's rank screen still renames `label` to `displayName` and back** (a cosmetic round trip); pass `impact.rows` through when its fixtures are next touched. Its headline does not say "joint" for a shared place, BTC's does.
- **The BTC phone view (stage 4) is not started.** ROADMAP's item "BTC payload fields are decided but unbuilt" is closed for the projector only. **CLOSED (triage 2026-11-07):** the BTC phone view shipped (src/formats/btc/viewerBody.js; the T-BTC.phone-view section above).

## Known open items from T-BTC.live-publish (2026-10-09)

_BTC now publishes its live payload automatically; no BTC audience screen exists yet (stages 3 and 4). Most of these are shared with Cup Taster and predate this work; they are listed because BTC makes them more likely._

- **`is_test` and `format` are client-supplied to `publish_session`** and not checked against `events` (security-reviewer F1). A member can publish a test event as `is_test = false`; a queued intent keeps the flag it was enqueued with, so an event flipped to real while a publish waits sends the old value. No privilege escalation (any member can already flip `events.is_test`, logged), but a D9 accident surface. Fix with a new migration: have `publish_session` read both from `public.events`, with matching pgTAP assertions.
- **`p_snapshot_at` is client-supplied and unclamped** (security-reviewer F2). A device whose clock is ahead freezes the display (every later correct publish is dropped silently, recorded as processed), and one that is behind loses races. Fix with a migration clamping to `least(p_snapshot_at, now())`, and ideally reporting a stale drop instead of success.
- **A test event can take the display from a real one.** A test confirm or demo load publishes like any other, exactly as Cup Taster test heats do. A guard ("skip takeOver for a test event while another non-test event is live") would stop that, but the org's current session is the stale 4 Oct Cup Taster event (real), so it would also stop every rehearsal until that session is replaced: needs a way to end or replace a live session first.
- **Cup Taster's timing, timing-manual and standings flushes still use Cup Taster's handlers only** (`timingScreen.js`, `timingManualScreen.js`, `standingsScreen.js`; `main.js` passes no `handlers` to those routes). A queued BTC operation (a confirm or, now, a publish) ahead of a Cup Taster tap makes that flush stop with "no handler registered" until the 15 s reconnect flush (which uses every handler) clears it. Fix: thread `allOutboxHandlers` through those routes and screens, and use the prop at the Cup Taster publish call sites.
- **A publish at the head of the queue can block a later confirm** if it keeps failing with an error classed transient (a statement timeout on the heavier views, or 42501 after a failed token refresh). The sync panel shows it as failing, but nothing resolves it. A fix needs the flush to give up on a publish after N attempts (the handler is not told the attempt count today) or to skip a transiently failing publish.
- **The scorer's confirm now waits for the display publish.** The publish is queued behind the confirm and one flush sends both, so "Confirming..." lasts through the publish's reads (about three round trips on good wifi, bounded by per-request timeouts on a bad link). Chosen over the alternative because the publish can no longer be lost when the scorer leaves the screen. A `raceTimeout` around the confirm's flush would bound it.
- **No coalescing of queued publishes.** N offline confirms queue N full rebuilds that drain one after another (about ten requests each). Only the last per event matters; skipping earlier same-event publishes with no confirm between them is possible.
- **Recency is `updated_at`.** `btc_matches` has no `confirmed_at`, so a recorded tie-break or a correction makes an older match the newest result again. Each result card's `confirmedAt` lets a display tell a re-score from a new result; a column would make it exact.
- **No "show this event" control**, as in Cup Taster. The org's current session is the 4 Oct Cup Taster event until a BTC confirm, tie-break or demo load takes over; schedule edits never do. A BTC event dashboard "Live now" badge (Cup Taster's has one) is not built.
- **Everything in the payload is public**, and `live_sessions` keeps one row per event, so past BTC events' team and judge names and tie-break reasons stay readable by anyone by event id. Judge names are published for the next two matches before they are played (a product choice). The tie-break form now says the reason may appear on the live display. There is no server cap on the payload size or on team and judge name length.
- **Demo load that times out in the browser** (the RPC may still commit) publishes nothing; the next confirm or edit corrects it.
- **Reads are not one snapshot.** The nine reads behind a payload run separately, so a confirm landing mid-build can mix old and new rows; the confirm's own publish (a later snapshot clock) corrects it. A result's breakdown is hidden when it does not add up.
- **CLOSED (T-HARDEN.remove-publish-superseded, 2026-10-11):** `core/publish.js`'s `publishSession`/`publishHandlers` have no production caller now (both formats use `core/publishIntent.js`); kept and marked superseded. Delete with `publish.test.js` when convenient.
- **The confirm and its display publish are two separate IndexedDB writes** (a few milliseconds apart). A tab dying exactly between them leaves a confirm that drains with no publish requested; the next confirm or edit repairs the display. A single transaction, or a reconcile on drain, would close it.
- **The BTC `*.preview.html` harnesses mount their screens without the composed handler map**, so a confirm there queues no display publish and the setup, matches and bracket screens log "live-view publish was refused" after an action. Dev harnesses only; production always passes `allOutboxHandlers`.
- **`submitConfirmMatch` and `flushPending` still fall back to BTC's own handler map** when none is passed (production always passes the composed one). A caller that relied on the fallback could leave a display publish stuck at the head of the shared queue; the scoring screen therefore queues the publish only when it was given the map.
- **Closed by this task:** the demo-data item "if the event is the ACTIVE live session, a load does not republish" (a load now republishes and takes the display over).

---
