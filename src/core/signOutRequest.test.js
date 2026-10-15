import { describe, it, expect, vi, afterEach } from 'vitest';
import { signOutRequest } from './signOutRequest.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const clientWith = (signOut) => ({ auth: { signOut: vi.fn(signOut) } });

afterEach(() => vi.useRealTimers());

describe('signOutRequest', () => {
  it("with no scope the call is exactly auth.signOut() (the client's own default applies)", async () => {
    const client = clientWith(async () => ({ error: null }));
    expect(await signOutRequest(client)).toEqual({ ok: true });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut.mock.calls[0]).toEqual([]);
  });

  it('passes a given scope through, and only then', async () => {
    for (const scope of ['local', 'global', 'others']) {
      const client = clientWith(async () => ({ error: null }));
      await signOutRequest(client, { scope });
      expect(client.auth.signOut).toHaveBeenCalledWith({ scope });
    }
  });

  it('a refusal is not ok and not a timeout; a throw likewise; neither rejects', async () => {
    expect(await signOutRequest(clientWith(async () => ({ error: { message: 'no' } })))).toEqual({
      ok: false,
      timedOut: false,
    });
    expect(
      await signOutRequest(clientWith(() => Promise.reject(new TypeError('Failed to fetch')))),
    ).toEqual({ ok: false, timedOut: false });
  });

  it('gives up at the shared timeout and says it was the timeout', async () => {
    vi.useFakeTimers();
    const pending = signOutRequest(clientWith(() => new Promise(() => {})));
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ ok: false, timedOut: true });
  });

  it('honours a shorter timeout', async () => {
    const result = await signOutRequest(
      clientWith(() => new Promise(() => {})),
      { timeoutMs: 5 },
    );
    expect(result).toEqual({ ok: false, timedOut: true });
  });
});
