import { describe, it, expect, vi } from 'vitest';
import { handleRequest, generatePassword } from './handler.js';
import { generatePassword as teamAccountsGeneratePassword } from '../team-accounts/handler.js';

const ACTOR = '00000000-0000-0000-0000-0000000000a1';
const NEW_USER = '00000000-0000-0000-0000-000000000033';
const TOKEN = 'tok-CANARY-token-123';
const PASSWORD_SHAPE = /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/;
// every raw error message and code the fakes inject carries this, so a log line or a response that repeats one is caught
const CANARY = /CANARY|hunter2|secret detail/;
const REFUSAL = {
  admin_required: {
    code: '42501',
    hint: 'admin_required',
    message: 'platform admin required CANARY',
  },
  admin_mfa_required: {
    code: '42501',
    hint: 'admin_mfa_required',
    message: 'a second factor is required CANARY',
  },
  admin_session_ended: {
    code: '42501',
    hint: 'admin_session_ended',
    message: 'the session has ended CANARY',
  },
};

// A counting byte source: deterministic, and never produces a byte the sampler would reject.
function steadyBytes() {
  let n = 0;
  return (count) => Uint8Array.from({ length: count }, () => n++ % 200);
}

// Fake dependencies recording every call. `opts` shapes the answers.
function makeDeps(opts = {}) {
  const calls = {
    getUser: [],
    userRpc: [],
    adminCreated: 0,
    createUser: [],
    deleteUser: [],
    adminRpc: [],
    log: [],
    order: [],
  };
  const userClient = {
    auth: {
      getUser: async (token) => {
        calls.getUser.push(token);
        calls.order.push('getUser');
        if (opts.getUserThrows) throw new Error('network CANARY');
        if (opts.getUserError) return { data: { user: null }, error: new Error('bad jwt CANARY') };
        if (opts.noCallerId) return { data: { user: {} }, error: null };
        return { data: { user: { id: ACTOR } }, error: null };
      },
    },
    rpc: async (name, args) => {
      calls.userRpc.push([name, args]);
      calls.order.push(name);
      if (opts.rpcThrows) throw new Error('network CANARY');
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      return { data: 'allowed' in opts ? opts.allowed : true, error: null };
    },
  };
  const adminClient = {
    auth: {
      admin: {
        createUser: async (args) => {
          calls.createUser.push(args);
          calls.order.push('createUser');
          if (opts.createThrows) throw new Error('network CANARY');
          if (opts.createError) return { data: { user: null }, error: opts.createError };
          return { data: { user: opts.noUserId ? {} : { id: NEW_USER } }, error: null };
        },
        // every argument is recorded, so a soft delete (deleteUser(id, true)) is visible
        deleteUser: async (...args) => {
          calls.deleteUser.push(args.length > 1 ? args : args[0]);
          calls.order.push('deleteUser');
          if (opts.deleteThrows) throw new Error('network CANARY');
          return { data: {}, error: opts.deleteError ?? null };
        },
      },
    },
    rpc: async (name, args) => {
      calls.adminRpc.push([name, args]);
      calls.order.push(name);
      if (opts.auditThrows) throw new Error('network CANARY');
      return { data: null, error: opts.auditError ?? null };
    },
  };
  return {
    calls,
    deps: {
      createUserClient: (header) => {
        calls.userClientHeader = header;
        return userClient;
      },
      createAdminClient: () => {
        calls.adminCreated += 1;
        calls.order.push('createAdminClient');
        return adminClient;
      },
      randomBytes: steadyBytes(),
      log: (...args) => calls.log.push(args),
    },
  };
}

function post(body, { auth = `Bearer ${TOKEN}`, method = 'POST', raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://example.test/admin-accounts', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : (raw ?? JSON.stringify(body)),
  });
}

const create = (email = 'New.Owner@Example.com') => post({ action: 'create_owner', email });

