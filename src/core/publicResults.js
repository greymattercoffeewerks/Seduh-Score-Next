// Public results archive — read/write wrappers around `public_results`
// (supabase/migrations/20260917130000_public_results.sql). Format-agnostic:
// any future format's organiser screen publishes the same way, and the
// public archive page reads every format's rows through the same anon-safe
// select — `payload` is opaque here, each format's own shape is that
// format's own contract (src/formats/cup-taster/resultsPublishing.js has Cup
// Taster's). Lives in core/, not a format directory, mirroring
// core/publish.js's own placement reasoning for findActiveLiveEventId.
import { getSupabase } from './supabaseClient.js';

// Anon-safe, newest-first — the public archive page's own read
// (src/marketing/resultsScreen.js).
export async function listPublishedResults(client = getSupabase()) {
  const { data, error } = await client
    .from('public_results')
    .select('event_id, payload, published_at')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Org-scoped: does THIS event already have a published row? Used by the
// organiser's own "Public results" card (reportScreen.js) to render its
// current state without going through the anon-only read path.
// `.maybeSingle()` — most events are never published; that's the normal
// case, not an error.
export async function findPublishedResultForEvent(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('public_results')
    .select('event_id, payload, published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Thin RPC wrappers, same shape as core/events.js's deleteTestEvent — the
// actual org check and is_test guard live server-side (see the migration's
// own module comment for the full reasoning).
export async function publishEventResults(orgId, eventId, payload, client = getSupabase()) {
  const { error } = await client.rpc('publish_event_results', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_payload: payload,
  });
  if (error) throw error;
}

export async function unpublishEventResults(orgId, eventId, client = getSupabase()) {
  const { error } = await client.rpc('unpublish_event_results', {
    p_org_id: orgId,
    p_event_id: eventId,
  });
  if (error) throw error;
}

// Public, shape-only scoring record for a PUBLISHED event (T-TRUST.2a): what changed after
// results were confirmed, computed server-side from the append-only score log at read time
// (supabase/migrations/20260924110000_get_scoring_record.sql). Returns null for an
// unpublished or unknown event. Anon-safe. Contains no raw scores; `reason` strings are
// organiser-typed free text — callers must render them as text, never as markup.
export async function getScoringRecord(eventId, client = getSupabase()) {
  const { data, error } = await client.rpc('get_scoring_record', { p_event_id: eventId });
  if (error) throw error;
  return data ?? null;
}
