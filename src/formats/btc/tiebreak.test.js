import { describe, it, expect } from 'vitest';
import {
  TIEBREAK_REASON_MAX,
  recordedWinnerId,
  tieState,
  validateTiebreak,
  recordTiebreak,
  tiebreakRefusal,
  describeTiebreakError,
} from './tiebreak.js';

const confirmed = (extra = {}) => ({ id: 'm1', status: 'confirmed', ...extra });
const score = (team1_total, team2_total, status = 'confirmed') => ({
  match_id: 'm1',
  status,
  team1_id: 'a',
  team2_id: 'b',
  team1_total,
  team2_total,
});

describe('tieState', () => {
  it('is "tied" for a confirmed match that is level with nothing recorded', () => {
    expect(tieState(confirmed(), score(30, 30))).toBe('tied');
  });

  it('is "decided" once a winner has been recorded on a level match', () => {
    expect(tieState(confirmed({ tiebreak_winner_team_id: 'a' }), score(30, 30))).toBe('decided');
    expect(tieState(confirmed({ tiebreak_winner_team_id: 'b' }), score(30, 30))).toBe('decided');
  });

  it('stays "tied" if the recorded winner is not one of the two teams (the card and the podium share one rule)', () => {
    expect(tieState(confirmed({ tiebreak_winner_team_id: 'zzz' }), score(30, 30))).toBe('tied');
  });

  it('is null for a decisive result, even if a stale tie-break is still on the row', () => {
    expect(tieState(confirmed(), score(40, 30))).toBeNull();
    expect(tieState(confirmed({ tiebreak_winner_team_id: 'a' }), score(40, 30))).toBeNull();
  });

  it('is null for anything not confirmed: an unplayed match reads 0-0 in the view and must not look tied', () => {
    expect(tieState({ id: 'm1', status: 'pending' }, score(0, 0))).toBeNull();
    expect(tieState({ id: 'm1', status: 'scoring' }, score(0, 0))).toBeNull();
    expect(tieState(confirmed(), score(0, 0, 'scoring'))).toBeNull();
  });

  it('is null when there is no match or no score row yet', () => {
    expect(tieState(null, score(1, 1))).toBeNull();
    expect(tieState(confirmed(), undefined)).toBeNull();
  });

  it('compares totals as numbers, not strings', () => {
    expect(tieState(confirmed(), score('9', '10'))).toBeNull();
    expect(tieState(confirmed(), score('30', 30))).toBe('tied');
  });
});

describe('recordedWinnerId', () => {
  it('returns the recorded team only on a confirmed, level match where it is one of the two teams', () => {
    expect(recordedWinnerId(confirmed({ tiebreak_winner_team_id: 'b' }), score(30, 30))).toBe('b');
    expect(
      recordedWinnerId(confirmed({ tiebreak_winner_team_id: 'zzz' }), score(30, 30)),
    ).toBeNull();
    expect(recordedWinnerId(confirmed({ tiebreak_winner_team_id: 'a' }), score(31, 30))).toBeNull();
    expect(recordedWinnerId(confirmed(), score(30, 30))).toBeNull();
  });

  it('ignores a recorded winner on a match that is not confirmed', () => {
    expect(
      recordedWinnerId(
        { id: 'm1', status: 'scoring', tiebreak_winner_team_id: 'a' },
        score(30, 30),
      ),
    ).toBeNull();
    expect(
      recordedWinnerId(confirmed({ tiebreak_winner_team_id: 'a' }), score(30, 30, 'scoring')),
    ).toBeNull();
  });
});

