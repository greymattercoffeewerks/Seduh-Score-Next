// The one check every organiser-kit card (run sheet, warnings, live card) makes on a link before it becomes an
// <a href>. Formats hand over in-app hash routes (`#/events/…`) today; the check stays strict so a link built
// from data (a name, an id) can never become a script address or leave the site. Pure: no DOM.
//
// Allowed: a hash route (`#…`), a root-relative path (`/…`, not protocol-relative `//…` or `/\…`), and http(s)
// addresses. Anything else (`javascript:`, `data:`, an empty string, a non-string) is null and the caller draws
// no link.
export function safeHref(href) {
  if (typeof href !== 'string') return null;
  // Browsers drop tab, CR and LF inside an address and read a backslash as a slash, so those are removed
  // before any check (`/<tab>/host` and `/\host` would otherwise become protocol-relative).
  const value = href.replace(/[\t\r\n]/g, '').trim();
  if (value === '') return null;
  if (value.startsWith('#')) return value;
  if (value.startsWith('/') && !/^\/[/\\]/.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

// A page-unique id for a kit card's heading or label, so two cards of one kind on a page never share an id
// (aria-labelledby and aria-describedby would resolve to the first). Pure apart from the counter.
let idCounter = 0;
export function kitId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
