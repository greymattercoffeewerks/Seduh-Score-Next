import { describe, it, expect } from 'vitest';
import { rankMovement, sharedPositions } from './rankMovement.js';

const row = (name, position, extra = {}) => ({ name, position, ...extra });
const options = { keyOf: (r) => r.name, positionOf: (r) => r.position };

describe('rankMovement', () => {
  it('says whether each row moved up, down or stayed, and by how many places', () => {
    const movement = rankMovement(
      [row('A', 1), row('B', 2), row('C', 3)],
      [row('B', 1), row('C', 2), row('A', 3)],
      options,
    );
    expect(movement.get('B')).toEqual({ from: 2, to: 1, places: 1, change: 'up' });
    expect(movement.get('C')).toEqual({ from: 3, to: 2, places: 1, change: 'up' });
    expect(movement.get('A')).toEqual({ from: 1, to: 3, places: 2, change: 'down' });
  });

  it('a row in the same place is "same" with no places', () => {
    const movement = rankMovement([row('A', 2)], [row('A', 2)], options);
    expect(movement.get('A')).toEqual({ from: 2, to: 2, places: 0, change: 'same' });
  });

  it('a row that was not in the list before has entered', () => {
    const movement = rankMovement([row('A', 1)], [row('A', 1), row('B', 2)], options);
    expect(movement.get('B')).toEqual({ from: null, to: 2, places: 0, change: 'entered' });
  });

  it('a row that is not ranked yet is neither a mover nor an entrant', () => {
    const options2 = { ...options, isRanked: (r) => !r.idle };
    // B has not competed: it sits tied at the bottom, before and after
    const movement = rankMovement(
      [row('A', 1), row('B', 2, { idle: true })],
      [row('A', 1), row('B', 5, { idle: true })],
      options2,
    );
    expect(movement.has('B')).toBe(false);
    expect(movement.get('A').change).toBe('same');
  });

  it('a row ranked now but unranked before has entered, whatever place the idle row held', () => {
    const options2 = { ...options, isRanked: (r) => !r.idle };
    const movement = rankMovement([row('A', 1, { idle: true })], [row('A', 4)], options2);
    expect(movement.get('A')).toEqual({ from: null, to: 4, places: 0, change: 'entered' });
  });

  it('leaves out rows that dropped out of the list', () => {
    const movement = rankMovement([row('A', 1), row('B', 2)], [row('A', 1)], options);
    expect([...movement.keys()]).toEqual(['A']);
  });

  it('returns null when a key repeats in either list, rather than guessing who moved', () => {
    expect(rankMovement([row('A', 1), row('A', 2)], [row('A', 1)], options)).toBeNull();
    expect(rankMovement([row('A', 1)], [row('A', 1), row('A', 2)], options)).toBeNull();
  });

  it('treats a missing list as empty', () => {
    expect(rankMovement(undefined, [row('A', 1)], options).get('A').change).toBe('entered');
    expect(rankMovement([row('A', 1)], undefined, options).size).toBe(0);
  });

  it('shared places compare as numbers (a tie moving up together)', () => {
    const movement = rankMovement([row('A', 3), row('B', 3)], [row('A', 1), row('B', 1)], options);
    expect(movement.get('A')).toMatchObject({ change: 'up', places: 2 });
    expect(movement.get('B')).toMatchObject({ change: 'up', places: 2 });
  });
});

describe('rankMovement: duplicate keys', () => {
  const ranked = { ...options, isRanked: (r) => !r.idle };

  it('two rows of one name that have not competed do not stop the rest being compared', () => {
    const movement = rankMovement(
      [row('A', 1), row('Sam', 2, { idle: true }), row('Sam', 2, { idle: true })],
      [row('A', 1), row('Sam', 2, { idle: true }), row('Sam', 2, { idle: true })],
      ranked,
    );
    expect(movement.get('A').change).toBe('same');
  });

  it('two ranked rows of one name in the previous list return null even if only one is ranked now', () => {
    expect(rankMovement([row('A', 1), row('A', 2)], [row('A', 1)], ranked)).toBeNull();
  });

  it('two ranked rows of one name in the next list return null', () => {
    expect(rankMovement([row('A', 1)], [row('A', 1), row('A', 2)], ranked)).toBeNull();
  });
});

describe('sharedPositions', () => {
  const positionOf = (r) => r.position;

  it('is the set of positions more than one row holds', () => {
    const rows = [row('A', 1), row('B', 2), row('C', 2), row('D', 4), row('E', 5), row('F', 5)];
    expect([...sharedPositions(rows, positionOf)].sort()).toEqual([2, 5]);
  });

  it('is empty when nobody shares a place, or there are no rows', () => {
    expect(sharedPositions([row('A', 1), row('B', 2)], positionOf).size).toBe(0);
    expect(sharedPositions([], positionOf).size).toBe(0);
  });

  it('counts a place shared by three as one shared place', () => {
    const rows = [row('A', 1), row('B', 1), row('C', 1)];
    expect([...sharedPositions(rows, positionOf)]).toEqual([1]);
  });
});
