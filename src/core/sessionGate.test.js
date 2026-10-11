import { describe, it, expect } from 'vitest';
import { mustChangePassword } from './sessionGate.js';

const sessionWith = (flag) => ({
  user: { id: 'u1', user_metadata: { must_change_password: flag } },
});

describe('mustChangePassword', () => {
  it('is true only for the exact boolean true', () => {
    expect(mustChangePassword(sessionWith(true))).toBe(true);
  });

  it('is false for anything else, including the string "true"', () => {
    for (const flag of [false, 'true', 1, null, undefined, {}]) {
      expect(mustChangePassword(sessionWith(flag))).toBe(false);
    }
  });

  it('is false with no session, no user or no metadata', () => {
    expect(mustChangePassword(null)).toBe(false);
    expect(mustChangePassword(undefined)).toBe(false);
    expect(mustChangePassword({})).toBe(false);
    expect(mustChangePassword({ user: {} })).toBe(false);
    expect(mustChangePassword({ user: { user_metadata: null } })).toBe(false);
  });
});
