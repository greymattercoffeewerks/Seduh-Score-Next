# Petrol Design System (PDS): changelog

_One chronological record of the design system's identity and token history. It stitches together entries that
live in `CHANGELOG.md` and `docs/archive/changelog/`; those stay the detailed source. The current-state spec is
`src/ui/tokens/DESIGN.md`. This file records what changed and why, not how the system works today._

## At a glance

| Release | Date | What it was | Status |
|---|---|---|---|
| Editorial | before 2026-09-11 | Clay neutrals, ember accent | Replaced |
| Cherry | 2026-09-11 | Green-black neutrals, chartreuse accent | Replaced after two days |
| **Petrol V1** | 2026-09-13 | Teal accent, graphite neutrals, zero radius, angular cuts | Superseded by V2 |
| **Petrol V2 "RON 95"** (P1 to P3, drift guard, public pages) | 2026-11-08 to 2026-11-09 | Token-layer tune-up: Hybrid shape, motion tokens, bevel buttons | Shipped |
| **Petrol Kaizen P4 to P6** | 2026-11-13 | Feedback ladder, vocabulary, token roles and density | Shipped; real-device checks owed |

"RON 95" appears only in `MARCH-2027-BOARD-PLAN.md` §2 (the V2 plan). The shipped changelog entries say "Petrol V2".
Version numbers of the app releases that carried these phases are not recorded in the entries this file draws on, so
none are given here, except where an entry states one.

---

## Before Petrol (context)

### Editorial → Cherry · 2026-09-11

Whole-product refresh after landing-page feedback that Editorial (clay neutrals, ember accent, Cabinet Grotesk /
Switzer / JetBrains Mono) read as "too Claude, too Anthropic". Three throwaway directions were pitched (Cherry,
Night Cupping, Scoresheet); the owner chose Cherry for console and marketing.

- Bottle-green-black neutral ramp; chartreuse-green accent (`#33490f` paper, `#bfe23f` stage); ripe-cherry danger
  (darkened to `#4d0a05` after review found a serious contrast gap).
- Fonts: Bricolage Grotesque, IBM Plex Sans, IBM Plex Mono.
- Lived two days before Petrol replaced it.

Source: `docs/archive/changelog/2026-09-H1.md` (line 1369).

---

## Petrol V1 · 2026-09-13

