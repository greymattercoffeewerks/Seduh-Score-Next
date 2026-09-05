import { describe, it, expect } from 'vitest';
import { APP_VERSION, NAMEPLATE } from './version.js';

describe('version', () => {
  it('APP_VERSION is a real semver string, not a placeholder', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).not.toBe('0.0.0');
  });

  it('NAMEPLATE is a non-empty place name', () => {
    expect(typeof NAMEPLATE).toBe('string');
    expect(NAMEPLATE.length).toBeGreaterThan(0);
  });
});
