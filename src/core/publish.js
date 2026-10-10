import { getSupabase } from './supabaseClient.js';

// `live_sessions` permits at most one active row per org, so looking up its
// event is format-agnostic. Moved here from Cup Taster's dashboard in 2026-09-05
// so every format can reuse the query without coupling to another format.
export async function findActiveLiveEventId(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('live_sessions')
    .select('event_id')
    .eq('org_id', orgId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data?.event_id ?? null;
}
