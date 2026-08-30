import { describe, it, expect, beforeEach } from 'vitest';
import {
  toggleScore,
  computeTally,
  isEntryComplete,
  isHeatComplete,
  markCupperRemainingWrong,
  loadDraft,
  saveDraft,
  clearDraft,
  loadConfirmedResults,
  buildConfirmEntries,
  submitConfirmHeat,
  describeConfirmError,
} from './scoring.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

describe('toggleScore', () => {
  it('cycles unscored -> correct -> wrong -> unscored, recoverable within three taps', () => {
    expect(toggleScore(null)).toBe(true);
    expect(toggleScore(true)).toBe(false);
    expect(toggleScore(false)).toBe(null);
  });

  it('treats undefined the same as null — an entry never yet touched starts the same cycle', () => {
    expect(toggleScore(undefined)).toBe(true);
  });
});

describe('computeTally', () => {
  it('counts correct out of the full set count, not just however many are scored so far', () => {
    const results = { s1: true, s2: false, s3: null };
    expect(computeTally(results, ['s1', 's2', 's3', 's4'])).toEqual({ correct: 1, total: 4 });
  });

  it('reads a missing results object as no scores at all, not a crash', () => {
    expect(computeTally(undefined, ['s1', 's2'])).toEqual({ correct: 0, total: 2 });
  });
});

describe('isEntryComplete / isHeatComplete', () => {
  const setIds = ['s1', 's2'];

  it('an entry is complete only once every set has ✓ or ✗, not merely one', () => {
    expect(isEntryComplete({ s1: true }, setIds)).toBe(false);
    expect(isEntryComplete({ s1: true, s2: false }, setIds)).toBe(true);
  });

  it('null still counts as incomplete, distinct from an explicit false', () => {
    expect(isEntryComplete({ s1: true, s2: null }, setIds)).toBe(false);
  });

  it('a heat is complete only when every entry is complete', () => {
    const draft = {
      e1: { s1: true, s2: false },
      e2: { s1: true, s2: false },
    };
    expect(isHeatComplete(['e1', 'e2'], draft, setIds)).toBe(true);
  });

  it('one unscored set on one cupper blocks the whole heat — the exact defect the old .some() guard let through', () => {
    const draft = {
      e1: { s1: true, s2: false },
      e2: { s1: true, s2: null },
    };
    expect(isHeatComplete(['e1', 'e2'], draft, setIds)).toBe(false);
  });

  it('a heat with zero entries is never vacuously complete', () => {
    expect(isHeatComplete([], {}, setIds)).toBe(false);
  });
});

describe('markCupperRemainingWrong', () => {
  it('fills every still-unscored set to false, per D21', () => {
    const result = markCupperRemainingWrong({ s1: true }, ['s1', 's2', 's3']);
    expect(result).toEqual({ s1: true, s2: false, s3: false });
  });

  it('never overwrites an already-scored set, correct or wrong', () => {
    const result = markCupperRemainingWrong({ s1: true, s2: false }, ['s1', 's2', 's3']);
    expect(result.s1).toBe(true);
    expect(result.s2).toBe(false);
  });

  it('does not mutate the input object', () => {
    const input = { s1: true };
    markCupperRemainingWrong(input, ['s1', 's2']);
    expect(input).toEqual({ s1: true });
  });
});

describe('draft persistence (real IndexedDB round-trip)', () => {
  it('returns an empty object, not null, for a heat with no draft yet', async () => {
    expect(await loadDraft('h1')).toEqual({});
  });

  it('round-trips a saved draft', async () => {
    await saveDraft('h1', { e1: { s1: true } });
    expect(await loadDraft('h1')).toEqual({ e1: { s1: true } });
  });

  it('keeps different heats independent', async () => {
    await saveDraft('h1', { e1: { s1: true } });
    await saveDraft('h2', { e2: { s1: false } });
    expect(await loadDraft('h1')).toEqual({ e1: { s1: true } });
    expect(await loadDraft('h2')).toEqual({ e2: { s1: false } });
  });

  it('clearDraft resets a heat back to empty, not leaving stale scored data behind', async () => {
    await saveDraft('h1', { e1: { s1: true } });
    await clearDraft('h1');
    expect(await loadDraft('h1')).toEqual({});
  });
});

