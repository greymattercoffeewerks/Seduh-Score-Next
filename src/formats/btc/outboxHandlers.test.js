import { describe, it, expect, beforeEach } from 'vitest';
import { btcOutboxHandlers, btcOperationLabels } from './outboxHandlers.js';
import { enqueueOperation, flushOutbox, listPendingOperations } from '../../core/outbox.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

function fakeRpcClient({ error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve({ data: null, error });
    },
  };
}

describe('btcOutboxHandlers', () => {
  it('registers exactly the BTC operation types, each a real callable handler', () => {
    const handlers = btcOutboxHandlers(fakeRpcClient());
    expect(Object.keys(handlers).sort()).toEqual(['confirm_btc_match', 'publish_btc_live_session']);
    for (const handler of Object.values(handlers)) expect(typeof handler).toBe('function');
  });

  it('maps publish_btc_live_session to the live-display publish (it builds the payload and calls publish_session)', async () => {
    const calls = [];
    const builder = (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        order: () => b,
        single: () => Promise.resolve({ data: { id: 'ev1', name: 'Event' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve, reject) =>
          Promise.resolve({ data: [], error: null, table }).then(resolve, reject),
      };
      return b;
    };
    const client = {
      from: builder,
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    await btcOutboxHandlers(client).publish_btc_live_session({
      orgId: 'org1',
      eventId: 'ev1',
      format: 'btc',
      isTest: true,
      onlyIfLive: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('publish_session');
    expect(calls[0][1]).toMatchObject({ p_format: 'btc', p_event_id: 'ev1', p_is_test: true });
    expect(calls[0][1].p_payload.phase).toBe('setup');
  });

  it('has a label for every registered operation type, and no label without a handler', () => {
    const handlerTypes = Object.keys(btcOutboxHandlers(fakeRpcClient())).sort();
    expect(Object.keys(btcOperationLabels).sort()).toEqual(handlerTypes);
    for (const label of Object.values(btcOperationLabels)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('a queued confirm_btc_match really flushes through this map, as the confirm_btc_match RPC', async () => {
    const client = fakeRpcClient();
    const payload = { p_operation_id: 'op-1', p_match_id: 'm1' };
    await enqueueOperation('confirm_btc_match', payload);

    const result = await flushOutbox(btcOutboxHandlers(client));

    expect(result.processed).toBe(1);
    expect(client.calls).toEqual([['confirm_btc_match', payload]]);
    expect(await listPendingOperations()).toEqual([]);
  });

  it('without this map the queued confirm would stop the queue: the reason the map exists', async () => {
    await enqueueOperation('confirm_btc_match', { p_operation_id: 'op-1' });
    const result = await flushOutbox({});
    expect(result.processed).toBe(0);
    expect(result.stopped).toBe(true);
    expect(await listPendingOperations()).toHaveLength(1);
  });
});

describe('a server refusal of a queued confirm', () => {
  it('drops it from the queue and keeps its Postgres code, so the screen can tell a conflict from a validation error', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { code: 'P0002', message: 'CONFLICT: match modified', details: '{}' },
          status: 500,
        }),
    };
    await enqueueOperation('confirm_btc_match', { p_operation_id: 'op-1' });

    const result = await flushOutbox(btcOutboxHandlers(client));

    expect(result.permanentFailure).toBe(true);
    expect(result.error.code).toBe('P0002');
    expect(await listPendingOperations()).toEqual([]);
  });

  it('keeps the queued confirm, payload intact, on a dropped connection (status 0)', async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' }, status: 0 }),
    };
    await enqueueOperation('confirm_btc_match', { p_operation_id: 'op-1', p_match_id: 'm1' });

    const result = await flushOutbox(btcOutboxHandlers(client));

    expect(result.permanentFailure).toBe(false);
    const pending = await listPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ p_operation_id: 'op-1', p_match_id: 'm1' });
  });
});
