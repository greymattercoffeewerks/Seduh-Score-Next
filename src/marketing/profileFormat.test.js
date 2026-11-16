import { describe, expect, it } from 'vitest';
import {
  bestResult,
  computeStats,
  dateText,
  filterEntries,
  foundingText,
  groupByYear,
  initialsOf,
  kindsPresent,
  knockoutText,
  metaText,
  placeText,
  sortEntries,
  summaryLine,
} from './profileFormat.js';

const e = (over = {}) => ({
  kind: 'competed',
  provenance: 'seduh_score',
  title: 'T',
  organiser: 'Org',
  meta: '',
  detail: '',
  date: null,
  year: 2026,
  placing: null,
  ...over,
});

describe('foundingText', () => {
  it('pads to four digits and refuses nonsense', () => {
    expect(foundingText(1)).toBe('0001');
    expect(foundingText(42)).toBe('0042');
    expect(foundingText(12345)).toBe('12345');
    expect(foundingText(0)).toBeNull();
    expect(foundingText(null)).toBeNull();
    expect(foundingText('7')).toBeNull();
  });
});

describe('initialsOf', () => {
  it('uses first and last word, or one letter, or ?', () => {
    expect(initialsOf('Firdaus Omar')).toBe('FO');
    expect(initialsOf('Mohd Firdaus bin Omar')).toBe('MO');
    expect(initialsOf('Cher')).toBe('C');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });
});

describe('sorting and grouping', () => {
  it('sorts newest first by date then year, undated last, stable on equals', () => {
    const a = e({ title: 'a', date: '2026-03-01', year: 2026 });
    const b = e({ title: 'b', date: '2026-09-01', year: 2026 });
    const c = e({ title: 'c', date: null, year: 2026 });
    const d = e({ title: 'd', date: null, year: null });
    const f = e({ title: 'f', date: null, year: 2026 });
    expect(sortEntries([d, a, c, b, f]).map((x) => x.title)).toEqual(['b', 'a', 'c', 'f', 'd']);
  });
  it('groups by year with undated last', () => {
    const groups = groupByYear([
      e({ year: 2024 }),
      e({ year: 2026 }),
      e({ year: null }),
      e({ year: 2026 }),
    ]);
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([
      ['2026', 2],
      ['2024', 1],
      ['Undated', 1],
    ]);
  });
  it('writes a date in words', () => {
    expect(dateText(e({ date: '2026-03-01' }))).toBe('Mar 2026');
    expect(dateText(e({ date: null, year: 2023 }))).toBe('2023');
    expect(dateText(e({ date: null, year: null }))).toBe('');
  });
});

describe('summary and filters', () => {
  const entries = [e(), e(), e({ kind: 'judged' }), e({ kind: 'organised' })];
  it('counts by kind in a fixed order', () => {
    expect(summaryLine(entries)).toBe('4 entries: 2 competed, 1 judged, 1 organised');
    expect(kindsPresent(entries)).toEqual(['competed', 'judged', 'organised']);
  });
  it('a single kind reads as one phrase and a single entry as singular', () => {
    expect(summaryLine([e(), e()])).toBe('2 entries, all competed');
    expect(summaryLine([e()])).toBe('1 entry, all competed');
    expect(summaryLine([])).toBe('');
  });
  it('filters by kind', () => {
    expect(filterEntries(entries, 'judged')).toHaveLength(1);
    expect(filterEntries(entries, 'all')).toHaveLength(4);
  });
});

describe('stats and best result count only what is vouched for', () => {
  it('ignores self-reported entries for totals and the best result', () => {
    const entries = [
      e({ placing: 4 }),
      e({ placing: 2, organiser: 'Other' }),
      e({ placing: 1, provenance: 'self_reported' }),
      e({ kind: 'judged' }),
    ];
    expect(computeStats(entries)).toEqual([
      { value: '2', label: 'results' },
      { value: '1', label: 'podiums' },
      { value: '2', label: 'organisers' },
      { value: '2nd', label: 'best place' },
    ]);
    expect(bestResult(entries).placing).toBe(2);
  });
  it('has no stats and no best result when nothing is vouched for', () => {
    const only = [e({ provenance: 'self_reported', placing: 1 })];
    expect(computeStats(only)).toEqual([]);
    expect(bestResult(only)).toBeNull();
    expect(computeStats([])).toEqual([]);
  });
  it('the newest entry wins a tie on placing', () => {
    const old = e({ placing: 1, date: '2025-01-01', year: 2025, title: 'old' });
    const recent = e({ placing: 1, date: '2026-01-01', year: 2026, title: 'recent' });
    expect(bestResult([old, recent]).title).toBe('recent');
  });
  it('omits organisers and best placing when absent, and says "result" for one', () => {
    expect(computeStats([e({ organiser: null })])).toEqual([
      { value: '1', label: 'result' },
      { value: '0', label: 'podiums' },
    ]);
  });
});

describe('placeText and knockoutText', () => {
  it('shows the ordinal, the role for a non-competed kind, nothing for an unplaced competed one', () => {
    expect(placeText(e({ placing: 3 }))).toBe('3rd');
    expect(placeText(e({ kind: 'judged' }))).toBe('Judged');
    expect(placeText(e())).toBe('');
  });
  it('knockout text is null when nothing was played', () => {
    expect(knockoutText({ won: 0, lost: 0, opponents: [] })).toBeNull();
    expect(knockoutText({ won: 2, lost: 1, opponents: [] })).toBe('2 won · 1 lost');
  });
});

describe('metaText', () => {
  it('joins organiser, team, place and the format in the same words the results pages use', () => {
    expect(
      metaText(
        e({
          organiser: 'Grey Matter',
          team: 'Bean Bandits',
          location: 'Bangkok',
          format: 'liga_seduh',
        }),
      ),
    ).toBe('Grey Matter · Bean Bandits · Bangkok · Liga Seduh');
    expect(metaText(e({ organiser: null, format: 'cup_taster' }))).toBe('Cup Taster');
    expect(metaText(e({ organiser: null }))).toBe('');
  });
});
