// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizePhone,
  parsePhone,
  validatePhoneShape,
  phoneErrorMessage,
  isPhoneErrorCode,
  phoneCountryOptions,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_COUNTRY,
  E164_PATTERN,
  PHONE_ERROR_CODES,
} from './phone.js';
import { renderPhoneCasesSql, FIXTURE_SQL } from '../../tools/generate-phone-fixture-sql.mjs';

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../tests/fixtures/phone-cases.json', import.meta.url)),
    'utf8',
  ),
);

describe('shared fixture (tests/fixtures/phone-cases.json)', () => {
  for (const c of fixture.cases) {
    it(`${c.id}: ${JSON.stringify(c.input)} (${c.country ?? 'no country'})`, () => {
      const result = parsePhone(c.input, { country: c.country });
      if (c.expect !== null) {
        expect(result).toEqual({ ok: true, phone: c.expect });
        expect(c.error).toBeNull();
      } else {
        // The exact code, so a message edit can never hide a rule change.
        expect(result).toEqual({ ok: false, code: c.error });
        expect(c.error).not.toBeNull();
      }
    });
  }

  it('has unique ids and only known codes and db modes', () => {
    const ids = fixture.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of fixture.cases) {
      expect(['canonical', 'refuse', 'skip']).toContain(c.db);
      if (c.error) expect(PHONE_ERROR_CODES).toContain(c.error);
      // A 'canonical' case is already canonical; a 'refuse' case is not.
      if (c.db === 'canonical') expect(c.input).toBe(c.expect);
      if (c.db === 'refuse') expect(c.input).not.toMatch(/^\+[1-9]\d{7,14}$/);
    }
  });

  it('covers every error code at least once', () => {
    const seen = new Set(fixture.cases.map((c) => c.error).filter(Boolean));
    // invalid_shape only comes from the stored-phone path, tested below.
    for (const code of PHONE_ERROR_CODES.filter((code) => code !== 'invalid_shape')) {
      expect(seen.has(code), code).toBe(true);
    }
  });

  it('keeps the generated database test in step with the JSON', () => {
    expect(readFileSync(FIXTURE_SQL, 'utf8')).toBe(renderPhoneCasesSql(fixture));
  });
});

describe('idempotence and shape', () => {
  it('every canonical output passes the shape check and normalises to itself', () => {
    const outputs = [
      ...fixture.cases.map((c) => c.expect),
      ...fixture.libraryBumpSnapshot.map((c) => c.expect),
    ].filter(Boolean);
    for (const phone of outputs) {
      expect(validatePhoneShape(phone)).toBeNull();
      expect(parsePhone(phone)).toEqual({ ok: true, phone });
      expect(parsePhone(phone, { country: 'SG' })).toEqual({ ok: true, phone });
    }
  });

  it('keeps E164_PATTERN textually ^\\+[1-9][0-9]{7,14}$ (pins the literal the database CHECK must match)', () => {
    expect(E164_PATTERN.source).toBe('^\\+[1-9][0-9]{7,14}$');
    expect(E164_PATTERN.flags).toBe('');
  });
});

describe('library-bump snapshot (a changed canonical output is an identity-key decision)', () => {
  it('pins about 30 real-looking numbers across the supported countries', () => {
    expect(fixture.libraryBumpSnapshot.length).toBeGreaterThanOrEqual(30);
  });
  for (const c of fixture.libraryBumpSnapshot) {
    it(`${c.country} ${c.input}`, () => {
      expect(parsePhone(c.input)).toEqual({ ok: true, phone: c.expect });
    });
  }
});

