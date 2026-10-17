// The brand slot (BRANDING-SPEC 3.1 and 3.2, task BR-D2): how an organiser's identity (a display name and a logo) is
// drawn on an audience surface, and how their accent colour is applied to it. Format-agnostic and used by every
// surface (the projector band, the splash, the phone), so they cannot drift apart. It never fetches anything: the
// caller hands it what the public door returned (BR-E1 wires that), and everything here treats it as untrusted.
//
//   normaliseBrand(input)               the cleaned brand, or null when there is nothing usable to show
//   renderBrandIdentity(brand, opts)    the logo and display name, as one element
//   applyBrandColors(root, brand, mode) set (or clear) the three accent properties on a surface's root
//
// "Branded" means an identity is present (a display name or a logo). A brand with only an accent colour is not
// branded: with nothing to put in the slot, the surface keeps its ordinary Seduh Score identity and colours.
//
// What never happens: a name is set as text, never markup; a logo address that is not a plain https image address is
// dropped, never loaded; a logo that fails to load is removed and the name stays; the only properties ever set on a
// surface are the three accent ones (brandColor.js), so a brand cannot reach the TEST colour or any status colour.
import { el, brandLockup } from './dom.js';
import { brandCssVariables, isBrandHex } from './brandColor.js';
import { cleanOrgName } from './orgLabel.js';

export const MAX_DISPLAY_NAME = 60;
const MAX_LOGO_ALT = 120;
const MAX_LOGO_URL = 2048;
// The three properties brandCssVariables can ever return. applyBrandColors sets and clears ONLY these, whatever else
// that function might one day return, so "a brand touches three properties" is true here, not just in brandColor.js.
const ACCENT_PROPERTIES = ['--color-accent', '--color-accent-hover', '--color-accent-contrast'];

// Characters that draw nothing: every format control (zero-width space, joiners, word joiner, soft hyphen, bidi
// marks) and the Hangul and Braille fillers that render as blanks. A name made only of these is not a name.
// The zero-width non-joiner and joiner (U+200C, U+200D) are kept INSIDE a name, because they are spelling in Persian
// and Dari (non-joiner) and in emoji sequences (joiner); they are still removed at either end, where they mean nothing.
const INVISIBLE = /(?![‌‍])[\p{Cf}ᅟᅠㅤﾠ⠀]/gu;
const EDGE_JOINERS = /^[‌‍\s]+|[‌‍\s]+$/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

const text = (value, max) => {
  if (typeof value !== 'string') return '';
  // Whitespace runs collapse, so a name with line breaks or tabs sits on one line. cleanOrgName also strips the
  // invisible text-direction controls that can scramble the words around a name.
  const cleaned = cleanOrgName(value)
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .replace(EDGE_JOINERS, '');
  // Counted in characters, not UTF-16 units (an emoji is one), and it must contain something a person can see.
  return [...cleaned].length > max || !VISIBLE.test(cleaned) ? '' : cleaned;
};

// Own properties only: an object that merely inherits a field (from a prototype) is not the door's answer.
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

// A logo address must be plain https. (The local development stack serves Storage over http on this machine, so
// http is accepted for the loopback addresses only.) No data:, javascript:, blob:, file: or protocol-relative
// address, no credentials in the address, and a sane length.
function safeLogoUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LOGO_URL) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  if (url.username || url.password) return null;
  // Defence in depth for the "no SVG, no animated formats" rule (BRANDING-SPEC D-BR6): the upload path is what
  // enforces it, and the display refuses these too, so a bad object that ever got into Storage is not drawn.
  if (/\.(svgz?|gif|html?)$/i.test(url.pathname)) return null;
  return url.href;
}

/**
 * The cleaned brand `{ displayName, logoUrl, logoAlt, accentHex }`, or null when there is no identity to show.
 * Each field is dropped (not repaired) when it is not usable: a name over 60 characters, a logo that is not a plain
 * https address, an accent that is not a strict #rrggbb.
 */
