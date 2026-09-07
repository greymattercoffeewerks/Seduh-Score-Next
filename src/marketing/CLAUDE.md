# src/marketing/ — the public landing page

Root non-negotiables apply here too, but this directory sits outside the module
boundary the rest of them are written around: the handoff's own scope (§1 Out) says
"No landing page. No console." — this is genuinely new territory, added 2026-09-07,
not something the frozen spec anticipated. Treat the boundary rule's *spirit* (don't
leak assumptions between things that shouldn't share them) as binding; the letter of
"core vs. formats" doesn't map cleanly onto a third, non-format surface.

## What this is, and isn't

One static page (`index.html` at the repo root) with no router, no auth, no Supabase
calls, no live-event state. Its whole job is to sell the idea before someone signs in —
the console (`app/index.html`, `src/main.js`, everything under `src/core`/
`src/formats`) is a completely separate app that happens to live in the same repo and
deploy to the same Cloudflare project. Nothing in `src/marketing/` is reachable from
the console, and nothing in the console imports from here.

- `landingScreen.js` — builds the whole page with `core/dom.js`'s `el()`/`svgEl()`/
  `brandMark()`, same as every console screen (`textContent`-only, no `innerHTML` —
  see `dom.js`'s own header comment for why). `svgEl` was private to `dom.js` until
  this page's format-card icons became its 2nd real consumer; exported rather than
  duplicated, per `CONVENTIONS.md`'s "local patches are an anti-pattern" rule.
- `theme.js` — the day/night logic: auto by local clock (19:00–06:59 = night, else
  day), a manual toggle that always wins once used, remembered via `localStorage`.
  Applied as `data-theme="day"|"night"` on `<html>`. `index.html` carries a literal
  duplicate of this file's storage-read + auto-compute logic as an inline, synchronous
  `<script>` in `<head>` — that's intentional and documented at both ends: a deferred
  module script can't run before first paint, so without it every load would flash the
  default theme before repainting to the stored/computed one. Keep the two in sync if
  the night-hours boundary or the storage key ever changes.
- `landing.css` — day tokens under `:root`, night tokens under `:root[data-theme='night']`,
  same "flip custom properties at a boundary" trick `src/ui/tokens/colors.css` uses for
  its own `[data-surface]` swap. **Deliberately not the same tokens.** Editorial Nights
  isn't Editorial with the lights off — ember is demoted from the everyday accent
  (headline emphasis, buttons, links) to a rare "this is real, right now" signal (the
  live-status dot, Cup Taster's badge, the "Completed" event tag); a new warm gold
  ("lantern") takes over the everyday role instead, and the existing ceremonial gold
  ("brass") stays reserved for the Annual/BTC badge, now as an outline rather than a
  fill so it doesn't collide with lantern. See the design exploration this was built
  from (`design/landing-page/Main.dc.html` + `EditorialNights.dc.html`, 2026-09-07) for
  the full rationale if the "why" behind a specific color ever needs re-litigating.

## Why this doesn't import `src/ui/tokens/colors.css`

That file's `--color-*` semantic tokens are contrast-checked against the console's own
three surfaces (organiser/projector/phone) and documented that way in `DESIGN.md`. This
page reuses the same semantic *names* (`--color-canvas`, `--color-text`, etc.) because
they're generic slots any surface can fill, not because it shares `colors.css`'s
values — the two files are never loaded on the same page, so there's no runtime
collision, only a naming echo that keeps the pattern recognizable. Mixing a marketing
day/night concept into `colors.css` itself would be exactly the "token layer gains
format-specific vocabulary" failure `CONVENTIONS.md` warns against, one layer up: a
different *product surface* instead of a different format.

What this page *does* reuse from `src/ui/tokens/`, because it's genuinely
surface-agnostic: `fonts.css` (the real self-hosted Cabinet Grotesk/Switzer/JetBrains
Mono — no Google Fonts, no CDN, same reasoning as the console), `typography.css` (type
scale, weights, tracking), `spacing.css` (spacing/radius/tap-target-min scale), and the
generic utility classes in `base.css` (`.sr-only`, `.tabular-nums`, `.tap-target`,
`:focus-visible`, `.status-live-dot`). `index.html` links all four before
`landing.css`.

## Routing note

The console's hash router (`src/core/router.js`) only ever reads `location.hash` — it
has no opinion about what path its own HTML is served from. Moving it from `/` to
`/app/` (2026-09-07, to make room for this page at root) needed zero changes to any
router or screen code; only two Playwright specs that `page.goto('/')`-and-expected-
the-console needed their target updated to `/app/` (`tests/e2e/smoke.spec.js`,
`tests/e2e/organiser-flow.spec.js`). If a third HTML entry ever gets added, check
`vite.config.js`'s `build.rollupOptions.input` — Vite's dev server serves any `.html`
file by filesystem path automatically, but the production build only bundles entries
listed there.

## Known placeholders

Every nav link ("Tour", "Pricing", "Org login") and every "Start free"/"Take the tour"
CTA is `href="#"`. Not an oversight — there's no tour page, no pricing anchor, and no
sign-up flow yet (`loginScreen.js` is sign-in only; D14's real access control is still
a stub). Cup Taster's own format card is the one real link (`/app/#/events`), since
that's the one destination that actually exists today. Wire the rest up as their
destinations get built, not before.
