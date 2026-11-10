// A country as a small flag plus its two-letter code: the code is ALWAYS text, the flag is decoration
// (`aria-hidden`, empty alt), so nothing depends on seeing the picture. 24 by 16, one self-hosted SVG per code
// in `core/flags/` (flag-icons, MIT, see core/flags/README.md; no CDN, a venue's wifi cannot be relied on).
// Every code in `core/country.js` has a file (a test holds that).
//
// Format-agnostic: any format's team, entrant or judge can show one; a format decides WHERE a flag may appear
// (team flags may reach the audience surfaces, judge flags stay organiser-only). Styled in components.css
// (`.ok-flag*`).
//
// The files are loaded lazily (one small request per flag actually shown) so no flag lands in a page's main
// bundle; until a file arrives the flag box is a plain hollow frame, and the code text is already there.
import { el } from './dom.js';
import { isCountryCode } from './country.js';

const FLAG_LOADERS = import.meta.glob('./flags/*.svg', { query: '?url', import: 'default' });
const PREFIX = './flags/';
const SUFFIX = '.svg';

// Pure. The two-letter code in its canonical upper case, or null when `code` is not shaped like one.
export function normaliseCountryCode(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

// Pure. The key of a code's flag file in the glob above, or null for a code with no flag.
export function flagPath(code) {
  const normal = normaliseCountryCode(code);
  if (!normal || !isCountryCode(normal)) return null;
  const path = `${PREFIX}${normal.toLowerCase()}${SUFFIX}`;
  return Object.hasOwn(FLAG_LOADERS, path) ? path : null;
}

// Pure. Whether a code has a flag file.
export function hasFlag(code) {
  return flagPath(code) !== null;
}

// The codes that have a flag file (for tests and the preview harness).
export function flagCodes() {
  return Object.keys(FLAG_LOADERS).map((path) =>
    path.slice(PREFIX.length, -SUFFIX.length).toUpperCase(),
  );
}

/**
 * DOM. `<span class="ok-flag">flag + code</span>`, or null when there is no country (nothing to draw: the caller
 * decides whether a missing country needs a word). A code with no flag file shows the code alone.
 * @param {string|null|undefined} code
 * @param {{ resolveUrl?: (path: string) => Promise<string> }} [options] injectable for tests
 */
export function renderCountryFlag(code, { resolveUrl } = {}) {
  const normal = normaliseCountryCode(code);
  if (!normal) return null;
  const children = [];
  const path = flagPath(normal);
  if (path) {
    const img = el('img', {
      className: 'ok-flag-img',
      attrs: { alt: '', width: '24', height: '16', 'aria-hidden': 'true', decoding: 'async' },
    });
    const load = resolveUrl ? resolveUrl(path) : FLAG_LOADERS[path]();
    Promise.resolve(load)
      .then((url) => {
        img.src = url;
      })
      .catch(() => {
        // A flag that will not load is only a missing picture: the code beside it still says the country.
        img.hidden = true;
      });
    children.push(img);
  }
  children.push(el('span', { className: 'ok-flag-code', text: normal }));
  return el('span', { className: 'ok-flag', attrs: { 'data-country': normal } }, children);
}
