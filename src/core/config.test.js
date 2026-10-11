import { describe, it, expect, afterEach, vi } from 'vitest';
import { getLegacyAudienceOrgId } from './config.js';

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
