// Judge pool for a BTC event (Phase T-BTC.2). Same idempotent
// create-with-race-recovery shape as teams.js — see its own comment.
import { getSupabase } from '../../core/supabaseClient.js';
import { UNIQUE_VIOLATION } from '../../core/errors.js';

export async function listJudges(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_judges')
    .select('*')
    .eq('event_id', eventId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function findJudgeByName(eventId, name, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_judges')
    .select('*')
    .eq('event_id', eventId)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// `countryCode` is an ISO alpha-2 code or null; only a value that is set is sent. A judge adopted after a lost
// race is returned as it is: its country is not overwritten.
export async function createJudge(
  eventId,
  name,
  { countryCode = null } = {},
  client = getSupabase(),
) {
  const row = { event_id: eventId, name };
  if (countryCode != null) row.country_code = countryCode;
  const { data, error } = await client.from('btc_judges').insert(row).select().single();
  if (!error) return data;

  if (error.code === UNIQUE_VIOLATION) {
    const existing = await findJudgeByName(eventId, name, client);
    if (existing) return existing;
  }
  throw error;
}

// btc_match_judges.judge_id is ON DELETE RESTRICT — a judge already
// assigned to a match can't be removed here; same enforcement shape as
// teams.js's removeTeam.
export async function removeJudge(judgeId, client = getSupabase()) {
  const { error } = await client.from('btc_judges').delete().eq('id', judgeId);
  if (error) throw error;
}

// Updates only the keys passed (an absent key is left alone; null clears the country).
export async function updateJudge(judgeId, { countryCode } = {}, client = getSupabase()) {
  const patch = {};
  if (countryCode !== undefined) patch.country_code = countryCode;
  if (Object.keys(patch).length === 0) throw new Error('updateJudge needs a field to change');
  const { data, error } = await client
    .from('btc_judges')
    .update(patch)
    .eq('id', judgeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
