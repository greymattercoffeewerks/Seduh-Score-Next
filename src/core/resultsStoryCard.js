// The results story card: a 1080 x 1920 picture of a finished competition's podium (the winner large, the next places as
// rows, the venue and the date), drawn on the light "paper" surface over the Petrol grid-lines backdrop. Free of anything
// about formats: the caller says what the card shows, so Cup Taster, BTC and Throwdown (and a later format) all use it
// unedited. It shares its size, its text wrapping and its render and share pipeline with `storyCard.js` (the profile and
// country cards); it differs only in what it draws. No QR code on purpose: nobody scans a code off the phone they are
// holding, so the page address is plain text.
//
// Pure drawing is separate from the browser parts, so the layout is testable with a recording context:
// `drawResultsStoryCard(ctx, spec, { theme })` takes any 2D-context-shaped object.
import { STORY_HEIGHT, STORY_WIDTH, storyThemeFrom, wrapLines } from './storyCard.js';

const MARGIN = 96;
const GRID_CELL = 72;
const MAX_PLACES = 3; // rows under the winner (a tie for third can make a fourth place; the rest are not drawn)

const DEFAULT_PAPER_THEME = {
  background: '#dfe3e2',
  surface: '#ffffff',
  border: '#b4bdbb',
  text: '#0b0f10',
  muted: '#2b3436',
  accent: '#04574f',
  gold: '#8a6a1f',
  goldTint: '#f9f3de',
  displayFont: 'sans-serif',
  bodyFont: 'sans-serif',
  monoFont: 'monospace',
};

/**
 * Colours and fonts in PAPER mode, read from the live tokens of `element` (pass the document root: the page's own
 * tokens, with no surface switch). `fallback` fills in only a token that is not defined (a test).
 */
export function paperStoryTheme(element, fallback = DEFAULT_PAPER_THEME) {
  const base = storyThemeFrom(element, fallback);
  const style =
    element && typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  return {
    ...base,
    goldTint: style?.getPropertyValue('--color-gold-tint').trim() || fallback.goldTint,
  };
}

const font = (weight, size, family) => `${weight} ${size}px ${family}`;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   brand?: string, eyebrow?: string, title: string,
 *   winner: { name: string, detail?: string, label?: string },
 *   places?: { place: number|string, name: string, detail?: string }[],
 *   venue?: string, venueLabel?: string, date?: string, address: string }} spec
 * @param {{ theme?: object }} assets
 */
