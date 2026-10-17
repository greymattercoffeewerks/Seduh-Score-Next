// Brand accent colour engine (BRANDING-SPEC 4.4, task BR-D1). The ONE place a brand colour is decided.
//
// An organiser picks one accent colour. It is untrusted input: this module never trusts it, and never stores or
// returns anything it has not checked. Given a stored hex and a surface mode, it returns the three CSS values an
// audience screen may override, and it guarantees they are readable, whatever the hex was:
//
//   accent           the brand colour, moved only if it would not be readable on that surface
//   accentHover      a step away from it for a hover or pressed state, still readable
//   accentContrast   the text colour to put ON the accent (dark ink or white, whichever reads better)
//
// "Readable" means WCAG contrast: the accent reaches 4.5:1 against EVERY surface of that mode (the canvas, the card
// and the sunken band: it may sit on any of them), the text on the accent reaches 4.5:1, and the hover state keeps
// 4.5:1 for its text and 3:1 against the surfaces. If the colour fails, its lightness moves (in OKLCH, so the hue
// is kept and the change is perceptually even) the SMALLEST amount that makes it pass: lighter on the dark stage
// surfaces, darker on the light paper ones. The contrast is measured on the actual 8-bit colour that is returned,
// never on an unrounded intermediate.
//
// What a screen applies is `brandCssVariables`, and by construction it returns exactly those three properties and
// nothing else. It has no way to name the TEST colour or any status colour (danger, warning, success, focus ring),
// so a brand can never touch them (D9). (`deriveBrandColors` returns more, for the Branding screen's preview: how
// far the colour moved and why. A screen never applies that object directly.)
//
// Stricter than BRANDING-SPEC 4.4 on purpose: 4.4 sketches 4.5:1 against the mode's canvas, but an accent also sits on
// the card and on the sunken band, and paper's canvas is not white (#dfe4e2), so every surface of the mode is
// checked. Example: #767676 is 4.54:1 on white yet the engine returns #545454 on paper, because the sunken band is
// darker than white.
//
// Pure: no DOM, no I/O, no imports, no randomness, no clock. It costs about a millisecond a call, so a caller that
// asks repeatedly (a display that re-reads branding on a timer) should keep the answer per (hex, surface). The
// surface colours below are copies of the tokens in src/ui/tokens/colors.css (a module cannot read CSS), and
// brandColor.test.js fails if the two ever differ.

// The colours an audience screen sits on, per surface mode (colors.css: stage = [data-surface='stage'], paper = :root).
// Frozen all the way down: these decide readability for every page, so no importer may change them.
export const SURFACES = Object.freeze({
  stage: Object.freeze({ canvas: '#0b0e10', surface: '#12171a', sunken: '#1a2124' }),
  paper: Object.freeze({ canvas: '#dfe4e2', surface: '#f4f6f5', sunken: '#c3cac8' }),
});
// The two text colours an accent may carry: dark ink (petrol 950) and white.
export const INK = '#0b0e10';
export const WHITE = '#ffffff';

const MIN_TEXT = 4.5; // WCAG 1.4.3, normal-size text
const MIN_NON_TEXT = 3; // WCAG 1.4.11, for the hover state against the surfaces
// Hover steps, in OKLab lightness, smallest first: 0.08 is about the token teal-300 to teal-500 step. Near black or
// near white a small step is invisible in 8-bit colour (black to #020202), so larger steps are tried until the hover
// differs from the accent by a contrast the eye can see.
const HOVER_STEPS = [0.08, 0.14, 0.2, 0.26];
const MIN_HOVER_DIFFERENCE = 1.15; // contrast between the accent and its hover state
const SEARCH_STEPS = 32; // bisection steps: far finer than one 8-bit colour step
const ACHROMATIC = 1e-4; // OKLab chroma below which a colour is a grey (an 8-bit grey measures about 2e-8)

const STRICT_HEX = /^#[0-9a-fA-F]{6}$/;

/** True only for a six-digit hex such as #1a2b3c, the same rule the database stores (no shorthand, no spaces). */
export function isBrandHex(value) {
  return typeof value === 'string' && STRICT_HEX.test(value);
}

// ---------- colour maths ----------

