# src/formats/cup-taster/ — Cup Taster format

Root non-negotiables apply here unconditionally. This module may freely import from
`src/core/`, but never the reverse — see
[the repo root CLAUDE.md](../../../CLAUDE.md) for the full non-negotiables list and the
delegation table. This is also the reference implementation for the module-boundary test
("can a future format reuse `src/core/` without editing it?") — when Throwdown/Liga
Seduh/BBTC start, this file is the worked example of what "format-specific" actually
looks like in practice.

Scoring, timing-surface, entry-surface, viewer-body, analytics — Cup Taster-specific,
built on `core/`.

## Module history

`setup`, `setupScreen` (T4.1) — `validateStagePlan` generalized to an arbitrary
stage-kind chain rather than two fixed sequences; `saveStagePlan` reconciles
add/remove/reorder/edit against what's persisted, refusing the whole save if it would
touch a stage that already has heats; the screen itself shipped 2026-08-27, closing
T4.1's own original no-UI gap. `rosterScreen` (also 2026-08-27, separate follow-up) —
closes T4.1's OTHER no-UI gap: register/list/withdraw cuppers, built on
`core/registry.js` unedited.

`heats`, `heatsScreen` (T4.2 — first real UI screen in the project). `heatsScreen` gained
a resumability follow-up (2026-08-29, closing a known ROADMAP.md gap) — `heats.js` itself
is untouched (`generateHeatsManual`/`buildHeatPlansFromAssignments` were already
idempotent and conflict-checked); `renderManualAssignmentForm` gained an optional
`existingAssignments` map (an already-placed cupper renders as fixed text, not an
editable input) and a new `buildManualForm` closure re-attaches each already-placed
cupper's real assignment before calling `generateHeatsManual`, so its "every stage entry
assigned exactly once" check still passes without asking the organiser to re-type
anything; the manual form is now also shown when generation is incomplete, closing the
"no repair path" gap purely as a UI-availability fix.

`timing`, `timingScreen` (T4.3 — first live/ticking screen); `timingManual`,
`timingManualScreen` (T4.4 — manual mode, `timing.js` exports shared helpers both timing
modes reuse); both were direct-write until a 2026-08-29 follow-up routed every write
(start a heat, a real tap, a manual entry/correction, an auto-max sweep) through the
outbox via three new RPCs (`start_heat`/`record_heat_time`/`auto_max_heat`, migration
`20260828150000`) mirroring `confirm_heat`'s idempotent, org-scoped shape — `timing.js`
gained a shared `timingHandlers(client)` map (used by every flush in both modules, since
`core/outbox.js` registers handlers per `flushOutbox()` call, not globally) and a
`buildRecordHeatTimePayload()` helper shared by `recordTap`/`recordManualTime`;
`timingScreen.js`/`timingManualScreen.js` gained a "ground truth over flush bookkeeping"
pattern (`pendingHeatCheck`/`pendingEntryCheck`) comparing a fresh reload against the
exact value a write attempted, not a bare null-check — a real concurrency bug (two
concurrent taps for a heat's last two entries could both miss the advance-to-scoring
flip; a first fix attempt then left a narrower stale-read gap under lock contention) was
found and closed during review, verified with real concurrent psql sessions, not just
pgTAP — see CHANGELOG.md/ROADMAP.md for the full account, including a related gap the
same review surfaced, closed in a separate 2026-08-29 follow-up — see
[src/core/CLAUDE.md](../../core/CLAUDE.md) (`outbox`) and `outboxHandlers` below for
`buildRpcHandler`/`cupTasterOutboxHandlers`.

`heats.js` gained a DB-level `unique(heat_id, station)` constraint follow-up (2026-08-29,
migration `20260829100000`) closing a known ROADMAP.md gap — `ensureHeatEntries`'s new
`isStationConflict()` helper distinguishes a station collision (two different cuppers
racing for the same station — fails fast, never retries) from an `entry_id` collision
(the pre-existing, safe-to-retry race recovery path, unchanged), told apart by matching
"station" in the Postgres error's DETAIL/message, verified against a real violation via
docker exec; `schema-guardian` caught the migration's own first version relying on a
plain unique alone, which gives zero protection when `station IS NULL` — the added
`alter column station set not null` is what actually closes the gap, fixed in the same
migration since it was still local-only and unpushed.

