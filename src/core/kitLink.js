// The one check every organiser-kit card (run sheet, warnings) makes on a link a format supplies, before it
// becomes an <a href>. Formats hand over in-app hash routes (`#/events/…`) today; the check stays strict so a
// link built from data (a name, an id) can never become a script address. Pure: no DOM.
//
// Allowed: a hash route (`#…`), a root-relative path (`/…`, not protocol-relative `//…`), and http(s) addresses.
// Anything else (`javascript:`, `data:`, an empty string, a non-string) is null and the caller draws no link.
export function safeHref(href) {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (value === '') return null;
  if (value.startsWith('#')) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}
