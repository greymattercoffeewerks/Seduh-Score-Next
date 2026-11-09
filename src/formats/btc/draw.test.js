import { describe, expect, it } from 'vitest';
import {
  DrawError,
  assignJudges,
  drawRound1,
  drawRound2ByResults,
  drawRound2Random,
} from './draw.js';

const teams = (n) => Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const keyOf = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const keys = (pairs) => pairs.map((p) => keyOf(p.team1Id, p.team2Id));
const teamsOf = (pairs) => pairs.flatMap((p) => [p.team1Id, p.team2Id]);

function refusal(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe('drawRound1', () => {
  it('makes 10 matches from 20 teams, every team exactly once', () => {
    const { pairs } = drawRound1({ teamIds: teams(20), seed: 'abc' });
    expect(pairs).toHaveLength(10);
    expect([...teamsOf(pairs)].sort()).toEqual(teams(20));
    for (const p of pairs) expect(p.team1Id).not.toBe(p.team2Id);
  });

  it('gives the same pairs for the same seed and different pairs for another seed', () => {
    const one = drawRound1({ teamIds: teams(20), seed: 'seed-one' });
    expect(drawRound1({ teamIds: teams(20), seed: 'seed-one' }).pairs).toEqual(one.pairs);
    expect(drawRound1({ teamIds: teams(20), seed: 'seed-two' }).pairs).not.toEqual(one.pairs);
    expect(one.seed).toBe('seed-one');
  });

  it('depends on the seed and the set of teams, not the order they are listed in', () => {
    const reversed = [...teams(20)].reverse();
    const a = drawRound1({ teamIds: teams(20), seed: 'x' }).pairs;
    expect(drawRound1({ teamIds: reversed, seed: 'x' }).pairs).toEqual(a);
    const ids = teams(20);
    const prior = drawRound1({ teamIds: ids, seed: 'r1' }).pairs;
    expect(drawRound2Random({ teamIds: reversed, priorPairs: prior, seed: 'k' }).pairs).toEqual(
      drawRound2Random({ teamIds: ids, priorPairs: prior, seed: 'k' }).pairs,
    );
    const standings = ids.map((teamId, i) => ({ teamId, points: i % 3 }));
    expect(drawRound2ByResults({ standings: [...standings].reverse(), seed: 'k' }).pairs).toEqual(
      drawRound2ByResults({ standings, seed: 'k' }).pairs,
    );
  });

  it('does not change its input', () => {
    const input = teams(6);
    const copy = [...input];
    drawRound1({ teamIds: input, seed: 's' });
    expect(input).toEqual(copy);
  });

  it('makes and returns a seed when none is given', () => {
    const { seed } = drawRound1({ teamIds: teams(4) });
    expect(seed).toMatch(/^[0-9a-f]{12}$/);
    expect(drawRound1({ teamIds: teams(4), seed }).pairs).toEqual(
      drawRound1({ teamIds: teams(4), seed }).pairs,
    );
  });

  it('refuses an odd team count with a plain message and a code', () => {
    const e = refusal(() => drawRound1({ teamIds: teams(19), seed: 's' }));
    expect(e).toBeInstanceOf(DrawError);
    expect(e.code).toBe('odd_team_count');
    expect(e.message).toMatch(/19 teams, an odd number/);
  });

  it('refuses a single team with the at-least-2 message, not the odd-count one', () => {
    expect(refusal(() => drawRound1({ teamIds: ['only'], seed: 's' }))?.code).toBe('too_few_teams');
  });

  it('refuses no teams, a duplicate team and a missing id', () => {
    expect(refusal(() => drawRound1({ teamIds: [], seed: 's' }))?.code).toBe('no_teams');
    expect(refusal(() => drawRound1({ teamIds: ['a', 'a', 'b', 'c'], seed: 's' }))?.code).toBe(
      'duplicate_team',
    );
    expect(refusal(() => drawRound1({ teamIds: ['a', '', 'b', 'c'], seed: 's' }))?.code).toBe(
      'bad_team_id',
    );
    expect(refusal(() => drawRound1({}))?.code).toBe('no_teams');
  });

  it('counts same-country pairs as information only', () => {
    // two teams, both Brunei: the only possible pair is a same-country pair, and it is allowed, not refused
    const r = drawRound1({
      teamIds: ['t01', 't02'],
      seed: 'q',
      teamCountry: { t01: 'BN', t02: 'BN' },
    });
    expect(r.pairs).toHaveLength(1);
    expect(r.warnings.find((w) => w.code === 'same_country')?.count).toBe(1);
    const none = drawRound1({
      teamIds: ['t01', 't02'],
      seed: 'q',
      teamCountry: { t01: 'BN', t02: 'MY' },
    });
    expect(none.warnings).toEqual([]);
    expect(r.rematches).toBe(0);
  });
});

describe('drawRound2Random', () => {
  it('never repeats a round 1 pair when a repeat-free draw exists, across many seeds', () => {
    const ids = teams(20);
    const round1 = drawRound1({ teamIds: ids, seed: 'r1' });
    const played = new Set(keys(round1.pairs));
    for (let i = 0; i < 200; i += 1) {
      const r2 = drawRound2Random({ teamIds: ids, priorPairs: round1.pairs, seed: `s${i}` });
      expect(r2.pairs).toHaveLength(10);
      expect([...teamsOf(r2.pairs)].sort()).toEqual(ids);
      expect(keys(r2.pairs).filter((k) => played.has(k))).toEqual([]);
      expect(r2.rematches).toBe(0);
    }
  });

  it('is repeatable: the same seed gives the same pairs', () => {
    const ids = teams(20);
    const prior = drawRound1({ teamIds: ids, seed: 'r1' }).pairs;
    const a = drawRound2Random({ teamIds: ids, priorPairs: prior, seed: 'k' });
    const b = drawRound2Random({ teamIds: ids, priorPairs: prior, seed: 'k' });
    expect(a.pairs).toEqual(b.pairs);
  });

  it('accepts prior pairs as arrays too', () => {
    const r = drawRound2Random({
      teamIds: teams(4),
      priorPairs: [
        ['t01', 't02'],
        ['t03', 't04'],
      ],
      seed: 'z',
    });
    expect(r.rematches).toBe(0);
    expect(keys(r.pairs)).not.toContain('t01|t02');
    expect(keys(r.pairs)).not.toContain('t03|t04');
  });

  it('finds the only repeat-free arrangement when avoidance needs more than one swap', () => {
    // 4 teams, three possible rounds: a-b|c-d, a-c|b-d, a-d|b-c. Two are used, one is left.
    const prior = [
      ['t01', 't02'],
      ['t03', 't04'],
      ['t01', 't03'],
      ['t02', 't04'],
    ];
    for (let i = 0; i < 30; i += 1) {
      const r = drawRound2Random({ teamIds: teams(4), priorPairs: prior, seed: `m${i}` });
      expect(keys(r.pairs).sort()).toEqual(['t01|t04', 't02|t03']);
      expect(r.rematches).toBe(0);
    }
  });

  it('reports the repeats it cannot avoid, with the fewest possible', () => {
    // every pairing of 4 teams has been played; any round repeats 2
    const all = [];
    const ids = teams(4);
    for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) all.push([ids[i], ids[j]]);
    const r = drawRound2Random({ teamIds: ids, priorPairs: all, seed: 's' });
    expect(r.rematches).toBe(2);
    expect(r.warnings.find((w) => w.code === 'rematch')).toMatchObject({ count: 2 });
    // two teams that already met have nowhere else to go
    const two = drawRound2Random({ teamIds: ['a', 'b'], priorPairs: [['a', 'b']], seed: 's' });
    expect(two.rematches).toBe(1);
    expect(two.warnings[0].message).toMatch(/1 rematch could not be avoided/);
  });

  it('still avoids every repeat with three earlier rounds on 6 teams (a repeat-free round exists)', () => {
    const t = teams(6);
    // three rounds of a 1-factorisation of K6; the unplayed edges still contain whole matchings
    const prior = [
      [t[0], t[1]],
      [t[2], t[3]],
      [t[4], t[5]],
      [t[0], t[2]],
      [t[1], t[4]],
      [t[3], t[5]],
      [t[0], t[3]],
      [t[1], t[5]],
      [t[2], t[4]],
    ];
    const played = new Set(prior.map(([a, b]) => keyOf(a, b)));
    for (let i = 0; i < 40; i += 1) {
      const r = drawRound2Random({ teamIds: t, priorPairs: prior, seed: `q${i}` });
      expect(r.rematches).toBe(0);
      expect(keys(r.pairs).filter((k) => played.has(k))).toEqual([]);
    }
  });

  it('allows repeats when avoidance is switched off, and still counts them', () => {
    const ids = teams(20);
    const prior = drawRound1({ teamIds: ids, seed: 'r1' }).pairs;
    // with the SAME seed and no avoidance, round 2 is exactly the round 1 shuffle: every pair repeats
    const r = drawRound2Random({
      teamIds: ids,
      priorPairs: prior,
      seed: 'r1',
      avoidRematches: false,
    });
    expect(r.rematches).toBe(10);
    expect(keys(r.pairs).sort()).toEqual(keys(prior).sort());
    // and with avoidance on, the same seed no longer repeats
    expect(drawRound2Random({ teamIds: ids, priorPairs: prior, seed: 'r1' }).rematches).toBe(0);
  });

  it('refuses an odd count', () => {
    expect(
      refusal(() => drawRound2Random({ teamIds: teams(19), priorPairs: [], seed: 's' }))?.code,
    ).toBe('odd_team_count');
  });
});

