import { describe, it, expect, vi } from 'vitest';
import { handleRequest, generatePassword } from './handler.js';

const ORG = '00000000-0000-0000-0000-0000000000a0';
const MEMBER = '00000000-0000-0000-0000-000000000002';
const NEW_USER = '00000000-0000-0000-0000-000000000033';
const PASSWORD_SHAPE = /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/;

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
    updateUserById: [],
    deleteUser: [],
    adminRpc: [],
  };
  const userClient = {
    auth: {
      getUser: async (token) => {
        calls.getUser.push(token);
        if (opts.getUserError) return { data: { user: null }, error: new Error('bad jwt') };
        return { data: { user: { id: 'caller' } }, error: null };
      },
    },
    rpc: async (name, args) => {
      calls.userRpc.push([name, args]);
      if (opts.rpcError) return { data: null, error: new Error('db down: secret detail') };
      return { data: opts.allowed ?? true, error: null };
    },
  };
  const adminClient = {
    auth: {
      admin: {
        createUser: async (args) => {
          calls.createUser.push(args);
          if (opts.createError) return { data: { user: null }, error: opts.createError };
          return { data: { user: opts.noUserId ? {} : { id: NEW_USER } }, error: null };
        },
        updateUserById: async (id, args) => {
          calls.updateUserById.push([id, args]);
          return { data: {}, error: opts.updateError ?? null };
        },
        deleteUser: async (id) => {
          calls.deleteUser.push(id);
          return { data: {}, error: null };
        },
      },
    },
    rpc: async (name, args) => {
      calls.adminRpc.push([name, args]);
      return { data: null, error: opts.addMemberError ?? null };
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
        return adminClient;
      },
      randomBytes: steadyBytes(),
    },
  };
}

function post(body, { auth = 'Bearer tok-123', method = 'POST', raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://example.test/team-accounts', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : (raw ?? JSON.stringify(body)),
  });
}

