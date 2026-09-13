# src/marketing/ — the public landing page

Root non-negotiables apply here too, but this directory sits outside the module
boundary the rest of them are written around: the handoff's own scope (§1 Out) says
"No landing page. No console." — this is genuinely new territory, added 2026-09-07,
not something the frozen spec anticipated. Treat the boundary rule's _spirit_ (don't
leak assumptions between things that shouldn't share them) as binding; the letter of
"core vs. formats" doesn't map cleanly onto a third, non-format surface.

## What this is, and isn't

One static page (`index.html` at the repo root) with no router, no auth, no Supabase
calls, no live-event state. Its whole job is to sell the idea before someone signs in —
the console (`app/index.html`, `src/main.js`, everything under `src/core`/
`src/formats`) is a completely separate app that happens to live in the same repo and
deploy to the same Cloudflare project. Nothing in `src/marketing/` is reachable from
the console, and nothing in the console imports from here.

## Identity history — four attempts, real lessons each time

"Editorial" (2026-09-07) and "Cherry" (2026-09-11) both got the same user-testing
verdict — "too generic, too Claude-like." Cherry additionally drew "alien" for its
near-black canvas + saturated chartreuse accent. "Kinetic" (2026-09-13) tried a
structural rework (warm mineral canvas, coral/indigo/citron, a halftone-dot motif) to
answer that same complaint by changing shape and typography, not just palette.

**"Petrol" (also 2026-09-13, hours later)** replaced Kinetic before it saw a second
round of user feedback — a design handoff produced independently (Claude Design)
delivered a petrol-teal/graphite/angular-cut direction covering both this page AND a
full app-wide token replacement (`src/ui/tokens/*` — colors, typography, spacing, base,
fonts), and the user chose to adopt both rather than keep Kinetic's page-only identity
running alongside a still-Cherry console. This is the fastest-turnaround rework in this
page's history; if a fifth identity is ever needed, that recurrence is worth raising
before just shipping another palette swap.

**Real architecture change**: every previous identity (Editorial/Cherry/Kinetic) kept
its own separate token block and deliberately did NOT import
`src/ui/tokens/colors.css` — see the "Why this doesn't import" section below for why
that reasoning applied then and doesn't now.

**No day/night toggle** — unchanged from Kinetic. Both Editorial and Cherry had one
(`theme.js`, a manual toggle, an inline FOUC-prevention script in `index.html`);
`theme.js` was deleted in the Kinetic rework, not kept dormant, and Petrol doesn't bring
it back.

Two real fixes made while porting the handoff's design reference (a single-file mockup
in a different design tool's own component format, not meant to be copied verbatim)
into this codebase:

- The fourth competition format is **"BBTC"** everywhere else in this codebase
  (`src/formats/bbtc/`, `ROADMAP.md`) — the design reference called it "BTC," which
  isn't this product's real name for it. Corrected in `landingScreen.js`, the same way
  an earlier rework corrected a fabricated nav link.
- The design reference hand-picked several one-off graphite/teal hex values for
  backgrounds and text, entirely independent of the shared token system (it predates
  the decision to import that system here). See `landing.css`'s header comment for
  exactly which values were snapped onto existing `--clr-petrol-*` ramp steps instead of
  becoming new marketing-only hex values.

## Why this DOES import `src/ui/tokens/index.css` now

