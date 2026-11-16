import { describe, expect, it } from 'vitest';
import { COUNTRY_HUB_PATH } from '../src/core/countryPages.js';
import {
  aliasRedirectFor,
  CLAIM_SHELL_PATH,
  HANDLE_ALIASES,
  claimShellFor,
  isClaimPath,
  isMePath,
  meShellFor,
  isProfilePath,
  PROFILE_SHELL_PATH,
  profileShellFor,
} from './idRoute.js';

describe('isProfilePath', () => {
  it('is true for one segment under /id/, with or without a trailing slash, in any case', () => {
    for (const ok of [
      '/id/syafiqah',
      '/id/syafiqah/',
      '/id/Syafiqah/',
      '/id/a',
      '/id/ab',
      '/id/some-one_2',
      `/id/${'x'.repeat(64)}`,
    ]) {
      expect(isProfilePath(ok), ok).toBe(true);
    }
  });

  it('answers the same for a handle that is too short, too long or the wrong case as for a good one', () => {
    // A different answer would say which handles exist. Shape rules (3 to 30, lower case) belong to the database.
    expect(isProfilePath('/id/ab')).toBe(isProfilePath('/id/abc'));
    expect(isProfilePath(`/id/${'x'.repeat(31)}`)).toBe(isProfilePath(`/id/${'x'.repeat(30)}`));
    expect(isProfilePath('/id/ABC')).toBe(isProfilePath('/id/abc'));
  });

  it('never claims the country pages, in any spelling', () => {
    for (const no of [
      '/id/country',
      '/id/country/',
      '/id/Country',
      '/id/COUNTRY/',
      '/id/country/bn',
      '/id/country/bn/',
    ]) {
      expect(isProfilePath(no), no).toBe(false);
    }
  });

  it('is false for the bare /id/ page, deeper paths, files and anything outside /id/', () => {
    for (const no of [
      '/id',
      '/id/',
      '/id//',
      '/id/a/b',
      '/id/favicon.ico',
      '/id/index.html',
      '/id/a%2Fb',
      '/id/a b',
      `/id/${'x'.repeat(65)}`,
      '/identity/someone',
      '/app/someone',
      '/results/',
      '/',
      '',
    ]) {
      expect(isProfilePath(no), no).toBe(false);
    }
  });
});

describe('profileShellFor', () => {
  it('names the built shell for a person page and nothing otherwise', () => {
    expect(PROFILE_SHELL_PATH).toBe('/id/');
    expect(profileShellFor('/id/syafiqah/')).toBe('/id/index.html');
    expect(profileShellFor('/id/country/bn/')).toBeNull();
    expect(profileShellFor('/nope/')).toBeNull();
  });
});

describe('the country pages and the edge agree', () => {
  it('the edge never claims the word the country hub path is built from', () => {
    // The Worker cannot import src/core (it is bundled alone), so this pins its hard-coded word to the hub path.
    expect(COUNTRY_HUB_PATH).toBe('/id/country/');
    expect(isProfilePath(COUNTRY_HUB_PATH)).toBe(false);
    expect(isProfilePath(COUNTRY_HUB_PATH.replace(/\/$/, ''))).toBe(false);
  });
});

describe('the claim page', () => {
  it('is its own path, in any case, and is never a person page', () => {
    for (const yes of ['/id/claim', '/id/claim/', '/id/Claim/', '/id/CLAIM']) {
      expect(isClaimPath(yes), yes).toBe(true);
      expect(isProfilePath(yes), yes).toBe(false);
    }
    expect(CLAIM_SHELL_PATH).toBe('/id/claim/');
    expect(claimShellFor('/id/claim/')).toBe('/id/claim/index.html');
  });

  it('is nothing else: not a longer path, a file, a neighbour or a country page', () => {
    for (const no of [
      '/id/claims/',
      '/id/claim/x',
      '/id/claim.html',
      '/id/country/bn/',
      '/id/',
      '/id/syafiqah/',
      '/claim/',
    ]) {
      expect(isClaimPath(no), no).toBe(false);
      expect(claimShellFor(no), no).toBeNull();
    }
  });
});

describe('aliasRedirectFor (owner aliases)', () => {
  it('sends /id/firdaus and /id/firdaus/ in any case to /id/mfosa/', () => {
    for (const path of ['/id/firdaus', '/id/firdaus/', '/id/Firdaus', '/id/FIRDAUS/']) {
      expect(aliasRedirectFor(path), path).toBe('/id/mfosa/');
    }
  });

  it('leaves every other path alone: other handles, the target, country, claim, deeper paths, lookalikes', () => {
    for (const path of [
      '/id/mfosa/',
      '/id/someone',
      '/id/country',
      '/id/country/',
      '/id/claim/',
      '/id/firdaus2/',
      '/id/xfirdaus',
      '/id/firdaus/extra',
      '/id/constructor',
      '/id/__proto__',
      '/id/toString/',
      '/firdaus',
      '/id/',
    ]) {
      expect(aliasRedirectFor(path), path).toBeNull();
    }
  });

  it('only ever points an alias at a well-formed lower-case handle that is not itself an alias', () => {
    for (const [from, to] of Object.entries(HANDLE_ALIASES)) {
      expect(from).toMatch(/^[a-z0-9-]{3,30}$/);
      expect(to).toMatch(/^[a-z0-9-]{3,30}$/);
      expect(Object.hasOwn(HANDLE_ALIASES, to), `${from} points at an alias`).toBe(false);
    }
  });
});

describe('My Seduh ID path (T-ID2.D-b)', () => {
  it('is /id/me and /id/me/ in any case, and nothing else', () => {
    for (const ok of ['/id/me', '/id/me/', '/id/Me/', '/id/ME'])
      expect(isMePath(ok), ok).toBe(true);
    for (const no of ['/id/mel', '/id/me/x', '/id/me.html', '/id/', '/id/claim/', '/me/']) {
      expect(isMePath(no), no).toBe(false);
    }
    expect(meShellFor('/id/me')).toBe('/id/me/index.html');
    expect(meShellFor('/id/mfosa/')).toBeNull();
  });
  it('is never a person page (me is reserved), while a handle starting with me still is', () => {
    expect(isProfilePath('/id/me/')).toBe(false);
    expect(isProfilePath('/id/me')).toBe(false);
    expect(isProfilePath('/id/mello/')).toBe(true);
    expect(isProfilePath('/id/mfosa/')).toBe(true);
  });
});
