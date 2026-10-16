import { describe, it, expect } from 'vitest';
import { isEmailShaped } from './email.js';

describe('isEmailShaped', () => {
  it('accepts an address with an at sign and a dotted domain, ignoring surrounding space', () => {
    expect(isEmailShaped('a@b.test')).toBe(true);
    expect(isEmailShaped('  a.b+c@sub.example.test ')).toBe(true);
  });

  it('refuses what is clearly not one', () => {
    for (const value of [
      '',
      '   ',
      'a',
      'a@b',
      '@b.test',
      'a@.test',
      'a@b.',
      'a b@c.test',
      'a@b@c.test',
      'a@b c.test',
      null,
      undefined,
    ]) {
      expect(isEmailShaped(value), String(value)).toBe(false);
    }
  });
});
