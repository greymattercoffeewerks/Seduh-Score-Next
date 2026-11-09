import { describe, expect, it } from 'vitest';
import { assignJudges, drawRound1 } from './draw.js';
import { buildRoundMatches, createRound, describeRoundError, roundRefusal } from './rounds.js';

const recordingClient = (result = { data: [], error: null }) => {
  const calls = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve(result);
    },
  };
};

describe('buildRoundMatches', () => {
  it('turns pairs and judge assignments into the RPC payload, in match order', () => {
    const matches = buildRoundMatches(
      [
        { team1Id: 'a', team2Id: 'b' },
        { team1Id: 'c', team2Id: 'd' },
      ],
      [
        { matchIndex: 1, judgeIds: ['j4', 'j5', 'j6'] },
        { matchIndex: 0, judgeIds: ['j1', 'j2', 'j3'] },
      ],
    );
    expect(matches).toEqual([
      { team1_id: 'a', team2_id: 'b', judge_ids: ['j1', 'j2', 'j3'] },
      { team1_id: 'c', team2_id: 'd', judge_ids: ['j4', 'j5', 'j6'] },
    ]);
  });

  it('composes with the real draw and judge assignment', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const { pairs } = drawRound1({ teamIds: ids, seed: 's' });
    const judges = Array.from({ length: 6 }, (_, i) => ({ id: `j${i}` }));
    const { assignments } = assignJudges({ pairs, judges });
    const matches = buildRoundMatches(pairs, assignments);
    expect(matches).toHaveLength(10);
    for (const m of matches) expect(new Set(m.judge_ids).size).toBe(3);
  });

  it('refuses a missing judge list', () => {
    expect(() => buildRoundMatches([{ team1Id: 'a', team2Id: 'b' }], [])).toThrow();
    expect(() =>
      buildRoundMatches([{ team1Id: 'a', team2Id: 'b' }], [{ matchIndex: 3, judgeIds: [] }]),
    ).toThrow(/no judges/);
  });
});

describe('createRound', () => {
  it('calls create_btc_round with the expected arguments', async () => {
    const client = recordingClient({ data: [{ id: 'm1' }], error: null });
    const matches = [{ team1_id: 'a', team2_id: 'b', judge_ids: ['x', 'y', 'z'] }];
    const out = await createRound(
      { orgId: 'o', eventId: 'e', prelimRound: 2, mode: 'by_results', seed: 'abc', matches },
      client,
    );
    expect(out).toEqual([{ id: 'm1' }]);
    expect(client.calls).toEqual([
      [
        'create_btc_round',
        {
          p_org_id: 'o',
          p_event_id: 'e',
          p_prelim_round: 2,
          p_mode: 'by_results',
          p_seed: 'abc',
          p_matches: matches,
          p_avoid_rematches: true,
        },
      ],
    ]);
  });

  it('sends no seed for a manual draw, and passes the avoid setting through', async () => {
    const client = recordingClient();
    await createRound(
      {
        orgId: 'o',
        eventId: 'e',
        prelimRound: 1,
        mode: 'manual',
        seed: 'ignored',
        matches: [],
        avoidRematches: false,
      },
      client,
    );
    expect(client.calls[0][1]).toMatchObject({ p_seed: null, p_avoid_rematches: false });
  });

  it('throws the raw RPC error rather than swallowing it', async () => {
    const error = { code: 'P0001', hint: 'btc_round_exists', message: 'x' };
    const client = recordingClient({ data: null, error });
    await expect(
      createRound(
        { orgId: 'o', eventId: 'e', prelimRound: 1, mode: 'random', seed: 's', matches: [] },
        client,
      ),
    ).rejects.toBe(error);
  });
});

describe('roundRefusal and describeRoundError', () => {
  it('keys on the hint, never on the message', () => {
    expect(
      roundRefusal({ hint: 'btc_round_exists', message: 'something else entirely' }),
    ).toMatchObject({
      alreadyCreated: true,
      reload: true,
    });
    expect(roundRefusal({ hint: 'btc_prior_round_open' })?.message).toMatch(/earlier round/);
    expect(
      roundRefusal({ message: 'create_btc_round: round 1 has already been drawn' }),
    ).toBeNull();
    expect(roundRefusal(null)).toBeNull();
  });

  it('has words for every hint the database raises', () => {
    for (const hint of [
      'btc_round_event_not_found',
      'btc_round_exists',
      'btc_prior_round_open',
      'btc_round_bracket_exists',
      'btc_round_incomplete',
      'btc_round_matches_invalid',
      'btc_round_seed_mode',
      'btc_round_invalid',
    ]) {
      expect(roundRefusal({ hint })?.message).toBeTruthy();
    }
  });

  it('falls back to the generic message for anything else', () => {
    expect(describeRoundError({ code: '08006', message: 'connection' })).toMatch(/try again/);
  });
});
