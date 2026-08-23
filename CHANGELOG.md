# Changelog — Seduh Score Next

Backfilled 2026-08-21 for Phase 0 (this file didn't exist while T0.1–T0.3 shipped, all in
the same session). From here forward, an entry lands before any session that ships code
closes.

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.5)

### T4.5 Scoring surface: three-state toggle, strict confirm, bulk mark-wrong

Scope decided with the user before writing code, via three explicit questions: (1) write
model — local-accumulate (browser state + IndexedDB draft) with the whole heat submitted
as ONE atomic operation via the existing `confirm_heat` RPC (migration 20260822100000)
through the outbox, not a direct-write-as-you-tap pattern like T4.3/T4.4 — the
recommended option, chosen specifically because it's the exact "confirming a heat is
queued as ONE operation calling ONE RPC" use case the outbox's own module comment and
handoff §9 were built for, but never actually wired up until now; (2) persist the draft to
IndexedDB as taps happen, not the recommended in-memory-only option — the more resilient
choice, so a browser refresh/crash mid-scoring doesn't lose an organiser's work; (3) the
bulk mark-wrong action scoped to per-cupper only, not also a whole-heat action.

`src/formats/cup-taster/setup.js`: added `listSetsForStage(stageId, client)` — T4.1's
existing `listSetPositions` only returns bare positions, not full rows with `id`, and
scoring needs `set_id` to key results.

`src/formats/cup-taster/scoring.js` (new): `toggleScore` (null → true → false → null,
three-state, never a fourth state), `computeTally`/`isEntryComplete`/`isHeatComplete`
(pure derivations — `correct` stays a count, never a stored column, per handoff §5.2),
`markCupperRemainingWrong` (per-cupper only, per the user's scoping decision),
`loadDraft`/`saveDraft`/`clearDraft` (IndexedDB-backed draft, keyed per heat),
`loadConfirmedResults` (reads the real `ct_results` rows for the post-confirm read-only
view), `buildConfirmEntries` (assembles the RPC payload, filtering out any still-null
result rather than sending an explicit `null`), `submitConfirmHeat` (enqueues one
`confirm_heat` operation and flushes it through the outbox), `describeConfirmError`
(translates a P0002 conflict into an organiser-facing message using the DETAIL payload's
`current_updated_at`).

`src/formats/cup-taster/scoringScreen.js`/`.css` (new): a three-state toggle grid per
cupper per set (stable `score-{entryId}-{setId}` ids for rebuild-then-refocus, §15.3), a
running tally per cupper, a per-cupper "Mark remaining wrong" action, and a Confirm button
gated on every cupper having every set scored. Live-verified via a demo harness
(`scoringScreen.preview.html`, including a fake `.rpc()` — the first screen needing one).

`src/core/outbox.js`: gained a generic `.permanent` error-flag contract on `runFlush` — a
handler can throw with `error.permanent = true` to mean "this exact operation can never
succeed no matter how many times it's retried" (distinct from an ordinary failure, which
still correctly stops the whole flush and leaves the operation queued for retry). Zero
Cup-Taster-specific knowledge in `core/outbox.js` itself — `scoring.js`'s
`submitConfirmHeat` is the one format-specific caller that tags a P0002 conflict this way,
never a network-level rejection.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`offline-sync-auditor` (the outbox's own confirm-heat write path made this task's first
genuine use of it), `test-auditor`, `code-reviewer` — six agents, run in parallel, across
three rounds. Round 1 found the most severe issues; round 2 found narrower, second-order
gaps in round 1's own fixes; round 3 (scoped to just round 2's fixes, not the whole
feature again) found one cosmetic nit and one test-coverage gap, both closed, and
otherwise came back clean. Every round found something real, consistent with this
project's own "every review should find something" discipline.

**Round 1:**

1. **`scoring-auditor` + `code-reviewer` (independently converging): a real, reproduced
   lost-update race.** Rapid taps on different cells could silently drop one — `draft` was
   captured once per `render()`, and a second tap landing on the stale DOM before the
   first tap's full network round trip resolved read the same stale snapshot, with
   `saveDraft`'s unconditional overwrite discarding whichever save landed last. Fixed by
   moving `draft` to closure-level state, mutated **synchronously** as the first statement
   of every handler — before any `await` — since one click handler's synchronous portion
   always completes before another dispatched click can start. `scoring-auditor` verified
   this closes the race even under out-of-order IndexedDB transaction *commit* ordering
   (not just promise resolution order), by tracing `core/db.js`'s actual `db.transaction()`
   semantics.
2. **`scoring-auditor`: `confirm_heat`'s strict-confirm row-count check was dead code
   against the real client payload.** Sending an explicit `correct: null` for an unscored
   set tripped a raw NOT NULL constraint violation (`ct_results.correct` is `not null`)
   before the RPC's own row-count check could ever fire, making the "friendly" error
   message unreachable. Fixed by filtering null-valued results out of
   `buildConfirmEntries`'s payload entirely — no migration touched, since nothing has been
   pushed to a cloud project yet and the fix didn't need one anyway.
3. **`offline-sync-auditor`: two real outbox/confirm-flow bugs.** (a) A P0002 conflict left
   a permanently-stuck outbox operation blocking the *entire* global queue forever — any
   heat, any future confirm. Fixed via the `.permanent` error-flag mechanism described
   above (remove-and-continue instead of stop-and-retry-forever). (b) No double-click guard
   on Confirm could enqueue two operations, causing a self-inflicted P0002 conflict where a
   *successful* confirm gets reported to the organiser as *failed*. Fixed with a
   `confirmInFlight` guard, disabled synchronously (same reasoning as the `draft` race fix
   above), plus a fresh ground-truth re-fetch after the flush resolves rather than trusting
   the flush's own (possibly-unrelated, since the outbox is one shared global queue)
   result.
4. **`ui-accessibility-reviewer`: an unstyled `unscored` toggle** (browser UA defaults, not
   design tokens) **and non-disabled buttons in the confirmed read-only view.** Fixed with
   explicit token-sourced CSS and a new `interactive` parameter on `renderScoringRows`.
5. **`test-auditor`: a misleading `listSetsForStage` test** claimed to prove sort order,
   which the fake test client structurally couldn't prove. Split into two honest tests: one
   proving row shape, one proving the `.order()` call arguments.

