import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  linkPersonIdentity,
  requestPersonLink,
  isPersonLinked,
  listOrgPeople,
  PEOPLE_LIST_LIMIT,
} from './identity.js';

const GLOBAL_ID = '9b1f0c52-7a44-4c8e-9d3e-5d0e6c1f2a77';

describe('linkPersonIdentity', () => {
  it('calls the RPC with the organisation and the person, and answers true when it went through', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(linkPersonIdentity('org1', 'p1', { rpc })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('link_person_identity', {
      p_org_id: 'org1',
      p_person_id: 'p1',
    });
  });

  it('treats ANY failure as "not linked": a refusal, a missing function, a thrown error', async () => {
    for (const rpc of [
      vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'refused' } }),
      vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'none' } }),
      vi.fn().mockRejectedValue(new Error('network down')),
      vi.fn(() => {
        throw new Error('sync throw');
      }),
    ]) {
      await expect(linkPersonIdentity('org1', 'p1', { rpc })).resolves.toBe(false);
    }
  });

  it('does not call at all without both ids', async () => {
    const rpc = vi.fn();
    expect(await linkPersonIdentity(null, 'p1', { rpc })).toBe(false);
    expect(await linkPersonIdentity('org1', undefined, { rpc })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers the same for every kind of refusal, so a caller cannot learn why', async () => {
    const a = await linkPersonIdentity('o', 'p', {
      rpc: async () => ({ error: { code: '42501', message: 'a' } }),
    });
    const b = await linkPersonIdentity('o', 'p', {
      rpc: async () => ({ error: { code: '42501', message: 'b', hint: 'x' } }),
    });
    expect(a).toBe(b);
  });
});

describe('requestPersonLink', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns nothing, never throws, and does not reject on failure', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('boom'));
    expect(requestPersonLink('org1', 'p1', { rpc })).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the device is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const rpc = vi.fn();
    requestPersonLink('org1', 'p1', { rpc });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('writes nothing to the console, success or failure', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    requestPersonLink('org1', 'p1', { rpc: async () => ({ error: { code: '42501' } }) });
    requestPersonLink('org1', 'p1', {
      rpc: async () => {
        throw new Error('x');
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('isPersonLinked', () => {
  it('is a boolean derived from global_person_id being set', () => {
    expect(isPersonLinked({ global_person_id: GLOBAL_ID })).toBe(true);
    expect(isPersonLinked({ global_person_id: null })).toBe(false);
    expect(isPersonLinked({})).toBe(false);
    expect(isPersonLinked(null)).toBe(false);
    expect(isPersonLinked(undefined)).toBe(false);
  });
});

describe('listOrgPeople', () => {
  function client(rows, error = null) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => Promise.resolve({ data: rows, error })),
    };
    return { builder, from: vi.fn(() => builder) };
  }

  it('returns a boolean per person and never the identity id', async () => {
    const c = client([
      { id: 'p1', display_name: 'Amy', cafe: 'C', global_person_id: GLOBAL_ID },
      { id: 'p2', display_name: 'Bo', cafe: null, global_person_id: null },
    ]);
    const { people, truncated } = await listOrgPeople('org1', c);
    expect(people).toEqual([
      { id: 'p1', displayName: 'Amy', cafe: 'C', linked: true },
      { id: 'p2', displayName: 'Bo', cafe: null, linked: false },
    ]);
    expect(truncated).toBe(false);
    expect(JSON.stringify(people)).not.toContain(GLOBAL_ID);
    expect(c.builder.eq).toHaveBeenCalledWith('org_id', 'org1');
  });

  it('says when the list was cut off at the limit', async () => {
    const rows = Array.from({ length: PEOPLE_LIST_LIMIT }, (_, i) => ({
      id: `p${i}`,
      display_name: `N${i}`,
      cafe: null,
      global_person_id: null,
    }));
    expect((await listOrgPeople('org1', client(rows))).truncated).toBe(true);
  });

  it('throws on a read error', async () => {
    await expect(listOrgPeople('org1', client(null, new Error('x')))).rejects.toThrow('x');
  });
});
