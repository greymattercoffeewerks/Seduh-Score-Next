import { describe, it, expect, afterEach, vi } from 'vitest';
import { getLegacyAudienceOrgId, getLegacyAudienceOrgSlug } from './config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getLegacyAudienceOrgId', () => {
  it('returns the configured VITE_DEFAULT_ORG_ID', () => {
    vi.stubEnv('VITE_DEFAULT_ORG_ID', 'org-123');
    expect(getLegacyAudienceOrgId()).toBe('org-123');
  });

  it('trims surrounding whitespace (a pasted dashboard value)', () => {
    vi.stubEnv('VITE_DEFAULT_ORG_ID', '  org-123 \n');
    expect(getLegacyAudienceOrgId()).toBe('org-123');
  });

  it('is null, and never throws, when the variable is empty, blank or missing', () => {
    vi.stubEnv('VITE_DEFAULT_ORG_ID', '');
    expect(getLegacyAudienceOrgId()).toBeNull();
    vi.stubEnv('VITE_DEFAULT_ORG_ID', '   ');
    expect(getLegacyAudienceOrgId()).toBeNull();
    vi.stubEnv('VITE_DEFAULT_ORG_ID', undefined);
    expect(() => getLegacyAudienceOrgId()).not.toThrow();
    expect(getLegacyAudienceOrgId()).toBeNull();
  });
});

describe('getLegacyAudienceOrgSlug', () => {
  it('returns the configured VITE_LEGACY_AUDIENCE_ORG_SLUG, trimmed', () => {
    vi.stubEnv('VITE_LEGACY_AUDIENCE_ORG_SLUG', '  grey-matter-coffee-werks \n');
    expect(getLegacyAudienceOrgSlug()).toBe('grey-matter-coffee-werks');
  });

  it('is null, and never throws, when the variable is empty, blank or missing', () => {
    for (const value of ['', '   ', undefined]) {
      vi.stubEnv('VITE_LEGACY_AUDIENCE_ORG_SLUG', value);
      expect(() => getLegacyAudienceOrgSlug()).not.toThrow();
      expect(getLegacyAudienceOrgSlug()).toBeNull();
    }
  });

  it('leaves the letters as typed (the audience lookup and the organiser nav both fold case themselves)', () => {
    vi.stubEnv('VITE_LEGACY_AUDIENCE_ORG_SLUG', 'Grey-Matter');
    expect(getLegacyAudienceOrgSlug()).toBe('Grey-Matter');
  });
});
