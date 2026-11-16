// My Seduh ID's calls: the sign-in never reveals whether an email has a Seduh ID, every door call reduces a failure to a
// hint and never throws, no door is sent an id of a person, and the page can only ever use the competitor's own client.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMeApi } from './meApi.js';

function fakeClient({ rpc = {}, otp, verify, session = { access_token: 'x' } } = {}) {
  return {
    rpc: vi.fn(async (name, args) => {
      const answer = rpc[name];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(args) : (answer ?? { data: null, error: null });
    }),
    auth: {
      signInWithOtp: vi.fn(async () => otp ?? { data: {}, error: null }),
      verifyOtp: vi.fn(async () => verify ?? { data: {}, error: null }),
      getSession: vi.fn(async () => ({ data: { session } })),
      signOut: vi.fn(async () => ({})),
    },
  };
}
const api = (client, extra) => createMeApi({ client, minRequestCodeMs: 0, ...extra });
const accountOnly = { account: { handle: 'mine', founding_number: 1, display_name: 'T P' } };

describe('requestCode: the same answer whether or not the address has a Seduh ID', () => {
  it('asks for a code without creating a login', async () => {
    const client = fakeClient();
    const result = await api(client).requestCode('a@example.test');
    expect(result).toEqual({ ok: true });
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@example.test',
      options: { shouldCreateUser: false },
    });
  });

  it.each([
    [
      'no such login (signups not allowed)',
      { status: 422, message: 'Signups not allowed for otp' },
    ],
    ['a mail failure', { status: 500, message: 'Error sending magic link email' }],
    ['a banned login', { status: 400, message: 'User is banned' }],
  ])('%s is shown as the same neutral success as a real address', async (_label, error) => {
    const known = await api(fakeClient()).requestCode('known@example.test');
    const refused = await api(fakeClient({ otp: { data: {}, error } })).requestCode(
      'nobody@example.test',
    );
    expect(refused).toEqual(known);
  });

  it('only a connection problem is shown (a 429 is the neutral answer too: the per-address limit would reveal a known address)', async () => {
    const offline = await api(fakeClient({ otp: { error: { status: 0 } } })).requestCode(
      'a@example.test',
    );
    expect(offline).toEqual({ ok: false, hint: 'offline' });
    const client = fakeClient();
    client.auth.signInWithOtp = vi.fn().mockRejectedValue({ timedOut: true });
    expect(await api(client).requestCode('a@example.test')).toEqual({ ok: false, hint: 'timeout' });
  });

  it('a 429 is the same neutral success: the per-address limit would otherwise reveal a known address', async () => {
    const known = await api(fakeClient()).requestCode('known@example.test');
    const limited = await api(fakeClient({ otp: { error: { status: 429 } } })).requestCode(
      'known@example.test',
    );
    expect(limited).toEqual(known);
  });

  it('a successful send is held to the same minimum time as a refusal', async () => {
    const client = fakeClient();
    client.auth.signInWithOtp = vi.fn(
      () => new Promise((r) => setTimeout(() => r({ data: {}, error: null }), 20)),
    );
    const started = Date.now();
    await createMeApi({ client, minRequestCodeMs: 90 }).requestCode('a@example.test');
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it('takes at least the minimum time even for a quick refusal, so speed is no oracle', async () => {
    const started = Date.now();
    await createMeApi({
      client: fakeClient({ otp: { error: { status: 422 } } }),
      minRequestCodeMs: 80,
    }).requestCode('a@example.test');
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });
});

