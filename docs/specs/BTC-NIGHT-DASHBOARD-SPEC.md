# BTC event dashboard, night edition: spec

_Draft 2026-11-26, for the owner's review before the build. Concept:
https://claude.ai/artifact/9geRwZvje6uCNiJyVB6C7W (artboards `Main` desktop, `Phone`). PDS proposal:
`design/pds-night-concept-proposal.md` in the project files._

## What this is

The BTC event dashboard (`src/formats/btc/eventDashboardScreen.js`, Organiser UX S2) already exists as a run sheet.
This work re-lays it out as the concept shows and lets it run at night: the same markup is `data-surface="stage"`
(night) or `paper` (day), on Petrol tokens only. No new colours, no new database door.

## Scope

**Phase 1, this PR (no migration, no RPC, no new reads):**

1. **Surface.** The organiser console may be `data-surface="stage"`. A switch (day / night / follow the device) lives in
   the console's top bar, remembered per device in `localStorage` (wrapped in try/catch; page works without it).
   Default stays day, so nothing changes for anyone who does not touch it.
2. **Chrome.** Side menu and top bar sit one step off the canvas (`--color-chrome`, from the PDS thread).
3. **Needs you.** The existing `buildEventWarnings` list drawn as the `.queue` part: severity edge plus one action per
   row, most urgent first. Same data, same words; no new warnings.
4. **Run-sheet strip.** The six phases as one strip with a `.meter` each, replacing the stack of phase cards on wide
   screens; on a phone it is a vertical list. Same `deriveBtcPhases` data. The "next step" card stays on top.
5. **Standings with the cut line.** Top of the table from data the page already loads, with the dashed cut rule
   between ranks 8 and 9 once the cut applies. If the standings read is not already loaded, this is a later phase.
6. **Freshness and connection.** Quiet "Updated HH:MM" in the top bar; a full-width "Connection lost" bar when a load
   fails while results are on screen (the 4.29.0 audience bar's organiser twin). `is_test` keeps its banner, unmistakable
   in both surfaces (D9).
7. **Live numbers in mono**, tabular, at or above `--text-2xs`. Phone width first (360px), tap targets 44px.

**Phase 2, only if the owner wants it (needs a live feed to the organiser, so a design decision first):**
the "On stage now" hero with a ticking service timer and judge-sheet pips, "watching on phones" count, "running N min
behind plan". None of this is on the page today: the timer lives on the timing surface and the phones count has no
read. Phase 1 shows "Next to score" (first unconfirmed match) in the hero slot instead, with no ticking clock.

## Not doing

Grid backdrop behind the hero; per-viewer accent tweak (PDS has `data-brand`); any change to scoring, ranking, the cut
or the outbox; Cup Taster and Throwdown dashboards (they can adopt the same parts later; the parts are format-agnostic).

## Module boundary

Anything a second format would reuse (the queue row, the strip, the cut-line class, the surface switch) lives in
`src/core/` and `src/ui/tokens/`, takes data through arguments and names no phase. The BTC file only maps its
derivation onto them. `module-boundary-checker` runs on the result.

## Dependencies on the PDS thread

I use its token names as they land and add none of my own: `--clr-petrol-975`, `--color-chrome`, `--tracking-caps`,
`.eyebrow`, `.queue`, run-sheet strip, cut-line class, and the sentence making stage a legal organiser surface. Until
that PR is on `dev`, this branch carries a clearly marked temporary copy of any it lacks, removed when it lands.

## Acceptance

- Same page at night and day with no per-surface CSS in `src/formats/btc/`; text 4.5:1 in both (new `--color-chrome`
  pairs measured in the PDS PR, not assumed).
- 360px first: no horizontal scroll, strip becomes a list, tap targets 44px, focus rings not clipped.
- Reduced motion respected; no state told by colour alone.
- Existing `eventDashboardScreen.test.js` still passes; new tests for the surface switch (storage blocked still works),
  Needs-you ordering and the connection-lost bar.
- Reviews: `code-reviewer`, `module-boundary-checker`, `test-auditor`, `ui-accessibility-reviewer`; `kb-sync` closes.

## Questions for the owner

1. Is Phase 1 enough for the March pitch, or do you want the live "On stage" hero (Phase 2) as well?
2. Night as a switch the organiser chooses (proposed), or follow the device automatically?
3. Should the standings panel wait for the cut rules (open committee points), or ship showing points only?
