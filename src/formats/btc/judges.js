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

export async function createJudge(eventId, name, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_judges')
    .insert({ event_id: eventId, name })
    .select()
    .single();
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
