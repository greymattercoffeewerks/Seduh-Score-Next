# 02 — A very long champion name must not overflow the projector

Read `README.md` in this folder first. Branch: `codex/champion-name-clamp`.

## Why

ROADMAP, "Known open items from T-BTC.projector-screens": _"A very long champion name
overflows at 4:3 (a 51-character name; 31 characters fit). `core/stageVocabulary.css`'s
`.stage-champion-name` has no clamp and is shared with Cup Taster."_

On a venue TV the champion screen is the one screen that must never look broken. Team and
cupper names are free text, so a long one has to degrade gracefully, not run off the
display.

## Where

- `src/core/stageVocabulary.css` ~L117–124:

  ```css
  .stage-champion-name {
    margin: 0;
    text-align: center;
    font-family: var(--font-display);
    font-size: max(2rem, calc(17.7 * var(--stage-fit)));
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  ```

  `--stage-fit` is 1% of the stage area's height (a size container). See
  `src/core/CLAUDE.md`, the `stageSurface … stageDisplay` paragraph: format screens must
  size with `--stage-fit`, never `vh`.

- `src/core/stageVocabulary.js` ~L82 builds it: `el('h2', { className: 'stage-champion-name', text: name })`
  inside `renderChampion`.
- Consumers: Cup Taster's champion screen and BTC's (`projectorScreens.js` in each format).
- Dev harnesses to look at it: `src/formats/btc/projectorSurface.preview.html` and
  `src/formats/cup-taster/projectorSurface.preview.html` (run `npm run dev`). Use the
  Playwright MCP or `npx playwright` to resize to **4:3 (1024×768)**, **16:9 (1920×1080)**
  and a banner-ish ratio (e.g. 1920×540).

## What to do

1. Reproduce: show the champion screen with a 51-character name at 1024×768 and confirm it
   overflows the stage area (clipped, or pushing the score/podium lines off-screen).
2. Fix it so the name always fits inside the stage area at those three ratios, up to a
   sensible maximum (a 60-character name must still be fully visible; beyond ~80 characters
   it is acceptable to ellipsize with a visible `title`, but say what you chose).
   Prefer CSS only. Options, in the order I would try them:
   - `text-wrap: balance` plus a smaller `font-size` floor and `max-width` on the element;
   - a CSS container-query / `clamp()` step-down keyed to the stage width;
   - only if CSS cannot do it: `renderChampion` sets a `data-length="long"` attribute when
     the name is over N characters and CSS steps the size down. Keep the rule in core;
     do not special-case a format.
3. A name of 31 characters or fewer must render **exactly as before** (same computed
   `font-size`) — do not shrink normal names.
4. Do not change how the name is put in the DOM (text, never markup).

## Acceptance

- Screenshots (or measured `getBoundingClientRect` values) at 1024×768, 1920×1080 and
  1920×540 for: a 12-character name, a 31-character name (unchanged from before), a
  51-character name and a 60-character name, in both formats' champion screens. Put the
  numbers (or the images) in the PR.
- A test that pins the new behaviour. The repo's CSS tests are stylesheet guards (read the
  `.css` text and assert the rule exists — see `appShell.test.js` and
  `viewer-shell.test.js` for the style) plus DOM tests in `src/core/stageVocabulary.test.js`.
  Assert the invariant (long names get the step-down; short names do not), not the
  literal CSS.
- Cup Taster's and BTC's champion tests still pass unedited.
- `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
- CHANGELOG entry; ROADMAP bullet marked CLOSED (T-HARDEN.champion-name-clamp).

## Do not

- Touch the podium or score lines, or anything else in `stageVocabulary.css`.
- Use `vh`/`vw` units for the new sizing (use `--stage-fit` or container units).
