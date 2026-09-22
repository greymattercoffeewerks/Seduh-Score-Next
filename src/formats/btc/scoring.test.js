import { describe, it, expect, vi, beforeEach } from 'vitest';

const cache = new Map();
vi.mock('../../core/db.js', () => ({
  cacheGet: vi.fn(async (key) => cache.get(key)),
  cacheSet: vi.fn(async (key, value) => {
    cache.set(key, value);
  }),
}));
const enqueueOperation = vi.fn(async () => {});
const flushOutbox = vi.fn(async () => ({ ok: true }));
const listPendingOperations = vi.fn(async () => []);
vi.mock('../../core/outbox.js', () => ({
  enqueueOperation: (...args) => enqueueOperation(...args),
  flushOutbox: (...args) => flushOutbox(...args),
  buildRpcHandler: (client, type) => ({ client, type }),
  listPendingOperations: (...args) => listPendingOperations(...args),
}));

const {
  cupsForRound,
  blankDraft,
  toggleVote,
  withVote,
  tokensForCup,
  missingVoteCount,
  isMatchComplete,
  firstMissingVote,
  computeScores,
  buildConfirmParams,
  loadDraft,
  saveDraft,
  clearDraft,
  loadConfirmedDraft,
  confirmHandlers,
  submitConfirmMatch,
  flushPending,
  wasOperationProcessed,
  isOperationQueued,
  describeConfirmError,
  roundLabel,
} = await import('./scoring.js');

const T1 = 'team-1';
const T2 = 'team-2';
const JUDGES = ['j1', 'j2', 'j3'];
const match = {
  id: 'm1',
  team1_id: T1,
  team2_id: T2,
  team1_time_note: null,
  team2_time_note: null,
};

// The same vote patterns supabase/tests/014_btc_scoring.sql builds: 'split' = judges 1
// and 2 vote team 1, judge 3 votes team 2 on every cup; 'all2' = every vote team 2.
function draftWith(cups, pattern) {
  let draft = blankDraft();
  for (let cup = 1; cup <= cups; cup += 1) {
    JUDGES.forEach((judgeId, index) => {
      const team = pattern === 'all2' || index === 2 ? T2 : T1;
      draft = withVote(draft, cup, judgeId, team);
    });
  }
  return draft;
}

beforeEach(() => {
  cache.clear();
  enqueueOperation.mockClear();
  flushOutbox.mockClear();
  listPendingOperations.mockClear();
});

describe('round configuration', () => {
  it('matches the SQL truth: 15 preliminary cups, 20 in every knockout round', () => {
    expect(cupsForRound('preliminary')).toBe(15);
    for (const round of ['quarterfinal', 'semifinal', 'final', 'third_place']) {
      expect(cupsForRound(round)).toBe(20);
    }
  });

  it('labels every round, falling back to the raw value', () => {
    expect(roundLabel('third_place')).toBe('Third place');
    expect(roundLabel('mystery')).toBe('mystery');
  });
});

describe('toggleVote', () => {
  it('cycles no vote -> team 1 -> team 2 -> no vote', () => {
    expect(toggleVote(undefined, T1, T2)).toBe(T1);
    expect(toggleVote(T1, T1, T2)).toBe(T2);
    expect(toggleVote(T2, T1, T2)).toBeNull();
    expect(toggleVote(null, T1, T2)).toBe(T1);
  });
});

describe('withVote', () => {
  it('sets a vote without mutating the original draft', () => {
    const before = blankDraft();
    const after = withVote(before, 3, 'j1', T1);
    expect(after.votes[3].j1).toBe(T1);
    expect(before.votes).toEqual({});
  });

  it('removes the cup entry entirely once its last vote is cleared', () => {
    const set = withVote(blankDraft(), 3, 'j1', T1);
    const cleared = withVote(set, 3, 'j1', null);
    expect(cleared.votes).toEqual({});
  });
});

describe('tokensForCup', () => {
  it('counts each team for one cup', () => {
    const draft = withVote(withVote(blankDraft(), 1, 'j1', T1), 1, 'j2', T2);
    expect(tokensForCup(draft, 1, match, JUDGES, 'preliminary')).toEqual({ team1: 1, team2: 1 });
    expect(tokensForCup(draft, 2, match, JUDGES, 'preliminary')).toEqual({ team1: 0, team2: 0 });
  });

  it('counts only votes that could be sent, exactly like the totals do', () => {
    let draft = withVote(blankDraft(), 1, 'j1', T1);
    draft = withVote(draft, 1, 'stranger', T1); // not a judge on this match
    draft = withVote(draft, 1, 'j2', 'some-other-team'); // not a participant
    expect(tokensForCup(draft, 1, match, JUDGES, 'preliminary')).toEqual({ team1: 1, team2: 0 });
    // the tally can never disagree with the totals panel
    expect(computeScores(draft, match, JUDGES, 'preliminary').team1Tokens).toBe(1);
    // a cup past the round is not counted
    const late = withVote(blankDraft(), 16, 'j1', T1);
    expect(tokensForCup(late, 16, match, JUDGES, 'preliminary')).toEqual({ team1: 0, team2: 0 });
  });
});

