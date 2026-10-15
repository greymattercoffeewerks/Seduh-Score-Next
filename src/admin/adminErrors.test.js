import { describe, it, expect } from 'vitest';
import { describeAdminError, ADMIN_ERROR_COPY, GENERIC_ERROR } from './adminErrors.js';

// Every hint the database or the admin-accounts function can return, from the migrations' `hint =` clauses
// and the function's own answers. A hint added there without copy here fails this list's guard test below.
const HINTS = [
  'admin_required',
  'admin_mfa_required',
  'admin_session_ended',
  'admin_self_target',
  'org_name_invalid',
  'org_slug_invalid',
  'org_slug_reserved',
  'org_slug_taken',
  'org_owner_not_found',
  'member_user_not_found',
  'member_exists',
  'member_not_found',
  'member_role_invalid',
  'org_not_found',
  'last_owner',
  'member_password_unset',
  'email_taken',
  'account_record_failed',
  'account_stranded',
  'account_state_unknown',
];

describe('describeAdminError', () => {
  it.each(HINTS)('has its own plain sentence for %s', (hint) => {
    const text = describeAdminError({ hint });
    expect(text).toBe(ADMIN_ERROR_COPY[hint]);
    expect(text).not.toBe(GENERIC_ERROR);
    expect(text.length).toBeGreaterThan(10);
  });

  it('has copy for nothing but those hints (no stray entry)', () => {
    expect(Object.keys(ADMIN_ERROR_COPY).sort()).toEqual([...HINTS].sort());
  });

  it('falls back to the generic sentence for an unknown, missing or non-string hint', () => {
    for (const error of [{ hint: 'new_unlisted_hint' }, {}, null, undefined, { hint: 7 }]) {
      expect(describeAdminError(error)).toBe(GENERIC_ERROR);
    }
  });

  it('never matches on message text, and never returns an inherited object property', () => {
    expect(describeAdminError({ message: 'org_slug_taken' })).toBe(GENERIC_ERROR);
    expect(describeAdminError({ hint: 'toString' })).toBe(GENERIC_ERROR);
    expect(describeAdminError({ hint: '__proto__' })).toBe(GENERIC_ERROR);
  });

  it('copy mentions no raw SQLSTATE, table or function names', () => {
    for (const text of Object.values(ADMIN_ERROR_COPY)) {
      expect(text).not.toMatch(/\b(42501|22023|23505|P0001|app\.|public\.|auth\.|rpc)\b/);
    }
  });
});
