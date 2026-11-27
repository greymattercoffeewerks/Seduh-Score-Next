import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { previewShape, comparePreviews } from './bracketPreview.js';

// An independent reference: it plays a real bracket out with named brewers (slot 1 always wins), following the rules of
// app.td_advance and app.td_group_sizes as written in the migrations, with none of the preview's count arithmetic. The
// preview must agree with it for every size, so a change to the engine's shape rule that is not mirrored fails here.
function play(n, { third = true, feed = [], size = 2, cap = 0 } = {}) {
  let field = Array.from({ length: n }, (_, i) => `b${i + 1}`);
  const out = { rounds: [], matches: 0, byes: 0, thirdPlayed: false, repeatByes: 0 };
  let round = 1;
  let lastBye = null;
  while (field.length > 1) {
    const pairs = [];
    for (let i = 0; i < field.length; i += 2) pairs.push([field[i], field[i + 1] ?? null]);
    const real = pairs.filter(([, b]) => b !== null);
    const byeRows = pairs.filter(([, b]) => b === null);
    const winners = pairs.map(([a]) => a);
    const losers = real.map(([, b]) => b);
    const row = {
      enter: field.length,
      matches: real.length,
      byes: byeRows.length,
      through: winners.length,
    };
    out.matches += real.length;
    out.byes += byeRows.length;
    if (byeRows.length) {
      if (lastBye === byeRows[0][0]) out.repeatByes += 1;
      lastBye = byeRows[0][0];
    }
    let next = winners;
    if (feed.includes(round) && winners.length > 4 && losers.length >= 2) {
      const pool = losers.length;
      const groups = Math.max(1, Math.min(Math.ceil(pool / size), Math.floor(pool / 2)));
      let back = groups;
      if (cap > 0) back = Math.min(back, cap);
      row.red = { pool, groups, back };
      out.matches += groups;
      next = [...winners, ...losers.slice(0, back)];
      lastBye = null;
    }
    if (winners.length === 2 && real.length === 2 && byeRows.length === 0 && third) {
      out.thirdPlayed = true;
      out.matches += 1;
    }
    out.rounds.push(row);
    field = next;
    round += 1;
  }
  return out;
}

describe('previewShape against the played-out reference', () => {
  const setups = [{}, { third: false }];
  for (const feed of [[1], [2], [1, 2], [1, 2, 3]]) {
    for (const size of [2, 3, 4]) for (const cap of [0, 2, 3]) setups.push({ feed, size, cap });
  }
  it('agrees for every field from 2 to 64 and every setup', () => {
    for (let n = 2; n <= 64; n += 1) {
      for (const s of setups) {
        const ref = play(n, s);
        const got = previewShape({
          entrants: n,
          thirdPlace: s.third !== false,
          redemption: s.feed ? { feed: s.feed, groupSize: s.size, cap: s.cap } : null,
        });
        const where = `n=${n} ${JSON.stringify(s)}`;
        expect(
          got.rounds.map((r) => [r.enter, r.matches, r.byes, r.through]),
          where,
        ).toEqual(ref.rounds.map((r) => [r.enter, r.matches, r.byes, r.through]));
        expect(
          got.rounds.map((r) => r.redemption ?? null).map((r) => r && [r.pool, r.groups, r.back]),
          where,
        ).toEqual(ref.rounds.map((r) => (r.red ? [r.red.pool, r.red.groups, r.red.back] : null)));
        expect(got.totals.matches, where).toBe(ref.matches);
        expect(got.totals.byes, where).toBe(ref.byes);
        expect(got.thirdPlace.played, where).toBe(ref.thirdPlayed);
        // a bye straight after a bye is certain; the reference counts exactly those
        expect(got.flags.filter((f) => f.code === 'repeat_bye' && f.certain).length, where).toBe(
          ref.repeatByes,
        );
      }
    }
  });
});

