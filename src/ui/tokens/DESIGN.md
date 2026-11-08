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

| Token           | Value  | Used for                                                            |
| --------------- | ------ | ------------------------------------------------------------------- |
| `--radius-sm`   | 3px    | tags, badges, chips, inputs, secondary buttons, the live blip       |
| `--radius-md`   | 6px    | cards                                                               |
| `--radius-lg`   | 10px   | modals and large panels                                             |
| `--radius-full` | 9999px | true circles only: spinners and avatars (never a pill or a badge)   |
| `--bevel-md/lg` | 6/9px  | the soft chamfer on BIG primary buttons (built in P2; unused in P1) |

`.status-live-dot` uses `--radius-sm`: a machined 3px blip, not a circle. `--cut-*` and
`.cut-*` stay for now (the clip-path cut clips focus rings); P2 retires them from small
elements. Cards use a hairline `--color-border` instead of the old 2px near-black frame.
This is a known trade: the card edge is 2.1:1 against the paper canvas (1.3:1 on stage) and
the surface step only 1.2:1, so cards separate more softly than before (the 2026-09-05
"nearly invisible" feedback is the risk). Accepted for V2; revisit in P3 if screens read flat.

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
The classes that apply it arrive in P2.

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

- **Do** reach for `.cut-sm/.cut-md/.cut-lg` instead of hand-writing a one-off
  `clip-path` when a screen wants the angular-cut treatment — same "don't hand-pick a
  value, extend the token layer" discipline Cherry's own rules apply to color/spacing.
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
3. Petrol V2 is in progress on its own branch: P1 (tokens, this file) done; P2 (bevel
   buttons, press and busy states, selected-state classes, retire `--cut-*` from small
   elements and fix focus-ring clipping) and P3 (screens), then a drift-guard test, are open.
   Existing `--radius-full` pills and badges were moved to `--radius-sm` in P1 so they do
   not turn into pills; the splash glow keeps `--radius-full`.

## Live preview

`src/ui/tokens/preview.html` renders every token — palette swatches for both surface
modes, the type scale, spacing/radius, the corner-cut utilities, a mock scoreboard using
`.font-mono-score`, and the `is_test` banner. Open it via the dev server (`npm run dev`,
then navigate to `/src/ui/tokens/preview.html`) when changing any token value.
