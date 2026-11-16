import { describe, expect, it, vi } from 'vitest';
import { createClaimApi } from './claimApi.js';
import { COMPETITOR_STORAGE_KEY, createCompetitorClient } from './claimClient.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-';

function httpError(status, payload) {
  return { context: { status, json: async () => payload } };
}

describe('sendCode', () => {
  it('calls the Edge Function with the token and email, and returns the cleaned display name', async () => {
    const invoke = vi.fn(async () => ({
      data: { ok: true, display_name: '  Aisha  ' },
      error: null,
    }));
    const api = createClaimApi({ client: { functions: { invoke } } });
    expect(await api.sendCode(TOKEN, 'a@b.co')).toEqual({ ok: true, displayName: 'Aisha' });
    expect(invoke).toHaveBeenCalledWith('seduh-claim', { body: { token: TOKEN, email: 'a@b.co' } });
  });
  it('turns each way the function says no into its hint', async () => {
    const cases = [
      [httpError(404, { hint: 'link_invalid' }), 'link_invalid'],
      [httpError(410, { hint: 'link_expired' }), 'link_expired'],
      [httpError(429, { hint: 'too_many_codes' }), 'too_many_codes'],
      [httpError(502, { hint: 'email_send_failed' }), 'email_send_failed'],
      [httpError(500, null), 'server_error'],
      [httpError(500, { hint: 'Not A Hint!' }), 'server_error'],
      [new Error('fetch failed'), 'offline'],
    ];
    for (const [error, hint] of cases) {
      const invoke = vi.fn(async () => ({ data: null, error }));
      const result = await createClaimApi({ client: { functions: { invoke } } }).sendCode(
        TOKEN,
        'a@b.co',
      );
      expect(result, hint).toEqual({ ok: false, hint });
    }
  });
  it('never shows the function’s own error text', async () => {
    const invoke = vi.fn(async () => ({
      data: null,
      error: httpError(500, { error: 'secret detail', hint: 'server_error' }),
    }));
    const result = await createClaimApi({ client: { functions: { invoke } } }).sendCode(
      TOKEN,
      'a@b.co',
    );
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('is "offline" when the request throws', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(
      await createClaimApi({ client: { functions: { invoke } } }).sendCode(TOKEN, 'a@b.co'),
    ).toEqual({ ok: false, hint: 'offline' });
  });
});

describe('verifyCode', () => {
  const apiFor = (verifyOtp) => createClaimApi({ client: { auth: { verifyOtp } } });
  it('verifies as an email code', async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    expect(await apiFor(verifyOtp).verifyCode('a@b.co', '123456')).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.co', token: '123456', type: 'email' });
  });
  it('maps a wrong code, a rate limit and a lost connection', async () => {
    expect(
      await apiFor(async () => ({ error: { status: 403, code: 'otp_expired' } })).verifyCode(
        'a@b.co',
        '123456',
      ),
    ).toEqual({ ok: false, hint: 'otp_invalid' });
    expect(
      await apiFor(async () => ({ error: { status: 429 } })).verifyCode('a@b.co', '123456'),
    ).toEqual({ ok: false, hint: 'too_many_attempts' });
    expect(
      await apiFor(async () => ({ error: { status: 0 } })).verifyCode('a@b.co', '123456'),
    ).toEqual({ ok: false, hint: 'offline' });
    expect(
      await apiFor(async () => {
        throw new Error('x');
      }).verifyCode('a@b.co', '123456'),
    ).toEqual({ ok: false, hint: 'offline' });
  });
});

