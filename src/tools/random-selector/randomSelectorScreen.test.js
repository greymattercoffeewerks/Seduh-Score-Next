import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeShare, STORAGE_KEY } from './randomSelector.js';
import { boardCells, mountRandomSelector } from './randomSelectorScreen.js';

function fakeStorage(saved) {
  const map = new Map(saved ? [[STORAGE_KEY, JSON.stringify(saved)]] : []);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    written: () => JSON.parse(map.get(STORAGE_KEY) ?? 'null'),
  };
}

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'randomSelector.css'),
  'utf8',
);

// The declarations of every rule whose selector list contains `selector`, comments removed, so a
// rule that has been commented out or reworded does not still satisfy a check.
function declarationsOf(selector) {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = {};
  for (const [, selectors, body] of live.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').some((part) => part.trim() === selector)) continue;
    for (const declaration of body.split(';')) {
      const at = declaration.indexOf(':');
      if (at > 0) found[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim();
    }
  }
  return found;
}

// Sound off keeps most tests off the media element, which jsdom does not implement; the sound-on
// tests below stub play() themselves.
// Written as a code point: an editor or formatter will otherwise turn a literal BOM into invisible text.
const BOM = String.fromCodePoint(0xfeff);

const SAVED = { draft: 'Amir\nBella\nChin', soundOn: false, drawPreset: 'quick' };
const QUICK_MS = 1000;

let root;
let dispose;

let storage;

function mount(saved = SAVED) {
  root = document.createElement('div');
  document.body.append(root);
  storage = fakeStorage(saved);
  dispose = mountRandomSelector(root, { storage });
}

// Make the crypto draw return a chosen value, so a test can say which entry must win.
function drawValue(value) {
  return vi.spyOn(crypto, 'getRandomValues').mockImplementation((values) => {
    values[0] = value;
    return values;
  });
}

// Choose a CSV file in the hidden file input (jsdom's File has no text(); browsers do).
async function importCsvFile(text) {
  const file = new File([text], 'entries.csv', { type: 'text/csv' });
  file.text = () => Promise.resolve(text);
  const input = root.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(0);
}

const buttonByText = (text) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text);

const drawButton = () => root.querySelector('.rs-draw-button');
const textarea = () => root.querySelector('#rs-entries');
const boardText = () =>
  [...root.querySelectorAll('.selector-flap')]
    .map((flap) => flap.textContent)
    .join('')
    .trim();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  root?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('random selector draw lifecycle', () => {
  it('lands on one of the original entries even if the list is edited mid-spin', () => {
    mount();
    drawButton().click();
    expect(textarea().disabled).toBe(true);

    // A disabled control still receives a synthetic event; the draw must not honour it.
    textarea().value = '';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));

    vi.advanceTimersByTime(QUICK_MS + 100);

    expect(drawButton().textContent).toBe('Draw');
    expect(drawButton().disabled).toBe(false);
    expect(root.querySelector('.rs-reveal h2').textContent).toMatch(/^(Amir|Bella|Chin)$/);
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe('Amir\nBella\nChin');
  });

  it('awards the entry the weighted draw picked, not another one', () => {
    drawValue(999);
    mount({ ...SAVED, draft: 'Amir | 1000\nBella' });
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(root.querySelector('.rs-reveal h2').textContent).toBe('Amir');

    drawValue(1000);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(root.querySelector('.rs-reveal h2').textContent).toBe('Bella');
  });

  it('removes exactly the drawn entry when removal is on, even beside a duplicate name', () => {
    drawValue(2);
    mount({ ...SAVED, removeAfterDraw: true });
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(root.querySelector('.rs-reveal h2').textContent).toBe('Chin');
    expect(textarea().value).toBe('Amir\nBella');

    // Two entries share a name: only the one that was drawn goes.
    drawValue(1);
    root.remove();
    mount({ ...SAVED, draft: 'Amir\nAmir\nBella', removeAfterDraw: true });
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(textarea().value).toBe('Amir\nBella');
  });
});

function prefersMotion(reduce) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduce : !reduce,
    media: query,
  }));
}

// Everything inside the first block that starts with `opening`, found by counting braces so the
// check does not depend on how the stylesheet happens to be formatted.
function blockOf(source, opening) {
  const start = source.indexOf(opening);
  if (start === -1) return null;
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && (depth -= 1) === 0) return { start, end: index + 1 };
  }
  return null;
}

