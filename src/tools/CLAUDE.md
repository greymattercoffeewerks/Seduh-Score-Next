# src/tools/ — standalone free community tools

Root non-negotiables apply here too, but — same as `src/marketing/` — this directory
sits outside the module boundary the rest of them are written around: it isn't a format,
and it isn't part of the console app. Treat the boundary rule's _spirit_ (don't leak
assumptions between things that shouldn't share them) as binding; the letter of
"core vs. formats" doesn't map cleanly onto a third kind of surface.

## What this is, and isn't

Small, self-contained, general-purpose utilities — no auth, no Supabase, no event/heat/org
concept, no router, and deliberately not scoped to any one activity (cupping, brewing,
competitions — whatever someone needs it for). Same principle as the legacy Seduh-Score
site: some tools are free-standing gifts to the community, not gated behind the product.
Each tool gets its own subdirectory here and its own HTML entry under `tools/<name>/` at
the repo root (see `vite.config.js`'s `build.rollupOptions.input` — a new entry there is
required for the production build to include it, same as `src/marketing/`'s own routing
note).

A tool here MAY import from `src/core/` when a piece of it is genuinely format-agnostic
engine logic (e.g. `core/countdown.js`, `core/dom.js`, `core/duration.js`, and `core/feedback.js` for the Petrol feedback ladder, e.g. the Timer's confirm-before-Reset) — that's the
same direction `src/marketing/` already imports in, and `core/` has no reverse
dependency on either. A tool may also import `src/community/toolChrome.js` and `communityTools.js` (the shared tool frame; the Random Selector first), which in turn reads `src/marketing/publicHeader.js`; that is the one allowed path from a tool into `marketing/` and `community/`, and it carries the header's `COUNTRY_PAGES_PUBLIC` switch. A tool here must never import from `src/formats/` — pulling in a
format's UI classes (e.g. Cup Taster's `.screen-container` in `heatsScreen.css`) would tie a
supposedly standalone tool to one format's presentation, so each tool keeps its own
self-contained CSS instead. (One reasoned exception, 2026-11-28: the Throwdown Bracket Planner, which lives in `src/community/throwdown-planner/` and reads three pure Throwdown modules; see its `CLAUDE.md`. Nothing else may.)

## Tools

- `random-selector/` (`randomSelector.js` pure engine + storage + share-link codec,
  `randomSelectorScreen.js` DOM, `randomSelector.css`, `main.js`), 2026-10-14 — a free
  **Community tool** at `/tools/random-selector/` (card 05 on the Community hub; no account, no
  auth, no Supabase, not tied to any event or format): a split-flap board that draws one entry
  from a list, for competition running orders, prizes and lucky draws. Entries are one per
  line with an optional `| weight` (integer 1 to 1000, at most 80 entries); a share link
  (`?draw=`) carries the list and settings; CSV import/export; a Present mode for projecting
  the board; a draw history; optional "remove every selected entry".
  First built by Codex (branch `codex/split-flap-picker`), then reviewed (code, module-boundary,
  test and accessibility reviewers), fixed and tested by Claude. Pinned rules:
  - **Fair draw.** `weightedIndex()` uses `crypto.getRandomValues` with rejection sampling
    (no modulo bias). The winner is picked as an _entry object_ before the board starts
    spinning, and every list control is disabled (and `updateEntries` and the typing path
    ignore input) until it lands, so editing mid-draw can neither strand the spinner on
    DRAWING nor award a different entry than the one drawn. `finishDraw` settles the
    spinner first, and the sound code (`createTicker`) can never throw out of `unlock()` or
    `tick()`: sound is a courtesy, never something a draw depends on. Tests pin the
    rejection tail, the weight distribution, the winner-to-result wiring and removal of
    exactly the drawn entry (by stubbing `crypto.getRandomValues`), not just "one of the names".
  - **No flashing (WCAG 2.3.1) and reduced motion.** While drawing, ONE COLUMN of flaps turns
    over per tick, sweeping across the board (`sweepColumn`), so no flap changes more than
    about once a second at any preset, in Present mode too (measured in Chromium: at most
    1 change per flap per second). The flip animation is a one-shot `.is-flipping` class that
    exists only under `prefers-reduced-motion: no-preference`; a test checks, by brace
    counting, that no animation or `@keyframes` exists outside that block. With "reduce" the
    board holds on `DRAWING`, and the sound, if on, keeps its rhythm. The earlier version
    replaced the whole board about ten times a second, which a reviewer rated a probable
    2.3.1 failure.
  - **Screen readers and focus.** `render()` tears the whole screen down, so anything a
    screen reader must hear lives _outside_ that subtree: one persistent polite live region
    (`setNote()`) announces drawing, the result and every status message (an identical
    repeat alternates a trailing no-break space so it is announced again). The board is
    `role="img"` named from the draw state, never from the shuffling flaps. The draw
    button uses `aria-disabled`, not `disabled`, and is NOT rebuilt per tick (a test pins
    node identity), so focus survives the spin and a screen reader is not re-told "DRAWING"
    ten times a second. KEEP RESULT and REDRAW hand focus to the draw button (their panel
    disappears). The sound toggle has no `aria-pressed` (its label already says "SOUND
    ON"), the same call `core/dom.js`'s `passwordToggle` makes.
  - **Editing never replaces the control in use.** Typing in the entry list does not
    re-render at all (`onEntriesInput`): it refreshes the counts, the weight rows, the draw
    button state and removes a stale result panel, in place, so an IME or predictive
    keyboard composition and a phone's soft keyboard are not interrupted. Weights, board
    title, accent colour and volume also commit **in place**: a rebuild there sent Tab to
    `<body>`, dropped a slider drag and swallowed the click that blurred the field. The entry
    list is one long-lived `<textarea>` moved into each fresh tree on the other renders
    (caret, selection and scroll are restored). Every other control carries a
    `data-focus-key`.
  - **Space draws only when nothing has focus**, with no modifier and no auto-repeat, and
    only calls `preventDefault` when a draw actually starts.
  - **44px targets** at 360px (`--tap-target-min`), brand link included; the checkbox keeps a
    24px box inside a 44px label row. Inputs and presets use `--color-border-strong`
    (the plain border token is under 3:1); the selected preset has a dark ring that does
    not depend on the accent; no text is below 12px; the page does not scroll
    horizontally at 200% text (the volume row, preset list, top bar and panel heading wrap).
    Present mode raises `--color-text-muted` to the secondary token (4.46:1 was short of AA).
  - **The user-chosen accent is never a text colour** (a pale one would vanish on the paper
    surface): the sound toggle's ON state is bold with an accent-coloured underline. Text
    _on_ the accent (primary button) is `readableOn()`, pure black or white by WCAG relative
    luminance; a test samples 512 colours and pins at least 4.5:1, and known-answer tests pin
    the contrast formula itself. Pure black, not the page's near-black, because only pure
    black keeps the mid-tone worst case above 4.5:1.
  - **CSV is real CSV** (`parseCsv`, `entriesFromCsv`, `entriesToCsv`, all pure and tested):
    quoted cells hold commas, doubled quotes and line breaks; CRLF and a byte-order mark are
    accepted; a header row is skipped; the second column is the weight. Export is built on
    `core/export.js` (`buildCsv`, `downloadCsv`), not a second writer, with a BOM so Excel
    reads UTF-8, and names starting with `= + - @` get a leading apostrophe that import
    removes, so an export round-trips exactly and a hostile share link cannot plant a formula.
    A name never spans lines (line breaks collapse to a space), and `formatEntries` writes an
    explicit weight after a name that itself ends in `| 5`, so the list reads it back
    unchanged. A file with no usable entries leaves the current list alone, and a file over
    `MAX_ENTRIES` (80) says "Imported 80 of 90 entries".
  - **Share links.** A `?draw=` link that cannot be read says so and loads the visitor's own
    list; a shared list still takes the visitor's saved sound setting; the note says the
    shared list replaces the visitor's saved one as soon as they edit or draw. "Copy share link"
    checks the link decodes before saying "copied" (the practical ceiling is about 8,900
    ASCII characters of list, lower for CJK; the 10,000 in the codec is unreachable behind the
    12,000-character link cap).
  - **Storage.** `browserStorage()` guards the read of `window.localStorage` (it can throw);
    corrupt saved history records are dropped on load. REDRAW after "remove every selected
    entry" puts the entry back where it was and drops its history row; history numbering
    keeps counting past the 20 kept.
  - **Tier 1 redesign (2026-11-19), the owner-approved canvas; the rules below supersede older wording in this
    section** (button names, `cut-lg`, mono labels, CLEAR SESSION / LOAD EXAMPLE LIST, the top-bar count).
    - **Layout.** Left column: board, then the draw row (checkbox "Remove winners after each draw" left, "or press Space" +
      Draw right), then the winner card. Right panel: the shared tablist (`core/tablist.js`, so `role="tab"` stays in one
      file) with **Entries (count)** and **History (count)**; both panels stay in the DOM and switch with `hidden`, so the
      long-lived textarea is never moved by a tab change. Entries holds the list, Import CSV / Export CSV / Clear list, the
      status line with Undo, three collapsible sections (Weights & odds, Draw settings, Board look; closed by default, each
      with a one-line summary kept in step by `refreshSummaries()`; open state is `state.open`, not saved) and Copy share
      link. **There is exactly one entry count: the tab badge** (no top-bar count, no "loaded"). It stacks below 700px,
      where the Draw button is `position: fixed` at the bottom (safe-area padding; `.rs-page` pads its bottom so nothing
      hides under it).
    - **Names are centred** (`boardCells`, exported and tested): each row across the 14 flaps, the block of rows down the 4
      (one line on row 2). Word wrap and the ellipsis rule are unchanged.
    - **Present mode** fits a 16:9 screen with no scrolling: `--rs-cell-h` is the smaller of what the height and the width
      allow, and `.rs-page.is-presenting` is `100dvh` with `overflow: hidden`. Measured at 1440x810, 1280x720 and 1920x1080
      (everything above the viewport bottom, no page scroll). It adds **Fullscreen** (Fullscreen API on `.rs-page`; the button is
      absent where `document.fullscreenEnabled` is false, e.g. iPhone) and the exit button reads "Exit (Esc)". Leaving Present
      leaves Fullscreen. "Remove from list" is not offered in Present (it is a list edit).
    - **One button family** (`base.css`): Draw is `.action .action-primary .btn-bevel` on the accent (`--rs-accent`, which may be
      the visitor's colour, text `readableOn`); Keep result is `.action-primary`; Discard & redraw, Remove from list, Import,
      Export, Copy share link, Present, Sound, Fullscreen, Exit, Undo and Reset colour are `.action-outline`; Clear list is a quiet
      danger text button (`.rs-quiet-danger`); the three speeds are one segmented control (selected = ink fill, never the
      accent). No underlined text-buttons for actions.
    - **Fonts.** `--font-body` for buttons, tabs, labels, text and inputs; `--font-display` for headings and the winner's name;
      `--font-mono` ONLY on `.selector-flap` and `.rs-history-n` (a test lists the selectors that may use it).
    - **No grid lines, no cut corners.** The page background is the plain canvas; the board frame is `--radius-lg`, flaps
      `--radius-sm` (`tokenDrift.test.js` `DIRECT_RADIUS` is now 3 for this sheet).
    - **Copy** is the System artboard's table: "History", "No draws yet. Winners appear here, newest first.", "Winner · draw N",
      "Still in the list, so NAME can be drawn again." / "Removed from the list, so NAME cannot be drawn again.", "Discard &
      redraw", "Draw", "Names, one per line" + hint "Give a name more chances: write `Bella | 2` for double odds.", "Reset colour"
      (shown only once a colour is picked). **Kept, on the owner's say (2026-11-19):** the Load example list button stays, as an outline button between
      Export CSV and Clear list, with its one-level Undo. **Removed on purpose:** the "SAVED WITH SHARE LINK" line. **New:** "Remove from list"
      (`removeWinner`) takes the winner's line out now, marks its history row removed, and Discard & redraw still puts it back.
      The default board title is "Player draw" (shown upper-case by CSS; an older saved "PLAYER DRAW" still works).
    - **The frame is shared, not local** (`src/community/toolChrome.js` + `toolChrome.css`): the public header
      (Community Tools current), a breadcrumb "Community Tools / <tool>" whose row also holds the tool's own controls
      (`controls` slot), the tool, a "More free community tools" strip and a footer line. The strip and the hub's cards both read
      `src/community/communityTools.js` (pure data; `otherCommunityTools(id)` leaves a tool out of its own strip and never offers
      the widget download), so a name or pitch changes in one place. `setPresenting(true)` hides the header, breadcrumb, strip and
      footer and keeps the controls row. The Timer, Brew Planner and Guess the Bean's organiser page adopted it on 2026-11-19 with no change to the
      frame's look (the Timer hides all of it, bar included, in its countdown mode via `setPresenting(true, { keepBar: false })`; Guess the Bean's
      play and live-display pages have no frame). The hub's cards and the strip's cards are one renderer, `src/community/toolCard.js`. Link `publicHeader.css`, `toolChrome.css`, then the tool's sheet.
      The prerender marker is now `Split-flap edition` (footer, in `prerender-public-pages.mjs` and `smoke.spec.js`).
  - **Petrol (2026-10-14).** The tool follows the design system (`src/ui/tokens/DESIGN.md`):
    every colour in the stylesheet is a `--clr-*` / `--color-*` token (the first version had a
    brown wood frame and a dozen hard-coded hex values), the board frame is graphite with teal
    rails (square-cornered then; see the Tier 1 note above), the primary actions (DRAW ENTRY, KEEP RESULT) are the accent
    with the soft bevel (`.btn-bevel`, Petrol V2 P2; no `clip-path`, so no focus workaround), and there are no shadows. With no custom accent the tool uses the Petrol accent
    token (`PETROL_ACCENT_HEX` only fills the colour picker), so Present mode gets the stage
    teal for free; `accentColor` is `null` for that, a picked colour still wins, "USE PETROL
    ACCENT" goes back, the old built-in default `#0fb5a3` means "no custom accent", and a share
    link without an accent overrides a saved one. The board's status shows the shared
    `.status-live-dot` pulse while drawing and a static blip otherwise.
  - **The weights list** is three aligned columns (entry, weight, odds) under sticky heads, rows
    a fixed 3.5rem with the 44px weight box 6px clear of the row lines, each entry's share as a
    bar plus an exact percentage (updated in place; the bar is dropped on a phone), and a list
    exactly the heads plus five rows tall so no row is cut in half. **The number is centred
    in the box by measurement**: a number field reserves room for its up/down arrows even while
    hidden, which pushed the centred number 7.5px left, so the arrows are removed (Up/Down keys
    still step; `inputmode="numeric"`). Re-measured in pixels at 1280, 1024, 700 and 360px for
    1, 7, 12, 100 and 1000: the ink's centre is within 0.16px of the box centre; a stylesheet
    guard pins the rules.
  - **Nothing is dropped or changed silently** (`checkEntries`, `describeEntryProblems`): a line
    under the list (and the live region, once per change) says when entries are past the
    80-entry limit, a line holds only a weight (`| 3`, "skipped"), or a weight outside 1 to 1000
    (negative too) was changed ("Changed: “Amir” (0 → 1)"); the weight box says the same when it
    clamps or reverts a number. The warning is tied to the list with `aria-describedby`. Editing a
    weight or removing a drawn entry changes only that entry's line of the typed list
    (`replaceDraftLine`, `removeDraftLine`, `insertDraftLine`), so blank lines, nameless lines and
    entries past the limit survive; the old code rewrote the whole list from the parsed entries
    and lost them. **One line parser (`parseLine`) decides what an entry line is**, for
    `checkEntries` and the positional edits alike; two predicates drifted apart once, and a
    nameless line then made REMOVE AFTER DRAW delete the wrong line and leave the winner in.
  - **CLEAR SESSION, LOAD EXAMPLE LIST and a CSV import can be undone** (one level): the
    status line shows UNDO, which restores the list, the history and the board; it goes away
    when the list is edited, a weight is changed, a draw starts or a different note replaces the one
    that offered it; pressing CLEAR or LOAD EXAMPLE again when it changes nothing keeps the first
    UNDO (an empty-on-empty snapshot used to overwrite it). The button is named "Undo: clear
    session" and the live region says "Undo is available". (Chosen over a confirm box,
    which is intrusive on a projector.) A CSV over 1 MB is refused before it is read; Escape
    leaves Present mode.
  - `core/export.js` revokes a download's object URL after `REVOKE_DELAY_MS` (1 s), not at the
    click (Safari can cancel such a download); `downloadCsv` and `downloadJson` share one
    `saveBlob`, and the tests hold the revoke back to prove it is not done at the click. Guess the Bean's
    session export (`src/community/guess-the-bean/setupScreen.js`) now calls `downloadJson` too.
  - **Public entry points (2026-10-14):** listed in `public/sitemap.xml`, prerendered by
    `tools/prerender-public-pages.mjs` (root marker `<main class="random-selector"`, copy
    `Split-flap edition`) and asserted in `tests/e2e/smoke.spec.js`.
  - Persists to `localStorage` (`seduh-random-selector-v1`).
  - **Reviewer follow-ups (2026-10-14, not done, outside this tool):** Candidates to move into `core/`: the AudioContext click shared with the Timer,
    `browserStorage()` (the other tools' storage defaults still read `window.localStorage`
    unguarded), `parseCsv`, `weightedIndex`, and a `button()` helper. The CSV formula guard is
    only in this tool; putting it in the shared `buildCsv` would change Cup Taster's CSV for names
    starting `= + - @`, so it needs an owner decision. Announcing the out-of-range warning on every
    keystroke is chatty for a screen reader, and a weight changed on load (`Amir | 0`) cannot be
    cleared from its weight box (typing the same number fires no event); both left as they are.
  - **Open items (not yet done):** the AudioContext set-up is a near-copy of the Timer's (no
    shared helper in `core/` yet); the paper surface never follows `prefers-color-scheme`
    (Present is the only dark surface); the flash rate was measured, not run through a flash
    analyser; no real screen reader (NVDA, VoiceOver, TalkBack) has been used on it; the caret
    test proves identity in jsdom only, so a Playwright check of the caret in a real browser is
    still owed; a weight of `0` is read as 1 (now said out loud, but "0 means sits out" would be
    a feature, not a fix). The licence of `public/sounds/split-flap-click.mp3` was confirmed by
    the owner on 2026-10-14 ("no problems with the licence"); where the file came from is not
    recorded in the repo.