describe('generatePassword', () => {
  it('is three groups of four from a 31-symbol alphabet without the look-alikes', () => {
    for (let i = 0; i < 50; i += 1) {
      const bytes = Uint8Array.from({ length: 24 }, () => Math.floor(Math.random() * 248));
      const password = generatePassword(() => bytes);
      expect(password).toMatch(PASSWORD_SHAPE);
      expect(password).not.toMatch(/[ilo01]/);
    }
  });

  it('turns bytes into symbols in order (byte 0 is "a", byte 30 is "9")', () => {
    expect(generatePassword(() => new Uint8Array(24))).toBe('aaaa-aaaa-aaaa');
    expect(generatePassword(() => new Uint8Array(24).fill(30))).toBe('9999-9999-9999');
  });

  it('throws away bytes that would make some symbols likelier (248 and up) and asks for more', () => {
    const chunks = [new Uint8Array(24).fill(255), new Uint8Array(24).fill(248), new Uint8Array(24)];
    const source = vi.fn(() => chunks.shift());
    expect(generatePassword(source)).toBe('aaaa-aaaa-aaaa');
    expect(source).toHaveBeenCalledTimes(3);
  });

  it('gives every symbol an equal chance over the accepted range', () => {
    const counts = new Map();
    for (let byte = 0; byte < 248; byte += 1) {
      const symbol = generatePassword(() => new Uint8Array(24).fill(byte))[0];
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    expect(counts.size).toBe(31);
    expect(new Set(counts.values())).toEqual(new Set([8]));
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
    'refuses a request whose Authorization is %j, before touching anything',
    async (auth) => {
      const { deps, calls } = makeDeps();
      const response = await handleRequest(
        post({ action: 'add', orgId: ORG, email: 'a@b.com' }, { auth }),
        deps,
      );
      expect(response.status).toBe(401);
      expect(calls.getUser).toHaveLength(0);
      expect(calls.adminCreated).toBe(0);
    },
  );

  it.each([
    ['a body that is not JSON', undefined, '{nope'],
    ['a body that is not an object', undefined, '"hello"'],
    ['an unknown action', { action: 'delete', orgId: ORG }],
    ['no action', { orgId: ORG, email: 'a@b.com' }],
    ['an org id that is not a uuid', { action: 'add', orgId: 'nope', email: 'a@b.com' }],
    ['no org id', { action: 'add', email: 'a@b.com' }],
    ['no email on add', { action: 'add', orgId: ORG }],
    ['a blank email', { action: 'add', orgId: ORG, email: '   ' }],
    ['an email with no domain', { action: 'add', orgId: ORG, email: 'someone' }],
    ['an email with a space', { action: 'add', orgId: ORG, email: 'some one@b.com' }],
    [
      'an email over 254 characters',
      { action: 'add', orgId: ORG, email: `${'a'.repeat(250)}@b.com` },
    ],
    ['a non-string email', { action: 'add', orgId: ORG, email: 42 }],
    ['no user id on reset', { action: 'reset', orgId: ORG }],
    ['a user id that is not a uuid', { action: 'reset', orgId: ORG, userId: 'nope' }],
  ])(
    'rejects %s with a 400, before asking the database or Auth anything',
    async (_label, body, raw) => {
      const { deps, calls } = makeDeps();
      const response = await handleRequest(post(body, { raw }), deps);
      expect(response.status).toBe(400);
      expect(calls.getUser).toHaveLength(0);
      expect(calls.userRpc).toHaveLength(0);
      expect(calls.adminCreated).toBe(0);
    },
  );
});

describe('handleRequest — who is asking, and may they', () => {
  const addBody = { action: 'add', orgId: ORG, email: 'new@example.com' };

  it('forwards the caller’s own Authorization header and checks the token with Auth', async () => {
    const { deps, calls } = makeDeps();
    await handleRequest(post(addBody), deps);
    expect(calls.userClientHeader).toBe('Bearer tok-123');
    expect(calls.getUser).toEqual(['tok-123']);
  });

  it('401s a token Auth does not accept, and never builds the admin client', async () => {
    const { deps, calls } = makeDeps({ getUserError: true });
    const response = await handleRequest(post(addBody), deps);
    expect(response.status).toBe(401);
    expect(calls.userRpc).toHaveLength(0);
    expect(calls.adminCreated).toBe(0);
  });

  it('403s a caller the database says may not manage the team — and never builds the admin client', async () => {
    const { deps, calls } = makeDeps({ allowed: false });
    const response = await handleRequest(post(addBody), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('Only the owner can manage the team.');
    expect(calls.adminCreated).toBe(0);
    expect(calls.createUser).toHaveLength(0);
  });

  it('treats anything but an exact true as a refusal (null, "true", 1)', async () => {
    for (const allowed of [null, 'true', 1, undefined]) {
      const { deps, calls } = makeDeps({ allowed });
      // makeDeps uses `?? true` for undefined, so pass explicit values through a custom client
      deps.createUserClient = () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'c' } }, error: null }) },
        rpc: async () => ({ data: allowed, error: null }),
      });
      const response = await handleRequest(post(addBody), deps);
      expect(response.status).toBe(403);
      expect(calls.adminCreated).toBe(0);
    }
  });

  it('500s, without leaking the database’s words, when the owner check itself fails — admin untouched', async () => {
    const { deps, calls } = makeDeps({ rpcError: true });
    const response = await handleRequest(post(addBody), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret detail|db down/);
    expect(calls.adminCreated).toBe(0);
  });

  it('asks about the org alone on add, and about the named member on reset', async () => {
    const add = makeDeps();
    await handleRequest(post(addBody), add.deps);
    expect(add.calls.userRpc).toEqual([['team_can_manage', { p_org_id: ORG, p_user_id: null }]]);

    const reset = makeDeps();
    await handleRequest(post({ action: 'reset', orgId: ORG, userId: MEMBER }), reset.deps);
    expect(reset.calls.userRpc).toEqual([
      ['team_can_manage', { p_org_id: ORG, p_user_id: MEMBER }],
    ]);
  });
});

