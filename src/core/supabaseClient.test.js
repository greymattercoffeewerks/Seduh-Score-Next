import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './supabaseClient.js';

// Found in review (offline-sync-auditor, 2026-09-26): a half-open
// connection on venue wifi left a request — and the outbox flush waiting
// on it — pending indefinitely, with every later flush joining that same
// stuck promise.
describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function hangingFetch() {
    return vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    );
  }

  it('aborts a request that never answers, after the timeout', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithTimeout('https://x.test/rpc', {}, { timeoutMs: 20 }),
    ).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still honours the caller's own abort signal alongside the timeout", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();

    const request = fetchWithTimeout('https://x.test/rpc', { signal: caller.signal });
    caller.abort(new Error('caller gave up'));

    await expect(request).rejects.toThrow('caller gave up');
  });

  it('passes the request through untouched apart from the signal', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('ok')));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithTimeout('https://x.test/rpc', { method: 'POST', body: '{}' });

    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe('https://x.test/rpc');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults to a 30s timeout — long enough for the dispute-pack read, short enough to unstick a flush', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30000);
  });
});