export function normaliseBrand(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const displayName = text(own(input, 'displayName'), MAX_DISPLAY_NAME);
  const logoUrl = safeLogoUrl(own(input, 'logoUrl'));
  if (!displayName && !logoUrl) return null;
  const accent = own(input, 'accentHex');
  return {
    displayName,
    logoUrl,
    logoAlt: text(own(input, 'logoAlt'), MAX_LOGO_ALT),
    accentHex: isBrandHex(accent) ? accent.toLowerCase() : null,
  };
}

/**
 * The brand's identity as one element: the logo (if any) and the display name (if any). `brand` must already be
 * normalised. `nameTag` lets a surface make the name its heading ('h1') or leave it plain text ('span').
 * A logo that fails to load removes itself, so a slow or missing image never breaks a screen: the name stays, and a
 * brand that is only a logo falls back to the Seduh Score lockup rather than leaving an empty slot (or an empty
 * heading) behind. A surface whose credit already carries the lockup right beside it (the projector band) passes
 * `lockupFallback: false`, so a failed logo never leaves two lockups on screen.
 */
export function renderBrandIdentity(
  brand,
  { nameTag = 'span', className = '', lockupFallback = true } = {},
) {
  const children = [];
  let slot = null;
  if (brand.logoUrl) {
    // The name sits beside the logo, so the logo is decorative unless the organiser wrote a different description
    // (reading the same name twice helps nobody). With no name, the logo carries the identity and needs a label.
    const alt = brand.displayName
      ? brand.logoAlt && brand.logoAlt !== brand.displayName
        ? brand.logoAlt
        : ''
      : brand.logoAlt || 'Logo';
    const img = el('img', {
      className: 'brand-slot-logo',
      attrs: {
        src: brand.logoUrl,
        alt,
        decoding: 'async',
        referrerpolicy: 'no-referrer',
        draggable: 'false',
      },
    });
    img.addEventListener(
      'error',
      () => {
        img.remove();
        if (lockupFallback && !brand.displayName && slot)
          slot.append(brandLockup({ name: 'Seduh Score' }));
      },
      { once: true },
    );
    children.push(img);
  }
  if (brand.displayName) {
    // dir="auto": a right-to-left name (Arabic, Jawi) truncates from its logical end, not its opening words.
    children.push(
      el(nameTag, {
        className: 'brand-slot-name',
        text: brand.displayName,
        attrs: { dir: 'auto' },
      }),
    );
  }
  // A heading is not allowed inside a <span>, so the slot is a <div> when the name is a heading and a <span> when it
  // sits inside one (the phone's <h1>).
  slot = el(
    nameTag === 'span' ? 'span' : 'div',
    { className: `brand-slot${className ? ` ${className}` : ''}` },
    children,
  );
  return slot;
}

/**
 * Sets the brand's accent colours on an element a SURFACE OWNS (never the shared audience root, which outlives the
 * screen and would leak the colours into whatever is mounted next), or clears them when there is no brand. `mode` is
 * the surface's token mode, 'stage' (the dark projector and splash) or 'paper' (the phone). Sets and clears only the
 * three accent properties, plus a `data-brand` marker a stylesheet may key on; touches nothing else. Custom
 * properties inherit, so everything inside the element sees the brand and nothing outside it does.
 */
export function applyBrandColors(element, brand, mode) {
  const vars = brand?.accentHex ? brandCssVariables(brand.accentHex, mode) : null;
  for (const name of ACCENT_PROPERTIES) element.style.removeProperty(name);
  if (!vars) {
    element.removeAttribute('data-brand');
    // Removing the last property leaves an empty style="" behind; take that off too, so a cleared element is
    // exactly the element it was before it was ever branded.
    if (element.getAttribute('style') === '') element.removeAttribute('style');
    return;
  }
  for (const name of ACCENT_PROPERTIES) {
    if (Object.hasOwn(vars, name)) element.style.setProperty(name, vars[name]);
  }
  element.setAttribute('data-brand', '');
}
