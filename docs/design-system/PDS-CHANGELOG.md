# Petrol Design System (PDS): changelog

_One chronological record of the design system's identity and token history. It stitches together entries that
live in `CHANGELOG.md` and `docs/archive/changelog/`; those stay the detailed source. The current-state spec is
`src/ui/tokens/DESIGN.md`. This file records what changed and why, not how the system works today._

## At a glance

| Release                                                      | Date                     | App version                                                    | What it was                                                     | Status                          |
| ------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------- |
| Editorial                                                    | before 2026-09-11        | not recorded                                                   | Clay neutrals, ember accent                                     | Replaced                        |
| Cherry                                                       | 2026-09-11               | not recorded                                                   | Green-black neutrals, chartreuse accent                         | Replaced after two days         |
| **Petrol V1**                                                | 2026-09-13               | 2.0.11 (release #87)                                           | Teal accent, graphite neutrals, zero radius, angular cuts       | Superseded by V2                |
| **Petrol V2 "RON 95"** (P1 to P3, drift guard, public pages) | 2026-11-08 to 2026-11-09 | 3.6.6 (dev #434, release #435)                                 | Token-layer tune-up: Hybrid shape, motion tokens, bevel buttons | Shipped                         |
| **Petrol Kaizen P4**                                         | 2026-11-13               | 4.6.0 (release #459)                                           | Feedback ladder                                                 | Shipped; real-device check owed |
| **Petrol Kaizen P5**                                         | 2026-11-13               | 4.7.0 (dev #458, release #460)                                 | Vocabulary                                                      | Shipped; real-device check owed |
| **Petrol Kaizen P6**                                         | 2026-11-13               | 4.8.0 (dev #461; reached main in release #462, which is 4.9.0) | Token roles and density                                         | Shipped; real-device check owed |

"RON 95" appears only in `Handoffs and Specs/MARCH-2027-BOARD-PLAN.md` (local only) §2 (the V2 plan). The shipped changelog entries say "Petrol V2".

**Where the version numbers come from** (checked 2026-11-23, in git on `origin/main` and `origin/dev`): the
`package.json` version at each release merge commit, and the release commit messages. V1: merge #87 (`4a61157`,
2026-09-13) has 2.0.11, one patch above the previous merge `3e5d2e8` (2.0.10). V2: `66dcc64` "chore: bump to 3.6.6
(Petrol V2, BTC Build A and D)" on dev, carried to main by #435 (`ff60542`). P4: `9e8408d` "Release 4.6.0: Petrol
Kaizen P4 feedback ladder", main merge #459 (`04d242e`). P5: `e735f8a` "Release 4.7.0", main merge #460 (`a6e20d6`).
P6: `4518a4e` "Release 4.8.0: Petrol Kaizen P6 role tokens and compact density", main merge #462 (`f583b14`, 4.9.0).
The P4 dev-side PR number was not found. A release number is the release that carried the work, and some carried
other work too (V2 shipped with BTC Builds A and D).

---

## Versioning and naming (proposed 2026-11-22; owner confirmed V2 = RON 95)

**Format:** `Petrol <fuel grade> · <codename>`, for example "Petrol RON 95 · ECU".

- **Fuel grade = a major era** (an architectural shift or breaking change). It rises in octane: RON 92, 95, 98,
  100 or 102, then Avgas 100LL.
- **Codename = a minor release inside a grade** (new parts, tuning, diagnostics). Named for what it does. No
  alphabetical order is required; the dates give the order.
- **No SemVer for now.** The app already uses SemVer (see `docs/versioning.md`), and the tokens are not a published
  package. The DS label is a name, not a number. Revisit when a package exists.
- **No pre-release tags or tracks yet** (Crude, Octane Booster, Nitro, Reserve Tank). Add them when there is a channel
  that consumes them. **E85 / FlexFuel** is the one track name with a real fit: the per-organiser brand accent
  (`core/brandColor.js`, `data-brand`) already points at multi-brand theming.
- **Reserved for later, in this order of ambition:** RON 98, RON 100 / 102, Avgas 100LL; paradigm names
  Afterburner, Hyperdrive, KERS, Volt / Hybrid.
- **Changelog header:** `## Petrol RON 95 · ECU · 2026-11-13`.

### Retroactive labels (all proposed, owner may rename)

| Era                                                   | Grade      | Codename                  | Why this name                                                                                                           |
| ----------------------------------------------------- | ---------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Petrol V1 (2026-09-13)                                | RON 92     | none (first grade)        | Street fuel baseline. The "92" comes from the other discussion; the repo does not record it.                            |
| V2 P1 tokens, P2 components, P3 surfaces (2026-11-08) | **RON 95** | none (the grade's launch) | Matches the repo's "RON 95" plan name.                                                                                  |
| V2 drift guard + public pages (2026-11-08 to 09)      | RON 95     | **Dyno**                  | The guard is a test bench that fails on any drift from the tokens; the public pages were the first rollout it measured. |
| Kaizen P4: feedback ladder (2026-11-13)               | RON 95     | **Telemetry**             | How the app reports back to the operator (inline, toast, confirm, dialog).                                              |
| Kaizen P5: vocabulary (2026-11-13)                    | RON 95     | **Gauge**                 | Status marks, meter, stat, steps: the instrument cluster.                                                               |
| Kaizen P6: token roles + compact density (2026-11-13) | RON 95     | **ECU**                   | A role layer between parts and tokens: one control unit mapping intent to values.                                       |

"Kaizen" stays as the programme name for P4 to P6 in the older entries; the codenames are the release names within it.

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

## Petrol V1 · 2026-09-13 · app 2.0.11 (release #87)

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

**Known weaknesses that V2 later addressed** (recorded in `Handoffs and Specs/MARCH-2027-BOARD-PLAN.md` (local only) §2.1)

- Small type dominated; thirteen type steps, no fluid steps.
- Input border failed WCAG 1.4.11 (2.47:1 on surface).
- Disabled state was opacity (about 3.1:1); 13 distinct opacity literals.
- No state tokens, no motion tokens; fixed loose density; raw px and literal breakpoints in marketing CSS.
- Every card framed in 2px graphite.

Source: `docs/archive/changelog/2026-09-H1.md` (line 643).

---

## Petrol V2 "RON 95" · 2026-11-08 to 2026-11-09 · app 3.6.6 (dev #434, release #435)

Planned as a **token-layer tune-up, not a rebrand**: no new palette or fonts, no hue changes (the marketing
guidance warns against a fifth identity swap). Delivered in three phases, a drift guard, then the public pages. Each
phase was a separate branch, not merged until the owner combined them (dev PR #434); the version bump to 3.6.6 came
with that merge, and it went live with release #435.

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

Sources: `docs/archive/changelog/2026-11-H2.md` (lines 31 to 88); plan in `Handoffs and Specs/MARCH-2027-BOARD-PLAN.md` (local only) §2.

---

## Petrol Kaizen · 2026-11-13

Four post-V2 items, shipped one at a time. Only P4, P5 and P6 appear in the changelog; this file found no entry for
a Kaizen P1, P2 or P3, so the numbering continues from V2's P1 to P3.

### P4: the feedback ladder · app 4.6.0 (release #459)

- Written ladder in `DESIGN.md`: inline line, toast (success only), confirm in place (undoable), dialog (permanent
  delete only). Parts: `core/feedback.js`, `feedback.css`; `emptyState()` and `.empty` with three kinds.
- All seven `window.confirm` calls removed.
- Field states: `aria-invalid` gives a 2px danger edge plus its own mark (not colour alone); readonly dashed;
  new `--opacity-disabled` (0.5) replaces four hand-written disabled opacities.
- Shipped as 4.6.0 (per P6's entry). Review: 1 🔴 each from `ui-accessibility-reviewer`, `code-reviewer`,
  `test-auditor`, all fixed and re-checked.
- Open: five in-screen toasts still bypass core `toast()`; older inline confirms; `.gtb-input` has no
  `aria-invalid` edge; admin hint order. Real-tablet check owed.

### P5: the vocabulary · app 4.7.0 (dev #458, release #460)

- `.status` with `data-state` `live`, `queued`, `done`, `attention`, `failed`, `offline`, `test` (shape plus
  colour, never colour alone; `test` is the only violet). Also `.tabs`, `.stat`, `.meter`, `.steps`,
  `.countdown-cue`.
- `core/tablist.js` (roving tabindex, Arrow/Home/End) and `core/vocabulary.js`.
- `.ok-tag` and `.ok-bar` removed; three copies of the urgent countdown ring became one.
- About 45 badge/chip/pill names left as-is, each with a reason in `LEFT_AS_IS`.
- Real bug fixed in browser: status mark backgrounds used `currentColor`.
- Open: name chips to `.status`; unify three countdown tickers; "Done" is announced only via CSS alt text;
  forced-colors and reduced-motion runs; Honor tablet check.

### P6: token roles and compact density · app 4.8.0 (dev #461; on main in release #462, 4.9.0)

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

Design-system-relevant entries in `CHANGELOG.md` after P6, to current dev (4.29.0):

- **Console Menu button in forced colours, 4.17.2 · 2026-11-17:** the three bars get `ButtonText` under
  `forced-colors: active`. Owner check on a real Windows high-contrast render is owed.
- **Status message animation, 4.20.2 · 2026-11-19:** the `.screen-feedback` entry animation now sits inside a
  `prefers-reduced-motion: no-preference` block; the convention is recorded in `CONVENTIONS.md` ("Design tokens").
- **Community tool frame, 4.21.0 and 4.22.0 · 2026-11-19:** a shared public frame (header, breadcrumb, tools strip,
  footer) on every community tool, and one shared card renderer. Not a token change.
- **Throwdown scoresheet, 4.25.0 · 2026-11-20:** Petrol field errors applied. A pre-existing finding was logged:
  screen readers may read the "!" mark in shared `feedback.css` aloud before the message.
- **Throwdown projector on the shared projector kit, 4.26.0 · 2026-11-21 (#539):** stage match card, page loop,
  new-result detection and champion screen moved into `src/core/` (`stage-*` classes renamed from `btc-stage-*`).
  A component extraction, not a token change. The owner's TV check is outstanding.
- **Figma review fixes, 4.29.0 · 2026-11-24:** an outside (Figma) review of Petrol was checked against the code; three
  gaps were real. (1) Stage muted text moved from `petrol-400` (4.46:1 canvas, 4.16:1 surface) to a new ramp step
  `--clr-petrol-350` (`#82938f`, 6.01:1 and 5.60:1), the only token value change after P6 (paper untouched, borders
  untouched). (2) The audience display now shows "Updated HH:MM" and, on a lost connection or 90 s of silence,
  "Connection lost — showing results from HH:MM" with its Live marker withdrawn (`core/freshness.js`, in the viewer
  shell, so every format gets it). (3) The standalone Timer's Reset is its own row and asks first (feedback ladder
  step 3) while a run is going. Rules in `DESIGN.md` "Figma review fixes". Owner's real-venue check owed.

No new Petrol identity release is recorded after Kaizen P6; the 4.29.0 muted step is a token correction inside it.

---

## Gaps in the record

- No entry for a Kaizen P1 to P3 (or the fourth Kaizen item beyond P4 to P6).
- Release numbers are not stated in the changelog entries themselves; the ones above come from git (see "Where the
  version numbers come from"). Not found: the dev-side PR number for P4, the app version for Editorial and Cherry,
  and any PR numbers for V2's P1 to P3 (they were merged in branches into #434).
- The retroactive grade for V1 (RON 92) and every codename are proposals; only "V2 = RON 95" is owner-confirmed.
- The V2 plan's open questions (15px versus 16px phone body; uppercase marketing kickers) have no recorded answer here.
  Whether the plan's §2.2 items (type scale, `--text-xs` retirement, fluid type, `core/breakpoints.js`, state
  tokens) all shipped was not checked against code for this file.
- Real-device checks (Honor tablet, iPad) are logged as owed for P4, P5 and P6.
