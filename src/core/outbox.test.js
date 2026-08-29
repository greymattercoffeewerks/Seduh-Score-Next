import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueOperation,
  countPendingOperations,
  listPendingOperations,
  flushOutbox,
  buildRpcHandler,
} from './outbox.js';
import { _clearAllForTests } from './db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

describe('enqueueOperation', () => {
  it('persists the operation immediately, before any flush happens', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    expect(await countPendingOperations()).toBe(1);
  });

  it('assigns each operation a unique id', async () => {
    const a = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const b = await enqueueOperation('confirm_heat', { heatId: 'h2' });
    expect(a.id).not.toBe(b.id);
  });

  it('starts every operation at zero attempts with no error', async () => {
    const op = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    expect(op.attempts).toBe(0);
    expect(op.lastError).toBeNull();
  });
});

describe('buildRpcHandler', () => {
  it('resolves without throwing when the RPC succeeds', async () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: null }) };
    await expect(buildRpcHandler(client, 'confirm_heat')({ a: 1 })).resolves.toBeUndefined();
  });

  it('calls client.rpc with the given type and the exact payload passed to the handler', async () => {
    const calls = [];
    const client = {
      rpc: (type, payload) => {
        calls.push([type, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    await buildRpcHandler(client, 'start_heat')({ p_heat_id: 'h1' });
    expect(calls).toEqual([['start_heat', { p_heat_id: 'h1' }]]);
  });

  it('wraps an RPC error as a permanent outbox failure, preserving code/details/message', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: 'stale conflict', code: 'P0002', details: 'v1 vs v2' },
        }),
    };
    const handler = buildRpcHandler(client, 'confirm_heat');
    await expect(handler({})).rejects.toMatchObject({
      message: 'stale conflict',
      code: 'P0002',
      details: 'v1 vs v2',
      permanent: true,
    });
  });

  it('does not mark a network-level rejection (client.rpc itself throwing) as permanent', async () => {
    expect.assertions(2);
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const handler = buildRpcHandler(client, 'confirm_heat');
    // A plain Error from a rejected client.rpc() call never passes through
    // buildRpcHandler's own error-wrapping branch (that only runs when
    // client.rpc() RESOLVES with an `error` field) — this handler function
    // never gets a chance to set `.permanent` on it, so flushOutbox's own
    // ordinary-failure path (retryable) is what actually handles it. One
    // invocation, one catch, both assertions on the SAME rejection —
    // `expect.assertions(2)` guards against the catch silently not running
    // if a future change made this resolve instead of reject.
    await handler({}).catch((err) => {
      expect(err.message).toBe('fetch failed');
      expect(err.permanent).toBeUndefined();
    });
  });
});

