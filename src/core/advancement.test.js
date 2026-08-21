import { describe, it, expect } from 'vitest';
import { computeAdvancement } from './advancement.js';

// Helper: build a { item, position } list from [id, position] pairs, matching
// core/ranking's rank() output shape.
function ranked(pairs) {
  return pairs.map(([id, position]) => ({ item: { id }, position }));
}

describe('computeAdvancement', () => {
  it('returns exactly `cutoff` advancing when no border tie exists', () => {
    const entries = ranked([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 5],
      ['f', 6],
      ['g', 7],
      ['h', 8],
      ['i', 9],
    ]);
    const result = computeAdvancement(entries, 8);
    expect(result.advancing).toHaveLength(8);
    expect(result.advancing.map((e) => e.item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);
    expect(result.tiebreakNeeded).toBe(false);
    expect(result.tiedAtBorder).toEqual([]);
  });

  it('a tie wholly above the cutoff does not flag a tiebreak', () => {
    // a/b tied at position 1 — both comfortably within a cutoff of 8.
    const entries = ranked([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 4],
      ['e', 5],
      ['f', 6],
      ['g', 7],
      ['h', 8],
    ]);
    const result = computeAdvancement(entries, 8);
    expect(result.tiebreakNeeded).toBe(false);
    expect(result.advancing).toHaveLength(8);
  });

  it('a tie straddling the cutoff flags a tiebreak', () => {
    // d/e/f/g tied at position 4 — cumulative before this group is 3, the
    // group has 4 members, 3+4=7 exceeds a cutoff of 6, so it straddles.
    const entries = ranked([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 4],
      ['f', 4],
      ['g', 4],
    ]);
    const result = computeAdvancement(entries, 6);
    expect(result.tiebreakNeeded).toBe(true);
    expect(result.tiedAtBorder.map((e) => e.item.id)).toEqual(['d', 'e', 'f', 'g']);
    // cumulative before the border group (3) advance cleanly; the border group
    // itself does not provisionally advance until the tiebreak resolves it.
    expect(result.advancing.map((e) => e.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('the tied set is exactly the cuppers at the border, not an earlier tie group above the line', () => {
    // Two separate tie groups: [a,b] at position 1 (wholly above, cutoff 8),
    // [c,d,e] at position 3 (also wholly above), [f,g,h,i] at position 6 (the
    // actual border: cumulative before is 5, +4 = 9 > 8).
    const entries = ranked([
      ['a', 1],
      ['b', 1],
      ['c', 3],
      ['d', 3],
      ['e', 3],
      ['f', 6],
      ['g', 6],
      ['h', 6],
      ['i', 6],
    ]);
    const result = computeAdvancement(entries, 8);
    expect(result.tiebreakNeeded).toBe(true);
    expect(result.tiedAtBorder.map((e) => e.item.id)).toEqual(['f', 'g', 'h', 'i']);
    expect(result.advancing.map((e) => e.item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a tie that exactly fills the remaining slots needs no tiebreak', () => {
    // d/e/f tied at position 4, cumulative before is 3, group size 3, 3+3=6
    // exactly matches cutoff — no ambiguity, all three advance cleanly.
    const entries = ranked([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 4],
      ['f', 4],
      ['g', 7],
    ]);
    const result = computeAdvancement(entries, 6);
    expect(result.tiebreakNeeded).toBe(false);
    expect(result.advancing).toHaveLength(6);
    expect(result.advancing.map((e) => e.item.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
