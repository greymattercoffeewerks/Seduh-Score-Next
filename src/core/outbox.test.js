import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueOperation,
  countPendingOperations,
  listPendingOperations,
  flushOutbox,
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

describe('flushOutbox', () => {
  it('calls the registered handler for each operation and removes it from the queue on success', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await flushOutbox({ confirm_heat: handler });

    expect(handler).toHaveBeenCalledWith({ heatId: 'h1' });
    expect(result).toEqual({ processed: 1, stopped: false });
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

    expect(result).toEqual({ processed: 2, stopped: false });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('throws when no handler is registered for a queued operation type', async () => {
    await enqueueOperation('unknown_type', {});
    await expect(flushOutbox({})).rejects.toThrow(/no handler registered/);
  });

  it('returns immediately with nothing to do when the queue is empty', async () => {
    expect(await flushOutbox({})).toEqual({ processed: 0, stopped: false });
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
