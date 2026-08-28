// Event creation (handoff §5.1). Generic across formats by construction — the
// `events` table is shared core, discriminated only by its own `format`
// column (cup_taster | guess_the_bean today), so this module takes `format`
// as plain input rather than assuming one. A future format calls this
// unedited, same as Cup Taster does.
import { getSupabase } from './supabaseClient.js';

export async function createEvent(orgId, event, client = getSupabase()) {
  const { data, error } = await client
    .from('events')
    .insert({
      org_id: orgId,
      format: event.format,
      name: event.name,
      event_date: event.eventDate ?? null,
      venue: event.venue ?? null,
      is_test: event.isTest ?? false,
      config: event.config ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function findEvent(eventId, client = getSupabase()) {
  const { data, error } = await client.from('events').select('*').eq('id', eventId).single();
  if (error) throw error;
  return data;
}

// Distinguishes "this org has no event scheduled" from "this org has an
// event but nothing's been published yet" (viewer-shell.js's own two
// separately-named holding states, handoff §8.4). Deliberately existence-
// only — `events.status` (draft/running/concluded) exists in the schema but
// nothing anywhere writes it yet, so it isn't a reliable "started" signal;
// any event row at all is treated as "there's an event for tonight," full
// stop. `.maybeSingle()`, not `.single()` like findEvent above — zero
// events for an org is a normal, expected outcome here, not an error.
export async function findLatestEventForOrg(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