describe('validateTiebreak', () => {
  const teamIds = ['a', 'b'];

  it('accepts one of the two teams with a reason', () => {
    expect(validateTiebreak({ winnerTeamId: 'a', reason: 'Sudden-death cup', teamIds })).toBeNull();
  });

  it("requires a winner, and that it is one of the match's own teams, and says the problem is with the winner", () => {
    const none = validateTiebreak({ winnerTeamId: null, reason: 'x', teamIds });
    expect(none.field).toBe('winner');
    expect(none.message).toMatch(/which team/i);
    expect(validateTiebreak({ winnerTeamId: 'zzz', reason: 'x', teamIds }).field).toBe('winner');
  });

  it('requires a reason that is not just whitespace, and says the problem is with the reason', () => {
    for (const reason of ['', '   ', '\t\n']) {
      const result = validateTiebreak({ winnerTeamId: 'a', reason, teamIds });
      expect(result.field).toBe('reason');
      expect(result.message).toMatch(/reason/i);
    }
  });

  it('allows exactly the maximum and rejects one more, measured after trimming', () => {
    const max = 'r'.repeat(TIEBREAK_REASON_MAX);
    expect(validateTiebreak({ winnerTeamId: 'a', reason: `  ${max}  `, teamIds })).toBeNull();
    const over = validateTiebreak({ winnerTeamId: 'a', reason: `${max}r`, teamIds });
    expect(over.field).toBe('reason');
    expect(over.message).toMatch(String(TIEBREAK_REASON_MAX));
  });

  it('reports the winner problem first when both are wrong', () => {
    expect(validateTiebreak({ winnerTeamId: null, reason: '', teamIds }).field).toBe('winner');
  });
});

describe('recordTiebreak', () => {
  it('calls record_btc_tiebreak with the expected args and a trimmed reason', async () => {
    const calls = [];
    const client = {
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    await recordTiebreak('org1', 'm1', 'a', '  Casting vote  ', client);
    expect(calls).toEqual([
      [
        'record_btc_tiebreak',
        { p_org_id: 'org1', p_match_id: 'm1', p_winner_team_id: 'a', p_reason: 'Casting vote' },
      ],
    ]);
  });

  it('throws the raw RPC error rather than swallowing it', async () => {
    const error = { code: 'P0001', message: 'record_btc_tiebreak: this match is not tied' };
    const client = { rpc: () => Promise.resolve({ data: null, error }) };
    await expect(recordTiebreak('org1', 'm1', 'a', 'x', client)).rejects.toBe(error);
  });
});

describe('describeTiebreakError / tiebreakRefusal', () => {
  it('explains the refusal when the next-round match already exists, keyed on the hint, and does not ask for a reload', () => {
    const err = { code: 'P0001', hint: 'bracket_advanced', message: 'anything at all' };
    expect(describeTiebreakError(err)).toMatch(/next-round match has already been created/i);
    expect(tiebreakRefusal(err).reload).toBe(false);
  });

  it('explains each refusal that means the screen is stale, and marks it for a reload', () => {
    const cases = {
      tiebreak_not_tied: /no longer tied/i,
      tiebreak_unconfirmed: /not been confirmed/i,
      tiebreak_match_not_found: /could not be found/i,
    };
    for (const [hint, pattern] of Object.entries(cases)) {
      const err = { code: 'P0001', hint, message: 'x' };
      expect(describeTiebreakError(err)).toMatch(pattern);
      expect(tiebreakRefusal(err).reload).toBe(true);
    }
  });

  it('does NOT depend on the wording: the old message text without a hint is just a generic failure', () => {
    const err = {
      code: 'P0001',
      message: "confirm_btc_match: this match's winner has already advanced to a match in progress",
    };
    expect(tiebreakRefusal(err)).toBeNull();
    expect(describeTiebreakError(err)).toMatch(/something went wrong/i);
  });

  it("falls back to the generic message for an unknown hint or raw failure, and keeps a plain Error's own text", () => {
    expect(describeTiebreakError({ code: 'P0001', hint: 'something_new', message: 'x' })).toMatch(
      /something went wrong/i,
    );
    expect(describeTiebreakError({ code: '500', message: 'boom' })).toMatch(
      /something went wrong/i,
    );
    expect(describeTiebreakError(new Error('Own message.'))).toBe('Own message.');
    expect(tiebreakRefusal(undefined)).toBeNull();
  });
});
