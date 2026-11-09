// Creating a whole preliminary round: the client side of create_btc_round
// (supabase/migrations/20261109100000_btc_round_draws.sql; spec section 4.2). The pure draw is draw.js; this file is the
// one call that writes it. No screen and no main.js wiring yet (Build B part 2 is the Draw panel).
//
// The RPC is all-or-nothing: every match with its round number and judges, and the draw record, or nothing. It is NOT
// idempotent on purpose, so a retry after a dropped response comes back `btc_round_exists`; a caller that sent the
// request itself reads that as "already created" (see `roundRefusal(...).alreadyCreated`) and reloads the round.
import { getSupabase } from '../../core/supabaseClient.js';
import { describeError } from '../../core/errors.js';

// Builds p_matches from draw.js output: `pairs` is [{ team1Id, team2Id }] and `assignments` is
// [{ matchIndex, judgeIds }] (assignJudges), or the organiser's edited equivalent. Order is the match order.
// Throws a plain Error on a mismatch, which is a programming error and not a user mistake.
export function buildRoundMatches(pairs, assignments) {
  if (!Array.isArray(pairs) || !Array.isArray(assignments) || pairs.length !== assignments.length) {
    throw new Error('buildRoundMatches: every pair needs its judges');
  }
  const byIndex = new Map(assignments.map((a) => [a.matchIndex, a.judgeIds]));
  return pairs.map((pair, index) => {
    const judgeIds = byIndex.get(index);
    if (!judgeIds) throw new Error(`buildRoundMatches: match ${index + 1} has no judges`);
    return { team1_id: pair.team1Id, team2_id: pair.team2Id, judge_ids: [...judgeIds] };
  });
}

// mode 'random' | 'by_results' record their seed; 'manual' has none (the database checks the pair too).
export async function createRound(
  { orgId, eventId, prelimRound, mode, seed = null, matches, avoidRematches = true },
  client = getSupabase(),
) {
  const { data, error } = await client.rpc('create_btc_round', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_prelim_round: prelimRound,
    p_mode: mode,
    p_seed: mode === 'manual' ? null : seed,
    p_matches: matches,
    p_avoid_rematches: avoidRematches,
  });
  if (error) throw error;
  return data ?? [];
}

// The hints the database attaches to its refusals, so this never depends on message wording. `reload` marks the
// refusals that mean the screen is showing stale state (the caller refreshes it); `alreadyCreated` is the one that a
// retry after a dropped response produces.
const REFUSALS = {
  btc_round_event_not_found: {
    message: 'That event could not be found.',
    reload: true,
  },
  btc_round_exists: {
    message: 'This round has already been drawn — the page has been refreshed with its matches.',
    reload: true,
    alreadyCreated: true,
  },
  btc_prior_round_open: {
    message: 'The earlier round has to be drawn and fully confirmed before this one.',
    reload: true,
  },
  btc_round_bracket_exists: {
    message: 'The bracket has been generated, so the preliminary rounds are closed.',
    reload: true,
  },
  btc_round_incomplete: {
    message: 'Every team must play exactly once in the round. A team is missing or appears twice.',
    reload: true,
  },
  btc_round_matches_invalid: {
    message:
      'One of the matches is not valid: check the teams, and that each match has 3 different judges of this event.',
    reload: false,
  },
  btc_round_seed_mode: {
    message: 'A random or by-results draw needs its seed; a manual draw has none.',
    reload: false,
  },
  btc_round_invalid: {
    message: 'The round number or draw mode is not valid.',
    reload: false,
  },
};

export function roundRefusal(err) {
  return REFUSALS[err?.hint] ?? null;
}

// Anything unrecognised falls through to describeError (a raw failure becomes the generic "try again").
export function describeRoundError(err) {
  return roundRefusal(err)?.message ?? describeError(err);
}