describe('completeness', () => {
  it('counts missing votes against cups x judges for the round', () => {
    expect(missingVoteCount(blankDraft(), match, JUDGES, 'preliminary')).toBe(45);
    expect(missingVoteCount(blankDraft(), match, JUDGES, 'final')).toBe(60);
    expect(missingVoteCount(draftWith(15, 'split'), match, JUDGES, 'preliminary')).toBe(0);
  });

  it('is complete only when every judge voted on every cup', () => {
    expect(isMatchComplete(draftWith(15, 'split'), match, JUDGES, 'preliminary')).toBe(true);
    expect(isMatchComplete(draftWith(14, 'split'), match, JUDGES, 'preliminary')).toBe(false);
  });

  it('is never complete without exactly 3 judges', () => {
    expect(isMatchComplete(draftWith(15, 'split'), match, ['j1', 'j2'], 'preliminary')).toBe(false);
  });

  it('ignores votes that could never be sent: a foreign judge, a foreign team, a cup past the round', () => {
    let draft = draftWith(15, 'split');
    draft = withVote(draft, 16, 'j1', T1); // past a preliminary round
    draft = withVote(draft, 1, 'stranger', T1); // not a judge on this match
    draft = withVote(draft, 2, 'j1', 'some-other-team'); // not a participant
    // cup 2 / j1 now points at a foreign team, so exactly that one vote is missing
    expect(missingVoteCount(draft, match, JUDGES, 'preliminary')).toBe(1);
  });
});

describe('firstMissingVote', () => {
  it('names the first empty cell in cup order, then judge order', () => {
    expect(firstMissingVote(blankDraft(), match, JUDGES, 'preliminary')).toEqual({
      cup: 1,
      judgeId: 'j1',
    });
    const draft = withVote(withVote(blankDraft(), 1, 'j1', T1), 1, 'j3', T1);
    expect(firstMissingVote(draft, match, JUDGES, 'preliminary')).toEqual({
      cup: 1,
      judgeId: 'j2',
    });
  });

  it('is null once every cell holds a valid vote', () => {
    expect(firstMissingVote(draftWith(15, 'split'), match, JUDGES, 'preliminary')).toBeNull();
  });

  it('does not count a vote for a foreign team as present', () => {
    const draft = withVote(draftWith(15, 'split'), 4, 'j2', 'some-other-team');
    expect(firstMissingVote(draft, match, JUDGES, 'preliminary')).toEqual({
      cup: 4,
      judgeId: 'j2',
    });
  });
});

