import { describe, it, expect } from 'vitest';
import { handleRequest } from './handler.js';

const TOKEN = 'A'.repeat(43);
const EMAIL = 'Person@Example.com';
// every raw error message the fakes inject carries this, so a log line or a response that repeats one is caught
const CANARY = /CANARY/;

function makeDeps(opts = {}) {
  const calls = { begin: [], createUser: [], otp: [], log: [], order: [], admin: 0, otpClients: 0 };
  const admin = {
    rpc: async (name, args) => {
      calls.begin.push([name, args]);
      calls.order.push('begin');
      if (opts.beginThrows) throw new Error('network CANARY');
      if (opts.beginError) return { data: null, error: opts.beginError };
      return { data: opts.begin ?? { status: 'ok', display_name: 'Aisha' }, error: null };
    },
    auth: {
      admin: {
        createUser: async (args) => {
          calls.createUser.push(args);
          calls.order.push('createUser');
          if (opts.createThrows) throw new Error('network CANARY');
          return { data: null, error: opts.createError ?? null };
        },
      },
    },
  };
  const otp = {
    auth: {
      signInWithOtp: async (args) => {
        calls.otp.push(args);
        calls.order.push('otp');
        if (opts.otpThrows) throw new Error('network CANARY');
        return { data: {}, error: opts.otpError ?? null };
      },
    },
  };
  return {
    calls,
    deps: {
      createAdminClient: () => {
        calls.admin += 1;
        return admin;
      },
      createOtpClient: () => {
        calls.otpClients += 1;
        return otp;
      },
      log: (level, event, fields) => calls.log.push({ level, event, ...fields }),
    },
  };
}

