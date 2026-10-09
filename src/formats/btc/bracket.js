// BTC bracket generation and match creation (Phase T-BTC.2, sub-step 6). This is the
// client-side wrapper around the sub-step 5 backend (generate_btc_bracket,
// create_btc_bracket_match — supabase/migrations/20260922130000.../20260922131000...).
// Advancement itself (writing a downstream slot's team1_id/team2_id once a bracket match
// is confirmed) happens entirely server-side, inside confirm_btc_match
// (20260922132000...) — there is no client-side advancement logic here to duplicate it.
//
// Neither generate_btc_bracket nor create_btc_bracket_match is outbox-routed (their own
// migrations' comments explain why: one-time setup-time writes, not live per-second
// writes, unlike confirm_btc_match). This module calls them directly via client.rpc(),
// the same shape matches.js's createMatch already uses for create_btc_match.
import { getSupabase } from '../../core/supabaseClient.js';

// Display order only — btc_bracket_slots.round has no natural sort order of its own
// (alphabetically "final" sorts before "quarterfinal", which is wrong for a bracket).
export const BRACKET_ROUND_ORDER = ['quarterfinal', 'semifinal', 'final', 'third_place'];

export const BRACKET_ROUND_LABELS = {
  quarterfinal: 'Quarterfinals',
  semifinal: 'Semifinals',
  final: 'Final',
  third_place: 'Third Place',
};

export async function generateBracket(orgId, eventId, client = getSupabase()) {
  const { error } = await client.rpc('generate_btc_bracket', {
    p_org_id: orgId,
    p_event_id: eventId,
  });
  if (error) throw error;
}

// Pure. The RPC's own exactly-3-distinct-judges check is the actual enforcement; this is
// only ever a faster "no" for the common mistake, mirroring matches.js's
// validateMatchDraft (which also validates the team fields — this form has none, since a
// bracket slot's two teams are fixed by seeding/advancement, not organiser choice).
export function validateBracketMatchJudges(judgeIds) {
  const ids = judgeIds ?? [];
  if (ids.length !== 3 || new Set(ids).size !== 3) {
    return 'Exactly 3 distinct judges must be selected.';
  }
  return null;
}

export async function createBracketMatch(orgId, slotId, judgeIds, client = getSupabase()) {
  const { data, error } = await client.rpc('create_btc_bracket_match', {
    p_org_id: orgId,
    p_slot_id: slotId,
    p_judge_ids: judgeIds,
  });
  if (error) throw error;
  return data;
}

// One row per slot, each carrying its own match's status (null if no match created yet)
// — composed client-side from two plain queries, mirroring matches.js's listMatches /
// heats.js's listHeatsForStage {heat, entries} shape rather than a PostgREST
// embedded-resource select (no other module in this codebase uses that feature).
// Sorted into bracket display order (BRACKET_ROUND_ORDER, then slot_label).
export async function fetchBracket(eventId, client = getSupabase()) {
  const { data: slots, error: slotsError } = await client
    .from('btc_bracket_slots')
    .select('*')
    .eq('event_id', eventId);
  if (slotsError) throw slotsError;
  if (slots.length === 0) return [];

  const matchIds = slots.map((s) => s.match_id).filter(Boolean);
  let matchesById = new Map();
  if (matchIds.length > 0) {
    const { data: matches, error: matchesError } = await client
      .from('btc_matches')
      .select('id, status, tiebreak_winner_team_id, tiebreak_reason')
      .in('id', matchIds);
    if (matchesError) throw matchesError;
    matchesById = new Map(matches.map((m) => [m.id, m]));
  }

  return slots
    .map((slot) => ({
      slot,
      match: slot.match_id ? (matchesById.get(slot.match_id) ?? null) : null,
    }))
    .sort((a, b) => {
      const roundDiff =
        BRACKET_ROUND_ORDER.indexOf(a.slot.round) - BRACKET_ROUND_ORDER.indexOf(b.slot.round);
      if (roundDiff !== 0) return roundDiff;
      return a.slot.slot_label.localeCompare(b.slot.slot_label);
    });
}

// Every bracket slot's match id that exists. The screen reads scores for ALL of them in one
// query: the podium needs the final's and third place's, and the tie state of every slot card
// needs its own — one read feeds both, so they can never disagree.
export function bracketMatchIds(entries) {
  return entries.map(({ slot }) => slot.match_id).filter(Boolean);
}

// Only what the podium and the tie state read — btc_match_scores is a wide view. Empty input
// skips the query: a bracket with no matches yet has nothing to read.
const SCORE_COLUMNS = 'match_id, status, team1_id, team2_id, team1_total, team2_total';

export async function fetchBracketScores(matchIds, client = getSupabase()) {
  if (matchIds.length === 0) return [];
  const { data, error } = await client
    .from('btc_match_scores')
    .select(SCORE_COLUMNS)
    .in('match_id', matchIds);
  if (error) throw error;
  return data;
}
