import { describe, expect, it, vi } from 'vitest';
import { callDoor, isDoorAbsent } from './doorCall.js';

describe('callDoor', () => {
  it('returns an RPC answer without assigning caller vocabulary to its data', async () => {
    const client = { rpc: vi.fn(() => Promise.resolve({ data: [{ id: 'one' }], error: null })) };
    await expect(
      callDoor(client, 'one_door', { p_one: 'one' }, { timeoutMs: 100 }),
    ).resolves.toEqual({
      status: 'ok',
      data: [{ id: 'one' }],
    });
    expect(client.rpc).toHaveBeenCalledWith('one_door', { p_one: 'one' });
  });

  it.each([{ code: 'PGRST202' }, { code: '42883' }, { status: 404 }])(
    'keeps a missing door distinct from a failed one: %o',
    async (error) => {
      const client = { rpc: vi.fn(() => Promise.resolve({ data: null, error })) };
      await expect(callDoor(client, 'missing_door', {}, { timeoutMs: 100 })).resolves.toEqual({
        status: 'absent',
        error,
      });
      expect(isDoorAbsent(error)).toBe(true);
    },
  );

  it('returns a rejected request as an error, not an absent or empty answer', async () => {
    const error = new TypeError('offline');
    const client = { rpc: vi.fn(() => Promise.reject(error)) };
    await expect(callDoor(client, 'one_door', {}, { timeoutMs: 100 })).resolves.toEqual({
      status: 'error',
      error,
    });
  });

  it('returns a timeout as an error, not an absent or empty answer', async () => {
    vi.useFakeTimers();
    const client = { rpc: vi.fn(() => new Promise(() => {})) };
    const pending = callDoor(client, 'one_door', {}, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.error.timedOut).toBe(true);
    vi.useRealTimers();
  });
});
