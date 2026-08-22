// People, entries, snapshotting, dedup lookup, merge (handoff §6). `client`
// defaults to `getSupabase()` on every export — a default parameter only
// evaluates when the argument is omitted, so a test that always passes its own
// fake client never triggers real Supabase construction.
import { getSupabase } from './supabaseClient.js';

export async function findPersonByPhone(orgId, phone, client = getSupabase()) {
  const { data, error } = await client
    .from('people')
    .select('*')
    .eq('org_id', orgId)
    .eq('phone', phone)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// `ilike` is the only case-insensitive comparison PostgREST's filter API
// exposes (matching the DB's `lower(email)` unique index requires
// case-insensitivity, which plain `eq` doesn't give), but LIKE-family
// operators treat `%`/`_` as wildcards — escape them so a literal address
// containing either can't accidentally pattern-match an unrelated row.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function findPersonByEmail(orgId, email, client = getSupabase()) {
  const { data, error } = await client
    .from('people')
    .select('*')
    .eq('org_id', orgId)
    .ilike('email', escapeLikePattern(email))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createPerson(orgId, person, client = getSupabase()) {
  const { data, error } = await client
    .from('people')
    .insert({
      org_id: orgId,
      display_name: person.displayName,
      phone: person.phone,
      email: person.email ?? null,
      cafe: person.cafe ?? null,
      country: person.country ?? null,
      notes: person.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Dedup lookup: phone first (D16: the required, primary dedup key), then
// email. Both are checked before creating — the schema itself enforces
// per-org email uniqueness (people (org_id, lower(email)) where email is not
// null, handoff §5.1), so skipping the email check here would let createPerson
// attempt an insert that the database always rejects for a second person
// sharing an email under a different phone, surfacing a raw constraint
// violation instead of the existing person.
export async function registerPerson(orgId, person, client = getSupabase()) {
  const existingByPhone = await findPersonByPhone(orgId, person.phone, client);
  if (existingByPhone) return existingByPhone;

  if (person.email) {
    const existingByEmail = await findPersonByEmail(orgId, person.email, client);
    if (existingByEmail) return existingByEmail;
  }

  return createPerson(orgId, person, client);
}

// A registered entry (personId given) snapshots the person's CURRENT
// display_name/cafe at creation time — the entry never rewrites itself if the
// person's profile changes later (handoff §5.1). A walk-up entry (no personId,
// D16: phone required to register a person, so a same-day walk-up may not have
// one yet) uses the displayName/cafe passed in directly.
export async function createEntry(eventId, entry, client = getSupabase()) {
  let displayName = entry.displayName;
  let cafe = entry.cafe;

  if (entry.personId) {
    const { data: person, error } = await client
      .from('people')
      .select('display_name, cafe')
      .eq('id', entry.personId)
      .single();
    if (error) throw error;
    displayName = person.display_name;
    cafe = person.cafe;
  }

  const { data, error } = await client
    .from('event_entries')
    .insert({
      event_id: eventId,
      person_id: entry.personId ?? null,
      display_name: displayName,
      cafe: cafe ?? null,
      bib: entry.bib ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Composes registerPerson + createEntry for the common case: a cupper with a
// phone number, registered and entered into one event in a single call. A
// walk-up with no phone yet still calls createEntry directly (D16) — this
// wrapper doesn't branch for that case, since registerPerson has nothing to
// dedup against without one.
export async function registerEntry(orgId, eventId, cupper, client = getSupabase()) {
  const person = await registerPerson(orgId, cupper, client);
  return createEntry(eventId, { personId: person.id, bib: cupper.bib }, client);
}

// Atomic (merge_people RPC, migration 20260822090000) — a client-side sequence
// of separate reassign/log/delete calls risks a partial-failure class §9's
// offline model exists to avoid. Per event where the merged-away person holds
// an entry: reassigned to the kept person if there's no collision, unlinked
// (person_id null) if the kept person already has an entry there — never a
// duplicate (event_id, person_id) pair (the partial unique index, §5.1).
export async function mergePeople(orgId, keptId, mergedId, client = getSupabase()) {
  const { error } = await client.rpc('merge_people', {
    p_org_id: orgId,
    p_kept_id: keptId,
    p_merged_id: mergedId,
  });
  if (error) throw error;
}
