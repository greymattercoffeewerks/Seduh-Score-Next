# Seduh Score Next — Design System ("Petrol")

_Tokens live in `colors.css`, `typography.css`, `spacing.css`, `motion.css`, `base.css` — import
`index.css`. This file explains the reasoning; the CSS is the source of truth for values._

_Reworked again (2026-09-13) — "Petrol" replaces "Cherry" (2026-09-11: chartreuse-green
accent, bottle-green-black neutrals, Bricolage Grotesque/IBM Plex Sans). Cherry itself
replaced "Editorial" for the same complaint now recurring a third time: fresh user
feedback on a marketing exploration built independently of Cherry — petrol-teal accent,
graphite ground, hard angular cuts, racing/telemetry motifs —
tested as clearly less generic-SaaS than Cherry's own rollout. This file ports that
exploration's palette and shape language into Cherry's proven architecture (one neutral
ramp, two surface modes, semantic-token symmetry) rather than inventing new structure._

## Scope of this rework

- **Full replace, rolled out gradually.** These tokens ship app-wide immediately — every
  screen already reads colors/type/spacing through `var()`, so swapping this file set
  re-themes the whole app in one step. Actually restyling each screen's own
  markup/CSS (beyond what free re-theming already covers, e.g. adding `.cut-*`
  treatments) happens format-by-format, not all at once.
- **Paper/stage dual-mode architecture: kept.** Petrol gets its own light "paper" mode,
  not just a single dark theme — same flip mechanic (`data-surface="stage"`), same
  symmetry rule (paper semantic colors are dark tones on white contrast; stage semantic
  colors are light tones on `petrol-950` contrast).
- **Accent: petrol-teal, coffee-cherry meaning dropped.** Cherry's accent was tied to a
  real piece of brand meaning (unripe coffee cherry). This rework trades that for an
  instrumentation/telemetry read (racing HUD, timing displays) — arguably just as
  on-brand for a _scoring_ product, but it is a deliberate meaning change, not just a hex
  swap.
- **Marketing page now imports these tokens directly**, unlike every previous
  identity — see `src/marketing/CLAUDE.md` for why that's a real architecture change,
  not a silent one.

## One neutral ramp, two surface modes (unchanged mechanism)

Still one neutral ramp (`--clr-petrol-50` through `--clr-petrol-950`, near-white to
graphite-black) shared by both surface modes, same as Cherry's cherry ramp was. Paper
uses the light end (organiser dashboard, phone entry); stage uses the dark end
(projector/audience, and the splash/promo screen). Every semantic color still obeys one
rule across both modes — paper-mode semantic colors are dark tones paired with a white
`-contrast`; stage-mode semantic colors are light tones paired with a `petrol-950`
`-contrast` — so `data-surface` still flips the whole palette with zero per-color
exceptions.

Every pairing below is checked against WCAG 2.1 contrast minimums (4.5:1 normal text,
3:1 large/headline text) using relative luminance:

| Pairing                                                     | Ratio  |
| ----------------------------------------------------------- | ------ |
| `--color-text` on `--color-canvas` (paper)                  | 15.1:1 |
| `--color-text-secondary` on canvas (paper)                  | 11.2:1 |
| `--color-text-muted` on canvas (paper)                      | 7.8:1  |
| `--color-accent` as text on canvas (paper)                  | 6.3:1  |
| `--color-accent-contrast` on `--color-accent` fill (paper)  | 8.1:1  |
| `--color-danger` on canvas (paper)                          | 8.0:1  |
| `--color-success` on canvas (paper)                         | 5.9:1  |
| `--color-warning` on canvas (paper)                         | 5.3:1  |
| `--color-text-secondary` on canvas (stage)                  | 7.2:1  |
| `--color-text-muted` on canvas (stage)                      | 4.5:1  |
| `--color-accent` as text on canvas (stage)                  | 10.4:1 |
| `--color-accent-contrast` on `--color-accent` fill (stage)  | 10.4:1 |
| `--color-danger` on canvas (stage)                          | 6.9:1  |
| `--color-success` on canvas (stage)                         | 9.6:1  |
| `--color-warning` on canvas (stage)                         | 9.1:1  |
| `--color-gold` on canvas (stage — its one real use context) | 8.4:1  |
| `--color-border-card` vs canvas (paper), a 1px edge         | 3.4:1  |
| `--color-border-card` vs canvas (stage), a 1px edge         | 4.5:1  |
| `--color-accent-tint-text` on `--color-accent-tint` (paper) | 9.0:1  |
| `--color-text` on `--color-accent-tint` (paper)             | 17.1:1 |
| `--color-accent` as text on `--color-accent-tint` (paper)   | 7.2:1  |
| `--color-accent-tint-text` on `--color-accent-tint` (stage) | 7.8:1  |
| `--color-text` on `--color-accent-tint` (stage)             | 13.4:1 |

