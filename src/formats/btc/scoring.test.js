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
  withCupTokens,
  cupTokens,
  missingCupCount,
  isMatchComplete,
  firstMissingCup,
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
  JUDGES_PER_MATCH,
  TOKENS_PER_CUP,
} = await import('./scoring.js');

const T1 = 'team-1';
const T2 = 'team-2';
const match = {
  id: 'm1',
  team1_id: T1,
  team2_id: T2,
  team1_time_note: null,
  team2_time_note: null,
};

// The same per-cup patterns supabase/tests/014_btc_scoring.sql builds: 'split' gives
// 2 tokens to team1 every cup, 'all2' gives all 3 to team2, 'tie' gives 2 to team1 for
// the first 10 cups and 1 for the rest.
function draftWith(cups, pattern) {
  let draft = blankDraft();
  for (let cup = 1; cup <= cups; cup += 1) {
    const team1Tokens = pattern === 'all2' ? 0 : pattern === 'tie' ? (cup <= 10 ? 2 : 1) : 2; // 'split'
    draft = withCupTokens(draft, cup, team1Tokens);
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

  it('a cup always holds exactly 3 tokens; JUDGES_PER_MATCH is still 3, for the record only', () => {
    expect(TOKENS_PER_CUP).toBe(3);
    expect(JUDGES_PER_MATCH).toBe(3);
  });
});

describe('withCupTokens', () => {
  it('sets a cup without mutating the original draft', () => {
    const before = blankDraft();
    const after = withCupTokens(before, 3, 2);
    expect(after.votes[3]).toBe(2);
    expect(before.votes).toEqual({});
  });

  it('rejects anything outside 0-3 rather than silently clamping it', () => {
    expect(() => withCupTokens(blankDraft(), 1, 4)).toThrow(RangeError);
    expect(() => withCupTokens(blankDraft(), 1, -1)).toThrow(RangeError);
    expect(() => withCupTokens(blankDraft(), 1, 1.5)).toThrow(RangeError);
  });

  it('overwrites a previous value for the same cup (setting, not accumulating)', () => {
    let draft = withCupTokens(blankDraft(), 1, 2);
    draft = withCupTokens(draft, 1, 0);
    expect(draft.votes[1]).toBe(0);
  });
});

describe('cupTokens', () => {
  it('team2 is always the balance to 3', () => {
    const draft = withCupTokens(blankDraft(), 1, 2);
    expect(cupTokens(draft, 1, 'preliminary')).toEqual({ team1: 2, team2: 1 });
  });

  it('0 is a real, explicit score (all 3 tokens to team2) — not "unscored"', () => {
    const draft = withCupTokens(blankDraft(), 1, 0);
    expect(cupTokens(draft, 1, 'preliminary')).toEqual({ team1: 0, team2: 3 });
  });

  it('is null for a cup that has never been tapped', () => {
    expect(cupTokens(blankDraft(), 1, 'preliminary')).toBeNull();
  });

  it('is null for a cup past the round, even if a value happens to be stored', () => {
    const draft = withCupTokens(blankDraft(), 16, 2);
    expect(cupTokens(draft, 16, 'preliminary')).toBeNull();
  });
});

describe('completeness', () => {
  it('counts missing cups against the round total', () => {
    expect(missingCupCount(blankDraft(), 'preliminary')).toBe(15);
    expect(missingCupCount(blankDraft(), 'final')).toBe(20);
    expect(missingCupCount(draftWith(15, 'split'), 'preliminary')).toBe(0);
  });

  it('is complete only when every cup in the round has a score', () => {
    expect(isMatchComplete(draftWith(15, 'split'), 3, 'preliminary')).toBe(true);
    expect(isMatchComplete(draftWith(14, 'split'), 3, 'preliminary')).toBe(false);
  });

  it('is never complete without exactly 3 judges, even with every cup scored', () => {
    expect(isMatchComplete(draftWith(15, 'split'), 2, 'preliminary')).toBe(false);
  });

  it('ignores a cup past the round when counting completeness', () => {
    const draft = withCupTokens(draftWith(15, 'split'), 16, 1);
    expect(missingCupCount(draft, 'preliminary')).toBe(0);
  });
});

describe('firstMissingCup', () => {
  it('names the first unscored cup, in order', () => {
    expect(firstMissingCup(blankDraft(), 'preliminary')).toBe(1);
    const draft = withCupTokens(blankDraft(), 1, 2);
    expect(firstMissingCup(draft, 'preliminary')).toBe(2);
  });

  it('is null once every cup holds a score', () => {
    expect(firstMissingCup(draftWith(15, 'split'), 'preliminary')).toBeNull();
  });
});

