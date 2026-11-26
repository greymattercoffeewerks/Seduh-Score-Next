# BTC event dashboard, night edition: spec

_Draft 2026-11-26, updated the same day with the owner's answers (see "Decisions"). Concept:
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
5. **Standings with the cut line.** Built from the seeding read the page already makes (`seedingRows`, advisory):
   the top 8 and two below, the `.cutline` after 8th, "N more teams below", and the label "Draft. The organiser
   confirms the cut on the Standings screen." If that read failed the card says so; it never draws a guessed order.
   When 8th and 9th are level on points, a note gives the committee's rule (below). It is a preview: the real cut,
   the tie order and the sign-off stay on the standings screen.
6. **Freshness and connection.** Quiet "Updated HH:MM" in the top bar; a full-width "Connection lost" bar when a load
   fails while results are on screen (the 4.29.0 audience bar's organiser twin). `is_test` keeps its banner, unmistakable
   in both surfaces (D9).
7. **Live numbers in mono**, tabular, at or above `--text-2xs`. Phone width first (360px), tap targets 44px.

**Phase 2, later (owner: "not now, spec it so we can add it"):** see "Phase 2: the live On-stage hero" below.

## Decisions (owner, 2026-11-26)

1. **No live hero now;** write it up as a later phase (below). Phase 1 shows "Next to score" in that slot.
2. **Night is a toggle switch** the organiser chooses (not automatic). Built as `role="switch"` with On/Off in words.
3. **Standings ship now, as a draft preview.** The committee's rule at the cut: if 8th and 9th have the same
   score, the team with the **shortest cumulative preliminary time** goes through. The database orders by points and
   the organiser records the order of level teams on the standings screen (which shows each team's times), so the
   dashboard does not apply the time rule itself: it flags the tie and names the rule. Making the database apply the
   time rule automatically would be a scoring change (`scoring-auditor`, a migration) and is not part of this work.

## Phase 2: the live On-stage hero (not built)

What it is: the top of the dashboard shows the match on stage now: both teams, the service clock ("07:42 of
10:00") with a meter, judge-sheet pips (J1 to J4, lit as each sheet arrives), and "Up next" with its time.

Why it is not in Phase 1: the organiser page has no live feed. The clock runs on the timing surface, sheets arrive on
the scoring screens, and the page reads once on load. Likewise "watching on phones" has no read at all, and "running N
min behind plan" needs a planned schedule the event does not store.

What it needs, in order:

1. **A short investigation (no code):** what already carries the live match. Candidates are the live session
   snapshot the projector reads, and `btc_matches` plus its judge rows through a realtime subscription. Prefer a feed
   that exists over a new one.
2. **A read-only feed for the page,** with the same rules as the audience freshness bar: show the time it was last
   heard, say "Connection lost" when it stops, never tick a clock on stale data. The clock is derived from a start
   time, never counted by the page (one writer of `elapsed_secs` stays `clampElapsed()`).
3. **A pure `deriveOnStage(...)`** (teams, status, start time, sheets in, next match) with tests, then the hero drawn
   with Petrol parts only.
4. **Reviews:** `offline-sync-auditor` if it touches the outbox, `security-reviewer` if a new door or realtime policy
   is added, plus the usual UI pass.
5. **Optional, separate:** "watching on phones" needs a viewer count the audience screens do not report today, and
   a privacy decision (a count only, no identities). "Behind plan" needs a stored schedule. Neither blocks the hero.

Acceptance: the hero never shows a time it cannot vouch for; with no feed it falls back to "Next to score".

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
