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

// Exported on its 2nd real consumer (src/marketing/landingScreen.js's format
// icons) — createElementNS is required for any SVG element, not just
// brandMark()'s own, so this stays the one shared primitive for it rather
// than a second copy.
export function svgEl(tag, attrs = {}) {
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

// Marks a control as busy/unavailable via `aria-disabled`/`aria-busy`
// instead of the native `disabled` attribute. Native `disabled` removes an
// element from the focus order the instant it's set — if that element
// currently HAS focus (a submit button mid-click, a checkbox/select
// mid-toggle), focus silently drops to `<body>` with no way back. Every
// caller of this helper is expected to already guard its own handler
// against re-entry while busy (double-submit protection this codebase
// already has everywhere `disabled` was previously the only such guard) —
// `aria-disabled` is advisory only and does not itself block events. Found
// across two ui-accessibility-reviewer passes (core/loginScreen.js +
// src/community/guess-the-bean/authScreen.js and setupScreen.js).
export function setBusyDisabled(node, isBusy) {
  if (isBusy) {
    node.setAttribute('aria-disabled', 'true');
    node.setAttribute('aria-busy', 'true');
  } else {
    node.removeAttribute('aria-disabled');
    node.removeAttribute('aria-busy');
  }
}

// Wraps a full-teardown render() (`root.innerHTML = ''` then a full
// rebuild — this codebase's universal screen-render pattern) so the
// control that had focus keeps it across the rebuild. Without this, every
// render() call drops focus to `<body>`: the focused DOM node itself is
// destroyed, not merely relabeled, so the browser has nothing to keep
// focus on. Identifies the focused control by a stable identifier
// (`data-focus-key`, falling back to `data-field`, falling back to `id`)
// rather than by position or node reference, since a rebuild can reorder
// or entirely replace siblings — the caller is responsible for putting a
// matching attribute on any control that should survive a rebuild with
// focus intact. If the equivalent control in the new tree is itself still
// genuinely unfocusable (real `disabled`, or gone entirely), the browser's
// own `.focus()` no-op is the fallback, same as focusing nothing.
//
// `renderFn` may return `true` to mean "I already moved focus somewhere
// deliberately this render (e.g. an error announcement)" — that opts out
// of the restore below, so this helper never fights an intentional focus
// move with a stale one.
// `CSS.escape` isn't implemented in every environment this module runs in
// (notably this project's own jsdom test environment) — this falls back to
// a minimal manual escape rather than assuming the global exists.
function escapeSelectorValue(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export function withFocusPreservation(root, renderFn) {
  const active = document.activeElement;
  let selector = null;
  if (active && root.contains(active)) {
    // Every value currently passed to these attributes is a static,
    // developer-authored string, so this escaping is cheap insurance
    // rather than a fix for a live bug — but this module's own contract is
    // reuse by a future format, and nothing stops a later caller from
    // deriving an id/data-field value dynamically (a UUID with no
    // guarantee of being a valid CSS identifier, say). Without
    // CSS.escape(), such a value could throw a SyntaxError out of
    // querySelector() and break the entire render, not just the focus
    // restore. Found in review (code-reviewer).
    const focusKey = active.getAttribute('data-focus-key');
    const field = active.getAttribute('data-field');
    if (focusKey) selector = `[data-focus-key="${escapeSelectorValue(focusKey)}"]`;
    else if (field) selector = `[data-field="${escapeSelectorValue(field)}"]`;
    else if (active.id) selector = `#${escapeSelectorValue(active.id)}`;
  }
  const focusHandled = renderFn();
  if (!focusHandled && selector) root.querySelector(selector)?.focus();
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