**Owner decision** to adopt an externally produced design handoff as the identity for the whole product, not only
the landing page. Replaced Kinetic (the landing page's own identity at the time) and reversed the old rule that
marketing must not import `src/ui/tokens/colors.css`: marketing and console now share one token set.

**Shipped**
- Full replacement of `colors.css`, `typography.css`, `spacing.css`, `base.css`, `fonts.css`: one neutral ramp,
  teal accent, graphite neutrals, **paper / stage dual surface mode**, semantic token symmetry.
- **Shape language:** every `--radius-*` set to `0`; angular cuts (`.cut-*` classes) on buttons and frames.
- Fonts, self-hosted: Chakra Petch (500/600/700) and Hanken Grotesk (variable). Bricolage, IBM Plex and Anton removed.
- Landing page rebuilt against the handoff; `core/scrollReveal.js` added; the standalone `public/bts` page reskinned
  by hand (it sits outside Vite's module graph).
- `DESIGN.md` and `preview.html` rewritten for the new palette.

**Fixed in review**
- Dark bands using `--clr-petrol-600` measured 3.7:1 and 2.3:1 for text; moved to `--clr-petrol-800` (6.1:1).
- Dimmed "soon" rows stacked `opacity: 0.7` on marginal contrast; opacity removed.
- Several controls under the 44px tap-target floor (nav toggle, slide dots, CTAs, links) fixed to `--tap-target-min`.

**Known weaknesses that V2 later addressed** (recorded in `MARCH-2027-BOARD-PLAN.md` §2.1)
- Small type dominated; thirteen type steps, no fluid steps.
- Input border failed WCAG 1.4.11 (2.47:1 on surface).
- Disabled state was opacity (about 3.1:1); 13 distinct opacity literals.
- No state tokens, no motion tokens; fixed loose density; raw px and literal breakpoints in marketing CSS.
- Every card framed in 2px graphite.

Source: `docs/archive/changelog/2026-09-H1.md` (line 643).

---

## Petrol V2 "RON 95" · 2026-11-08 to 2026-11-09

Planned as a **token-layer tune-up, not a rebrand**: no new palette or fonts, no hue changes (the marketing
guidance warns against a fifth identity swap). Delivered in three phases, a drift guard, then the public pages. Each
phase was a separate branch, not merged until the owner combined them; no version bump was made in these entries.

### P1: design tokens · 2026-11-08
- **Hybrid shape rule:** `--radius-sm/md/lg` = 3/6/10px; `--radius-full` for circles only; `--bevel-md/lg` added.
  This ends V1's zero-radius rule.
- New `motion.css` (`--dur-*`, `--ease-out`); one global reduced-motion rule in `base.css`.
- Teal tints and `--color-accent-tint(-text)` in both modes, with contrast rows in `DESIGN.md`.
- 14 `--radius-full` pills moved to `--radius-sm` so none became a pill. Cards lost the 2px black frame.
- Review found the hairline card edge too faint (2.1:1); fixed with `--color-border-card` (3.4:1 paper, 4.5:1 stage).

### P2: shared components · 2026-11-08
- **Bevel buttons:** `.btn-bevel`, and `.btn .btn-primary .btn-lg`, via `corner-shape` inside `@supports` with an
  asymmetric-radius fallback; never `clip-path`.
- `.cut-sm` / `.cut-md` retired (`.cut-lg` kept for the random selector board only).
- States: hover and press transitions, `[aria-busy='true']` bottom-edge line, `.is-selected` / `.selectable`.
- **`--color-border-input`** (petrol-400): 4.00:1 on paper surface, 4.16:1 on stage; was 2.09:1 / 2.47:1. Closes the
  WCAG 1.4.11 finding for inputs.
- Review: three 🔴 fixed (duplicate `.btn-lg` rule, a sheet counted wrongly, a corrupted glyph).

### P3: surfaces · 2026-11-08
- `core/rankMotion.js`: standings rows slide to their new rank (FLIP), numbers tick; instant under reduced motion.
- `core/skeletonBoard.js`: placeholder board while connecting. Live blip is a 4s breathe.
- Long names in phone standings cut with an ellipsis; `text-wrap: balance` on stage titles.
- Motion tokens replace hand-written durations across landing, results, tour, community, Guess the Bean, stage
  moments and `public/bts`. New `--clr-white`, `--clr-black`, `--clr-chart-1..8`.
- Left for later: 360px and 16:9 browser pass; a shared `prefersReducedMotion()` helper.

### Drift guard · 2026-11-08
- `tokenDrift.test.js` fails on a raw colour, off-token radius, time/easing literal in `transition`/`animation`, or
  `clip-path: polygon()` outside `src/ui/tokens/`. The exact-count `ALLOWLIST` fails both on new drift and on stale entries.
- First run found 89 literals (50 colour, 38 motion, 1 radius); fixed onto tokens with no visual change.
- Known gap: longhand `animation-delay` / `transition-delay` offsets are unchecked (10 sites).

### Public pages · 2026-11-09
- Shared primitives in `base.css`: `.tag`, `.panel`, `.icon-frame`, `.menu-toggle`, `.action`.
- Landing, header and footer, pricing, tour, results and community hub migrated; dead CSS deleted.
- Tags are 11px mono caps with a 3px corner; cards and the landing plate 6px.
- Guard extended to painted boxes with no token radius and to page-local tag/badge/dot/toggle copies.

Sources: `docs/archive/changelog/2026-11-H2.md` (lines 31 to 88); plan in `MARCH-2027-BOARD-PLAN.md` §2.

---

## Petrol Kaizen · 2026-11-13

Four post-V2 items, shipped one at a time. Only P4, P5 and P6 appear in the changelog; this file found no entry for
a Kaizen P1, P2 or P3, so the numbering continues from V2's P1 to P3.

### P4: the feedback ladder
- Written ladder in `DESIGN.md`: inline line, toast (success only), confirm in place (undoable), dialog (permanent
  delete only). Parts: `core/feedback.js`, `feedback.css`; `emptyState()` and `.empty` with three kinds.
- All seven `window.confirm` calls removed.
- Field states: `aria-invalid` gives a 2px danger edge plus its own mark (not colour alone); readonly dashed;
  new `--opacity-disabled` (0.5) replaces four hand-written disabled opacities.
- Shipped as 4.6.0 (per P6's entry). Review: 1 🔴 each from `ui-accessibility-reviewer`, `code-reviewer`,
  `test-auditor`, all fixed and re-checked.
- Open: five in-screen toasts still bypass core `toast()`; older inline confirms; `.gtb-input` has no
  `aria-invalid` edge; admin hint order. Real-tablet check owed.

### P5: the vocabulary
- `.status` with `data-state` `live`, `queued`, `done`, `attention`, `failed`, `offline`, `test` (shape plus
  colour, never colour alone; `test` is the only violet). Also `.tabs`, `.stat`, `.meter`, `.steps`,
  `.countdown-cue`.
- `core/tablist.js` (roving tabindex, Arrow/Home/End) and `core/vocabulary.js`.
- `.ok-tag` and `.ok-bar` removed; three copies of the urgent countdown ring became one.
- About 45 badge/chip/pill names left as-is, each with a reason in `LEFT_AS_IS`.
- Real bug fixed in browser: status mark backgrounds used `currentColor`.
- Open: name chips to `.status`; unify three countdown tickers; "Done" is announced only via CSS alt text;
  forced-colors and reduced-motion runs; Honor tablet check.

### P6: token roles and compact density
- New role layer `roles.css`: radius roles (`--radius-field`, `-selector`, `-box`, `-dialog`) and colour roles
  (`--btn-primary-*`, `--field-edge`, `--box-edge`, `--selected-*`), each a bare `var()` of a semantic token.
- Pixel proof: about 260,000 property comparisons old versus new, no difference.
- `data-density="compact"`, opt-in on BTC matches, BTC standings and Cup Taster heats; spacing only, 44px floor
  held by a test (BTC matches screen 4657 to 4112px at 360px).
- Drift guard: token parts may not read `--radius-sm/-md/-lg`; screen sheets are a ratchet (22 files, 71 direct reads).
- Described as the last Kaizen phase. Real-iPad check owed.

Sources: `CHANGELOG.md` (lines 695 to 755); `src/ui/tokens/DESIGN.md`; backlog items in `docs/backlog/*.md`.

---

## Since Kaizen

- **Throwdown scoresheet, 4.25.0 · 2026-11-20:** Petrol field errors applied. A pre-existing finding was logged:
  screen readers may read the "!" mark in shared `feedback.css` aloud before the message.

---

## Gaps in the record

- No entry for a Kaizen P1 to P3 (or the fourth Kaizen item beyond P4 to P6).
- Release numbers for V1, V2 and P5/P6 are not stated in the source entries.
- The V2 plan's open questions (15px versus 16px phone body; uppercase marketing kickers) have no recorded answer here.
  Whether the plan's §2.2 items (type scale, `--text-xs` retirement, fluid type, `core/breakpoints.js`, state
  tokens) all shipped was not checked against code for this file.
- Real-device checks (Honor tablet, iPad) are logged as owed for P4, P5 and P6.