`--color-text-muted` on stage sits right at the 4.5:1 floor — same tightness Cherry's own
table had for a couple of pairings. Don't push it any lighter; if a future accent tweak
darkens `petrol-950` further, recheck this one first.

`--color-accent` as text on the **paper** canvas (6.3:1) is deliberately several points
above the 4.5:1 minimum: teal is a lighter-reading hue than Cherry's dark bottle-green at
the same nominal "700" ramp position, so the paper-mode accent (`--clr-teal-700`,
`#065a51`) had to be pulled darker than a naive "just recolor the same ramp slot" swap
would produce. Don't lighten it back toward `--clr-teal-500` for paper-mode text use.

## Accent vs. danger — colorblind safety

Cherry's own danger-500 was pulled deliberately dark (not just hue-shifted) because a
mid-tone red sat within a deuteranopia simulation's confusion distance of Cherry's green
accent. Petrol's accent is teal (cyan-leaning blue-green) rather than green, which is
already further from red on both the protanopia and deuteranopia confusion axes than
Cherry's accent was — but this rework still keeps a real luminance gap between accent and
danger in both modes as a second, hue-independent safety margin (paper: accent luminance
≈0.17 vs. danger ≈0.05, roughly 3x; stage: accent ≈0.52 vs. danger ≈0.32). If a future
tweak narrows either gap, rerun a colorblind simulation before shipping — don't rely on
hue distance alone.

## Shape: the Hybrid rule (Petrol V2)

Petrol V1 set every `--radius-*` to `0`. V2 (owner decision, 2026-11) softens that without
losing the telemetry identity. Corners are sized by the element's role:

| Token           | Value  | Used for                                                                                       |
| --------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `--radius-sm`   | 3px    | tags, badges, chips, inputs, secondary buttons, the live blip                                  |
| `--radius-md`   | 6px    | cards                                                                                          |
| `--radius-lg`   | 10px   | modals and large panels                                                                        |
| `--radius-full` | 9999px | true circles only: spinners and avatars (never a pill or a badge)                              |
| `--bevel-md/lg` | 6/9px  | the soft chamfer on BIG primary buttons (`--bevel-lg` is read by `.btn-bevel`; `-md` reserved) |

`.status-live-dot` uses `--radius-sm`: a machined 3px blip, not a circle. Cards use a 1px `--color-border-card` (`petrol-400` in both modes) instead of the old 2px
near-black frame: 3.4:1 against the paper canvas (4.0:1 on the card surface) and 4.5:1 on
stage (4.2:1 on the card surface), so the edge meets WCAG 1.4.11's 3:1 and the 2026-09-05
"nearly invisible" feedback is answered without the heavy frame. `--color-border` stays soft
for dividers. Input edges use `--color-border-input` (`petrol-400`, same step as the card edge): 4.0:1 against the paper
surface (3.4:1 against the canvas) and 4.2:1 against the stage surface (4.5:1 against the canvas); the old
`--color-border` edge was 2.1:1 (paper canvas), under WCAG 1.4.11.

### Big primary button: the bevel (P2)

One shape, two spellings (`.btn-bevel` lives in `base.css`, loaded by every page; `.btn-lg` in `components.css`, which restates the same declarations):

- `.btn .btn-primary .btn-lg` — the console's big primary button. `components.css` adds the size
  (`min-height` 52px, `--text-md`); the shape comes from `base.css`.
- `.btn-bevel` — shape only, for a call-to-action that is not a `.btn` (marketing, pricing, tour, the
  tools). Use it with the element's own colours and size.

Shape: top-left and bottom-right are chamfered (`corner-shape: bevel round bevel round`, inside
`@supports (corner-shape: bevel)`); the other two corners keep 3px. Both read `border-radius:
--bevel-lg --radius-sm --bevel-lg --radius-sm`, which is also the fallback: a browser without `corner-shape`
shows the same two diagonals rounded at 9px. **Never `clip-path`**: it clips the outside focus ring, which is
why the old `.cut-*` needed a square-while-focused workaround in three places. `corner-shape` shapes the border box,
so the ring follows. `.btn-bevel.btn-bevel` is doubled on purpose so a screen's own one-class `border-radius`
cannot flatten it.