describe('the edit rule: an unchanged stored phone is checked for shape only', () => {
  it('accepts a shape-valid stored number that fails the country rules, when unchanged', () => {
    const stored = '+67381234567'; // +673 then 8 digits: shape-valid, not a Brunei number
    expect(parsePhone(stored)).toEqual({ ok: false, code: 'invalid_number' });
    expect(parsePhone(stored, { storedPhone: stored })).toEqual({ ok: true, phone: stored });
    expect(parsePhone(`  ${stored} `, { storedPhone: stored })).toEqual({
      ok: true,
      phone: stored,
    });
  });

  it('applies the full rules once the value is changed', () => {
    const stored = '+67381234567';
    expect(parsePhone('+67381234568', { storedPhone: stored })).toEqual({
      ok: false,
      code: 'invalid_number',
    });
    expect(parsePhone('8123456', { storedPhone: stored })).toEqual({
      ok: true,
      phone: '+6738123456',
    });
  });

  it('still refuses an unchanged stored value that is not even E.164-shaped', () => {
    expect(parsePhone('7123456', { storedPhone: '7123456' })).toEqual({
      ok: false,
      code: 'invalid_shape',
    });
  });

  it('treats a blank stored phone as nothing on file', () => {
    expect(parsePhone('', { storedPhone: '' })).toEqual({ ok: false, code: 'blank' });
    expect(parsePhone('7123456', { storedPhone: '' })).toEqual({ ok: true, phone: '+6737123456' });
  });
});

describe('normalizePhone', () => {
  it('returns the canonical string, or an empty string for a refusal', () => {
    expect(normalizePhone('712-3456')).toBe('+6737123456');
    expect(normalizePhone('+65 8123 4567')).toBe('+6581234567');
    expect(normalizePhone('8123 4567')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('n/a')).toBe('');
  });

  it('reads a bare number in a chosen country', () => {
    expect(normalizePhone('81234567', { country: 'SG' })).toBe('+6581234567');
  });

  it('keeps the project defaults: Brunei, +673', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('+673');
    expect(DEFAULT_COUNTRY).toBe('BN');
  });

  it('does not throw on a non-string', () => {
    expect(parsePhone(undefined)).toEqual({ ok: false, code: 'blank' });
    expect(parsePhone(null)).toEqual({ ok: false, code: 'blank' });
    expect(parsePhone(7123456)).toEqual({ ok: false, code: 'blank' });
  });
});

describe('validatePhoneShape', () => {
  it('accepts a canonical number within E.164 bounds', () => {
    expect(validatePhoneShape('+6737123456')).toBeNull();
    expect(validatePhoneShape('+6581234567')).toBeNull();
  });

  it.each(['+1', '+1234567', '+1234567890123456', '6737123456', '+0737123456', ''])(
    'refuses %j with the shape message',
    (value) => {
      expect(validatePhoneShape(value)).toBe(phoneErrorMessage('invalid_shape'));
    },
  );
});

describe('error vocabulary', () => {
  it('has the pinned list of codes, each with its own words', () => {
    expect(PHONE_ERROR_CODES).toEqual([
      'blank',
      'needs_country_code',
      'invalid_country',
      'not_a_number',
      'too_short',
      'too_long',
      'invalid_number',
      'extension_not_supported',
      'multiple_numbers',
      'invalid_shape',
    ]);
    const messages = PHONE_ERROR_CODES.map(phoneErrorMessage);
    expect(new Set(messages).size).toBe(PHONE_ERROR_CODES.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
  });

  it('answers the database hint phone_invalid with the shape message, and unknown codes the same', () => {
    expect(isPhoneErrorCode('phone_invalid')).toBe(true);
    expect(isPhoneErrorCode('needs_country_code')).toBe(true);
    expect(isPhoneErrorCode('P0002')).toBe(false);
    expect(phoneErrorMessage('phone_invalid')).toBe(phoneErrorMessage('invalid_shape'));
    expect(phoneErrorMessage('something_else')).toBe(phoneErrorMessage('invalid_shape'));
  });

  it('tells a person who typed a bare foreign number how to fix it', () => {
    expect(phoneErrorMessage('needs_country_code')).toContain('+65');
    expect(phoneErrorMessage('needs_country_code')).toContain('+673');
  });
});

describe('phoneCountryOptions', () => {
  it('lists Brunei first, then every supported country with its calling code', () => {
    const options = phoneCountryOptions();
    expect(options[0]).toMatchObject({ iso: 'BN', callingCode: '673' });
    expect(options.length).toBeGreaterThan(200);
    expect(new Set(options.map((o) => o.iso)).size).toBe(options.length);
    expect(options.find((o) => o.iso === 'SG')).toMatchObject({ callingCode: '65' });
    const rest = options.slice(1).map((o) => o.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
  });
});
