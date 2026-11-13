import { describe, expect, it } from 'vitest';
import { buildCountryChip } from './countryChip.js';

describe('buildCountryChip', () => {
  it('draws nothing by default: the country pages are not public yet', () => {
    expect(buildCountryChip({ code: 'BN', name: 'Brunei' })).toBeNull();
  });

  it('when switched on, links to the lower-case country page with the code as text and a spoken purpose', () => {
    const chip = buildCountryChip({ code: 'BN', name: 'Brunei' }, { enabled: true });
    expect(chip.tagName).toBe('A');
    expect(chip.getAttribute('href')).toBe('/id/country/bn/');
    expect(chip.querySelector('.ok-flag-code').textContent).toBe('BN');
    // the country name is NOT repeated for a screen reader (a row header already says it); it is the hover title
    expect(chip.querySelector('.sr-only').textContent).not.toContain('Brunei');
    expect(chip.getAttribute('title')).toBe('Brunei: country record');
    expect(chip.querySelector('.sr-only').textContent).toContain('country record');
  });

  it('accepts a bare code, names it itself, and draws nothing for no or a malformed country', () => {
    expect(buildCountryChip('my', { enabled: true }).getAttribute('href')).toBe('/id/country/my/');
    expect(buildCountryChip('my', { enabled: true }).getAttribute('title')).toContain('Malaysia');
    for (const bad of [null, undefined, '', 'BRN', { code: '' }, { code: 'b1' }, {}]) {
      expect(buildCountryChip(bad, { enabled: true })).toBeNull();
    }
  });
});