Who gets it: the screen's single main call-to-action only. Console: Start heat, Confirm heat (Cup Taster), Confirm
match (BTC). Public pages: the landing primary action, the pricing tier buttons, the tour's primary links. Tools:
the random selector's DRAW ENTRY and KEEP RESULT, the Brew Planner's primary buttons. Everything else, including the
public header's "Start free", takes `--radius-sm`.

`.cut-lg` (clip-path polygon, `--cut-lg` 16px) survives only for large decorative, non-focusable panels (the
random selector's board frame). `.cut-sm` and `.cut-md` are removed.

## Component states (P2)

- **Press.** `.btn:active` sinks 1px (`--dur-press`) and darkens the fill; hover and colour changes ease over
  `--dur-fast`. Not applied while disabled or busy.
- **Busy.** `.btn[aria-busy='true']` keeps its label and shows a 2px line along the bottom edge that runs under
  motion and is a static bar under reduced motion. `core/dom.js` `setBusyDisabled()` already sets `aria-busy` together with
  `aria-disabled` (it is what every sign-in and save button uses), so those buttons pick it up with no JS change.
  Guess the Bean's `.gtb-btn` has its own look and was not changed.
- **Feedback.** `.screen-feedback` fades and rises 4px over `--dur-base` when text arrives in it (an animation,
  so it also runs for a region that starts empty). The empty-region rule is unchanged: still in the accessibility
  tree, no space taken.
- **Selected.** `.is-selected`, or `.selectable` driven by `aria-selected` / `aria-current`: accent tint, a 2px
  accent edge and a check mark. The tint is only 1.14:1 against the paper canvas, so the edge and the check carry the state.
  The classes are ready; the console's existing selected markers (appShell nav `aria-current`, admin nav, Brew
  Planner step `aria-current='step'`, the heats list) adopt them in P3.

**No shadows** — unchanged. Flat borders and surface steps only.

## Motion

`motion.css` is the one vocabulary: `--dur-press` 80ms (pressed), `--dur-fast` 140ms (hover,
focus), `--dur-base` 220ms (most transitions), `--dur-stage` 420ms (venue-display moments),
`--ease-out` `cubic-bezier(.2,.8,.2,1)`. Use these, not a hand-picked pair (16 ad-hoc pairs
existed before V2; they migrate in P2/P3). `base.css` has one global
`prefers-reduced-motion: reduce` rule that cuts every animation and transition to 0.01ms
and stops loops after one cycle. It is a safety net: a looping or decorative animation should
still be written inside `@media (prefers-reduced-motion: no-preference)` so it never runs
under reduce at all (the existing pattern); the global rule covers whatever slips through.

## Accent tint (selected state)

`--clr-teal-50/100` (paper) and `--clr-teal-900` (stage) feed `--color-accent-tint`, with
`--color-accent-tint-text` as the text that sits on it, in both modes (rows in the contrast
table above). A selected or active row uses the tint, not the grey sunken surface. The
symmetry rule holds: paper tint is light with dark text, stage tint is dark with light text.
The classes that apply it are `.is-selected` / `.selectable` (see "Component states").

## `is_test` is violet, and only violet is `is_test` — unchanged

`--color-test` (`#6b21c9`) is untouched by this rework, in either surface mode, for the
exact reason Cherry's own rework left it alone: reserve one hue nothing else in the
palette ever touches. **Never reuse violet for anything else**, regardless of how many
more identity reworks this product goes through.

## Typeface — self-hosted, not system-only

Two of three families change:

- **Chakra Petch** (`--font-display`) — replaces Bricolage Grotesque. An angular,
  technical/telemetry-flavored geometric face matching the racing-HUD register the
  marketing exploration established. Weights 500/600/700 (no 400 — nothing sets
  `--font-display` at regular weight). Ships as three genuinely distinct static woff2
  files.
- **Hanken Grotesk** (`--font-body`) — replaces IBM Plex Sans. A plain, neutral workhorse
  sans that doesn't compete with Chakra Petch's display personality. Google serves this
  family as a single variable-font file across its whole weight range rather than
  per-weight statics; `fonts.css`'s four @font-face rules (400/500/600/700) all point at
  that one file (`hanken-grotesk-variable.woff2`) with a different `font-weight`
  descriptor each — the same technique Google's own CSS API uses for variable-font-capable
  browsers, so it's stored once rather than as four identical copies.
- **IBM Plex Mono** (`--font-mono`) — **unchanged**. Already exactly the right register
  for this identity (technical, tabular, telemetry-adjacent); no reason to replace a face
  that already fits perfectly. Keep every existing rule and file as-is.