describe('loadConfirmedResults', () => {
  it('maps ct_results rows back to entry_id, using the already-loaded heat entries to bridge heat_entry_id', async () => {
    const heatEntries = [
      { id: 'he1', entry_id: 'e1' },
      { id: 'he2', entry_id: 'e2' },
    ];
    const client = {
      from: () => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                { heat_entry_id: 'he1', set_id: 's1', correct: true },
                { heat_entry_id: 'he1', set_id: 's2', correct: false },
                { heat_entry_id: 'he2', set_id: 's1', correct: false },
              ],
              error: null,
            }),
        }),
      }),
    };
    const result = await loadConfirmedResults(heatEntries, client);
    expect(result).toEqual({
      e1: { s1: true, s2: false },
      e2: { s1: false },
    });
  });

  it('returns an empty object for a heat with no entries, without querying at all', async () => {
    const client = { from: () => throwIfCalled() };
    function throwIfCalled() {
      throw new Error('should never query with zero heat entries');
    }
    expect(await loadConfirmedResults([], client)).toEqual({});
  });

  it('propagates a query error rather than silently returning an empty result', async () => {
    const client = {
      from: () => ({
        select: () => ({ in: () => Promise.resolve({ data: null, error: new Error('boom') }) }),
      }),
    };
    await expect(loadConfirmedResults([{ id: 'he1', entry_id: 'e1' }], client)).rejects.toThrow(
      'boom',
    );
  });
});

describe('buildConfirmEntries', () => {
  // `id` (the ct_heat_entries row's own pk) and `entry_id` (the roster
  // person's id) are deliberately DIFFERENT values in every fixture below
  // — a real hydrated entry always has both, and they're never equal in
  // practice. A fixture using the same string for both (as this file used
  // to) can't distinguish "sent the right field" from "sent the wrong
  // one", which is exactly how the live entry_id/id mix-up bug (confirm_heat
  // matches ct_heat_entries.id, not the person's entry_id — see
  // buildConfirmEntries' own comment) went uncaught here.
  it('shapes each entry exactly as confirm_heat expects, passing elapsed_secs through unchanged', () => {
    const hydrated = [
      {
        id: 'he1',
        entry_id: 'e1',
        elapsed_secs: 125,
        elapsed_secs_raw: 125,
        maxed: false,
        time_source: 'tapped',
      },
    ];
    const draft = { e1: { s1: true, s2: false } };
    const result = buildConfirmEntries(hydrated, draft, ['s1', 's2']);
    expect(result).toEqual([
      {
        entry_id: 'he1',
        elapsed_secs: 125,
        elapsed_secs_raw: 125,
        maxed: false,
        time_source: 'tapped',
        results: [
          { set_id: 's1', correct: true },
          { set_id: 's2', correct: false },
        ],
      },
    ]);
  });

  it('an entry with no draft at all produces an empty results array — never an explicit null', () => {
    const hydrated = [
      {
        id: 'he1',
        entry_id: 'e1',
        elapsed_secs: 480,
        elapsed_secs_raw: 480,
        maxed: true,
        time_source: 'maxed',
      },
    ];
    const result = buildConfirmEntries(hydrated, {}, ['s1', 's2']);
    // Not [{set_id, correct: null}, ...] — ct_results.correct is `not
    // null`, and confirm_heat's insert loop runs BEFORE its own row-count
    // strict-confirm check, so an explicit null would trip a raw NOT NULL
    // violation instead of the friendly "N cupper(s) do not have every set
    // scored" error the RPC is documented to produce. Omitting unscored
    // sets means an incomplete payload is short on rows instead, which the
    // row-count check catches exactly as designed.
    expect(result[0].results).toEqual([]);
  });

  it('a partially-scored entry omits only the still-unscored sets, keeping the scored ones', () => {
    const hydrated = [
      {
        id: 'he1',
        entry_id: 'e1',
        elapsed_secs: 100,
        elapsed_secs_raw: 100,
        maxed: false,
        time_source: 'tapped',
      },
    ];
    const draft = { e1: { s1: true } };
    const result = buildConfirmEntries(hydrated, draft, ['s1', 's2', 's3']);
    expect(result[0].results).toEqual([{ set_id: 's1', correct: true }]);
  });

  it('sends the heat entry\'s own id, not the roster person\'s entry_id, as the RPC entry_id field', () => {
    // The regression this fixture exists to catch: confirm_heat
    // (migration 20260822100000) matches p_entries[].entry_id against
    // ct_heat_entries.id, not the person's own entry_id — sending the
    // wrong one makes every real confirm fail with "heat_entry % not
    // found in heat %", swallowed by describeError() into a generic
    // "Something went wrong" message with no clue to the real cause.
    const hydrated = [{ id: 'heat-entry-row-id', entry_id: 'roster-person-id' }];
    const result = buildConfirmEntries(hydrated, {}, []);
    expect(result[0].entry_id).toBe('heat-entry-row-id');
  });
});

