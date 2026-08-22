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
