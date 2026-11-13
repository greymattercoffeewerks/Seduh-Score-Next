// Seduh ID country pages: where they live, and the ONE switch that decides whether anything public points at them.
//
// The pages themselves (/id/country/ and /id/country/<iso2>/) are built, noindex and unlinked. The organiser's
// records behind them were released for the Board presentation ONLY (owner, 2026-11-13: spec
// COUNTRY-PAGES-SPEC-DRAFT, QUESTIONS.md answer 3). So every public entry point is built and switched off:
//   - the country chip on BTC team rows (/results/ and the audience phone view),
//   - the QR code to /id/country/ on the BTC splash and the printed results sheet,
//   - the "Records" link in the public header.
// They all read this one constant. Turning them on is a decision about wider listing (spec CP4, the same
// decision as search indexing), taken by the owner after the Board, and then it is this one line plus the
// sitemap question, never a hunt through the screens. A test holds that no entry point reads anything else.
//
// Pure: no DOM, no network.

/** CP4: false until the owner decides the pages may be linked from the public site. */
export const COUNTRY_PAGES_PUBLIC = false;

/** The canonical public host. A printed or QR link must not depend on whichever host a page was opened on. */
export const PUBLIC_SITE_ORIGIN = 'https://www.seduhscore.com';

export const COUNTRY_HUB_PATH = '/id/country/';

/** The page path of one country, lower case (spec CP3), or null for anything that is not a two-letter code. */
export function countryPagePath(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!/^[A-Za-z]{2}$/.test(trimmed)) return null;
  return `${COUNTRY_HUB_PATH}${trimmed.toLowerCase()}/`;
}

/** The absolute address of the hub, or of one country's page (null for a bad code). */
export function countryHubUrl() {
  return `${PUBLIC_SITE_ORIGIN}${COUNTRY_HUB_PATH}`;
}
export function countryPageUrl(code) {
  const path = countryPagePath(code);
  return path ? `${PUBLIC_SITE_ORIGIN}${path}` : null;
}

/**
 * What a path says about which page to show: the hub, one country (the code upper-cased), or neither. Used by the
 * page's own entry, so the same HTML shell serves every path the build writes.
 * @returns {{ kind: 'hub' } | { kind: 'country', code: string } | { kind: 'none' }}
 */
export function parseCountryPath(pathname) {
  const match = /^\/id\/country\/(?:([A-Za-z]{2})\/?)?(?:index\.html)?$/.exec(
    String(pathname ?? ''),
  );
  if (!match) return { kind: 'none' };
  return match[1] ? { kind: 'country', code: match[1].toUpperCase() } : { kind: 'hub' };
}
