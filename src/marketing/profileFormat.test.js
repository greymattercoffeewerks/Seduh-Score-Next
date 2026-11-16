import { describe, expect, it } from 'vitest';
import {
  bestResult,
  computeStats,
  hasSelfReported,
  provenanceLabels,
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

describe('stats count everything; the best result prefers a verified one', () => {
  it('counts every kind and the podiums across all provenances', () => {
    const entries = [
      e({ placing: 4 }),
      e({ placing: 2, organiser: 'Other' }),
      e({ placing: 1, provenance: 'self_reported' }),
      e({ kind: 'judged' }),
    ];
    expect(computeStats(entries)).toEqual([
      { value: '3', label: 'competed' },
      { value: '1', label: 'judged' },
      { value: '2', label: 'podiums' },
    ]);
    expect(computeStats([])).toEqual([]);
  });
  it('prefers a verified result over a better self-reported one, and says which', () => {
    const entries = [
      e({ placing: 4 }),
      e({ placing: 1, provenance: 'self_reported' }),
      e({ placing: 2, provenance: 'organiser_archive', membership: 'confirmed' }),
    ];
    expect(bestResult(entries)).toMatchObject({ verified: true, entry: { placing: 2 } });
  });
  it('a team result with NO membership information is not verified either (never claim more than we know)', () => {
    const none = e({ placing: 1, provenance: 'organiser_archive', title: 'x' });
    expect(bestResult([none])).toMatchObject({ verified: false });
  });
  it('a team result is verified ONLY with a confirmed membership: a self-reported one is not', () => {
    const unconfirmed = e({
      placing: 4,
      provenance: 'organiser_archive',
      membership: 'self_reported',
      title: 'team',
    });
    expect(bestResult([unconfirmed])).toMatchObject({ verified: false, entry: { title: 'team' } });
    const confirmed = { ...unconfirmed, membership: 'confirmed' };
    expect(bestResult([confirmed])).toMatchObject({ verified: true });
    // a recorded result beats an unconfirmed team result that places better
    const recorded = e({ placing: 5, title: 'rec' });
    const better = e({ placing: 1, provenance: 'organiser_archive', membership: 'self_reported' });
    expect(bestResult([better, recorded])).toMatchObject({
      verified: true,
      entry: { title: 'rec' },
    });
  });
  it('an unconfirmed team result is preferred to own better-placed entries (tiers), and neither is verified', () => {
    const team = e({
      placing: 4,
      provenance: 'organiser_archive',
      membership: 'self_reported',
      title: 'team',
    });
    const own = e({ placing: 1, provenance: 'self_reported', title: 'own' });
    expect(bestResult([own, team])).toMatchObject({ verified: false, entry: { title: 'team' } });
    expect(bestResult([own])).toMatchObject({ verified: false, entry: { title: 'own' } });
  });
  it("Seduh Score's own record wins a tie of placing with the organiser's", () => {
    const org = e({
      placing: 2,
      provenance: 'organiser_archive',
      membership: 'confirmed',
      date: '2026-01-01',
      year: 2026,
    });
    const rec = e({ placing: 2, title: 'rec', date: '2024-01-01', year: 2024 });
    expect(bestResult([org, rec]).entry.title).toBe('rec');
  });
  it('falls back to the best self-reported result, marked not verified', () => {
    const only = [e({ provenance: 'self_reported', placing: 3 })];
    expect(bestResult(only)).toMatchObject({ verified: false, entry: { placing: 3 } });
    expect(bestResult([e({ provenance: 'self_reported', placing: null })])).toBeNull();
    expect(hasSelfReported(only)).toBe(true);
  });
  it('the newest entry wins a tie on placing', () => {
    const old = e({ placing: 1, date: '2025-01-01', year: 2025, title: 'old' });
    const recent = e({ placing: 1, date: '2026-01-01', year: 2026, title: 'recent' });
    expect(bestResult([old, recent]).entry.title).toBe('recent');
  });
  it('says podium for one, and shows no podium cell without a competed entry', () => {
    expect(computeStats([e({ placing: 1 })])).toEqual([
      { value: '1', label: 'competed' },
      { value: '1', label: 'podium' },
    ]);
    expect(computeStats([e({ kind: 'organised' })])).toEqual([{ value: '1', label: 'organised' }]);
  });
});

describe('team links: labels and meta', () => {
  it('a team link has two labels; every other entry has one', () => {
    expect(
      provenanceLabels(e({ membership: 'self_reported', provenance: 'organiser_archive' })),
    ).toEqual(['Team result from the organiser’s records', 'Membership self-reported']);
    expect(provenanceLabels(e({ membership: 'confirmed' }))[1]).toBe('Membership confirmed');
    expect(provenanceLabels(e({ provenance: 'self_reported' }))).toEqual([
      'Self-reported, not verified by Seduh',
    ]);
  });
  it('the team reads with its country', () => {
    expect(metaText(e({ organiser: null, team: 'Bean Bandits', country: 'BN' }))).toBe(
      'Bean Bandits (BN)',
    );
  });
});

describe('placeText and knockoutText', () => {
  it('the place cell holds only a real placing; an entry without one has nothing there, whatever its kind', () => {
    expect(placeText(e({ placing: 3 }))).toBe('3rd');
    expect(placeText(e({ kind: 'judged' }))).toBe('');
    expect(placeText(e({ kind: 'organised' }))).toBe('');
    expect(placeText(e())).toBe('');
  });
  it('the kind of a non-competed entry is a small label at the start of its meta line', () => {
    expect(metaText(e({ kind: 'judged', organiser: null, location: 'Bandar' }))).toBe(
      'Judged · Bandar',
    );
    expect(metaText(e({ kind: 'volunteered', organiser: null }))).toBe('Volunteered');
    expect(metaText(e({ kind: 'competed', organiser: null, location: 'Bandar' }))).toBe('Bandar');
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