describe('handleAvailability', () => {
  const apiFor = (rpc) => createClaimApi({ client: { rpc } });
  it('returns the four answers and asks the anonymous door with the handle', async () => {
    for (const answer of ['available', 'taken', 'reserved', 'invalid']) {
      const rpc = vi.fn(async () => ({ data: answer, error: null }));
      expect(await apiFor(rpc).handleAvailability('abc')).toBe(answer);
      expect(rpc).toHaveBeenCalledWith('seduh_handle_available', { p_handle: 'abc' });
    }
  });
  it('is "failed" for an error, a missing door or an answer it does not know, never a guess', async () => {
    expect(
      await apiFor(async () => ({ data: null, error: { code: '500' } })).handleAvailability('abc'),
    ).toBe('failed');
    expect(
      await apiFor(async () => ({ data: null, error: { code: 'PGRST202' } })).handleAvailability(
        'abc',
      ),
    ).toBe('failed');
    expect(
      await apiFor(async () => ({ data: 'maybe', error: null })).handleAvailability('abc'),
    ).toBe('failed');
    expect(
      await apiFor(async () => {
        throw new Error('x');
      }).handleAvailability('abc'),
    ).toBe('failed');
  });
});

describe('claim', () => {
  const apiFor = (rpc) => createClaimApi({ client: { rpc } });
  it('calls claim_seduh_id with the token, handle and adult flag, and returns only the three fields', async () => {
    const rpc = vi.fn(async () => ({
      data: { handle: 'aisha', founding_number: 7, profile_path: '/id/aisha/', extra: 'x' },
      error: null,
    }));
    expect(await apiFor(rpc).claim(TOKEN, 'aisha', true)).toEqual({
      ok: true,
      handle: 'aisha',
      foundingNumber: 7,
    });
    expect(rpc).toHaveBeenCalledWith('claim_seduh_id', {
      p_token: TOKEN,
      p_handle: 'aisha',
      p_adult: true,
    });
  });
  it('turns the database’s hint into the page’s hint, and 42501 into "signed out"', async () => {
    for (const hint of [
      'handle_taken',
      'link_used',
      'adult_required',
      'account_exists',
      'admin_cannot_claim',
    ]) {
      const result = await apiFor(async () => ({
        data: null,
        error: { code: 'P0001', hint, message: 'raw text' },
      })).claim(TOKEN, 'aisha', true);
      expect(result).toEqual({ ok: false, hint });
    }
    expect(
      await apiFor(async () => ({ data: null, error: { code: '42501', message: 'x' } })).claim(
        TOKEN,
        'aisha',
        true,
      ),
    ).toEqual({ ok: false, hint: 'signed_out' });
    expect(
      await apiFor(async () => ({ data: null, error: { code: 'XX000', message: 'x' } })).claim(
        TOKEN,
        'aisha',
        true,
      ),
    ).toEqual({ ok: false, hint: 'server_error' });
  });
  it('does not call a malformed success a claim', async () => {
    expect(
      await apiFor(async () => ({ data: { handle: 'aisha' }, error: null })).claim(
        TOKEN,
        'aisha',
        true,
      ),
    ).toEqual({ ok: false, hint: 'server_error' });
    expect(
      await apiFor(async () => ({ data: null, error: null })).claim(TOKEN, 'aisha', true),
    ).toEqual({ ok: false, hint: 'server_error' });
  });
  it('is "offline" when the call throws', async () => {
    expect(
      await apiFor(async () => {
        throw new Error('x');
      }).claim(TOKEN, 'aisha', true),
    ).toEqual({ ok: false, hint: 'offline' });
  });
});

describe('leave', () => {
  it('signs out of this browser only, and never throws', async () => {
    const signOut = vi.fn(async () => {
      throw new Error('x');
    });
    await expect(
      createClaimApi({ client: { auth: { signOut } } }).leave(),
    ).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('the competitor client keeps its own session', () => {
  it('uses its own storage key, in the given (tab) storage, and never reads a session from the URL', () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    };
    const client = createCompetitorClient({
      url: 'http://127.0.0.1:54421',
      anonKey: 'anon',
      storage,
    });
    expect(COMPETITOR_STORAGE_KEY).toBe('seduh-competitor-auth');
    expect(COMPETITOR_STORAGE_KEY).not.toMatch(/^sb-/);
    expect(COMPETITOR_STORAGE_KEY).not.toBe('seduh-admin-auth');
    expect(client.auth.storageKey).toBe(COMPETITOR_STORAGE_KEY);
    expect(client.auth.detectSessionInUrl).toBe(false);
  });
});
