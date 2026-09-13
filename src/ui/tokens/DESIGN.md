# Seduh Score Next — Design System ("Petrol")

_Tokens live in `colors.css`, `typography.css`, `spacing.css`, `base.css` — import
`index.css`. This file explains the reasoning; the CSS is the source of truth for values._

_Reworked again (2026-09-13) — "Petrol" replaces "Cherry" (2026-09-11: chartreuse-green
accent, bottle-green-black neutrals, Bricolage Grotesque/IBM Plex Sans). Cherry itself
replaced "Editorial" for the same complaint now recurring a third time: fresh user
feedback on a marketing exploration built independently of Cherry — petrol-teal accent,
graphite ground, hard angular cuts (zero border-radius), racing/telemetry motifs —
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

| Pairing                                                       | Ratio  |
| -------------------------------------------------------------- | ------ |
| `--color-text` on `--color-canvas` (paper)                      | 15.1:1 |
| `--color-text-secondary` on canvas (paper)                      | 11.2:1 |
| `--color-text-muted` on canvas (paper)                          | 7.8:1  |
| `--color-accent` as text on canvas (paper)                      | 6.3:1  |
| `--color-accent-contrast` on `--color-accent` fill (paper)      | 8.1:1  |
| `--color-danger` on canvas (paper)                              | 8.0:1  |
| `--color-success` on canvas (paper)                             | 5.9:1  |
| `--color-warning` on canvas (paper)                             | 5.3:1  |
| `--color-text-secondary` on canvas (stage)                      | 7.2:1  |
| `--color-text-muted` on canvas (stage)                          | 4.5:1  |
| `--color-accent` as text on canvas (stage)                      | 10.4:1 |
| `--color-accent-contrast` on `--color-accent` fill (stage)      | 10.4:1 |
| `--color-danger` on canvas (stage)                              | 6.9:1  |
| `--color-success` on canvas (stage)                             | 9.6:1  |
| `--color-warning` on canvas (stage)                             | 9.1:1  |
| `--color-gold` on canvas (stage — its one real use context)     | 8.4:1  |

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

## Angular shapes replace rounded corners

The one real shape-language change, not just a color swap: **`--radius-sm/md/lg` are now
`0`.** Petrol commits to hard angular cuts, no rounding, anywhere in the system. This
flows through automatically to every token consumer (cards, buttons, inputs, badges) —
and turns `.status-live-dot` into a square blip instead of a circle, which reads as more
"telemetry indicator" than "online dot" and matches the marketing exploration's own
motif.

New `--cut-sm/md/lg` tokens + `.cut-sm/.cut-md/.cut-lg` utility classes (`base.css`) add
the angular alternative to a rounded corner — a clipped chevron-style cut, used sparingly
(primary CTAs, tags, hero panels), not on every box. This is additive; nothing forces a
screen to adopt it during the gradual rollout. `preview.html` demonstrates all three
sizes.

**No shadows** — unchanged from Cherry (which carried it forward from Editorial). Still
flat borders/surface-color steps only.

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
- **Don't** reintroduce `border-radius` anywhere outside these token files. If a screen
  seems to need a rounded corner, that's a signal to raise it, not to patch around
  `--radius-*` locally.

## Open items

1. `--color-gold`'s exact hue only got a light nudge to sit on the new graphite ramp; it
   wasn't independently re-derived from scratch the way the rest of the palette was.
   Fine as shipped (contrast still checked, see table above), but worth a second look if
   gold ever gets a larger role than today's ceremonial-only usage.
2. Login + Setup are the only console screens actually restyled against Petrol's angular
   shape language so far (from the earlier design-system pilot). Every other screen
   (scoring, standings, viewer/projector, timer, roster, dashboard) still needs its own
   pass — the token layer supports them already (everything reads through `var()`), but
   nobody has verified each screen's specific layout against zero-radius/`.cut-*` yet.

## Live preview

`src/ui/tokens/preview.html` renders every token — palette swatches for both surface
modes, the type scale, spacing/radius, the corner-cut utilities, a mock scoreboard using
`.font-mono-score`, and the `is_test` banner. Open it via the dev server (`npm run dev`,
then navigate to `/src/ui/tokens/preview.html`) when changing any token value.
