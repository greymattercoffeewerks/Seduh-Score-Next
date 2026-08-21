import { describe, it, expect } from 'vitest';
import { canAccess } from './entitlements.js';

const REAL_KEYS = [
  'cup_taster_analytics',
  'cup_taster_report',
  'cup_taster_unlimited',
  'audience_enhanced',
  'audience_branding',
];

describe('canAccess', () => {
  for (const key of REAL_KEYS) {
    it(`"${key}" is permissive`, () => {
      expect(canAccess(key)).toBe(true);
    });
  }

  it('throws on an unregistered key rather than silently allowing it', () => {
    expect(() => canAccess('not_a_real_key')).toThrow();
  });
});