const post = (body, method = 'POST') =>
  new Request('http://x/seduh-claim', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function call(body, opts) {
  const m = makeDeps(opts);
  const response = await handleRequest(post(body), m.deps);
  const text = await response.text();
  return { ...m, response, text, json: text ? JSON.parse(text) : null };
}

describe('seduh-claim: request shape', () => {
  it('answers OPTIONS and refuses other methods', async () => {
    const m = makeDeps();
    expect(
      (await handleRequest(new Request('http://x', { method: 'OPTIONS' }), m.deps)).status,
    ).toBe(204);
    expect((await handleRequest(new Request('http://x', { method: 'GET' }), m.deps)).status).toBe(
      405,
    );
    expect(m.calls.admin).toBe(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['an array', '[]'],
    ['too large', JSON.stringify({ token: TOKEN, email: EMAIL, pad: 'x'.repeat(3000) })],
  ])('400 for a body that is %s, before any client is made', async (_n, body) => {
    const r = await call(body);
    expect(r.response.status).toBe(400);
    expect(r.json.hint).toBe('bad_request');
    expect(r.calls.admin).toBe(0);
  });

  it.each([[''], ['short'], [null], [42], ['A'.repeat(44)], ['A'.repeat(42) + '=']])(
    'a token that cannot be one (%j) is link_invalid and touches nothing',
    async (token) => {
      const r = await call({ token, email: EMAIL });
      expect(r.response.status).toBe(404);
      expect(r.json.hint).toBe('link_invalid');
      expect(r.calls.admin).toBe(0);
    },
  );

  it.each([[''], ['nope'], ['a@b'], [null], [`${'x'.repeat(300)}@b.co`]])(
    'a bad email (%j) is refused before the database is asked',
    async (email) => {
      const r = await call({ token: TOKEN, email });
      expect(r.response.status).toBe(400);
      expect(r.json.hint).toBe('bad_email');
      expect(r.calls.begin).toHaveLength(0);
    },
  );
});

describe('seduh-claim: the token is checked FIRST and no email is sent for a bad one', () => {
  it.each([
    ['invalid', 404, 'link_invalid'],
    ['used', 410, 'link_used'],
    ['revoked', 410, 'link_revoked'],
    ['expired', 410, 'link_expired'],
    ['unavailable', 410, 'identity_unavailable'],
    ['too_many', 429, 'too_many_codes'],
  ])('%s -> %i %s, no login made, no email', async (status, http, hint) => {
    const r = await call({ token: TOKEN, email: EMAIL }, { begin: { status } });
    expect(r.response.status).toBe(http);
    expect(r.json.hint).toBe(hint);
    expect(r.calls.createUser).toHaveLength(0);
    expect(r.calls.otp).toHaveLength(0);
    expect(r.calls.otpClients).toBe(0);
  });

  it('an unknown status from the database is a 500, never a send', async () => {
    const r = await call({ token: TOKEN, email: EMAIL }, { begin: { status: 'weird' } });
    expect(r.response.status).toBe(500);
    expect(r.calls.otp).toHaveLength(0);
  });

  it.each([
    ['an error', { beginError: { code: 'XX000', message: 'boom CANARY' } }],
    ['a throw', { beginThrows: true }],
  ])('%s from the database is a 500 and sends nothing', async (_n, opts) => {
    const r = await call({ token: TOKEN, email: EMAIL }, opts);
    expect(r.response.status).toBe(500);
    expect(r.text).not.toMatch(CANARY);
    expect(JSON.stringify(r.calls.log)).not.toMatch(CANARY);
    expect(r.calls.otp).toHaveLength(0);
  });
});

describe('seduh-claim: a good token', () => {
  it('creates the login (confirmed, no password), then emails a code that cannot create a user', async () => {
    const r = await call({ token: TOKEN, email: `  ${EMAIL} ` });
    expect(r.response.status).toBe(200);
    expect(r.json).toEqual({ ok: true, display_name: 'Aisha' });
    expect(r.calls.order).toEqual(['begin', 'createUser', 'otp']);
    expect(r.calls.begin[0]).toEqual(['seduh_claim_begin', { p_token: TOKEN }]);
    expect(r.calls.createUser[0]).toEqual({ email: 'person@example.com', email_confirm: true });
    expect(r.calls.otp[0]).toEqual({
      email: 'person@example.com',
      options: { shouldCreateUser: false },
    });
  });

  it('answers the same when the email already has a login', async () => {
    const taken = await call(
      { token: TOKEN, email: EMAIL },
      { createError: { code: 'email_exists', message: 'x' } },
    );
    const fresh = await call({ token: TOKEN, email: EMAIL });
    expect(taken.response.status).toBe(200);
    expect(taken.json).toEqual(fresh.json);
    expect(taken.calls.otp).toHaveLength(1);
  });

  it('accepts the older "already registered" wording as taken, but not an unrelated "already exists"', async () => {
    const old = await call(
      { token: TOKEN, email: EMAIL },
      { createError: { message: 'A user with this email address has already been registered' } },
    );
    expect(old.response.status).toBe(200);
    const other = await call(
      { token: TOKEN, email: EMAIL },
      { createError: { code: 'unexpected_failure', message: 'relation already exists CANARY' } },
    );
    expect(other.response.status).toBe(500);
    expect(other.calls.otp).toHaveLength(0);
  });

  it('a failure creating the login is a 500 and sends nothing', async () => {
    for (const opts of [
      { createError: { code: 'unexpected_failure', message: 'CANARY' } },
      { createThrows: true },
    ]) {
      const r = await call({ token: TOKEN, email: EMAIL }, opts);
      expect(r.response.status).toBe(500);
      expect(r.calls.otp).toHaveLength(0);
      expect(r.text).not.toMatch(CANARY);
      expect(JSON.stringify(r.calls.log)).not.toMatch(CANARY);
    }
  });

  it('Auth rate limiting is a 429 email_rate_limited; any other send failure is a 502', async () => {
    const limited = await call(
      { token: TOKEN, email: EMAIL },
      { otpError: { status: 429, code: 'over_email_send_rate_limit', message: 'CANARY' } },
    );
    expect(limited.response.status).toBe(429);
    expect(limited.json.hint).toBe('email_rate_limited');
    const failed = await call(
      { token: TOKEN, email: EMAIL },
      { otpError: { status: 500, code: 'unexpected_failure', message: 'CANARY' } },
    );
    expect(failed.response.status).toBe(502);
    expect(failed.json.hint).toBe('email_send_failed');
    const threw = await call({ token: TOKEN, email: EMAIL }, { otpThrows: true });
    expect(threw.response.status).toBe(502);
    for (const r of [limited, failed, threw]) {
      expect(r.text).not.toMatch(CANARY);
      expect(JSON.stringify(r.calls.log)).not.toMatch(CANARY);
    }
  });

  it('never logs the token or the email', async () => {
    for (const opts of [
      {},
      { begin: { status: 'used' } },
      { otpError: { code: 'x_y', message: 'CANARY' } },
    ]) {
      const r = await call({ token: TOKEN, email: EMAIL }, opts);
      const logged = JSON.stringify(r.calls.log);
      expect(logged).not.toContain(TOKEN);
      expect(logged.toLowerCase()).not.toContain('example.com');
    }
  });

  it('the response carries no id, phone or hash, only ok and the display name', async () => {
    const r = await call(
      { token: TOKEN, email: EMAIL },
      { begin: { status: 'ok', display_name: null } },
    );
    expect(Object.keys(r.json).sort()).toEqual(['display_name', 'ok']);
    expect(r.response.headers.get('Cache-Control')).toBe('no-store');
  });
});
