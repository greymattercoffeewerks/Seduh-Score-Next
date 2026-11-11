import { describe, it, expect } from 'vitest';
import {
  cutOthers,
  cutQualifiers,
  deriveCutRows,
  isLevelRows,
  isSettledRows,
  lockState,
  pointsByRound,
  rankCutRows,
  roundProgress,
  timeCells,
} from './cutData.js';
import { buildBtcSignOff } from './signOff.js';

const teams = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i + 1}`,
  name: `Team ${i + 1}`,
  country_code: null,
}));
// A seed-order row as seeding.js fetchSeedingOrder returns it.
const seeded = (teamId, seed, totalPoints, extra = {}) => ({
  teamId,
  seed,
  wins: 1,
  played: 2,
  totalPoints,
  tiedCount: 1,
  tiebreakRank: null,
  reason: null,
  groupResolved: true,
  ...extra,
});
const plain = () => teams.map((t, i) => seeded(t.id, i + 1, 100 - i * 5));
const m = (id, round, status = 'confirmed') => ({
  id,
  round: 'preliminary',
  prelim_round: round,
  status,
});
const both = [m('m1', 1), m('m2', 2)];
const lock = (over = {}) =>
  lockState({
    matches: both,
    seedingRows: plain(),
    readFailed: false,
    formOpen: false,
    bracketExists: false,
    ...over,
  });

describe('lockState', () => {
  it('is allowed with both rounds confirmed, eight results and no tie at the line', () => {
    expect(lock()).toEqual({ allowed: true, reason: null });
  });

  it('no ties at all: allowed', () => {
    expect(lock({ seedingRows: plain() }).allowed).toBe(true);
  });

  it('a tie inside the top 8 does not hold it back', () => {
    const rows = plain();
    rows[1] = seeded('t2', 2, 90, { tiedCount: 2, groupResolved: false });
    rows[2] = seeded('t3', 3, 90, { tiedCount: 2, groupResolved: false });
    expect(lock({ seedingRows: rows }).allowed).toBe(true);
  });

  it('a tie across 8th and 9th holds it back until it is recorded', () => {
    const rows = plain();
    rows[7] = seeded('t8', 8, 60, { tiedCount: 2, groupResolved: false });
    rows[8] = seeded('t9', 9, 60, { tiedCount: 2, groupResolved: false });
    const held = lock({ seedingRows: rows });
    expect(held.allowed).toBe(false);
    expect(held.reason).toContain('level across the cut line');
    rows[7].groupResolved = rows[8].groupResolved = true;
    expect(lock({ seedingRows: rows }).allowed).toBe(true);
  });

  it('a three-way tie across the line needs all three recorded (the database says so per team)', () => {
    const rows = plain();
    for (const [i, id] of [
      [6, 't7'],
      [7, 't8'],
      [8, 't9'],
    ]) {
      rows[i] = seeded(id, i + 1, 60, { tiedCount: 3, groupResolved: false });
    }
    expect(lock({ seedingRows: rows }).allowed).toBe(false);
    rows[8].groupResolved = true; // only the 9th: still not settled
    expect(lock({ seedingRows: rows }).allowed).toBe(false);
    rows[8].groupResolved = false;
    rows[6].groupResolved = rows[7].groupResolved = true; // only two of three: still not settled
    expect(lock({ seedingRows: rows }).allowed).toBe(false);
    rows[8].groupResolved = true;
    expect(lock({ seedingRows: rows }).allowed).toBe(true);
  });

  it('a round not yet confirmed holds it back and says which and how many', () => {
    const matches = [m('a', 1), m('b', 2), m('c', 2, 'pending'), m('d', 2, 'scoring')];
    expect(lock({ matches })).toEqual({
      allowed: false,
      reason: 'Round 2 still has 2 matches to confirm.',
    });
    expect(lock({ matches: [m('a', 1, 'pending'), m('b', 2)] }).reason).toBe(
      'Round 1 still has 1 match to confirm.',
    );
  });

  it('a round that has not been drawn holds it back', () => {
    expect(lock({ matches: [m('a', 1)] }).reason).toBe('Round 2 has not been drawn yet.');
    expect(lock({ matches: [] }).reason).toBe('Round 1 has not been drawn yet.');
  });

  it('an unnumbered match is round 1, and a round above 2 must be confirmed too', () => {
    expect(lock({ matches: [{ ...m('a', null), prelim_round: null }, m('b', 2)] }).allowed).toBe(
      true,
    );
    expect(lock({ matches: [...both, m('c', 3, 'pending')] }).reason).toBe(
      'Round 3 still has 1 match to confirm.',
    );
  });

  it('is held back when the matches could not be read, and when the tie check failed', () => {
    expect(lock({ matches: null }).reason).toContain('could not check that both rounds');
    expect(lock({ readFailed: true }).reason).toContain('Check again');
  });

  it('is held back with fewer than eight results, while a form is open, and once locked', () => {
    expect(lock({ seedingRows: plain().slice(0, 7) }).reason).toBe(
      'Only 7 teams have a result; the knockout needs 8.',
    );
    expect(lock({ seedingRows: plain().slice(0, 1) }).reason).toBe(
      'Only 1 team has a result; the knockout needs 8.',
    );
    expect(lock({ formOpen: true }).reason).toBe('Save or cancel the order you have open first.');
    expect(lock({ bracketExists: true }).allowed).toBe(false);
  });
});

describe('roundProgress', () => {
  it('always reports rounds 1 and 2, with how many matches are drawn and open', () => {
    expect(roundProgress([])).toEqual([
      { round: 1, drawn: 0, open: 0 },
      { round: 2, drawn: 0, open: 0 },
    ]);
    expect(roundProgress([m('a', 1), m('b', 2, 'pending'), m('c', 3)])).toEqual([
      { round: 1, drawn: 1, open: 0 },
      { round: 2, drawn: 1, open: 1 },
      { round: 3, drawn: 1, open: 0 },
    ]);
  });
});

describe('pointsByRound', () => {
  const score = (match, t1, t2, p1, p2, tokens = [30, 15], status = 'confirmed') => ({
    match_id: match,
    status,
    team1_id: t1,
    team2_id: t2,
    team1_tokens: tokens[0],
    team2_tokens: tokens[1],
    team1_total: p1,
    team2_total: p2,
  });

  it('adds up confirmed, complete matches per team per round', () => {
    const byTeam = pointsByRound(both, [
      score('m1', 't1', 't2', 37, 15),
      score('m2', 't1', 't3', 30, 20, [25, 20]),
    ]);
    expect(byTeam.get('t1').get(1)).toBe(37);
    expect(byTeam.get('t1').get(2)).toBe(30);
    expect(byTeam.get('t2').get(1)).toBe(15);
    expect(byTeam.get('t3').get(2)).toBe(20);
  });

  it('leaves out a match that is not confirmed or not complete, as the standings view does', () => {
    const byTeam = pointsByRound(both, [
      score('m1', 't1', 't2', 37, 15, [30, 15], 'scoring'),
      score('m2', 't1', 't3', 30, 20, [20, 20]),
    ]);
    expect(byTeam.size).toBe(0);
  });

  it('is null when either read failed', () => {
    expect(pointsByRound(null, [])).toBeNull();
    expect(pointsByRound(both, null)).toBeNull();
  });
});

describe('deriveCutRows', () => {
  it('lists teams in the DATABASE seed order, whatever their points say', () => {
    const rows = plain();
    // an organiser-recorded order seeds t3 above t2 although both have 90 points
    rows[1] = seeded('t2', 3, 90, { tiedCount: 2 });
    rows[2] = seeded('t3', 2, 90, { tiedCount: 2 });
    const derived = deriveCutRows({ teams, seedingRows: rows });
    expect(derived.slice(0, 3).map((r) => r.teamId)).toEqual(['t1', 't3', 't2']);
  });

  it('puts a team with no result after the seeded ones, in roster order, with no seed', () => {
    const derived = deriveCutRows({ teams, seedingRows: plain().slice(0, 8) });
    expect(derived.slice(8).map((r) => [r.teamId, r.seed, r.totalPoints])).toEqual([
      ['t9', null, 0],
      ['t10', null, 0],
    ]);
  });

  it('carries round points and times as evidence, and flags totals that do not add up', () => {
    const scores = [
      {
        match_id: 'm1',
        status: 'confirmed',
        team1_id: 't1',
        team2_id: 't2',
        team1_tokens: 30,
        team2_tokens: 15,
        team1_total: 37,
        team2_total: 15,
      },
    ];
    const times = [
      { teamId: 't1', round: 1, note: '8:12' },
      { teamId: 't1', round: 2, note: '9:05' },
    ];
    const rows = plain();
    rows[0] = seeded('t1', 1, 100);
    const [first] = deriveCutRows({ teams, seedingRows: rows, matches: both, scores, times });
    expect(first.round1).toBe(37);
    expect(first.round2).toBeNull();
    expect(first.roundsAddUp).toBe(false); // 37 is not 100: the screen says the total is the one that counts
    expect(timeCells(first)).toEqual({ round1: '8:12', round2: '9:05', sum: '17:17' });
  });

  it('shows dashes, never zeros, when a read failed', () => {
    const [first] = deriveCutRows({ teams, seedingRows: plain() });
    expect(first.round1).toBeNull();
    expect(first.roundsAddUp).toBe(true);
    expect(timeCells(first)).toEqual({ round1: '–', round2: '–', sum: '–' });
  });

  it('never changes the totals or the order it was given by what the times say', () => {
    const times = [
      { teamId: 't2', round: 1, note: '1:00' },
      { teamId: 't2', round: 2, note: '1:00' },
    ];
    const derived = deriveCutRows({ teams, seedingRows: plain(), times });
    expect(derived.map((r) => r.teamId)).toEqual(teams.map((t) => t.id));
    expect(derived.map((r) => r.totalPoints)).toEqual(plain().map((r) => r.totalPoints));
  });
});

describe('rankCutRows, isLevelRows, isSettledRows', () => {
  it('numbers places like rank() (equal points share, then skip) without sorting', () => {
    const rows = deriveCutRows({
      teams,
      seedingRows: [
        seeded('t1', 1, 50),
        seeded('t2', 2, 90, { tiedCount: 2 }),
        seeded('t3', 3, 90, { tiedCount: 2 }),
        seeded('t4', 4, 40),
      ],
    });
    const ranked = rankCutRows(rows);
    // the database put t1 first even though t2 has more points: the order is kept
    expect(ranked.slice(0, 4).map((r) => [r.item.teamId, r.position])).toEqual([
      ['t1', 1],
      ['t2', 2],
      ['t3', 2],
      ['t4', 4],
    ]);
  });

  it('only teams in a database tie group are level, and teams with no result never are', () => {
    const [a, b, c] = deriveCutRows({
      teams,
      seedingRows: [seeded('t1', 1, 50, { tiedCount: 2 }), seeded('t2', 2, 50, { tiedCount: 2 })],
    });
    expect(isLevelRows(a, b)).toBe(true);
    expect(isLevelRows(b, c)).toBe(false);
    const noResult = deriveCutRows({ teams, seedingRows: [] });
    expect(isLevelRows(noResult[0], noResult[1])).toBe(false);
  });

  it('a group is settled only when every team in it is', () => {
    const rows = deriveCutRows({
      teams,
      seedingRows: [
        seeded('t1', 1, 50, { tiedCount: 2, groupResolved: true }),
        seeded('t2', 2, 50, { tiedCount: 2, groupResolved: false }),
      ],
    });
    expect(isSettledRows(rows.slice(0, 2))).toBe(false);
    expect(isSettledRows(rows.slice(0, 1))).toBe(true);
  });
});

describe('cutQualifiers and cutOthers', () => {
  it('split the rows on the DATABASE seed (8 or better), never on points', () => {
    const rows = deriveCutRows({ teams, seedingRows: plain().slice(0, 9) });
    expect(cutQualifiers(rows).map((r) => r.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cutOthers(rows).map((r) => r.teamId)).toEqual(['t9', 't10']);
  });
});

describe('the BTC sign-off sheet content', () => {
  const build = (over = {}) =>
    buildBtcSignOff({
      event: { name: 'ABTC', event_date: '2027-03-20', is_test: false, is_shadow: true },
      teams,
      seedingRows: plain(),
      matches: both,
      scores: [],
      times: [],
      now: new Date(2027, 2, 21, 9, 30),
      ...over,
    });
  it('is final, with the eight in seed order and the rest under "not going through"', () => {
    const spec = build();
    expect(spec.status.kind).toBe('final');
    expect(spec.title).toBe('Top 8 sign-off');
    expect(spec.dateText).toBe('Event date 2027-03-20');
    expect(spec.qualifiers.rows.map((r) => r.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(spec.qualifiers.columns.map((c) => c.header)).toEqual([
      'Seed',
      'Team',
      'R1 pts',
      'R2 pts',
      'Total',
      'R1 time',
      'R2 time',
      'Time sum',
      'Note',
    ]);
    expect(spec.others.items).toEqual(['9. Team 9 · 60 pts', '10. Team 10 · 55 pts']);
    expect(spec.signatories.map((s) => s.role)).toEqual(['Committee chair', 'Organiser']);
    expect(spec.notes.items).toEqual([]);
  });

  it('records every settled tie with its reason, in the order the organiser set', () => {
    const rows = plain();
    rows[7] = seeded('t8', 9, 60, {
      tiedCount: 2,
      tiebreakRank: 2,
      reason: 'cup-off',
      groupResolved: true,
    });
    rows[8] = seeded('t9', 8, 60, {
      tiedCount: 2,
      tiebreakRank: 1,
      reason: 'cup-off',
      groupResolved: true,
    });
    const spec = build({ seedingRows: rows });
    expect(spec.status.kind).toBe('final');
    expect(spec.notes.items).toEqual([
      {
        title: 'Level for 8th to 9th · 60 pts',
        text: 'Order: Team 9, then Team 8. Reason: cup-off',
      },
    ]);
    // the seed, not the points, decides who is in the eight
    expect(spec.qualifiers.rows.map((r) => r.teamId)).toContain('t9');
    expect(spec.qualifiers.rows.map((r) => r.teamId)).not.toContain('t8');
    expect(spec.qualifiers.columns.at(-1).cell(spec.qualifiers.rows.at(-1))).toBe(
      'Level on points: order settled',
    );
  });

  it('says NOT FINAL, with the reason, when a tie at the line is not settled or a round is open', () => {
    const rows = plain();
    rows[7] = seeded('t8', 8, 60, { tiedCount: 2, groupResolved: false });
    rows[8] = seeded('t9', 9, 60, { tiedCount: 2, groupResolved: false });
    const tied = build({ seedingRows: rows });
    expect(tied.status.kind).toBe('draft');
    expect(tied.status.text).toMatch(/^NOT FINAL\. /);
    expect(tied.notes.items[0].text).toBe('The order has not been recorded yet.');
    expect(tied.qualifiers.columns.at(-1).cell(tied.qualifiers.rows.at(-1))).toBe(
      'Level on points: NOT SETTLED',
    );
    const open = build({ matches: [m('a', 1), m('b', 2, 'pending')] });
    expect(open.status.text).toBe('NOT FINAL. Round 2 still has 1 match to confirm.');
  });

  it('is final once the bracket exists, and a team with no result is listed as such', () => {
    const spec = build({
      bracketExists: true,
      seedingRows: plain().slice(0, 9),
      matches: [m('a', 1)],
    });
    expect(spec.status.kind).toBe('final');
    expect(spec.others.items).toEqual(['9. Team 9 · 60 pts', 'Team 10 · no result']);
  });

  it('carries the event so the shadow band prints, and when it was generated', () => {
    const spec = build();
    expect(spec.event.is_shadow).toBe(true);
    expect(spec.generatedAt).toEqual(new Date(2027, 2, 21, 9, 30));
  });
});

import { LOCKED_DIFFERS_NOTE, lockedDiffers, lockedSeedsFromBracket } from './cutData.js';

describe('after the bracket exists', () => {
  const qf = (n, t1, t2) => ({
    slot: {
      round: 'quarterfinal',
      slot_label: `qf${n}`,
      team1_id: t1,
      team2_id: t2,
      seed_1: n,
      seed_2: 9 - n,
    },
  });
  const entries = [qf(1, 't1', 't8'), qf(2, 't2', 't7'), qf(3, 't3', 't6'), qf(4, 't4', 't5')];

  it('reads the locked seeds from the quarterfinal slots, and is null with no bracket', () => {
    const seeds = lockedSeedsFromBracket(entries);
    expect([...seeds.entries()].sort()).toEqual([
      ['t1', 1],
      ['t2', 2],
      ['t3', 3],
      ['t4', 4],
      ['t5', 5],
      ['t6', 6],
      ['t7', 7],
      ['t8', 8],
    ]);
    expect(lockedSeedsFromBracket([])).toBeNull();
  });

  it('lists the locked eight, not the live view, when a re-confirm moved the standings', () => {
    const seeds = lockedSeedsFromBracket(entries);
    const live = plain();
    // t9 overtook t8 after the lock
    live[7] = seeded('t8', 9, 55);
    live[8] = seeded('t9', 8, 61);
    expect(lockedDiffers(live, seeds)).toBe(true);
    expect(lockedDiffers(plain(), seeds)).toBe(false);
    const rows = deriveCutRows({ teams, seedingRows: live, lockedSeeds: seeds });
    expect(cutQualifiers(rows).map((r) => r.teamId)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
    ]);
    expect(cutOthers(rows).map((r) => r.teamId)).toEqual(['t9', 't10']);
    expect(rows.every((r) => r.tiedCount === 1 && r.resolved)).toBe(true);
  });

  it('the sheet stays final but says the standings now differ', () => {
    const seeds = lockedSeedsFromBracket(entries);
    const live = plain();
    live[7] = seeded('t8', 9, 55);
    live[8] = seeded('t9', 8, 61);
    const spec = buildBtcSignOff({
      event: { name: 'x' },
      teams,
      seedingRows: live,
      matches: both,
      scores: [],
      times: [],
      bracketExists: true,
      lockedSeeds: seeds,
    });
    expect(spec.qualifiers.rows.map((r) => r.teamId)).toContain('t8');
    expect(spec.qualifiers.rows.map((r) => r.teamId)).not.toContain('t9');
    expect(spec.status.kind).toBe('final');
    expect(spec.status.text).toContain(LOCKED_DIFFERS_NOTE);
  });

  it('a final sheet says so when a tie inside the eight is not settled', () => {
    const rows = plain();
    rows[1] = seeded('t2', 2, 90, { tiedCount: 2, groupResolved: false });
    rows[2] = seeded('t3', 3, 90, { tiedCount: 2, groupResolved: false });
    const spec = buildBtcSignOff({
      event: {},
      teams,
      seedingRows: rows,
      matches: both,
      scores: [],
      times: [],
    });
    expect(spec.status.kind).toBe('final');
    expect(spec.status.text).toContain('provisional');
  });
});