describe('random selector reduced motion', () => {
  it('holds the board still while drawing when the user asks for reduced motion', () => {
    prefersMotion(true);
    mount();
    drawButton().click();
    const first = boardText();
    vi.advanceTimersByTime(QUICK_MS / 2);
    expect(boardText()).toBe(first);
    expect(first).toBe('DRAWING');
    vi.advanceTimersByTime(QUICK_MS);
    expect(root.querySelector('.rs-reveal')).not.toBeNull();
  });

  it('sweeps flaps across the board when the user has no reduced-motion preference', () => {
    prefersMotion(false);
    mount();
    drawButton().click();
    vi.advanceTimersByTime(300);
    expect(boardText()).not.toBe('READY');
  });

  it('only runs flap animation inside the no-preference media query', () => {
    const media = blockOf(css, '@media (prefers-reduced-motion: no-preference)');
    expect(media).not.toBeNull();
    const inside = css.slice(media.start, media.end);
    const outside = css.slice(0, media.start) + css.slice(media.end);
    const animationRule = /(^|[\s;{])animation(-[a-z-]+)?\s*:/m;
    expect(inside).toMatch(animationRule);
    expect(outside).not.toMatch(animationRule);
    expect(outside).not.toContain('@keyframes');
  });

  it('turns over at most one column of flaps per tick, and never the focused draw button', () => {
    prefersMotion(false);
    mount();
    drawButton().focus();
    drawButton().click();
    // Starting the draw rebuilds the screen once; after that the button must not be replaced again.
    const button = drawButton();
    const flaps = () =>
      [...root.querySelectorAll('.selector-flap')].map((flap) => flap.textContent);
    let previous = flaps();
    let most = 0;
    for (let tick = 0; tick < 10; tick += 1) {
      vi.advanceTimersByTime(68);
      const now = flaps();
      most = Math.max(most, now.filter((character, index) => character !== previous[index]).length);
      previous = now;
      expect(drawButton()).toBe(button);
    }
    // 4 rows: one column is 4 flaps. That keeps every flap far below three changes a second.
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(4);
  });
});

describe('random selector screen-reader support', () => {
  const live = () => root.querySelector('[role="status"]');
  const board = () => root.querySelector('.selector-board');

  it('announces the result through one live region that outlives every re-render', () => {
    mount();
    const region = live();
    drawButton().click();
    expect(region.textContent).toMatch(/Drawing an entry/);

    vi.advanceTimersByTime(QUICK_MS + 100);

    // Same node, still attached: a region rebuilt by render() is gone before it can be announced.
    expect(live()).toBe(region);
    expect(region.isConnected).toBe(true);
    expect(region.textContent).toMatch(/^(Amir|Bella|Chin) selected and kept in the draw\./);
    expect(root.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('re-announces an identical message by changing its text', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    mount();
    const share = () =>
      [...root.querySelectorAll('button')].find((b) => /share link/i.test(b.textContent));
    share().click();
    await vi.advanceTimersByTimeAsync(0);
    const first = live().textContent;
    share().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(live().textContent).not.toBe(first);
    expect(live().textContent.trim()).toBe(first.trim());
  });

  it('names the board from the draw state, not from the shuffling flaps', () => {
    mount();
    expect(board().getAttribute('role')).toBe('img');
    expect(board().getAttribute('aria-label')).toBe('Board ready. No entry drawn yet');

    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS / 2);
    expect(board().getAttribute('aria-label')).toBe('Drawing an entry');

    vi.advanceTimersByTime(QUICK_MS);
    const drawn = root.querySelector('.rs-reveal h2').textContent;
    expect(board().getAttribute('aria-label')).toBe(`Selected entry: ${drawn}`);
  });

  it('keeps keyboard focus on the draw button through the whole spin', () => {
    mount();
    drawButton().focus();
    drawButton().click();
    expect(drawButton().getAttribute('aria-disabled')).toBe('true');
    expect(drawButton().disabled).toBe(false);
    expect(document.activeElement).toBe(drawButton());

    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(document.activeElement).toBe(drawButton());
    expect(drawButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('gives the page a heading', () => {
    mount();
    expect(root.querySelector('h1').textContent).toBe('Random Selector');
  });
});

describe('random selector editing keeps the control in use', () => {
  it('keeps the caret and the same textarea while typing mid-list', () => {
    mount();
    const field = textarea();
    field.focus();
    field.value = 'AXmir\nBella\nChin';
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new Event('input', { bubbles: true }));

    expect(textarea()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(2);
    expect(root.querySelector('#rs-tab-entries .rs-count').textContent).toBe('3');
  });

  it('updates weights in place without replacing the input being edited', () => {
    mount();
    const input = root.querySelector('.rs-weight-input');
    input.focus();
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(root.querySelector('.rs-weight-input')).toBe(input);
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(root.querySelectorAll('.rs-odds-value')[0].textContent).toBe('60.0%');
    expect(root.querySelector('.rs-weight-total').textContent).toBe('Total weight 5');
    expect(textarea().value).toBe('Amir | 3\nBella\nChin');
  });
});

describe('random selector csv import', () => {
  const importField = () => root.querySelector('input[type="file"]');

  async function importCsv(text) {
    const file = new File([text], 'entries.csv', { type: 'text/csv' });
    // jsdom's File has no text(); browsers do.
    file.text = () => Promise.resolve(text);
    Object.defineProperty(importField(), 'files', { value: [file], configurable: true });
    importField().dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  }

  it('loads names and weights, keeping a quoted name with a comma whole', async () => {
    mount();
    await importCsv('Entry,Weight\r\n"Smith, John",3\r\nAmir');
    expect(textarea().value).toBe('Smith, John | 3\nAmir');
    expect(root.querySelector('[role="status"]').textContent).toMatch(/Imported 2 entries/);
  });

  it('leaves the current list alone when the file holds no entries', async () => {
    mount();
    await importCsv('Entry,Weight\r\n');
    expect(textarea().value).toBe('Amir\nBella\nChin');
    expect(root.querySelector('[role="status"]').textContent).toMatch(/No entries found/);
  });

  it('says so when the entry limit leaves some of the file out', async () => {
    mount();
    await importCsv(Array.from({ length: 90 }, (_, index) => `N${index}`).join('\n'));
    expect(root.querySelector('[role="status"]').textContent).toMatch(/Imported 80 of 90 entries/);
  });
});

describe('random selector sound never stops a draw', () => {
  it('draws to a result with sound on (the default) when play() returns a promise', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    mount({ draft: 'Amir\nBella', drawPreset: 'quick' });
    expect(buttonByText('Sound on')).toBeDefined();
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(drawButton().textContent).toBe('Draw');
    expect(root.querySelector('.rs-reveal')).not.toBeNull();
  });

  it('still finishes the draw when play() returns nothing or throws', () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    for (const behaviour of [
      () => undefined,
      () => {
        throw new Error('no audio');
      },
    ]) {
      play.mockImplementation(behaviour);
      mount({ draft: 'Amir\nBella', drawPreset: 'quick' });
      drawButton().click();
      vi.advanceTimersByTime(QUICK_MS + 100);
      expect(drawButton().textContent).toBe('Draw');
      expect(root.querySelector('.rs-reveal')).not.toBeNull();
      dispose();
      root.remove();
    }
  });
});

describe('random selector share links and storage', () => {
  const sharedUrl = (draw) =>
    window.history.replaceState(null, '', `/tools/random-selector/?draw=${draw}`);

  it('loads the shared list over the saved one without overwriting storage until an edit', () => {
    sharedUrl(encodeShare({ draft: 'Xena\nYuri', removeAfterDraw: false }));
    mount({ ...SAVED, soundOn: false });
    expect(textarea().value).toBe('Xena\nYuri');
    expect(storage.written().draft).toBe('Amir\nBella\nChin');
    // The saved sound preference still applies to a shared list.
    expect(buttonByText('Sound off')).toBeDefined();
    expect(root.querySelector('.rs-note').textContent).toMatch(/Shared draw loaded/);
  });

  it('says so when a share link cannot be read, and loads the visitor’s own list', () => {
    sharedUrl('not-a-real-link');
    mount();
    expect(textarea().value).toBe('Amir\nBella\nChin');
    expect(root.querySelector('.rs-note').textContent).toMatch(/could not be read/);
  });

  it('refuses to report a link as copied when the list is too long to share', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount();
    textarea().value = Array(2000).fill('Name').join('\n');
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    buttonByText('Copy share link').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]').textContent).toMatch(/too long to share/);
  });

  it('says the share link was copied, once the clipboard has taken it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount();
    buttonByText('Copy share link').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('?draw=');
    expect(root.querySelector('[role="status"]').textContent).toBe(
      'Share link copied. Anyone opening it gets this list and setting.',
    );
  });

  it('reports a clipboard failure', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    mount();
    buttonByText('Copy share link').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.querySelector('[role="status"]').textContent).toMatch(/Could not copy/);
  });

  it('writes the result and history to storage after a draw', () => {
    mount();
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    const saved = storage.written();
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].name).toMatch(/^(Amir|Bella|Chin)$/);
  });

  it('mounts even when reading browser storage throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    root = document.createElement('div');
    document.body.append(root);
    expect(() => {
      dispose = mountRandomSelector(root);
    }).not.toThrow();
    expect(root.querySelector('h1')).not.toBeNull();
  });

  it('ignores corrupt saved history records instead of failing to draw the screen', () => {
    mount({ ...SAVED, history: [null, 3, { name: 'Zed', removed: false }] });
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(1);
  });

  it('keeps counting past the 20 draws the history keeps', () => {
    mount();
    for (let draw = 0; draw < 22; draw += 1) {
      drawButton().click();
      vi.advanceTimersByTime(QUICK_MS + 100);
    }
    expect(storage.written().history).toHaveLength(20);
    expect(root.querySelector('.rs-history li span').textContent).toBe('22');
  });
});