`scoring`, `scoringScreen` (T4.5) — three-state toggle + strict confirm; the whole heat
is submitted as ONE outbox operation through the existing `confirm_heat` RPC — first
format module to use `core/outbox.js`'s `.permanent` error-flag contract, and the pattern
T4.3/T4.4 followed above; gained an exported `confirmHandlers(client)`, 2026-08-29
follow-up, mirroring `timing.js`'s own `timingHandlers` — see `outboxHandlers` below.

`outboxHandlers` (2026-08-29) — the composition point closing the cross-module
handler-map gap: exports `cupTasterOutboxHandlers(client)`, spreading
`timingHandlers`/`confirmHandlers`/core's `publishHandlers` into one map every real
screen call site now passes as an optional `handlers` override, so a flush triggered from
any of `timingScreen.js`/`timingManualScreen.js`/`scoringScreen.js` can process any of
the 5 queued Cup Taster operation types, not just its own; deliberately not imported back
into `timing.js`/`scoring.js` themselves, which would be circular — see
CHANGELOG.md/ROADMAP.md for the full four-reviewer account.

`standings`, `standingsScreen` (T4.6) — ranking/advancement/tiebreak/coin-toss, direct
writes like T4.2; `heats.js` gained a generalized `kind` parameter for tiebreak heat
creation.

`analytics`, `reportScreen` (T4.7) — per-stage difficulty/distribution, gated on the
whole event being complete; no partial-data report. `reportScreen.js` also gained T4.8's
export actions (CSV download + print).

`viewerBody`, `phoneSummary` (T5.4) — the shared `renderBody` `core/viewer-shell.js`
mounts once real content exists: standings table, active-heat panel with per-cupper
status chips, recent-results list; content shape ported from the legacy v4.x app's own
never-shipped-standalone audience view. Deliberately Cup-Taster-specific per the handoff's
own module table, meant to be shared unedited by T5.3's projector. `phoneSummary.js` is
the thin phone-specific composition, `showChrome: true`. `viewerBody` extended with a
live countdown for an active app-mode heat, T5.3 — `core/countdown.js` + `core/duration.js`,
mirroring `timingScreen.js`'s own tick pattern; reuses `core/ranking.js`'s
`chainComparators` for the recent-heats sort rather than hand-rolling one;
`mountViewerBody` returns an optional cleanup function per `viewer-shell.js`'s own
contract. `projectorSurface` (T5.3) — the thin projector-specific composition,
`showChrome: false`, `data-surface="stage"` set on the caller's own root; reuses
`viewerBody.js` completely unedited, per the handoff's own module table.

`demoActiveHeatPayload` (2026-08-28, closing the handoff's cross-surface Playwright AC)
— `buildActiveHeatPayload()`, extracted from `phoneSummary.preview.html`/
`projectorSurface.preview.html`'s near-identical inline demo builders on its 2nd verbatim
use; demo-only, not part of the shipped module graph, imported only by those two
`*.preview.html` files and by nothing else.

`eventDashboardScreen` (2026-08-30 app-wiring pass) — per-event hub the organiser lands
on after picking an event: `is_test` banner, Setup/Roster/Report links, one card per
stage (labelled "Heats" or "Generate heats" per `stageHasHeats`, plus Standings), a
zero-stages empty state pointing at Setup. Lives here not `core/` — reads `ct_stages` via
`setup.js`, genuinely format-specific. `timingRouteScreen` (same pass) — thin dispatcher:
one route entry for "timing" but two real screens depending on the heat's own
`timing_mode` (not knowable from the URL alone), so every heat-timing link stays simple.
`heatsScreen.js` gained the fix for two real gaps found scoping this pass:
`mountHeatGenerationScreen` was missing its `unmount()` return entirely (every other
screen already had one), and its "generation complete" heats list had no links into
Timing/Scoring at all — new `heatActionLink()` closes both.

**A real gap found live-testing this same pass, NOT closed here**:
`core/router.js`'s `resolveSeq` staleness guard protects its own `current` bookkeeping
only — it cannot stop a discarded-but-still-in-flight screen's OWN internal DOM writes
(every screen here's own `attemptLoad()`/`render()` pattern) from landing after a newer
navigation already mounted something else. Closing it means retrofitting every one of
these ~10 screens' own load pattern with a cancellation check — out of scope for the
app-wiring pass that found it; see ROADMAP.md's "Known open items" for the account.
