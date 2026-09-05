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
  // Explicit columns, never '*' — this is called from two PUBLIC,
  // unauthenticated surfaces (viewer-shell.js, splashScreen.js), and `anon`
  // only has a COLUMN-level grant on this exact list (migration
  // 20260831100000) precisely because `select('*')` from a column-scoped
  // role always fails, by Postgres design, regardless of RLS. `created_at`
  // is included even though no caller reads it — ORDER BY requires SELECT
  // on the column being sorted by, not just the columns returned.
  const { data, error } = await client
    .from('events')
    .select('id, org_id, name, event_date, is_test, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Every event for an org, newest first — the list core/eventsScreen.js
// needs (2026-08-29 app-wiring pass); findLatestEventForOrg above only ever
// returns one row, by design, for a different caller's different need
// (viewer-shell.js's own holding-state check).
export async function listEventsForOrg(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Thin RPC wrapper (user-requested "Delete event" feature, 2026-09-05) —
// the actual is_test-only safety guard, org check, and cascading delete all
// live server-side (supabase/migrations/20260905130000_delete_test_event_rpc.sql's
// own module comment has the full reasoning for why this is an RPC and not a
// plain client-side `.delete()`: `events_write`'s RLS policy alone would
// otherwise let an org member delete a REAL event with the same one call as
// a test one, with no undo). Not routed through the outbox — a low-
// frequency, organiser-only setup-time action, same reasoning setup.js's own
// module comment already gives for stage/set creation, not a live-heat-
// time-pressure write.
export async function deleteTestEvent(orgId, eventId, client = getSupabase()) {
  const { error } = await client.rpc('delete_test_event', {
    p_org_id: orgId,
    p_event_id: eventId,
  });
  if (error) throw error;
}