describe('generatePassword', () => {
  it('is three groups of four from a 31-symbol alphabet without the look-alikes', () => {
    for (let i = 0; i < 50; i += 1) {
      // a fixed spread of bytes (not random: a test that can fail on a lucky draw proves nothing)
      const bytes = Uint8Array.from({ length: 24 }, (_, k) => (k * 37 + i * 11) % 248);
      const password = generatePassword(() => bytes);
      expect(password).toMatch(PASSWORD_SHAPE);
      expect(password).not.toMatch(/[ilo01]/);
    }
  });

  it('maps byte values to the alphabet in order: the exact symbols, not just the shape', () => {
    const ramp = (offset) => () => Uint8Array.from({ length: 24 }, (_, k) => k + offset);
    expect(generatePassword(ramp(0))).toBe('abcd-efgh-jkmn');
    expect(generatePassword(ramp(12))).toBe('pqrs-tuvw-xyz2');
    expect(generatePassword(() => new Uint8Array(24).fill(30))).toBe('9999-9999-9999');
  });

  it('accepts bytes below 248 (byte 247 is the last one kept) and throws away 248 and up', () => {
    const chunks = [
      new Uint8Array(24).fill(255),
      new Uint8Array(24).fill(248),
      new Uint8Array(24).fill(247),
    ];
    const source = vi.fn(() => chunks.shift());
    // 247 % 31 = 30 -> '9'; the two earlier chunks were rejected whole
    expect(generatePassword(source)).toBe('9999-9999-9999');
    expect(source).toHaveBeenCalledTimes(3);
  });

  it('gives exactly the same password as the team-accounts function for the same bytes (the copy cannot drift)', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const bytes = (count) =>
        Uint8Array.from({ length: count }, (_, k) => (k * 53 + seed * 7) % 256);
      expect(generatePassword(bytes)).toBe(teamAccountsGeneratePassword(bytes));
    }
  });
});