**Self-hosted, never linked from a third-party CDN** — this rule is unchanged and
non-negotiable: the app runs at live events on whatever wifi the venue has. Both new
families are SIL Open Font License 1.1 (self-hosting explicitly permitted), downloaded
once from `fonts.gstatic.com` and served from `src/ui/tokens/fonts/`.

## Guidelines

Everything Cherry's DESIGN.md said under **Do** / **Don't** still applies unchanged
(consume tokens, never hand-pick a hex, `--font-mono` + `.tabular-nums` for every score/
timer, `--color-gold` ceremonial-only, `--color-focus-ring` stays neutral, no
third-party font CDN, no new font weight without a real consumer). Two additions
specific to Petrol:

- **Do** reach for `.btn-bevel` / `.btn-primary.btn-lg` for a big primary button, and `--radius-sm` for
  everything small. **Don't** put a `clip-path` on anything focusable.
- **Don't** hand-pick a `border-radius` or a transition duration/easing. Pick the role's
  `--radius-*` and a `--dur-*`/`--ease-out`; if none fits, raise it rather than patching
  locally. `--radius-full` is for circles only.

## Open items

1. `--color-gold`'s exact hue only got a light nudge to sit on the new graphite ramp; it
   wasn't independently re-derived from scratch the way the rest of the palette was.
   Fine as shipped (contrast still checked, see table above), but worth a second look if
   gold ever gets a larger role than today's ceremonial-only usage.
2. Login + Setup are the only console screens actually restyled against Petrol's angular
   shape language so far (from the earlier design-system pilot). Every other screen
   (scoring, standings, viewer/projector, timer, roster, dashboard) still needs its own
   pass — the token layer supports them already (everything reads through `var()`), but
   nobody has verified each screen's specific layout against the Hybrid radii/`.cut-*` yet.
3. Petrol V2 is in progress on its own branch: P1 (tokens) and P2 (bevel buttons, press and busy states,
   selected-state classes, input edges, `.cut-*` retired from buttons) done; P3 (screens, and adopting the selected
   classes) and the drift guard (`tokenDrift.test.js`) are done.
   Existing `--radius-full` pills and badges were moved to `--radius-sm` in P1 so they do
   not turn into pills; the splash glow keeps `--radius-full`.

## Petrol V2 P3: surfaces

- **Rank slides and score ticks:** `core/rankMotion.js` (+ `.css`). A format marks a row `data-rank-key`
  (its name) and the cells that can change `data-rank-value` (`markRankRow`); `viewer-shell` (every phone body)
  and `stagePageLoop` (every projector standings page) redraw through it, so rows slide (FLIP, `--dur-stage`,
  `--ease-out`) and changed numbers tick in. Reduced motion: no motion, instant update. A key that appears twice
  is not animated. Cup Taster and BTC use it; Throwdown has no standings list yet and uses it unedited when it does.
- **Loading placeholder:** `core/skeletonBoard.js` draws a board-shaped placeholder under the "Connecting…" card,
  in the `connecting` phase only. Dashed hollow outlines, never animated, `aria-hidden`; the TEST banner host is
  untouched.
- **Live blip:** a 4s opacity breathe (`.status-live-dot`, `.stage-band-live-dot`), not a 2s blink. A lost
  connection already reads differently: "Reconnecting…" in the danger colour, no dot, and the holding card.
- **Names:** long names in the phone standings (Cup Taster, BTC) and the projector table are cut with an ellipsis,
  the "(tied)" beside them never is; stage titles use `text-wrap: balance`.
- **Colours:** `colors.css` gained `--clr-white`, `--clr-black` (paper and ink for print) and
  `--clr-chart-1..8` (the categorical chart palette). Behind the Seduh (`bts/index.html`) links the tokens like any
  other page since 2026-11-09 (it used to keep a copy in `public/bts/`), so `src/marketing/bts.css` is drift-guarded.