// Fixture parity with supabase/tests/014_btc_scoring.sql — change one, change both.
describe('computeScores: pinned to the SQL btc_match_scores fixtures', () => {
  it('preliminary split, fastest team 1 => 37 / 15', () => {
    const draft = { ...draftWith(15, 'split'), fastest: 'team1' };
    expect(computeScores(draft, match, JUDGES, 'preliminary')).toEqual({
      team1Tokens: 30,
      team2Tokens: 15,
      team1Total: 37,
      team2Total: 15,
    });
  });

  it('final split, fastest team 2, signature-beverage for BOTH teams => 47 / 24', () => {
    const draft = {
      ...draftWith(20, 'split'),
      fastest: 'team2',
      signature: { team1: true, team2: true },
    };
    expect(computeScores(draft, match, JUDGES, 'final')).toEqual({
      team1Tokens: 40,
      team2Tokens: 20,
      team1Total: 47,
      team2Total: 24,
    });
  });

  it('a signature-beverage flag never counts in the preliminary round', () => {
    const draft = { ...draftWith(15, 'split'), signature: { team1: true, team2: true } };
    const scores = computeScores(draft, match, JUDGES, 'preliminary');
    expect(scores.team1Total).toBe(35); // 30 + 5, no +2
    expect(scores.team2Total).toBe(15);
  });

  it('a tie on tokens awards the round-winner bonus to nobody', () => {
    let draft = blankDraft();
    draft = withVote(draft, 1, 'j1', T1);
    draft = withVote(draft, 1, 'j2', T2);
    const scores = computeScores(draft, match, JUDGES, 'preliminary');
    expect(scores.team1Total).toBe(1);
    expect(scores.team2Total).toBe(1);
  });

  it('semifinal token tie, fastest team 1 => 32 / 30, no round-winner bonus', () => {
    // 014 'tie' pattern: cups 1-10 split 2-1 for team 1, cups 11-20 split 1-2.
    let draft = blankDraft();
    for (let cup = 1; cup <= 20; cup += 1) {
      JUDGES.forEach((judgeId, index) => {
        const team1Vote = cup <= 10 ? index !== 2 : index === 0;
        draft = withVote(draft, cup, judgeId, team1Vote ? T1 : T2);
      });
    }
    expect(computeScores({ ...draft, fastest: 'team1' }, match, JUDGES, 'semifinal')).toEqual({
      team1Tokens: 30,
      team2Tokens: 30,
      team1Total: 32,
      team2Total: 30,
    });
  });

  it('edited final: all votes team 2, fastest team 1, signature for team 1 ONLY => 4 / 65', () => {
    const draft = {
      ...draftWith(20, 'all2'),
      fastest: 'team1',
      signature: { team1: true, team2: false },
    };
    expect(computeScores(draft, match, JUDGES, 'final')).toEqual({
      team1Tokens: 0,
      team2Tokens: 60,
      team1Total: 4,
      team2Total: 65,
    });
  });

  it('all votes for team 2 => 45 tokens and the +5', () => {
    const scores = computeScores(draftWith(15, 'all2'), match, JUDGES, 'preliminary');
    expect(scores.team2Total).toBe(50);
    expect(scores.team1Total).toBe(0);
  });
});

describe('buildConfirmParams', () => {
  it('builds the RPC arguments, mapping fastest and signature, keeping raw time text', () => {
    const draft = {
      ...draftWith(20, 'split'),
      fastest: 'team2',
      signature: { team1: true, team2: false },
      times: { team1: ' 8:42 ', team2: ' 9:10 ' },
    };
    const params = buildConfirmParams(match, draft, JUDGES, 'final');
    expect(params.p_votes).toHaveLength(60);
    expect(params.p_votes[0]).toEqual({ cup_number: 1, judge_id: 'j1', team_id: T1 });
    expect(params.p_fastest_team_id).toBe(T2);
    expect(params.p_team1_signature).toBe(true);
    expect(params.p_team2_signature).toBe(false);
    expect(params.p_team1_time_note).toBe(' 8:42 ');
    expect(params.p_team2_time_note).toBe(' 9:10 ');
  });

  it('maps fastest team 1 to the first team and never to the second', () => {
    const draft = { ...draftWith(15, 'split'), fastest: 'team1' };
    expect(buildConfirmParams(match, draft, JUDGES, 'preliminary').p_fastest_team_id).toBe(T1);
  });

  it('omits unset votes rather than sending null, so the RPC can give its friendly missing-votes error', () => {
    const params = buildConfirmParams(match, draftWith(14, 'split'), JUDGES, 'preliminary');
    expect(params.p_votes).toHaveLength(42);
    expect(params.p_votes.every((vote) => vote.team_id)).toBe(true);
  });

  it('never sends signature-beverage for a preliminary match, whatever the draft holds', () => {
    const draft = { ...draftWith(15, 'split'), signature: { team1: true, team2: true } };
    const params = buildConfirmParams(match, draft, JUDGES, 'preliminary');
    expect(params.p_team1_signature).toBe(false);
    expect(params.p_team2_signature).toBe(false);
  });

  it('sends a null fastest team when nobody was marked', () => {
    expect(
      buildConfirmParams(match, blankDraft(), JUDGES, 'preliminary').p_fastest_team_id,
    ).toBeNull();
  });
});

describe('draft persistence', () => {
  it('returns null when nothing is stored, so "no edit in progress" is distinguishable', async () => {
    expect(await loadDraft('m1')).toBeNull();
  });

  it('round-trips a draft and normalises missing fields', async () => {
    await saveDraft('m1', withVote(blankDraft(), 1, 'j1', T1));
    const loaded = await loadDraft('m1');
    expect(loaded.votes[1].j1).toBe(T1);
    expect(loaded.signature).toEqual({ team1: false, team2: false });
    expect(loaded.times).toEqual({ team1: '', team2: '' });
    expect(loaded.confirmOpId).toBeNull();
  });

  it('keeps the confirm operation id and base version so a reload can resolve them', async () => {
    await saveDraft('m1', {
      ...withVote(blankDraft(), 1, 'j1', T1),
      baseUpdatedAt: 'T0',
      confirmOpId: 'op-1',
    });
    const loaded = await loadDraft('m1');
    expect(loaded.baseUpdatedAt).toBe('T0');
    expect(loaded.confirmOpId).toBe('op-1');
  });

  it('clearDraft leaves nothing to resurface', async () => {
    await saveDraft('m1', withVote(blankDraft(), 1, 'j1', T1));
    await clearDraft('m1');
    expect(await loadDraft('m1')).toBeNull();
  });
});

