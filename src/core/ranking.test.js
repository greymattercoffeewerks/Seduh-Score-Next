import { describe, it, expect } from 'vitest';
import { rank, chainComparators } from './ranking.js';

const byScoreDesc = (a, b) => b.score - a.score;

describe('rank', () => {
  it('no ties: positions are 1..N in sort order', () => {
    const items = [
      { id: 'a', score: 30 },
      { id: 'b', score: 20 },
      { id: 'c', score: 10 },
    ];
    expect(rank(items, byScoreDesc).map((r) => [r.item.id, r.position])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  // Handoff §14 T2.2 AC: a two-way tie at position 1 alone passes even with the
  // classic off-by-one present — a three-way tie must be tested separately.
  it('a three-way tie at the front shares position 1, and the next distinct row skips to 4', () => {
    const items = [
      { id: 'a', score: 10 },
      { id: 'b', score: 10 },
      { id: 'c', score: 10 },
      { id: 'd', score: 5 },
    ];
    expect(rank(items, byScoreDesc).map((r) => [r.item.id, r.position])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
      ['d', 4],
    ]);
  });

  // Handoff §14 T2.2 AC: a tie that is NOT first in the list must be tested too.
  it('a two-way tie in the middle skips the next position by 2, not 1', () => {
    const items = [
      { id: 'a', score: 30 },
      { id: 'b', score: 20 },
      { id: 'c', score: 20 },
      { id: 'd', score: 10 },
    ];
    expect(rank(items, byScoreDesc).map((r) => [r.item.id, r.position])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });

  it('does not mutate the input array', () => {
    const items = [
      { id: 'a', score: 10 },
      { id: 'b', score: 30 },
      { id: 'c', score: 20 },
    ];
    const original = [...items];
    rank(items, byScoreDesc);
    expect(items).toEqual(original);
    expect(items[0]).toBe(original[0]);
  });

  it('every item ties: all share position 1', () => {
    const items = [
      { id: 'a', score: 5 },
      { id: 'b', score: 5 },
      { id: 'c', score: 5 },
    ];
    expect(rank(items, byScoreDesc).map((r) => r.position)).toEqual([1, 1, 1]);
  });
});

describe('chainComparators', () => {
  const byCorrectDesc = (a, b) => b.correct - a.correct;
  const byTimeAsc = (a, b) => a.time - b.time;

  it('falls through to the next comparator only when the first ties', () => {
    const chained = chainComparators(byCorrectDesc, byTimeAsc);
    const items = [
      { id: 'a', correct: 8, time: 300 },
      { id: 'b', correct: 9, time: 500 },
      { id: 'c', correct: 9, time: 400 },
    ];
    expect(rank(items, chained).map((r) => r.item.id)).toEqual(['c', 'b', 'a']);
  });

  it('a single comparator behaves identically to using it directly', () => {
    const chained = chainComparators(byCorrectDesc);
    const items = [
      { id: 'a', correct: 1 },
      { id: 'b', correct: 2 },
    ];
    expect(rank(items, chained).map((r) => r.item.id)).toEqual(
      rank(items, byCorrectDesc).map((r) => r.item.id),
    );
  });
});
