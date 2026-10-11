import { describe, it, expect } from 'vitest';
import { rank, chainComparators } from '../../core/ranking.js';
import { computeScores } from './scoring.js';
import {
  DEMO_TEAM_NAMES,
  preliminaryFixtureMatches,
  preliminaryPayload,
  knockoutFixtureMatches,
  knockoutPayload,
} from './demoLivePayload.js';

const KNOCKOUT_RESULTS = {
  qf1: { tokensA: 40, fastest: 0, signature: [true, false] },
  qf2: { tokensA: 20, fastest: 4 },
  qf3: { tokensA: 30, tiebreak: { winner: 5, reason: 'Coin' } },
  qf4: { tokensA: 33 },
  sf1: { tokensA: 35, fastest: 0, signature: [true, false] },
  sf2: { tokensA: 28, fastest: 5 },
  third: { tokensA: 32, signature: [false, true] },
  final: { tokensA: 26, fastest: 5, signature: [true, true] },
};

function recomputedStandings(records) {
  const byTeam = new Map(
    DEMO_TEAM_NAMES.map((name, i) => [`t${i + 1}`, { played: 0, wins: 0, points: 0 }]),
  );
  for (const { match, draft } of records.filter(({ match }) => match.round === 'preliminary')) {
    const scores = computeScores(draft, match.round);
    for (const [teamId, tokens, opponentTokens, total] of [
      [match.team1_id, scores.team1Tokens, scores.team2Tokens, scores.team1Total],
      [match.team2_id, scores.team2Tokens, scores.team1Tokens, scores.team2Total],
    ]) {
      const row = byTeam.get(teamId);
      row.played += 1;
      row.wins += tokens > opponentTokens ? 1 : 0;
      row.points += total;
    }
  }
  return rank(
    DEMO_TEAM_NAMES.map((teamName, i) => ({
      teamName,
      teamId: `t${i + 1}`,
      ...byTeam.get(`t${i + 1}`),
    })),
    chainComparators(
      (a, b) => b.points - a.points,
      (a, b) => b.wins - a.wins,
    ),
  ).map(({ item, position }) => ({
    position,
    teamName: item.teamName,
    played: item.played,
    wins: item.wins,
    points: item.points,
  }));
}

