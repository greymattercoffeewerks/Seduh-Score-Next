import { describe, it, expect } from 'vitest';
import { detectNewResults } from './stageNewResults.js';

const opts = {
  listOf: (s) => s.results,
  keyOf: (r) => `${r.id}|${r.at}`,
  orderBy: (r) => r.at,
};
const snap = (...results) => ({ results });

describe('detectNewResults', () => {
  it('finds nothing without a previous snapshot (a display just opened has nothing to announce)', () => {
    const next = snap({ id: 'a', at: '2026-11-27T10:00:00Z' });
    expect(detectNewResults(null, next, opts)).toEqual([]);
    expect(detectNewResults(undefined, next, opts)).toEqual([]);
    expect(detectNewResults(snap(), null, opts)).toEqual([]);
  });

  it('returns what next has and previous did not, oldest first', () => {
    const old = { id: 'a', at: '2026-11-27T10:00:00Z' };
    const b = { id: 'b', at: '2026-11-27T10:05:00Z' };
    const c = { id: 'c', at: '2026-11-27T10:02:00Z' };
    expect(detectNewResults(snap(old), snap(b, old, c), opts)).toEqual([c, b]);
  });

  it('returns nothing for a republish of the same snapshot', () => {
    const a = { id: 'a', at: '2026-11-27T10:00:00Z' };
    expect(detectNewResults(snap(a), snap({ ...a }), opts)).toEqual([]);
  });

  it('announces a result again when its key changes (re-recorded)', () => {
    const a = { id: 'a', at: '2026-11-27T10:00:00Z' };
    const again = { id: 'a', at: '2026-11-27T10:30:00Z' };
    expect(detectNewResults(snap(a), snap(again), opts)).toEqual([again]);
  });

  it('orders ties by key so the order is stable, and handles numeric order keys', () => {
    const o = { ...opts, orderBy: (r) => r.n, keyOf: (r) => r.id };
    const x = { id: 'x', n: 1 };
    const y = { id: 'y', n: 1 };
    const z = { id: 'z', n: 0 };
    expect(detectNewResults({ results: [] }, { results: [y, x, z] }, o)).toEqual([z, x, y]);
  });

  it('tolerates a snapshot with no list, and does not mutate its inputs', () => {
    const next = snap({ id: 'a', at: '2026-11-27T10:00:00Z' });
    const copy = structuredClone(next);
    expect(detectNewResults({}, next, opts)).toHaveLength(1);
    expect(detectNewResults(next, {}, opts)).toEqual([]);
    expect(next).toEqual(copy);
  });
});
