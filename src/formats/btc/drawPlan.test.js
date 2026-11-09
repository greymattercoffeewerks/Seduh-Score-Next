import { describe, it, expect } from 'vitest';
import {
  defaultRound,
  drawIssues,
  generateDraw,
  recordMode,
  recordSeed,
  roundMatchesFor,
  roundStatus,
  setJudge,
  setTick,
  swapTeams,
} from './drawPlan.js';
import { describePairs, drawRound1 } from './draw.js';

const teams = ['a', 'b', 'c', 'd'].map((id, i) => ({
  id,
  name: id.toUpperCase(),
  country_code: ['BN', 'BN', 'SG', null][i],
}));
const judges = [
  { id: 'j1', name: 'J1', country_code: 'BN' },
  { id: 'j2', name: 'J2', country_code: null },
  { id: 'j3', name: 'J3', country_code: null },
  { id: 'j4', name: 'J4', country_code: 'MY' },
];
const row = (id, round, status, t1, t2) => ({
  match: { id, prelim_round: round, status, team1_id: t1, team2_id: t2 },
  judgeIds: [],
});

describe('roundStatus', () => {
  it('reads a null prelim_round as round 1, and offers round 1 only while it has no matches', () => {
    expect(roundStatus(1, []).available).toBe(true);
    expect(roundStatus(1, [row('m', null, 'pending', 'a', 'b')])).toMatchObject({
      drawn: true,
      available: false,
    });
    expect(defaultRound([])).toBe(1);
    expect(defaultRound([row('m', null, 'pending', 'a', 'b')])).toBe(2);
  });

  it('needs round 1 drawn and every match confirmed before round 2', () => {
    expect(roundStatus(2, []).available).toBe(false);
    expect(roundStatus(2, [row('m', 1, 'scoring', 'a', 'b')]).reason).toMatch(
      /1 of 1 is still open/,
    );
    expect(roundStatus(2, [row('m', 1, 'confirmed', 'a', 'b')]).available).toBe(true);
    expect(
      roundStatus(2, [row('m', 1, 'confirmed', 'a', 'b'), row('n', 2, 'pending', 'c', 'd')]).drawn,
    ).toBe(true);
  });
});

describe('generateDraw', () => {
  const base = { round: 1, seed: 's1', avoid: true, teams, judges, matches: [], standings: null };

  it('is exactly draw.js: the same pairs as drawRound1 for the same seed', () => {
    const draw = generateDraw(base);
    const direct = drawRound1({ teamIds: teams.map((t) => t.id), seed: 's1' });
    expect(draw.pairs).toEqual(direct.pairs);
    expect(draw.mode).toBe('random');
    expect(draw.judgeIds).toHaveLength(2);
    expect(draw.judgeIds.every((ids) => new Set(ids).size === 3)).toBe(true);
  });

  it('refuses by-results round 2 when there is no standings table', () => {
    const matches = [row('m', 1, 'confirmed', 'a', 'b'), row('n', 1, 'confirmed', 'c', 'd')];
    expect(() => generateDraw({ ...base, round: 2, round2Mode: 'by_results', matches })).toThrow(
      /could not be read/,
    );
  });

  it('refuses an odd number of teams with draw.js’s own error', () => {
    expect(() => generateDraw({ ...base, teams: teams.slice(0, 3) })).toThrow(/odd number/);
  });
});

describe('hand edits', () => {
  const ctx = { teams, judges, matches: [] };
  const draw0 = () => generateDraw({ round: 1, seed: 's1', avoid: true, ...ctx, standings: null });

  it('a swap marks the draw manual, drops the seed from the record and clears both ticks', () => {
    let draw = setTick(setTick(draw0(), 0, true), 1, true);
    expect(recordMode(draw)).toBe('random');
    expect(recordSeed(draw)).toBe('s1');
    const before = draw.pairs;
    draw = swapTeams(draw, { match: 0, slot: 1 }, { match: 1, slot: 2 }, ctx);
    expect(draw.manual).toBe(true);
    expect(recordMode(draw)).toBe('manual');
    expect(recordSeed(draw)).toBeNull();
    expect(draw.ticks).toEqual([false, false]);
    expect(draw.pairs[0].team1Id).toBe(before[1].team2Id);
    expect(draw.pairs[1].team2Id).toBe(before[0].team1Id);
    // every team still appears exactly once
    expect(draw.pairs.flatMap((p) => [p.team1Id, p.team2Id]).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a judge change keeps the seed and mode but drops that match’s tick', () => {
    let draw = setTick(draw0(), 0, true);
    draw = setJudge(draw, 0, 0, 'j4');
    expect(draw.manual).toBe(false);
    expect(draw.ticks[0]).toBe(false);
    expect(draw.judgeIds[0][0]).toBe('j4');
  });

  it('blocks on a duplicate judge and on an unaccepted own-country judge, and nothing else', () => {
    let draw = draw0();
    draw = {
      ...draw,
      pairs: [
        { team1Id: 'a', team2Id: 'c' },
        { team1Id: 'b', team2Id: 'd' },
      ],
      judgeIds: [
        ['j2', 'j3', 'j4'],
        ['j2', 'j3', 'j4'],
      ],
      ticks: [false, false],
    };
    expect(drawIssues(draw, { teams, judges }).valid).toBe(true);
    const withConflict = setJudge(draw, 0, 0, 'j1'); // j1 is from BN, team a is from BN
    const issues = drawIssues(withConflict, { teams, judges });
    expect(issues.valid).toBe(false);
    expect(issues.byMatch[0].conflicts[0].message).toBe(
      'Judge J1 is from Brunei, the same country as A.',
    );
    expect(drawIssues(setTick(withConflict, 0, true), { teams, judges }).valid).toBe(true);
    const duplicate = setJudge(draw, 0, 1, 'j2');
    expect(drawIssues(duplicate, { teams, judges }).byMatch[0].duplicate).toBe(true);
  });

  it('builds p_matches in match order', () => {
    const draw = draw0();
    const rows = roundMatchesFor(draw);
    expect(rows.map((r) => [r.team1_id, r.team2_id])).toEqual(
      draw.pairs.map((p) => [p.team1Id, p.team2Id]),
    );
    expect(rows[0].judge_ids).toEqual(draw.judgeIds[0]);
  });
});

describe('describePairs (draw.js)', () => {
  it('counts rematches and same-country pairs for hand-made pairs', () => {
    const result = describePairs({
      pairs: [
        { team1Id: 'a', team2Id: 'b' },
        { team1Id: 'c', team2Id: 'd' },
      ],
      priorPairs: [['b', 'a']],
      teamCountry: new Map([
        ['a', 'BN'],
        ['b', 'BN'],
        ['c', 'SG'],
        ['d', null],
      ]),
      avoidRematches: true,
    });
    expect(result.rematches).toBe(1);
    expect(result.sameCountryPairs).toBe(1);
    expect(result.warnings.map((w) => w.code)).toEqual(['rematch', 'same_country']);
  });
});