describe('random selector result controls', () => {
  function drawOnce(saved) {
    mount(saved);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
  }

  it('hands keyboard focus to the draw button after Keep result and Discard & redraw', () => {
    drawOnce();
    buttonByText('Keep result').focus();
    buttonByText('Keep result').click();
    expect(document.activeElement).toBe(drawButton());
    expect(root.querySelector('[role="status"]').textContent).toMatch(
      /kept as the selected result/,
    );

    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    buttonByText('Discard & redraw').focus();
    buttonByText('Discard & redraw').click();
    expect(document.activeElement).toBe(drawButton());
  });

  it('puts a removed entry back, and drops its history row, when the result is redrawn', () => {
    drawOnce({ ...SAVED, removeAfterDraw: true });
    expect(textarea().value.split('\n')).toHaveLength(2);
    buttonByText('Discard & redraw').click();
    expect(textarea().value.split('\n').sort()).toEqual(['Amir', 'Bella', 'Chin']);
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(0);
  });

  it('says there is nothing to draw instead of silently doing nothing', () => {
    mount({ ...SAVED, draft: '' });
    drawButton().click();
    expect(root.querySelector('[role="status"]').textContent).toBe(
      'Add at least one entry to draw.',
    );
  });

  it('wraps a long name on word boundaries and marks it when it is cut', () => {
    mount({ ...SAVED, draft: 'Alexandra Maximiliana Konstantinopoulou-Richardson van Der Berg' });
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    const rows = [...root.querySelectorAll('.selector-flap-row')].map((row) =>
      [...row.children].map((flap) => flap.textContent).join(''),
    );
    // Four rows are all there is, so the block starts on the top row, and each row is centred.
    expect(rows[0].trim()).toBe('ALEXANDRA');
    expect(rows[0]).toBe('  ALEXANDRA   ');
    expect(rows[1].trim()).toBe('MAXIMILIANA');
    expect(rows[3].endsWith('…')).toBe(true);
    // The full name is never lost: it is in the result panel.
    expect(root.querySelector('.rs-reveal h2').textContent).toBe(
      'Alexandra Maximiliana Konstantinopoulou-Richardson van Der Berg',
    );
  });

  it('loads the example list back after the list is cleared', () => {
    mount();
    buttonByText('Clear list').click();
    buttonByText('Load example list').click();
    expect(textarea().value.split('\n')).toHaveLength(8);
    expect(root.querySelector('.rs-note').textContent).toBe('Example list loaded.');
    expect(
      [...root.querySelectorAll('.rs-entry-actions button')].map((b) => b.textContent),
    ).toEqual(['Import CSV', 'Export CSV', 'Load example list', 'Clear list']);
    expect(buttonByText('Load example list').classList.contains('action-outline')).toBe(true);
  });

  it('clears the list and the history, and Undo brings both back', () => {
    drawOnce();
    buttonByText('Clear list').click();
    expect(textarea().value).toBe('');
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(0);
    buttonByText('Undo').click();
    expect(textarea().value.split('\n')).toHaveLength(3);
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(1);
  });
});

