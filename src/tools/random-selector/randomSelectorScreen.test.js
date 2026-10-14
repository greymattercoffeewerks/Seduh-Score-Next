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
const css = readFileSync(resolve(process.cwd(), 'src/tools/random-selector/randomSelector.css'), 'utf8');

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
const boardText = () => [...root.querySelectorAll('.selector-flap')].map((flap) => flap.textContent).join('').trim();

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
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, '');
    expect(css).toContain('animation:');
    expect(outside).not.toMatch(/animation:/);
  });
});
