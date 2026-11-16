import { describe, expect, it } from 'vitest';
import {
  HANDLE_CHECK_TEXT,
  TERMINAL_HINTS,
  describeClaimHint,
  formatFoundingNumber,
  isEmailHint,
  isHandleShape,
  isTerminalHint,
  normaliseCode,
  normaliseEmail,
  normaliseHandle,
  readClaimToken,
  stepLabel,
} from './claimFlow.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-';

describe('readClaimToken', () => {
  it('reads a 43-character token with or without the #', () => {
    expect(TOKEN).toHaveLength(43);
    expect(readClaimToken(`#${TOKEN}`)).toBe(TOKEN);
    expect(readClaimToken(TOKEN)).toBe(TOKEN);
  });
  it('is null for anything that cannot be a token', () => {
    for (const bad of [
      '',
      '#',
      null,
      undefined,
      '#short',
      `${TOKEN}x`,
      `#${TOKEN.slice(1)}`,
      `#${TOKEN.slice(1)}!`,
      '#a b',
    ]) {
      expect(readClaimToken(bad), String(bad)).toBeNull();
    }
  });
});

describe('handles', () => {
  it('trims and lower-cases like the database', () => {
    expect(normaliseHandle('  Syafiqah-1 ')).toBe('syafiqah-1');
    expect(normaliseHandle(null)).toBe('');
  });
  it('accepts the database shape and nothing else', () => {
    for (const ok of ['abc', 'a-b', 'a1b', 'x'.repeat(30), 'syafiqah-2'])
      expect(isHandleShape(ok), ok).toBe(true);
    for (const bad of ['ab', 'x'.repeat(31), '-ab', 'ab-', 'a--b', 'a_b', 'a b', 'ÀBC', ''])
      expect(isHandleShape(bad), bad).toBe(false);
  });
});

describe('email and code', () => {
  it('normalises an email and refuses a non-email', () => {
    expect(normaliseEmail('  Person@Example.COM ')).toBe('person@example.com');
    for (const bad of ['', 'a', 'a@b', 'a b@c.d', '@b.c', `${'x'.repeat(250)}@a.bc`, null])
      expect(normaliseEmail(bad), String(bad)).toBeNull();
  });
  it('reads six digits, tolerating spaces and dashes', () => {
    expect(normaliseCode('123456')).toBe('123456');
    expect(normaliseCode(' 123 456 ')).toBe('123456');
    expect(normaliseCode('123-456')).toBe('123456');
    for (const bad of ['12345', '1234567', 'abcdef', '', null])
      expect(normaliseCode(bad), String(bad)).toBeNull();
  });
});

describe('formatFoundingNumber', () => {
  it('pads to four digits', () => {
    expect(formatFoundingNumber(1)).toBe('#0001');
    expect(formatFoundingNumber(42)).toBe('#0042');
    expect(formatFoundingNumber(12345)).toBe('#12345');
    expect(formatFoundingNumber(0)).toBeNull();
    expect(formatFoundingNumber('7')).toBeNull();
  });
});

describe('describeClaimHint: every refusal has its own plain words', () => {
  // Every hint the database or the function can send for a claim, plus the ones the page makes itself.
  const hints = [
    'link_invalid',
    'link_used',
    'link_revoked',
    'link_expired',
    'identity_unavailable',
    'identity_claimed',
    'bad_email',
    'too_many_codes',
    'email_rate_limited',
    'email_send_failed',
    'otp_invalid',
    'too_many_attempts',
    'handle_invalid',
    'handle_reserved',
    'handle_taken',
    'adult_required',
    'account_exists',
    'admin_cannot_claim',
    'signed_out',
    'offline',
    'timeout',
    'bad_request',
    'server_error',
  ];
  const generic = describeClaimHint('nonsense');

  it('has a sentence for each, none of them the generic one (except the two that are generic on purpose)', () => {
    for (const hint of hints) {
      const words = describeClaimHint(hint);
      expect(words.length, hint).toBeGreaterThan(10);
      expect(words, hint).not.toMatch(/_|hint|42501|P0001/);
      if (hint !== 'bad_request') expect(words, hint).not.toBe(generic);
    }
  });
  it('gives distinct words to each hint', () => {
    expect(new Set(hints.filter((h) => h !== 'bad_request').map(describeClaimHint)).size).toBe(
      hints.length - 1,
    );
  });
  it('answers an unknown, missing or inherited hint with the generic sentence, never raw text', () => {
    for (const odd of ['nonsense', undefined, null, '', 'constructor', 'toString', '__proto__']) {
      expect(describeClaimHint(odd), String(odd)).toBe(generic);
    }
  });
  it('says what to do for the link refusals', () => {
    expect(describeClaimHint('link_expired')).toMatch(/72 hours.*new one/);
    expect(describeClaimHint('link_revoked')).toMatch(/cancelled.*new one/);
    expect(describeClaimHint('link_used')).toMatch(/already been used/);
    expect(describeClaimHint('handle_taken')).toMatch(/taken/);
    expect(describeClaimHint('handle_reserved')).toMatch(/reserved/);
    expect(describeClaimHint('adult_required')).toMatch(/18 or over/);
    expect(describeClaimHint('account_exists')).toMatch(/different email/);
    expect(describeClaimHint('admin_cannot_claim')).toMatch(/different email/);
  });
});

describe('which hints end the flow and which send the person back', () => {
  it('ends the flow for the link-level refusals only', () => {
    expect([...TERMINAL_HINTS].sort()).toEqual(
      [
        'identity_claimed',
        'identity_unavailable',
        'link_expired',
        'link_invalid',
        'link_revoked',
        'link_used',
      ].sort(),
    );
    for (const hint of [
      'handle_taken',
      'adult_required',
      'offline',
      'otp_invalid',
      'account_exists',
    ]) {
      expect(isTerminalHint(hint), hint).toBe(false);
    }
  });
  it('sends the person back to the email step for a login problem', () => {
    for (const hint of ['account_exists', 'admin_cannot_claim', 'signed_out'])
      expect(isEmailHint(hint), hint).toBe(true);
    expect(isEmailHint('handle_taken')).toBe(false);
  });
});

describe('the words around the handle check and the steps', () => {
  it('has words for every answer of seduh_handle_available, and for a failed check', () => {
    for (const answer of ['available', 'taken', 'reserved', 'invalid', 'failed']) {
      expect(HANDLE_CHECK_TEXT[answer], answer).toMatch(/\w/);
    }
  });
  it('labels the four steps and nothing else', () => {
    expect(['welcome', 'email', 'code', 'handle'].map(stepLabel)).toEqual([
      'Step 1 of 4',
      'Step 2 of 4',
      'Step 3 of 4',
      'Step 4 of 4',
    ]);
    expect(stepLabel('done')).toBeNull();
    expect(stepLabel('end')).toBeNull();
  });
});