- `brew-planner/` (`planner.js` pure engine, `plannerState.js` wizard state + storage,
  `brewPlannerScreen.js` DOM, `brewPlanner.css`), 2026-09-29 — a five-step wizard (Heats,
  Coffees, Machines, Timing, Cheat sheet) that turns a batch-brew setup into a run-sheet
  with tick boxes and machine/heat filters, a timeline, a heats table, and water and Cambro
  sizing. Ported from a one-off Cup Taster 2026 schedule; `EXAMPLE_CONFIG` reproduces its
  numbers (76 batches, first brew 12:13 pm, longest hold 44 min) and is pinned by
  `planner.test.js`. Water per batch is dose × ratio; yield is dose × ratio − 2 × dose.
  Batches are scheduled backward from each heat's pool-by time. Ticks and inputs persist
  to `localStorage` (`seduh-brew-planner-v1`). No auth, no Supabase; a free **Community
  tool**, listed as card 04 on the Community hub, and in `public/sitemap.xml`,
  `tools/prerender-public-pages.mjs` and `tests/e2e/smoke.spec.js` (as the Random Selector now is).
  Extended 2026-10-07: one paper filter per batch (`FILTERS_PER_BATCH`), counted in total,
  per stage and per machine; Cambros in three nominal sizes (1.5, 2.5 and 4.75 US gal)
  counted at 85% fill (`CAMBRO_MAX_FILL`), where `containersNeeded()` is the single split
  rule; the sample coffees are Coffee A/B/C (no real coffee names in the public example).
  **`holdLimitMins` is advisory** (user decision, 2026-10-07): it drives the "over limit"
  warning only, the scheduler does not enforce it. 36 tests across `planner.test.js` and
  `brewPlannerScreen.test.js`. Known and deferred: timeline and inputs are not linked to
  field-level errors; the Cambro size table scrolls about 14px at 360px.