describe('random selector keyboard and display', () => {
  const press = (init = {}) => {
    const event = new KeyboardEvent('keydown', {
      code: 'Space',
      cancelable: true,
      bubbles: true,
      ...init,
    });
    window.dispatchEvent(event);
    return event;
  };

  it('draws on a plain Space with nothing focused, and leaves every other Space alone', () => {
    mount();
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press({ shiftKey: true }).defaultPrevented).toBe(false);
    expect(press({ repeat: true }).defaultPrevented).toBe(false);
    root.querySelector('a').focus();
    expect(press().defaultPrevented).toBe(false);
    expect(drawButton().getAttribute('aria-disabled')).toBeNull();

    document.activeElement.blur();
    expect(press().defaultPrevented).toBe(true);
    expect(drawButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('does not swallow Space for scrolling when there is nothing to draw', () => {
    mount({ ...SAVED, draft: '' });
    expect(press().defaultPrevented).toBe(false);
  });

  it('stops everything when the screen is disposed', () => {
    mount();
    drawButton().click();
    dispose();
    vi.advanceTimersByTime(QUICK_MS * 2);
    expect(root.querySelector('.rs-reveal')).toBeNull();
    expect(press().defaultPrevented).toBe(false);
  });

  it('hides the controls in Present mode and brings them back', () => {
    mount();
    buttonByText('Present').focus();
    buttonByText('Present').click();
    expect(root.querySelector('.rs-side')).toBeNull();
    expect(root.querySelector('main').dataset.surface).toBe('stage');
    expect(document.activeElement).toBe(buttonByText('Exit (Esc)'));
    buttonByText('Exit (Esc)').click();
    expect(root.querySelector('.rs-side')).not.toBeNull();
  });

  it('toggles sound and picks a draw length', () => {
    mount();
    buttonByText('Sound off').click();
    expect(buttonByText('Sound on')).toBeDefined();
    expect(storage.written().soundOn).toBe(true);
    buttonByText('Ceremonial').click();
    expect(buttonByText('Ceremonial').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Quick').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('random selector fields that commit in place', () => {
  it('commits the board title, accent colour and volume without replacing the control', () => {
    mount({ ...SAVED, soundOn: true });
    const title = root.querySelector('#rs-board-title');
    title.focus();
    title.value = '  Friday   Finals ';
    title.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('#rs-board-title')).toBe(title);
    expect(title.value).toBe('Friday Finals');
    expect(root.querySelector('.rs-board-label span:last-child').textContent).toBe('Friday Finals');

    const colour = root.querySelector('#rs-accent-color');
    colour.value = '#d96135';
    colour.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('#rs-accent-color')).toBe(colour);
    expect(root.querySelector('main').style.getPropertyValue('--rs-accent')).toBe('#d96135');
    expect(root.querySelector('.rs-color-field code').textContent).toBe('#D96135');

    const volume = root.querySelector('.rs-volume-range');
    volume.focus();
    volume.value = '0.4';
    volume.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.rs-volume-range')).toBe(volume);
    expect(document.activeElement).toBe(volume);
    expect(root.querySelector('.rs-volume-control span').textContent).toBe('Sound volume 40%');
  });

  it('puts an invalid weight back instead of storing it', () => {
    mount();
    const input = root.querySelector('.rs-weight-input');
    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(input.value).toBe('1');
    expect(textarea().value).toBe('Amir\nBella\nChin');
  });

  it('refreshes the counts, weight rows, draw button and result while typing, in place', () => {
    mount();
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(root.querySelector('.rs-reveal')).not.toBeNull();
    const controls = root.querySelector('.rs-side');
    const weights = root.querySelector('.rs-weights');

    textarea().focus();
    textarea().value = 'A\nB';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.rs-side')).toBe(controls);
    expect(root.querySelector('.rs-weights')).toBe(weights);
    expect(weights.querySelectorAll('.rs-weight-row')).toHaveLength(2);
    // One entry count, on the tab: there is no second copy of it anywhere on the page.
    expect(root.querySelector('#rs-tab-entries .rs-count').textContent).toBe('2');
    expect(root.querySelector('.rs-entry-count')).toBeNull();
    expect(root.querySelector('.rs-reveal')).toBeNull();

    textarea().value = '';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    expect(drawButton().getAttribute('aria-disabled')).toBe('true');
    textarea().value = 'A';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    expect(drawButton().getAttribute('aria-disabled')).toBeNull();
  });
});

describe('random selector csv export', () => {
  it('downloads the list through the shared writer, with a byte-order mark for Excel', () => {
    const created = [];
    vi.stubGlobal(
      'URL',
      Object.assign(function URL() {}, {
        createObjectURL: (blob) => {
          created.push(blob);
          return 'blob:test';
        },
        revokeObjectURL: () => {},
      }),
    );
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount({ ...SAVED, draft: 'Zoë | 2\n=SUM(A1)' });
    buttonByText('Export CSV').click();
    const csv = "Entry,Weight\r\nZoë,2\r\n'=SUM(A1),1";
    expect(created).toHaveLength(1);
    expect(created[0].size).toBe(new TextEncoder().encode(BOM + csv).length);
  });
});

describe('random selector follows the Petrol accent unless the user picks one', () => {
  const app = () => root.querySelector('main');
  const accentVar = () => app().style.getPropertyValue('--rs-accent');

  it('sets no accent of its own by default, so the Petrol token applies', () => {
    mount();
    expect(app().getAttribute('style')).toBeNull();
    expect(root.querySelector('.rs-color-field code').textContent).toBe('PETROL');
    expect(buttonByText('Reset colour').hidden).toBe(true);
  });

  it('applies a saved custom accent and can go back to the Petrol one', () => {
    mount({ ...SAVED, accentColor: '#d96135' });
    expect(accentVar()).toBe('#d96135');
    const reset = buttonByText('Reset colour');
    expect(reset.hidden).toBe(false);

    reset.focus();
    reset.click();
    expect(accentVar()).toBe('');
    expect(app().style.getPropertyValue('--rs-accent-contrast')).toBe('');
    expect(root.querySelector('.rs-color-field code').textContent).toBe('PETROL');
    expect(reset.hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('#rs-accent-color'));
    expect(storage.written().accentColor).toBeNull();
  });

  it('treats the accent this tool used to default to as no custom accent', () => {
    mount({ ...SAVED, accentColor: '#0fb5a3' });
    expect(app().getAttribute('style')).toBeNull();
  });

  it('lets a share link without an accent override a saved custom one', () => {
    window.history.replaceState(
      null,
      '',
      `/tools/random-selector/?draw=${encodeShare({ draft: 'X\nY', removeAfterDraw: false, accentColor: null })}`,
    );
    mount({ ...SAVED, accentColor: '#d96135' });
    expect(app().getAttribute('style')).toBeNull();
  });
});

describe('random selector weights list', () => {
  it('keeps the browser spinner out of the weight box so the number is centred in the whole box', () => {
    // A number field reserves room for its up/down arrows even when they are not shown; with it the
    // number measured 7px left of centre. Pixel-measured fix; this guards the rules that make it.
    const input = declarationsOf('.rs-weight-input');
    expect(input.appearance).toBe('textfield');
    expect(input['-moz-appearance']).toBe('textfield');
    for (const part of ['inner', 'outer']) {
      const arrows = declarationsOf(`.rs-weight-input::-webkit-${part}-spin-button`);
      expect(arrows['-webkit-appearance']).toBe('none');
      expect(arrows.margin).toBe('0');
    }
    mount();
    expect(root.querySelector('.rs-weight-input').getAttribute('inputmode')).toBe('numeric');
  });

  it('dims the busy DRAW button with token colours, not opacity that drags the label under 4.5:1', () => {
    const busy = declarationsOf(".rs-draw-button[aria-disabled='true']");
    expect(busy.opacity).toBeUndefined();
    expect(busy.color).toBe('var(--color-text-muted)');
    expect(busy.background).toBe('var(--color-surface-sunken)');
  });

  it('keeps a row reached by keyboard clear of the sticky head, and fine print at 12px or more', () => {
    expect(declarationsOf('.rs-weights')['scroll-padding-top']).toBe(
      declarationsOf('.rs-weights-head').height,
    );
    expect(declarationsOf('.rs-board-label')['font-size']).toBe('var(--text-2xs)');
    expect(declarationsOf('.rs-section-summary')['font-size']).toBe('var(--text-xs)');
  });

  it('names each percentage for a screen reader and ties the list to its warning', () => {
    mount();
    expect(root.querySelector('.rs-odds .sr-only').textContent).toBe('Odds for Amir: ');
    const describedBy = textarea().getAttribute('aria-describedby').split(' ');
    expect(describedBy.map((id) => root.querySelector(`#${id}`))).toEqual([
      root.querySelector('.rs-hint'),
      root.querySelector('.rs-warning'),
    ]);
  });

  it('shows column heads once, with a bar and a percentage per entry, and none when empty', () => {
    mount();
    const list = root.querySelector('.rs-weights');
    const head = list.querySelector('.rs-weights-head');
    expect(head.textContent).toBe('ENTRYWEIGHTODDS');
    expect(head.getAttribute('aria-hidden')).toBe('true');
    expect(list.querySelectorAll('.rs-weights-head')).toHaveLength(1);
    expect(list.querySelectorAll('.rs-weight-row')).toHaveLength(3);
    expect(list.querySelectorAll('.rs-odds-fill')).toHaveLength(3);

    textarea().value = '';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    expect(list.children).toHaveLength(0);
  });

  it('keeps every bar in step with the percentages when a weight changes', () => {
    mount();
    const input = root.querySelector('.rs-weight-input');
    input.value = '2';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const widths = [...root.querySelectorAll('.rs-odds-fill')].map((fill) => fill.style.width);
    const labels = [...root.querySelectorAll('.rs-odds-value')].map((cell) => cell.textContent);
    expect(widths).toEqual(['50%', '25%', '25%']);
    expect(labels).toEqual(['50.0%', '25.0%', '25.0%']);
  });
});

describe('random selector says what it did not use, and lets a replace be undone', () => {
  const live = () => root.querySelector('[role="status"]');
  const type = (text) => {
    textarea().value = text;
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const warning = () => root.querySelector('.rs-warning');
  const board = () => root.querySelector('.selector-board');
  const longList = (count) => Array.from({ length: count }, (_, i) => `N${i}`).join('\n');

  it('warns, in the page and by voice, about entries past the limit and clears the warning', () => {
    mount();
    expect(warning().hidden).toBe(true);
    type(longList(83));
    expect(warning().hidden).toBe(false);
    expect(warning().textContent).toBe('3 lines are past the 80-entry limit and ignored.');
    expect(live().textContent).toContain('3 lines are past the 80-entry limit');
    type(longList(10));
    expect(warning().hidden).toBe(true);
  });

  it('warns when a weight is written outside 1 to 1000 instead of changing it quietly', () => {
    mount();
    type('Amir | 0\nBella');
    expect(warning().textContent).toBe('Weights run from 1 to 1000. Changed: “Amir” (0 → 1).');
  });

  it('keeps the entries past the limit when a weight is edited or an entry is removed', () => {
    mount({ ...SAVED, draft: longList(82), removeAfterDraw: true });
    const input = root.querySelector('.rs-weight-input');
    input.value = '4';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(textarea().value.split('\n')).toHaveLength(82);
    expect(textarea().value.split('\n')[0]).toBe('N0 | 4');

    drawValue(0);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    // N0 was drawn and removed; the 81st line took its place, nothing else was lost.
    const lines = textarea().value.split('\n');
    expect(lines).toHaveLength(81);
    expect(lines).not.toContain('N0 | 4');
    expect(root.querySelectorAll('.rs-weight-row')).toHaveLength(80);
  });

  it('undoes CLEAR SESSION, bringing back the list and the history', () => {
    mount({ ...SAVED, history: [{ name: 'Zed', removed: false, n: 1 }] });
    buttonByText('Clear list').click();
    expect(textarea().value).toBe('');
    const undo = buttonByText('Undo');
    expect(undo).toBeDefined();

    undo.focus();
    undo.click();
    expect(textarea().value).toBe('Amir\nBella\nChin');
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(1);
    expect(live().textContent).toMatch(/Clear list undone/);
    expect(buttonByText('Undo')).toBeUndefined();
    expect(document.activeElement).toBe(drawButton());
  });

  it('undoes Load example list', () => {
    mount();
    buttonByText('Load example list').click();
    expect(textarea().value.split('\n')).toHaveLength(8);
    buttonByText('Undo').click();
    expect(textarea().value).toBe('Amir\nBella\nChin');
  });

  it('offers no undo once the list has been edited or a draw has started', () => {
    mount();
    buttonByText('Clear list').click();
    type('Solo');
    expect(buttonByText('Undo')).toBeUndefined();

    buttonByText('Load example list').click();
    expect(buttonByText('Undo')).toBeDefined();
    drawButton().click();
    expect(buttonByText('Undo')).toBeUndefined();
  });

  it('refuses a CSV that is too large before reading it, and leaves the list alone', async () => {
    mount();
    const file = new File(['x'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 2_000_000 });
    const read = vi.fn(() => Promise.resolve('A\nB'));
    file.text = read;
    const input = root.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
    expect(textarea().value).toBe('Amir\nBella\nChin');
    expect(live().textContent).toMatch(/too large to import/);
  });

  it('edits the entry that was meant when a line holds only a weight', () => {
    mount({ ...SAVED, draft: 'Amir\n| 3\nBella\nChin', removeAfterDraw: true });
    expect(warning().textContent).toBe('1 line has a weight but no name and is skipped.');
    const input = root.querySelectorAll('.rs-weight-input')[1];
    input.value = '5';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(textarea().value).toBe('Amir\n| 3\nBella | 5\nChin');

    // The odds bar for Bella puts her at index 1; she is drawn and must be the one removed.
    drawValue(5);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(root.querySelector('[role="status"]').textContent).toMatch(/Bella/);
    expect(textarea().value).toBe('Amir\n| 3\nChin');
  });

  it('says what a weight box did with a number it could not use', () => {
    mount();
    const input = () => root.querySelector('.rs-weight-input');
    const change = (value) => {
      input().value = value;
      input().dispatchEvent(new Event('change', { bubbles: true }));
    };
    change('2500');
    expect(input().value).toBe('1000');
    expect(warning().textContent).toBe('Weight for Amir is 1000: weights run from 1 to 1000.');
    expect(live().textContent).toContain('Weight for Amir is 1000');
    change('');
    expect(input().value).toBe('1000');
    expect(live().textContent).toContain('must be 1 to 1000, so it stays 1000');
    change('7');
    expect(warning().hidden).toBe(true);
  });

  it('keeps the first UNDO when Clear list or Load example list is pressed again', () => {
    mount();
    buttonByText('Clear list').click();
    buttonByText('Clear list').click();
    buttonByText('Undo').click();
    expect(textarea().value).toBe('Amir\nBella\nChin');

    buttonByText('Load example list').click();
    buttonByText('Load example list').click();
    buttonByText('Undo').click();
    expect(textarea().value).toBe('Amir\nBella\nChin');
  });

  it('puts the board and the saved copy back too, and says what UNDO will undo', () => {
    mount();
    drawValue(0);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(boardText()).not.toBe('');
    buttonByText('Clear list').click();
    expect(board().getAttribute('aria-label')).toBe('Board ready. No entry drawn yet');
    expect(storage.written().draft).toBe('');
    expect(buttonByText('Undo').getAttribute('aria-label')).toBe('Undo: clear list');
    expect(live().textContent).toContain('Undo is available.');

    buttonByText('Undo').click();
    expect(storage.written().draft).toBe('Amir\nBella\nChin');
    expect(storage.written().history).toHaveLength(1);
    expect(board().getAttribute('aria-label')).toBe('Selected entry: Amir');
  });

  it('drops UNDO when a weight is changed or another note replaces the one that offered it', async () => {
    mount();
    await importCsvFile('Zed\nYan');
    expect(buttonByText('Undo')).toBeDefined();
    const input = root.querySelector('.rs-weight-input');
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(buttonByText('Undo')).toBeUndefined();

    buttonByText('Clear list').click();
    expect(buttonByText('Undo')).toBeDefined();
    buttonByText('Copy share link').click();
    // The note is set once the copy has been attempted (core/clipboard.js answers asynchronously, even when
    // there is no clipboard to try).
    await vi.advanceTimersByTimeAsync(0);
    expect(buttonByText('Undo')).toBeUndefined();
  });

  it('keeps an undone replace from being announced over by the warning of the restored list', () => {
    mount({ ...SAVED, draft: longList(83) });
    buttonByText('Clear list').click();
    buttonByText('Undo').click();
    expect(live().textContent).toContain('Clear list undone.');
    expect(warning().textContent).toContain('past the 80-entry limit');
  });

  it('undoes a CSV import', async () => {
    mount();
    const file = new File(['x'], 'a.csv', { type: 'text/csv' });
    file.text = () => Promise.resolve('Zed\nYan');
    const input = root.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(textarea().value).toBe('Zed\nYan');
    buttonByText('Undo').click();
    expect(textarea().value).toBe('Amir\nBella\nChin');
  });

  it('accepts a CSV of exactly 1 MB and refuses one byte more', async () => {
    mount();
    const pick = async (size) => {
      const file = new File(['x'], 'a.csv', { type: 'text/csv' });
      Object.defineProperty(file, 'size', { value: size });
      const read = vi.fn(() => Promise.resolve('Zed'));
      file.text = read;
      const input = root.querySelector('input[type="file"]');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      return read;
    };
    expect(await pick(1_000_001)).not.toHaveBeenCalled();
    expect(textarea().value).toBe('Amir\nBella\nChin');
    expect(await pick(1_000_000)).toHaveBeenCalled();
    expect(textarea().value).toBe('Zed');
  });

  it('leaves Present mode on Escape and puts focus back on the Present button', () => {
    mount();
    buttonByText('Present').click();
    expect(root.querySelector('.rs-side')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.rs-side')).not.toBeNull();
    expect(document.activeElement).toBe(buttonByText('Present'));
  });
});

// ---- Tier 1 redesign (2026-11-19) ----

describe('random selector board: names are centred', () => {
  const rowsOf = (value) => {
    const cells = boardCells(value);
    return Array.from({ length: 4 }, (_, row) => cells.slice(row * 14, row * 14 + 14).join(''));
  };

  it('centres one line across its row and sits it on a middle row', () => {
    // BELLA is 5 letters: floor((14 - 5) / 2) = 4 blanks before it, and it is row 2 of 4.
    expect(rowsOf('Bella')).toEqual([
      ' '.repeat(14),
      '    BELLA     ',
      ' '.repeat(14),
      ' '.repeat(14),
    ]);
  });

  it('centres each row of a wrapped name, and the block down the board', () => {
    // 'NURUL AQILAH' (12) then 'BINTI AHMAD' (11): two lines, so rows 2 and 3.
    expect(rowsOf('Nurul Aqilah Binti Ahmad')).toEqual([
      ' '.repeat(14),
      ' NURUL AQILAH ',
      ' BINTI AHMAD  ',
      ' '.repeat(14),
    ]);
  });

  it('keeps a full-width word whole, and an emoji as one flap', () => {
    expect(rowsOf('ABCDEFGHIJKLMN')[1]).toBe('ABCDEFGHIJKLMN');
    expect(boardCells('😀').filter((flap) => flap !== ' ')).toEqual(['😀']);
  });

  it('still marks a name that does not fit four rows with an ellipsis in the last flap', () => {
    const cells = boardCells('One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve');
    expect(cells).toHaveLength(56);
    expect(cells.at(-1)).toBe('…');
    // Four rows are all used, so the block starts on the top row.
    expect(cells.slice(0, 14).join('').trim()).not.toBe('');
  });

  it('shows the name centred on the rendered board', () => {
    mount();
    expect(boardText()).toBe('READY');
    const rows = [...root.querySelectorAll('.selector-flap-row')].map((row) =>
      [...row.children].map((flap) => flap.textContent).join(''),
    );
    // READY is 5: four blanks first, on the second row.
    expect(rows[1]).toBe('    READY     ');
  });
});

describe('random selector layout: tabs, sections and the copy', () => {
  function drawOnce(saved) {
    mount(saved);
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
  }

  it('has Entries and History tabs with one count each, and switches in place', () => {
    mount({ ...SAVED, history: [{ name: 'Amir', weight: 1, removed: false, n: 1, at: 'x' }] });
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Entries 3', 'History 1']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    const field = textarea();
    expect(field.closest('[hidden]')).toBeNull();

    tabs[1].click();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('#rs-panel-history').hidden).toBe(false);
    expect(root.querySelector('#rs-panel-entries').hidden).toBe(true);
    // The entry list is never replaced by a tab change, so its caret and text survive.
    expect(textarea()).toBe(field);
    expect(root.querySelector('.rs-history-panel h2').textContent).toBe('History');
    expect(root.querySelector('.rs-history li strong').textContent).toBe('Amir');

    tabs[0].click();
    expect(root.querySelector('#rs-panel-entries').hidden).toBe(false);
  });

  it('moves between the tabs with the arrow keys', () => {
    mount();
    const [entries, history] = [...root.querySelectorAll('[role="tab"]')];
    entries.focus();
    entries.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(history.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(history);
  });

  it('keeps the chosen tab through a re-render', () => {
    mount();
    root.querySelectorAll('[role="tab"]')[1].click();
    buttonByText('Sound off').click();
    expect(root.querySelector('#rs-tab-history').getAttribute('aria-selected')).toBe('true');
  });

  it('puts the three sections under the list, closed, each with a one-line summary', () => {
    mount();
    const heads = [...root.querySelectorAll('.rs-section-head')];
    expect(heads.map((head) => head.querySelector('.rs-section-title').textContent)).toEqual([
      'Weights & odds',
      'Draw settings',
      'Board look',
    ]);
    expect(heads.every((head) => head.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(heads.map((head) => head.querySelector('.rs-section-summary').textContent)).toEqual([
      '3 names, all 33.3%',
      'Quick speed (1 s) · sound off',
      'Title “Player draw” · Petrol colour',
    ]);
    // The list, the actions, the sections and the share link come in that order.
    const order = ['#rs-entries', '.rs-entry-actions', '.rs-sections', '.rs-share'].map(
      (selector) => root.querySelector(selector),
    );
    order.slice(1).forEach((node, index) => {
      expect(
        order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('opens a section in place and keeps its summary in step with the settings', () => {
    mount();
    const head = root.querySelector('.rs-section-head');
    const body = root.querySelector('#rs-section-weights');
    expect(body.hidden).toBe(true);
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);

    const input = root.querySelector('.rs-weight-input');
    input.value = '3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(head.querySelector('.rs-section-summary').textContent).toBe('3 names, weighted odds');

    buttonByText('Ceremonial').click();
    expect(root.querySelectorAll('.rs-section-summary')[1].textContent).toBe(
      'Ceremonial speed (3.2 s) · sound off',
    );
    // The weights section is still open after that re-render.
    expect(root.querySelector('#rs-section-weights').hidden).toBe(false);
  });

  it('draws the three speeds as one segmented control', () => {
    mount();
    const group = root.querySelector('.rs-preset-list');
    expect([...group.children].map((b) => b.textContent)).toEqual([
      'Quick',
      'Standard',
      'Ceremonial',
    ]);
    expect(group.getAttribute('role')).toBe('group');
  });

  it('uses the approved wording, and no marketing line, top-bar count or "loaded" count', () => {
    mount({ ...SAVED, history: [] });
    const text = root.textContent;
    expect(text).toContain('Names, one per line');
    expect(text).toContain('Give a name more chances: write Bella | 2 for double odds.');
    expect(text).toContain('Remove winners after each draw');
    expect(text).toContain('or press Space');
    for (const gone of [
      'A clear record of every draw',
      'DRAW COMPLETE',
      'REDRAW',
      'DRAW ENTRY',
      'loaded',
      'ENTRIES',
      'USE PETROL ACCENT',
      'Remove every selected entry',
    ]) {
      expect(text).not.toContain(gone);
    }
    root.querySelectorAll('[role="tab"]')[1].click();
    expect(root.querySelector('.empty').textContent).toBe(
      'No draws yet. Winners appear here, newest first.',
    );
  });

  it('says "Winner · draw N" and what happens to the winner, in both cases', () => {
    drawValue(0);
    drawOnce();
    expect(root.querySelector('.rs-kicker').textContent).toBe('Winner · draw 1');
    expect(root.querySelector('.rs-reveal-copy').textContent).toBe(
      'Still in the list, so Amir can be drawn again.',
    );
    expect(root.querySelector('.rs-board-state').textContent).toBe('Winner · draw 1');
    dispose();
    root.remove();
    drawOnce({ ...SAVED, removeAfterDraw: true });
    expect(root.querySelector('.rs-reveal-copy').textContent).toMatch(
      /^Removed from the list, so /,
    );
    // Already removed, so there is nothing left for "Remove from list" to do.
    expect(buttonByText('Remove from list')).toBeUndefined();
  });

  it('removes the winner on "Remove from list", marks the history row, and Discard & redraw puts it back', () => {
    drawValue(0);
    drawOnce();
    expect(textarea().value).toBe('Amir\nBella\nChin');
    buttonByText('Remove from list').click();
    expect(textarea().value).toBe('Bella\nChin');
    expect(root.querySelector('.rs-reveal-copy').textContent).toMatch(/^Removed from the list/);
    expect(storage.written().history.at(-1).removed).toBe(true);
    expect(buttonByText('Remove from list')).toBeUndefined();
    expect(document.activeElement).toBe(buttonByText('Keep result'));
    expect(root.querySelector('#rs-tab-entries .rs-count').textContent).toBe('2');

    buttonByText('Discard & redraw').click();
    expect(textarea().value.split('\n')).toHaveLength(3);
    expect(storage.written().history).toHaveLength(0);
  });

  it('shows "Reset colour" only once a colour has been picked', () => {
    mount();
    const reset = buttonByText('Reset colour');
    expect(reset.hidden).toBe(true);
    const colour = root.querySelector('#rs-accent-color');
    colour.value = '#d96135';
    colour.dispatchEvent(new Event('change', { bubbles: true }));
    expect(reset.hidden).toBe(false);
  });
});

describe('random selector: the community frame', () => {
  const follows = (a, b) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('shows the shared header, a breadcrumb with Sound and Present, the other tools and the footer', () => {
    mount();
    expect(root.querySelector('.public-header')).not.toBeNull();
    expect(root.querySelector('.public-header-link-active').textContent).toBe('Community Tools');
    const crumbs = root.querySelector('[aria-label="Breadcrumb"]');
    expect(crumbs.querySelector('a').getAttribute('href')).toBe('/community/');
    expect(crumbs.querySelector('[aria-current="page"]').textContent).toBe('Random Selector');
    // Sound and Present sit on the same row as the breadcrumb.
    const row = root.querySelector('.ct-bar-inner');
    expect(row.contains(crumbs)).toBe(true);
    expect([...row.querySelectorAll('.ct-controls button')].map((b) => b.textContent)).toEqual([
      'Sound off',
      'Present',
    ]);
    const strip = root.querySelector('.ct-strip');
    expect([...strip.querySelectorAll('.ct-tool-title')].map((n) => n.textContent)).toEqual([
      'Competition Timer',
      'Guess the Bean',
      'Brew Planner',
      'Throwdown Bracket Planner',
    ]);
    expect(strip.querySelector('.ct-strip-all').getAttribute('href')).toBe('/community/');
    expect(root.querySelector('.ct-footer').textContent).toContain(
      'Seduh Score · Free community tools, no account needed',
    );
    expect(root.querySelector('.ct-footer').textContent).toContain('Split-flap edition');
    // The header, the breadcrumb, the tool and the strip are in that order on the page.
    const main = root.querySelector('main.random-selector');
    expect(follows(root.querySelector('.ct-top'), main)).toBe(true);
    expect(follows(main, strip)).toBe(true);
  });

  it('hides the header, breadcrumb, strip and footer in Present mode, and shows them again', () => {
    mount();
    buttonByText('Present').click();
    for (const selector of ['.ct-header', '.ct-crumbs', '.ct-strip', '.ct-footer']) {
      expect(root.querySelector(selector).hidden).toBe(true);
    }
    // Sound and Exit stay on screen.
    expect([...root.querySelectorAll('.ct-controls button')].map((b) => b.textContent)).toEqual([
      'Sound off',
      'Exit (Esc)',
    ]);
    buttonByText('Exit (Esc)').click();
    for (const selector of ['.ct-header', '.ct-crumbs', '.ct-strip', '.ct-footer']) {
      expect(root.querySelector(selector).hidden).toBe(false);
    }
  });
});

describe('random selector Present mode and Fullscreen', () => {
  afterEach(() => {
    delete document.fullscreenEnabled;
    delete document.fullscreenElement;
    delete HTMLElement.prototype.requestFullscreen;
    delete document.exitFullscreen;
  });

  it('has no Fullscreen button where the browser has no Fullscreen API (an iPhone)', () => {
    mount();
    buttonByText('Present').click();
    expect(buttonByText('Fullscreen')).toBeUndefined();
    expect(buttonByText('Exit (Esc)')).toBeDefined();
  });

  it('offers Fullscreen where it exists, and asks for the whole page', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const request = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = request;
    mount();
    expect(buttonByText('Fullscreen')).toBeUndefined(); // only in Present mode
    buttonByText('Present').click();
    buttonByText('Fullscreen').click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(root.querySelector('.rs-page'));
  });

  it('does not ask to leave Fullscreen when the page is not in it', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    mount();
    buttonByText('Present').click();
    buttonByText('Exit (Esc)').click();
    expect(exit).not.toHaveBeenCalled();
  });

  it('leaves Fullscreen when Present is exited', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    mount();
    buttonByText('Present').click();
    Object.defineProperty(document, 'fullscreenElement', {
      value: root.querySelector('.rs-page'),
      configurable: true,
    });
    buttonByText('Exit (Esc)').click();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('keeps Draw, the winner and Keep result in Present mode, without the list', () => {
    mount();
    buttonByText('Present').click();
    expect(root.querySelector('.rs-side')).toBeNull();
    expect(drawButton()).not.toBeNull();
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(buttonByText('Keep result')).toBeDefined();
    expect(buttonByText('Discard & redraw')).toBeDefined();
    // "Remove from list" is a list edit, which Present mode does not offer.
    expect(buttonByText('Remove from list')).toBeUndefined();
  });
});

describe('random selector stylesheet rules from the Tier 1 design', () => {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('has no page-wide grid lines, no clipped corners, and a board frame on the large-panel radius', () => {
    expect(declarationsOf('.random-selector').background).toBeUndefined();
    // The only clip-path left is the visually-hidden text pattern; nothing cuts a corner.
    const clips = [...live.matchAll(/clip-path:\s*([^;]+);/g)].map(([, value]) => value.trim());
    expect(clips.every((value) => value === 'inset(50%)')).toBe(true);
    for (const selector of ['body', '.rs-page', '.random-selector', '.rs-host']) {
      expect(declarationsOf(selector)['background-image']).toBeUndefined();
    }
    expect(declarationsOf('.rs-board-frame')['border-radius']).toBe('var(--radius-lg)');
    expect(declarationsOf('.selector-flap')['border-radius']).toBe('var(--radius-sm)');
  });

  it('uses the mono face only for the flap letters and the draw numbers in History', () => {
    const users = [
      ...live.matchAll(/([^{}]+)\{([^{}]*font-family:\s*var\(--font-mono\)[^{}]*)\}/g),
    ].map(([, selector]) => selector.trim());
    expect(users.sort()).toEqual(['.rs-history-n', '.selector-flap']);
  });

  it('sets the winner and the headings in the display face and the rest in the body face', () => {
    expect(declarationsOf('.rs-title')['font-family']).toBe('var(--font-display)');
    expect(declarationsOf('.rs-reveal h2')['font-family']).toBe('var(--font-display)');
    expect(declarationsOf('body')['font-family']).toBe('var(--font-body)');
    expect(declarationsOf('.rs-textarea')['font-family']).toBe('var(--font-body)');
  });

  it('draws every button in the shared family: no text-buttons, no local button shapes', () => {
    expect(live).not.toMatch(/rs-text-button|rs-link-button/);
    mount();
    ['Import CSV', 'Export CSV', 'Copy share link', 'Present'].forEach((label) => {
      expect(buttonByText(label).classList.contains('action-outline')).toBe(true);
    });
    expect(drawButton().className).toContain('action-primary');
    expect(drawButton().className).toContain('btn-bevel');
    expect(buttonByText('Clear list').className).toContain('rs-quiet-danger');
  });

  it('pins Draw to the bottom of a phone screen, with safe-area padding and room under the page', () => {
    const phone = live.slice(live.lastIndexOf('@media (max-width: 700px)'));
    expect(phone).toMatch(/\.rs-draw-bar\s*\{[^}]*position:\s*fixed/);
    expect(phone).toMatch(/\.rs-draw-bar\s*\{[^}]*env\(safe-area-inset-bottom/);
    expect(phone).toMatch(
      /\.rs-page\s*\{[^}]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/,
    );
  });

  it('sizes the Present board by the screen height as well as its width', () => {
    // The first rule (the desktop one): the later one in the phone media query only narrows it.
    const cell = live.match(/\.is-presenting\.random-selector\s*\{[^}]*--rs-cell-h:\s*([^;]+);/)[1];
    expect(cell).toMatch(/100dvh/);
    expect(cell).toMatch(/100vw/);
    expect(declarationsOf('.rs-page.is-presenting').height).toBe('100dvh');
    expect(declarationsOf('.rs-page.is-presenting').overflow).toBe('hidden');
  });
});

describe('random selector status line', () => {
  it('stays on screen whichever tab is open, and in Present mode', () => {
    mount({ ...SAVED, draft: '' });
    root.querySelectorAll('[role="tab"]')[1].click();
    drawButton().click();
    const note = root.querySelector('.rs-note');
    expect(note.textContent).toBe('Add at least one entry to draw.');
    expect(note.closest('.rs-side')).toBeNull();
    expect(note.closest('[hidden]')).toBeNull();
    buttonByText('Present').click();
    expect(root.querySelector('.rs-note')).not.toBeNull();
  });
});

describe('random selector large text and the pinned bar', () => {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('scrolls a focused control clear of the pinned Draw bar on a phone', () => {
    const phone = live.slice(live.lastIndexOf('@media (max-width: 700px)'));
    expect(phone).toMatch(
      /html\s*\{[^}]*scroll-padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/,
    );
  });
  it('lets the tabs wrap at large text instead of clipping the second one', () => {
    expect(declarationsOf('.rs-side .tabs')['flex-wrap']).toBe('wrap');
    expect(declarationsOf('.rs-side .tabs').overflow).toBe('visible');
  });
});
