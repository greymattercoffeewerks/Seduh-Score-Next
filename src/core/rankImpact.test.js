import { describe, it, expect } from 'vitest';
import { rankImpactRows, leadMovement, topMover } from './rankImpact.js';

const row = (position, name, played = true) => ({ position, name, played });
const options = {
  keyOf: (r) => r.name,
  positionOf: (r) => r.position,
  labelOf: (r) => r.name,
  isRanked: (r) => r.played,
};
const impact = (previous, next, extra = {}) =>
  rankImpactRows(previous, next, { ...options, ...extra });

describe('rankImpactRows', () => {
  it('gives each shown row its place, its label and how it moved', () => {
    const result = impact(
      [row(1, 'A'), row(2, 'B'), row(3, 'C')],
      [row(1, 'A'), row(2, 'C'), row(3, 'B')],
    );
    expect(result.rows).toEqual([
      { position: 1, label: 'A', tied: false, from: 1, to: 1, places: 0, change: 'same' },
      { position: 2, label: 'C', tied: false, from: 3, to: 2, places: 1, change: 'up' },
      { position: 3, label: 'B', tied: false, from: 2, to: 3, places: 1, change: 'down' },
    ]);
    expect(result.more).toBe(0);
  });

  it("uses the format's own label, not the key", () => {
    const result = impact([row(1, 'a')], [row(1, 'a')], { labelOf: (r) => r.name.toUpperCase() });
    expect(result.rows[0].label).toBe('A');
  });

  it('marks places that more than one row holds, and only those', () => {
    const result = impact([row(1, 'A')], [row(1, 'A'), row(2, 'B'), row(2, 'C'), row(4, 'D')]);
    expect(result.rows.map((r) => [r.label, r.tied])).toEqual([
      ['A', false],
      ['B', true],
      ['C', true],
      ['D', false],
    ]);
  });

  it('shows only the places up to topPlace, ties included', () => {
    const next = [row(1, 'A'), row(2, 'B'), row(3, 'C'), row(3, 'D'), row(5, 'E'), row(6, 'F')];
    const result = impact([row(1, 'A')], next, { topPlace: 3 });
    expect(result.rows.map((r) => r.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(result.more).toBe(0);
  });

  it('caps the rows at maxRows and says how many were left out', () => {
    const tied = Array.from({ length: 10 }, (_, i) => row(1, `T${i}`));
    const result = impact([row(1, 'A')], tied, { maxRows: 8 });
    expect(result.rows).toHaveLength(8);
    expect(result.more).toBe(2);
  });

  it('defaults to the top five places and eight rows', () => {
    const next = Array.from({ length: 9 }, (_, i) => row(i + 1, `P${i + 1}`));
    const result = impact([row(1, 'P1')], next);
    expect(result.rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(result.more).toBe(0);
    const tied = Array.from({ length: 10 }, (_, i) => row(1, `T${i}`));
    const crowded = impact([row(1, 'A')], tied);
    expect(crowded.rows).toHaveLength(8);
    expect(crowded.more).toBe(2);
  });

  it('leaves out, and never reports as moved, an entrant who has not competed', () => {
    const result = impact(
      [row(1, 'A'), row(2, 'B', false), row(2, 'C', false)],
      [row(1, 'A'), row(2, 'C'), row(3, 'B', false)],
    );
    expect(result.rows.map((r) => [r.label, r.change])).toEqual([
      ['A', 'same'],
      ['C', 'entered'],
    ]);
  });

  it('is null when two ranked rows share a key (a movement could be pinned on the wrong one)', () => {
    expect(impact([row(1, 'A')], [row(1, 'A'), row(2, 'A')])).toBeNull();
    expect(impact([row(1, 'A'), row(2, 'A')], [row(1, 'A')])).toBeNull();
  });

  it('copes with no earlier list and with no rows at all', () => {
    expect(impact(undefined, [row(1, 'A')]).rows[0].change).toBe('entered');
    expect(impact([], [])).toEqual({ rows: [], more: 0, moved: false });
    expect(impact([row(1, 'A')], undefined)).toEqual({ rows: [], more: 0, moved: false });
  });
});

describe('rankImpactRows: sharing and movement', () => {
  it('a place is shared only among rows that are ranked (an unranked row at the same position does not make it tied)', () => {
    const result = impact(
      [row(1, 'A')],
      [row(1, 'A'), row(1, 'Z', false), row(2, 'B'), row(2, 'Y', false)],
    );
    expect(result.rows.map((r) => [r.label, r.tied])).toEqual([
      ['A', false],
      ['B', false],
    ]);
  });

  it('says whether any shown row moved', () => {
    expect(impact([row(1, 'A'), row(2, 'B')], [row(1, 'A'), row(2, 'B')]).moved).toBe(false);
    expect(impact([row(1, 'A'), row(2, 'B')], [row(1, 'B'), row(2, 'A')]).moved).toBe(true);
  });

  it('a movement below the shown places does not count as the table moving', () => {
    const before = [
      row(1, 'A'),
      row(2, 'B'),
      row(3, 'C'),
      row(4, 'D'),
      row(5, 'E'),
      row(6, 'F'),
      row(7, 'G'),
    ];
    const after = [...before.slice(0, 5), row(6, 'G'), row(7, 'F')];
    expect(impact(before, after).moved).toBe(false);
  });
});

describe('leadMovement', () => {
  const lead = (previous, next, extra = {}) =>
    leadMovement(previous, next, { ...options, ...extra });

  it('is null when nobody ranked leads', () => {
    expect(lead([], [])).toBeNull();
    expect(lead([row(1, 'A')], [row(1, 'A', false), row(2, 'B', false)])).toBeNull();
  });

  it('names a sole leader and says whether the lead is unchanged', () => {
    expect(lead([row(1, 'A'), row(2, 'B')], [row(1, 'A'), row(2, 'B')])).toEqual({
      kind: 'sole',
      label: 'A',
      unchanged: true,
    });
    expect(lead([row(1, 'A'), row(2, 'B')], [row(1, 'B'), row(2, 'A')])).toEqual({
      kind: 'sole',
      label: 'B',
      unchanged: false,
    });
  });

  it('a sole leader who was one of several before is a change', () => {
    expect(lead([row(1, 'A'), row(1, 'B')], [row(1, 'A'), row(2, 'B')]).unchanged).toBe(false);
  });

  it('with no earlier list, a leader is a change', () => {
    expect(lead(undefined, [row(1, 'A')]).unchanged).toBe(false);
  });

  it('several leaders: their labels, how many, and whether they are the same ones as before', () => {
    const same = lead([row(1, 'A'), row(1, 'B')], [row(1, 'B'), row(1, 'A')]);
    expect(same).toMatchObject({ kind: 'shared', labels: ['B', 'A'], count: 2, unchanged: true });
    const changed = lead([row(1, 'A'), row(2, 'B'), row(2, 'C')], [row(1, 'A'), row(1, 'B')]);
    expect(changed.unchanged).toBe(false);
    const grew = lead([row(1, 'A'), row(1, 'B')], [row(1, 'A'), row(1, 'B'), row(1, 'C')]);
    expect(grew.unchanged).toBe(false);
  });

  it('two leaders are named together only while both names fit (40 characters between them by default)', () => {
    const pair = (a, b) => lead([], [row(1, a), row(1, b)]);
    expect(pair('A'.repeat(20), 'B'.repeat(20)).namedTogether).toBe(true);
    expect(pair('A'.repeat(20), 'B'.repeat(21)).namedTogether).toBe(false);
    expect(lead([], [row(1, 'A'), row(1, 'B'), row(1, 'C')]).namedTogether).toBe(false);
    expect(pair('A'.repeat(20), 'B'.repeat(21)).count).toBe(2);
    expect(lead([], [row(1, 'AAAA'), row(1, 'BBBB')], { maxNamesChars: 7 }).namedTogether).toBe(
      false,
    );
  });

  it('does not count an unranked row as a leader', () => {
    expect(lead([], [row(1, 'A'), row(1, 'Z', false)])).toMatchObject({ kind: 'sole', label: 'A' });
  });
});

describe('topMover', () => {
  const moved = (label, position, change, places = 0) => ({ label, position, change, places });

  it('is null when no row changed that way', () => {
    expect(topMover([moved('A', 1, 'same')], 'up')).toBeNull();
    expect(topMover([], 'entered')).toBeNull();
  });

  it('takes the biggest climb, wherever it is in the list', () => {
    const rows = [moved('A', 2, 'up', 1), moved('B', 3, 'up', 3), moved('C', 4, 'up', 2)];
    expect(topMover(rows, 'up').label).toBe('B');
  });

  it('breaks an equal climb by the higher place, then by name, whatever the input order', () => {
    const rows = [moved('Z', 3, 'up', 2), moved('A', 3, 'up', 2), moved('M', 2, 'up', 2)];
    expect(topMover(rows, 'up').label).toBe('M');
    expect(topMover([moved('Z', 3, 'up', 2), moved('A', 3, 'up', 2)], 'up').label).toBe('A');
    expect(topMover([moved('A', 3, 'up', 2), moved('Z', 3, 'up', 2)], 'up').label).toBe('A');
  });

  it('for a newcomer, the highest place wins and a climb size is ignored', () => {
    const rows = [moved('A', 4, 'entered', 9), moved('B', 2, 'entered', 0)];
    expect(topMover(rows, 'entered').label).toBe('B');
  });

  it('ignores rows that moved the other way', () => {
    expect(topMover([moved('A', 1, 'down', 5), moved('B', 3, 'up', 1)], 'up').label).toBe('B');
  });
});
