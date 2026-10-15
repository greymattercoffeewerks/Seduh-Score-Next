import { describe, it, expect, vi } from 'vitest';
import {
  beginEnrol,
  verifyCode,
  validateCode,
  normaliseCode,
  describeMfaError,
  BAD_CODE_MESSAGE,
  CODE_PROMPT,
} from './mfa.js';

function fakeClient({ all = [], listError = null, unenrol = {}, enrol, verify } = {}) {
  return {
    auth: {
      mfa: {
        listFactors: vi.fn(async () => ({ data: { all, totp: [] }, error: listError })),
        unenroll: vi.fn(async () => ({ data: null, error: unenrol.error ?? null })),
        enroll: vi.fn(
          enrol ??
            (async () => ({
              data: {
                id: 'new-factor',
                totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCD' },
              },
              error: null,
            })),
        ),
        challengeAndVerify: vi.fn(verify ?? (async () => ({ data: {}, error: null }))),
      },
    },
  };
}

describe('code helpers', () => {
  it('accepts exactly six digits, ignoring spaces and dashes', () => {
    expect(validateCode('123456')).toBeNull();
    expect(validateCode(' 123 456 ')).toBeNull();
    expect(validateCode('123-456')).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12345a', null, undefined]) {
      expect(validateCode(bad)).toBe(CODE_PROMPT);
    }
    expect(normaliseCode(' 12 34-56 ')).toBe('123456');
  });
});

describe('describeMfaError', () => {
  it('maps GoTrue codes to plain sentences and never echoes the raw message', () => {
    expect(describeMfaError({ code: 'mfa_verification_failed', message: 'secret internals' })).toBe(
      BAD_CODE_MESSAGE,
    );
    expect(describeMfaError({ code: 'mfa_challenge_expired' })).toMatch(/expired/);
    expect(describeMfaError({ code: 'over_request_rate_limit' })).toMatch(/Too many attempts/);
    expect(describeMfaError({ timedOut: true })).toMatch(/longer than expected/);
    const other = describeMfaError({ code: 'unexpected_failure', message: 'stack trace here' });
    expect(other).toBe('Something went wrong. Nothing was changed. Try again.');
  });
});

describe('beginEnrol', () => {
  it('enrols a TOTP factor and returns what the screen draws', async () => {
    const client = fakeClient();
    const result = await beginEnrol(client);
    expect(result).toEqual({
      ok: true,
      factorId: 'new-factor',
      qrCode: 'data:image/svg+xml;utf-8,<svg/>',
      secret: 'ABCD',
    });
    const params = client.auth.mfa.enroll.mock.calls[0][0];
    expect(params.factorType).toBe('totp');
    expect(params.issuer).toBeTruthy();
  });

  it('gives each attempt its own friendly name (GoTrue refuses a repeat)', async () => {
    const client = fakeClient();
    await beginEnrol(client);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await beginEnrol(client);
    const names = client.auth.mfa.enroll.mock.calls.map((call) => call[0].friendlyName);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name && name.trim().length > 0)).toBe(true);
  });

  it('removes unverified TOTP factors first (they count against the cap) and nothing else', async () => {
    const client = fakeClient({
      all: [
        { id: 'stale-1', factor_type: 'totp', status: 'unverified' },
        { id: 'stale-2', factor_type: 'totp', status: 'unverified' },
        { id: 'phone-1', factor_type: 'phone', status: 'unverified' },
        { id: 'keep', factor_type: 'totp', status: 'verified' },
      ],
    });
    await beginEnrol(client);
    const removed = client.auth.mfa.unenroll.mock.calls.map((call) => call[0].factorId);
    expect(removed).toEqual(['stale-1', 'stale-2']);
    // Cleared before the new enrolment is made, so the cap is never hit by the leftovers.
    expect(client.auth.mfa.unenroll.mock.invocationCallOrder.at(-1)).toBeLessThan(
      client.auth.mfa.enroll.mock.invocationCallOrder[0],
    );
  });

  it('stops, reports and does not enrol when a stale factor cannot be removed', async () => {
    const client = fakeClient({
      all: [{ id: 'stale', factor_type: 'totp', status: 'unverified' }],
      unenrol: { error: { code: 'insufficient_aal', message: 'x' } },
    });
    const result = await beginEnrol(client);
    expect(result.ok).toBe(false);
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it('reports a failed enrolment without leaking its message', async () => {
    const client = fakeClient({
      enrol: async () => ({
        data: null,
        error: { code: 'too_many_enrolled_mfa_factors', message: 'cap 4' },
      }),
    });
    const result = await beginEnrol(client);
    expect(result).toEqual({
      ok: false,
      message: 'Something went wrong. Nothing was changed. Try again.',
    });
  });

  it('explains a rate-limited enrolment as such (the message comes from the error)', async () => {
    const client = fakeClient({
      enrol: async () => ({ data: null, error: { code: 'over_request_rate_limit', message: 'x' } }),
    });
    expect(await beginEnrol(client)).toEqual({
      ok: false,
      message: 'Too many attempts. Wait a minute, then try again.',
    });
  });

  it('reports a failed factor listing, and a request that never settles', async () => {
    expect((await beginEnrol(fakeClient({ listError: { message: 'x' } }))).ok).toBe(false);
    const hung = fakeClient();
    hung.auth.mfa.listFactors = vi.fn(() => new Promise(() => {}));
    const result = await beginEnrol(hung, { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/longer than expected/);
  });
});

describe('verifyCode', () => {
  it('sends the factor and the NORMALISED code, once', async () => {
    const client = fakeClient();
    expect(await verifyCode(client, 'f-1', ' 123 456 ')).toEqual({ ok: true });
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'f-1',
      code: '123456',
    });
  });

  it('refuses a malformed code without spending a request', async () => {
    const client = fakeClient();
    expect(await verifyCode(client, 'f-1', '12')).toEqual({ ok: false, message: CODE_PROMPT });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('turns a wrong code into the plain sentence', async () => {
    const client = fakeClient({
      verify: async () => ({
        data: null,
        error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
      }),
    });
    expect(await verifyCode(client, 'f-1', '000000')).toEqual({
      ok: false,
      message: BAD_CODE_MESSAGE,
    });
  });

  it('turns a thrown request into a message, not a rejection', async () => {
    const client = fakeClient({ verify: () => Promise.reject(new Error('net')) });
    const result = await verifyCode(client, 'f-1', '123456');
    expect(result.ok).toBe(false);
  });
});
