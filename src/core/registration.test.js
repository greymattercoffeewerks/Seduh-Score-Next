import { describe, it, expect, vi } from 'vitest';
import { parsePhone, phoneErrorMessage } from './phone.js';
import { REGISTRATION_LIMITS, phoneProblem, registerAndLink } from './registration.js';

describe('core/registration', () => {
  it('holds the registration RPC caps in one place', () => {
    expect(REGISTRATION_LIMITS).toEqual({ displayName: 200, email: 254, cafe: 200, bib: 50 });
    expect(Object.isFrozen(REGISTRATION_LIMITS)).toBe(true);
  });

  it('reads the phone in the chosen country: a Brunei local number is fine in BN, refused in MY', () => {
    expect(phoneProblem('7123456', 'BN')).toBeNull();
    expect(phoneProblem('7123456', 'MY')).toEqual({
      field: 'phone',
      message: phoneErrorMessage(parsePhone('7123456', { country: 'MY' }).code),
    });
  });

  it('names the exact core/phone.js refusal for a number it cannot read', () => {
    const code = parsePhone('12', { country: 'BN' }).code;
    expect(code).toBeTruthy();
    expect(phoneProblem('12', 'BN')).toEqual({ field: 'phone', message: phoneErrorMessage(code) });
  });

  // A client just rich enough for registerEntry's find-or-create: no person yet, no entry yet.
  function client() {
    const rpc = vi.fn(async () => ({ error: null }));
    const inserts = [];
    return {
      rpc,
      inserts,
      from(table) {
        let inserted = null;
        const q = {
          select: () => q,
          eq: () => q,
          ilike: () => q,
          insert: (row) => {
            inserted = { id: `${table}-1`, ...row };
            inserts.push({ table, row });
            return q;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({
            data: inserted ?? { display_name: 'Ana', cafe: null },
            error: null,
          }),
        };
        return q;
      },
    };
  }

  it('registers by canonical phone, enters the person, then asks for the Seduh ID link', async () => {
    const c = client();
    const entry = await registerAndLink(
      'org',
      'ev',
      { displayName: 'Ana', phone: '712 3456', phoneCountry: 'BN' },
      c,
    );
    expect(c.inserts[0]).toMatchObject({ table: 'people', row: { phone: '+6737123456' } });
    expect(entry).toMatchObject({ event_id: 'ev', person_id: 'people-1' });
    expect(c.rpc).toHaveBeenCalledWith('link_person_identity', {
      p_org_id: 'org',
      p_person_id: 'people-1',
    });
  });
});