describe('the Vol 3 and example scenarios (hand-checked against the engine rules)', () => {
  it('21 brewers: 5 rounds, 20 matches, 3 byes, no 3rd place, the Round 1 bye repeats', () => {
    const p = previewShape({ entrants: 21 });
    expect(p.rounds.map((r) => [r.enter, r.matches, r.byes, r.through])).toEqual([
      [21, 10, 1, 11],
      [11, 5, 1, 6],
      [6, 3, 0, 3],
      [3, 1, 1, 2],
      [2, 1, 0, 1],
    ]);
    expect(p.totals).toMatchObject({ rounds: 5, matches: 20, byes: 3, finalSize: 2 });
    expect(p.thirdPlace).toEqual({ setting: true, played: false, reason: 'bye' });
    const repeats = p.flags.filter((f) => f.code === 'repeat_bye');
    expect(repeats[0]).toMatchObject({ round: 2, sinceRound: 1, certain: true });
    // the Round 4 bye is only a one in two chance for the same seat (Round 3 had no bye)
    expect(repeats[1]).toMatchObject({ round: 4, sinceRound: 2, certain: false, oneIn: 2 });
  });
  it('16 brewers: clean, 15 matches plus the 3rd place match', () => {
    const p = previewShape({ entrants: 16 });
    expect(p.totals).toMatchObject({ rounds: 4, matches: 16, byes: 0 });
    expect(p.thirdPlace.played).toBe(true);
    expect(p.flags).toEqual([]);
  });
  it('12 brewers: one bye in the semi-final round, no 3rd place, no repeat', () => {
    const p = previewShape({ entrants: 12 });
    expect(p.totals).toMatchObject({ rounds: 4, matches: 11, byes: 1 });
    expect(p.thirdPlace).toEqual({ setting: true, played: false, reason: 'bye' });
    expect(p.flags.some((f) => f.code === 'repeat_bye')).toBe(false);
  });
  it('21 brewers with redemption after Round 1 (pairs): a clean 16, no byes after, 3rd place back, 30 + 1 matches', () => {
    const p = previewShape({ entrants: 21, redemption: { feed: [1], groupSize: 2, cap: 0 } });
    expect(p.rounds[0].redemption).toEqual({ pool: 10, groups: 5, back: 5 });
    expect(p.rounds[1].enter).toBe(16);
    expect(p.totals).toMatchObject({ rounds: 5, matches: 31, byes: 1 });
    expect(p.thirdPlace.played).toBe(true);
  });
  it('21 brewers, redemption after Round 1, cap 3: 14 into Round 2 and a bye returns in Round 3', () => {
    const p = previewShape({ entrants: 21, redemption: { feed: [1], groupSize: 2, cap: 3 } });
    expect(p.rounds[1].enter).toBe(14);
    expect(p.rounds[2]).toMatchObject({ enter: 7, byes: 1 });
  });
  it('12 brewers with redemption after Round 1 adds byes (3 instead of 1)', () => {
    const plain = previewShape({ entrants: 12 });
    const red = previewShape({ entrants: 12, redemption: { feed: [1], groupSize: 2, cap: 0 } });
    expect(plain.totals.byes).toBe(1);
    expect(red.totals.byes).toBe(3);
  });
});

describe('edges', () => {
  it('refuses fewer than two brewers', () => {
    expect(previewShape({ entrants: 1 })).toEqual({ problem: 'too_few' });
    expect(previewShape({ entrants: 2.5 })).toEqual({ problem: 'too_few' });
  });
  it('two brewers: only a Final, no 3rd place', () => {
    const p = previewShape({ entrants: 2 });
    expect(p.rounds).toHaveLength(1);
    expect(p.thirdPlace).toEqual({ setting: true, played: false, reason: 'no_semifinals' });
  });
  it('3rd place off: no flag about it', () => {
    const p = previewShape({ entrants: 21, thirdPlace: false });
    expect(p.thirdPlace).toEqual({ setting: false, played: false, reason: 'off' });
    expect(p.flags.some((f) => f.code === 'third_place_skipped')).toBe(false);
  });
  it('flags a feeding round that does nothing', () => {
    const p = previewShape({ entrants: 6, redemption: { feed: [1, 3], groupSize: 2, cap: 0 } });
    const unused = p.flags.filter((f) => f.code === 'redemption_unused');
    expect(unused.map((f) => f.round)).toEqual([1, 3]);
    expect(p.rounds.some((r) => r.redemption)).toBe(false);
  });
  it('a module that is off changes nothing', () => {
    expect(previewShape({ entrants: 21, redemption: null })).toEqual(
      previewShape({ entrants: 21 }),
    );
    expect(previewShape({ entrants: 21, redemption: { feed: [], groupSize: 2, cap: 0 } })).toEqual(
      previewShape({ entrants: 21 }),
    );
  });
});

describe('comparePreviews', () => {
  it('names only what differs', () => {
    const a = previewShape({ entrants: 21 });
    const b = previewShape({ entrants: 21, redemption: { feed: [1], groupSize: 2, cap: 0 } });
    expect(comparePreviews(a, b)).toEqual([
      { key: 'matches', from: 20, to: 31 },
      { key: 'byes', from: 3, to: 1 },
      { key: 'thirdPlace', from: false, to: true },
      { key: 'repeatByes', from: 2, to: 0 },
    ]);
    expect(comparePreviews(a, a)).toEqual([]);
  });
});

// The fixture the database test (pgTAP 096) plays the real engine against. It is held equal to this preview here, and the
// copy embedded in the SQL file is held equal to the fixture, so neither side can drift alone.
describe('the shared parity fixture', () => {
  const root = process.cwd();
  const fixtureText = readFileSync(
    join(root, 'supabase', 'tests', 'fixtures', 'td-bracket-preview-parity.json'),
    'utf8',
  );
  const fixture = JSON.parse(fixtureText);
  it('is what previewShape returns for each case', () => {
    for (const c of fixture.cases) {
      const p = previewShape({ entrants: c.n, thirdPlace: c.third });
      expect(
        {
          n: c.n,
          third: c.third,
          rounds: p.rounds.map((r) => [r.enter, r.matches, r.byes, r.through]),
          thirdPlayed: p.thirdPlace.played,
          matches: p.totals.matches,
        },
        `n=${c.n} third=${c.third}`,
      ).toEqual(c);
    }
  });
  it('is embedded unchanged in pgTAP 096', () => {
    const sql = readFileSync(
      join(root, 'supabase', 'tests', '096_td_bracket_preview_parity.sql'),
      'utf8',
    );
    const embedded = sql.split('-- parity-fixture:begin')[1].split('-- parity-fixture:end')[0];
    const json = embedded.split('$fx$')[1];
    expect(JSON.parse(json)).toEqual(fixture);
  });
});
