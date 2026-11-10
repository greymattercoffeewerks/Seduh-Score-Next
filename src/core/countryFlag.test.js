import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { countryOptions } from './country.js';
import {
  normaliseCountryCode,
  flagPath,
  hasFlag,
  flagCodes,
  renderCountryFlag,
} from './countryFlag.js';

describe('normaliseCountryCode', () => {
  it('upper-cases a two-letter code and trims it', () => {
    expect(normaliseCountryCode('bn')).toBe('BN');
    expect(normaliseCountryCode(' my ')).toBe('MY');
  });

  it('refuses anything not shaped like a code', () => {
    for (const bad of [null, undefined, '', 'B', 'BRN', 'B1', 12, {}, '../etc']) {
      expect(normaliseCountryCode(bad)).toBeNull();
    }
  });
});

describe('the flag set', () => {
  it('has a flag for every code in core/country.js (the one list the app uses)', () => {
    const onDisk = new Set(
      readdirSync('src/core/flags')
        .filter((name) => name.endsWith('.svg'))
        .map((name) => name.slice(0, -4).toUpperCase()),
    );
    const missing = countryOptions()
      .map((option) => option.iso)
      .filter((iso) => !onDisk.has(iso) || !hasFlag(iso));
    expect(missing).toEqual([]);
  });

  it('ships only files the list can reach: every file is a real SVG named for a listed code', () => {
    const listed = new Set(countryOptions().map((option) => option.iso));
    const files = readdirSync('src/core/flags').filter((name) => name.endsWith('.svg'));
    for (const name of files) {
      expect(listed.has(name.slice(0, -4).toUpperCase())).toBe(true);
      const text = readFileSync(`src/core/flags/${name}`, 'utf8');
      expect(text.startsWith('<svg')).toBe(true);
      // Self-hosted and inert: no script, no event handler, no remote reference.
      expect(text).not.toMatch(/<script|\son[a-z]+=|href="https?:|<image|base64/i);
    }
    expect(flagCodes().sort()).toEqual(files.map((name) => name.slice(0, -4).toUpperCase()).sort());
  });

  it('keeps the licence beside the files (MIT asks for the notice to travel with copies)', () => {
    const licence = readFileSync('src/core/flags/LICENSE', 'utf8');
    expect(licence).toMatch(/MIT License/);
    expect(licence).toMatch(/Panayiotis Lipiridis/);
  });

  it('gives no path to a code outside the list or a malformed one', () => {
    expect(flagPath('ZZ')).toBeNull();
    expect(flagPath('../..')).toBeNull();
    expect(flagPath(null)).toBeNull();
    expect(flagPath('bn')).toBe('./flags/bn.svg');
  });
});

describe('renderCountryFlag', () => {
  const resolveUrl = (path) => Promise.resolve(`/assets/${path.slice(2)}`);

  it('draws the flag as decoration and the code as text, for a team of either format', () => {
    // A BTC team and a Cup Taster entrant: the same helper, nothing format-shaped.
    for (const code of ['BN', 'MY']) {
      const node = renderCountryFlag(code, { resolveUrl });
      const img = node.querySelector('img');
      expect(img.getAttribute('aria-hidden')).toBe('true');
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('width')).toBe('24');
      expect(img.getAttribute('height')).toBe('16');
      expect(node.querySelector('.ok-flag-code').textContent).toBe(code);
      // The text alone says the country: the picture is not needed to read it.
      expect(node.textContent).toBe(code);
    }
  });

  it('sets the picture once its file has loaded', async () => {
    const node = renderCountryFlag('bn', { resolveUrl });
    await Promise.resolve();
    await Promise.resolve();
    expect(node.querySelector('img').getAttribute('src')).toBe('/assets/flags/bn.svg');
  });

  it('hides a picture that fails to load and keeps the code', async () => {
    const node = renderCountryFlag('BN', {
      resolveUrl: () => Promise.reject(new Error('offline')),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(node.querySelector('img').hidden).toBe(true);
    expect(node.textContent).toBe('BN');
  });

  it('shows only the code for a code with no flag file, and nothing for no country', () => {
    const odd = renderCountryFlag('ZZ', { resolveUrl });
    expect(odd.querySelector('img')).toBeNull();
    expect(odd.textContent).toBe('ZZ');
    expect(renderCountryFlag(null)).toBeNull();
    expect(renderCountryFlag('')).toBeNull();
    expect(renderCountryFlag('Brunei')).toBeNull();
  });

  it('loads the real file by default (the self-hosted glob resolves to an address)', async () => {
    const node = renderCountryFlag('BN');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(node.querySelector('img').getAttribute('src')).toMatch(/bn.*\.svg|^data:image\/svg/);
  });
});
