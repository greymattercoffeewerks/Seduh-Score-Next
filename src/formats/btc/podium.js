// BTC podium (Champion / 1st runner-up / 3rd place). Legacy specified this and never built
// it (BTC Next Migration plan, §2 and §4), so there is nothing to port: the rule is
// Champion = Final winner, Runner-up = Final loser, 3rd = third-place match winner.
//
// Read-only and derived — nothing here is stored. A place is only ever a function of the
// final and third-place matches' CONFIRMED, bonus-inclusive totals (read from the same
// btc_match_scores view confirm_btc_match advances brackets from) and, when those totals are
// level, the winner the organiser recorded (tiebreak.js). So the podium and the bracket can
// never disagree about who won. Pure `derivePodium` is the part a live surface (T-BTC.3)
// reuses unedited; bracket.js's fetchBracketScores is the one query it needs.

import { recordedWinnerId } from './tiebreak.js';

const PODIUM_PLACES = [
  { key: 'champion', label: 'Champion' },
  { key: 'runnerUp', label: '1st runner-up' },
  { key: 'third', label: '3rd place' },
];

// 'pending' — the match has no confirmed result yet (not created, or not scored). An
//             unconfirmed match's view row reads 0-0, which would look like a tie, so the
//             status gate is what keeps "not played" from being shown as "tied".
// 'tied'    — confirmed and level, with no winner recorded: no winner exists, and the podium
//             says so rather than guess (same never-default-a-tie rule as confirm_btc_match).
// 'decided' — confirmed with a winner: by the totals, or (viaTiebreak) by the organiser's
//             recorded decision on a level match.
function outcomeOf(entry, scoresByMatchId) {
  const matchId = entry?.slot?.match_id;
  if (!matchId) return { state: 'pending' };
  const score = scoresByMatchId.get(matchId);
  if (!score || score.status !== 'confirmed') return { state: 'pending' };
  // PostgREST returns bigint sums as numbers today; coerce so a string response could
  // never compare lexicographically.
  const team1Total = Number(score.team1_total);
  const team2Total = Number(score.team2_total);
  if (team1Total === team2Total) {
    // The one shared rule (tiebreak.js): a recorded winner counts only on a confirmed, level
    // match and only if it is one of the two teams — so the podium and the slot card agree.
    const decidedBy = recordedWinnerId(entry.match, score);
    if (decidedBy) {
      return {
        state: 'decided',
        viaTiebreak: true,
        winnerId: decidedBy,
        loserId: decidedBy === score.team1_id ? score.team2_id : score.team1_id,
      };
    }
    return { state: 'tied' };
  }
  const team1Won = team1Total > team2Total;
  return {
    state: 'decided',
    viaTiebreak: false,
    winnerId: team1Won ? score.team1_id : score.team2_id,
    loserId: team1Won ? score.team2_id : score.team1_id,
  };
}

// entries: fetchBracket's [{slot, match}]; scores: btc_match_scores rows; teams: btc_teams
// rows (for names). Returns { places, complete }, one place per entry of PODIUM_PLACES that
// exists in this bracket — a bracket with no third_place slot (legacy's "final only" shape)
// simply has two places. Each place is { key, label, state } plus { teamId, teamName,
// viaTiebreak } when its state is 'decided' (see outcomeOf for the states). A tied final makes
// BOTH Champion and 1st runner-up 'tied'; third place is derived independently of the final.
// `complete` is true only when every place is decided. Does not mutate its inputs.
export function derivePodium({ entries, scores, teams }) {
  const scoresByMatchId = new Map(scores.map((s) => [s.match_id, s]));
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? 'Unknown team';
  const finalEntry = entries.find((e) => e.slot.round === 'final');
  const thirdEntry = entries.find((e) => e.slot.round === 'third_place');
  if (!finalEntry) return { places: [], complete: false };

  const finalOutcome = outcomeOf(finalEntry, scoresByMatchId);
  const thirdOutcome = thirdEntry ? outcomeOf(thirdEntry, scoresByMatchId) : null;

  const fromOutcome = (outcome, teamIdKey) =>
    outcome.state === 'decided'
      ? {
          state: 'decided',
          teamId: outcome[teamIdKey],
          teamName: nameOf(outcome[teamIdKey]),
          viaTiebreak: outcome.viaTiebreak,
        }
      : { state: outcome.state };

  const places = [
    { ...PODIUM_PLACES[0], ...fromOutcome(finalOutcome, 'winnerId') },
    { ...PODIUM_PLACES[1], ...fromOutcome(finalOutcome, 'loserId') },
  ];
  if (thirdOutcome) places.push({ ...PODIUM_PLACES[2], ...fromOutcome(thirdOutcome, 'winnerId') });

  return { places, complete: places.every((p) => p.state === 'decided') };
}