describe('handleRequest — shape of the request', () => {
  it('answers a preflight with CORS headers and no body', async () => {
    const { deps } = makeDeps();
    const response = await handleRequest(post(null, { method: 'OPTIONS', auth: null }), deps);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toMatch(/authorization/);
  });

  it('refuses anything but POST', async () => {
    const { deps } = makeDeps();
    expect((await handleRequest(post(null, { method: 'GET' }), deps)).status).toBe(405);
  });

  it.each([[null], [''], ['Basic abc'], ['Bearer'], ['Bearer a b']])(
    'is 401 with no usable bearer token (%s), before anything is asked of anyone',
    async (auth) => {
      const { deps, calls } = makeDeps();
      const response = await handleRequest(
        post({ action: 'create_owner', email: 'a@b.co' }, { auth }),
        deps,
      );
      expect(response.status).toBe(401);
      expect(calls.getUser).toEqual([]);
      expect(calls.adminCreated).toBe(0);
    },
  );

  it('sends every response with Cache-Control: no-store', async () => {
    const { deps } = makeDeps();
    for (const request of [create(), post(null, { auth: null }), post(null, { method: 'GET' })]) {
      expect((await handleRequest(request, deps)).headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('handleRequest — a caller who is not verified never reaches the body', () => {
  it('does not even READ the request body of an unauthenticated or refused caller', async () => {
    for (const opts of [
      { getUserError: true },
      { rpcError: REFUSAL.admin_required },
      { rpcError: REFUSAL.admin_mfa_required },
      { rpcError: REFUSAL.admin_session_ended },
      { allowed: false },
    ]) {
      const { deps, calls } = makeDeps(opts);
      const json = vi.fn(() => {
        throw new Error('the body was read');
      });
      const request = {
        method: 'POST',
        headers: new Headers({ Authorization: `Bearer ${TOKEN}` }),
        json,
      };
      const response = await handleRequest(request, deps);
      expect([401, 403]).toContain(response.status);
      expect(json).not.toHaveBeenCalled();
      expect(calls.adminCreated).toBe(0);
    }
  });

  it('gives a refused caller the refusal, not a validation answer, even for a garbage body', async () => {
    const { deps } = makeDeps({ rpcError: REFUSAL.admin_required });
    const response = await handleRequest(post(null, { raw: 'not json' }), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).hint).toBe('admin_required');
  });
});

describe('handleRequest — the body, for a verified admin', () => {
  it('is 400 for a body that is not a JSON object, and creates nothing', async () => {
    for (const raw of ['not json', '[1]', 'null']) {
      const { deps, calls } = makeDeps();
      expect((await handleRequest(post(null, { raw }), deps)).status).toBe(400);
      expect(calls.adminCreated).toBe(0);
      expect(calls.createUser).toEqual([]);
    }
  });

  it.each([[undefined], ['add'], ['reset'], ['CREATE_OWNER'], [7]])(
    'is 400 for the unknown action %s, and creates nothing',
    async (action) => {
      const { deps, calls } = makeDeps();
      const response = await handleRequest(post({ action, email: 'a@b.co' }), deps);
      expect(response.status).toBe(400);
      expect(calls.adminCreated).toBe(0);
      expect(calls.createUser).toEqual([]);
    },
  );

  it.each([
    [undefined],
    [''],
    ['   '],
    ['no-at-sign'],
    ['a@b'],
    ['a b@c.co'],
    [42],
    ['a@b.' + 'c'.repeat(251)],
  ])('is 400 for the email %s', async (email) => {
    const { deps, calls } = makeDeps();
    const response = await handleRequest(post({ action: 'create_owner', email }), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Enter a valid email address.');
    expect(calls.adminCreated).toBe(0);
  });

  it('accepts an email of exactly 254 characters and refuses one of 255', async () => {
    const at254 = 'a@b.' + 'c'.repeat(250);
    expect(at254).toHaveLength(254);
    const { deps, calls } = makeDeps();
    expect((await handleRequest(post({ action: 'create_owner', email: at254 }), deps)).status).toBe(
      201,
    );
    expect(calls.createUser[0].email).toBe(at254);
    const over = makeDeps();
    expect(
      (await handleRequest(post({ action: 'create_owner', email: at254 + 'c' }), over.deps)).status,
    ).toBe(400);
  });
});

describe('handleRequest — who may do this', () => {
  it('is 401 when Auth does not accept the token, and never creates the service-role client', async () => {
    const { deps, calls } = makeDeps({ getUserError: true });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(401);
    expect(calls.userRpc).toEqual([]);
    expect(calls.adminCreated).toBe(0);
  });

  it('is 401 when Auth answers without a user id (there would be no actor to record), and creates nothing', async () => {
    const { deps, calls } = makeDeps({ noCallerId: true });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(401);
    expect(calls.userRpc).toEqual([]);
    expect(calls.adminCreated).toBe(0);
  });

  it('asks the DATABASE, as the caller, through admin_can_provision (and passes their header on)', async () => {
    const { deps, calls } = makeDeps();
    await handleRequest(create(), deps);
    expect(calls.userClientHeader).toBe(`Bearer ${TOKEN}`);
    expect(calls.getUser).toEqual([TOKEN]);
    expect(calls.userRpc).toEqual([['admin_can_provision', undefined]]);
  });

  it('is 403 admin_required for a signed-in non-admin, creates nothing and never builds the service client', async () => {
    const { deps, calls } = makeDeps({ rpcError: REFUSAL.admin_required });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'This account does not have access to the admin console.',
      hint: 'admin_required',
    });
    expect(calls.adminCreated).toBe(0);
    expect(calls.createUser).toEqual([]);
    expect(calls.adminRpc).toEqual([]);
  });

  it('is 403 admin_mfa_required for an admin without a fresh second factor, with its own message, and creates nothing', async () => {
    const { deps, calls } = makeDeps({ rpcError: REFUSAL.admin_mfa_required });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Verify with your authenticator app to continue.',
      hint: 'admin_mfa_required',
    });
    expect(calls.adminCreated).toBe(0);
    expect(calls.createUser).toEqual([]);
  });

  it('is 401 admin_session_ended when the session behind the token has ended, and creates nothing', async () => {
    const { deps, calls } = makeDeps({ rpcError: REFUSAL.admin_session_ended });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Sign in again.', hint: 'admin_session_ended' });
    expect(calls.adminCreated).toBe(0);
    expect(calls.createUser).toEqual([]);
  });

  it('is 403 when the check answers anything but true (even without an error)', async () => {
    for (const allowed of [false, null, undefined, 'true', 1]) {
      const { deps, calls } = makeDeps({ allowed });
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(403);
      expect(calls.adminCreated).toBe(0);
    }
  });

  it('is 500 with a generic message for any other database failure, and does not leak its text', async () => {
    const { deps, calls } = makeDeps({
      rpcError: { code: '08006', message: 'connection to server failed: secret detail CANARY' },
    });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret detail|08006|CANARY/);
    expect(calls.adminCreated).toBe(0);
  });

  it('is a clean 500 (with the normal headers), not an uncaught exception, when Auth or the database cannot be reached', async () => {
    for (const opts of [{ getUserThrows: true }, { rpcThrows: true }]) {
      const { deps, calls } = makeDeps(opts);
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(JSON.stringify(await response.json())).not.toMatch(CANARY);
      expect(calls.adminCreated).toBe(0);
      expect(calls.createUser).toEqual([]);
      expect(JSON.stringify(calls.log)).not.toMatch(CANARY);
    }
  });

  it('creates the service-role client only AFTER the database said yes', async () => {
    const { deps, calls } = makeDeps();
    await handleRequest(create(), deps);
    expect(calls.order.indexOf('admin_can_provision')).toBeGreaterThan(-1);
    expect(calls.order.indexOf('createAdminClient')).toBeGreaterThan(
      calls.order.indexOf('admin_can_provision'),
    );
  });
});

describe('handleRequest — creating the login', () => {
  it('creates a confirmed login with a one-time password, records it, and returns the password once (201)', async () => {
    const { deps, calls } = makeDeps();
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({
      userId: NEW_USER,
      email: 'new.owner@example.com',
      password: expect.stringMatching(PASSWORD_SHAPE),
    });
    expect(calls.createUser).toEqual([
      {
        email: 'new.owner@example.com',
        password: body.password,
        email_confirm: true,
        user_metadata: { must_change_password: true },
      },
    ]);
    expect(calls.adminRpc).toEqual([
      ['admin_record_account_create', { p_actor_id: ACTOR, p_user_id: NEW_USER }],
    ]);
    expect(calls.deleteUser).toEqual([]);
  });

  it('names the CALLER (from Auth) as the actor, never anything in the request body', async () => {
    const { deps, calls } = makeDeps();
    const request = post({
      action: 'create_owner',
      email: 'x@y.co',
      actorId: '00000000-0000-0000-0000-0000000000ff',
      p_actor_id: '00000000-0000-0000-0000-0000000000ff',
    });
    await handleRequest(request, deps);
    expect(calls.adminRpc[0][1].p_actor_id).toBe(ACTOR);
  });

  it('trims and lower-cases the email', async () => {
    const { deps, calls } = makeDeps();
    await handleRequest(create('  Mixed.Case@Example.COM  '), deps);
    expect(calls.createUser[0].email).toBe('mixed.case@example.com');
  });

  it('is 409 for an email that already has an account, with the hint, and records nothing', async () => {
    for (const createError of [
      { code: 'email_exists', message: 'x' },
      { code: 'user_already_exists', message: 'x' },
      { message: 'A user with this email address has already been registered' },
    ]) {
      const { deps, calls } = makeDeps({ createError });
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(409);
      expect((await response.json()).hint).toBe('email_taken');
      expect(calls.adminRpc).toEqual([]);
      expect(calls.deleteUser).toEqual([]);
    }
  });

  it('does NOT read an Auth error that merely says "exists" as a taken email: it stays a generic 500', async () => {
    for (const createError of [
      { message: 'relation "users" already exists CANARY' },
      { message: 'the key does not exist CANARY' },
      { message: 'already CANARY' },
    ]) {
      const { deps, calls } = makeDeps({ createError });
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(500);
      expect(calls.adminRpc).toEqual([]);
    }
  });

  it('says the outcome is UNKNOWN (not "nothing was changed") when the call to Auth throws or names no account', async () => {
    for (const opts of [{ createThrows: true }, { noUserId: true }]) {
      const { deps, calls } = makeDeps(opts);
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.hint).toBe('account_state_unknown');
      expect(body.error).toMatch(/could not confirm whether the login was created/i);
      expect(body.error).not.toMatch(/nothing was changed/i);
      expect(body).not.toHaveProperty('password');
      expect(calls.adminRpc).toEqual([]);
      expect(calls.deleteUser).toEqual([]);
    }
  });

  it('is 500 and generic when Auth fails otherwise, records nothing, and does not leak the error', async () => {
    const { deps, calls } = makeDeps({
      createError: { code: 'unexpected CANARY', message: 'db password is hunter2 CANARY' },
    });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(CANARY);
    expect(calls.adminRpc).toEqual([]);
    expect(calls.deleteUser).toEqual([]);
  });

  it('is 500 when the Auth call itself throws, records nothing, and does not leak the error', async () => {
    const { deps, calls } = makeDeps({ createThrows: true });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(CANARY);
    expect(calls.adminRpc).toEqual([]);
  });

  it('is 500 when Auth answers without a user id, and records nothing', async () => {
    const { deps, calls } = makeDeps({ noUserId: true });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect(calls.adminRpc).toEqual([]);
  });

  it('DELETES the new login (a hard delete: one argument) when the database cannot record it, and says so (500)', async () => {
    const { deps, calls } = makeDeps({ auditError: { code: 'XX000', message: 'boom CANARY' } });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'The login could not be recorded, so it was removed. Try again.',
      hint: 'account_record_failed',
    });
    expect(calls.deleteUser).toEqual([NEW_USER]);
    expect(calls.order.indexOf('deleteUser')).toBeGreaterThan(
      calls.order.indexOf('admin_record_account_create'),
    );
  });

  it('treats a THROWN audit call exactly like a failed one: the login is removed', async () => {
    const { deps, calls } = makeDeps({ auditThrows: true });
    const response = await handleRequest(create(), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).hint).toBe('account_record_failed');
    expect(calls.deleteUser).toEqual([NEW_USER]);
  });

  it('reports a login it could not record AND could not remove, with its id and a stable hint', async () => {
    for (const opts of [
      { auditError: { code: 'XX000' }, deleteError: { code: 'delete_failed CANARY' } },
      { auditError: { code: 'XX000' }, deleteThrows: true },
      { auditThrows: true, deleteThrows: true },
    ]) {
      const { deps, calls } = makeDeps(opts);
      const response = await handleRequest(create(), deps);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.hint).toBe('account_stranded');
      expect(body.userId).toBe(NEW_USER);
      expect(body.error).toMatch(/ask the platform operator to remove it/i);
      expect(body).not.toHaveProperty('password');
      expect(JSON.stringify(body)).not.toMatch(CANARY);
      expect(calls.deleteUser).toEqual([NEW_USER]);
    }
  });
});

