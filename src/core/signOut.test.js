import { describe, it, expect, vi, afterEach } from 'vitest';
import { signOutWithTimeout, SIGN_OUT_FAILED_MESSAGE, SIGN_OUT_SLOW_MESSAGE } from './signOut.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const clientWith = (signOut) => ({ auth: { signOut: vi.fn(signOut) } });

afterEach(() => {
  vi.useRealTimers();
});

describe('signOutWithTimeout', () => {
  it('resolves to null when signing out worked', async () => {
    const client = clientWith(async () => ({ error: null }));
    expect(await signOutWithTimeout(client)).toBeNull();
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('resolves to the failure message when the server refuses, or when the call throws', async () => {
    expect(await signOutWithTimeout(clientWith(async () => ({ error: { message: 'no' } })))).toBe(
      SIGN_OUT_FAILED_MESSAGE,
    );
    expect(
      await signOutWithTimeout(
        clientWith(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ),
    ).toBe(SIGN_OUT_FAILED_MESSAGE);
  });

  it('gives up at the shared timeout, with its own message, and never rejects', async () => {
    vi.useFakeTimers();
    const pending = signOutWithTimeout(clientWith(() => new Promise(() => {})));
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe(SIGN_OUT_SLOW_MESSAGE);
  });

  it('the two messages differ, and the slow one says what is slow', () => {
    expect(SIGN_OUT_SLOW_MESSAGE).not.toBe(SIGN_OUT_FAILED_MESSAGE);
    expect(SIGN_OUT_SLOW_MESSAGE).toMatch(/^Signing out is taking longer/);
  });
});
