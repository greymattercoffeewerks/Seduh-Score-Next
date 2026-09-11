# Seduh Score Next — Design System

_Tokens live in `colors.css`, `typography.css`, `spacing.css`, `base.css` — import
`index.css`. This file explains the reasoning; the CSS is the source of truth for values._

_Reworked 2026-09-11 — "Cherry" replaces the original "Editorial" identity (clay
neutrals, ember/roast-orange accent, Cabinet Grotesk/Switzer). User-run feedback on the
marketing landing page came back nearly unanimous: clean and functional, but "too
Claude, too Anthropic" — the warm-cream/orange/serif-adjacent register reads as generic
AI-SaaS rather than as this product. This rework applies the replacement identity to the
whole product, not just the landing page, so the organiser dashboard, projector/stage
view, and phone entry surface all read as one deliberate thing._

## References

The original "Editorial" identity was built from three
[refero.design](https://styles.refero.design) references (Acme Cups, Assembly Coffee,
Ventriloc) — see CHANGELOG.md's 2026-08-22 entry if that history matters. Cherry starts
from a different brief: two fintech products praised for confident, non-generic visual
identity, reinterpreted through the one part of this product's subject matter that isn't
already claimed by "coffee shop" imagery — the crop itself, not the drink.

| Reference                                                 | What it contributed                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Wise](https://designmd.directory/p/wise-design-md)       | Bold, high-contrast flat color blocking; one confident saturated brand hue doing double duty as both the everyday interactive accent and the "positive/success" signal, rather than keeping those hues separate.                                          |
| [Mercury](https://designmd.directory/p/mercury-design-md) | Near-black ground as the default register, not just a "dark mode" bolted onto a light-first design; restrained, high-end feel from color and type discipline rather than ornament.                                                                        |
| Coffee cherry (the literal crop)                          | Unripe cherries are a bright chartreuse-green; ripe ones are red. Neither is orange or cream — a palette grounded in the crop itself, not the roast or the cup, was the way to get a coffee-competition identity that isn't a generic warm-beverage look. |

None of these is used verbatim. The palette below is synthesized and independently
contrast-checked for this app's actual requirements — three genuinely different
surfaces (organiser dashboard, projector/audience display, phone entry) that must feel
like one product, and a non-negotiable `is_test` indicator (handoff D9).

## One neutral ramp, two surface modes

Rather than two disconnected light/dark palettes, there is one neutral ramp
(`--clr-cherry-50` through `--clr-cherry-950`, bottle-green-black at the dark end) that
both surface modes draw from:

- **Paper** (default — `:root`, or `[data-surface="paper"]`): the light end of the ramp.
  Used by the organiser dashboard and the phone entry surface — the surfaces where
  someone is reading dense data or entering scores under time pressure.
- **Stage** (`[data-surface="stage"]`): the dark end of the ramp. Used by the
  projector/audience big-screen view — the surface that needs to read from across a
  room and carry the drama of a live result. The splash/promo screen (`#/live/splash`)
  is the same class of surface and uses it too.

Every semantic color (`--color-accent`, `--color-danger`, `--color-success`,
`--color-warning`, `--color-gold`) follows one rule across both modes: **paper-mode
semantic colors are dark tones, paired with a white `-contrast`; stage-mode semantic
colors are light tones, paired with a `cherry-950` `-contrast`.** That symmetry is what
lets `data-surface` flip the entire palette correctly with zero per-color exceptions —
there's no semantic color that needs a special case when the mode changes.

Every text/background pairing below was checked against WCAG 2.1 contrast minimums
(4.5:1 for normal text) using relative luminance (recomputed 2026-09-11 for the Cherry
palette — see git history for the previous clay/ember table):

| Pairing                                                     | Ratio                               |
| ----------------------------------------------------------- | ----------------------------------- |
| `--color-text` on `--color-canvas` (paper)                  | 15.2:1                              |
| `--color-text-secondary` on canvas (paper)                  | 9.9:1                               |
| `--color-text-muted` on canvas (paper)                      | 7.5:1                               |
| `--color-accent` as text on canvas (paper)                  | 8.1:1                               |
| `--color-accent-contrast` on `--color-accent` fill (paper)  | 10.0:1                              |
| `--color-danger` on canvas (paper)                          | 12.4:1                              |
| `--color-text-secondary` on canvas (stage)                  | 9.3:1                               |
| `--color-text-muted` on canvas (stage)                      | 5.9:1                               |
| `--color-accent` as text on canvas (stage)                  | 12.7:1                              |
| `--color-accent-contrast` on `--color-accent` fill (stage)  | 12.7:1                              |
| `--color-danger` on canvas (stage)                          | 6.7:1                               |
| `--color-gold` on canvas (stage — its one real use context) | 8.2:1                               |
| `.is-test-banner` text on its fill                          | 7.8:1 / 18.9:1 (both stripe colors) |

## `is_test` is violet, and only violet is `is_test`

`--color-test` (`#6b21c9`) does not appear anywhere else in the system, in either
surface mode. That's deliberate, not a leftover: v4.x's demo mode was visually
indistinguishable from a real event (the exact failure D9 exists to close), so the fix
here is structural — reserve a hue the rest of the palette never touches, so it cannot
be confused with a brand color, a semantic state, or a future feature's accent. The
`.is-test-banner` pattern in `base.css` renders identically regardless of `data-surface`
(it does not inherit the paper/stage swap) because it must stand out the same way on
every surface — organiser, projector, phone — not blend into whichever theme is active.
**Never reuse violet for anything else.**

## No shadows

There is no elevation/shadow token in this system. Surfaces separate with a hairline
border or a flat background-color step, never a drop shadow — carried forward through
the Cherry rework unchanged. Both Wise and Mercury lean on flat color blocking rather
than elevation for hierarchy, and for a tool whose job is producing a trustworthy
scoresheet, that flat register still reads as rigor rather than SaaS gloss — reach for
`--color-border` or a `--color-surface*` step instead of `box-shadow`.

## Typeface — self-hosted, not system-only

_Reworked 2026-09-11 — Bricolage Grotesque, IBM Plex Sans, and IBM Plex Mono replace
Cabinet Grotesk/Switzer/JetBrains Mono as part of the Cherry identity change. Downloaded
once from Google Fonts' CDN and served from `src/ui/tokens/fonts/*.woff2`
(`fonts.css` has the `@font-face` rules and license notes)._

- **Bricolage Grotesque** (`--font-display`) — Ludwig Bäumann/ArrowType, SIL Open Font
  License 1.1 (self-hosting explicitly permitted). A geometric grotesk with more
  character than Cabinet Grotesk — slight quirks in its letterforms at display sizes
  that read as designed rather than default, while keeping the same two-role structure
  (a distinct display face over a workhorse body face). Ships two weights (400, 700),
  same consumer pattern the previous display face had: every unstyled heading in the
  shipped app screens renders at the browser's default bold (`base.css` never resets
  heading weight), so 700 is a real consumer; `preview.html`'s `.guide-heading`
  deliberately overrides to regular weight, so 400 is too. No italic cut is declared —
  nothing in this codebase sets `font-style: italic` on `--font-display`.
- **IBM Plex Sans** (`--font-body`) — IBM, SIL Open Font License 1.1. A technical,
  slightly condensed workhorse sans that pairs against Bricolage's display personality
  without competing with it, and reads as considered rather than a default safe choice.
  Ships the same weight set Switzer did (400/500/600/700).
- **IBM Plex Mono** (`--font-mono`) — IBM, SIL Open Font License 1.1. A genuine
  fixed-width monospace — every glyph the same width, not just numerals — for anything
  reading digit columns. Still paired with `font-variant-numeric: tabular-nums` on
  `.font-mono-score` (`base.css`) as a belt-and-suspenders guarantee regardless of the
  active font.

**Self-hosted, never linked from a third-party CDN.** The app runs at live events on
whatever wifi the venue has, and every surface must not depend on a third-party font
request succeeding mid-event — a design token shouldn't be a single point of failure a
font CDN outage can take down, same posture as the Phase 3 offline-sync work. Each
`@font-face` rule uses `font-display: swap`, and every `--font-*` token keeps its full
system-stack fallback after the webfont name, so a slow or failed first load still
renders instantly in a structurally-equivalent fallback rather than blocking. Total
payload for all 8 weight files currently used is ~178KB.

`--font-mono` is not decorative. Every score, timer, and elapsed-time display must pair
it with `.tabular-nums` (`base.css`) so digits don't change width as they change value.
The projector view is read from across a room; a digit-width jitter there reads as a
bug, not a stylistic quirk.

## Guidelines

**Do**

- Consume tokens (`var(--color-*)`, `var(--space-*)`, etc.) from any screen or
  component. A screen introducing its own one-off color or spacing value is the
  "local patches are an anti-pattern" rule (`CONVENTIONS.md`) applied to design — the
  fix belongs in these files, not in the screen that needed it.
- Put `data-surface="stage"` on a full-bleed, big-screen surface's own root — the
  projector (`projectorSurface.js`) and the splash/promo screen (`splashScreen.js`) are
  the two today — and nowhere else. Don't build a second dark theme by hand for any
  other surface.
- Use `--font-mono` + `.tabular-nums` for every numeric score/timer display.
- Use `--color-gold` only for ceremonial moments — podium, champion badge, finals
  callouts. If it starts showing up on routine UI, that's a sign it's being used as a
  second brand color instead of a reserved one.
- Apply `.tap-target` (`base.css`) to any icon-only control. `--tap-target-min` alone
  only guarantees height on a text button that's already wide enough to clear 44px —
  an icon-only button needs the width guaranteed explicitly too.
- Use `--text-5xl`/`--text-6xl` only inside a fixed-canvas surface (the projector
  stage, or a dedicated big-number panel), never dropped directly into an arbitrary
  responsive container without its own step-down/scroll handling — see the comment in
  `typography.css`.

**Don't**

- Don't add `box-shadow` anywhere in the system.
- Don't link a webfont from a third-party CDN (Fontshare's, Google Fonts, or otherwise).
  If a new weight or family is needed, download it and add it to
  `src/ui/tokens/fonts/` + `fonts.css` the same way — self-hosted only.