**Round 2** (re-review of round 1's fixes):

1. **`offline-sync-auditor` + `code-reviewer` (independently converging): `runFlush`'s
   permanent-failure tracking silently dropped an earlier permanent failure's info if a
   later, unrelated ordinary failure was what actually stopped the same pass** — only the
   queue-empty return path carried it forward. Fixed by making `permanentFailure: boolean`
   present on every return path, and renaming the local variable to `lastPermanentError`
   for clarity.
2. **`offline-sync-auditor`: the confirm handler's ground-truth re-fetch could itself fail**
   right after a successful confirm (e.g. a connection drop between the RPC ack and this
   read), showing a misleadingly definite "failed" message even though the confirm may
   have actually succeeded. Fixed via `.catch(() => null)` and a new, appropriately hedged
   branch ("Could not confirm whether this went through...") — the next render's own
   re-fetch self-corrects if it did.
3. **`scoring-auditor`: toggle/mark-wrong buttons weren't disabled while a confirm was in
   flight**, leaving a narrow window where a tap could be silently overwritten the moment a
   successful confirm switched the screen to the server-authoritative read-only view, with
   no notice the tap never counted. Fixed with a new `locked` parameter on
   `renderScoringRows`, distinct from `interactive` — a `locked`-but-editable toggle gets
   `disabled` without the `data-readonly` marker the true confirmed view uses, so CSS can
   (and does — see round 3) treat the two disabled states differently.
4. **`ui-accessibility-reviewer`: the confirmed view's disabled toggles inherited a
   project-wide `.btn:disabled { opacity: 0.6; }`,** dropping contrast on data that's meant
   to be *read* (not an unavailable action) below AA (~2.7–3.4:1 measured vs. the 4.5:1
   floor). Recommended scoping an opacity override to the true read-only case — closed in
   round 3.
5. **`code-reviewer`: three more stray debug files** (`__pw_check*.mjs`) left at the repo
   root by earlier reviewer agents' own live-verification sessions. Deleted.

**Round 3** (scoped re-verification of round 2's fixes only, given round 2's own findings
were narrower/second-order rather than severe): all five relevant reviewers
(`code-reviewer`, `module-boundary-checker`, `offline-sync-auditor`, `test-auditor`,
`ui-accessibility-reviewer`) came back clean on correctness — the CSS opacity override
(`.scoring-toggle[data-readonly='true'] { opacity: 1; }`) was live-verified in-browser
(computed opacity 1, white-on-danger-red at ~8.25:1) and confirmed by
`ui-accessibility-reviewer` to clear AA across all three tones in both light and dark
surface modes, with margin. Two small findings, both closed: **`code-reviewer`** caught a
dead `interactive &&` guard left over from the `locked` fix (unreachable in every current
call site — simplified); **`test-auditor`** caught that the new "toggle tap during an
in-flight confirm" integration test only proved a render happened, not that the tap's own
draft mutation survived — closed with a direct post-unlock `data-tone` assertion.

409 tests total (up from 355 after T4.4) — new files `scoring.test.js` and
`scoringScreen.test.js`, plus additions to `outbox.test.js` (the `.permanent` mechanism)
and a split-for-honesty pair in `setup.test.js`.

Unlike T4.3/T4.4, this screen has **no direct-write gap** — it's the first Cup Taster
surface that actually routes through Phase 3's outbox end to end, closing part of the
known gap those two tasks carried forward (see ROADMAP.md; the app-mode/manual-mode timing
screens themselves still write directly, that gap is unchanged).

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.4)

### T4.4 Timing surface, manual mode

Scope decided with the user before writing code, via two explicit questions: (1) stay
scoped to the manual-mode surface itself, not also retrofit T4.3's app-mode screen with a
manual-entry fallback for a mid-heat device failure — the spec sentence that prompted the
question ("a heat may mix tapped and hand-entered times if a stopwatch fails mid-heat,"
§7.1) only makes sense as an app-mode recovery path (`recordTap` requires `status ===
'timing'`, which a manual-mode heat never enters), so building it would have meant
touching T4.3's already-shipped, already-reviewed screen — noted as a deferred gap rather
than silently dropped; (2) logic plus a real screen now, matching T4.2/T4.3's precedent.

`src/formats/cup-taster/timing.js`: three previously-private functions —
`buildClampedUpdate`, `findHeatEntry`, `tryAdvanceToScoring` — are now exported so the new
manual-mode module can reuse them rather than reimplementing the same write-payload
builder, entry lookup, and advance-retry wrapper. `maybeAdvanceToScoring`'s status filter
generalized from `.eq('status', 'timing')` to `.in('status', ['pending', 'timing'])`,
since a manual-mode heat "skips timing" entirely (§7.1) — it advances straight from
`pending` to `scoring`, never passing through `timing` at all. Verified safe for app mode
too: a still-`pending` app-mode heat can never have any entry with `elapsed_secs` set,
since nothing can write one before `startHeat` flips status to `timing` — confirmed by
`scoring-auditor` tracing every writer in the repo, not just asserted.

`src/formats/cup-taster/timingManual.js` (new): `recordManualTime(heatId, entryId,
rawSecs, client, {now})` — validates `rawSecs` is a non-negative integer before any DB
call, validates `timing_mode === 'manual'` and `status === 'pending'`, writes via the same
`buildClampedUpdate` the tap path uses (`time_source: 'manual'`), then calls
`tryAdvanceToScoring`. The one deliberate behavioral difference from `recordTap`: this
_allows_ overwriting an already-recorded time — no `.is('elapsed_secs', null)` race guard
— since a judge correcting a mis-typed number is normal, expected workflow here, not a
race to defend against, given the project's existing single-writer assumption (handoff
§9). That correction window is bounded by the `pending` guard, not open-ended: once every
entry has a time and the heat auto-advances to `scoring`, further writes are refused, same
as the tap path locks once a heat leaves `timing`.

`src/formats/cup-taster/timingManualScreen.js` + `.css` (new): every row shows an editable
minutes/seconds pair the whole time the heat is `pending` — unlike T4.3's Stop button
(permanently replaced once tapped), there's no locked/unlocked distinction here, since
re-saving is always allowed. Pre-fills from `elapsed_secs_raw` (the true value a judge
typed), never the clamped `elapsed_secs`, so re-saving an already-maxed entry without
changes can't silently "fix" what's displayed as entered. Reuses `timingScreen.js`'s
`renderTimingRows` directly for its own read-only "Timing complete" view rather than
duplicating that rendering logic. `formatCountdown` (local to `timingScreen.js`) was
extracted to `src/core/duration.js` as `formatDuration` on its 2nd verbatim use (now
needed by both screens) — format-agnostic, any future format needing duration display
could reuse it unedited.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then the four with findings re-run
after fixes (`module-boundary-checker` came back clean both times reused-logic reasoning
holds; skipped its second pass since nothing in the fix round touched an import or a
boundary). Every other reviewer found something real:

1. **`ui-accessibility-reviewer` (the most significant finding, and the only one that
   needed two attempts to actually close): a genuine 360px horizontal-overflow bug**, of
   the exact class T4.3 already hit once. `.manual-timing-row`'s original
   `flex-direction: column; align-items: flex-start;` broke the inherited ellipsis
   truncation on a long cupper name — the harness's own test name happened to just barely
   fit, masking it; a longer name reproduced real page-level overflow (540px vs. a 360px
   viewport). **First fix attempt (removing `align-items: flex-start` entirely) did not
   actually work** — it just fell back to the base `.timing-row` class's own
   `align-items: center`, which has the identical non-stretch problem. The re-review
   agent caught this independently rather than trusting the description, by measuring
   actual computed layout with the same long name. Real fix: explicitly set
   `align-items: stretch` to override the base class, verified afterward at both 360px
   and 320px with `clientWidth < scrollWidth` on the name element itself (genuine
   truncation, not coincidental fit).
2. **`ui-accessibility-reviewer`: every row's Save/Update button shared the same
   accessible name** ("Save" on every row, indistinguishable in a screen-reader rotor) —
   a regression against T4.3's own established pattern (its Stop button already solved
   this with a per-cupper `aria-label`). Fixed the same way:
   `` `${saveLabel} ${entry.displayName}'s time` ``.
3. **`ui-accessibility-reviewer` (flagged as worth tracking, addressed anyway): the
   success announcement didn't convey a heat-completion state transition.** When a save
   is the one that flips the heat from `pending` to `scoring`, the screen swaps to the
   read-only "Timing complete" view underneath the user — but the announcement still just
   said "{name}'s time recorded," giving a screen-reader user no indication the whole
   screen just changed shape. Fixed with a `checkForCompletionOnNextRender` flag, checked
   against the freshly-loaded heat status at the top of the next render, appending
   "Timing complete — every cupper has a final time." only on the completing save.
   `test-auditor`'s re-review found the first version of this fix's own test only proved
   the branch _could_ fire, not that it wouldn't fire on a _non_-completing save — closed
   with a paired negative assertion, verified by deliberately mutating the guard to
   always fire and confirming the new assertion catches it.
