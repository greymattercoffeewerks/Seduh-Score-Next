// The "cannot drift" contract (gating spec 3.6): the catalog file, the migration's seed and the client reader are one
// list. pgTAP cannot read files, so the comparison lives here and parses the seed out of the migration.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import catalog from '../../supabase/entitlements.catalog.json';
import { entitlementKeys } from './entitlements.js';

const MIGRATIONS = join(import.meta.dirname, '../../supabase/migrations');

// The catalog is embedded verbatim between $catalog$ markers in the migration that creates the tables.
function seededCatalogs() {
  const found = [];
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/\$catalog\$([\s\S]*?)\$catalog\$/g)) {
      found.push({ file: f, catalog: JSON.parse(m[1]) });
    }
  }
  return found;
}

describe('the entitlement catalog', () => {
  it('is seeded by exactly one migration, and that seed equals the catalog file', () => {
    const seeds = seededCatalogs();
    expect(seeds.map((s) => s.file)).toEqual(['20261023100000_entitlements_core.sql']);
    expect(seeds[0].catalog).toEqual(catalog);
  });

  it('is exactly the list src/core/entitlements.js knows', () => {
    expect(entitlementKeys().sort()).toEqual(catalog.keys.map((k) => k.key).sort());
  });

  it('has strictly increasing, unique tier ranks starting at the default tier', () => {
    const ranks = catalog.tiers.map((t) => t.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(catalog.tiers[0]).toEqual({ tier: 'community', rank: 0 });
    expect(catalog.tiers.map((t) => t.tier)).toEqual(['community', 'per_event', 'annual']);
  });

  it('uses unique snake_case key names and only known tiers, kinds and window flags', () => {
    const tiers = new Set(catalog.tiers.map((t) => t.tier));
    const names = catalog.keys.map((k) => k.key);
    expect(new Set(names).size).toBe(names.length);
    for (const k of catalog.keys) {
      expect(k.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(['flag', 'cap']).toContain(k.kind);
      if (k.min_tier !== null) expect(tiers.has(k.min_tier)).toBe(true);
      expect(typeof k.window_bound).toBe('boolean');
      expect(typeof k.note).toBe('string');
    }
  });

  it('gives every cap key a limit for every tier and no min_tier, and flag keys no caps', () => {
    const tierNames = catalog.tiers.map((t) => t.tier);
    for (const k of catalog.keys) {
      if (k.kind === 'cap') {
        expect(k.min_tier).toBeNull();
        expect(Object.keys(k.caps).sort()).toEqual([...tierNames].sort());
        for (const v of Object.values(k.caps)) {
          expect(v === null || (Number.isInteger(v) && v >= 0)).toBe(true);
        }
      } else {
        expect(k.caps).toBeUndefined();
      }
    }
  });

  it('holds the owner decisions of 2026-10-23', () => {
    const byKey = Object.fromEntries(catalog.keys.map((k) => [k.key, k]));
    // BTC is not on Community; it is a real key with minimum tier per_event
    expect(byKey.btc_format).toMatchObject({ kind: 'flag', min_tier: 'per_event' });
    // the Cup Taster cap: Community 8, everything else unlimited
    expect(byKey.cup_taster_participants.caps).toEqual({
      community: 8,
      per_event: null,
      annual: null,
    });
    // the registration page does not expire with the Per-event window
    expect(byKey.registration_page.window_bound).toBe(false);
    // Guess the Bean creation is registered but open to every tier
    expect(byKey.guess_the_bean_create.min_tier).toBeNull();
    // the retired stub keys are gone
    expect(byKey.cup_taster_unlimited).toBeUndefined();
    expect(byKey.audience_enhanced).toBeUndefined();
  });
});