// Fixture parity with supabase/tests/014_btc_scoring.sql — change one, change both.
describe('computeScores: pinned to the SQL btc_match_scores fixtures', () => {
  it('preliminary split, fastest team 1 => 37 / 15', () => {
    const draft = { ...draftWith(15, 'split'), fastest: 'team1' };
    expect(computeScores(draft, 'preliminary')).toEqual({
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
    expect(computeScores(draft, 'final')).toEqual({
      team1Tokens: 40,
      team2Tokens: 20,
      team1Total: 47,
      team2Total: 24,
    });
  });

  it('a signature-beverage flag never counts in the preliminary round', () => {
    const draft = { ...draftWith(15, 'split'), signature: { team1: true, team2: true } };
    const scores = computeScores(draft, 'preliminary');
    expect(scores.team1Total).toBe(35); // 30 + 5, no +2
    expect(scores.team2Total).toBe(15);
  });

  it('a tie on tokens awards the round-winner bonus to nobody', () => {
    // A single cup always sums to 3 (never a tie by itself); two cups split
    // oppositely (1-2, then 2-1) give 3 tokens each overall.
    let draft = blankDraft();
    draft = withCupTokens(draft, 1, 1);
    draft = withCupTokens(draft, 2, 2);
    const scores = computeScores(draft, 'preliminary');
    expect(scores.team1Total).toBe(3);
    expect(scores.team2Total).toBe(3);
  });

  it('semifinal token tie, fastest team 1 => 32 / 30, no round-winner bonus', () => {
    const draft = { ...draftWith(20, 'tie'), fastest: 'team1' };
    expect(computeScores(draft, 'semifinal')).toEqual({
      team1Tokens: 30,
      team2Tokens: 30,
      team1Total: 32,
      team2Total: 30,
    });
  });

  it('edited final: all tokens to team 2, fastest team 1, signature for team 1 ONLY => 4 / 65', () => {
    const draft = {
      ...draftWith(20, 'all2'),
      fastest: 'team1',
      signature: { team1: true, team2: false },
    };
    expect(computeScores(draft, 'final')).toEqual({
      team1Tokens: 0,
      team2Tokens: 60,
      team1Total: 4,
      team2Total: 65,
    });
  });

  it('all tokens for team 2 => 45 tokens and the +5', () => {
    const scores = computeScores(draftWith(15, 'all2'), 'preliminary');
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
    const params = buildConfirmParams(match, draft, 'final');
    expect(params.p_votes).toHaveLength(20);
    expect(params.p_votes[0]).toEqual({ cup_number: 1, team1_tokens: 2 });
    expect(params.p_fastest_team_id).toBe(T2);
    expect(params.p_team1_signature).toBe(true);
    expect(params.p_team2_signature).toBe(false);
    expect(params.p_team1_time_note).toBe(' 8:42 ');
    expect(params.p_team2_time_note).toBe(' 9:10 ');
  });

  it('omits unscored cups rather than sending a placeholder, so the RPC can give its friendly missing-cups error', () => {
    let draft = draftWith(15, 'split');
    draft = { ...draft, votes: Object.fromEntries(Object.entries(draft.votes).slice(0, 14)) };
    const params = buildConfirmParams(match, draft, 'preliminary');
    expect(params.p_votes).toHaveLength(14);
  });

  it('never sends signature-beverage for a preliminary match, whatever the draft holds', () => {
    const draft = { ...draftWith(15, 'split'), signature: { team1: true, team2: true } };
    const params = buildConfirmParams(match, draft, 'preliminary');
    expect(params.p_team1_signature).toBe(false);
    expect(params.p_team2_signature).toBe(false);
  });

  it('sends a null fastest team when nobody was marked', () => {
    expect(buildConfirmParams(match, blankDraft(), 'preliminary').p_fastest_team_id).toBeNull();
  });

  it('maps fastest team 1 to the first team and never to the second', () => {
    const draft = { ...draftWith(15, 'split'), fastest: 'team1' };
    expect(buildConfirmParams(match, draft, 'preliminary').p_fastest_team_id).toBe(T1);
  });
});

describe('draft persistence', () => {
  it('returns null when nothing is stored, so "no edit in progress" is distinguishable', async () => {
    expect(await loadDraft('m1')).toBeNull();
  });

  it('round-trips a draft and normalises missing fields', async () => {
    await saveDraft('m1', withCupTokens(blankDraft(), 1, 2));
    const loaded = await loadDraft('m1');
    expect(loaded.votes[1]).toBe(2);
    expect(loaded.signature).toEqual({ team1: false, team2: false });
    expect(loaded.times).toEqual({ team1: '', team2: '' });
    expect(loaded.confirmOpId).toBeNull();
  });

  it('keeps the confirm operation id and base version so a reload can resolve them', async () => {
    await saveDraft('m1', {
      ...withCupTokens(blankDraft(), 1, 2),
      baseUpdatedAt: 'T0',
      confirmOpId: 'op-1',
    });
    const loaded = await loadDraft('m1');
    expect(loaded.baseUpdatedAt).toBe('T0');
    expect(loaded.confirmOpId).toBe('op-1');
  });

  it('clearDraft leaves nothing to resurface', async () => {
    await saveDraft('m1', withCupTokens(blankDraft(), 1, 2));
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

  it('rebuilds the draft shape from the recorded cup scores, bonuses and time notes', async () => {
    const draft = await loadConfirmedDraft(
      { ...match, team1_time_note: '8:42', team2_time_note: null },
      client({
        votes: [
          { cup_number: 1, team1_tokens: 2 },
          { cup_number: 2, team1_tokens: 0 },
        ],
        bonuses: {
          fastest_team_id: T2,
          team1_signature_beverage: true,
          team2_signature_beverage: false,
        },
      }),
    );
    expect(draft.votes[1]).toBe(2);
    expect(draft.votes[2]).toBe(0);
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
  const params = () => buildConfirmParams(match, draftWith(15, 'split'), 'preliminary');

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
    expect(payload.p_votes).toHaveLength(15);
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
    ['confirm_btc_match: 3 of 15 cups are missing a score', '3 of 15 cups are missing a score'],
    [
      'confirm_btc_match: match must have exactly 3 judges (has 2)',
      'match must have exactly 3 judges (has 2)',
    ],
    [
      'confirm_btc_match: cup numbers must be between 1 and 15 for a preliminary match',
      'cup numbers must be between 1 and 15 for a preliminary match',
    ],
    [
      "confirm_btc_match: each cup's tokens must be between 0 and 3",
      "each cup's tokens must be between 0 and 3",
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
