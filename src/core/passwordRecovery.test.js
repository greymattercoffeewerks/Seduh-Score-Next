import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthUnknownError,
  createClient,
} from '@supabase/supabase-js';
import {
  RESET_REQUESTED_MESSAGE,
  MIN_RESET_ANSWER_MS,
  classifyResetError,
  requestPasswordReset,
  resetRedirectUrl,
  readRecoveryArrival,
  takeRecoveryArrival,
  createRecoveryFlow,
} from './passwordRecovery.js';

const TOKEN_HASH =
  '#access_token=AT-secret&expires_in=3600&refresh_token=RT-secret&token_type=bearer&type=recovery';

describe('readRecoveryArrival', () => {
  it('reads the session out of a recovery link’s hash', () => {
    expect(readRecoveryArrival(TOKEN_HASH)).toEqual({
      kind: 'token',
      accessToken: 'AT-secret',
      refreshToken: 'RT-secret',
    });
    // The leading # is optional.
    expect(readRecoveryArrival(TOKEN_HASH.slice(1))?.kind).toBe('token');
  });

  it.each([
    ['nothing', ''],
    ['just #', '#'],
    ['a console route', '#/events'],
    ['a console route with an id', '#/events/ev1'],
    ['an audience route', '#/live/some-org/phone'],
    ['an ordinary fragment', '#section-2'],
    [
      'a token of another kind (a sign-up link is not ours)',
      '#access_token=a&refresh_token=r&type=signup',
    ],
    ['a token with no type', '#access_token=a&refresh_token=r'],
  ])('is not an arrival: %s', (_label, hash) => {
    expect(readRecoveryArrival(hash)).toBeNull();
  });

  it('a console route that happens to mention a recovery word is still a route', () => {
    expect(readRecoveryArrival('#/events&type=recovery&access_token=x&refresh_token=y')).toBeNull();
  });

  it('reads an expired or used link as a link error, with nothing of it kept', () => {
    const arrival = readRecoveryArrival(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(arrival).toEqual({ kind: 'link_error' });
  });

  it('a recovery link with no token in it is a link error, not a token', () => {
    expect(readRecoveryArrival('#type=recovery')).toEqual({ kind: 'link_error' });
    expect(readRecoveryArrival('#type=recovery&access_token=')).toEqual({ kind: 'link_error' });
  });

  it('a token with no refresh token is still a token (the flow decides if it works)', () => {
    expect(readRecoveryArrival('#access_token=a&type=recovery')).toEqual({
      kind: 'token',
      accessToken: 'a',
      refreshToken: '',
    });
  });
});

describe('takeRecoveryArrival', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('removes the token from the address bar and adds no history entry', () => {
    history.replaceState(null, '', `/app/?x=1${TOKEN_HASH}`);
    const lengthBefore = history.length;
    const arrival = takeRecoveryArrival();
    expect(arrival.kind).toBe('token');
    expect(location.hash).toBe('');
    expect(location.href).not.toContain('secret');
    expect(location.href).not.toContain('access_token');
    // The path and query are kept; only the fragment goes.
    expect(location.pathname + location.search).toBe('/app/?x=1');
    expect(history.length).toBe(lengthBefore);
  });

  it('removes an error fragment too', () => {
    history.replaceState(null, '', '/app/#error=access_denied&error_code=otp_expired');
    expect(takeRecoveryArrival()).toEqual({ kind: 'link_error' });
    expect(location.hash).toBe('');
  });

  it('leaves a console route alone and returns nothing', () => {
    history.replaceState(null, '', '/app/#/events/ev1');
    const replace = vi.spyOn(history, 'replaceState');
    expect(takeRecoveryArrival()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/events/ev1');
    replace.mockRestore();
  });
});

describe('resetRedirectUrl', () => {
  it('is this console’s own address, with no hash and no query', () => {
    expect(
      resetRedirectUrl({
        origin: 'https://www.seduhscore.com',
        pathname: '/app/',
        hash: '#/events',
        search: '?a=1',
      }),
    ).toBe('https://www.seduhscore.com/app/');
  });

  it('is the folder when the page is served as index.html', () => {
    expect(resetRedirectUrl({ origin: 'http://localhost:5273', pathname: '/app/index.html' })).toBe(
      'http://localhost:5273/app/',
    );
  });
});

// ---- asking for a link ----

describe('classifyResetError', () => {
  it('every refusal that could differ with whether the address has an account gets the success answer', () => {
    for (const error of [
      { code: 'over_email_send_rate_limit', status: 429, message: 'only after 56 seconds' },
      { code: 'unexpected_failure', status: 500, message: 'Error sending recovery email' },
      { status: 500, message: 'Error sending recovery email' },
      { code: 'user_not_found', status: 404 },
      { code: 'validation_failed', status: 400 },
      { code: 'email_address_invalid', status: 400 },
      { status: 429, message: 'Too Many Requests' },
      { message: 'something we have never seen' },
    ]) {
      expect(classifyResetError(error), JSON.stringify(error)).toBe('requested');
    }
    expect(classifyResetError(null)).toBe('requested');
  });

  it('classifies the REAL supabase-js error classes the same way as the hand-written fixtures', () => {
    expect(classifyResetError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(
      'unreachable',
    );
    expect(classifyResetError(new AuthRetryableFetchError('Bad gateway', 503))).toBe('unreachable');
    expect(classifyResetError(new AuthRetryableFetchError('Bad gateway', 502))).toBe('unreachable');
    // GoTrue's own failure (a mail relay rejecting the message of a REAL account) is HTTP 500, which the real
    // client turns into this class with its code erased: it must read as 'sent', like an unknown address.
    expect(
      classifyResetError(new AuthRetryableFetchError('Error sending recovery email', 500)),
    ).toBe('requested');
    expect(classifyResetError(new AuthApiError('slow down', 429, 'over_request_rate_limit'))).toBe(
      'busy',
    );
    expect(classifyResetError(new AuthApiError('no such user', 404, 'user_not_found'))).toBe(
      'requested',
    );
    expect(classifyResetError(new AuthUnknownError('CDN page', new Error('x')))).toBe(
      'unreachable',
    );
  });

  it('through the REAL client: an HTTP 500 with a JSON body reads as sent, a 502 as unreachable', async () => {
    const answer = (status, body) => async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const resetWith = async (fetchImpl) => {
      const client = createClient('http://localhost:54321', 'anon-key', {
        global: { fetch: fetchImpl },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      return (await client.auth.resetPasswordForEmail('x@y.co')).error;
    };
    const mailFailure = await resetWith(
      answer(500, { code: 'unexpected_failure', message: 'Error sending recovery email' }),
    );
    expect(mailFailure.name).toBe('AuthRetryableFetchError');
    expect(classifyResetError(mailFailure)).toBe('requested');
    const gateway = await resetWith(answer(502, { message: 'Bad gateway' }));
    expect(classifyResetError(gateway)).toBe('unreachable');
    const perAddressLimit = await resetWith(
      answer(429, { code: 'over_email_send_rate_limit', message: 'wait 56 seconds' }),
    );
    expect(classifyResetError(perAddressLimit)).toBe('requested');
  });

  it('only outcomes that say nothing about the address are different', () => {
    expect(classifyResetError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('unreachable');
    expect(classifyResetError({ name: 'AuthRetryableFetchError', status: 503 })).toBe(
      'unreachable',
    );
    expect(classifyResetError({ code: 'over_request_rate_limit', status: 429 })).toBe('busy');
    // An answer that was not Auth's at all (a CDN error page) never reached the account lookup.
    expect(classifyResetError({ name: 'AuthUnknownError', status: 520 })).toBe('unreachable');
  });
});

describe('requestPasswordReset', () => {
  const noWait = { minAnswerMs: 0 };

  function clientAnswering(answer) {
    const calls = [];
    return {
      calls,
      auth: {
        resetPasswordForEmail: (email, options) => {
          calls.push({ email, options });
          if (answer instanceof Error) return Promise.reject(answer);
          return Promise.resolve(answer);
        },
      },
    };
  }

  it('asks Supabase for a link to the given address and redirect', async () => {
    const client = clientAnswering({ data: {}, error: null });
    const result = await requestPasswordReset(client, 'a@b.co', {
      redirectTo: 'https://x.test/app/',
      ...noWait,
    });
    expect(result).toEqual({ kind: 'requested' });
    expect(client.calls).toEqual([
      { email: 'a@b.co', options: { redirectTo: 'https://x.test/app/' } },
    ]);
  });

  it('gives the SAME result for an address with an account and for each refusal that only an existing account would get', async () => {
    const answers = [
      { data: {}, error: null }, // exists (or not: the server does not say)
      { data: null, error: { code: 'over_email_send_rate_limit', status: 429, message: 'wait' } },
      { data: null, error: { code: 'unexpected_failure', status: 500, message: 'Error sending' } },
      { data: null, error: { code: 'user_not_found', status: 404, message: 'nope' } },
      // what the real client gives for that same mail failure: its code is erased, only name and status remain
      { data: null, error: new AuthRetryableFetchError('Error sending recovery email', 500) },
    ];
    const results = [];
    for (const answer of answers) {
      results.push(await requestPasswordReset(clientAnswering(answer), 'x@y.co', noWait));
    }
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toEqual({ kind: 'requested' });
  });

  it.each([
    [
      'a dropped connection returned as an error',
      { data: null, error: { name: 'AuthRetryableFetchError', status: 0 } },
      'unreachable',
    ],
    [
      'too many requests from this connection',
      { data: null, error: { code: 'over_request_rate_limit', status: 429 } },
      'busy',
    ],
  ])('%s', async (_label, answer, kind) => {
    expect(await requestPasswordReset(clientAnswering(answer), 'x@y.co', noWait)).toEqual({ kind });
  });

  it('a throw is reported as no answer from the server', async () => {
    const client = clientAnswering(new TypeError('Failed to fetch'));
    expect(await requestPasswordReset(client, 'x@y.co', noWait)).toEqual({ kind: 'unreachable' });
  });

  it('a request that never settles ends as no answer, not a hang', async () => {
    vi.useFakeTimers();
    try {
      const client = { auth: { resetPasswordForEmail: () => new Promise(() => {}) } };
      const pending = requestPasswordReset(client, 'x@y.co', { timeoutMs: 5000, minAnswerMs: 0 });
      await vi.advanceTimersByTimeAsync(5001);
      expect(await pending).toEqual({ kind: 'unreachable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a quick answer back to the minimum time, the same for success and for a refusal', async () => {
    const waits = [];
    const wait = (ms) => {
      waits.push(ms);
      return Promise.resolve();
    };
    await requestPasswordReset(clientAnswering({ data: {}, error: null }), 'x@y.co', {
      minAnswerMs: 1200,
      wait,
    });
    await requestPasswordReset(
      clientAnswering({ data: null, error: { code: 'user_not_found', status: 404 } }),
      'x@y.co',
      { minAnswerMs: 1200, wait },
    );
    expect(waits).toHaveLength(2);
    for (const ms of waits) {
      expect(ms).toBeGreaterThan(1000);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });

  it('does not add time to an answer that already took longer than the minimum', async () => {
    const wait = vi.fn(() => Promise.resolve());
    const client = {
      auth: {
        resetPasswordForEmail: () =>
          new Promise((resolve) => setTimeout(() => resolve({ data: {}, error: null }), 30)),
      },
    };
    await requestPasswordReset(client, 'x@y.co', { minAnswerMs: 10, wait });
    expect(wait).not.toHaveBeenCalled();
  });

  it('the minimum is a real, non-trivial default', () => {
    expect(MIN_RESET_ANSWER_MS).toBeGreaterThanOrEqual(1000);
    expect(RESET_REQUESTED_MESSAGE).toBe('If that address has an account, we sent a link.');
  });
});

// ---- one arrival ----

function flowClient({
  setSession = () => Promise.resolve({ data: { session: { user: {} } }, error: null }),
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' },
  updateUser = () => Promise.resolve({ data: {}, error: null }),
  signOut = () => Promise.resolve({ error: null }),
} = {}) {
  return {
    auth: {
      setSession: vi.fn(setSession),
      updateUser: vi.fn(updateUser),
      signOut: vi.fn(signOut),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve({ data: aal, error: null })),
      },
    },
  };
}
const tokenArrival = { kind: 'token', accessToken: 'AT', refreshToken: 'RT' };

describe('createRecoveryFlow', () => {
  it('establishes the link’s session and becomes ready', async () => {
    const client = flowClient();
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    expect(flow.getState().phase).toBe('verifying');
    await flow.establish();
    expect(client.auth.setSession).toHaveBeenCalledWith({
      access_token: 'AT',
      refresh_token: 'RT',
    });
    expect(flow.getState().phase).toBe('ready');
    expect(flow.isOpen()).toBe(true);
  });

  it('is one check however many screens ask, and a settled answer is not asked for again', async () => {
    const client = flowClient();
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await Promise.all([flow.establish(), flow.establish(), flow.establish()]);
    await flow.establish();
    expect(client.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('an expired or used link (a refusal) is invalid', async () => {
    const client = flowClient({
      setSession: () =>
        Promise.resolve({
          data: { session: null, user: null },
          error: { name: 'AuthApiError', status: 401 },
        }),
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('invalid');
  });

  it('an answer with no session is invalid too', async () => {
    const client = flowClient({
      setSession: () => Promise.resolve({ data: { session: null }, error: null }),
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('invalid');
  });

  it('an error fragment is invalid at once and never calls the server', async () => {
    const client = flowClient();
    const flow = createRecoveryFlow({ client, arrival: { kind: 'link_error' } });
    expect(flow.getState().phase).toBe('invalid');
    await flow.establish();
    expect(client.auth.setSession).not.toHaveBeenCalled();
  });

  it('no connection is "unreachable", and a retry reaches the server again with the same link', async () => {
    let attempt = 0;
    const client = flowClient({
      setSession: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ data: { session: { user: {} } }, error: null });
      },
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('unreachable');
    await flow.establish();
    expect(flow.getState().phase).toBe('ready');
    expect(client.auth.setSession).toHaveBeenLastCalledWith({
      access_token: 'AT',
      refresh_token: 'RT',
    });
  });

  it('a gateway failure is unreachable, not "your link is dead"', async () => {
    const client = flowClient({
      setSession: () =>
        Promise.resolve({
          data: { session: null, user: null },
          error: { name: 'AuthRetryableFetchError', status: 502 },
        }),
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('unreachable');
  });

  it('a request that never settles is unreachable', async () => {
    vi.useFakeTimers();
    try {
      const client = flowClient({ setSession: () => new Promise(() => {}) });
      const flow = createRecoveryFlow({ client, arrival: tokenArrival, timeoutMs: 1000 });
      const pending = flow.establish();
      await vi.advanceTimersByTimeAsync(1001);
      await pending;
      expect(flow.getState().phase).toBe('unreachable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a login with an authenticator app is told so and its link session is ended, not used', async () => {
    const client = flowClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('mfa');
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a login whose authenticator level cannot be read still gets the form (the server’s refusal is the backstop)', async () => {
    const client = flowClient();
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error('boom'));
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('ready');
  });

  it('saves the password, clears the one-time flag, ends the OTHER sessions, and is done', async () => {
    const client = flowClient();
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    const result = await flow.save('correct-horse');
    expect(result.error).toBeNull();
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      password: 'correct-horse',
      data: { must_change_password: false },
    });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(flow.getState()).toEqual({ phase: 'done', othersSignedOut: true });
  });

  it('ends other sessions only AFTER the password is saved', async () => {
    const order = [];
    const client = flowClient({
      updateUser: () => {
        order.push('updateUser');
        return Promise.resolve({ data: {}, error: null });
      },
      signOut: () => {
        order.push('signOut');
        return Promise.resolve({ error: null });
      },
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    await flow.save('correct-horse');
    expect(order).toEqual(['updateUser', 'signOut']);
  });

  it('a refused password keeps the form and signs nobody out', async () => {
    const client = flowClient({
      updateUser: () => Promise.resolve({ data: null, error: { code: 'weak_password' } }),
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    const result = await flow.save('correct-horse');
    expect(result.error.code).toBe('weak_password');
    expect(flow.getState().phase).toBe('ready');
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('a saved password whose sign-out of other sessions failed is still done, and says so', async () => {
    const client = flowClient({ signOut: () => Promise.resolve({ error: { message: 'nope' } }) });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    const result = await flow.save('correct-horse');
    expect(result.error).toBeNull();
    expect(flow.getState()).toEqual({ phase: 'done', othersSignedOut: false });
  });

  it('a sign-out of other sessions that throws is the same', async () => {
    const client = flowClient({ signOut: () => Promise.reject(new TypeError('Failed to fetch')) });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    await flow.save('correct-horse');
    expect(flow.getState()).toEqual({ phase: 'done', othersSignedOut: false });
  });

  it('a server fault while checking the link is "unreachable" (the link is kept for a retry), a refusal is "invalid"', async () => {
    let attempt = 0;
    const client = flowClient({
      setSession: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.resolve({
            data: { session: null, user: null },
            error: { name: 'AuthApiError', status: 500 },
          });
        }
        return Promise.resolve({ data: { session: { user: {} } }, error: null });
      },
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    await flow.establish();
    expect(flow.getState().phase).toBe('unreachable');
    await flow.establish();
    expect(flow.getState().phase).toBe('ready');
    expect(client.auth.setSession).toHaveBeenLastCalledWith({
      access_token: 'AT',
      refresh_token: 'RT',
    });
    const refused = flowClient({
      setSession: () =>
        Promise.resolve({
          data: { session: null, user: null },
          error: { name: 'AuthApiError', status: 400 },
        }),
    });
    const other = createRecoveryFlow({ client: refused, arrival: tokenArrival });
    await other.establish();
    expect(other.getState().phase).toBe('invalid');
  });

  it('leaving while the link is still being checked is final: the answer, when it comes, reopens nothing', async () => {
    let release;
    const client = flowClient({
      setSession: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { session: { user: {} } }, error: null });
        }),
    });
    const flow = createRecoveryFlow({ client, arrival: tokenArrival });
    const pending = flow.establish();
    flow.close();
    release();
    await pending;
    expect(flow.getState().phase).toBe('closed');
    expect(flow.isOpen()).toBe(false);
    // ... and a late failure does not reopen it either.
    const failing = flowClient({
      setSession: () => new Promise((_, reject) => setTimeout(() => reject(new Error('x')), 5)),
    });
    const second = createRecoveryFlow({ client: failing, arrival: tokenArrival });
    const secondPending = second.establish();
    second.close();
    await secondPending;
    expect(second.isOpen()).toBe(false);
  });

  it('the session ending (sign out here or in another tab) closes a flow that needs one, and only those', async () => {
    for (const setup of ['ready', 'done']) {
      const client = flowClient();
      const flow = createRecoveryFlow({ client, arrival: tokenArrival });
      await flow.establish();
      if (setup === 'done') await flow.save('correct-horse');
      expect(flow.sessionEnded(), setup).toBe(true);
      expect(flow.isOpen(), setup).toBe(false);
    }
    // While the link is still being checked its session does not exist yet: a sign-out then is a stale one.
    const checking = createRecoveryFlow({ client: flowClient(), arrival: tokenArrival });
    expect(checking.sessionEnded()).toBe(false);
    expect(checking.getState().phase).toBe('verifying');
    // The dead-link and authenticator screens expect no session (the mfa one ended it on purpose).
    const dead = createRecoveryFlow({ client: flowClient(), arrival: { kind: 'link_error' } });
    expect(dead.sessionEnded()).toBe(false);
    expect(dead.getState().phase).toBe('invalid');
    const mfa = createRecoveryFlow({
      client: flowClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } }),
      arrival: tokenArrival,
    });
    await mfa.establish();
    expect(mfa.sessionEnded()).toBe(false);
    expect(mfa.getState().phase).toBe('mfa');
  });

  it('closing leaves the flow, and nothing reopens it', async () => {
    const flow = createRecoveryFlow({ client: flowClient(), arrival: tokenArrival });
    await flow.establish();
    flow.close();
    expect(flow.isOpen()).toBe(false);
    await flow.establish();
    expect(flow.isOpen()).toBe(false);
  });
});
