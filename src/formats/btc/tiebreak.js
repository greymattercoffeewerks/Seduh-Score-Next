// BTC knockout tie rule (client side of supabase/migrations/20261009110000_btc_knockout_tiebreak.sql).
//
// A knockout match that ends level on bonus-inclusive totals advances nobody. How the tie is
// broken (a sudden-death cup, a head judge's casting vote, a rematch) is decided at the venue
// under the event's own rules — the app does NOT score a tie-break; it records WHO goes through
// and WHY. The totals are never touched: a tied match stays visibly tied, and the recorded
// winner is a separate fact that only decides who advances (and who is on the podium).
import { getSupabase } from '../../core/supabaseClient.js';
import { describeError } from '../../core/errors.js';

// Mirrors btc_matches_tiebreak_shape / record_btc_tiebreak: 1–120 characters once trimmed.
export const TIEBREAK_REASON_MAX = 120;

// The one rule for "the organiser's recorded winner counts": the match and its score row are
// both confirmed, the totals are level (PostgREST returns bigint sums as numbers today;
// coerced so a string could never compare lexicographically), and the recorded team is one of
// the match's two teams. A recorded winner on a match that is NOT level is stale by
// definition (the database clears it on any decisive re-confirm) and is ignored. The
// participant check repeats what the table's CHECK already guarantees, so the card and the
// podium can never disagree even about a state the database forbids.
export function recordedWinnerId(match, score) {
  if (!match || match.status !== 'confirmed' || !score || score.status !== 'confirmed') return null;
  if (Number(score.team1_total) !== Number(score.team2_total)) return null;
  const winner = match.tiebreak_winner_team_id;
  return winner === score.team1_id || winner === score.team2_id ? winner : null;
}

// 'tied'    — confirmed, totals level, no usable winner recorded: the organiser must decide.
// 'decided' — confirmed, totals level, a winner has been recorded.
// null      — not a tie (unplayed, unconfirmed, or a decisive result).
export function tieState(match, score) {
  if (!match || match.status !== 'confirmed' || !score || score.status !== 'confirmed') return null;
  if (Number(score.team1_total) !== Number(score.team2_total)) return null;
  return recordedWinnerId(match, score) ? 'decided' : 'tied';
}

// Pure; the RPC and the table's CHECK are the real enforcement. A faster "no" for the common
// mistakes, with messages fit to show to the person at the screen. Returns null, or
// { field, message } so the screen can tie the message to the control it is about.
export function validateTiebreak({ winnerTeamId, reason, teamIds }) {
  if (!winnerTeamId || !teamIds.includes(winnerTeamId)) {
    return { field: 'winner', message: 'Choose which team goes through.' };
  }
  const trimmed = reason.trim();
  if (trimmed === '') {
    return { field: 'reason', message: 'Give a reason, so the decision can be explained later.' };
  }
  if (trimmed.length > TIEBREAK_REASON_MAX) {
    return {
      field: 'reason',
      message: `Keep the reason to ${TIEBREAK_REASON_MAX} characters or fewer.`,
    };
  }
  return null;
}

export async function recordTiebreak(orgId, matchId, winnerTeamId, reason, client = getSupabase()) {
  const { error } = await client.rpc('record_btc_tiebreak', {
    p_org_id: orgId,
    p_match_id: matchId,
    p_winner_team_id: winnerTeamId,
    p_reason: reason.trim(),
  });
  if (error) throw error;
}

// The hints the database attaches to its refusals (record_btc_tiebreak and the advancement
// helper raise them with `using hint`), so this never depends on message wording. `reload` marks
// the refusals that mean the screen is showing stale state: the caller refreshes it.
const REFUSALS = {
  bracket_advanced: {
    message:
      "That team's next-round match has already been created. Remove that match first, then change the tie-break.",
    reload: false,
  },
  tiebreak_not_tied: {
    message: 'This match is no longer tied — the page has been refreshed with its current result.',
    reload: true,
  },
  tiebreak_unconfirmed: {
    message: 'This match has not been confirmed yet — confirm its scores first.',
    reload: true,
  },
  tiebreak_match_not_found: {
    message: 'That match could not be found — the page has been refreshed.',
    reload: true,
  },
};

export function tiebreakRefusal(err) {
  return REFUSALS[err?.hint] ?? null;
}

// Anything unrecognised falls through to describeError (a raw failure becomes the generic
// "try again").
export function describeTiebreakError(err) {
  return tiebreakRefusal(err)?.message ?? describeError(err);
}
