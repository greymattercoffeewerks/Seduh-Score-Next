import { describe, it, expect } from 'vitest';
import {
  randomPairs,
  normalisePairs,
  drawProblems,
  previewRoundOne,
  emptyBoard,
  assignSlot,
} from './seeding.js';

describe('randomPairs', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('is reproducible from the seed and places every competitor exactly once', () => {
    const one = randomPairs(ids, 'seed');
    expect(randomPairs(ids, 'seed')).toEqual(one);
    expect(one.flat().filter(Boolean).sort()).toEqual(ids);
  });
  it('gives an odd field a final pair with a bye', () => {
    const pairs = randomPairs(ids, 'x');
    expect(pairs).toHaveLength(3);
    expect(pairs[2][1]).toBeNull();
  });
});

describe('normalisePairs (the manual-draw reading)', () => {
  it('turns a lone name into a bye, moves an opponent-only slot up, and drops an empty pair', () => {
    expect(
      normalisePairs([
        ['a', null],
        [null, 'b'],
        [null, null],
        ['c', 'd'],
      ]),
    ).toEqual([
      ['a', null],
      ['b', null],
      ['c', 'd'],
    ]);
  });
});

describe('drawProblems', () => {
  const active = ['a', 'b', 'c', 'd'];
  it('accepts a complete random draw', () => {
    expect(
      drawProblems({
        mode: 'random',
        pairs: [
          ['a', 'b'],
          ['c', 'd'],
        ],
        activeEntryIds: active,
      }),
    ).toEqual([]);
  });
  it('refuses a competitor in two slots', () => {
    expect(drawProblems({ mode: 'manual', pairs: [['a', 'a']], activeEntryIds: active })).toContain(
      'td_draw_duplicate',
    );
  });
  it('refuses a draw with no real pair', () => {
    expect(
      drawProblems({
        mode: 'manual',
        pairs: [
          ['a', null],
          [null, 'b'],
        ],
        activeEntryIds: active,
      }),
    ).toContain('td_draw_empty');
  });
  it('refuses a withdrawn or foreign competitor', () => {
    expect(drawProblems({ mode: 'manual', pairs: [['a', 'z']], activeEntryIds: active })).toContain(
      'td_draw_entry',
    );
  });
  it('demands every active competitor in a random draw but not in a manual one', () => {
    const pairs = [['a', 'b']];
    expect(drawProblems({ mode: 'random', pairs, activeEntryIds: active })).toContain(
      'td_draw_incomplete',
    );
    expect(drawProblems({ mode: 'manual', pairs, activeEntryIds: active })).toEqual([]);
  });
});

describe('the manual board', () => {
  it('previews byes', () => {
    expect(
      previewRoundOne([
        ['a', 'b'],
        ['c', null],
      ]),
    ).toEqual([
      { position: 1, a: 'a', b: 'b', bye: false },
      { position: 2, a: 'c', b: null, bye: true },
    ]);
  });
  it('sizes the board from the slot count, rounded up to whole pairs', () => {
    expect(emptyBoard(5)).toHaveLength(3);
    expect(emptyBoard(0)).toHaveLength(1);
  });
  it('moves a competitor rather than duplicating them', () => {
    const board = assignSlot(assignSlot(emptyBoard(4), 0, 0, 'a'), 1, 1, 'a');
    expect(board).toEqual([
      [null, null],
      [null, 'a'],
    ]);
  });
});