describe('handleRequest — nothing secret is ever logged or returned on a failure', () => {
  const scenarios = {
    success: {},
    'email taken': { createError: { code: 'email_exists', message: 'CANARY' } },
    'create fails': { createError: { code: 'unexpected CANARY', message: 'hunter2 CANARY' } },
    'create throws': { createThrows: true },
    'audit fails': { auditError: { code: 'XX000 CANARY', message: 'boom CANARY' } },
    'audit throws': { auditThrows: true },
    'audit and clean-up fail': {
      auditError: { code: 'XX000 CANARY', message: 'CANARY' },
      deleteError: { code: 'd CANARY', message: 'CANARY' },
    },
    'audit and clean-up throw': { auditThrows: true, deleteThrows: true },
    'not an admin': { rpcError: REFUSAL.admin_required },
    'no second factor': { rpcError: REFUSAL.admin_mfa_required },
    'session ended': { rpcError: REFUSAL.admin_session_ended },
    'check fails': { rpcError: { code: '08006 CANARY', message: 'secret detail CANARY' } },
    'token not accepted': { getUserError: true },
  };
  for (const [name, opts] of Object.entries(scenarios)) {
    it(`in the "${name}" path`, async () => {
      const { deps, calls } = makeDeps(opts);
      const response = await handleRequest(create(), deps);
      const logged = JSON.stringify(calls.log);
      const created = calls.createUser[0]?.password;
      if (created) {
        expect(created).toMatch(PASSWORD_SHAPE);
        expect(logged).not.toContain(created);
        if (response.status !== 201) {
          expect(JSON.stringify(await response.json())).not.toContain(created);
        }
      }
      // not the bearer token, not the email, not any raw error message or code
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toMatch(/new\.owner@example\.com/i);
      expect(logged).not.toMatch(CANARY);
    });
  }

  it('logs ids and codes (the actor and the new account) so a stranded login can be found', async () => {
    const { deps, calls } = makeDeps({
      auditError: { code: 'XX000' },
      deleteError: { code: 'd' },
    });
    await handleRequest(create(), deps);
    const events = calls.log.map(([, event]) => event);
    expect(events).toContain('admin_accounts_audit_failed');
    expect(events).toContain('admin_accounts_cleanup_failed');
    expect(JSON.stringify(calls.log)).toContain(NEW_USER);
    expect(JSON.stringify(calls.log)).toContain(ACTOR);
  });

  it('logs the database hint of a failed recording (so the refusals can be told apart), but only if it looks like a hint', async () => {
    const good = makeDeps({
      auditError: { code: '22023', hint: 'account_not_new', message: 'x CANARY' },
    });
    await handleRequest(create(), good.deps);
    const failed = good.calls.log.find(([, event]) => event === 'admin_accounts_audit_failed');
    expect(failed[2]).toEqual({
      actorId: ACTOR,
      userId: NEW_USER,
      code: '22023',
      hint: 'account_not_new',
    });

    const odd = makeDeps({
      auditError: { code: '22023', hint: 'Some Free Text CANARY', message: 'x' },
    });
    await handleRequest(create(), odd.deps);
    const oddFailed = odd.calls.log.find(([, event]) => event === 'admin_accounts_audit_failed');
    expect(oddFailed[2].hint).toBeNull();
    expect(JSON.stringify(odd.calls.log)).not.toMatch(CANARY);
  });

  it('works with no logger injected', async () => {
    const { deps } = makeDeps();
    delete deps.log;
    expect((await handleRequest(create(), deps)).status).toBe(201);
  });
});