describe('submitConfirmHeat', () => {
  it('enqueues then flushes, calling confirm_heat with the exact expected payload shape', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const entries = [{ entry_id: 'e1', elapsed_secs: 100, results: [] }];
    const result = await submitConfirmHeat(
      'h1',
      'org1',
      '2026-08-23T00:00:00.000Z',
      entries,
      client,
    );

    expect(result.processed).toBe(1);
    expect(result.stopped).toBe(false);
    expect(rpcCalls).toHaveLength(1);
    const [name, payload] = rpcCalls[0];
    expect(name).toBe('confirm_heat');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_heat_id).toBe('h1');
    expect(payload.p_expected_updated_at).toBe('2026-08-23T00:00:00.000Z');
    // Round-trips through IndexedDB (structured clone) before the flush
    // reads it back, so it's a distinct-but-equal copy, not the same
    // reference.
    expect(payload.p_entries).toEqual(entries);
    // A fresh idempotency key per submission — not reused from elsewhere,
    // not left undefined.
    expect(payload.p_operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('persists the operation before the network call resolves', async () => {
    // A controlled, later-resolved promise rather than one that never
    // resolves at all — flushOutbox() tracks its in-flight state in a
    // module-level variable shared across every test in this file, so a
    // permanently-hanging flush here would silently block every later
    // test's own flushOutbox() call, not just this one.
    let resolveRpc;
    const rpcPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    const client = { rpc: () => rpcPromise };
    const submitPromise = submitConfirmHeat('h1', 'org1', 'now', [], client);
    // Give the enqueue's own await a turn to land before checking — the
    // enqueue is synchronous-ish (one IndexedDB write) and happens before
    // the flush's RPC call is ever awaited.
    await Promise.resolve();
    await Promise.resolve();
    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBeGreaterThanOrEqual(1);
    resolveRpc({ data: null, error: null });
    await submitPromise;
  });

  it('any error confirm_heat itself returns is treated as permanent — never left stuck retrying the exact same rejected payload', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: '2 cupper(s) do not have every set scored' },
        }),
    };
    const result = await submitConfirmHeat('h1', 'org1', 'now', [], client);
    // Not `stopped: true` (the old, pre-fix expectation) — a rejection
    // from the RPC itself will fail identically no matter how many times
    // the exact same payload is retried, so it's removed rather than left
    // to block every later confirm attempt (for ANY heat) behind it
    // forever. See core/outbox.js's own tests for the queue-level proof;
    // this test only proves scoring.js correctly tags the error.
    expect(result.permanentFailure).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.error.message).toContain('do not have every set scored');

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('a network-level failure (the RPC call itself rejecting, not confirm_heat returning an error) stays retryable, not permanent', async () => {
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const result = await submitConfirmHeat('h1', 'org1', 'now', [], client);
    expect(result.permanentFailure).toBe(false);
    expect(result.stopped).toBe(true);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(1);
  });
});

describe('describeConfirmError', () => {
  it('describes a P0002 conflict using the DETAIL payload, not a generic message', () => {
    const err = {
      code: 'P0002',
      details: JSON.stringify({
        heat_id: 'h1',
        current_updated_at: '2026-08-23T00:05:00.000Z',
        expected_updated_at: '2026-08-23T00:00:00.000Z',
      }),
    };
    const message = describeConfirmError(err);
    expect(message).toContain('changed elsewhere');
    expect(message).toContain('2026-08-23T00:05:00.000Z');
  });

  it('falls back to a generic conflict message if DETAIL is malformed, without throwing', () => {
    const err = { code: 'P0002', details: 'not json' };
    expect(() => describeConfirmError(err)).not.toThrow();
    expect(describeConfirmError(err)).toContain('changed elsewhere');
  });

  it('returns null for a non-conflict error, deferring to the generic error describer', () => {
    expect(describeConfirmError({ message: 'network error' })).toBeNull();
    expect(describeConfirmError(new Error('boom'))).toBeNull();
  });
});
