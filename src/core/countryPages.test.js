import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_HUB_PATH,
  COUNTRY_PAGES_PUBLIC,
  countryHubUrl,
  countryPagePath,
  countryPageUrl,
  parseCountryPath,
} from './countryPages.js';

// Every non-test source file under a directory.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.js$/.test(name) && !/\.test\.js$/.test(name) ? [full] : [];
  });
}

describe('the country pages switch', () => {
  it('is OFF: the organiser records were released for the Board presentation only (spec CP4)', () => {
    // Flipping this is the owner's decision after the Board. A failing test here is the prompt to ask.
    expect(COUNTRY_PAGES_PUBLIC).toBe(false);
  });

  // Every public entry point must read the ONE constant (directly, or through the chip builder), never a second flag.
  it('is read only by the entry points that are built for it', () => {
    const readers = sourceFiles('src')
      .filter((file) => /import\s*\{[^}]*COUNTRY_PAGES_PUBLIC/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();
    expect(readers).toEqual([
      'src/core/countryChip.js',
      'src/liveSurfaces.js',
      'src/marketing/publicHeader.js',
      'src/marketing/resultsSheet.js',
    ]);
  });
});

describe('no other file names the pages', () => {
  it('only the page files and the switch hold the literal /id/country (links are built from countryPages.js)', () => {
    const holders = sourceFiles('src')
      .filter((file) => readFileSync(file, 'utf8').includes('id/country'))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();
    expect(holders).toEqual([
      'src/core/countryPages.js',
      'src/marketing/countryMain.js',
      'src/marketing/countryScreen.js',
    ]);
  });
});

describe('paths', () => {
  it('builds a lower-case page path from a code in either case, and refuses anything else', () => {
    expect(countryPagePath('BN')).toBe('/id/country/bn/');
    expect(countryPagePath(' bn ')).toBe('/id/country/bn/');
    for (const bad of ['', 'B', 'BRN', 'b1', '../x', null, undefined, 5]) {
      expect(countryPagePath(bad)).toBeNull();
    }
  });
  it('gives absolute addresses on the canonical host', () => {
    expect(countryHubUrl()).toBe('https://www.seduhscore.com/id/country/');
    expect(countryPageUrl('my')).toBe('https://www.seduhscore.com/id/country/my/');
    expect(countryPageUrl('nope')).toBeNull();
    expect(COUNTRY_HUB_PATH).toBe('/id/country/');
  });
  it('reads which page a path is', () => {
    expect(parseCountryPath('/id/country/')).toEqual({ kind: 'hub' });
    expect(parseCountryPath('/id/country/index.html')).toEqual({ kind: 'hub' });
    expect(parseCountryPath('/id/country/bn/')).toEqual({ kind: 'country', code: 'BN' });
    expect(parseCountryPath('/id/country/bn')).toEqual({ kind: 'country', code: 'BN' });
    expect(parseCountryPath('/id/country/bn/index.html')).toEqual({ kind: 'country', code: 'BN' });
    for (const other of ['/', '/id/', '/id/country/bnx/', '/id/country/b1/', '/results/', null]) {
      expect(parseCountryPath(other)).toEqual({ kind: 'none' });
    }
  });
});

// A link can reach the pages three ways: the literal path, an imported helper, or an HTML file. The switch is only
// honest if none of the three exists outside the files built for it.
describe('no public file can link to the pages without going through the switch', () => {
  const HELPERS = /\b(countryPagePath|countryPageUrl|countryHubUrl|COUNTRY_HUB_PATH)\b/;

  it('only the entry points and the pages themselves import the path helpers', () => {
    const users = sourceFiles('src')
      .filter((file) => HELPERS.test(readFileSync(file, 'utf8')))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();
    expect(users).toEqual([
      'src/core/countryChip.js',
      'src/core/countryPages.js',
      'src/liveSurfaces.js',
      'src/marketing/countryScreen.js',
      'src/marketing/publicHeader.js',
      'src/marketing/resultsSheet.js',
    ]);
  });

  it('the sitemap and robots file do not list them either', () => {
    for (const file of ['public/sitemap.xml', 'public/robots.txt']) {
      if (existsSync(file)) expect(readFileSync(file, 'utf8'), file).not.toContain('id/country');
    }
  });

  function htmlFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
      if (['node_modules', 'dist', '.git', '.claude', 'test-results', 'docs'].includes(name))
        return [];
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return htmlFiles(full);
      return name.endsWith('.html') ? [full] : [];
    });
  }
  it('no HTML entry or static page names the country pages except their own shell', () => {
    const holders = htmlFiles('.')
      .filter((file) => readFileSync(file, 'utf8').includes('id/country'))
      .map((file) => file.replaceAll('\\', '/').replace(/^\.\//, ''))
      .sort();
    expect(holders).toEqual(['id/country/index.html']);
  });
});