describe('drawRound2ByResults', () => {
  const standingsFor = (ids, pointsFn) => ids.map((teamId, i) => ({ teamId, points: pointsFn(i) }));

  it('pairs rank 1 with rank 20, 2 with 19, and so on', () => {
    const ids = teams(20);
    // distinct points: t01 has the most
    const standings = standingsFor(ids, (i) => 100 - i);
    const r = drawRound2ByResults({ standings, priorPairs: [], seed: 'x' });
    expect(r.pairs).toHaveLength(10);
    for (let k = 0; k < 10; k += 1) {
      expect(r.pairs[k]).toEqual({ team1Id: ids[k], team2Id: ids[19 - k] });
    }
    expect(r.rematches).toBe(0);
  });

  it('ranks by points whatever order the standings come in', () => {
    const ids = teams(6);
    const standings = standingsFor(ids, (i) => i * 3).reverse(); // t06 strongest
    const r = drawRound2ByResults({ standings, priorPairs: [], seed: 'x' });
    expect(r.pairs).toEqual([
      { team1Id: 't06', team2Id: 't01' },
      { team1Id: 't05', team2Id: 't02' },
      { team1Id: 't04', team2Id: 't03' },
    ]);
  });

  it('orders equal points by the seeded shuffle: same seed, same pairs', () => {
    const ids = teams(8);
    const standings = standingsFor(ids, () => 10); // everyone level
    const a = drawRound2ByResults({ standings, priorPairs: [], seed: 'tie-1' });
    expect(drawRound2ByResults({ standings, priorPairs: [], seed: 'tie-1' }).pairs).toEqual(
      a.pairs,
    );
    expect(drawRound2ByResults({ standings, priorPairs: [], seed: 'tie-2' }).pairs).not.toEqual(
      a.pairs,
    );
  });

  it('swaps only the neighbouring pairs when the strongest-weakest pair is a rematch', () => {
    const ids = teams(8);
    const standings = standingsFor(ids, (i) => 80 - i * 10);
    // t01 v t08 would be the ideal first pair, but they already met
    const r = drawRound2ByResults({ standings, priorPairs: [['t01', 't08']], seed: 'x' });
    expect(r.rematches).toBe(0);
    expect(keys(r.pairs)).not.toContain('t01|t08');
    // the repair touched one other pair at most: two ideal pairs (t03-t06, t04-t05) are still intact
    expect(keys(r.pairs)).toContain('t03|t06');
    expect(keys(r.pairs)).toContain('t04|t05');
    expect([...teamsOf(r.pairs)].sort()).toEqual(ids);
  });

  it('keeps the stronger team as team1 even after repairs against several earlier rounds', () => {
    const ids = teams(12);
    const standings = ids.map((teamId, i) => ({ teamId, points: (i % 4) * 5 }));
    const points = new Map(standings.map((r) => [r.teamId, r.points]));
    for (let i = 0; i < 300; i += 1) {
      const r1 = drawRound1({ teamIds: ids, seed: `a${i}` }).pairs;
      const r2 = drawRound2Random({ teamIds: ids, priorPairs: r1, seed: `b${i}` }).pairs;
      const r3 = drawRound2Random({
        teamIds: ids,
        priorPairs: [...r1, ...r2],
        seed: `c${i}`,
      }).pairs;
      const r = drawRound2ByResults({
        standings,
        priorPairs: [...r1, ...r2, ...r3],
        seed: `d${i}`,
      });
      for (const p of r.pairs) {
        expect(points.get(p.team1Id)).toBeGreaterThanOrEqual(points.get(p.team2Id));
      }
      expect([...teamsOf(r.pairs)].sort()).toEqual(ids);
    }
  });

  it('counts a rematch it cannot avoid', () => {
    const standings = standingsFor(['a', 'b'], (i) => 2 - i);
    const r = drawRound2ByResults({ standings, priorPairs: [['a', 'b']], seed: 'x' });
    expect(r.rematches).toBe(1);
  });

  it('allows rematches when avoidance is off', () => {
    const ids = teams(4);
    const standings = standingsFor(ids, (i) => 40 - i * 10);
    const r = drawRound2ByResults({
      standings,
      priorPairs: [['t01', 't04']],
      seed: 'x',
      avoidRematches: false,
    });
    expect(r.pairs[0]).toEqual({ team1Id: 't01', team2Id: 't04' });
    expect(r.rematches).toBe(1);
  });

  it('refuses incomplete or odd standings', () => {
    expect(refusal(() => drawRound2ByResults({ standings: undefined }))?.code).toBe('no_standings');
    expect(
      refusal(() =>
        drawRound2ByResults({
          standings: [{ teamId: 'a', points: 1 }, { teamId: 'b' }],
          seed: 's',
        }),
      )?.code,
    ).toBe('incomplete_standings');
    expect(
      refusal(() => drawRound2ByResults({ standings: standingsFor(teams(19), () => 1), seed: 's' }))
        ?.code,
    ).toBe('odd_team_count');
  });
});

