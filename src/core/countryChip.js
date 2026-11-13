// A country as a small link to its page: flag, the two-letter code as text, and (for a screen reader) what the link
// is for. Format-agnostic: a BTC team row on the audience phone view and on /results/ use it, and so can any format
// that has a team country.
//
// It is SWITCHED OFF with the country pages (core/countryPages.js, COUNTRY_PAGES_PUBLIC): while off, this returns null
// and the caller draws exactly what it drew before. A caller never tests the switch itself; it asks for a chip.
import { el } from './dom.js';
import { COUNTRY_PAGES_PUBLIC, countryPagePath } from './countryPages.js';
import { normaliseCountryCode, renderCountryFlag } from './countryFlag.js';
import { countryName } from './country.js';

/**
 * @param {{ code?: string|null, name?: string|null }|string|null|undefined} country a code, or `{ code, name }`
 * @param {{ enabled?: boolean }} [options] `enabled` is for tests; production uses the switch.
 * @returns {HTMLAnchorElement|null} null when the pages are not public, or there is no usable country
 */
export function buildCountryChip(country, { enabled = COUNTRY_PAGES_PUBLIC } = {}) {
  if (!enabled) return null;
  const rawCode = typeof country === 'string' ? country : country?.code;
  const code = normaliseCountryCode(rawCode);
  const href = code ? countryPagePath(code) : null;
  if (!code || !href) return null;
  const name =
    (typeof country === 'object' && typeof country?.name === 'string' && country.name.trim()) ||
    countryName(code) ||
    code;
  const flag = renderCountryFlag(code);
  return el(
    'a',
    { className: 'country-flaglink', attrs: { href, title: `${name}: country record` } },
    [flag, el('span', { className: 'sr-only', text: ' country record' })],
  );
}
