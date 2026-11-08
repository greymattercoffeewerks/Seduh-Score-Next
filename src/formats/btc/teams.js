// Team roster for a BTC event (Phase T-BTC.2). Idempotent create-with-race-
// recovery, same shape as core/registry.js's registerPerson / cup-taster's
// setup.js createStage — a double-tap on "Add team" or a re-submit after a
// dropped response resolves to the existing row rather than surfacing
// btc_teams' (event_id, name) unique-index violation raw.
import { getSupabase } from '../../core/supabaseClient.js';
import { UNIQUE_VIOLATION } from '../../core/errors.js';

export async function listTeams(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_teams')
    .select('*')
    .eq('event_id', eventId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function findTeamByName(eventId, name, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_teams')
    .select('*')
    .eq('event_id', eventId)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// `countryCode` is an ISO alpha-2 code or null; `represents` an optional free label (the database checks the shape:
// two capital letters; trimmed, 1 to 60 characters). Only a value that is set is sent, so a team created without
// either is exactly the row it always was.
export async function createTeam(
  eventId,
  name,
  { countryCode = null, represents = null } = {},
  client = getSupabase(),
) {
  const row = { event_id: eventId, name };
  if (countryCode != null) row.country_code = countryCode;
  if (represents != null) row.represents = represents;
  const { data, error } = await client.from('btc_teams').insert(row).select().single();
  if (!error) return data;

  // Lost a race to a concurrent insert of the same (event_id, name) between
  // our attempt and a caller's own retry — or this literally IS the retry,
  // after the first attempt's response never made it back over an
  // unreliable connection. Either way, adopt the row that's actually there
  // rather than erroring on a name the organiser can plainly see already
  // exists. The adopted row is returned as it is: its country is not overwritten.
  if (error.code === UNIQUE_VIOLATION) {
    const existing = await findTeamByName(eventId, name, client);
    if (existing) return existing;
  }
  throw error;
}

// btc_matches.team1_id/team2_id are ON DELETE RESTRICT — a team already
// entered in a match can't be removed here; the database itself is the
// enforcement, this just lets a raw Postgres error surface through
// describeError() rather than needing its own pre-check.
export async function removeTeam(teamId, client = getSupabase()) {
  const { error } = await client.from('btc_teams').delete().eq('id', teamId);
  if (error) throw error;
}

// Updates only the keys passed (an absent key is left alone; null clears). Country and represents do not affect
// scoring, and a team in a match cannot be removed, so this is the way to fix a typo after matches exist.
export async function updateTeam(teamId, { countryCode, represents } = {}, client = getSupabase()) {
  const patch = {};
  if (countryCode !== undefined) patch.country_code = countryCode;
  if (represents !== undefined) patch.represents = represents;
  if (Object.keys(patch).length === 0) throw new Error('updateTeam needs a field to change');
  const { data, error } = await client
    .from('btc_teams')
    .update(patch)
    .eq('id', teamId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
