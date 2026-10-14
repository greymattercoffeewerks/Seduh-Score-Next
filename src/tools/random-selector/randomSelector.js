export const STORAGE_KEY = 'seduh-random-selector-v1';
export const DEMO_ENTRIES = ['Amir', 'Bella', 'Chin', 'Dina', 'Evan', 'Fatin', 'Gareth', 'Hana'];
export const DEFAULT_BOARD_TITLE = 'PLAYER DRAW';
export const DEFAULT_ACCENT_COLOR = '#0fb5a3';
export const DRAW_PRESETS = {
  quick: { label: 'Quick', duration: 1000, tickRate: 68 },
  standard: { label: 'Standard', duration: 1850, tickRate: 92 },
  ceremonial: { label: 'Ceremonial', duration: 3200, tickRate: 118 },
};

export function validDrawPreset(value) {
  return Object.hasOwn(DRAW_PRESETS, value) ? value : 'standard';
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

export function validAccentColor(value) {
  const color = String(value ?? '').trim();
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_ACCENT_COLOR;
}

export function parseEntries(value) {
  return String(value)
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(.*?)(?:\s*\|\s*(\d+(?:\.\d+)?))?$/);
      const name = match?.[1].trim();
      const weight = Number(match?.[2] ?? 1);
      if (!name) return null;
      return {
        name,
        weight:
          Number.isFinite(weight) && weight > 0
            ? Math.min(Math.max(1, Math.round(weight)), 1000)
            : 1,
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

export function formatEntries(entries) {
  return entries
    .map((entry) => (entry.weight === 1 ? entry.name : `${entry.name} | ${entry.weight}`))
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
      history: Array.isArray(candidate.history) ? candidate.history.slice(-20) : [],
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
