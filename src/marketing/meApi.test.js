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

// T-ID2.C2: the photo, with the Storage client faked.
describe('photo', () => {
  const NEW_HEX = 'c'.repeat(32);
  const OLD = `/storage/v1/object/public/seduh-avatars/mine/${'a'.repeat(32)}.webp`;
  const prepared = { blob: { size: 10 }, type: 'image/webp', ext: 'webp' };
  function withStorage({ upload = { error: null }, remove = {} } = {}) {
    const calls = [];
    const client = fakeClient({
      rpc: {
        seduh_set_my_photo: { data: { ok: 1 } },
        seduh_remove_my_photo: { data: { removed: true } },
      },
    });
    client.storage = {
      from: vi.fn((bucket) => ({
        upload: vi.fn(async (...a) => {
          calls.push(['upload', bucket, ...a]);
          return upload;
        }),
        remove: vi.fn(async (...a) => {
          calls.push(['remove', bucket, ...a]);
          if (remove instanceof Error) throw remove;
          return remove;
        }),
      })),
    };
    return { client, calls };
  }

  it("uploads into the caller's own folder under a random name (never upsert), removes the old file, then records the new path", async () => {
    const { client, calls } = withStorage();
    const result = await api(client).setPhoto({
      prepared,
      handle: 'mine',
      previousUrl: OLD,
      random: () => NEW_HEX,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0].slice(0, 3)).toEqual(['upload', 'seduh-avatars', `mine/${NEW_HEX}.webp`]);
    expect(calls[0][4]).toMatchObject({ contentType: 'image/webp', upsert: false });
    expect(calls[1]).toEqual(['remove', 'seduh-avatars', [`mine/${'a'.repeat(32)}.webp`]]);
    expect(client.rpc).toHaveBeenCalledWith('seduh_set_my_photo', {
      p_path: `mine/${NEW_HEX}.webp`,
    });
  });

  it.each([
    [413, 'photo_too_big'],
    [415, 'photo_bad_type'],
    [401, 'signed_out'],
    [403, 'photo_upload_failed'],
    [500, 'photo_upload_failed'],
  ])('maps an upload refused with %i to %s and records nothing', async (statusCode, hint) => {
    const { client } = withStorage({
      upload: { error: { statusCode: String(statusCode), message: 'x' } },
    });
    expect(await api(client).setPhoto({ prepared, handle: 'mine', random: () => NEW_HEX })).toEqual(
      { ok: false, hint },
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('takes the new file back out when the door refuses it, and passes the hint on', async () => {
    const { client, calls } = withStorage();
    client.rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'P0001', hint: 'no_object', message: 'x' },
    }));
    const result = await api(client).setPhoto({ prepared, handle: 'mine', random: () => NEW_HEX });
    expect(result).toEqual({ ok: false, hint: 'no_object' });
    expect(calls.at(-1)).toEqual(['remove', 'seduh-avatars', [`mine/${NEW_HEX}.webp`]]);
  });

  it('a failing remove of the old file never fails the save, and a thrown upload is a hint, not an exception', async () => {
    const { client } = withStorage({ remove: new Error('network') });
    expect(
      await api(client).setPhoto({
        prepared,
        handle: 'mine',
        previousUrl: OLD,
        random: () => NEW_HEX,
      }),
    ).toEqual({ ok: true });
    const broken = fakeClient();
    broken.storage = {
      from: () => ({
        upload: async () => {
          throw new Error('offline');
        },
        remove: async () => ({}),
      }),
    };
    expect(await api(broken).setPhoto({ prepared, handle: 'mine', random: () => NEW_HEX })).toEqual(
      { ok: false, hint: 'photo_upload_failed' },
    );
  });

  it('removing removes the file through the API first, then calls the door', async () => {
    const { client, calls } = withStorage();
    expect(await api(client).removePhoto(OLD)).toEqual({ ok: true, data: { removed: true } });
    expect(calls[0]).toEqual(['remove', 'seduh-avatars', [`mine/${'a'.repeat(32)}.webp`]]);
    expect(client.rpc).toHaveBeenCalledWith('seduh_remove_my_photo', {});
  });
});

// Review fixes (T-ID2.C2): the ORDER of upload, old-file removal and door is what keeps the bytes freed, so it is asserted.
describe('photo: order and timeouts', () => {
  const OLD = `/storage/v1/object/public/seduh-avatars/mine/${'a'.repeat(32)}.webp`;
  const prepared = { blob: { size: 10 }, type: 'image/webp', ext: 'webp' };
  function ordered(rpcAnswer) {
    const log = [];
    const client = fakeClient();
    client.rpc = vi.fn(async (name) => {
      log.push(`rpc:${name}`);
      return rpcAnswer ?? { data: {}, error: null };
    });
    client.storage = {
      from: () => ({
        upload: async () => {
          log.push('upload');
          return { error: null };
        },
        remove: async ([p]) => {
          log.push(`remove:${p.slice(-8)}`);
          return {};
        },
      }),
    };
    return { client, log };
  }
  it('uploads, removes the old file through the API, and only then calls the door', async () => {
    const { client, log } = ordered();
    await api(client).setPhoto({
      prepared,
      handle: 'mine',
      previousUrl: OLD,
      random: () => 'c'.repeat(32),
    });
    expect(log).toEqual(['upload', 'remove:aaa.webp', 'rpc:seduh_set_my_photo']);
  });
  it('removing frees the file through the API before the door', async () => {
    const { client, log } = ordered();
    await api(client).removePhoto(OLD);
    expect(log[0]).toMatch(/^remove:/);
    expect(log[1]).toBe('rpc:seduh_remove_my_photo');
  });
  it('after a TIMEOUT it does not delete the new file (the database may have saved it)', async () => {
    const { client, log } = ordered();
    client.rpc = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { timedOut: true });
    });
    const result = await api(client).setPhoto({
      prepared,
      handle: 'mine',
      random: () => 'c'.repeat(32),
    });
    expect(result.ok).toBe(false);
    expect(log).toEqual(['upload']);
  });
});
