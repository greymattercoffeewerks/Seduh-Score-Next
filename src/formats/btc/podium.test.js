import { describe, it, expect } from 'vitest';
import { derivePodium } from './podium.js';

const teams = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
  { id: 'd', name: 'Delta' },
];

const slot = (round, match_id, match = null) => ({
  slot: { round, match_id },
  match: match && { status: 'confirmed', ...match },
});
const score = (match_id, team1_id, team2_id, team1_total, team2_total, status = 'confirmed') => ({
  match_id,
  status,
  team1_id,
  team2_id,
  team1_total,
  team2_total,
});

describe('derivePodium', () => {
  it('has no places when there is no final slot (bracket not generated)', () => {
    expect(derivePodium({ entries: [], scores: [], teams })).toEqual({
      places: [],
      complete: false,
    });
  });

  it('is all pending while the final has no match or no confirmed result', () => {
    const noMatch = derivePodium({
      entries: [slot('final', null), slot('third_place', null)],
      scores: [],
      teams,
    });
    expect(noMatch.places.map((p) => p.state)).toEqual(['pending', 'pending', 'pending']);
    expect(noMatch.complete).toBe(false);

    // A score row whose match is not confirmed yet must not count as a result.
    const inProgress = derivePodium({
      entries: [slot('final', 'mf'), slot('third_place', 'mt')],
      scores: [score('mf', 'a', 'b', 90, 10, 'scoring')],
      teams,
    });
    expect(inProgress.places.map((p) => p.state)).toEqual(['pending', 'pending', 'pending']);
  });

  it('reads the winner from the totals, whichever side they sit on', () => {
    const entries = [slot('final', 'mf'), slot('third_place', 'mt')];
    const team1Wins = derivePodium({
      entries,
      scores: [score('mf', 'a', 'b', 60, 40), score('mt', 'c', 'd', 30, 70)],
      teams,
    });
    expect(team1Wins.places.map((p) => [p.key, p.teamName])).toEqual([
      ['champion', 'Alpha'],
      ['runnerUp', 'Beta'],
      ['third', 'Delta'],
    ]);
    const team2Wins = derivePodium({
      entries,
      scores: [score('mf', 'a', 'b', 40, 60), score('mt', 'c', 'd', 70, 30)],
      teams,
    });
    expect(team2Wins.places.map((p) => [p.key, p.teamName])).toEqual([
      ['champion', 'Beta'],
      ['runnerUp', 'Alpha'],
      ['third', 'Gamma'],
    ]);
    expect(team2Wins.complete).toBe(true);
  });

  it('never names a winner for a tied match, and a tied final taints both its places', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf'), slot('third_place', 'mt')],
      scores: [score('mf', 'a', 'b', 50, 50), score('mt', 'c', 'd', 70, 30)],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['tied', 'tied', 'decided']);
    expect(result.places[0].teamName).toBeUndefined();
    expect(result.places[1].teamName).toBeUndefined();
    expect(result.complete).toBe(false);
  });

  it('shows a tied third place as tied while the final is decided, and is not complete', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf'), slot('third_place', 'mt')],
      scores: [score('mf', 'a', 'b', 60, 40), score('mt', 'c', 'd', 50, 50)],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['decided', 'decided', 'tied']);
    expect(result.complete).toBe(false);
  });

  it('applies the confirmed gate to third place too, and is not complete while it is pending', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf'), slot('third_place', 'mt')],
      scores: [score('mf', 'a', 'b', 60, 40), score('mt', 'c', 'd', 90, 10, 'scoring')],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['decided', 'decided', 'pending']);
    expect(result.complete).toBe(false);
  });

  it('compares numeric totals even if they arrive as strings', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf')],
      scores: [score('mf', 'a', 'b', '9', '10')],
      teams,
    });
    // As strings, '9' > '10' lexicographically; the winner must be b (10 > 9).
    expect(result.places[0].teamName).toBe('Beta');
  });

  it('falls back to a neutral name for a team missing from the roster', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf')],
      scores: [score('mf', 'ghost', 'b', 60, 40)],
      teams,
    });
    expect(result.places[0]).toMatchObject({ state: 'decided', teamName: 'Unknown team' });
  });

  it('does not mutate its inputs', () => {
    const entries = [slot('final', 'mf'), slot('third_place', 'mt')];
    const scores = [score('mf', 'a', 'b', 60, 40), score('mt', 'c', 'd', 30, 70)];
    const snapshot = structuredClone({ entries, scores, teams });
    derivePodium({ entries, scores, teams });
    expect({ entries, scores, teams }).toEqual(snapshot);
  });

  it('keeps the third-place result independent of an undecided final', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf'), slot('third_place', 'mt')],
      scores: [score('mt', 'c', 'd', 70, 30)],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['pending', 'pending', 'decided']);
  });

  it('has two places when the bracket has no third-place slot (final-only shape)', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf')],
      scores: [score('mf', 'a', 'b', 60, 40)],
      teams,
    });
    expect(result.places.map((p) => p.key)).toEqual(['champion', 'runnerUp']);
    expect(result.complete).toBe(true);
  });

  it('ignores earlier rounds entirely', () => {
    const result = derivePodium({
      entries: [slot('quarterfinal', 'mq'), slot('final', 'mf')],
      scores: [score('mq', 'c', 'd', 99, 1)],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['pending', 'pending']);
  });
});

describe('derivePodium with a recorded tie-break', () => {
  it("lets the organiser's recorded winner decide a level final, and says so", () => {
    const result = derivePodium({
      entries: [slot('final', 'mf', { tiebreak_winner_team_id: 'b' })],
      scores: [score('mf', 'a', 'b', 50, 50)],
      teams,
    });
    expect(result.places.map((p) => [p.key, p.state, p.teamName, p.viaTiebreak])).toEqual([
      ['champion', 'decided', 'Beta', true],
      ['runnerUp', 'decided', 'Alpha', true],
    ]);
    expect(result.complete).toBe(true);
  });

  it('works whichever side the recorded winner sits on, and for third place', () => {
    const result = derivePodium({
      entries: [
        slot('final', 'mf', { tiebreak_winner_team_id: 'a' }),
        slot('third_place', 'mt', { tiebreak_winner_team_id: 'd' }),
      ],
      scores: [score('mf', 'a', 'b', 50, 50), score('mt', 'c', 'd', 20, 20)],
      teams,
    });
    expect(result.places.map((p) => [p.key, p.teamName])).toEqual([
      ['champion', 'Alpha'],
      ['runnerUp', 'Beta'],
      ['third', 'Delta'],
    ]);
  });

  it('ignores a recorded winner when the totals are decisive (a stale decision never overrides the score)', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf', { tiebreak_winner_team_id: 'b' })],
      scores: [score('mf', 'a', 'b', 60, 40)],
      teams,
    });
    expect(result.places[0]).toMatchObject({ teamName: 'Alpha', viaTiebreak: false });
  });

  it('does not trust a recorded winner who is not one of the two teams: the match stays tied', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf', { tiebreak_winner_team_id: 'zzz' })],
      scores: [score('mf', 'a', 'b', 50, 50)],
      teams,
    });
    expect(result.places.map((p) => p.state)).toEqual(['tied', 'tied']);
  });

  it('marks a place decided by the totals as not decided by a tie-break', () => {
    const result = derivePodium({
      entries: [slot('final', 'mf')],
      scores: [score('mf', 'a', 'b', 60, 40)],
      teams,
    });
    expect(result.places.every((p) => p.viaTiebreak === false)).toBe(true);
  });
});
