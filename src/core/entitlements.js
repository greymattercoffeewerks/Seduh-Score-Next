// UX-only entitlement reader (gating spec 3.7). The database is the boundary: every refusal that matters is
// raised there (a trigger or an RPC, SQLSTATE 42501 with a stable hint). This module never grants anything the
// database would refuse; it only lets a screen hide or explain something it already knows will be refused.
//
// The key list comes from supabase/entitlements.catalog.json, the same file the migration seeds from; a contract
// test (entitlements.contract.test.js) fails if the two, or this module's view of them, ever differ.
//
// Fail-open on purpose: with no snapshot loaded (not signed in, the read failed, an older database), every known key
// reads as allowed and the screen behaves as it always has, so a plan problem can never brick a screen mid-event.
// The database still decides.
import catalog from '../../supabase/entitlements.catalog.json';
import { getSupabase } from './supabaseClient.js';

const KEYS = new Map(catalog.keys.map((k) => [k.key, k]));

let snapshot = null;

function known(key) {
  if (!KEYS.has(key)) {
    throw new Error(`entitlements: unknown key "${key}"`);
  }
  return KEYS.get(key);
}

export function entitlementKeys() {
  return [...KEYS.keys()];
}

// Hands in a snapshot read by loadEntitlements (or null to forget it). Held in memory only: a snapshot is
// per sign-in and per organisation, and the composition root decides when to replace it.
export function setEntitlements(next) {
  snapshot = next && typeof next === 'object' && next.keys ? next : null;
}

export function currentTier() {
  return snapshot?.tier ?? null;
}

// May the active organisation use this capability right now, as far as the database last said? Synchronous.
export function canAccess(key) {
  known(key);
  const entry = snapshot?.keys?.[key];
  return entry ? entry.allowed !== false : true;
}

// Is this key switched on for the platform, as far as the database last said? `allowed` alone cannot tell: it reads true
// for every key that is off. The database reports `enforced` for the keys a screen must be able to tell apart (today only
// results_archive_optional); for any other key, or with no snapshot, this is false ("not known to be on"), never a guess.
export function isEnforced(key) {
  known(key);
  return snapshot?.keys?.[key]?.enforced === true;
}

// The cap for a capped key (a number), or null for "no limit known". Never decides anything on its own.
export function limitFor(key) {
  const meta = known(key);
  if (meta.kind !== 'cap') return null;
  const limit = snapshot?.keys?.[key]?.limit;
  return Number.isInteger(limit) ? limit : null;
}

// Reads the snapshot for an organisation (and optionally an event). Returns it, or null when it could not be
// read: callers treat null as "unknown", which canAccess answers as allowed (fail-open for the UI only).
export async function loadEntitlements(orgId, eventId = null, client = getSupabase()) {
  try {
    const { data, error } = await client.rpc('my_entitlements', {
      p_org: orgId,
      p_event: eventId ?? null,
    });
    if (error || !data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}
