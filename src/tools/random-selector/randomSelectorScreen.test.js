import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORAGE_KEY } from './randomSelector.js';
import { mountRandomSelector } from './randomSelectorScreen.js';

function fakeStorage(saved) {
  const map = new Map(saved ? [[STORAGE_KEY, JSON.stringify(saved)]] : []);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
}

// Sound off keeps the test off the (unimplemented in jsdom) media element.
const css = readFileSync(
  resolve(process.cwd(), 'src/tools/random-selector/randomSelector.css'),
  'utf8',
);

const SAVED = { draft: 'Amir\nBella\nChin', soundOn: false, drawPreset: 'quick' };
const QUICK_MS = 1000;

let root;
let dispose;

function mount(saved = SAVED) {
  root = document.createElement('div');
  document.body.append(root);
  dispose = mountRandomSelector(root, { storage: fakeStorage(saved) });
}

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

  it('removes the drawn entry and only that entry when removal is on', () => {
    mount({ ...SAVED, removeAfterDraw: true });
    drawButton().click();
    vi.advanceTimersByTime(QUICK_MS + 100);

    const drawn = root.querySelector('.rs-reveal h2').textContent;
    const left = textarea().value.split('\n');
    expect(left).toHaveLength(2);
    expect(left).not.toContain(drawn);
  });
});

describe('random selector reduced motion', () => {
  it('holds the board still while drawing instead of cycling characters', () => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce'), media: query }));
    mount();
    drawButton().click();
    const first = boardText();
    vi.advanceTimersByTime(QUICK_MS / 2);
    expect(boardText()).toBe(first);
    expect(first).toBe('DRAWING');
    vi.advanceTimersByTime(QUICK_MS);
    expect(root.querySelector('.rs-reveal')).not.toBeNull();
  });

  it('only runs the flap animation when the user has no reduced-motion preference', () => {
    const outside = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/,
      '',
    );
    expect(css).toContain('animation:');
    expect(outside).not.toMatch(/animation:/);
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
    expect(root.querySelectorAll('.rs-weight-row > span:last-child')[0].textContent).toBe('60.0%');
    const totalText = [...root.querySelectorAll('.rs-weight-heading span')].map(
      (n) => n.textContent,
    );
    expect(totalText).toContain('5 TOTAL WEIGHT');
    expect(textarea().value).toBe('Amir | 3\nBella\nChin');
  });
});