4. **`scoring-auditor`: `recordManualTime`'s module comment said corrections were allowed
   "before the heat closes,"** which reads as open-ended, but the actual guard is
   `status !== 'pending'` — tightened to accurately describe the bounded window.
5. **`code-reviewer` (two minor items): dead code** — a `focusAfterRender` variable in
   the new screen was declared, checked, and reset, but never actually assigned anywhere
   (removed); and **a stale comment** referencing the now-deleted `formatCountdown`
   (updated to `formatDuration`).
6. **`test-auditor`: `parseElapsedInput`'s seconds boundary (0–59) was untested at the
   actual boundary** — only far-off values (75, -1) were covered. Confirmed via real
   mutation testing (a `seconds >= 59` off-by-one passed every existing test undetected).
   Closed with explicit 59-accepted/60-rejected cases.

355 tests total (up from 325 after T4.3) — 9 new in `timingManual.test.js` (new file), 20
new in `timingManualScreen.test.js` (new file), 2 new in `duration.test.js` (new file,
moved from `timingScreen.test.js`'s old `formatCountdown` tests), 1 new in `timing.test.js`
(the generalized `maybeAdvanceToScoring` covering manual mode's `pending`→`scoring` path).

**Known gap, carried forward, not silently dropped:** the app-mode fallback described in
§7.1 ("a heat may mix tapped and hand-entered times if a stopwatch fails mid-heat") is not
built — see ROADMAP.md's known items.

---

## Phase 4 — Cup Taster · 2026-08-22–23 (T4.3)

### T4.3 Timing surface, app mode

Scope decided with the user before writing code, via three explicit questions: (1) full
lifecycle (start → tap → auto-max at clock zero → transition to scoring), not
tap-recording alone; (2) logic plus a real ticking screen now, matching T4.2's precedent,
rather than deferring the UI; (3) direct writes for now, not wired through Phase 3's
outbox — a deliberate, documented scope gap (this is the first genuinely live,
time-pressured screen in the build plan, exactly what the outbox exists for, but queue
ordering against a live countdown and conflict surfacing deserve a focused pass with
`offline-sync-auditor` rather than folding into this task's first cut).

`src/core/timeclamp.js`: `clampElapsed()` now handles negative input too — floors
`elapsed` to 0 (clock skew between client and server, since the tap path computes elapsed
against a server-recorded `started_at`) while `raw` always preserves the true unclamped
value, so the audit trail the schema comment promises (§5.2) is never lost before it
reaches the one function responsible for enforcing the cap. This is the sole place both
bounds — negative floor and duration ceiling — are enforced.

`src/formats/cup-taster/timing.js` (new): `startHeat` (idempotent — a heat already timing
is returned unchanged rather than restarting the clock, which would corrupt the meaning
of every already-recorded elapsed time), `recordTap` (the tap path — `MAX_NEGATIVE_SKEW_SECS`
= 5 rejects a computed tap more than 5s before `started_at` outright, before it ever
reaches `clampElapsed`, so a broken client clock can't silently hand a cupper the fastest
time in the heat; `.is('elapsed_secs', null)` on the update closes the race between the
read-check and the write for two concurrent taps; a lost race re-fetches and distinguishes
a genuine duplicate-tap collision from a race lost to the master clock expiring first),
`autoMaxRemainingEntries` (called by the UI once its own local countdown detects expiry —
there is no server-side timer, §8.2 — maxes everyone still running via the same
`clampElapsed` cap a real tap uses), `maybeAdvanceToScoring` (timing → scoring once every
entry has a final time), and `tryAdvanceToScoring` (wraps the advance-to-scoring call so a
failure there — the triggering tap or auto-max write already succeeded by that point —
never propagates as if the tap itself failed; logs and lets the next write for that heat
retry the same check).

`src/formats/cup-taster/timingScreen.js` + `timingScreen.css` (new): the live-countdown
screen. Rebuild-then-refocus (§15.3) for real actions, but the countdown itself is
deliberately excluded from that cycle — a full DOM rebuild every second would flicker and
steal focus, so `tick()` only mutates the countdown element's `textContent`, while
`render()` runs only after start/tap/auto-max. The countdown display is intentionally not
an `aria-live` region (a value changing every second would spam announcements — confirmed
against WAI-ARIA/MDN guidance); real state changes (a stop recorded, the heat completing,
crossing the ≤10s urgent threshold once) go through the existing `screen-feedback` live
region instead. `timingScreen.preview.html` is a demo-only harness (in-memory fake client,
20s duration instead of a real ~480s heat so the full lifecycle is observable directly),
matching `heatsScreen.preview.html`'s precedent.

Two format-agnostic helpers reached their second verbatim use this task and were
extracted to `src/core/` rather than duplicated again: `dom.js` (`el()`, the DOM builder)
and `errors.js` (`describeError()`) — both originally local to `heatsScreen.js`. This is a
different call than "three similar lines is better than premature abstraction": these
were 100%-identical functions, not merely similar ones, so extraction on the 2nd
occurrence rather than waiting for a 3rd. `heats.js`'s `hydrateStageEntries` was renamed
to `hydrateEntries` and its doc comment updated — it already worked generically over
anything carrying `entry_id` (`ct_stage_entries` or `ct_heat_entries` rows both do), and
`timing.js`/`timingScreen.js` now reuse it unedited rather than reimplementing it, exactly
the §6 test this project holds itself to. `core/registry.js` gained `listEntriesByIds`
(the roster-by-id-list lookup the timing screen needs, that `listEntries`'s
whole-event-roster form didn't cover).

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then re-run after fixes across two
total rounds. `scoring-auditor` and `module-boundary-checker` came back clean both rounds.
The others each found real issues:

**Round 1:**

1. **`scoring-auditor` (the most significant finding): a pre-clamp in `timing.js` floored
   negative elapsed values to 0 before they ever reached `clampElapsed()`**, splitting the
   "sole writer" authority the function exists to hold and silently destroying the true
   skewed value `elapsed_secs_raw` is supposed to preserve, with no bound distinguishing
   "200ms of clock skew" from a broken client clock. Fixed as described above:
   `clampElapsed()` itself now floors `elapsed` while always preserving `raw`, and
   `MAX_NEGATIVE_SKEW_SECS` rejects anything beyond 5s outright.
2. **`ui-accessibility-reviewer` (D9, blocking): the `is_test` banner was entirely
   missing** — `mountTimingScreen` didn't even take an `eventId`. Fixed: added the param,
   `findEvent()` in `loadState()`, and the banner render, matching `heatsScreen.js`.
3. **`ui-accessibility-reviewer`: rebuild-then-refocus only covered the `startHeat`
   success path** — a stop tap or an auto-max left focus wherever it happened to be.
   Fixed: `render()` now falls back to focusing the feedback region whenever it carries a
   tone and no explicit target was requested, extending `heatsScreen.js`'s existing
   error-only fallback to also cover success.
4. **`ui-accessibility-reviewer`: no success-path live-region announcements at all** —
   `setFeedback` was only ever called from catch blocks. Fixed: `onStop`/`handleExpiry`
   now set a `pendingSuccess` message applied the same way `pendingError` already was.
5. **`ui-accessibility-reviewer`: no announcement when the countdown first crosses the
   urgent (≤10s) threshold.** Fixed with a one-time `urgentAnnounced` flag mutating the
   live feedback element directly (not a full render, to avoid flicker mid-tick).
6. **`ui-accessibility-reviewer`: heading structure was conflated** — the ticking
   countdown div also carried the only `id`/heading role for that section, and the
   per-cupper row list had no heading at all. Fixed: a stable `<h2 id="countdown-heading">`
   separate from the ticking display, plus a real `<h2>Cuppers</h2>` above the row list.
7. **`code-reviewer`/`test-auditor`: `.heats-screen`/`.timing-screen` container CSS was
   byte-for-byte duplicated** between the two screens' stylesheets. Extracted to a shared
   `.screen-container` class in `heatsScreen.css` (both sheets are always loaded
   together); added the `[data-tone='success']`/`[data-tone='urgent']` CSS the new
   announcements needed.
8. **`test-auditor`: the auto-max "stops ticking" test only proved no further DB calls
   happened**, which would pass even with a harmlessly-leaked interval — `expiryHandled`
   blocks re-entry regardless of whether the timer was actually cleared. Fixed with a
   `vi.spyOn(global, 'clearInterval')` assertion proving the teardown itself, not just an
   absence of side effects. Also tightened a `toContain('Max time')` assertion to the
   exact `toBe('Max time (8:00)')`.

**Round 2** (re-verification of round 1's fixes, all five reviewers): `scoring-auditor`
and `module-boundary-checker` confirmed clean. `ui-accessibility-reviewer`,
`test-auditor`, and `code-reviewer` each found one more real issue:

9. **`ui-accessibility-reviewer`: a 360px overflow risk** — `.timing-row` had no
   `min-width: 0`/truncation handling between a long cupper name and the fixed-width Stop
   button, so a long enough name would push the button off the edge of the card rather
   than wrapping or truncating. Fixed with `min-width: 0` + `text-overflow: ellipsis` on
   the name, `flex-shrink: 0` on the button — live-verified at 360px with a 28-character
   name (would have overflowed to 226px, correctly truncates to 104px, no page-level
   horizontal scroll).
10. **`ui-accessibility-reviewer`: `handleExpiry`'s zero-maxed path left focus/feedback
    unmanaged** — reachable via the `tryAdvanceToScoring` retry design (a transiently
    failed status transition can leave a heat in `'timing'` with every entry already
    stopped until the master clock also expires and this handler fires as the retry), not
    just hypothetical. Fixed: `handleExpiry` now always sets a `pendingSuccess` message,
    even when nothing needed maxing.
11. **`code-reviewer`: `unmount()` didn't abandon a `render()` already in flight** — it
    called `stopTicking()` but never bumped the generation counter, so a slow in-flight
    render (awaiting `loadState()`) could still finish after teardown, rebuild into a
    discarded root, and register a fresh interval/listener nothing would ever clear again.
    Fixed by bumping `renderGeneration` in `unmount()` too, giving it the same
    "abandon if superseded" protection a newer render already has over an older one.
    Verified with a deliberate revert-and-rerun: the new regression test fails cleanly
    against the un-fixed code and passes against the fix.
12. **`test-auditor` (two gaps):** the `MAX_NEGATIVE_SKEW_SECS` boundary was untested at
    its exact cutoff (only -2s and -10s were covered — an off-by-one would have passed
    undetected); fixed with cases at exactly -5s (accepted) and -6s (rejected). The
    render-race generation counter had zero test coverage despite being realistically
    triggerable (two Stop taps in quick succession); fixed with a deterministic test using
    a small in-memory client whose `events` query (loadState's first await, untouched by
    `recordTap`) is gate-controlled, letting the test pin down exactly which of two
    concurrent renders "wins" without needing to guess real microtask interleaving order.

325 tests total (up from 272 after T4.2) — 23 new in `timing.test.js` (new file), 20 new
in `timingScreen.test.js` (new file), 5 new in `dom.test.js` (new file, extracted), 3 new
in `errors.test.js` (new file, extracted from `heatsScreen.test.js`), 2 new in
`timeclamp.test.js`, 3 new in `registry.test.js` (`listEntriesByIds`).

---

## Phase 4 — Cup Taster · 2026-08-22 (T4.2)

### T4.2 Heat generation: stage-entry seeding, random + manual, station assignment

Scope decided with the user before writing code, same as T4.1: no explicit AC exists for
T4.2 in the handoff, and no task owns seeding a stage's entries from the roster. Unlike
T4.1, this task does ship a real screen — the first one in the project, and the first
real consumer of `src/ui/tokens/`.

`src/core/registry.js`: added `listEntries(eventId, client)` — generic, reusable by a
future format. `src/core/events.js`: added `findEvent(eventId, client)`, used so the
screen can render `is_test` (below).

`src/formats/cup-taster/heats.js` (new): `seedFirstStageEntries` (idempotent, seeds only
the ordinal-1 stage from non-withdrawn roster entries — later stages get their entries
from T4.6's advancement logic, not this function), `buildHeatPlansFromSizes` (pure,
Fisher-Yates shuffle + `core/partition`'s own sizing — not reimplemented),
`buildHeatPlansFromAssignments` (pure, manual path — every stage entry must be assigned
exactly once, heat numbers sequential, `HEAT_MIN` enforced, stations unique per heat),
`createHeat`/`ensureHeatEntries` (idempotent, config-drift-checked, bounded-retry-on-race
— directly reusing T4.1's `setup.js` patterns, including its bounded-retry asymmetry fix
applied proactively this time), `generateHeatsRandom`/`generateHeatsManual`,
`listHeatsForStage`.

`src/formats/cup-taster/heatsScreen.js` + `heatsScreen.css` (new): the screen itself —
roster display, a "seed from roster" action, random-generate button, a manual
heat/station assignment form, a read-only generated-heats view. DOM built via
`createElement`/`textContent` only (roster names are user-entered, never trusted as
markup). Rebuild-then-refocus (§15.3) throughout. `heatsScreen.preview.html` is a
demo-only harness (in-memory fake client, no live backend needed), matching
`src/ui/tokens/preview.html`'s own pattern — used to verify the screen live in a real
browser at 375px, not just in jsdom.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then re-run after fixes across three
total rounds (the first two heavier, the third a targeted close-out of the second
round's own fix). `module-boundary-checker` came back clean both rounds. The others each
found real issues:

**Round 1:**

1. **`scoring-auditor`: no test proved `generateHeatsRandom` rejects a stage below
   `HEAT_MIN`** — the behavior was already correct (propagates `core/partition`'s own
   throw, not reimplemented), just unproven. Closed with a test.
2. **`code-reviewer` (the most significant finding across all of T4.2): a genuine
   partial-failure of heat generation could be silently displayed as "fully
   generated."** `createHeats` has no batch-level atomicity — if it throws after heat 1
   commits but before heat 2 does, the old render gate (`heats.length === 0`) treated
   any non-empty heat list as done, hiding that some cuppers were never assigned a heat,
   with no way back into generation from the screen. Fixed: the render logic now
   computes `generationComplete` (every stage entry's id present across the union of
   all generated heats' entries — an identity check, not a count) and branches three
   ways: no heats yet / heats exist but incomplete (a new, honest "Heat generation
   incomplete" state, offering no retry — regenerating isn't provably safe) / heats
   exist and complete.
3. **`code-reviewer`: raw DB/Postgrest error strings flowed straight into the
   user-facing feedback panel**, undifferentiated from this module's own descriptive
   thrown errors. Fixed with a `describeError()` helper (exported, unit-tested) that
   only passes through a plain `Error` with no `.code`; anything else (a raw Postgrest
   failure) gets a generic fallback message.
4. **`ui-accessibility-reviewer`: `is_test` wasn't rendered anywhere, and the screen
   didn't even fetch it** — flagged as worth fixing now (not deferring to T5.3/T5.4)
   given `src/ui/tokens/DESIGN.md`'s explicit "every surface" language and D9. Fixed:
   `loadState()` now fetches the event and renders `.is-test-banner` (already built,
   already contrast-verified in the design-system work) whenever `is_test` is true.
5. **`ui-accessibility-reviewer`: error feedback landed at the bottom of the page with
   no scroll-into-view or focus move** — a real gap for sighted users not using
   assistive tech. Fixed with `scrollIntoView`/`.focus()` on the feedback region.
6. **`test-auditor` (four findings):** a shuffle "proof" that sorted output before
   comparing (would pass even with a no-op shuffle — fixed with a hand-traced,
   independently-verified-by-running-the-code exact-order assertion); a bounded-retry
   test that only checked the error message text, not the actual insert-call count
   (fixed); an error-injection test coupled to an undocumented call-order assumption
   (fixed by replacing the monkeypatch with the same plain queue-based mocking used
   everywhere else in the suite); no test proving a manual-assignment validation error
   surfaces through the mounted screen (fixed).
7. Minor comment-accuracy fixes (`listHeatsForStage`'s query-cost comment overstated
   itself as "two queries" when it's 1+N sequential; a form-reading comment claimed
   `NaN` where `Number('')` is actually `0`) and removal of three CSS rules with zero
   call sites (`.btn-secondary`, `.field-label`, `.screen-feedback[data-tone='success']`)
   rather than kept as speculative forward-declarations.

**Round 2** (re-verification of round 1's fixes, all four reviewers): `scoring-auditor`,
`ui-accessibility-reviewer`, and `test-auditor` confirmed their findings genuinely
closed — `test-auditor` specifically via mutation testing (patching the real shuffle to
a no-op, patching the retry bound off-by-one, and confirming the new tests actually
fail), and additionally found the two new "completeness" tests didn't distinguish the
real identity-based check from a weaker count-based stand-in (fixed with a test using
duplicate entries across heats). `code-reviewer` found one more real gap in finding 2's
fix: **the render logic only refreshed from real DB state on the _next_ mount** — within
the _same_ browser session, a failed generate click left the stale "Generate heats"
button live, and a second click would reshuffle the entire roster fresh; since
`ensureHeatEntries` only checks for a station conflict within the _same_ heat (not
across heats), a cupper already committed to heat 1 could silently end up placed in
heat 2 too, with nothing to catch it.

**Round 3** (targeted close-out of round 2's fix): every action handler now
unconditionally re-renders after its attempt, success or failure (carrying the error
message across via a `pendingError` variable, since a failed re-render's fresh feedback
element didn't exist yet at catch-time). Since the re-render itself calls `loadState()`
fresh and that could also fail, a `renderOrShowError()` wrapper falls back to writing
the error directly onto whatever DOM is still live rather than crashing with an
unhandled rejection. `code-reviewer` re-checked this specific fix once more and found it
correct — including that the scroll/focus-on-error logic never double-fires or
misses across the two code paths that can now set an error.

272 tests total (up from 209 after T4.1) — 33 new in `heats.test.js` (new file), 25 new
in `heatsScreen.test.js` (new file), 2 new in `events.test.js` (`findEvent`), 3 new in
`registry.test.js` (`listEntries`).

**Also this session, unrelated to T4.2 itself:** `kb-sync` and `module-boundary-checker`
moved to a cheaper model (`model: haiku`) per user decision, to economize token usage on
the more mechanical reviewers. The five correctness/security gate agents, plus
`test-auditor` and `ui-accessibility-reviewer`, stay on the full model — see `CLAUDE.md`'s
delegation strategy section.

---

## Phase 4 — Cup Taster · 2026-08-22 (T4.1)

### T4.1 Setup: stage plan, sets, roster

Scope decided with the user before writing code (no explicit AC exists for T4.1 in the
handoff, unlike T4.5/T4.6, and no task creates an `events` row anywhere in the build
plan): this task ships the tested logic module only, no rendered screen — a UI pass
lands once more of Phase 4 exists to build one screen against, not four thin ones. Event
creation was added as a minimal function (not a screen), since without it the setup flow
has nothing to attach a stage plan to.

`src/core/events.js` (new): `createEvent(orgId, event, client)` — generic, takes
`format` as plain input rather than assuming Cup Taster, so a future format (Guess the
Bean) reuses it unedited. Tested with both `format: 'cup_taster'` and
`format: 'guess_the_bean'` to prove that directly.

`src/core/registry.js`: added `registerEntry(orgId, eventId, cupper, client)`, composing
the existing `registerPerson` + `createEntry` for the common case (a cupper with a
phone). Placed in `core/registry` rather than the Cup Taster format module — nothing
about the composition is Cup-Taster-specific, so a future identity-core format can reuse
it unedited too.

`src/formats/cup-taster/setup.js` (new): `validateStagePlan` (pure) and
`createStage`/`ensureSetsForStage`/`createStagePlan` (idempotent, Supabase-backed). This
is the genuinely Cup-Taster-specific half of the task — stage `kind`/`cutoff`/`set_count`
are §2/§7.5 vocabulary a future format wouldn't share.

Verifiers: `scoring-auditor`, `module-boundary-checker`, `test-auditor`, `code-reviewer`
— run in parallel, then `scoring-auditor`/`code-reviewer`/`test-auditor` re-run after
fixes. `module-boundary-checker`'s review came back clean both on registry/events
placement and on a live synthetic-violation probe confirming `no-core-format-import`
actually fires. The other three each found real issues, across two full review-and-fix
rounds:

**First round:**

1. **Blocking (`scoring-auditor`): `createStage` silently discarded config drift on
   retry.** If a stage already existed at an ordinal, the existing row was returned
   verbatim with no comparison against the newly-passed cutoff/setCount/durationSecs —
   indistinguishable from a legitimate correction (an organiser fixing a typo'd cutoff
   before the event), which would then be silently lost with no error. Since `cutoff` is
   the fixed advancement field (D20) and `duration_secs` gets snapshotted per-heat later,
   a stale value here would silently mis-size the field or mis-time heats. Fixed:
   `createStage` now compares the existing row against the incoming config and throws a
   descriptive conflict error on any mismatch, rather than assuming "found" means
   "identical."
2. **`scoring-auditor`: cutoff monotonicity across stages was unvalidated.** A plan like
   `prelims: cutoff 8, semis: cutoff 16` passed `validateStagePlan` cleanly, and
   `core/advancement` would then silently treat the oversized cutoff as "everyone
   advances" instead of trimming the field. Fixed: each non-terminal stage's cutoff must
   now be ≤ the previous stage's.
3. **`scoring-auditor` + `code-reviewer` (independently, same defect): kind/ordinal
   weren't tied to canonical progression.** A plan with `finals` at ordinal 1 and
   `prelims` at ordinal 2 passed every per-stage check individually. Fixed:
   `validateStagePlan` now checks the whole kind sequence against the two real
   configurations (§7.5) — exactly `["prelims","finals"]` or
   `["prelims","semis","finals"]`, in that order.
4. **`code-reviewer`: the idempotency claim didn't hold under concurrent callers.**
   Check-then-create has nothing serializing the check and the insert — two concurrent
   callers (a double-click, a flaky-connection retry racing the original request) could
   both pass the "not found" check, and the loser would get a raw Postgres
   unique-violation propagated unchanged. Fixed: both `createStage` and
   `ensureSetsForStage` now catch a unique-violation (`23505`), re-fetch, and either
   adopt the winning row (if it matches what was requested) or throw the same
   config-conflict error a sequential retry would have gotten.
5. **`test-auditor` (six findings):** a `registerEntry` dedup test that never actually
   asserted no duplicate person was created (would have stayed green even with the dedup
   bypass reintroduced); a `createStagePlan` "ordinal order" test that didn't prove order
   at all; `createStage`'s camelCase→snake_case payload mapping never checked; idempotency
   proven only via separately-scripted branches rather than a real double-invocation
   against one shared client; terminal-stage-by-highest-ordinal proven only incidentally;
   no non-mutation test for `validateStagePlan`'s input. All six closed, each with a
   proof traced by re-verification to confirm it would actually fail if the bug it
   targets were reintroduced — not just a same-named test.

**Second round** (re-verification of the first round's fixes): `scoring-auditor` and
`test-auditor` confirmed all their findings genuinely closed. `code-reviewer` found one
more real gap in the concurrent-race fix: `ensureSetsForStage`'s retry only survived
_one_ level of racing — a second collision on the retry's own insert would throw the raw
error unchanged, contradicting the function's own doc comment. Fixed with a bounded
retry loop (`MAX_INSERT_ATTEMPTS = 3`), throwing a clear "gave up" error only once every
attempt has collided. Also fixed: duplicated conflict-error message construction
(extracted to `throwConfigConflict`), and a single formatter fragilely reconciling two
different object shapes (DB row vs. camelCase request) via `??` fallbacks — split into
`describeStoredStage`/`describeRequestedStage`, each handling only its own real shape.

**Third round** (targeted close-out of the bounded-retry fix specifically):
`code-reviewer` found one more asymmetry — the loop's "already done" check only ran at
the top of each iteration, so the recompute after the _final_ attempt's collision was
never re-checked. A race that actually resolved in our favor on the last collision would
still report "gave up" instead of the success it had already reached. Fixed with an
explicit post-loop check, plus a test proving it (3rd attempt collides, but the
recompute immediately after shows nothing missing → resolves normally, not "gave up").

209 tests total (up from 163 before this task) — 38 new in `setup.test.js` (new file),
5 new in `events.test.js` (new file), 3 new in `registry.test.js`'s `registerEntry`
block.

---

## Phase 3 — Registry and offline · 2026-08-22 (T3.3)

### T3.3 Sync state panel

`src/core/syncState.js`: `computeSyncState({ enabled, operations, lastFlushError })` —
pure derivation of the three-state panel (handoff §8.4: off / live / not synced). No UI
exists anywhere in this project yet (Phase 4/5 build actual screens), so this is
deliberately just the state-derivation logic a future panel will render, not a rendered
component. `stuckOperation` surfaces the first queued operation with `attempts > 0` —
closing the "a poison operation accumulates silently with no way to reach a human" gap
`offline-sync-auditor` flagged as deferred during T3.2's review.

Verifier: `offline-sync-auditor`, live-run via the Agent tool, twice (a first pass and a
re-verification after fixes) — matching Phase 3's other two tasks, not a clean pass
either time.

**First pass found three real issues**, the first a genuine fail-open violation:

1. `enabled` was checked _before_ the outbox's own real state — `enabled: false` could
   mask a genuinely pending or failed operation behind "off," which reads as an
   unalarming, expected state. Exactly the kind of lie "fail-open never lies about a
   write that failed" (§8.4) exists to prevent, and the original test suite had
   pinned this as intentional ("stays 'off' even if operations/error are (incorrectly)
   passed while disabled") rather than catching it. Fixed by checking pending
   operations/`lastFlushError` first, `enabled` only once both are already clean —
   `enabled: false` now correctly returns "not synced" whenever real work is
   outstanding.
2. **A real bug in already-merged T3.2 code, found via this review**: `outbox.js`'s
   missing-handler check threw _before_ the `try` block that persists
   `attempts`/`lastError`, so an operation whose type had no registered handler could
   never accumulate attempts — meaning it could never surface via `stuckOperation`
   despite permanently blocking the queue exactly like any other poison operation.
   Fixed by moving the handler lookup inside the `try`; confirmed the reordering
   doesn't change the successful-handler path at all, only how a missing handler is
   recorded. `flushOutbox`'s contract changes as a result (resolves with
   `{stopped:true, error}` instead of rejecting) — noted for whoever wires up the sync
   engine next, since nothing calls `flushOutbox` yet.
3. `operations: null` crashed with a `TypeError` instead of degrading to a defined
   state. Fixed with an `Array.isArray` guard.

**Re-verification found one more, smaller gap** in fix 3: an array _containing_ a
null/undefined element (e.g. `[null, {id:'x', attempts:1}]`) still crashed on
`.find()`, since `Array.isArray` only guards the outer shape. Fixed with `op?.attempts`.
Not reachable from any current real caller (`listPendingOperations()` → IndexedDB
`getAll()` can't produce array holes), but closes the same class of gap fix 3 was
meant to close, not just its literal stated case.

**Final `code-reviewer` pass** (pre-commit, scoped to this task's files only) found two
more minor, non-blocking edge cases, both fixed:

4. `syncState.js` checked `lastFlushError` as truthy rather than "is set" — an error
   whose `message` came back as `''` (a handler throwing something other than a
   well-formed `Error`) would have read as "no error." Not reachable today
   (`pendingCount > 0` already forces "not synced" independently, since a failed
   operation is never removed from the outbox), but fixed anyway per the fail-open
   discipline this file is built around: `lastFlushError != null` instead of a bare
   truthy check, plus a test pinning `lastFlushError: ''` as still "not synced."
5. `outbox.js`: if `outboxRemove` itself throws right after a handler succeeds
   (IndexedDB quota/contention), the same catch re-persists the operation as a normal
   failure and a retry re-invokes the already-succeeded handler. Not a bug — each
   handler owns its own idempotency (confirm_heat's ledger, for example) — but the
   failure mode wasn't documented at the call site; added a comment.

163 tests total across the whole suite (up from 152; 11 new for `syncState.js`, plus
`outbox.test.js`'s missing-handler test rewritten to assert the corrected behavior).

---

## Design system foundation (`src/ui/tokens/`) · 2026-08-22

**No single §14 task ID** — this isn't one of the numbered build-plan tasks. It closes
the open item ROADMAP.md carried since Phase 2 ("`src/ui/tokens/` is an empty Phase 0
placeholder; real tokens land starting Phase 4, when UI work begins") ahead of Phase 4
starting, so T4.1–T4.8 (all reviewed by `ui-accessibility-reviewer` per §14) have a real
token layer to build on from their first commit rather than inventing one mid-task.

**What shipped**: `colors.css`, `typography.css`, `spacing.css`, `base.css`, `fonts.css`
\+ `fonts/*.woff2` (8 files), `index.css` (single entry point, fixed import order:
fonts → colors → typography → spacing → base), `DESIGN.md` (full rationale — three
refero.design references used as a starting point, a computed WCAG contrast table, the
Do/Don't guideline list), `preview.html` (live style guide exercising every token in both
surface modes), and `index.html` wired to load `index.css` so the existing placeholder
scaffold already inherits it. Full reasoning lives in `src/ui/tokens/DESIGN.md` — not
reproduced here; this entry records what shipped and what review found, not the design
argument.

Architecture in one paragraph: one warm neutral ramp (`--clr-clay-50`–`950`) shared by
two surface modes, `:root`/`[data-surface="paper"]` (light, organiser + phone) and
`[data-surface="stage"]` (dark, projector) — every semantic token follows one symmetric
rule (paper = dark tone + white `-contrast`, stage = light tone + `clay-950` `-contrast`)
so the mode switch has zero per-color exceptions. `--color-test` (violet, `#6b21c9`) is
reserved exclusively for `is_test` indicators (D9) and fixed across both modes. No
`box-shadow` token anywhere — flat borders/surface steps only. Three fonts
(Erode/Switzer/Tabular, Fontshare/ITF license) self-hosted rather than CDN-linked.

**Verifiers**: `module-boundary-checker`, `ui-accessibility-reviewer`, and
`code-reviewer`, run in parallel per `CLAUDE.md`'s delegation strategy (touches `src/**`
and is a UI change). **Not a clean pass — all three found real issues**, fixed before
this landed:

- `module-boundary-checker`: `preview.html`'s demo copy used Cup-Taster vocabulary
  ("Heat"/"cuppers") inside what's meant to be a format-agnostic token layer — the one
  place format vocabulary had leaked in. Genericized to "Round"/"judges". Otherwise
  clean — no `core/`↔`formats/` boundary issue, since this layer has no format coupling
  to begin with.
- `ui-accessibility-reviewer` (360px first, per DoD): `--color-focus-ring` was set to the
  accent hue — a focus ring in the same color family as an element's own accent styling
  weakens the focus signal, so it's now the neutral `--color-border-strong`. Added a
  `.tap-target` utility: `--tap-target-min` (44px, WCAG 2.5.5) alone only guaranteed
  `min-height`, not `min-width`, so an icon-only control could still land under 44px
  wide. A real 360px horizontal-overflow bug in `preview.html` (three independent
  causes: an unbreakable 96px mono sample, a grid auto-column that wouldn't shrink below
  its content's intrinsic width, and fixed-canvas type sizes dropped into a narrow
  responsive card) — fixed with flex-wrap + a media query, and `typography.css` now
  documents `--text-5xl`/`--text-6xl` as fixed-canvas-only (projector stage), not for
  arbitrary responsive containers. `--color-gold` was used as plain preview text at a
  measured 4.9:1 (barely-passing, undocumented) — removed in favor of gold-as-fill-only
  (badge background + `-contrast` text), matching the system's own stated guideline.
- `code-reviewer`: an orphaned unused token (`--clr-ember-400`) removed; `base.css`'s
  `.is-test-banner` stripe pattern used hardcoded `10px`/`20px` instead of the spacing
  scale, and carried an untokenized `text-shadow` that contradicted the system's own
  no-shadow rule — both fixed. `DESIGN.md`'s contrast table had one wrong number
  (accent-as-text listed as 5.6:1; actually 5.2:1 — that figure was the button-fill
  pairing, a different case) — split into two separate rows with correct values. A
  Prettier formatting failure across 4 files fixed via `npm run format`.

Every fix was re-verified in the running preview, not just re-read.

**Follow-up in the same session, on explicit user request**: the three Fontshare fonts
were added after the initial token build (colors/type/spacing/base only, system-font
stack). Verified in-browser after adding: network tab shows 200s for all 8 `.woff2`
files, computed styles confirm the webfonts apply over the fallback stack, and the
360px fix above still holds with real fonts in place (fonts change metrics; re-checked
rather than assumed).

**Decisions closed this session, not yet in the handoff's §12 record** (recorded here
per §0 — the handoff itself is never edited to reflect progress; a new decision is a new
row logged in this file, not a rewrite of the frozen document):

- **D30 — Self-hosted webfonts only, never a third-party CDN link (Fontshare's or
  otherwise).** The app runs at live events on venue wifi of unknown quality; a font
  request that has to succeed mid-event is a single point of failure this project can't
  accept, matching the same offline-first posture Phase 3's outbox work already commits
  to. `fonts.css` uses `font-display: swap` and every `--font-*` token keeps a full
  system-stack fallback after the webfont name regardless, so a slow/failed load still
  renders instantly rather than blocking — the self-hosting rule is belt-and-suspenders
  on top of that, not a substitute for it.
- **D31 — No `box-shadow` token in the design system; elevation is a border or a
  background-color step.** All three refero.design references this system started from
  separate surfaces with a hairline border or a flat color step, never a drop shadow —
  for a tool whose output is a competition scoresheet, that flat register was judged to
  read as rigor rather than SaaS gloss. Enforced only by convention/review for now (no
  lint rule); `code-reviewer`'s finding above (an untokenized `text-shadow` slipping into
  `base.css`) is the first real instance of what this decision is guarding against, so a
  future session should consider whether it's worth a lint rule once there's more than
  one occurrence to justify it.

**Open follow-up**: no real screen consumes these tokens yet (Phase 4 is "not started"
per `ROADMAP.md`) — `preview.html` and `index.html`'s `<link>` are the only current
consumers. `ui-accessibility-reviewer`'s 360px-first review covered the token layer and
`preview.html` itself; it has not yet reviewed a real product screen built on top of it,
since none exists — that review happens per-task starting Phase 4 (T4.1's own DoD), not
retroactively satisfied by this entry.

---

## Cloudflare Workers connected · 2026-08-22

Noticed mid-session, not initiated by this session: opening T3.2's PR surfaced an
unexpected third CI check, "Workers Builds: seduh-score-next," from Cloudflare's official
"Cloudflare Workers and Pages" GitHub App — with a real build ID and live preview URLs
(`https://5ec46df3-seduh-score-next.workers.dev`,
`https://feat-t3-2-outbox-seduh-score-next.workers.dev`). This meant the GitHub repo was
now connected to a real Cloudflare Workers project, which neither this session did (no
Cloudflare credentials or dashboard access were used) nor matches what T0.1/Handoff
Correction 001 says ("do not deploy and do not connect the repo").

Paused before merging and asked the user directly rather than assuming. Confirmed: the
user connected it themselves and is fine with deploys happening on merge going forward.
Merged T3.2's PR; confirmed a Workers Build check also fires on `main` (production
script), not just PR branches. Updated the "not connected" claims in `README.md` and
`ROADMAP.md`'s open items to match reality — left T0.1's own 2026-08-21 entry below
un-rewritten, since it accurately described the state at the time it was written.

No real app content is served yet either way (Phase 0's placeholder `main.js`/`index.html`
only) — this is a build/deploy pipeline now being live, not a live feature.

---

## Phase 3 — Registry and offline · 2026-08-22

### T3.2 IndexedDB mirror + operation outbox

`src/core/db.js` (IndexedDB wrapper: `cache` + `outbox` object stores, ported
from Kira-Kira's own `db.js`) and `src/core/outbox.js` (the FIFO queue
engine). Deliberately diverges from Kira-Kira's pattern in one way:
`flushOutbox()` takes a `handlers` map as a parameter rather than hard-coding
operation handlers inside the module — Kira-Kira is single-purpose and can
hard-code them, but a hard-coded Cup-Taster-specific handler (e.g.
`confirm_heat`) living inside `src/core/` would fail §6's own test ("can a
future format reuse this module without editing it?"). 22 unit tests (9
db.js, 13 outbox.js) prove generic queue mechanics: FIFO order, attempt-count
tracking, stop-at-first-genuine-failure (never running a later operation
ahead of a stuck earlier one), retry replaying the identical payload, and
concurrent-flush deduplication.

The AC's three specific proofs (atomic flush, idempotent retry, conflict
surfacing) live where the actual guarantee is implemented: new migration
`20260822100000_confirm_heat_rpc.sql`'s `confirm_heat` RPC — one atomic
transaction writing every cupper's time and every set's score together, a
`processed_operations` idempotency ledger keyed on a client-generated
operation id (a retry replays the same id and becomes a safe no-op — checked
_before_ re-validating anything, which matters specifically because
re-validating would compare against the row's now-changed `updated_at` and
misreport a real success as a conflict), and a `P0002` conflict exception
carrying both the current and expected `updated_at` in its `DETAIL`. 13
pgTAP assertions (53 across the whole suite) prove all three directly against
the real database — including the earlier bug T1.1's own comment described
(a partial flush leaving one cupper's results written while another's
strict-confirm failure aborts the whole heat) actually rolling back
completely, not just failing.

Verifier: `offline-sync-auditor` (clean review — see below), `security-reviewer`
(2 rounds — real findings, both rounds), `code-reviewer`.

**`offline-sync-auditor`'s review came back clean**, including on the one
judgment call worth double-checking: whether splitting the AC's proof across
the SQL layer (where the atomicity/idempotency/conflict mechanism actually
lives) and the JS layer (generic queue mechanics, which is all `outbox.js`
could possibly prove or break) is legitimate rather than dodging the AC's
letter. Confirmed legitimate — `outbox.js` has no code path that could
implement or break any of the three specific guarantees.

**`security-reviewer` found three real issues, two of them genuine
production-breaking/security gaps** — not from reading the RPC and reasoning
it looked correct, but from re-testing everything itself, including
re-attacking each fix independently after applying it:

1. `processed_operations` had **no `GRANT` to `authenticated`** — every real
   call to `confirm_heat` would have failed with `permission denied` in
   production. The pgTAP suite passed regardless, because it ran as the
   Postgres superuser (GRANT/RLS-exempt) rather than a real `authenticated`
   role — the same root cause as finding 3. Verified by revoking the grant
   and reproducing `permission denied for table processed_operations` as a
   real `authenticated` caller, then re-granting and reproducing success.
2. `ct_results.set_id` had no check tying it to the same stage as its
   `heat_entry_id`'s heat — the same "two independently-FK'd columns, nothing
   joins them" pattern already found and closed twice (`live_sessions` in
   T1.3, `event_entries`/`person_merges` in T3.1). Closed with
   `app.check_ct_results_set_stage()`, the same trigger shape as its
   precedents; verified to cover a direct `insert`/`update` against
   `ct_results`, not just writes routed through `confirm_heat`.
3. **The pgTAP suite itself never used `set local role authenticated`** —
   every assertion ran as the Postgres superuser, which is exactly how
   findings 1 and a cross-org write went unnoticed. Rewrote
   `005_confirm_heat.sql` with real `auth.users`/`org_members` fixtures and
   every call under a real `authenticated` role; added `003_rls.sql`'s
   missing `processed_operations` non-member-zero-rows and write-rejection
   assertions (a low-severity but real instance of the same "reasoned it
   looked correct instead of proving it" gap, caught in the same
   re-verification pass).

Every fix was re-verified by actually re-attempting the failure it closes,
not by re-reading the diff.

### T3.1 `registry`

`src/core/supabaseClient.js` (lazy client construction, mirroring Kira-Kira's
`getSupabase()` pattern exactly — importing `registry.js` never requires
`VITE_SUPABASE_URL`/`ANON_KEY` on its own) and `src/core/registry.js`:
`findPersonByPhone`, `findPersonByEmail`, `createPerson`, `registerPerson`
(phone-then-email dedup), `createEntry` (snapshots `display_name`/`cafe` from
the person at creation time, or uses the caller-provided values for a D16
walk-up with no `personId`), `mergePeople`. 14 unit tests against a fake
Supabase client (Kira-Kira's established pattern), no live network call in any
test.

New migration `20260822090000_registry_org_check_and_merge_rpc.sql`: an
`event_entries.person_id`/`event.org_id` consistency trigger, and a
`merge_people(p_org_id, p_kept_id, p_merged_id)` RPC implementing the merge
algorithm as one atomic transaction — a client-side sequence of separate
reassign/log/delete calls risks exactly the partial-failure class §9's offline
model exists to avoid. Per event where the merged-away person holds an entry:
reassigned to the kept person if there's no collision, unlinked
(`person_id = null`) if the kept person already has an entry there (the exact
scenario T1.1's partial-index test proved the schema supports). 10 pgTAP
assertions (38 across the whole suite).

Verifiers: `offline-sync-auditor` (Phase 3's designated verifier throughout)
and `security-reviewer` (this task touches RLS-adjacent org-scoping and a new
RPC), both live-run via the Agent tool, each **twice** — a first pass and a
re-verification after fixes.

**A live-exploited cross-org bug, not a clean review.** `security-reviewer`
found `merge_people` never validated that `p_kept_id` belonged to `p_org_id` —
only `p_merged_id` was checked. The `event_entries` org-check trigger
incidentally caught the cross-org case _when the merged-away person held at
least one entry_ (reassigning to a foreign `p_kept_id` would fire it), but a
merged-away person with **zero** entries never touches `event_entries` at all,
so nothing caught it. Demonstrated live against the running local stack, as a
real `authenticated` role with RLS actually in force: a member of Org A could
call `merge_people` with a `p_kept_id` belonging to Org B and merge in one of
their own zero-entry people, permanently writing a cross-org `kept_id` into
Org A's `person_merges` ledger and silently deleting the Org A person — no
error, no rejection. The **same hole was independently reachable via a plain
client-side `insert into person_merges`**, entirely bypassing the RPC, because
`person_merges_write`'s `WITH CHECK` only verified the ledger row's own
`org_id`, never that `kept_id`'s person actually belonged to it.

Fixed with two changes, both re-verified by actually re-attempting the live
exploit and confirming it now fails: an explicit `p_kept_id`-belongs-to-`p_org_id`
check inside `merge_people` (fails fast, clear error, before any mutation), and
a new `app.check_person_merge_kept_org()` trigger on `person_merges` itself
(same `SECURITY DEFINER`/`search_path = ''` shape as the existing
`check_event_entry_person_org`/`check_live_session_org` precedents) — this is
the one that actually closes the direct-insert path, since the RPC-level check
alone wouldn't have. Also added a self-merge guard (`p_kept_id = p_merged_id`
previously unlinked and deleted the person with no error — a destructive
no-guard bug, not a true no-op).

**A second, independent finding from `offline-sync-auditor`**: `registry.js`'s
original `registerPerson` comment claimed "two different phones with the same
email are a real, accepted scenario... not a duplicate to silently merge" —
but the frozen schema's own `people (org_id, lower(email)) where email is not
null` unique index (§5.1, copied verbatim in T1.1) contradicts that: a second
person with a colliding email would hit an uncaught `23505` from
`createPerson`, worse than either alternative the comment considered. Since
the constraint is frozen spec, not a bug, the fix was to correct the code, not
drop the index: `registerPerson` now checks `findPersonByEmail` as a fallback
before creating, so the constraint should never be hit in the normal
registration flow. Same review also caught `findPersonByEmail`'s unescaped
`ilike` treating a literal `%`/`_` in an email as a wildcard (low severity,
zero call sites at the time) — fixed with `escapeLikePattern()`, and the fix's
correctness against Postgres's actual LIKE semantics (including a literal
backslash adjacent to a wildcard character, a case the JS unit tests alone
didn't cover) was independently confirmed against the live database during
re-verification, then backfilled as its own unit test.

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
