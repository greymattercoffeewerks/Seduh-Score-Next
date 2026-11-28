// A share-to-story picture: 1080 x 1920 (9:16, an Instagram or WhatsApp story), drawn on a canvas, then shared with the
// phone's own share sheet or saved as a file. Reusable and free of anything specific to countries or formats: the caller
// says what the card shows (a tile, a title, up to three headline numbers, one highlight, a provenance line, the page
// address) and this draws it. Country pages are the first user; the Layer 2 person pages (T-ID2.C3) are the second: the
// tile is a flag (fitted) for a country and a photo (cropped to fill) or initials for a person.
//
// Three honest limits. (1) It draws only what it is given and never reads the page, so what is on the card is what the
// caller chose to publish. (2) The card is one deliberate dark look whatever the page's theme, but its colours are read
// from the design tokens (`storyThemeFrom`), not typed here. (3) The QR code is the page address, so anyone seeing the
// story can open the page and check it.
//
// Pure layout and drawing are separate from the browser parts, so the layout is testable with a recording context:
// `drawStoryCard(ctx, spec, assets)` takes any 2D-context-shaped object. `renderStoryCard` and `shareStoryCard` are the
// browser parts (canvas, fonts, Image, navigator).
import { loadQrFactory } from './audienceLinksCard.js';

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
const MARGIN = 96;
const MAX_STATS = 4;
const DEFAULT_TILE_WIDTH = 360;

const DEFAULT_THEME = {
  background: '#0e1a1d',
  surface: '#16262a',
  border: '#3a4a4e',
  text: '#f1f5f4',
  muted: '#b9c4c2',
  accent: '#5eead4',
  gold: '#e0b64a',
  displayFont: 'sans-serif',
  bodyFont: 'sans-serif',
  monoFont: 'monospace',
};

/**
 * Colours and fonts for the card, read from the live tokens of an element in the stage (dark) mode. `fallback` is used
 * only for a token that is not defined (a test, or a page that did not load the tokens).
 */
export function storyThemeFrom(element, fallback = DEFAULT_THEME) {
  const style =
    element && typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  const read = (name, alt) => style?.getPropertyValue(name).trim() || alt;
  return {
    background: read('--color-canvas', fallback.background),
    surface: read('--color-surface', fallback.surface),
    border: read('--color-border', fallback.border),
    text: read('--color-text', fallback.text),
    muted: read('--color-text-secondary', fallback.muted),
    accent: read('--color-accent', fallback.accent),
    gold: read('--color-gold', fallback.gold),
    displayFont: read('--font-display', fallback.displayFont),
    bodyFont: read('--font-body', fallback.bodyFont),
    monoFont: read('--font-mono', fallback.monoFont),
  };
}

/**
 * Pure. Breaks `text` into lines no wider than `maxWidth` by the caller's `measure(text) => width`, on spaces; a word
 * wider than a line is cut by characters. At most `maxLines`: the last line ends with an ellipsis if text was left.
 */
