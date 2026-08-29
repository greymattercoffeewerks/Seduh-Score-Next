import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { raceTimeout } from './timeout.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('raceTimeout', () => {
  it("resolves with the promise's own value when it settles before the timeout", async () => {
    const fast = Promise.resolve('real value');
    const result = raceTimeout(fast, 10000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe('real value');
  });

  it('rejects with a `.timedOut` error when the promise never settles before the timeout', async () => {
    const hung = new Promise(() => {}); // never resolves or rejects — the exact failure mode this guards against
    const result = raceTimeout(hung, 5000);
    const assertion = expect(result).rejects.toMatchObject({
      message: 'timed out',
      timedOut: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('propagates the original rejection, not a timeout, when the promise rejects first', async () => {
    const failing = Promise.reject(new Error('real failure'));
    // No timer advancement needed — the promise is already settled, faster
    // than the 10000ms timeout could ever fire.
    await expect(raceTimeout(failing, 10000)).rejects.toThrow('real failure');
  });

  it('clears its own timer once the race settles, so it never fires late or leaks', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    await raceTimeout(Promise.resolve('done'), 10000);
    expect(clearSpy).toHaveBeenCalled();
  });
});