describe('handleRequest — add', () => {
  const body = { action: 'add', orgId: ORG, email: '  New.Person@Example.COM ' };

  it('creates a confirmed account with the one-time password and the must-change flag, then attaches it to the org', async () => {
    const { deps, calls } = makeDeps();
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(201);
    const payload = await response.json();

    expect(payload.userId).toBe(NEW_USER);
    expect(payload.email).toBe('new.person@example.com'); // trimmed and lower-cased
    expect(payload.password).toMatch(PASSWORD_SHAPE);

    expect(calls.createUser).toEqual([
      {
        email: 'new.person@example.com',
        password: payload.password, // the one that was shown is the one that was set
        email_confirm: true,
        user_metadata: { must_change_password: true },
      },
    ]);
    expect(calls.adminRpc).toEqual([['team_add_member', { p_org_id: ORG, p_user_id: NEW_USER }]]);
    expect(calls.deleteUser).toHaveLength(0);
  });

  it('is never cached', async () => {
    const { deps } = makeDeps();
    const response = await handleRequest(post(body), deps);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('gives each account its own password', async () => {
    const { deps } = makeDeps();
    const first = await (await handleRequest(post(body), deps)).json();
    const second = await (await handleRequest(post(body), deps)).json();
    expect(first.password).not.toBe(second.password);
  });

  it.each([
    ['code email_exists', { code: 'email_exists', message: 'x' }],
    ['code user_already_exists', { code: 'user_already_exists', message: 'x' }],
    [
      'the older message wording',
      { message: 'A user with this email address has already been registered' },
    ],
  ])(
    '409s an email that already has an account (%s) and attaches nothing',
    async (_label, createError) => {
      const { deps, calls } = makeDeps({ createError });
      const response = await handleRequest(post(body), deps);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/already has an account/);
      expect(calls.adminRpc).toHaveLength(0);
      expect(calls.deleteUser).toHaveLength(0);
    },
  );

  it('500s any other creation failure without repeating Auth’s words', async () => {
    const { deps, calls } = makeDeps({
      createError: { code: 'weak_password', message: 'leaky internal text' },
    });
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/leaky|weak_password/);
    expect(calls.adminRpc).toHaveLength(0);
  });

  it('if attaching to the org fails, removes the brand-new account rather than leave a login that belongs to nobody', async () => {
    const { deps, calls } = makeDeps({ addMemberError: new Error('constraint') });
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(500);
    expect(calls.deleteUser).toEqual([NEW_USER]);
    expect(JSON.stringify(await response.json())).not.toMatch(/constraint/);
  });

  it('500s, without trying to delete anything, if Auth answers with no user id', async () => {
    const { deps, calls } = makeDeps({ noUserId: true });
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(500);
    expect(calls.adminRpc).toHaveLength(0);
    expect(calls.deleteUser).toHaveLength(0);
  });
});

describe('handleRequest — reset', () => {
  const body = { action: 'reset', orgId: ORG, userId: MEMBER };

  it('sets a new one-time password, flags the account to change it, and returns it once', async () => {
    const { deps, calls } = makeDeps();
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.userId).toBe(MEMBER);
    expect(payload.password).toMatch(PASSWORD_SHAPE);
    expect(calls.updateUserById).toEqual([
      [MEMBER, { password: payload.password, user_metadata: { must_change_password: true } }],
    ]);
  });

  it('creates and attaches nothing', async () => {
    const { deps, calls } = makeDeps();
    await handleRequest(post(body), deps);
    expect(calls.createUser).toHaveLength(0);
    expect(calls.adminRpc).toHaveLength(0);
  });

  it('500s a failed reset without repeating Auth’s words', async () => {
    const { deps } = makeDeps({ updateError: { message: 'leaky internal text' } });
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/leaky/);
  });

  it('403s a reset the database refuses (an owner, a non-member, another org’s person) before touching Auth', async () => {
    const { deps, calls } = makeDeps({ allowed: false });
    const response = await handleRequest(post(body), deps);
    expect(response.status).toBe(403);
    expect(calls.updateUserById).toHaveLength(0);
    expect(calls.adminCreated).toBe(0);
  });
});

function makeLooseDeps(opts = {}) {
  const calls = { createUser: 0, adminCreated: 0, deleteDone: false };
  const userClient = {
    auth: {
      getUser: async () => opts.getUser ?? { data: { user: { id: 'caller' } }, error: null },
    },
    rpc: async () => ({ data: true, error: null }),
  };
  const admin = {
    auth: {
      admin: {
        createUser: async () => {
          calls.createUser += 1;
          if (opts.createError) return { data: { user: null }, error: opts.createError };
          return { data: { user: { id: NEW_USER } }, error: null };
        },
        updateUserById: async () => ({ data: {}, error: null }),
        deleteUser: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          calls.deleteDone = true;
          return { data: {}, error: null };
        },
      },
    },
    rpc: async () => ({ data: null, error: opts.addMemberError ?? null }),
  };
  return {
    calls,
    deps: {
      createUserClient: () => userClient,
      createAdminClient: () => {
        calls.adminCreated += 1;
        return admin;
      },
      randomBytes: (count) => Uint8Array.from({ length: count }, (_, i) => i),
    },
  };
}
const postLoose = (body, auth = 'Bearer tok', raw) =>
  new Request('https://example.test/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: raw ?? JSON.stringify(body),
  });

