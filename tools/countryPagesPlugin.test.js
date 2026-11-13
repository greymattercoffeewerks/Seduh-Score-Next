import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countryOptions, isCountryCode } from '../src/core/country.js';
import { COUNTRY_CODES, countryPagesPlugin, countryShellFor } from './countryPagesPlugin.js';

describe('countryShellFor', () => {
  it('serves the shell for one country path, in any case, and for nothing else', () => {
    for (const ok of ['/id/country/bn/', '/id/country/BN', '/id/country/bn/index.html']) {
      expect(countryShellFor(ok)).toBe('/id/country/index.html');
    }
    for (const no of [
      '/id/country/',
      '/id/country/bnx/',
      '/id/country/b1/',
      '/id/',
      '/results/',
      '/id/country/bn/x',
    ]) {
      expect(countryShellFor(no)).toBeNull();
    }
  });
});

describe('the build step', () => {
  it('writes a copy of the built shell to id/country/<iso2>/index.html for every code the app knows', () => {
    const root = mkdtempSync(join(tmpdir(), 'country-pages-'));
    try {
      mkdirSync(join(root, 'dist', 'id', 'country'), { recursive: true });
      writeFileSync(
        join(root, 'dist', 'id', 'country', 'index.html'),
        '<!doctype html><title>shell</title>',
      );
      const plugin = countryPagesPlugin();
      plugin.configResolved({ root, build: { outDir: 'dist' } });
      plugin.closeBundle();
      // a shell for exactly the codes the page accepts: none missing, none extra
      expect(COUNTRY_CODES).toEqual(countryOptions().map((row) => row.iso));
      expect(COUNTRY_CODES.length).toBeGreaterThan(200);
      for (const code of ['BN', 'MY', 'TW', 'HK', 'ID']) expect(COUNTRY_CODES).toContain(code);
      for (const code of COUNTRY_CODES) {
        expect(isCountryCode(code), code).toBe(true);
        const file = join(root, 'dist', 'id', 'country', code.toLowerCase(), 'index.html');
        expect(existsSync(file), code).toBe(true);
        expect(readFileSync(file, 'utf8')).toContain('<title>shell</title>');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes nothing when the shell was not built (a partial build is not made worse)', () => {
    const root = mkdtempSync(join(tmpdir(), 'country-pages-'));
    try {
      const plugin = countryPagesPlugin();
      plugin.configResolved({ root, build: { outDir: 'dist' } });
      plugin.closeBundle();
      expect(existsSync(join(root, 'dist', 'id'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rewrites a country path to the shell in the dev server', () => {
    const plugin = countryPagesPlugin();
    let middleware;
    plugin.configureServer({ middlewares: { use: (fn) => (middleware = fn) } });
    const req = { url: '/id/country/bn/?x=1' };
    middleware(req, {}, () => {});
    expect(req.url).toBe('/id/country/index.html');
    const other = { url: '/results/' };
    middleware(other, {}, () => {});
    expect(other.url).toBe('/results/');
  });
});