export function wrapLines(text, measure, maxWidth, maxLines = 3) {
  const words = String(text ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1;
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    const candidate = line ? `${line} ${rest}` : rest;
    if (measure(candidate) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = rest;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

const font = (weight, size, family) => `${weight} ${size}px ${family}`;

/**
 * Draws the card. Everything comes from `spec`, `theme` and `assets`; nothing is read from the page.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   brand?: string, eyebrow?: string, tile?: string, tileWidth?: number, tileInitials?: string, title: string, subtitle?: string, tagline?: string,
 *   stats?: { value: string, label: string }[],
 *   highlight?: { label: string, text: string, detail?: string }|null,
 *   provenance?: string, address: string }} spec
 * `tile` is the text beside the picture; `tileInitials` stands in the frame when there is neither a flag nor a photo.
 * @param {{ theme?: object, flag?: CanvasImageSource|null, photo?: CanvasImageSource|null, qr?: { size: number, isDark: (r: number, c: number) => boolean }|null }} assets
 */
export function drawStoryCard(
  ctx,
  spec,
  { theme = DEFAULT_THEME, flag = null, photo = null, qr = null } = {},
) {
  const W = STORY_WIDTH;
  const H = STORY_HEIGHT;
  const inner = W - MARGIN * 2;
  const measure = (value) => ctx.measureText(value).width;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, W, 14);

  ctx.fillStyle = theme.text;
  ctx.font = font(700, 40, theme.displayFont);
  ctx.fillText((spec.brand ?? 'Seduh Score').toUpperCase(), MARGIN, 150);

  let y = 260;
  if (spec.eyebrow) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(600, 34, theme.monoFont);
    ctx.fillText(spec.eyebrow.toUpperCase(), MARGIN, y);
    y += 46;
  }

  // The tile: the flag (or a plain frame) and the code beside it, as text.
  const tileW = spec.tileWidth ?? DEFAULT_TILE_WIDTH;
  const tileH = 240;
  ctx.fillStyle = theme.surface;
  ctx.fillRect(MARGIN, y, tileW, tileH);
  if (flag) {
    // Fitted inside the tile at the flag's own proportions (the set is 4:3), never stretched.
    const ratio = (flag.naturalWidth || flag.width || 4) / (flag.naturalHeight || flag.height || 3);
    const w = Math.min(tileW, tileH * ratio);
    const h = w / ratio;
    ctx.drawImage(flag, MARGIN + (tileW - w) / 2, y + (tileH - h) / 2, w, h);
  }
  if (!flag && photo) {
    // A photo fills the frame, cropped from the middle (never stretched).
    const pw = photo.naturalWidth || photo.width || 1;
    const ph = photo.naturalHeight || photo.height || 1;
    const side = Math.min(pw, ph);
    ctx.drawImage(photo, (pw - side) / 2, (ph - side) / 2, side, side, MARGIN, y, tileW, tileH);
  } else if (!flag && spec.tileInitials) {
    ctx.fillStyle = theme.accent;
    ctx.font = font(700, 110, theme.displayFont);
    ctx.fillText(
      spec.tileInitials,
      MARGIN + (tileW - measure(spec.tileInitials)) / 2,
      y + tileH / 2 + 38,
    );
  }
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 4;
  ctx.strokeRect(MARGIN, y, tileW, tileH);
  if (spec.tile) {
    ctx.fillStyle = theme.accent;
    ctx.font = font(700, 120, theme.displayFont);
    ctx.fillText(spec.tile, MARGIN + tileW + 48, y + tileH - 8);
  }
  y += tileH + 160;

  ctx.fillStyle = theme.text;
  // The title is set at the largest size that fits on ONE line; a very long name steps down and may take two. This keeps
  // the highlight clear of the footer whatever the name.
  let titleSize = 132;
  for (const size of [132, 104, 84]) {
    titleSize = size;
    ctx.font = font(700, size, theme.displayFont);
    if (measure(spec.title) <= inner) break;
  }
  ctx.font = font(700, titleSize, theme.displayFont);
  for (const line of wrapLines(spec.title, measure, inner, 2)) {
    ctx.fillText(line, MARGIN, y);
    y += Math.round(titleSize * 1.06);
  }
  if (spec.subtitle) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(500, 40, theme.bodyFont);
    for (const line of wrapLines(spec.subtitle, measure, inner, 1)) {
      ctx.fillText(line, MARGIN, y + 10);
      y += 56;
    }
  }
  // One optional short line under the name (a later "Head Barista · <cafe>" or a certification). Not given now: nothing is
  // drawn and nothing moves.
  if (spec.tagline) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(500, 40, theme.bodyFont);
    for (const line of wrapLines(spec.tagline, measure, inner, 1)) {
      ctx.fillText(line, MARGIN, y + 10);
      y += 56;
    }
  }
  y += 80;

  const stats = (spec.stats ?? []).slice(0, MAX_STATS);
  if (stats.length > 0) {
    ctx.fillStyle = theme.border;
    ctx.fillRect(MARGIN, y - 40, inner, 3);
    const colW = inner / stats.length;
    stats.forEach((stat, i) => {
      const x = MARGIN + colW * i;
      ctx.fillStyle = theme.text;
      ctx.font = font(700, 112, theme.displayFont);
      ctx.fillText(String(stat.value), x, y + 90);
      ctx.fillStyle = theme.muted;
      ctx.font = font(500, 34, theme.bodyFont);
      wrapLines(stat.label, measure, colW - 24, 2).forEach((line, n) =>
        ctx.fillText(line, x, y + 148 + n * 42),
      );
    });
    y += 250;
  }

  if (spec.highlight) {
    ctx.fillStyle = theme.gold;
    ctx.font = font(600, 34, theme.monoFont);
    ctx.fillText(spec.highlight.label.toUpperCase(), MARGIN, y + 30);
    ctx.fillStyle = theme.text;
    ctx.font = font(700, 76, theme.displayFont);
    let hy = y + 120;
    for (const line of wrapLines(spec.highlight.text, measure, inner, 1)) {
      ctx.fillText(line, MARGIN, hy);
      hy += 86;
    }
    if (spec.highlight.detail) {
      ctx.fillStyle = theme.muted;
      ctx.font = font(500, 38, theme.bodyFont);
      ctx.fillText(wrapLines(spec.highlight.detail, measure, inner, 1)[0] ?? '', MARGIN, hy - 8);
    }
  }

  // Footer: the address and provenance on the left, the QR code on the right.
  const qrBox = 260;
  const footY = H - MARGIN - qrBox;
  if (qr) {
    const left = W - MARGIN - qrBox;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, footY, qrBox, qrBox);
    const pad = 20;
    const cell = (qrBox - pad * 2) / qr.size;
    ctx.fillStyle = '#000000';
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            left + pad + c * cell,
            footY + pad + r * cell,
            Math.ceil(cell),
            Math.ceil(cell),
          );
        }
      }
    }
  }
  const textW = qr ? inner - qrBox - 48 : inner;
  ctx.fillStyle = theme.accent;
  ctx.font = font(600, 34, theme.monoFont);
  let fy = footY + 50;
  for (const line of wrapLines(spec.address, measure, textW, 3)) {
    ctx.fillText(line, MARGIN, fy);
    fy += 50;
  }
  if (spec.provenance) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(500, 32, theme.bodyFont);
    wrapLines(spec.provenance, measure, textW, 4).forEach((line, n) =>
      ctx.fillText(line, MARGIN, fy + 24 + n * 42),
    );
  }
}

