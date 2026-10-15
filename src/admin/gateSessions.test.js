import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAdminClient } from './adminClient.js';
import { checkAccess, signOut, GATE_STATE, SESSION_ENDED_NOTICE } from './gate.js';

// What happens to a session, as opposed to what the gate decides: a dead one is dropped, a sign-out that fails
// is retried against the SERVER, and the whole thing is proven against the real auth client, not only a fake.

function fakeClient({ factors, rpc }) {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { email: 'ops@example.test' } } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
      mfa: { listFactors: vi.fn(async () => factors) },
    },
    rpc: vi.fn(async (name) => rpc[name]),
  };
}

const admin = (aal) => ({ data: { is_admin: true, aal }, error: null });

describe('a session the server no longer honours', () => {
  it('a JWT error code with no HTTP status is still a sign-out (PGRST301 and PGRST303)', async () => {
    for (const code of ['PGRST301', 'PGRST303']) {
      const client = fakeClient({ rpc: { am_i_platform_admin: { data: null, error: { code } } } });
      expect(await checkAccess(client)).toEqual({
        state: GATE_STATE.SIGNED_OUT,
        notice: SESSION_ENDED_NOTICE,
      });
    }
  });

  it('the dead token is dropped from this tab, not left for the next reload to find', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: { data: null, error: { hint: 'admin_session_ended' } },
      },
    });
    await checkAccess(client);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a factor list refused because the session is gone is a sign-out, not an endless retry', async () => {
    for (const refusal of [{ status: 401 }, { status: 403 }, { code: 'session_not_found' }]) {
      const client = fakeClient({
        rpc: { am_i_platform_admin: admin('aal1') },
        factors: { data: null, error: refusal },
      });
      expect(await checkAccess(client)).toEqual({
        state: GATE_STATE.SIGNED_OUT,
        notice: SESSION_ENDED_NOTICE,
      });
      expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    }
  });

  it('a factor list that does not say what the verified factors are never means "enrol"', async () => {
    for (const data of [{}, { all: [] }, { totp: null }, { totp: 'none' }, null]) {
      const client = fakeClient({
        rpc: { am_i_platform_admin: admin('aal1') },
        factors: { data, error: null },
      });
      expect((await checkAccess(client)).state).toBe(GATE_STATE.ERROR);
    }
  });

  it('a failing local sign-out while dropping the token changes nothing about the answer', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: { data: null, error: { hint: 'admin_session_ended' } },
      },
    });
    client.auth.signOut = vi.fn(() => Promise.reject(new Error('net')));
    expect((await checkAccess(client)).state).toBe(GATE_STATE.SIGNED_OUT);
  });
});

describe('a session lookup that never answers', () => {
  it('ends in the slow message instead of hanging on the first screen', async () => {
    const client = fakeClient({ rpc: {} });
    client.auth.getSession = vi.fn(() => new Promise(() => {}));
    const result = await checkAccess(client, { timeoutMs: 5 });
    expect(result.state).toBe(GATE_STATE.ERROR);
    expect(result.message).toMatch(/longer than expected/);
  });
});

// ---- the real auth client, with a network we control ----

const b64 = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
const NOW = Math.floor(Date.now() / 1000);
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u', aal: 'aal2', session_id: 's', exp: NOW + 3000 })}.sig`;

function signedInRealClient() {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const client = createAdminClient({ url: 'http://127.0.0.1:1', anonKey: 'anon', storage });
  store.set(
    'seduh-admin-auth',
    JSON.stringify({
      access_token: TOKEN,
      refresh_token: 'r',
      expires_in: 3000,
      expires_at: NOW + 3000,
      token_type: 'bearer',
      user: {
        id: 'u',
        aud: 'authenticated',
        email: 'ops@example.test',
        app_metadata: {},
        user_metadata: {},
        created_at: '',
      },
    }),
  );
  return { client, store };
}

describe('signing out with the real auth client when the network fails', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the retry reaches the server with the original token (it does not report success on its own)', async () => {
    const calls = [];
    let down = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        calls.push({
          url: String(url),
          auth: init?.headers?.Authorization ?? init?.headers?.authorization,
        });
        if (down) throw new TypeError('fetch failed');
        return new Response(null, { status: 204 });
      }),
    );
    const { client, store } = signedInRealClient();

    // First attempt: the network is down. auth-js drops the local session anyway.
    expect(await signOut(client, 'global', { timeoutMs: 2000 })).toEqual({ ok: false });
    expect(store.has('seduh-admin-auth')).toBe(false);
    expect(calls.map((call) => call.url).some((url) => url.includes('/logout?scope=global'))).toBe(
      true,
    );

    // Second attempt, network back. With a bare auth.signOut() this would report success having sent nothing.
    down = false;
    const before = calls.length;
    expect(await signOut(client, 'global', { timeoutMs: 2000 })).toEqual({ ok: true });
    const retried = calls.slice(before);
    expect(retried.length).toBeGreaterThan(0);
    const logout = retried.find((call) => call.url.includes('/logout?scope=global'));
    expect(logout).toBeTruthy();
    expect(logout.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('once the server has answered, a later sign-out is an ordinary one again', async () => {
    let down = true;
    const fetchMock = vi.fn(async () => {
      if (down) throw new TypeError('fetch failed');
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client } = signedInRealClient();
    await signOut(client, 'local', { timeoutMs: 2000 });
    down = false;
    expect(await signOut(client, 'local', { timeoutMs: 2000 })).toEqual({ ok: true });
    // Nothing is waiting any more: with no session there is nothing to revoke and nothing is sent.
    const calls = fetchMock.mock.calls.length;
    expect(await signOut(client, 'local', { timeoutMs: 2000 })).toEqual({ ok: true });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('a server that keeps failing keeps the sign-out failing (it is never reported as done)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const { client } = signedInRealClient();
    expect(await signOut(client, 'global', { timeoutMs: 2000 })).toEqual({ ok: false });
    expect(await signOut(client, 'global', { timeoutMs: 2000 })).toEqual({ ok: false });
    expect(await signOut(client, 'global', { timeoutMs: 2000 })).toEqual({ ok: false });
  });
});
