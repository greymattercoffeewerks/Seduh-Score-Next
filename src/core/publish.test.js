import { describe, it, expect, beforeEach } from 'vitest';
import { publishSession } from './publish.js';
import { _clearAllForTests } from './db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

describe('publishSession', () => {
  it('enqueues then flushes, calling publish_session with the exact expected payload shape', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const payload = { standings: [{ entryId: 'e1', position: 1 }] };
    const result = await publishSession(
      'org1',
      'ev1',
      { format: 'cup_taster', isTest: true, payload },
      client,
    );

    expect(result.processed).toBe(1);
    expect(result.stopped).toBe(false);
    expect(rpcCalls).toHaveLength(1);
    const [name, rpcPayload] = rpcCalls[0];
    expect(name).toBe('publish_session');
    expect(rpcPayload.p_org_id).toBe('org1');
    expect(rpcPayload.p_event_id).toBe('ev1');
    expect(rpcPayload.p_format).toBe('cup_taster');
    expect(rpcPayload.p_is_test).toBe(true);
    // Round-trips through IndexedDB (structured clone) before the flush
    // reads it back, so it's a distinct-but-equal copy, not the same
    // reference.
    expect(rpcPayload.p_payload).toEqual(payload);
    // A fresh idempotency key per call — not reused from elsewhere, not
    // left undefined.
    expect(rpcPayload.p_operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('propagates isTest exactly as given, including false — never defaults it to true', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push(payload);
        return Promise.resolve({ data: null, error: null });
      },
    };
    await publishSession(
      'org1',
      'ev1',
      { format: 'cup_taster', isTest: false, payload: {} },
      client,
    );
    expect(rpcCalls[0].p_is_test).toBe(false);
  });

  it('throws rather than silently enqueuing when isTest is omitted', async () => {
    // Without this guard, a caller that forgot the key would enqueue
    // `isTest: undefined` for free — the one place D9's "unmistakable
    // is_test" guarantee could quietly break (found in review).
    const client = { rpc: () => Promise.resolve({ data: null, error: null }) };
    await expect(
      publishSession('org1', 'ev1', { format: 'cup_taster', payload: {} }, client),
    ).rejects.toThrow('isTest must be explicitly true or false');

    const { countPendingOperations } = await import('./outbox.js');
    expect(await countPendingOperations()).toBe(0);
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
    const submitPromise = publishSession(
      'org1',
      'ev1',
      { format: 'cup_taster', isTest: false, payload: {} },
      client,
    );
    // Give the enqueue's own await a turn to land before checking — the
    // enqueue is synchronous-ish (one IndexedDB write) and happens before
    // the flush's RPC call is ever awaited.
    await Promise.resolve();
    await Promise.resolve();
    const { countPendingOperations } = await import('./outbox.js');
    expect(await countPendingOperations()).toBeGreaterThanOrEqual(1);
    resolveRpc({ data: null, error: null });
    await submitPromise;
  });

  it('any error publish_session itself returns is treated as permanent — never left stuck retrying the exact same rejected payload', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: 'publish_session: event ev1 does not belong to org org1' },
          // A genuine server-side rejection carries a real, non-zero HTTP
          // status — that's what actually distinguishes it from a network-
          // level failure (buildRpcHandler, core/outbox.js), which resolves
          // with status: 0 instead. This mock models a REAL rejection.
          status: 400,
        }),
    };
    const result = await publishSession(
      'org1',
      'ev1',
      { format: 'cup_taster', isTest: false, payload: {} },
      client,
    );
    expect(result.permanentFailure).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.error.message).toContain('does not belong to org');

    const { countPendingOperations } = await import('./outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('a network-level failure (the RPC call itself rejecting, not publish_session returning an error) stays retryable, not permanent', async () => {
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const result = await publishSession(
      'org1',
      'ev1',
      { format: 'cup_taster', isTest: false, payload: {} },
      client,
    );
    expect(result.permanentFailure).toBe(false);
    expect(result.stopped).toBe(true);

    const { countPendingOperations } = await import('./outbox.js');
    expect(await countPendingOperations()).toBe(1);
  });
});
