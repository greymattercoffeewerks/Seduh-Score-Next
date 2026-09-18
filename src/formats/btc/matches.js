// Preliminary match creation for a BTC event (Phase T-BTC.2). Match rows and
// their exactly-3-judges assignment are created atomically via the
// create_btc_match RPC (supabase/migrations/20260918100000_btc_create_match_rpc.sql)
// rather than as two sequential client writes — see that migration's own
// comment for why match creation, despite being a "setup-time" write like
// cup-taster/setup.js's createStage, still needed an RPC: the exactly-3-
// judges invariant spans two tables and this project's own "unreliable
// venue wifi" design target makes a half-created match (a real match row
// with 0-2 judges attached) a genuine risk, not a hypothetical one.
import { getSupabase } from '../../core/supabaseClient.js';

// Pure. Mirrors the RPC's own validation exactly (team1 !== team2, exactly
// 3 distinct judges) so a screen can reject an invalid draft locally before
// spending a round trip on it — the RPC is still the actual enforcement
// (never trust client-side validation alone), this is only ever a faster
// "no" for the common mistakes.
export function validateMatchDraft({ team1Id, team2Id, judgeIds }) {
  if (!team1Id || !team2Id) return 'Both teams are required.';
  if (team1Id === team2Id) return 'A team cannot play itself.';
  const ids = judgeIds ?? [];
  if (ids.length !== 3 || new Set(ids).size !== 3) {
    return 'Exactly 3 distinct judges must be selected.';
  }
  return null;
}

export async function createMatch(
  eventId,
  { round, team1Id, team2Id, judgeIds },
  client = getSupabase(),
) {
  const { data, error } = await client.rpc('create_btc_match', {
    p_event_id: eventId,
    p_round: round,
    p_team1_id: team1Id,
    p_team2_id: team2Id,
    p_judge_ids: judgeIds,
  });
  if (error) throw error;
  return data;
}

// One row per match, judgeIds attached client-side — mirrors
// heats.js's listHeatsForStage's own {heat, entries} composition rather
// than a PostgREST embedded-resource select (no other module in this
// codebase relies on that feature; kept consistent with the established
// plain-query-then-compose style).
export async function listMatches(eventId, round, client = getSupabase()) {
  const { data: matches, error } = await client
    .from('btc_matches')
    .select('*')
    .eq('event_id', eventId)
    .eq('round', round)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const withJudges = [];
  for (const match of matches) {
    const judgeIds = await listJudgeIdsForMatch(match.id, client);
    withJudges.push({ match, judgeIds });
  }
  return withJudges;
}

export async function listJudgeIdsForMatch(matchId, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_match_judges')
    .select('judge_id')
    .eq('match_id', matchId);
  if (error) throw error;
  return data.map((row) => row.judge_id);
}

// createMatch has no idempotency key (see the RPC's own comment for why —
// two legitimate matches between the same two teams in a round isn't
// forbidden, so there's no natural key to dedupe a retry against). This is
// the organiser's recovery path when a dropped response leads to a real
// duplicate: btc_match_judges/btc_cup_votes/btc_match_bonuses all cascade
// on match_id, so removing a match cleans up everything scored against it
// too — deliberately unguarded by any "has scores" check, unlike
// core/registry.js's setEntryWithdrawn (a flag, never a delete, because
// event_entries is real event data with results keyed off it). A BTC match
// created moments ago with zero or duplicate scoring isn't the same
// question as retiring a cupper mid-competition; if that distinction ever
// matters here too (e.g. once scoring exists and a scored match needs
// protecting from accidental deletion), it's a follow-up, not assumed now.
export async function removeMatch(matchId, client = getSupabase()) {
  const { error } = await client.from('btc_matches').delete().eq('id', matchId);
  if (error) throw error;
}
