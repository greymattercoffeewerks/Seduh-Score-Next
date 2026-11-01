// Public results archive — read/write wrappers around `public_results`
// (supabase/migrations/20260917130000_public_results.sql). Format-agnostic:
// any future format's organiser screen publishes the same way, and the
// public archive page reads every format's rows through the same anon-safe
// select — `payload` is opaque here, each format's own shape is that
// format's own contract (src/formats/cup-taster/resultsPublishing.js has Cup
// Taster's). Lives in core/, not a format directory, mirroring
// core/publish.js's own placement reasoning for findActiveLiveEventId.
import { getSupabase } from './supabaseClient.js';
import { cleanOrgName } from './orgLabel.js';

// Whose results these are. The database stamps the organiser's real name into every published payload
// (`org_name`, trigger trg_public_results_stamp_org, T-TEN.B7), replacing anything the publisher sent, so
// the archive can say who ran each event. Rows published before that was added carry no name: null, never
// a guess. The name is cleaned the way every other place that shows an organisation's name cleans it
// (core/orgLabel.js: invisible text-direction controls removed, a name of only spaces is no name). It is
// the name AS OF PUBLISHING: a renamed organisation keeps its old name on old rows until they are
// republished, which is right for a historic result. Render the result as text, never as markup.
export function publishedOrgName(payload) {
  return cleanOrgName(payload?.org_name) || null;
}

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

// Anon-safe, ONE row: the newest published event (the landing page's "latest event" card). Same select as
// the archive, limited to one row so the landing page never downloads every payload. Test events cannot
// be here (the publish trigger rejects them), so no is_test filter is needed. null when the archive is empty.
export async function findLatestPublishedResult(client = getSupabase()) {
  const { data, error } = await client
    .from('public_results')
    .select('event_id, payload, published_at')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
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

// Org-scoped: which of these events already have a published row (a podium or a named-only entry). One read for a whole
// events list (the archive panel). An event with none is absent from the answer.
export async function listPublishedResultsForEvents(eventIds, client = getSupabase()) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client
    .from('public_results')
    .select('event_id, payload, published_at')
    .in('event_id', eventIds);
  if (error) throw error;
  return data;
}

// The D-G21 tick box (public.set_archive_listing, T-ARC.3). Answers { listing, recorded, due_at? }; a refusal carries a
// stable hint (archive_listing_closed, archive_event_is_test, entitlement_required).
export async function setArchiveListing(orgId, eventId, list, client = getSupabase()) {
  const { data, error } = await client.rpc('set_archive_listing', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_list: list,
  });
  if (error) throw error;
  return data;
}

// The member-readable archive status (public.archive_event_status, T-ARC.4c): one row per requested event of the
// organisation, from the ledger the member cannot read themselves. At most ARCHIVE_STATUS_MAX ids per call. A refusal
// carries SQLSTATE 42501 (an id that is not this organisation's) or 22023 with a stable hint (archive_status_invalid,
// archive_status_too_many).
export const ARCHIVE_STATUS_MAX = 200;
export async function getArchiveEventStatus(orgId, eventIds, client = getSupabase()) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client.rpc('archive_event_status', {
    p_org_id: orgId,
    p_event_ids: eventIds,
  });
  if (error) throw error;
  return data ?? [];
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
