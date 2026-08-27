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
