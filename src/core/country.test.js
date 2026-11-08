import { describe, it, expect, vi, afterEach } from 'vitest';
import { HOME_COUNTRY, countryOptions, countryName, isCountryCode } from './country.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('countryOptions', () => {
  it('lists Brunei first, then every other country by name', () => {
    const options = countryOptions();
    expect(options[0]).toMatchObject({ iso: HOME_COUNTRY, name: 'Brunei' });
    expect(options.length).toBeGreaterThan(200);
    expect(new Set(options.map((o) => o.iso)).size).toBe(options.length);
    const rest = options.slice(1).map((o) => o.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it("carries no calling code: that is the phone picker's own concern", () => {
    expect(Object.keys(countryOptions()[0]).sort()).toEqual(['iso', 'name']);
  });

  it('falls back to the code when Intl.DisplayNames cannot be built', () => {
    vi.stubGlobal('Intl', { ...Intl, DisplayNames: undefined });
    const options = countryOptions();
    expect(options.find((o) => o.iso === 'SG').name).toBe('SG');
    expect(options[0].iso).toBe(HOME_COUNTRY);
  });
});

describe('countryName', () => {
  it('names a code', () => {
    expect(countryName('SG')).toBe('Singapore');
  });

  it('is null for no country', () => {
    expect(countryName(null)).toBeNull();
    expect(countryName(undefined)).toBeNull();
    expect(countryName('')).toBeNull();
  });

  it('falls back to the code when Intl throws', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      DisplayNames: class {
        of() {
          throw new RangeError('bad code');
        }
      },
    });
    expect(countryName('SG')).toBe('SG');
  });

  it('falls back to the code when Intl has no DisplayNames', () => {
    vi.stubGlobal('Intl', { ...Intl, DisplayNames: undefined });
    expect(countryName('BN')).toBe('BN');
  });
});

describe('isCountryCode', () => {
  it('accepts a listed code and refuses anything else', () => {
    expect(isCountryCode('BN')).toBe(true);
    expect(isCountryCode('SG')).toBe(true);
    expect(isCountryCode('bn')).toBe(false);
    expect(isCountryCode('XX')).toBe(false);
    expect(isCountryCode('')).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });
});
