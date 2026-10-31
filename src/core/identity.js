// Seduh ID, client side (T-ID.C1). Format-agnostic, no business logic: the database decides everything.
//
// `link_person_identity` (T-ID.B2) returns nothing and refuses every failure with one identical 42501, so
// this client must not branch on why it failed. It is best-effort and never part of a registration: a
// caller does not await it for its own result, it is NOT put in the offline outbox (nothing here is worth
// replaying), and a failure is silent - the next call, or the owner-run backfill, catches up.
//
// `people.global_person_id` is an opaque identity id. A member can read it, but it is useless to show and
// correlates a person across organisations, so the UI only ever learns a BOOLEAN from `isPersonLinked`
// and nothing in this file logs or returns the value.
import { getSupabase } from './supabaseClient.js';

// True when the call was sent without an error, false for ANY failure (a refusal, a missing function, a
// dropped connection, a thrown error). Never throws. The boolean only says the request went through; it
// is not a promise a link exists, which `isPersonLinked` on a fresh read answers.
export async function linkPersonIdentity(orgId, personId, client = getSupabase()) {
  if (!orgId || !personId) return false;
  try {
    const { error } = await client.rpc('link_person_identity', {
      p_org_id: orgId,
      p_person_id: personId,
    });
    return !error;
  } catch {
    return false;
  }
}

// Fire-and-forget: asks for a link only when this device is online, never awaited by the caller, and
// swallows everything. Returns nothing on purpose, so no flow can come to depend on the outcome.
export function requestPersonLink(orgId, personId, client) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  void linkPersonIdentity(orgId, personId, client).catch(() => {});
}

// Whether a people row is linked to a Seduh ID, as a boolean. The id itself never leaves this function.
export function isPersonLinked(person) {
  return Boolean(person && person.global_person_id);
}

export const PEOPLE_LIST_LIMIT = 1000;

// The words shown wherever a person is linked. Plain, and claims nothing beyond the fact.
export const LINKED_LABEL = 'Linked to a Seduh ID';

// The organisation's people for a list screen, as { id, displayName, cafe, linked }. The identity id is
// reduced to the boolean here, so it never reaches a screen. Capped at one page of rows; `truncated`
// tells the screen to say so rather than imply the list is complete.
export async function listOrgPeople(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('people')
    .select('id, display_name, cafe, global_person_id')
    .eq('org_id', orgId)
    .order('display_name', { ascending: true })
    .limit(PEOPLE_LIST_LIMIT + 1);
  if (error) throw error;
  const all = data ?? [];
  const rows = all.slice(0, PEOPLE_LIST_LIMIT);
  return {
    truncated: all.length > PEOPLE_LIST_LIMIT,
    people: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      cafe: row.cafe ?? null,
      linked: isPersonLinked(row),
    })),
  };
}