describe('flushOutbox', () => {
  it('calls the registered handler for each operation and removes it from the queue on success', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await flushOutbox({ confirm_heat: handler });

    expect(handler).toHaveBeenCalledWith({ heatId: 'h1' });
    expect(result).toEqual({ processed: 1, stopped: false, permanentFailure: false });
    expect(await countPendingOperations()).toBe(0);
  });

  it('processes operations in strict FIFO (createdAt) order, never out of order', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'first' });
    await enqueueOperation('confirm_heat', { heatId: 'second' });
    await enqueueOperation('confirm_heat', { heatId: 'third' });
    const callOrder = [];
    const handler = vi.fn(async (payload) => {
      callOrder.push(payload.heatId);
    });

    await flushOutbox({ confirm_heat: handler });

    expect(callOrder).toEqual(['first', 'second', 'third']);
  });

  it('stops at the first genuine failure and does not run a later operation ahead of it', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'fails' });
    await enqueueOperation('confirm_heat', { heatId: 'never-reached' });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined);

    const result = await flushOutbox({ confirm_heat: handler });

    expect(result.stopped).toBe(true);
    expect(result.processed).toBe(0);
    // Only the failing operation was attempted — the queue never let the
    // second operation run ahead of the one still stuck.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await countPendingOperations()).toBe(2);
  });

  it('a permanent failure is removed from the queue, not left stuck retrying forever', async () => {
    // Found in T4.5 review: a handler that determines its own operation
    // can never succeed no matter how many times it's retried (e.g.
    // confirm_heat rejecting a stale-data conflict) must not leave that
    // operation stuck at the head of the queue — since flushOutbox is
    // strict FIFO, a stuck-but-not-removed operation would block every
    // later operation behind it forever, for ANY heat, not just the one
    // that conflicted.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const err = new Error('stale conflict');
    err.permanent = true;
    const handler = vi.fn().mockRejectedValue(err);

    const result = await flushOutbox({ confirm_heat: handler });

    expect(result.permanentFailure).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.error).toBe(err);
    expect(await countPendingOperations()).toBe(0);
  });

  it('a permanent failure does not block a later, unrelated operation in the same flush pass', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'stale-conflict' });
    await enqueueOperation('confirm_heat', { heatId: 'should-still-succeed' });
    const handler = vi.fn(async (payload) => {
      if (payload.heatId === 'stale-conflict') {
        const err = new Error('stale conflict');
        err.permanent = true;
        throw err;
      }
    });

    const result = await flushOutbox({ confirm_heat: handler });

    // The second, unrelated operation still got its turn in the SAME
    // flush call — nothing is "waiting" on an operation that will never
    // succeed, unlike a transient failure, which correctly does stop the
    // whole pass (see the sibling "stops at the first genuine failure"
    // test above).
    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(1);
    expect(result.permanentFailure).toBe(true);
    expect(await countPendingOperations()).toBe(0);
  });

  it('an earlier permanent failure in the same pass is not lost when a later, ordinary failure is what ultimately stops it', async () => {
    // Found in review (offline-sync-auditor + code-reviewer, independently):
    // the queue-empty return path already carried a prior permanent
    // failure's info forward, but the ordinary-failure-stops-the-pass path
    // didn't — so a permanent failure earlier in the same pass would
    // silently vanish from the return value the moment a later, unrelated,
    // ordinary failure was what actually stopped things. The permanently
    // failed operation itself was still correctly removed from the queue
    // either way (no data-integrity gap) — this is purely about the return
    // value not losing information a caller might act on.
    await enqueueOperation('confirm_heat', { heatId: 'stale-conflict' });
    await enqueueOperation('confirm_heat', { heatId: 'network-fails' });
    await enqueueOperation('confirm_heat', { heatId: 'never-reached' });
    const handler = vi.fn(async (payload) => {
      if (payload.heatId === 'stale-conflict') {
        const err = new Error('stale conflict');
        err.permanent = true;
        throw err;
      }
      if (payload.heatId === 'network-fails') {
        throw new Error('network timeout');
      }
    });

    const result = await flushOutbox({ confirm_heat: handler });

    expect(result.stopped).toBe(true);
    expect(result.error.message).toBe('network timeout');
    expect(result.permanentFailure).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
    // 'stale-conflict' was removed (permanent). 'network-fails' is left
    // queued for retry (attempts bumped). 'never-reached' is ALSO still
    // queued — it was never touched at all, not removed and not retried,
    // since the ordinary failure on 'network-fails' stops the whole pass
    // before its own turn comes up.
    expect(await countPendingOperations()).toBe(2);
  });

  it('records the attempt count and last error on the failed operation, without discarding it', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const handler = vi.fn().mockRejectedValue(new Error('network timeout'));

    await flushOutbox({ confirm_heat: handler });

    const [pending] = await listPendingOperations();
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).toBe('network timeout');
  });

  it('a retry after a failure replays the SAME operation (same payload) — never a fresh one', async () => {
    // This is what makes a client-generated idempotency key (e.g.
    // confirm_heat's operation_id) actually safe to retry: the outbox always
    // resubmits the exact same queued payload, never regenerates it.
    await enqueueOperation('confirm_heat', { heatId: 'h1', operationId: 'op-abc' });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);

    await flushOutbox({ confirm_heat: handler }); // fails, stays queued
    await flushOutbox({ confirm_heat: handler }); // retried

    expect(handler).toHaveBeenNthCalledWith(1, { heatId: 'h1', operationId: 'op-abc' });
    expect(handler).toHaveBeenNthCalledWith(2, { heatId: 'h1', operationId: 'op-abc' });
    expect(await countPendingOperations()).toBe(0);
  });

  it('increments attempts across multiple retries rather than resetting', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const handler = vi.fn().mockRejectedValue(new Error('still failing'));

    await flushOutbox({ confirm_heat: handler });
    await flushOutbox({ confirm_heat: handler });
    await flushOutbox({ confirm_heat: handler });

    const [pending] = await listPendingOperations();
    expect(pending.attempts).toBe(3);
  });

  it('picks up an operation enqueued mid-flush in the same call, without a second invocation', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'first' });
    const handler = vi.fn(async (payload) => {
      if (payload.heatId === 'first') {
        await enqueueOperation('confirm_heat', { heatId: 'enqueued-mid-flush' });
      }
    });

    const result = await flushOutbox({ confirm_heat: handler });

    expect(result).toEqual({ processed: 2, stopped: false, permanentFailure: false });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a missing handler is recorded as a failed attempt, not an uncaught rejection — so it can surface as a stuck operation', async () => {
    // A thrown-before-the-try version of this would skip attempts/lastError
    // persistence entirely, making a missing-handler operation permanently
    // and silently block the queue with no diagnostic (found during T3.3
    // review, since T3.3's sync-state panel identifies a stuck operation by
    // attempts > 0).
    await enqueueOperation('unknown_type', {});

    const result = await flushOutbox({});

    expect(result.stopped).toBe(true);
    expect(result.error.message).toMatch(/no handler registered/);
    const [pending] = await listPendingOperations();
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).toMatch(/no handler registered/);
  });

  it('returns immediately with nothing to do when the queue is empty', async () => {
    expect(await flushOutbox({})).toEqual({
      processed: 0,
      stopped: false,
      permanentFailure: false,
    });
  });

  it('concurrent flush calls share one in-flight run rather than processing the queue twice', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const handler = vi.fn().mockResolvedValue(undefined);

    // Both calls happen synchronously (before either has a chance to await
    // anything), so the second sees the first's in-flight guard already set —
    // deterministic, no artificial pause needed.
    const [first, second] = await Promise.all([
      flushOutbox({ confirm_heat: handler }),
      flushOutbox({ confirm_heat: handler }),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });
});
