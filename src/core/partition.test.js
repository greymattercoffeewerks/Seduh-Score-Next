import { describe, it, expect } from 'vitest';
import { partition } from './partition.js';

describe('partition', () => {
  // Handoff §14 T2.1 AC: each N=2..12 case tested individually, not via a loop
  // that could silently pass on a subset.
  it('N=2 → [2]', () => expect(partition(2)).toEqual([2]));
  it('N=3 → [3]', () => expect(partition(3)).toEqual([3]));
  it('N=4 → [4]', () => expect(partition(4)).toEqual([4]));
  it('N=5 → [3, 2]', () => expect(partition(5)).toEqual([3, 2]));
  it('N=6 → [3, 3]', () => expect(partition(6)).toEqual([3, 3]));
  it('N=7 → [4, 3]', () => expect(partition(7)).toEqual([4, 3]));
  it('N=8 → [4, 4]', () => expect(partition(8)).toEqual([4, 4]));
  it('N=9 → [3, 3, 3]', () => expect(partition(9)).toEqual([3, 3, 3]));
  it('N=10 → [4, 3, 3]', () => expect(partition(10)).toEqual([4, 3, 3]));
  it('N=11 → [4, 4, 3]', () => expect(partition(11)).toEqual([4, 4, 3]));
  it('N=12 → [4, 4, 4]', () => expect(partition(12)).toEqual([4, 4, 4]));

  describe('invariants across N=2..64', () => {
    for (let n = 2; n <= 64; n++) {
      it(`N=${n}: sum equals N, min >= 2, max - min <= 1`, () => {
        const sizes = partition(n);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      });
    }
  });

  it('throws when n is below min', () => {
    expect(() => partition(1)).toThrow();
    expect(() => partition(0, { target: 4, min: 2 })).toThrow();
    expect(() => partition(4, { target: 8, min: 5 })).toThrow();
  });

  it('respects custom target/min', () => {
    expect(partition(10, { target: 8, min: 3 })).toEqual([5, 5]);
  });
});