Kinetic's (and Cherry's, and Editorial's) own CLAUDE.md reasoning was: `colors.css`'s
tokens are contrast-checked against the console's own three surfaces, and a marketing
palette with no relationship to the console's palette shouldn't be mixed into that file
just because both happen to need colors. That reasoning doesn't apply to Petrol — Petrol
**is** the console's palette. The same design handoff that redesigned this page also
replaced `src/ui/tokens/colors.css`/`typography.css`/`spacing.css`/`base.css`/`fonts.css`
app-wide (see `src/ui/tokens/DESIGN.md`'s "Petrol" section), so this page and the
organiser dashboard/login/setup/projector screens now render from the literal same
`--color-*`/`--font-*`/`--space-*` values. Maintaining a third, separate
`--petrol-marketing-*` block duplicating those exact values would be the "token layer
gains a redundant parallel vocabulary" failure `CONVENTIONS.md` warns against, one layer
up — so `index.html` links `/src/ui/tokens/index.css` directly, then `landing.css` on
top of it, same order every console screen's own stylesheet linking follows.

This page's root element carries `data-surface="stage"` (set in
`landingScreen.js`'s `mountLandingScreen`) rather than hand-picking light-on-dark text
colors: the whole page is graphite-ground/light-text/teal-accent throughout, which is
exactly the console's existing "stage" semantic mode (the projector/audience view), not
"paper" (the organiser dashboard's default light mode). Flipping that one attribute
resolves every `--color-text`/`--color-text-secondary`/`--color-accent`/`--color-gold`
pairing correctly, verified against the same contrast table `DESIGN.md` uses for the
projector — rather than a second, unchecked set of values duplicating what the token
system already guarantees.

## Files

- `landingScreen.js` — builds the whole page with `core/dom.js`'s `el()`/`svgEl()`/
  `brandMark()`, same as every console screen (`textContent`-only, no `innerHTML` —
  see `dom.js`'s own header comment for why). Its own header comment has the fuller
  identity-history account and the two real fixes made porting the handoff in.
- `landing.css` — page-specific layout only (nav, hero, ticker, problem/formats/proof/
  pricing/cta bands, footer). No `:root` token block of its own — every color/font/
  space value is `var(--color-*)`/`var(--font-*)`/`var(--space-*)` from the shared
  system, plus a handful of raw `--clr-petrol-*` ramp steps for this page's own
  "one step lighter than canvas" band surfaces (see the file's header comment for
  exactly which, and why those aren't hand-picked hex).
- `src/core/scrollReveal.js` — the fade-up-on-scroll `IntersectionObserver` helper this
  page's Problem/Formats/Proof/Pricing/CTA sections use. Lives in `core/`, not here,
  because it's genuinely format/surface-agnostic (nothing in it assumes marketing-page
  specifics) — any future screen wanting the same "reveal once, never revert" behavior
  reuses it rather than hand-rolling a second observer.

Petrol has no page-specific font files of its own — Chakra Petch and Hanken Grotesk
live in the shared `src/ui/tokens/fonts/`, since they're now the whole app's own
`--font-display`/`--font-body`, not a marketing-only face the way Kinetic's Anton was.

## Fabricated content must stay hidden from assistive tech

The proof section's real event photo/story callout is genuine (Girls Got Drip Vol. 0 —
an actual past event), not illustrative — no `aria-hidden` needed there. The hero's four
rotating photos ARE purely atmospheric (no specific event claimed), so they're
`aria-hidden="true"` with empty `alt` text on every frame; the headline/body copy next
to them carries the actual message, same D9-spirited discipline every previous identity
here has followed. If a future mock/illustrative element gets added to this page, it
needs the same treatment — `aria-hidden="true"` on its outermost element, full stop, not
just an empty `alt` or a hopeful `aria-label`.

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

"Take the tour" and "Start free" CTAs, and the nav's "Org login" link, are `href="#"`.
Not an oversight — there's no tour page and no sign-up flow yet (`loginScreen.js` is
sign-in only; D14's real access control is still a stub). "Formats" and "Pricing" in the
nav are real same-page anchors (`#formats`, `#pricing`); "Timer" is a real link
(`/tools/timer/`). Cup Taster's own "Open Cup Taster →" link is the one real
authenticated-app destination (`/app/#/events`). Wire the rest up as their destinations
get built, not before — and don't add a nav item or copy claiming a capability (an event
archive, an org directory, anything) that isn't real product scope yet; check
`ROADMAP.md` before adding a new claim to this page.

## Assets

`public/marketing/` holds this page's own photos. `hero-tablet.jpg`,
`hero-projector.jpg`, `petrol-hero-cupping-bowls.jpg`, `hero-bracket.jpg` (the hero
slideshow) and `cta-pour.jpg` (the CTA band) came with the design handoff and are
explicitly flagged there as placeholder/reference-quality photography — confirm with
whoever owns the handoff whether these are final or need reshoots before this page is
treated as done. `hero-cupping-bowls.jpg` (no `petrol-` prefix) is the real, pre-existing
event photo from Kinetic's own proof section (Girls Got Drip Vol. 0) — kept under its
original filename and reused for the proof section here specifically because it's
genuine, unlike the handoff's own placeholder photo of the same subject.
