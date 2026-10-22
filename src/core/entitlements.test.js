import { describe, it, expect, beforeEach } from 'vitest';
import {
  canAccess,
  currentTier,
  entitlementKeys,
  limitFor,
  loadEntitlements,
  setEntitlements,
} from './entitlements.js';

const snap = (keys, tier = 'community') => ({ tier, keys });

beforeEach(() => setEntitlements(null));

describe('canAccess without a snapshot (fail-open for the UI; the database decides)', () => {
  it('allows every known key', () => {
    for (const key of entitlementKeys()) expect(canAccess(key)).toBe(true);
  });

  it('still throws on an unknown key rather than silently allowing it', () => {
    expect(() => canAccess('not_a_real_key')).toThrow(/unknown key/);
  });

  it('has no tier and no limit', () => {
    expect(currentTier()).toBeNull();
    expect(limitFor('cup_taster_participants')).toBeNull();
  });
});

describe('canAccess with a snapshot', () => {
  it('follows the snapshot, key by key', () => {
    setEntitlements(snap({ btc_format: { allowed: false }, cup_taster_report: { allowed: true } }));
    expect(canAccess('btc_format')).toBe(false);
    expect(canAccess('cup_taster_report')).toBe(true);
  });

  it('treats a key the snapshot does not mention as allowed (an older database)', () => {
    setEntitlements(snap({ btc_format: { allowed: false } }));
    expect(canAccess('season_history')).toBe(true);
  });

  it('still throws on an unknown key', () => {
    setEntitlements(snap({}));
    expect(() => canAccess('nope')).toThrow();
  });

  it('exposes the tier', () => {
    setEntitlements(snap({}, 'annual'));
    expect(currentTier()).toBe('annual');
  });

  it('forgets a snapshot when given null, and ignores a malformed one', () => {
    setEntitlements(snap({ btc_format: { allowed: false } }));
    setEntitlements(null);
    expect(canAccess('btc_format')).toBe(true);
    setEntitlements('nonsense');
    expect(canAccess('btc_format')).toBe(true);
    setEntitlements({ tier: 'annual' });
    expect(currentTier()).toBeNull();
  });
});

describe('limitFor', () => {
  it('reads the cap of a capped key', () => {
    setEntitlements(snap({ cup_taster_participants: { allowed: true, limit: 8 } }));
    expect(limitFor('cup_taster_participants')).toBe(8);
  });

  it('is null for an unlimited cap, a dark cap and a flag key', () => {
    setEntitlements(
      snap({
        cup_taster_participants: { allowed: true, limit: null },
        btc_format: { allowed: true, limit: 3 },
      }),
    );
    expect(limitFor('cup_taster_participants')).toBeNull();
    expect(limitFor('btc_format')).toBeNull();
  });

  it('throws on an unknown key', () => {
    expect(() => limitFor('nope')).toThrow();
  });
});

describe('loadEntitlements', () => {
  const client = (result) => {
    const c = {
      rpc: (name, args) => {
        c.last = { name, args };
        if (result instanceof Error) return Promise.reject(result);
        return Promise.resolve(result);
      },
    };
    return c;
  };

  it('calls my_entitlements with the organisation and event and returns the snapshot', async () => {
    const data = snap({ btc_format: { allowed: true } });
    const c = client({ data, error: null });
    expect(await loadEntitlements('org-1', 'ev-1', c)).toEqual(data);
    expect(c.last).toEqual({ name: 'my_entitlements', args: { p_org: 'org-1', p_event: 'ev-1' } });
  });

  it('sends a null event when none is named', async () => {
    const c = client({ data: snap({}), error: null });
    await loadEntitlements('org-1', undefined, c);
    expect(c.last.args.p_event).toBeNull();
  });

  it('returns null (unknown) on a refusal, an empty answer or a thrown error, never throws', async () => {
    expect(
      await loadEntitlements('o', null, client({ data: null, error: { code: '42501' } })),
    ).toBeNull();
    expect(await loadEntitlements('o', null, client({ data: null, error: null }))).toBeNull();
    expect(await loadEntitlements('o', null, client(new Error('offline')))).toBeNull();
  });
});
