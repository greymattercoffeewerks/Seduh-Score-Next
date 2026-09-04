import { describe, it, expect, beforeEach } from 'vitest';
import { cupTasterOutboxHandlers } from './outboxHandlers.js';
import { confirmHandlers, submitConfirmHeat } from './scoring.js';
import { enqueueOperation, countPendingOperations, flushOutbox } from '../../core/outbox.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

// Also carries a minimal working `.from()` — since 2026-09-04, the composed
// map's publish_live_session handler does its own DB reads (via
// buildLiveSessionPayload) before ever calling `.rpc()`, unlike every other
// handler here which is a pure buildRpcHandler pass-through; an empty stage
// (no stage entries, no heats) is enough for that read chain to resolve
// cleanly without needing liveSession.test.js's own richer fixtures.
function fakeRpcClient() {
  const calls = [];
  const stage = {
    id: 's1',
    event_id: 'ev1',
    ordinal: 1,
    kind: 'prelims',
    set_count: 4,
    duration_secs: 60,
    cutoff: null,
  };
  const emptyTables = {
    ct_stages: { data: stage, error: null },
    ct_stage_entries: { data: [], error: null },
    ct_standings: { data: [], error: null },
    event_entries: { data: [], error: null },
    ct_heats: { data: [], error: null },
  };
  return {
    calls,
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const response = emptyTables[table] ?? { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        then: (onResolve) => Promise.resolve(response).then(onResolve),
      };
      return builder;
    },
  };
}

describe('cupTasterOutboxHandlers', () => {
  it('composes every Cup Taster operation type into one map of real handler functions', () => {
    const client = fakeRpcClient();
    const handlers = cupTasterOutboxHandlers(client);
    expect(Object.keys(handlers).sort()).toEqual([
      'auto_max_heat',
      'confirm_heat',
      'publish_live_session',
      'record_heat_time',
      'start_heat',
    ]);
    // A bare key-presence check would still pass if e.g.
    // publishLiveSessionHandlers() silently degraded to
    // { publish_live_session: undefined } — this proves every entry is an
    // actual callable handler, not just a present key.
    for (const handler of Object.values(handlers)) {
      expect(typeof handler).toBe('function');
    }
  });

  it('every one of the 5 composed operation types actually flushes through the composed map, not just the two the FIFO-order test below happens to cover', async () => {
    const client = fakeRpcClient();
    await enqueueOperation('start_heat', { p_heat_id: 'h1' });
    await enqueueOperation('record_heat_time', { p_heat_entry_id: 'he1' });
    await enqueueOperation('auto_max_heat', { p_heat_id: 'h1' });
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    await enqueueOperation('publish_live_session', {
      orgId: 'org1',
      eventId: 'ev1',
      stageId: 's1',
      format: 'cup_taster',
      isTest: false,
    });

    const result = await flushOutbox(cupTasterOutboxHandlers(client));

    // The queued operation TYPE is publish_live_session, but the actual RPC
    // it calls (built fresh inside the handler, per liveSession.js's own
    // module comment) is still named publish_session — client.calls tracks
    // .rpc() invocations, not outbox operation types.
    expect(client.calls).toEqual([
      'start_heat',
      'record_heat_time',
      'auto_max_heat',
      'confirm_heat',
      'publish_session',
    ]);
    expect(result).toEqual({ processed: 5, stopped: false, permanentFailure: false });
    expect(await countPendingOperations()).toBe(0);
  });

  it('the primary offline workflow: a confirm_heat queued behind earlier timing operations still flushes, instead of stalling on the first operation type it does not own', async () => {
    // Simulates the exact scenario the gap this task closes describes: a
    // heat timed fully offline (start_heat enqueued but never flushed,
    // since there was no connection) then scored in the same session —
    // submitConfirmHeat enqueues confirm_heat BEHIND it in the same queue.
    const client = fakeRpcClient();
    await enqueueOperation('start_heat', { p_heat_id: 'h1' });

    const result = await submitConfirmHeat(
      'h1',
      'org1',
      '2026-08-29T00:00:00.000Z',
      [],
      client,
      cupTasterOutboxHandlers(client),
    );

    // Both operations were actually attempted, in FIFO order — not just
    // the caller's own confirm_heat.
    expect(client.calls).toEqual(['start_heat', 'confirm_heat']);
    expect(result).toEqual({ processed: 2, stopped: false, permanentFailure: false });
    expect(await countPendingOperations()).toBe(0);
  });

  it("contrast: the same scenario DOES stall when flushing with only confirm_heat's own narrow map — proving this test would catch a regression back to the pre-fix behavior", async () => {
    const client = fakeRpcClient();
    await enqueueOperation('start_heat', { p_heat_id: 'h1' });

    const result = await submitConfirmHeat(
      'h1',
      'org1',
      '2026-08-29T00:00:00.000Z',
      [],
      client,
      confirmHandlers(client), // the OLD narrow map, not the composed one
    );

    // The flush hits start_heat first, finds no handler for it in this
    // narrow map, and stops — confirm_heat is never even attempted, exactly
    // the bug this task closes.
    expect(client.calls).toEqual([]);
    expect(result.stopped).toBe(true);
    expect(result.error.message).toMatch(/no handler registered for operation type "start_heat"/);
    expect(await countPendingOperations()).toBe(2);
  });
});
