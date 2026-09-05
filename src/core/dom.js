// Minimal DOM builder shared by every format's screens. createElement +
// textContent only, never innerHTML with interpolated data — user-entered
// display names must never be trusted as markup. Format-agnostic (handoff
// §6): a future format's screens reuse this unedited.
export function el(tag, { className, text, attrs, id } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  if (text != null) node.textContent = text;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

// A visible text node paired with a visually-hidden (.sr-only) expansion of
// the SAME value in unambiguous words — e.g. core/duration.js's
// formatDuration()'s "2:00" alongside its formatDurationLong()'s "2 minutes
// 0 seconds" (found in review, ui-accessibility-reviewer: a colon-separated
// numeral read verbatim by assistive tech is a known ambiguous case for TTS
// engines — inconsistently vocalized as a clock time, a ratio, or a
// duration). `title` isn't used for this — patchy screen-reader support on
// non-interactive elements like `<td>` — matching this codebase's own
// established "text-carried, not [visual-format]-alone" convention
// (viewerBody.js's cupper-status suffixes are the precedent). Returns an
// array of nodes, suitable as an `el()` children argument.
export function withSrExpansion(visibleText, hiddenText) {
  return [
    document.createTextNode(visibleText),
    el('span', { className: 'sr-only', text: hiddenText }),
  ];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// Seduh Score's own brand mark — three arcs radiating above a drop, reading
// as an "S" for seduh. Ported verbatim from the legacy Seduh-Score repo's
// shared/assets/seduh-mark.svg (found missing from this codebase entirely —
// every wordmark here was text-only). `currentColor` throughout, per that
// repo's own documented convention ("recolour by setting color: on the
// parent") — this function takes no color param, every consumer controls it
// via CSS. Needs createElementNS, not `el()` (core/dom.js's own module
// comment scopes that to createElement/textContent, and SVG elements
// created without the SVG namespace don't render reliably) — extracted here
// on its 3rd use (appShell.js/splashScreen.js/viewer-shell.js) rather than
// hand-built a third time.
export function brandMark() {
  const svg = svgEl('svg', {
    viewBox: '22 16 56 48',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    role: 'img',
    'aria-label': 'Seduh',
  });
  svg.append(
    svgEl('circle', { cx: '50', cy: '26', r: '5.5', fill: 'currentColor', stroke: 'none' }),
    svgEl('path', { d: 'M26 60 a24 24 0 0 1 48 0' }),
    svgEl('path', { d: 'M35 60 a15 15 0 0 1 30 0' }),
    svgEl('path', { d: 'M44 60 a6 6 0 0 1 12 0' }),
  );
  return svg;
}

// Shared "label above input" wrapper for a screen's own form fields —
// extracted here on its 2nd verbatim use (setupScreen.js's stage rows
// originally; roster registration next) per CONVENTIONS.md's own rule,
// rather than reimplemented a second time. The label is rendered but
// aria-hidden — the input carries its own aria-label instead, so a screen
// reader doesn't announce the same text twice.
export function labeledField(labelText, input, extra = []) {
  return el('div', { className: 'form-field' }, [
    el('span', {
      className: 'form-field-label',
      text: labelText,
      attrs: { 'aria-hidden': 'true' },
    }),
    input,
    ...extra,
  ]);
}
