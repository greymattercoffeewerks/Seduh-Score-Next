import { describe, it, expect, vi } from 'vitest';
import { checkAccess, signOut, isGateRefusal, GATE_STATE, SESSION_ENDED_NOTICE } from './gate.js';

// A fake client that answers the four calls the gate makes. `rpc` maps a function name to its result;
// anything not listed throws, so a test also proves the gate calls nothing it should not.
function fakeClient({
  session = { user: { email: 'ops@example.test' } },
  rpc = {},
  factors = { data: { totp: [], all: [] }, error: null },
} = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      mfa: { listFactors: vi.fn(async () => factors) },
    },
    rpc: vi.fn((name) => {
      calls.push(name);
      if (!(name in rpc)) throw new Error(`unexpected rpc ${name}`);
      const answer = rpc[name];
      return Promise.resolve(typeof answer === 'function' ? answer() : answer);
    }),
  };
}

const admin = (aal) => ({ data: { is_admin: true, aal }, error: null });
const refusal = (hint, extra = {}) => ({ data: null, error: { hint, message: 'x' }, ...extra });
const verifiedFactor = {
  data: { totp: [{ id: 'f-1', status: 'verified' }], all: [] },
  error: null,
};

describe('checkAccess', () => {
  it('no session is signedOut, and nothing is asked of the database', async () => {
    const client = fakeClient({ session: null });
    expect(await checkAccess(client)).toEqual({ state: GATE_STATE.SIGNED_OUT });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('a login that is not an admin is notAdmin, and is told nothing else', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: { data: { is_admin: false, aal: 'aal2' }, error: null } },
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.NOT_ADMIN,
      email: 'ops@example.test',
    });
    // It never reaches the factor list or the full gate.
    expect(client.calls).toEqual(['am_i_platform_admin']);
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
  });

  it('a missing or odd is_admin is notAdmin (only a literal true opens the gate)', async () => {
    for (const data of [{ aal: 'aal2' }, { is_admin: 'true', aal: 'aal2' }, null]) {
      const client = fakeClient({ rpc: { am_i_platform_admin: { data, error: null } } });
      expect((await checkAccess(client)).state).toBe(GATE_STATE.NOT_ADMIN);
    }
  });

  it('an admin on password only with no verified factor needs to enrol', async () => {
    const client = fakeClient({ rpc: { am_i_platform_admin: admin('aal1') } });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.NEED_ENROL,
      email: 'ops@example.test',
    });
    expect(client.calls).toEqual(['am_i_platform_admin']);
  });

  it('an admin on password only WITH a verified factor gets the challenge for that factor', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal1') },
      factors: verifiedFactor,
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.NEED_CHALLENGE,
      email: 'ops@example.test',
      factorId: 'f-1',
    });
  });

  it('only a verified factor counts: an abandoned enrolment alone still means enrol', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal1') },
      factors: {
        data: { totp: [], all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }] },
        error: null,
      },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.NEED_ENROL);
  });

  it('aal2 is NOT enough: ready requires admin_can_provision to say true', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal2'), admin_can_provision: { data: true, error: null } },
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.READY,
      email: 'ops@example.test',
    });
    expect(client.calls).toEqual(['am_i_platform_admin', 'admin_can_provision']);
  });

  it('a stale second factor (aal2 token, admin_mfa_required) goes back to the challenge', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: refusal('admin_mfa_required'),
      },
      factors: verifiedFactor,
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.NEED_CHALLENGE,
      email: 'ops@example.test',
      factorId: 'f-1',
    });
  });

  it('a signed-out-everywhere token that still says aal2 is signedOut with a notice, not ready', async () => {
    // am_i_platform_admin() is token-only and still says admin + aal2; the full gate knows the session is gone.
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: refusal('admin_session_ended'),
      },
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.SIGNED_OUT,
      notice: SESSION_ENDED_NOTICE,
    });
  });

  it('admin_required from the full gate is notAdmin', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal2'), admin_can_provision: refusal('admin_required') },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.NOT_ADMIN);
  });

  it('an unrecognised refusal is an error state, never ready and never a silent pass', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal2'), admin_can_provision: refusal('something_new') },
    });
    const result = await checkAccess(client);
    expect(result.state).toBe(GATE_STATE.ERROR);
    expect(result.message).toMatch(/Could not check your access/);
  });

  it('a "true" that is not a boolean true does not open the gate', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: { data: 'true', error: null },
      },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.ERROR);
  });

  it('an answer carrying BOTH data true and an error is not ready', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: { data: true, error: { hint: 'admin_session_ended' } },
      },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.SIGNED_OUT);
  });

  it('a 401 alone (no error code at all) is signedOut', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: { data: null, error: { message: 'JWT expired' }, status: 401 } },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.SIGNED_OUT);
  });

  it('a 401 from the full gate (the token died between the two calls) is signedOut too', async () => {
    const client = fakeClient({
      rpc: {
        am_i_platform_admin: admin('aal2'),
        admin_can_provision: { data: null, error: { message: 'JWT expired' }, status: 401 },
      },
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.SIGNED_OUT,
      notice: SESSION_ENDED_NOTICE,
    });
  });

  it('a rejected token (HTTP 401) is signedOut with the session-ended notice', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: { data: null, error: { code: 'PGRST303' }, status: 401 } },
    });
    expect(await checkAccess(client)).toEqual({
      state: GATE_STATE.SIGNED_OUT,
      notice: SESSION_ENDED_NOTICE,
    });
  });

  it('a failing am_i_platform_admin is an error state with a retry message', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: { data: null, error: { message: 'boom' }, status: 500 } },
    });
    const result = await checkAccess(client);
    expect(result.state).toBe(GATE_STATE.ERROR);
    expect(result.email).toBe('ops@example.test');
    expect(result.message).not.toContain('boom');
  });

  it('a thrown request (network down) is an error state, not an unhandled rejection', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: () => Promise.reject(new Error('net')) },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.ERROR);
  });

  it('a request that never settles ends in the slow message', async () => {
    const client = fakeClient({ rpc: { am_i_platform_admin: new Promise(() => {}) } });
    const result = await checkAccess(client, { timeoutMs: 5 });
    expect(result.state).toBe(GATE_STATE.ERROR);
    expect(result.message).toMatch(/longer than expected/);
  });

  it('a factor list that fails is an error state, not "enrol" (it must not offer to enrol on a guess)', async () => {
    const client = fakeClient({
      rpc: { am_i_platform_admin: admin('aal1') },
      factors: { data: null, error: { message: 'down' } },
    });
    expect((await checkAccess(client)).state).toBe(GATE_STATE.ERROR);
  });
});

describe('isGateRefusal', () => {
  it('names exactly the three hints that mean the gate is closed', () => {
    for (const hint of ['admin_required', 'admin_mfa_required', 'admin_session_ended']) {
      expect(isGateRefusal({ hint })).toBe(true);
    }
    for (const hint of ['org_not_found', 'last_owner', undefined]) {
      expect(isGateRefusal({ hint })).toBe(false);
    }
    expect(isGateRefusal(null)).toBe(false);
  });
});

describe('signOut', () => {
  it('passes the scope through and reports success', async () => {
    const client = fakeClient();
    expect(await signOut(client, 'global')).toEqual({ ok: true });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  it('defaults to this tab only', async () => {
    const client = fakeClient();
    await signOut(client);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('reports a returned error and a thrown one as not ok (never silent)', async () => {
    const failing = fakeClient();
    failing.auth.signOut = vi.fn(async () => ({ error: { message: 'x' } }));
    expect(await signOut(failing)).toEqual({ ok: false });
    const throwing = fakeClient();
    throwing.auth.signOut = vi.fn(() => Promise.reject(new Error('net')));
    expect(await signOut(throwing)).toEqual({ ok: false });
  });
});
