import { describe, it, expect, vi } from 'vitest';
import { beginEnrol, verifyCode, describeMfaError, BAD_CODE_MESSAGE } from './mfa.js';

// Hung requests, the fallback wording for older servers, and the friendly-name clock.

function client(overrides = {}) {
  return {
    auth: {
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: [], all: [] }, error: null })),
        unenroll: vi.fn(async () => ({ error: null })),
        enroll: vi.fn(async () => ({
          data: { id: 'f', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCD' } },
          error: null,
        })),
        challengeAndVerify: vi.fn(async () => ({ error: null })),
        ...overrides,
      },
    },
  };
}

describe('verifyCode', () => {
  it('a request that never answers ends in the slow message, not a hang', async () => {
    const hung = client({ challengeAndVerify: vi.fn(() => new Promise(() => {})) });
    const result = await verifyCode(hung, 'f-1', '123456', { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/longer than expected/);
  });

  it('a thrown request is reported with the failure sentence (and never as a bad code)', async () => {
    const failing = client({
      challengeAndVerify: vi.fn(() => Promise.reject(new TypeError('net'))),
    });
    const result = await verifyCode(failing, 'f-1', '123456');
    expect(result).toEqual({
      ok: false,
      message: 'Something went wrong. Nothing was changed. Try again.',
    });
  });
});

describe('describeMfaError', () => {
  it('recognises an older server that sends only a message', () => {
    expect(describeMfaError({ message: 'Invalid TOTP code entered' })).toBe(BAD_CODE_MESSAGE);
    expect(describeMfaError({ message: 'invalid code' })).toBe(BAD_CODE_MESSAGE);
    expect(describeMfaError({ message: 'something unrelated' })).not.toBe(BAD_CODE_MESSAGE);
  });
});

describe('beginEnrol friendly names', () => {
  it('differ between attempts because the clock moved on, not because of a sleep', async () => {
    const now = vi.spyOn(Date, 'now');
    try {
      const mfa = client();
      now.mockReturnValue(1_000_000);
      await beginEnrol(mfa);
      now.mockReturnValue(2_000_000);
      await beginEnrol(mfa);
      const names = mfa.auth.mfa.enroll.mock.calls.map((call) => call[0].friendlyName);
      expect(names[0]).not.toBe(names[1]);
    } finally {
      now.mockRestore();
    }
  });
});
