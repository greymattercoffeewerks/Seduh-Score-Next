// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureRankState,
  playRankMotion,
  withRankMotion,
  markRankRow,
  RANK_KEY_ATTR,
  TICK_CLASS,
} from './rankMotion.js';

// jsdom has no layout, so each row's `top` is stubbed from a map the test controls.
function board(rows) {
  const root = document.createElement('div');
  for (const { key, top, value } of rows) {
    const row = document.createElement('div');
    const cell = document.createElement('span');
    cell.textContent = value;
    row.append(cell);
    markRankRow(row, key, [cell]);
    row.getBoundingClientRect = () => ({ top });
    root.append(row);
  }
  return root;
}

describe('rankMotion', () => {
  let root;
  beforeEach(() => {
    root = board([
      { key: 'A', top: 0, value: '1' },
      { key: 'B', top: 40, value: '2' },
    ]);
    root.getBoundingClientRect = () => ({ top: 0 });
  });

  it('captures the position and values of keyed rows', () => {
    const state = captureRankState(root);
    expect(state.get('B')).toEqual({ top: 40, values: ['2'] });
  });

  it('leaves a key that appears twice alone (never animates the wrong row)', () => {
    const dup = board([
      { key: 'A', top: 0, value: '1' },
      { key: 'A', top: 40, value: '2' },
    ]);
    expect(captureRankState(dup).has('A')).toBe(false);
  });

  it('slides a row that moved: starts offset by the old position, then releases', () => {
    const before = captureRankState(root);
    const next = board([
      { key: 'B', top: 0, value: '2' },
      { key: 'A', top: 40, value: '1' },
    ]);
    // The start offset is set, then committed (the root is measured), then released: record it at that moment.
    const starts = {};
    next.getBoundingClientRect = () => {
      for (const row of next.children)
        starts[row.getAttribute(RANK_KEY_ATTR)] = row.style.transform;
      return { top: 0 };
    };
    const moved = playRankMotion(next, before, { reduced: false });
    expect(moved).toBe(2);
    // B was at 40 and is now at 0: it starts 40px below its place; A was at 0 and is now at 40: 40px above.
    expect(starts).toEqual({ B: 'translateY(40px)', A: 'translateY(-40px)' });
    const rowA = next.querySelector(`[${RANK_KEY_ATTR}="A"]`);
    expect(rowA.classList.contains('rank-slide')).toBe(true);
    // released to its natural place: the inline transform is cleared so the CSS transition carries it
    expect(rowA.style.transform).toBe('');
  });

  it('ticks only the value that changed', () => {
    const before = captureRankState(root);
    const next = board([
      { key: 'A', top: 0, value: '9' },
      { key: 'B', top: 40, value: '2' },
    ]);
    next.getBoundingClientRect = () => ({ top: 0 });
    expect(playRankMotion(next, before, { reduced: false })).toBe(1);
    const cells = next.querySelectorAll('span');
    expect(cells[0].classList.contains(TICK_CLASS)).toBe(true);
    expect(cells[1].classList.contains(TICK_CLASS)).toBe(false);
  });

  it('does nothing at all under reduced motion: the update is instant', () => {
    const before = captureRankState(root);
    const next = board([
      { key: 'B', top: 0, value: '8' },
      { key: 'A', top: 40, value: '9' },
    ]);
    expect(playRankMotion(next, before, { reduced: true })).toBe(0);
    expect(next.querySelector('.rank-slide')).toBeNull();
    expect(next.querySelector(`.${TICK_CLASS}`)).toBeNull();
  });

  it('leaves a hidden row out: it has no position to slide from', () => {
    const hidden = board([{ key: 'H', top: 0, value: '1' }]);
    hidden.firstChild.hidden = true;
    expect(captureRankState(hidden).has('H')).toBe(false);
    const before = new Map([['H', { top: 0, values: ['1'] }]]);
    const shown = board([{ key: 'H', top: 300, value: '1' }]);
    expect(playRankMotion(shown, before, { reduced: false })).toBe(1);
    shown.firstChild.hidden = true;
    expect(playRankMotion(shown, before, { reduced: false })).toBe(0);
  });

  it('does not animate a key that appears twice in the redrawn list', () => {
    const before = new Map([['A', { top: 0, values: ['1'] }]]);
    const next = board([
      { key: 'A', top: 0, value: '7' },
      { key: 'A', top: 40, value: '1' },
    ]);
    expect(playRankMotion(next, before, { reduced: false })).toBe(0);
    expect(next.querySelector('.rank-slide')).toBeNull();
    expect(next.querySelector(`.${TICK_CLASS}`)).toBeNull();
  });

  it('reads the OS reduced-motion setting when none is passed', () => {
    const original = window.matchMedia;
    const next = () =>
      board([
        { key: 'B', top: 0, value: '2' },
        { key: 'A', top: 40, value: '1' },
      ]);
    try {
      window.matchMedia = () => ({ matches: true });
      expect(playRankMotion(next(), captureRankState(root))).toBe(0);
      window.matchMedia = () => ({ matches: false });
      expect(playRankMotion(next(), captureRankState(root))).toBe(2);
    } finally {
      window.matchMedia = original;
    }
  });

  it('ignores new and removed rows, and an empty previous state', () => {
    const next = board([{ key: 'Z', top: 0, value: '1' }]);
    expect(playRankMotion(next, captureRankState(root), { reduced: false })).toBe(0);
    expect(playRankMotion(next, new Map(), { reduced: false })).toBe(0);
  });

  it('withRankMotion runs the redraw exactly once and returns its result', () => {
    let calls = 0;
    const result = withRankMotion(root, () => {
      calls += 1;
      return 'cleanup';
    });
    expect(calls).toBe(1);
    expect(result).toBe('cleanup');
  });

  it('withRankMotion does not swallow a redraw failure', () => {
    expect(() =>
      withRankMotion(root, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});