describe('loadConfirmedDraft', () => {
  function client({ votes, bonuses }) {
    return {
      from: (table) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: bonuses, error: null }),
          then: (resolve) => Promise.resolve({ data: votes, error: null }).then(resolve),
        };
        return table === 'btc_cup_votes' || table === 'btc_match_bonuses' ? builder : null;
      },
    };
  }

  it('rebuilds the draft shape from the recorded votes, bonuses and time notes', async () => {
    const draft = await loadConfirmedDraft(
      { ...match, team1_time_note: '8:42', team2_time_note: null },
      client({
        votes: [
          { cup_number: 1, judge_id: 'j1', team_id: T1 },
          { cup_number: 1, judge_id: 'j2', team_id: T2 },
        ],
        bonuses: {
          fastest_team_id: T2,
          team1_signature_beverage: true,
          team2_signature_beverage: false,
        },
      }),
    );
    expect(draft.votes[1]).toEqual({ j1: T1, j2: T2 });
    expect(draft.fastest).toBe('team2');
    expect(draft.signature).toEqual({ team1: true, team2: false });
    expect(draft.times).toEqual({ team1: '8:42', team2: '' });
  });

  it('copes with a match that has no bonuses row yet', async () => {
    const draft = await loadConfirmedDraft(match, client({ votes: [], bonuses: null }));
    expect(draft.fastest).toBeNull();
    expect(draft.signature).toEqual({ team1: false, team2: false });
  });

  it('carries the match version it was built from, as the base for the next confirm', async () => {
    const draft = await loadConfirmedDraft(
      { ...match, updated_at: 'T7' },
      client({ votes: [], bonuses: null }),
    );
    expect(draft.baseUpdatedAt).toBe('T7');
  });

  it('asks only for this match, both for votes and for bonuses', async () => {
    const eq = vi.fn();
    const spy = {
      from: () => {
        const builder = {
          select: () => builder,
          eq: (...args) => {
            eq(...args);
            return builder;
          },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    await loadConfirmedDraft(match, spy);
    expect(eq).toHaveBeenCalledTimes(2);
    expect(eq.mock.calls.every(([col, value]) => col === 'match_id' && value === 'm1')).toBe(true);
  });
});

describe('confirmHandlers', () => {
  it('registers exactly the confirm_btc_match operation type, bound to that RPC', () => {
    const handlers = confirmHandlers({ rpc: true });
    expect(Object.keys(handlers)).toEqual(['confirm_btc_match']);
    expect(handlers.confirm_btc_match).toEqual({
      client: { rpc: true },
      type: 'confirm_btc_match',
    });
  });
});

describe('submitConfirmMatch', () => {
  const params = () => buildConfirmParams(match, draftWith(15, 'split'), JUDGES, 'preliminary');

  it('enqueues ONE confirm_btc_match operation under the given operation id, then flushes', async () => {
    const handlers = { custom: true };
    const submitted = await submitConfirmMatch(
      match,
      'org1',
      '2026-09-22T00:00:00.123456+00:00',
      params(),
      {},
      handlers,
      'op-fixed',
    );

    expect(enqueueOperation).toHaveBeenCalledTimes(1);
    const [type, payload] = enqueueOperation.mock.calls[0];
    expect(type).toBe('confirm_btc_match');
    expect(payload.p_operation_id).toBe('op-fixed');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_match_id).toBe('m1');
    // The server timestamp is passed through as the raw string: converting it to a
    // JS Date would drop microseconds and make every optimistic-concurrency check fail.
    expect(payload.p_expected_updated_at).toBe('2026-09-22T00:00:00.123456+00:00');
    expect(payload.p_votes).toHaveLength(45);
    expect(flushOutbox).toHaveBeenCalledWith(handlers);
    expect(submitted).toEqual({ operationId: 'op-fixed', result: { ok: true } });
  });

  it('generates a fresh operation id per call when none is given, and returns it', async () => {
    const first = await submitConfirmMatch(match, 'org1', 't', params(), { rpc: true });
    const second = await submitConfirmMatch(match, 'org1', 't', params(), { rpc: true });
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.operationId).not.toBe(second.operationId);
    expect(enqueueOperation.mock.calls[0][1].p_operation_id).toBe(first.operationId);
    expect(flushOutbox.mock.calls[0][0]).toEqual(confirmHandlers({ rpc: true }));
  });

  it('enqueues BEFORE it flushes, so the operation survives a crash mid-flush', async () => {
    const order = [];
    enqueueOperation.mockImplementationOnce(async () => order.push('enqueue'));
    flushOutbox.mockImplementationOnce(async () => {
      order.push('flush');
      return {};
    });
    await submitConfirmMatch(match, 'org1', 't', params(), {}, {}, 'op-1');
    expect(order).toEqual(['enqueue', 'flush']);
  });
});