function hexToBytes(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function bytesToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (byte) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (linear) => {
  const c = Math.min(1, Math.max(0, linear));
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
};

/** WCAG relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToBytes(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours, 1 to 21. Order does not matter. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// OKLab (Bjorn Ottosson): lightness L, and a, b from which hue and chroma follow. Perceptually even, so moving L
// changes how light a colour looks without shifting its hue. Returns { L, C, h } with h in RADIANS. A grey has no hue
// (its hue is floating-point noise), so below a tiny chroma it is reported as exactly achromatic, and a grey stays a
// grey instead of coming back faintly tinted.
export function hexToOklch(hex) {
  const [r, g, b] = hexToBytes(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  return C < ACHROMATIC ? { L, C: 0, h: 0 } : { L, C, h: Math.atan2(bb, a) };
}

function oklchToLinear({ L, C, h }) {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (linear) => linear.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

// The colour with this lightness and hue, and the most chroma (up to `chroma`) that still exists in sRGB. A light or
// dark colour cannot keep a saturated chroma, so chroma yields first and the hue stays put. (Exported with
// hexToOklch so the tests, and later the Branding screen's preview, can reason in the same space.)
export function oklchToHex(L, chroma, h) {
  if (L <= 0) return '#000000';
  if (L >= 1) return '#ffffff';
  let linear = oklchToLinear({ L, C: chroma, h });
  if (!inGamut(linear)) {
    let low = 0;
    let high = chroma;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinear({ L, C: mid, h }))) low = mid;
      else high = mid;
    }
    linear = oklchToLinear({ L, C: low, h });
  }
  return bytesToHex(linear.map(fromLinear));
}

// ---------- the rules ----------

// Own keys only: a surface named "toString" or "constructor" must be an unknown surface, never an inherited function.
function surfaceColours(surface) {
  if (typeof surface !== 'string' || !Object.hasOwn(SURFACES, surface)) return null;
  const set = SURFACES[surface];
  return [set.canvas, set.surface, set.sunken];
}

// Whichever text colour reads better on the accent. With today's surfaces this is always ink on the stage and white
// on paper (an accent that reads on every surface already has enough contrast for that text); the check stays as a
// guard, so a future change to the tokens cannot quietly produce unreadable text.
const bestText = (colour) =>
  contrastRatio(colour, INK) >= contrastRatio(colour, WHITE) ? INK : WHITE;
const worstAgainst = (colour, surfaces) =>
  Math.min(...surfaces.map((s) => contrastRatio(colour, s)));

// An accent is usable when it reads on every surface and carries readable text.
function accentPasses(colour, surfaces) {
  return (
    worstAgainst(colour, surfaces) >= MIN_TEXT &&
    contrastRatio(colour, bestText(colour)) >= MIN_TEXT
  );
}

// The smallest lightness move that makes a failing colour pass, to within 8-bit rounding. Dark surfaces need a lighter
// accent and light ones a darker one; both ends (white, black) always pass, and passing is monotone toward them to
// within that rounding (measured: the search lands within 0.4% of the path of the first passing point), so a
// bisection on how far to travel finds the least change. Hue is held; chroma yields only where the sRGB gamut forces
// it. The colour returned is the exact 8-bit colour that was tested, so it cannot be one that fails.
function adjustToPass(requested, surface, surfaces) {
  const { L, C, h } = hexToOklch(requested);
  const end = surface === 'stage' ? 1 : 0;
  let low = 0; // known to fail (the request itself)
  let high = 1; // known to pass (white or black)
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (low + high) / 2;
    if (accentPasses(oklchToHex(L + (end - L) * mid, C, h), surfaces)) high = mid;
    else low = mid;
  }
  return oklchToHex(L + (end - L) * high, C, h);
}

// Hover or pressed: darker first (the house style: teal-300 hovers to teal-500), lighter if darker would stop being
// readable or cannot get far enough from the accent. Falls back to the accent itself, never to something unreadable.
function deriveHover(accent, text, surfaces) {
  const { L, C, h } = hexToOklch(accent);
  for (const step of HOVER_STEPS) {
    for (const candidate of [L - step, L + step]) {
      const hover = oklchToHex(Math.min(1, Math.max(0, candidate)), C, h);
      if (
        contrastRatio(hover, accent) >= MIN_HOVER_DIFFERENCE &&
        contrastRatio(hover, text) >= MIN_TEXT &&
        worstAgainst(hover, surfaces) >= MIN_NON_TEXT
      ) {
        return hover;
      }
    }
  }
  return accent;
}

/**
 * The readable brand colours for one surface, or null when there is nothing safe to apply (an invalid hex or an
 * unknown surface): the caller then shows the ordinary, unbranded colours.
 *
 * @param {unknown} hex      the stored accent colour (untrusted)
 * @param {'stage'|'paper'} surface
 * @returns {null | {
 *   requested: string, surface: string, accent: string, accentHover: string, accentContrast: string,
 *   adjusted: boolean,
 *   ratios: { accentOnWorstSurface: number, textOnAccent: number, textOnHover: number, hoverOnWorstSurface: number },
 * }}
 */
export function deriveBrandColors(hex, surface) {
  const surfaces = surfaceColours(surface);
  if (!surfaces || !isBrandHex(hex)) return null;

  const requested = hex.toLowerCase();
  const adjusted = !accentPasses(requested, surfaces);
  const accent = adjusted ? adjustToPass(requested, surface, surfaces) : requested;
  const accentContrast = bestText(accent);
  const accentHover = deriveHover(accent, accentContrast, surfaces);

  return {
    requested,
    surface,
    accent,
    accentHover,
    accentContrast,
    adjusted,
    ratios: {
      accentOnWorstSurface: worstAgainst(accent, surfaces),
      textOnAccent: contrastRatio(accent, accentContrast),
      textOnHover: contrastRatio(accentHover, accentContrast),
      hoverOnWorstSurface: worstAgainst(accentHover, surfaces),
    },
  };
}

/**
 * The CSS custom properties to set on an audience surface's root, or null to leave it unbranded. Exactly three
 * properties, always: nothing here can reach the TEST colour, a status colour or any surface or border token.
 */
export function brandCssVariables(hex, surface) {
  const derived = deriveBrandColors(hex, surface);
  if (!derived) return null;
  return {
    '--color-accent': derived.accent,
    '--color-accent-hover': derived.accentHover,
    '--color-accent-contrast': derived.accentContrast,
  };
}
