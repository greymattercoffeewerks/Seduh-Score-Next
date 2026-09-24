// The organiser-only exact record of one event (T-TRUST.2b), via get_dispute_pack()
// (supabase/migrations/20260925100000_get_dispute_pack.sql). Format-agnostic: the function reads
// both Cup Taster's and BTC's tables in one consistent snapshot, so any format's report screen
// calls this same wrapper — nothing here knows a stage, a heat or a match.
//
// The pack holds every recorded score, the competitors' names, and the full change log with old
// and new values. It is what the organiser hands over when a result is disputed; the public page
// deliberately never shows any of it. Only an org member can obtain it (the function refuses
// everyone else with one unified "not found"), so a failure here is shown to the organiser as an
// ordinary error, never as a hint about whether an event exists.
import { getSupabase } from './supabaseClient.js';

export async function getDisputePack(orgId, eventId, client = getSupabase()) {
  const { data, error } = await client.rpc('get_dispute_pack', {
    p_org_id: orgId,
    p_event_id: eventId,
  });
  if (error) throw error;
  // The function raises rather than returning null, so an empty answer is not a valid pack: never
  // hand the organiser a blank file that looks like a real (empty) record.
  if (!data) throw new Error('get_dispute_pack returned no data');
  return data;
}