describe('demoLivePayload: the fixtures the preview page and the screen tests stand on', () => {
  it('is deterministic: the same call gives the same payload', () => {
    expect(preliminaryPayload({ playedCount: 9 })).toEqual(preliminaryPayload({ playedCount: 9 }));
    expect(knockoutPayload({ results: { qf1: { tokensA: 40 } } })).toEqual(
      knockoutPayload({ results: { qf1: { tokensA: 40 } } }),
    );
  });

  it('derives every demo match total from scoring.js cup votes, and pins the shown results and standings', () => {
    const records = knockoutFixtureMatches({ results: KNOCKOUT_RESULTS }).filter(
      ({ score }) => score,
    );
    for (const { match, score, draft } of records) {
      const recomputed = computeScores(draft, match.round);
      expect(score).toMatchObject({
        team1_tokens: recomputed.team1Tokens,
        team2_tokens: recomputed.team2Tokens,
        team1_total: recomputed.team1Total,
        team2_total: recomputed.team2Total,
      });
    }

    // A fixture vote changes at least one points total; this pin makes that a deliberate
    // update instead of a silent demo/test-data change.
    const preliminary = preliminaryPayload({ playedCount: 28 });
    expect(preliminary.standings).toEqual([
      { position: 1, teamName: 'Bean Scene', played: 7, wins: 7, points: 259 },
      { position: 2, teamName: 'Pour Decisions', played: 7, wins: 6, points: 237 },
      { position: 3, teamName: 'Crema Crew', played: 7, wins: 4, points: 211 },
      { position: 4, teamName: 'Drip Society', played: 7, wins: 4, points: 182 },
      { position: 5, teamName: 'Grind House', played: 7, wins: 3, points: 176 },
      { position: 6, teamName: 'Roast Republic', played: 7, wins: 2, points: 137 },
      { position: 7, teamName: 'Latte Lab', played: 7, wins: 2, points: 124 },
      { position: 8, teamName: 'Steam Team', played: 7, wins: 0, points: 98 },
    ]);
    expect(preliminary.standings).toEqual(recomputedStandings(preliminaryFixtureMatches()));

    const knockout = knockoutPayload({ results: KNOCKOUT_RESULTS });
    const byMatchId = new Map(records.map(({ match, score }) => [match.id, score]));
    for (const result of knockout.recentResults) {
      const score = byMatchId.get(result.matchId);
      expect(result.teams.map(({ tokens, total }) => ({ tokens, total }))).toEqual([
        { tokens: score.team1_tokens, total: score.team1_total },
        { tokens: score.team2_tokens, total: score.team2_total },
      ]);
    }
    expect(
      ['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'third', 'final'].map((id) => {
        const score = byMatchId.get(id);
        return [id, score.team1_total, score.team2_total];
      }),
    ).toEqual([
      ['qf1', 49, 20],
      ['qf2', 20, 47],
      ['qf3', 30, 30],
      ['qf4', 38, 27],
      ['sf1', 44, 25],
      ['sf2', 30, 37],
      ['third', 37, 30],
      ['final', 28, 41],
    ]);
  });

  it('runs the preliminary as a full round robin of eight teams, played in order', () => {
    const none = preliminaryPayload({ playedCount: 0 });
    expect(none.progress).toEqual({ played: 0, total: 28 });
    expect(none.standings.map((row) => row.teamName).sort()).toEqual([...DEMO_TEAM_NAMES].sort());
    expect(none.recentResults).toEqual([]);
    const half = preliminaryPayload({ playedCount: 14 });
    expect(half.progress).toEqual({ played: 14, total: 28 });
    expect(half.phase).toBe('preliminary');
    expect(half.recentResults).toHaveLength(3);
    expect(half.standings.reduce((sum, row) => sum + row.played, 0)).toBe(28);
    expect(half.upNext.teams).toHaveLength(2);
    expect(half.upNext.judges).toHaveLength(3);
  });

  it('has nothing up next once every preliminary is played', () => {
    expect(preliminaryPayload({ playedCount: 28 }).upNext).toBeNull();
  });

  it('seats the knockout from the final standings (1v8, 4v5, 3v6, 2v7), by name', () => {
    const payload = knockoutPayload();
    expect(payload.phase).toBe('knockout');
    expect(payload.standings.map((row) => row.teamName)).toEqual([
      'Bean Scene',
      'Pour Decisions',
      'Crema Crew',
      'Drip Society',
      'Grind House',
      'Roast Republic',
      'Latte Lab',
      'Steam Team',
    ]);
    const quarterfinals = payload.bracket.rounds[0].slots.map((slot) =>
      slot.teams.map((team) => team.name),
    );
    expect(quarterfinals).toEqual([
      ['Bean Scene', 'Steam Team'],
      ['Drip Society', 'Grind House'],
      ['Crema Crew', 'Roast Republic'],
      ['Pour Decisions', 'Latte Lab'],
    ]);
  });

  it('seeds the quarterfinal teams as generate_btc_bracket does, and carries the seeds to the match cards', () => {
    const payload = knockoutPayload();
    expect(payload.upNext.teams.map((team) => [team.name, team.seed])).toEqual([
      ['Bean Scene', 1],
      ['Steam Team', 8],
    ]);
    expect(payload.thenNext.teams.map((team) => team.seed)).toEqual([4, 5]);
  });

  it('a semifinalist keeps its quarterfinal seed, and later-round slots carry none of their own', () => {
    const payload = knockoutPayload({
      results: {
        qf1: { tokensA: 40 },
        qf2: { tokensA: 40 },
        qf3: { tokensA: 40 },
        qf4: { tokensA: 40 },
      },
    });
    // qf1 (seeds 1 v 8) and qf2 (4 v 5) are won by the first team of each: seeds 1 and 4 meet in sf1
    expect(payload.upNext.round).toBe('semifinal');
    expect(payload.upNext.teams.map((team) => [team.name, team.seed])).toEqual([
      ['Bean Scene', 1],
      ['Drip Society', 4],
    ]);
  });

  it('carries a winner forward and leaves the seat after a level quarterfinal open until a tie-break is recorded', () => {
    const level = knockoutPayload({ results: { qf1: { tokensA: 30 } } });
    expect(level.bracket.rounds[1].slots[0].teams[0].name).toBeNull();
    const decided = knockoutPayload({
      results: { qf1: { tokensA: 30, tiebreak: { winner: 7, reason: 'Coin' } } },
    });
    expect(decided.bracket.rounds[1].slots[0].teams[0].name).toBe(DEMO_TEAM_NAMES[7]);
    expect(decided.recentResults[0].tiebreak).toMatchObject({
      reason: 'Coin',
      winnerName: DEMO_TEAM_NAMES[7],
    });
  });

  it('recording a tie-break moves the match’s confirmedAt, as the real record_btc_tiebreak does', () => {
    const level = knockoutPayload({ results: { qf1: { tokensA: 30 } } });
    const decided = knockoutPayload({
      results: { qf1: { tokensA: 30, tiebreak: { winner: 7, reason: 'Coin' } } },
    });
    const at = (payload) => payload.recentResults.find((r) => r.matchId === 'qf1').confirmedAt;
    expect(at(decided)).not.toBe(at(level));
  });

  it('plays a whole knockout through to a decided podium', () => {
    const payload = knockoutPayload({
      results: {
        qf1: { tokensA: 40 },
        qf2: { tokensA: 40 },
        qf3: { tokensA: 40 },
        qf4: { tokensA: 40 },
        sf1: { tokensA: 35 },
        sf2: { tokensA: 35 },
        final: { tokensA: 33 },
        third: { tokensA: 33 },
      },
    });
    expect(payload.phase).toBe('complete');
    expect(payload.podium.complete).toBe(true);
    expect(payload.podium.places.map((place) => place.state)).toEqual([
      'decided',
      'decided',
      'decided',
    ]);
  });
});
