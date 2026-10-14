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
engine logic (e.g. `core/countdown.js`, `core/dom.js`, `core/duration.js`) — that's the
same direction `src/marketing/` already imports in, and `core/` has no reverse
dependency on either. A tool here must never import from `src/formats/` — pulling in a
format's UI classes (e.g. Cup Taster's `.btn`/`.card` in `heatsScreen.css`) would tie a
supposedly standalone tool to one format's presentation, so each tool keeps its own
self-contained CSS instead.

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
  - **Petrol (2026-10-14).** The tool follows the design system (`src/ui/tokens/DESIGN.md`):
    every colour in the stylesheet is a `--clr-*` / `--color-*` token (the first version had a
    brown wood frame and a dozen hard-coded hex values), the board frame is graphite with teal
    rails and a `.cut-lg` corner, the primary actions (DRAW ENTRY, KEEP RESULT) are the accent
    with a `.cut-md` / `.cut-sm` corner that goes square while focused so the ring is not
    clipped, and there are no shadows. With no custom accent the tool uses the Petrol accent
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
    `saveBlob`, and the tests hold the revoke back to prove it is not done at the click.
  - **Public entry points (2026-10-14):** listed in `public/sitemap.xml`, prerendered by
    `tools/prerender-public-pages.mjs` (root marker `<main class="random-selector"`, copy
    `SPLIT-FLAP EDITION`) and asserted in `tests/e2e/smoke.spec.js`.
  - Persists to `localStorage` (`seduh-random-selector-v1`).
  - **Reviewer follow-ups (2026-10-14, not done, outside this tool):** Guess the Bean's JSON export
    (`src/community/guess-the-bean/setupScreen.js`) still revokes its URL at the click; call
    `downloadJson`. Candidates to move into `core/`: the AudioContext click shared with the Timer,
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