/** The QR matrix of `url` as `{ size, isDark }`, or null when it cannot be made. */
export async function qrMatrixFor(url, loadQr = loadQrFactory) {
  try {
    const qrcode = await loadQr();
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    return { size: code.getModuleCount(), isDark: (r, c) => code.isDark(r, c) };
  } catch {
    return null;
  }
}

// `cors` asks for an anonymous cross-origin load, so a picture from another address (a person's photo on Storage) does not
// taint the canvas; a server that does not allow it makes the load fail, which is the same as no picture.
function loadImage(url, { cors = false } = {}) {
  return new Promise((resolve) => {
    const image = new Image();
    if (cors) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Browser. Draws the card on a new canvas and answers a PNG Blob. `flagUrl` and `photoUrl` are optional (a picture that fails to load
 * is left out: the card still says everything in words). Rejects when no canvas or picture can be had.
 * @returns {Promise<Blob>}
 */
export async function renderStoryCard(
  spec,
  {
    theme = DEFAULT_THEME,
    flagUrl = null,
    photoUrl = null,
    qrUrl = null,
    loadQr = loadQrFactory,
    canvasFactory,
    draw = drawStoryCard, // another card layout that takes the same (ctx, spec, assets), e.g. the results card
  } = {},
) {
  const canvas = canvasFactory ? canvasFactory() : document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  try {
    // The card's own fonts must be in before text is measured, or it would be set in a fallback.
    await Promise.all(
      [
        `700 40px ${theme.displayFont}`,
        `500 40px ${theme.bodyFont}`,
        `600 40px ${theme.monoFont}`,
      ].map((f) => document.fonts?.load(f)),
    );
  } catch {
    // A font that will not load is a plainer card, not a failed one.
  }
  const [flag, photo, qr] = await Promise.all([
    flagUrl ? loadImage(flagUrl) : null,
    photoUrl ? loadImage(photoUrl, { cors: true }) : null,
    qrUrl ? qrMatrixFor(qrUrl, loadQr) : null,
  ]);
  draw(ctx, spec, { theme, flag, photo, qr });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no picture'))), 'image/png');
  });
}

/**
 * Browser. Shares the picture with the device's share sheet where the browser can share files, else saves it.
 * @returns {Promise<'shared'|'saved'|'cancelled'>} 'cancelled' when the person closed the share sheet
 */
export async function shareStoryCard(
  blob,
  { filename, title, text } = {},
  nav = globalThis.navigator,
  doc = globalThis.document,
) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other refusal falls through to saving: the person still gets the picture.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = filename;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