describe('verifyCode, session and sign-out', () => {
  it('verifies as an email code', async () => {
    const client = fakeClient();
    expect(await api(client).verifyCode('a@example.test', '123456')).toEqual({ ok: true });
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@example.test',
      token: '123456',
      type: 'email',
    });
  });
  it('a wrong code, too many attempts and no connection are three different hints', async () => {
    expect(
      await api(fakeClient({ verify: { error: { status: 403 } } })).verifyCode('a@b.cc', '111111'),
    ).toEqual({ ok: false, hint: 'otp_invalid' });
    expect(
      await api(fakeClient({ verify: { error: { status: 429 } } })).verifyCode('a@b.cc', '111111'),
    ).toEqual({ ok: false, hint: 'too_many_attempts' });
    expect(
      await api(fakeClient({ verify: { error: { status: 0 } } })).verifyCode('a@b.cc', '111111'),
    ).toEqual({ ok: false, hint: 'offline' });
  });
  it('reports a session, and signs out of this tab only', async () => {
    const client = fakeClient();
    expect(await api(client).hasSession()).toBe(true);
    expect(await api(fakeClient({ session: null })).hasSession()).toBe(false);
    await api(client).signOut();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('the doors', () => {
  it('loadRecord asks with no arguments (the database finds the caller) and rebuilds the answer', async () => {
    const client = fakeClient({
      rpc: { seduh_my_record: { data: { ...accountOnly, entries: [] } } },
    });
    const result = await api(client).loadRecord();
    expect(client.rpc).toHaveBeenCalledWith('seduh_my_record', {});
    expect(result.ok).toBe(true);
    expect(result.record.account.handle).toBe('mine');
  });

  it('every call sends only the arguments the contract names, and never an account or identity id', async () => {
    const client = fakeClient();
    const a = api(client);
    await a.addEntry({ p_year: 2024 });
    await a.updateEntry(5, { p_year: 2024 });
    await a.deleteEntry(5);
    await a.teamOptions('BN');
    await a.addTeamLink('key', 'captain');
    await a.removeTeamLink(9);
    await a.setSettings({ vis_identity: 'hidden' });
    expect(client.rpc.mock.calls).toEqual([
      ['seduh_add_entry', { p_year: 2024 }],
      ['seduh_update_entry', { p_entry_id: 5, p_year: 2024 }],
      ['seduh_delete_entry', { p_entry_id: 5 }],
      ['seduh_team_options', { p_country_code: 'BN', p_competition: null }],
      ['seduh_add_team_link', { p_team_key: 'key', p_role: 'captain' }],
      ['seduh_remove_team_link', { p_link_id: 9 }],
      ['seduh_set_my_settings', { p_settings: { vis_identity: 'hidden' } }],
    ]);
  });

  it("passes the database's own hint through, in a snake_case shape only", async () => {
    const client = fakeClient({
      rpc: { seduh_add_entry: { error: { hint: 'bad_year', code: 'P0001' }, status: 400 } },
    });
    expect(await api(client).addEntry({})).toEqual({ ok: false, hint: 'bad_year' });
    const weird = fakeClient({
      rpc: { seduh_add_entry: { error: { hint: 'Raw server TEXT!', code: 'P0001' }, status: 400 } },
    });
    expect(await api(weird).addEntry({})).toEqual({ ok: false, hint: 'server_error' });
  });

  it('no_account is passed on; a 401 or a bare 42501 is signed_out; a network failure is offline', async () => {
    const noAccount = fakeClient({
      rpc: { seduh_my_record: { error: { code: '42501', hint: 'no_account' }, status: 403 } },
    });
    expect(await api(noAccount).loadRecord()).toEqual({ ok: false, hint: 'no_account' });
    const anon = fakeClient({
      rpc: { seduh_my_record: { error: { message: 'JWT' }, status: 401 } },
    });
    expect(await api(anon).loadRecord()).toEqual({ ok: false, hint: 'signed_out' });
    const bare = fakeClient({
      rpc: { seduh_my_record: { error: { code: '42501' }, status: 403 } },
    });
    expect(await api(bare).loadRecord()).toEqual({ ok: false, hint: 'signed_out' });
    const offline = fakeClient({ rpc: { seduh_my_record: new Error('network') } });
    expect(await api(offline).loadRecord()).toEqual({ ok: false, hint: 'offline' });
  });

  it('an answer that is not a record is a server error, never a crash', async () => {
    const client = fakeClient({ rpc: { seduh_my_record: { data: { nothing: true } } } });
    expect(await api(client).loadRecord()).toEqual({ ok: false, hint: 'server_error' });
  });
});

describe('session isolation', () => {
  it("uses only the competitor's own client, never the organiser's, the admin's or the shared one", () => {
    const source =
      readFileSync('src/marketing/meApi.js', 'utf8') +
      readFileSync('src/marketing/meMain.js', 'utf8') +
      readFileSync('src/marketing/meScreen.js', 'utf8');
    expect(source).toContain("from './claimClient.js'");
    expect(source).not.toMatch(/supabaseClient|adminClient|getSupabase\(|src\/admin|\.\.\/admin/);
  });
});
