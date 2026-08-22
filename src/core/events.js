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
