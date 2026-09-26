import { describe, it, expect, vi, afterEach } from 'vitest';

const createClient = vi.fn(() => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...args) => createClient(...args) }));

const { fetchWithTimeout, getSupabase, REQUEST_TIMEOUT_MS } = await import('./supabaseClient.js');

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

  it('still times out when the caller passes its own signal that never aborts', async () => {
    vi.stubGlobal('fetch', hangingFetch());

    await expect(
      fetchWithTimeout(
        'https://x.test/rpc',
        { signal: new AbortController().signal },
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('uses REQUEST_TIMEOUT_MS (30s) when no timeout is given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('ok'))),
    );
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    try {
      await fetchWithTimeout('https://x.test/rpc');
      expect(REQUEST_TIMEOUT_MS).toBe(30000);
      expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    } finally {
      timeout.mockRestore();
    }
  });
});

// The timeout only helps if the app's one client actually routes through it.
describe('getSupabase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the client with fetchWithTimeout as its global fetch', async () => {
    getSupabase();
    const options = createClient.mock.calls[0][2];
    expect(typeof options.global.fetch).toBe('function');

    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('ok'))),
    );
    try {
      await options.global.fetch('https://x.test/rpc', {});
      expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    } finally {
      timeout.mockRestore();
    }
  });
});
