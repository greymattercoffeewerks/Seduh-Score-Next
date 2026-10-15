import { describe, it, expect, vi, afterEach } from 'vitest';
import { signInWithPasswordRequest, isInvalidCredentials, isRateLimited } from './signInRequest.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const clientWith = (...answers) => {
  const signInWithPassword = vi.fn();
  for (const answer of answers) {
    signInWithPassword.mockImplementationOnce(
      typeof answer === 'function' ? answer : async () => answer,
    );
  }
  return { auth: { signInWithPassword } };
};

const WRONG = { error: { code: 'invalid_credentials', message: 'Invalid login credentials' } };

afterEach(() => vi.useRealTimers());

describe('isInvalidCredentials', () => {
  it('recognises the error code, and the message for older supabase-js versions', () => {
    expect(isInvalidCredentials({ code: 'invalid_credentials' })).toBe(true);
    expect(isInvalidCredentials({ message: 'Invalid login credentials' })).toBe(true);
    expect(isInvalidCredentials({ message: 'INVALID LOGIN CREDENTIALS' })).toBe(true);
  });

  it('does not mistake any other failure for a wrong password', () => {
    for (const error of [
      null,
      undefined,
      {},
      { code: 'over_request_rate_limit' },
      { message: 'x' },
      // near misses: one word or one character away from the real thing
      { message: 'Invalid login link' },
      { code: 'invalid_grant' },
      { code: 'invalid_credentials_extra' },
    ]) {
      expect(isInvalidCredentials(error)).toBe(false);
    }
  });
});

describe('isRateLimited', () => {
  it('is the rate-limit code or a 429, and nothing else', () => {
    expect(isRateLimited({ code: 'over_request_rate_limit' })).toBe(true);
    expect(isRateLimited({ status: 429 })).toBe(true);
    for (const error of [null, {}, { status: 400 }, { code: 'invalid_credentials' }]) {
      expect(isRateLimited(error)).toBe(false);
    }
  });
});

describe('signInWithPasswordRequest', () => {
  it('sends exactly what it is given, once, and reports success', async () => {
    const client = clientWith({ error: null });
    expect(
      await signInWithPasswordRequest(client, { email: 'a@b.test', password: ' pw ' }),
    ).toEqual({
      ok: true,
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.test',
      password: ' pw ',
    });
  });

  it('classifies a wrong password, a rate limit and any other refusal, keeping the error', async () => {
    const wrong = await signInWithPasswordRequest(clientWith(WRONG), { email: 'a', password: 'p' });
    expect(wrong).toEqual({ ok: false, kind: 'invalid', error: WRONG.error });

    const limit = { code: 'over_request_rate_limit', status: 429, message: 'slow down' };
    expect(
      await signInWithPasswordRequest(clientWith({ error: limit }), { email: 'a', password: 'p' }),
    ).toEqual({ ok: false, kind: 'rate_limit', error: limit });

    const other = { message: 'Email not confirmed' };
    expect(
      await signInWithPasswordRequest(clientWith({ error: other }), { email: 'a', password: 'p' }),
    ).toEqual({ ok: false, kind: 'other', error: other });
  });

  it('a thrown request is "transport", and never rejects', async () => {
    const client = clientWith(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await signInWithPasswordRequest(client, { email: 'a', password: 'p' })).toEqual({
      ok: false,
      kind: 'transport',
    });
  });

  it('a request that never settles is "timeout" at the shared timeout, not before', async () => {
    vi.useFakeTimers();
    const client = clientWith(() => new Promise(() => {}));
    const pending = signInWithPasswordRequest(client, { email: 'a', password: 'p' });
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ ok: false, kind: 'timeout' });
  });

  it('honours a shorter timeout', async () => {
    const client = clientWith(() => new Promise(() => {}));
    const result = await signInWithPasswordRequest(
      client,
      { email: 'a', password: 'p' },
      { timeoutMs: 5 },
    );
    expect(result).toEqual({ ok: false, kind: 'timeout' });
  });

  describe('retryTrimmed', () => {
    it('is off by default: a wrong password with surrounding space is tried once', async () => {
      const client = clientWith(WRONG, { error: null });
      const result = await signInWithPasswordRequest(client, { email: 'a', password: ' pw ' });
      expect(result.kind).toBe('invalid');
      expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    });

    it('tries exactly as typed first, then once without the surrounding space', async () => {
      const client = clientWith(WRONG, { error: null });
      const result = await signInWithPasswordRequest(
        client,
        { email: 'a', password: ' pw ' },
        { retryTrimmed: true },
      );
      expect(result).toEqual({ ok: true });
      expect(client.auth.signInWithPassword.mock.calls.map((call) => call[0].password)).toEqual([
        ' pw ',
        'pw',
      ]);
    });

    it('does not retry a password with no surrounding space, an all-space one, or a refusal that is not "wrong password"', async () => {
      for (const [password, first] of [
        ['pw', WRONG],
        ['   ', WRONG],
        [' pw ', { error: { code: 'over_request_rate_limit', status: 429, message: 'x' } }],
        [' pw ', { error: { message: 'Email not confirmed' } }],
      ]) {
        const client = clientWith(first, { error: null });
        await signInWithPasswordRequest(client, { email: 'a', password }, { retryTrimmed: true });
        expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      }
    });

    it('does not spend the second try once the caller has cancelled', async () => {
      const client = clientWith(WRONG, { error: null });
      const result = await signInWithPasswordRequest(
        client,
        { email: 'a', password: ' pw ' },
        { retryTrimmed: true, isCancelled: () => true },
      );
      expect(result.kind).toBe('invalid');
      expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    });

    it('a second try that never settles is "timeout"', async () => {
      const client = clientWith(WRONG, () => new Promise(() => {}));
      expect(
        await signInWithPasswordRequest(
          client,
          { email: 'a', password: ' pw ' },
          { retryTrimmed: true, timeoutMs: 5 },
        ),
      ).toEqual({ ok: false, kind: 'timeout' });
    });

    it('reports the SECOND answer when both tries are refused, and a transport failure in the second', async () => {
      const second = { error: { code: 'invalid_credentials', message: 'still wrong' } };
      const both = await signInWithPasswordRequest(
        clientWith(WRONG, second),
        { email: 'a', password: ' pw ' },
        { retryTrimmed: true },
      );
      expect(both).toEqual({ ok: false, kind: 'invalid', error: second.error });

      const thrown = await signInWithPasswordRequest(
        clientWith(WRONG, () => Promise.reject(new TypeError('net'))),
        { email: 'a', password: ' pw ' },
        { retryTrimmed: true },
      );
      expect(thrown).toEqual({ ok: false, kind: 'transport' });
    });
  });
});
