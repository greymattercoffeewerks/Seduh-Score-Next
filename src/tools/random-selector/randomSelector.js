import { buildCsv } from '../../core/export.js';

export const STORAGE_KEY = 'seduh-random-selector-v1';
export const DEMO_ENTRIES = ['Amir', 'Bella', 'Chin', 'Dina', 'Evan', 'Fatin', 'Gareth', 'Hana'];
export const DEFAULT_BOARD_TITLE = 'PLAYER DRAW';
// No custom accent means the Petrol accent token, so the tool follows the design system on both
// surfaces (a darker teal on paper, a lighter one in Present). The colour picker needs a hex to
// show, so this is the paper value of that token (--clr-teal-700); it is never stored as a choice.
export const PETROL_ACCENT_HEX = '#065a51';
// What this tool used as its default before it followed the token. Saved lists and share links from
// then carry it, and it means "no custom accent".
const LEGACY_DEFAULT_ACCENT = '#0fb5a3';
export const DRAW_PRESETS = {
  quick: { label: 'Quick', duration: 1000, tickRate: 68 },
  standard: { label: 'Standard', duration: 1850, tickRate: 92 },
  ceremonial: { label: 'Ceremonial', duration: 3200, tickRate: 118 },
};

export function validDrawPreset(value) {
  // String() first: an array like ['quick'] coerces to a valid key, and must not be stored as-is.
  const key = String(value);
  return Object.hasOwn(DRAW_PRESETS, key) ? key : 'standard';
}

export function validSoundLevel(value) {
  const level = Number(value);
  return Number.isFinite(level) ? Math.min(1, Math.max(0.1, level)) : 0.6;
}

export function validBoardTitle(value) {
  const title = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return title ? title.slice(0, 32) : DEFAULT_BOARD_TITLE;
}

// A custom accent as lower-case #rrggbb, or null for "use the Petrol accent".
export function validAccentColor(value) {
  const color = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^#[\da-f]{6}$/.test(color) && color !== LEGACY_DEFAULT_ACCENT ? color : null;
}

export const MAX_ENTRIES = 80;

// A weight is a whole number from 1 to 1000; anything else (blank, zero, negative, text) is 1.
export function normalizeWeight(value) {
  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0
    ? Math.min(Math.max(1, Math.round(weight)), 1000)
    : 1;
}

// Reads the list and also reports what it had to change or leave out, so the screen can say so
// instead of quietly drawing from something other than what was typed: `ignored` counts entries
// past the limit, `adjusted` lists weights that were outside 1 to 1000 (or fractions) and what
// they were read as.
export function checkEntries(value) {
  const entries = [];
  const adjusted = [];
  let ignored = 0;
  for (const line of String(value).split('\n')) {
    const match = line.trim().match(/^(.*?)(?:\s*\|\s*(\d+(?:\.\d+)?))?$/);
    const name = match?.[1].trim();
    if (!name) continue;
    if (entries.length >= MAX_ENTRIES) {
      ignored += 1;
      continue;
    }
    const written = match[2];
    const weight = normalizeWeight(written ?? 1);
    if (written !== undefined && Number(written) !== weight)
      adjusted.push({ name, written, weight });
    entries.push({ name, weight });
  }
  return { entries, ignored, adjusted };
}

export function parseEntries(value) {
  return checkEntries(value).entries;
}

// The sentence for checkEntries' findings, or '' when there is nothing to say.
export function describeEntryProblems({ ignored, adjusted }) {
  const parts = [];
  if (ignored > 0) {
    parts.push(
      `${ignored} ${ignored === 1 ? 'line is' : 'lines are'} past the ${MAX_ENTRIES}-entry limit and ignored.`,
    );
  }
  if (adjusted.length > 0) {
    const shown = adjusted
      .slice(0, 3)
      .map((entry) => `“${entry.name}” (${entry.written} → ${entry.weight})`);
    const more = adjusted.length > 3 ? `, and ${adjusted.length - 3} more` : '';
    parts.push(`Weights run from 1 to 1000. Changed: ${shown.join(', ')}${more}.`);
  }
  return parts.join(' ');
}

// Edits of the typed list by position of the n-th entry line, leaving every other line (blank
// lines, entries past the limit) exactly as typed. Rewriting the whole list from the parsed
// entries would silently drop those.
function contentLineIndexes(lines) {
  const indexes = [];
  lines.forEach((line, at) => {
    if (line.trim() !== '') indexes.push(at);
  });
  return indexes;
}

export function replaceDraftLine(draft, index, entry) {
  const lines = String(draft).split('\n');
  const at = contentLineIndexes(lines)[index];
  if (at === undefined) return String(draft);
  lines[at] = formatEntries([entry]);
  return lines.join('\n');
}

export function removeDraftLine(draft, index) {
  const lines = String(draft).split('\n');
  const at = contentLineIndexes(lines)[index];
  if (at === undefined) return String(draft);
  lines.splice(at, 1);
  return lines.join('\n');
}

export function insertDraftLine(draft, index, entry) {
  const lines = String(draft).split('\n');
  const indexes = contentLineIndexes(lines);
  if (indexes.length === 0) return formatEntries([entry]);
  lines.splice(indexes[index] ?? lines.length, 0, formatEntries([entry]));
  return lines.join('\n');
}