- `timer/` (`timer.js` pure state/logic, `timerScreen.js` DOM/wiring, `timer.css`),
  2026-09-12 — a standalone, general-purpose countdown timer (duration presets + custom
  duration, optional label) for anything someone is timing, not scoped to cupping.
  Originally built and named as a "Cupping Timer" with cupping-specific presets and copy;
  renamed the same day (user decision) — "Cupping Timer" read narrower than intended to
  anyone encountering it cold, and this is meant as a general free tool, usable for a
  competition heat, a brew, or anything else, same as it's usable for cupping. Files,
  identifiers, CSS class prefixes (`timer-*`, was `cupping-timer-*`), and the
  `localStorage` key (`seduh-timer-v1`, was `seduh-cupping-timer-v1`) were all renamed
  together in that pass — no "cupping" left in code or copy, only in this history note.
  Built in response to a real gap in the console's own
  `formats/cup-taster/timingScreen.js`: that screen's countdown is correct
  (`core/countdown.js` recomputes from wall-clock time, so a backgrounded tab never
  actually drifts) but LOOKS frozen while backgrounded, since `setInterval` itself is
  throttled by the browser — this tool adds what that screen didn't have: a Wake Lock
  request while running (keeps the screen from sleeping while it's counting down;
  feature-detected, degrades silently where unsupported — Wake Lock auto-releases when
  the tab hides per spec, so `timerScreen.js`'s `visibilitychange` handler re-requests it
  on return, not just re-syncing the display), a `document.title` update while hidden so
  the remaining time is visible from the tab bar without switching back, a blinking
  `[data-urgent]` state in the final 10 seconds (gated on `prefers-reduced-motion`, same
  "layer motion on top of a static base state" pattern `src/ui/tokens/base.css`'s
  `.status-live-dot` already established — color is never the only urgency signal here
  either, matching `timingScreen.css`'s own precedent), and a WebAudio beep at zero (no
  audio asset shipped; the `AudioContext` is created/unlocked from the real Start-button
  click to satisfy browser autoplay-gesture policies, then reused for the later,
  gesture-less expiry beep). A persistent visible "Time's up" banner (`role="alert"`,
  focus moved to it) and a sustained (non-blinking) strong visual state carry the same
  signal for anyone who can't hear the beep — sound is never the only cue. State
  (title/duration/running-or-paused/expired) persists to `localStorage`, so a reload
  resumes correctly for the same reason a backgrounded tab does — it's just
  `(startedAt, durationSecs)` recomputed against `Date.now()` again, the identical trick
  `core/countdown.js` already proves drift-free. Linked from the marketing landing page's
  nav and footer (`src/marketing/landingScreen.js`, same 2026-09-12 pass) — Seduh Score's
  own brand mark + wordmark render at the top of the timer page itself, linking back to
  `/`, since a free public tool is deliberate promotion for the product, not an
  anonymous utility. Deliberately NOT integrated into
  `formats/cup-taster/timingScreen.js` — revisit once this tool has proven itself
  standalone; the console's own timing screen still uses its original, RPC-driven,
  real-clock-derived countdown untouched.
