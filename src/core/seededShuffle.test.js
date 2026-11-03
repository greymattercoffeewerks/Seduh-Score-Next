import { describe, it, expect } from 'vitest';
import { newSeed, seededShuffle } from './seededShuffle.js';

const items = Array.from({ length: 12 }, (_, i) => i + 1);

describe('seededShuffle', () => {
  it('gives the same order for the same seed, however often it is asked', () => {
    expect(seededShuffle(items, 'abc')).toEqual(seededShuffle(items, 'abc'));
  });

  it('keeps giving the order it gave when a draw was recorded (a changed generator would make past draws unexplainable)', () => {
    expect(seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 'pin-seed-1')).toEqual([4, 7, 1, 2, 3, 8, 5, 6]);
  });

  it('is a permutation: nothing lost, nothing repeated, and the input is untouched', () => {
    const before = [...items];
    const out = seededShuffle(items, 'seed-1');
    expect([...out].sort((a, b) => a - b)).toEqual(before);
    expect(items).toEqual(before);
  });

  it('gives different orders for different seeds (and actually moves things)', () => {
    const a = seededShuffle(items, 'one');
    const b = seededShuffle(items, 'two');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(items);
  });

  it('handles an empty list and a list of one', () => {
    expect(seededShuffle([], 's')).toEqual([]);
    expect(seededShuffle(['x'], 's')).toEqual(['x']);
  });

  it('is not biased toward keeping the first item first (a sample of 600 seeds)', () => {
    let firstStays = 0;
    for (let i = 0; i < 600; i += 1) {
      if (seededShuffle([0, 1, 2, 3], `s${i}`)[0] === 0) firstStays += 1;
    }
    // expected 150 of 600; the bounds are wide enough to never flake and narrow enough to catch a no-op shuffle (600)
    expect(firstStays).toBeGreaterThan(90);
    expect(firstStays).toBeLessThan(210);
  });

  it('refuses a missing seed rather than shuffling in an unexplainable way', () => {
    expect(() => seededShuffle(items, '')).toThrow(TypeError);
    expect(() => seededShuffle(items, undefined)).toThrow(TypeError);
  });
});

describe('newSeed', () => {
  it('is 12 hex characters, and two seeds differ', () => {
    const a = newSeed();
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(newSeed()).not.toBe(a);
  });
});