describe('handleRequest — edges the first pass missed', () => {
  it('an unknown action with an otherwise valid body is a 400 and creates nothing', async () => {
    const { deps, calls } = makeLooseDeps();
    const response = await handleRequest(
      postLoose({ action: 'delete', orgId: ORG, userId: MEMBER }),
      deps,
    );
    expect(response.status).toBe(400);
    expect(calls.createUser).toBe(0);
    expect(calls.adminCreated).toBe(0);
  });
  it('symbols land in order and groups do not overlap', () => {
    expect(generatePassword((n) => Uint8Array.from({ length: n }, (_, i) => i))).toBe(
      'abcd-efgh-jkmn',
    );
  });
  it('the clean-up delete has finished before the 500 is returned', async () => {
    const { deps, calls } = makeLooseDeps({ addMemberError: new Error('x') });
    const response = await handleRequest(
      postLoose({ action: 'add', orgId: ORG, email: 'a@b.com' }),
      deps,
    );
    expect(response.status).toBe(500);
    expect(calls.deleteDone).toBe(true);
  });
  it('uuids: upper-case accepted, anchored', async () => {
    const ok = makeLooseDeps();
    expect(
      (
        await handleRequest(
          postLoose({ action: 'reset', orgId: ORG.toUpperCase(), userId: MEMBER.toUpperCase() }),
          ok.deps,
        )
      ).status,
    ).toBe(200);
    const bad = makeLooseDeps();
    expect(
      (
        await handleRequest(
          postLoose({ action: 'reset', orgId: `x${ORG}`, userId: MEMBER }),
          bad.deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleRequest(
          postLoose({ action: 'reset', orgId: ORG, userId: `${MEMBER}y` }),
          bad.deps,
        )
      ).status,
    ).toBe(400);
  });
  it('scheme is case-insensitive', async () => {
    const { deps } = makeLooseDeps();
    expect(
      (
        await handleRequest(
          postLoose({ action: 'reset', orgId: ORG, userId: MEMBER }, 'bearer tok'),
          deps,
        )
      ).status,
    ).toBe(200);
  });
  it.each([
    ['no dot in the domain', 'a@b', 400],
    ['two @', 'a@@b.com', 400],
    ['exactly 254 characters', `${'a'.repeat(248)}@b.com`, 201],
    ['255 characters', `${'a'.repeat(249)}@b.com`, 400],
  ])('email %s', async (_l, email, status) => {
    const { deps } = makeLooseDeps();
    expect(
      (await handleRequest(postLoose({ action: 'add', orgId: ORG, email }), deps)).status,
    ).toBe(status);
  });
  it.each([
    ['"already exists" wording', { message: 'User already exists' }],
    [
      'upper-case wording',
      { message: 'A user with this email address has ALREADY BEEN REGISTERED' },
    ],
  ])('email-taken: %s', async (_l, createError) => {
    const { deps } = makeLooseDeps({ createError });
    expect(
      (await handleRequest(postLoose({ action: 'add', orgId: ORG, email: 'a@b.com' }), deps))
        .status,
    ).toBe(409);
  });
  it('a JSON null body is a 400 (not an uncaught TypeError)', async () => {
    const { deps } = makeLooseDeps();
    const response = await handleRequest(postLoose(null, 'Bearer tok', 'null'), deps);
    expect(response.status).toBe(400);
  });
  it('either getUser symptom alone is a 401', async () => {
    const a = makeLooseDeps({ getUser: { data: { user: { id: 'x' } }, error: new Error('bad') } });
    expect(
      (await handleRequest(postLoose({ action: 'add', orgId: ORG, email: 'a@b.com' }), a.deps))
        .status,
    ).toBe(401);
    const b = makeLooseDeps({ getUser: { data: { user: null }, error: null } });
    expect(
      (await handleRequest(postLoose({ action: 'add', orgId: ORG, email: 'a@b.com' }), b.deps))
        .status,
    ).toBe(401);
  });
});
