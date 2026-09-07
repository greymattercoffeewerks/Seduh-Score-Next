import { describe, it, expect } from 'vitest';
import { normalizePhone, validatePhoneShape, DEFAULT_COUNTRY_CODE } from './phone.js';

describe('normalizePhone', () => {
  it('prepends the default country code when none was typed', () => {
    expect(normalizePhone('7123456')).toBe('+6737123456');
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizePhone('712-3456')).toBe('+6737123456');
    expect(normalizePhone('(712) 3456')).toBe('+6737123456');
  });

  it('keeps an explicit leading + and its country code as typed', () => {
    expect(normalizePhone('+65 8123 4567')).toBe('+6581234567');
  });

  it('treats a leading 00 (the international-dialing alternative to +) as already carrying a country code', () => {
    expect(normalizePhone('0065 8123 4567')).toBe('+6581234567');
    expect(normalizePhone('00673 7123456')).toBe('+6737123456');
  });

  it('returns an empty string for a blank or unparseable input', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('n/a')).toBe('');
  });

  it('accepts a caller-supplied default country code', () => {
    expect(normalizePhone('81234567', '+81')).toBe('+8181234567');
  });

  it('exports the project default as +673 (Brunei)', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('+673');
  });
});

describe('validatePhoneShape', () => {
  it('accepts a normalized number within E.164 bounds', () => {
    expect(validatePhoneShape('+6737123456')).toBeNull();
    expect(validatePhoneShape('+6581234567')).toBeNull();
  });

  it('rejects a number that is too short', () => {
    expect(validatePhoneShape('+1')).not.toBeNull();
    expect(validatePhoneShape('+1234567')).not.toBeNull();
  });

  it('rejects a number that is too long', () => {
    expect(validatePhoneShape('+1234567890123456')).not.toBeNull();
  });

  it('rejects a value with no leading +', () => {
    expect(validatePhoneShape('6737123456')).not.toBeNull();
  });

  it('rejects a leading-zero country/number code', () => {
    expect(validatePhoneShape('+0737123456')).not.toBeNull();
  });
});
