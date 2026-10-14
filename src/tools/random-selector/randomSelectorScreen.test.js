import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeShare, STORAGE_KEY } from './randomSelector.js';
import { mountRandomSelector } from './randomSelectorScreen.js';

function fakeStorage(saved) {
  const map = new Map(saved ? [[STORAGE_KEY, JSON.stringify(saved)]] : []);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    written: () => JSON.parse(map.get(STORAGE_KEY) ?? 'null'),
  };
}

const css = readFileSync(
  resolve(process.cwd(), 'src/tools/random-selector/randomSelector.css'),
  'utf8',
);

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

    expect(drawButton().textContent).toBe('DRAW ENTRY');
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
      [...root.querySelectorAll('button')].find((b) => /SHARE LINK/.test(b.textContent));
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
    expect(root.querySelector('h1').textContent).toBe('RANDOM SELECTOR');
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
    expect(root.querySelector('.rs-entry-count').textContent).toBe('3 ENTRIES');
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
    const totalText = [...root.querySelectorAll('.rs-weight-heading span')].map(
      (n) => n.textContent,
    );
    expect(totalText).toContain('5 TOTAL WEIGHT');
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
    expect(buttonByText('SOUND ON')).toBeDefined();
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    expect(drawButton().textContent).toBe('DRAW ENTRY');
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
      expect(drawButton().textContent).toBe('DRAW ENTRY');
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
    expect(buttonByText('SOUND OFF')).toBeDefined();
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
    buttonByText('COPY SHARE LINK').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]').textContent).toMatch(/too long to share/);
  });

  it('reports a clipboard failure', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    mount();
    buttonByText('COPY SHARE LINK').click();
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

  it('hands keyboard focus to the draw button after KEEP RESULT and REDRAW', () => {
    drawOnce();
    buttonByText('KEEP RESULT').focus();
    buttonByText('KEEP RESULT').click();
    expect(document.activeElement).toBe(drawButton());
    expect(root.querySelector('[role="status"]').textContent).toMatch(
      /kept as the selected result/,
    );

    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);
    buttonByText('REDRAW').focus();
    buttonByText('REDRAW').click();
    expect(document.activeElement).toBe(drawButton());
  });

  it('puts a removed entry back, and drops its history row, when the result is redrawn', () => {
    drawOnce({ ...SAVED, removeAfterDraw: true });
    expect(textarea().value.split('\n')).toHaveLength(2);
    buttonByText('REDRAW').click();
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
    expect(rows[0].trimEnd()).toBe('ALEXANDRA');
    expect(rows[1].trimEnd()).toBe('MAXIMILIANA');
    expect(rows[3].endsWith('…')).toBe(true);
    // The full name is never lost: it is in the result panel.
    expect(root.querySelector('.rs-reveal h2').textContent).toBe(
      'Alexandra Maximiliana Konstantinopoulou-Richardson van Der Berg',
    );
  });

  it('clears the session and loads the example list', () => {
    drawOnce();
    buttonByText('CLEAR SESSION').click();
    expect(textarea().value).toBe('');
    expect(root.querySelectorAll('.rs-history li')).toHaveLength(0);
    buttonByText('LOAD EXAMPLE LIST').click();
    expect(textarea().value.split('\n')).toHaveLength(8);
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
    buttonByText('PRESENT').focus();
    buttonByText('PRESENT').click();
    expect(root.querySelector('.rs-controls')).toBeNull();
    expect(root.querySelector('main').dataset.surface).toBe('stage');
    expect(document.activeElement).toBe(buttonByText('EXIT DISPLAY'));
    buttonByText('EXIT DISPLAY').click();
    expect(root.querySelector('.rs-controls')).not.toBeNull();
  });

  it('toggles sound and picks a draw length', () => {
    mount();
    buttonByText('SOUND OFF').click();
    expect(buttonByText('SOUND ON')).toBeDefined();
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
    expect(root.querySelector('.rs-volume-control span').textContent).toBe('SOUND VOLUME 40%');
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
    const controls = root.querySelector('.rs-controls');
    const weights = root.querySelector('.rs-weights');

    textarea().focus();
    textarea().value = 'A\nB';
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('.rs-controls')).toBe(controls);
    expect(root.querySelector('.rs-weights')).toBe(weights);
    expect(weights.querySelectorAll('.rs-weight-row')).toHaveLength(2);
    expect(root.querySelector('.rs-entry-count').textContent).toBe('2 ENTRIES');
    expect(root.querySelector('.rs-panel-heading span').textContent).toBe('2 loaded');
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
    buttonByText('EXPORT LIST').click();
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
    expect(buttonByText('USE PETROL ACCENT').hidden).toBe(true);
  });

  it('applies a saved custom accent and can go back to the Petrol one', () => {
    mount({ ...SAVED, accentColor: '#d96135' });
    expect(accentVar()).toBe('#d96135');
    const reset = buttonByText('USE PETROL ACCENT');
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