export function drawResultsStoryCard(ctx, spec, { theme = DEFAULT_PAPER_THEME } = {}) {
  const W = STORY_WIDTH;
  const H = STORY_HEIGHT;
  const inner = W - MARGIN * 2;
  const measure = (value) => ctx.measureText(value).width;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);

  // The grid-lines backdrop of the public page heroes (base.css `.page-hero-grid`), fading out toward the bottom so the
  // text at the foot sits on a calm ground. Drawn in short strips so the fade needs no colour arithmetic.
  ctx.fillStyle = theme.border;
  const fadeAt = (y) => 0.55 * Math.max(0, Math.min(1, (0.9 * H - y) / (0.55 * H)));
  for (let y = 0; y < H; y += GRID_CELL) {
    ctx.globalAlpha = fadeAt(y);
    ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += GRID_CELL) ctx.fillRect(x, y, 1, GRID_CELL);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, W, 14);

  ctx.fillStyle = theme.text;
  ctx.font = font(700, 40, theme.displayFont);
  ctx.fillText((spec.brand ?? 'Seduh Score').toUpperCase(), MARGIN, 150);

  let y = 260;
  if (spec.eyebrow) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(600, 34, theme.monoFont);
    ctx.fillText(spec.eyebrow.toUpperCase(), MARGIN, y + 20);
  }
  y += 100;

  // The event name: the largest of three sizes that fits in two lines; a longer name takes three at the smallest.
  let titleSize = 104;
  for (const size of [104, 88, 72]) {
    titleSize = size;
    ctx.font = font(700, size, theme.displayFont);
    if (wrapLines(spec.title, measure, inner, 3).length <= 2) break;
  }
  y = 314 + Math.round(titleSize * 0.85); // clear of the eyebrow above whatever the size
  ctx.fillStyle = theme.text;
  ctx.font = font(700, titleSize, theme.displayFont);
  for (const line of wrapLines(spec.title, measure, inner, 3)) {
    ctx.fillText(line, MARGIN, y);
    y += Math.round(titleSize * 1.06);
  }

  // The winner: a gold-edged box, square corners.
  y -= 20;
  const heroTop = y;
  const winnerLabel = spec.winner.label ?? 'Champion';
  const pad = 56;
  const nameBox = inner - pad * 2;
  let nameSize = 104;
  for (const size of [104, 88, 72]) {
    nameSize = size;
    ctx.font = font(700, size, theme.displayFont);
    if (measure(spec.winner.name) <= nameBox) break;
  }
  ctx.font = font(700, nameSize, theme.displayFont);
  const nameLines = wrapLines(spec.winner.name, measure, nameBox, 2);
  const nameLead = Math.round(nameSize * 1.06);
  ctx.font = font(500, 44, theme.bodyFont);
  const detailLines = spec.winner.detail ? wrapLines(spec.winner.detail, measure, nameBox, 1) : [];
  const heroH = 44 + 34 + 20 + nameLines.length * nameLead + (detailLines.length ? 64 : 0) + 40;
  ctx.fillStyle = theme.goldTint;
  ctx.fillRect(MARGIN, heroTop, inner, heroH);
  ctx.strokeStyle = theme.gold;
  ctx.lineWidth = 4;
  ctx.strokeRect(MARGIN + 2, heroTop + 2, inner - 4, heroH - 4);
  let hy = heroTop + 44 + 34;
  ctx.fillStyle = theme.gold;
  ctx.font = font(600, 34, theme.monoFont);
  ctx.fillText(winnerLabel.toUpperCase(), MARGIN + pad, hy);
  hy += 20 + nameLead - 12;
  ctx.fillStyle = theme.text;
  ctx.font = font(700, nameSize, theme.displayFont);
  for (const line of nameLines) {
    ctx.fillText(line, MARGIN + pad, hy);
    hy += nameLead;
  }
  if (detailLines.length) {
    ctx.fillStyle = theme.muted;
    ctx.font = font(500, 44, theme.bodyFont);
    ctx.fillText(detailLines[0], MARGIN + pad, hy - nameLead + 64);
  }
  y = heroTop + heroH + 40;

  // The next places, as ruled rows. The rows give way (are made shorter) before the venue block would be pushed off.
  const places = (spec.places ?? []).slice(0, MAX_PLACES);
  const whereH = spec.venue || spec.date ? 300 : 0;
  const footTop = H - MARGIN - 40;
  if (places.length > 0) {
    const room = footTop - whereH - 40 - y;
    const rowH = Math.max(120, Math.min(180, Math.floor(room / places.length)));
    ctx.fillStyle = theme.border;
    ctx.fillRect(MARGIN, y, inner, 3);
    for (const place of places) {
      ctx.fillStyle = theme.muted;
      ctx.font = font(700, 64, theme.displayFont);
      ctx.fillText(String(place.place), MARGIN + 8, y + 76);
      ctx.fillStyle = theme.text;
      ctx.font = font(700, 64, theme.displayFont);
      ctx.fillText(wrapLines(place.name, measure, inner - 140, 1)[0] ?? '', MARGIN + 140, y + 76);
      if (place.detail) {
        ctx.fillStyle = theme.muted;
        ctx.font = font(500, 36, theme.bodyFont);
        ctx.fillText(wrapLines(place.detail, measure, inner - 140, 1)[0], MARGIN + 140, y + 126);
      }
      y += rowH;
      ctx.fillStyle = theme.border;
      ctx.fillRect(MARGIN, y, inner, 3);
    }
  }

  // Venue and date on lines of their own, each with its small label.
  y += 60;
  const block = (label, text) => {
    ctx.fillStyle = theme.muted;
    ctx.font = font(600, 28, theme.monoFont);
    ctx.fillText(label.toUpperCase(), MARGIN, y);
    ctx.fillStyle = theme.text;
    ctx.font = font(600, 42, theme.bodyFont);
    const lines = wrapLines(text, measure, inner, 2);
    lines.forEach((line, n) => ctx.fillText(line, MARGIN, y + 52 + n * 50));
    y += 52 + lines.length * 50 + 24;
  };
  if (spec.venue) block(spec.venueLabel ?? 'Venue', spec.venue);
  if (spec.date) block('Date', spec.date);

  ctx.fillStyle = theme.accent;
  ctx.font = font(600, 34, theme.monoFont);
  ctx.fillText(spec.address, MARGIN, H - MARGIN);
}