// WCAG 2.x relative luminance and contrast ratio for a #rrggbb colour.
function luminance(color) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// The text colour to put on a user-chosen accent: whichever of black or white contrasts more.
// Pure black (not the page's near-black) is used because that is what makes the worst case, a
// mid-tone accent, still reach 4.58:1, so text on any accent clears WCAG AA.
export function readableOn(color) {
  return contrastRatio(color, '#000000') >= contrastRatio(color, '#ffffff') ? '#000000' : '#ffffff';
}

// RFC 4180-style parser: quoted cells may hold commas, doubled quotes and line breaks, and
// CRLF, LF and a leading byte-order mark (Excel's "CSV UTF-8") are all accepted.
export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character !== '"') cell += character;
      else if (source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (character === '"' && cell === '') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

const HEADER_NAME = /^(name|names|entry|entries|participant|participants)$/i;

// First column is the name, an optional second column the weight; a header row is skipped.
// `total` is how many entries the file held, so the caller can say when the limit cut some.
export function entriesFromCsv(text) {
  const rows = parseCsv(text);
  if (HEADER_NAME.test(rows[0]?.[0]?.trim() ?? '')) rows.shift();
  const all = rows
    .map(([name = '', weight]) => ({
      // Line breaks collapse to a space: the entry list holds one name per line.
      name: unguardCell(name.trim().replace(/\s+/g, ' ')),
      weight: normalizeWeight(weight),
    }))
    .filter((entry) => entry.name);
  return { entries: all.slice(0, MAX_ENTRIES), total: all.length };
}

// A spreadsheet runs a cell that starts with = + - or @ as a formula, and an entry list can come
// from a hostile share link. Such names are exported with a leading apostrophe (which the
// spreadsheet hides) and the apostrophe is removed again on import, so the round trip is exact.
const FORMULA_CELL = /^'*[=+\-@\t\r]/;

function guardCell(name) {
  return FORMULA_CELL.test(name) ? `'${name}` : name;
}

function unguardCell(name) {
  return /^'+[=+\-@\t\r]/.test(name) ? name.slice(1) : name;
}

// Built on core/export.js, the shared CSV writer, rather than a second copy of its quoting rules.
export function entriesToCsv(entries) {
  return buildCsv({
    columns: [
      { key: 'name', label: 'Entry' },
      { key: 'weight', label: 'Weight' },
    ],
    rows: entries.map((entry) => ({ name: guardCell(entry.name), weight: entry.weight })),
  });
}

const TRAILING_WEIGHT = /\|\s*\d+(?:\.\d+)?\s*$/;

export function formatEntries(entries) {
  return entries
    .map((entry) =>
      // A weight of 1 is left off, unless the name already ends in "| 5": the list would read that
      // as a weight, so such a name is written with its own explicit weight after it.
      entry.weight === 1 && !TRAILING_WEIGHT.test(entry.name)
        ? entry.name
        : `${entry.name} | ${entry.weight}`,
    )
    .join('\n');
}

export function weightedIndex(entries, random = crypto.getRandomValues.bind(crypto)) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / total) * total;
  const values = new Uint32Array(1);
  do random(values);
  while (values[0] >= limit);
  let cursor = values[0] % total;
  for (let index = 0; index < entries.length; index += 1) {
    cursor -= entries[index].weight;
    if (cursor < 0) return index;
  }
  return entries.length - 1;
}

export function encodeShare(draw) {
  const bytes = new TextEncoder().encode(JSON.stringify(draw));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeShare(value) {
  if (!value || value.length > 12000) return null;
  try {
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const candidate = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof candidate?.draft !== 'string' ||
      candidate.draft.length > 10000 ||
      typeof candidate.removeAfterDraw !== 'boolean'
    )
      return null;
    return {
      draft: candidate.draft,
      removeAfterDraw: candidate.removeAfterDraw,
      drawPreset: validDrawPreset(candidate.drawPreset),
      soundLevel: validSoundLevel(candidate.soundLevel),
      boardTitle: validBoardTitle(candidate.boardTitle),
      accentColor: validAccentColor(candidate.accentColor),
    };
  } catch {
    return null;
  }
}

export function loadSaved(storage = window.localStorage) {
  try {
    const candidate = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!candidate || typeof candidate.draft !== 'string') return null;
    return {
      draft: candidate.draft,
      removeAfterDraw: Boolean(candidate.removeAfterDraw),
      drawPreset: validDrawPreset(candidate.drawPreset),
      soundLevel: validSoundLevel(candidate.soundLevel),
      soundOn: candidate.soundOn !== false,
      boardTitle: validBoardTitle(candidate.boardTitle),
      accentColor: validAccentColor(candidate.accentColor),
      history: Array.isArray(candidate.history)
        ? candidate.history.filter((record) => record && typeof record.name === 'string').slice(-20)
        : [],
    };
  } catch {
    return null;
  }
}

export function saveCurrent(state, storage = window.localStorage) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        draft: state.draft,
        removeAfterDraw: state.removeAfterDraw,
        drawPreset: state.drawPreset,
        soundLevel: state.soundLevel,
        soundOn: state.soundOn,
        boardTitle: state.boardTitle,
        accentColor: state.accentColor,
        history: state.history,
      }),
    );
  } catch {
    // Storage is a convenience only; the picker remains usable when blocked.
  }
}

// Reading window.localStorage can itself throw (site data blocked, sandboxed frames), and doing it
// as a default parameter would take the whole page down with it, so it is read here, guarded.
export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