- **Motion exceptions** (named, deliberately not on the tokens): ambient loops (splash glow, Guess the Bean
  float/bob/spin, landing marquee, the live blip's 4s breathe), the Guess the Bean
  celebration (pop, confetti, burst), the splash intro, the landing hero fade (1.1s), and stepped animations (Random
  Selector flip, timer blink).

## Public pages: shared primitives

The public pages (landing, pricing, tour, trust, results, community hub, the public header and footer) once drew
their own tags, cards, toggles, buttons and live dots, so Petrol V2 reached the console and skipped them (a "BASIC
FREE" tag stayed square). They now draw from **one** definition each, in `base.css`, the file `index.css` loads on
every page. Not `components.css`: that file is not on the public pages on purpose (its header says why: they style
their own `.form-field` and `.screen-feedback` names), and its `.btn` carries the console's busy and press states.

| Class                             | Is                                                          | Corner | Used by                                                                                            |
| --------------------------------- | ----------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `.tag` `.tag-solid` `.tag-dashed` | small mono label; `--tag-edge` / `--tag-ink` recolour it    | 3px    | landing tier tags, pricing "Planned", community status, footer version                             |
| `.panel`                          | the card edge, shape only (1px `--color-border-card`)       | 6px    | pricing cards and rows, tour cards/photo/board, community cards, results card/table, landing plate |
| `.icon-frame`                     | framed square for an icon or index; `--frame-edge` / `-ink` | 3px    | tour numbers, icons and cups, community note mark and instrument                                   |
| `.menu-toggle`                    | hamburger button, 44px                                      | 3px    | landing nav and the public header                                                                  |
| `.action` `-primary` `-outline`   | button-shaped link, accent fill or edged                    | 3px    | landing actions, header "Start free", pricing/tour links, results sheet button                     |
| `.status-live-dot`                | the live blip (already shared)                              | 3px    | landing live bar, public header                                                                    |
| `.btn-bevel`                      | the big call-to-action shape (already shared)               | bevel  | with `.action-primary` on the main CTAs                                                            |

`.card` (components.css) and `.panel` carry the same two declarations, `border` and `border-radius`; a test holds them
equal, so a card and a pricing card cannot drift. A page adds only layout and, where it must, a variable
(`--tag-edge: var(--color-success)`); it never restates the border, fill or corner.

**Stays square, on purpose:** full-bleed page bands and roots, the header bar and mobile menu panel, the landing ticker,
live bar and edge-to-edge format rows, the printable results sheet, a flag glyph and decorative fills. A rounded
corner on something that touches both screen edges reads as a bug, not a style. These are the `SQUARE_ALLOWLIST` in
`tokenDrift.test.js`, each with its reason.

## Drift guard

A second check covers the public pages (`src/marketing/*.css`, `src/community/communityHub.css`). It is a heuristic,
not a parser: a rule that paints a box (a `border` shorthand with a line style, or a `background`) and sets no
`border-radius` fails unless the page's JS writes that class beside a shared shape class (`pricing-card panel`), and a
painting rule whose last class is named like a primitive (`-tag`, `-badge`, `-chip`, `-pill`, `-dot`, `-toggle`,
`-mark`) fails as a local copy. State rules (`:hover`, `:focus`), pseudo-elements and `border: 0` are skipped. Square
things go in `SQUARE_ALLOWLIST` (file, selector chain, kind, reason; exact both ways).
`src/marketing/sharedPrimitives.test.js` checks the markup really carries the shared classes.

`src/ui/tokens/tokenDrift.test.js` fails CI when a stylesheet outside this folder (every `*.css` under `src/`, and
the inline `<style>` of HTML pages; not `design/` or `*.preview.html` dev harnesses)
writes a raw colour (hex, `rgb()`, `hsl()`), a `border-radius` length that is not `var(--radius-*)`,
`var(--bevel-*)`, `0` or `inherit`, a time or easing literal in `transition`/`animation`, or a
`clip-path: polygon()`. Known gaps: longhand `animation-delay`/`transition-delay` (stagger offsets), named and modern colours (`white`, `oklch()`), and values hidden behind a custom property are not checked. For a translucent token colour use `color-mix(in srgb, var(--clr-white) 8%, transparent)`.

To allow a value, add an entry to `ALLOWLIST` in that file: the file, the kind, the full selector chain, the exact
literal, and a reason (ideally a named exception above; two Guess the Bean entries, the spinner and the display countdown, are allowlisted on judgment and not yet named there). Entries are exact (a second copy of the value in the
same rule fails, and an entry that stops matching fails), so prefer a token to an entry, and add a token when
several screens need the same value.

## Live preview

`src/ui/tokens/preview.html` renders every token — palette swatches for both surface
modes, the type scale, spacing/radius, buttons (big bevel, busy, disabled), the selected state, inputs and feedback, the decorative `.cut-lg`, a mock scoreboard using
`.font-mono-score`, and the `is_test` banner. Open it via the dev server (`npm run dev`,
then navigate to `/src/ui/tokens/preview.html`) when changing any token value.