- Don't add a new webfont weight/style without a real consumer. Every file in
  `fonts/` should map to a `--font-weight-*` token actually used somewhere.
- Don't use violet (`--color-test`) for anything other than `is_test` indicators.
- Don't set `--color-gold` as a plain text color — paper mode's gold-700 measures only
  4.1:1 as text on the paper canvas (below the 4.5:1 AA minimum), and the
  reserved-accent argument above depends on it staying a fill color paired with
  `--color-gold-contrast`, not a general-purpose text color.
- Don't reach for `--color-accent` for a focus ring. `--color-focus-ring` is
  intentionally the neutral `--color-border-strong`, not the brand hue — an
  already-accent-colored element (a primary button, an active tab) still needs its
  focus state to read as visually distinct from its own resting-state color.
- Don't hand-pick a hex value for a new state or accent. If none of the existing
  semantic tokens fit, that's a signal this file needs a new token — reasoned through
  and contrast-checked the same way as the ones above — not a one-off value in the
  format or screen that needed it.

## Live preview

`src/ui/tokens/preview.html` renders every token — palette swatches for both surface
modes, the type scale, spacing/radius, a mock scoreboard using `.font-mono-score`, and
the `is_test` banner. Open it via the dev server (`npm run dev`, then navigate to
`/src/ui/tokens/preview.html`) when changing any token value — the stage-mode swatch
grid specifically is what would catch a broken paper/stage semantic mapping, so don't
let it fall out of date if a new semantic token is added.
