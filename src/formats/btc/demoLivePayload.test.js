import { describe, it, expect } from 'vitest';
import { DEMO_TEAM_NAMES, preliminaryPayload, knockoutPayload } from './demoLivePayload.js';

describe('demoLivePayload: the fixtures the preview page and the screen tests stand on', () => {
  it('is deterministic: the same call gives the same payload', () => {
    expect(preliminaryPayload({ playedCount: 9 })).toEqual(preliminaryPayload({ playedCount: 9 }));
    expect(knockoutPayload({ results: { qf1: { tokensA: 40 } } })).toEqual(
      knockoutPayload({ results: { qf1: { tokensA: 40 } } }),
    );
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
