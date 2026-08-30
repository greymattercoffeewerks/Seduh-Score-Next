import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDefaultOrgId } from './config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDefaultOrgId', () => {
  it('returns the configured VITE_DEFAULT_ORG_ID', () => {
    vi.stubEnv('VITE_DEFAULT_ORG_ID', 'org-123');
    expect(getDefaultOrgId()).toBe('org-123');
  });

  it('throws a clear, specific error when unset — fails loud, not silently wrong', () => {
    vi.stubEnv('VITE_DEFAULT_ORG_ID', '');
    expect(() => getDefaultOrgId()).toThrow(/VITE_DEFAULT_ORG_ID is not set/);
  });
});