describe('assignJudges', () => {
  const pairsFor = (n) =>
    Array.from({ length: n }, (_, i) => ({ team1Id: `a${i}`, team2Id: `b${i}` }));
  const judgeList = (n, countryOf = () => null) =>
    Array.from({ length: n }, (_, i) => ({ id: `j${i}`, country_code: countryOf(i) }));

  it('gives every match 3 distinct judges and keeps loads within one', () => {
    for (const judgeCount of [3, 4, 5, 7, 12]) {
      for (const matchCount of [1, 2, 7, 10]) {
        const r = assignJudges({ pairs: pairsFor(matchCount), judges: judgeList(judgeCount) });
        expect(r.assignments).toHaveLength(matchCount);
        for (const a of r.assignments) expect(new Set(a.judgeIds).size).toBe(3);
        const loads = Object.values(r.loads);
        expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
        expect(loads.reduce((s, n) => s + n, 0)).toBe(3 * matchCount);
      }
    }
  });

  it('is deterministic', () => {
    const args = { pairs: pairsFor(10), judges: judgeList(6) };
    expect(assignJudges(args)).toEqual(assignJudges(args));
  });

  it('keeps a judge off any team from their own country when it can', () => {
    const countries = ['BN', 'MY', 'ID', 'SG', 'PH', 'TH', 'VN', 'KH'];
    const judges = judgeList(8, (i) => countries[i]);
    const teamCountry = {};
    const pairs = pairsFor(10).map((p, i) => {
      teamCountry[p.team1Id] = countries[i % 8];
      teamCountry[p.team2Id] = countries[(i + 3) % 8];
      return p;
    });
    const r = assignJudges({ pairs, judges, teamCountry });
    expect(r.conflicts).toEqual([]);
    expect(r.warnings).toEqual([]);
    for (const a of r.assignments) {
      for (const jid of a.judgeIds) {
        const jc = judges.find((j) => j.id === jid).country_code;
        expect(jc).not.toBe(teamCountry[pairs[a.matchIndex].team1Id]);
        expect(jc).not.toBe(teamCountry[pairs[a.matchIndex].team2Id]);
      }
    }
    const loads = Object.values(r.loads);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it('actually trades judges: the plain rotation would have conflicts here', () => {
    // 3 matches, 4 judges. The plain deal gives match 0 the judges j0,j1,j2; make j0 share a team's country.
    const pairs = pairsFor(3);
    const judges = judgeList(4, (i) => (i === 0 ? 'BN' : 'MY'));
    const teamCountry = { a0: 'BN', b0: 'SG', a1: 'SG', b1: 'SG', a2: 'SG', b2: 'SG' };
    const r = assignJudges({ pairs, judges, teamCountry });
    expect(r.assignments[0].judgeIds).not.toContain('j0');
    expect(r.conflicts).toEqual([]);
  });

  it('finds a conflict-free assignment that the simple trades miss', () => {
    // found by the scoring-auditor's brute-force comparison: trades alone leave one conflict, a zero-conflict deal exists
    const countries = ['SG', null, 'BN', null, 'MY', 'MY'];
    const judges = judgeList(6, (i) => countries[i]);
    const teamCountry = { a0: 'MY', b0: 'BN', a1: 'SG', b1: 'SG', a2: 'SG', b2: 'MY' };
    const r = assignJudges({ pairs: pairsFor(3), judges, teamCountry });
    expect(r.conflicts).toEqual([]);
    for (const a of r.assignments) expect(new Set(a.judgeIds).size).toBe(3);
    const loads = Object.values(r.loads);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it('lists the conflicts instead of failing when the pool is too small', () => {
    // 3 judges, all from BN; every team is BN: every placement conflicts, twice (two teams)
    const pairs = pairsFor(2);
    const judges = judgeList(3, () => 'BN');
    const teamCountry = { a0: 'BN', b0: 'BN', a1: 'BN', b1: 'BN' };
    const r = assignJudges({ pairs, judges, teamCountry });
    expect(r.assignments).toHaveLength(2);
    for (const a of r.assignments) expect(new Set(a.judgeIds).size).toBe(3);
    expect(r.conflicts).toHaveLength(2 * 3 * 2);
    expect(r.warnings[0]).toMatchObject({ code: 'judge_conflict', count: 2 });
    expect(r.conflicts[0]).toEqual(expect.objectContaining({ matchIndex: 0 }));
  });

  it('never calls a judge with no country, or a team with no country, a conflict', () => {
    const r = assignJudges({
      pairs: pairsFor(2),
      judges: judgeList(4, () => null),
      teamCountry: { a0: 'BN', b0: 'BN', a1: 'MY', b1: 'MY' },
    });
    expect(r.conflicts).toEqual([]);
    const r2 = assignJudges({
      pairs: pairsFor(2),
      judges: judgeList(4, () => 'BN'),
      teamCountry: {},
    });
    expect(r2.conflicts).toEqual([]);
  });

  it('accepts a Map for teamCountry', () => {
    const r = assignJudges({
      pairs: pairsFor(1),
      judges: judgeList(3, () => 'BN'),
      teamCountry: new Map([['a0', 'BN']]),
    });
    expect(r.conflicts.map((c) => c.teamId)).toEqual(['a0', 'a0', 'a0']);
  });

  it('refuses fewer than 3 judges, no matches, and a repeated judge id', () => {
    expect(refusal(() => assignJudges({ pairs: pairsFor(1), judges: judgeList(2) }))?.code).toBe(
      'too_few_judges',
    );
    expect(refusal(() => assignJudges({ pairs: [], judges: judgeList(5) }))?.code).toBe('no_pairs');
    expect(
      refusal(() =>
        assignJudges({ pairs: pairsFor(1), judges: [{ id: 'x' }, { id: 'x' }, { id: 'y' }] }),
      )?.code,
    ).toBe('duplicate_judge');
  });
});