describe('flushPending', () => {
  it('flushes with the given handlers, or the confirm map by default', async () => {
    await flushPending({}, { custom: true });
    expect(flushOutbox).toHaveBeenLastCalledWith({ custom: true });
    await flushPending({ rpc: true });
    expect(flushOutbox).toHaveBeenLastCalledWith(confirmHandlers({ rpc: true }));
  });
});

describe('wasOperationProcessed', () => {
  function ledger(row, error = null) {
    const eq = vi.fn();
    const builder = {
      select: () => builder,
      eq: (...args) => {
        eq(...args);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: row, error }),
    };
    return { client: { from: vi.fn(() => builder) }, eq };
  }

  it('reads that exact operation id from processed_operations', async () => {
    const { client, eq } = ledger({ id: 'op-1' });
    expect(await wasOperationProcessed('op-1', client)).toBe(true);
    expect(client.from).toHaveBeenCalledWith('processed_operations');
    expect(eq).toHaveBeenCalledWith('id', 'op-1');
  });

  it('is false when the ledger has no such row', async () => {
    expect(await wasOperationProcessed('op-1', ledger(null).client)).toBe(false);
  });

  it('throws on a read error, so "cannot tell" is never mistaken for "did not happen"', async () => {
    await expect(
      wasOperationProcessed('op-1', ledger(null, new Error('offline')).client),
    ).rejects.toThrow('offline');
  });
});

describe('isOperationQueued', () => {
  it('finds an operation by the id in its payload, and only that one', async () => {
    listPendingOperations.mockResolvedValueOnce([
      { id: 'q1', type: 'confirm_btc_match', payload: { p_operation_id: 'op-1' } },
      { id: 'q2', type: 'other', payload: { p_operation_id: 'op-2' } },
    ]);
    expect(await isOperationQueued('op-2')).toBe(true);
    listPendingOperations.mockResolvedValueOnce([
      { id: 'q1', type: 'confirm_btc_match', payload: { p_operation_id: 'op-1' } },
    ]);
    expect(await isOperationQueued('op-9')).toBe(false);
  });
});

describe('describeConfirmError', () => {
  it('explains an optimistic-concurrency conflict', () => {
    expect(describeConfirmError({ code: 'P0002' })).toMatch(/changed elsewhere/);
  });

  it.each([
    ['confirm_btc_match: 3 of 45 judge votes are missing', '3 of 45 judge votes are missing'],
    [
      'confirm_btc_match: match must have exactly 3 judges (has 2)',
      'match must have exactly 3 judges (has 2)',
    ],
    [
      'confirm_btc_match: cup numbers must be between 1 and 15 for a preliminary match',
      'cup numbers must be between 1 and 15 for a preliminary match',
    ],
    [
      'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round',
      'the signature-beverage bonus does not apply in the preliminary round',
    ],
    ['confirm_btc_match: match not found', 'match not found'],
  ])("passes the RPC's own curated message through, without its prefix: %s", (raw, shown) => {
    expect(describeConfirmError({ code: 'P0001', message: raw })).toBe(
      `Could not confirm: ${shown}.`,
    );
  });

  it('does not leak an unrecognised P0001 message (a trigger naming columns, a UUID)', () => {
    const message = describeConfirmError({
      code: 'P0001',
      message: 'btc_match_bonuses.fastest_team_id must be a participant of the match',
    });
    expect(message).toBe('Could not confirm this match. Check the votes and try again.');
    expect(message).not.toMatch(/btc_match_bonuses|fastest_team_id/);
  });

  it('returns null for anything else so the generic describeError can handle it', () => {
    expect(describeConfirmError({ code: '42501' })).toBeNull();
    expect(describeConfirmError(new Error('boom'))).toBeNull();
    expect(describeConfirmError(undefined)).toBeNull();
  });
});
