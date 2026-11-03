// The bracket, derived. Everything here is computed from the rows the database holds (rounds, matches, slots, vote
// rows, the roster); nothing is stored and nothing is projected: a round that has not been earned does not exist, so
// this never draws one. Winners follow the database's own rule (td_match_results): a vote result goes to the slot
// with strictly the most votes, a walkover to its recorded slot, a bye to the one filled slot; an undecided match
// has no winner. Pool matches (2 to 4 slots, redemption) are the same shape here: a match is a list of slots.
import { tallyVotes } from './votes.js';

// Round names come from the structure that exists, not from a plan: one match is the Final, two are the
// Semi-finals, four the Quarter-finals; any other size is "Round n" (n = the main round's place in the event).
export function roundLabel(round, matchCount, mainIndex) {
  if (round.phase === 'third_place') return '3rd place';
  if (round.phase === 'redemption') return 'Redemption';
  if (matchCount === 1) return 'Final';
  if (matchCount === 2) return 'Semi-finals';
  if (matchCount === 4) return 'Quarter-finals';
  return `Round ${mainIndex}`;
}

function winnerSlotOf(match, tallies) {
  if (match.result_kind === 'bye') return match.slots.find((s) => s.entryId)?.id ?? null;
  if (match.result_kind === 'walkover') {
    return match.slots.find((s) => s.position === match.walkover_winner_position)?.id ?? null;
  }
  if (match.result_kind === 'votes') {
    const top = Math.max(...tallies.map((t) => t.votes));
    const leaders = tallies.filter((t) => t.votes === top);
    return leaders.length === 1 ? leaders[0].slotId : null;
  }
  return null;
}

export function deriveBracket({ rounds, matches, slots, votes, entries }) {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const slotsByMatch = new Map();
  for (const s of slots) {
    const list = slotsByMatch.get(s.match_id) ?? [];
    list.push({ id: s.id, position: s.position, entryId: s.entry_id });
    slotsByMatch.set(s.match_id, list);
  }
  const votesByMatch = new Map();
  for (const v of votes) {
    const list = votesByMatch.get(v.match_id) ?? [];
    list.push({ slotId: v.slot_id });
    votesByMatch.set(v.match_id, list);
  }

  const sortedRounds = [...rounds].sort((a, b) => a.position - b.position);
  let mainIndex = 0;
  const outRounds = sortedRounds.map((round) => {
    if (round.phase === 'main') mainIndex += 1;
    const own = matches
      .filter((m) => m.round_id === round.id)
      .sort((a, b) => a.position - b.position);
    const builtMatches = own.map((m) => {
      const matchSlots = (slotsByMatch.get(m.id) ?? []).sort((a, b) => a.position - b.position);
      const tallies = tallyVotes(matchSlots, votesByMatch.get(m.id) ?? []);
      const talliesBySlot = new Map(tallies.map((t) => [t.slotId, t.votes]));
      const decided = m.result_kind !== null && m.result_kind !== undefined;
      const winnerSlotId = decided ? winnerSlotOf({ ...m, slots: matchSlots }, tallies) : null;
      const sides = matchSlots.map((s) => {
        const entry = s.entryId ? entryById.get(s.entryId) : null;
        return {
          slotId: s.id,
          position: s.position,
          entryId: s.entryId,
          name: entry?.display_name ?? null,
          cafe: entry?.cafe ?? null,
          votes: s.entryId ? (talliesBySlot.get(s.id) ?? 0) : null,
          winner: decided ? s.id === winnerSlotId : null,
        };
      });
      return {
        id: m.id,
        roundId: round.id,
        position: m.position,
        resultKind: m.result_kind ?? null,
        decided,
        confirmedAt: m.confirmed_at ?? null,
        isBye: m.result_kind === 'bye',
        winnerSlotId,
        sides,
        // both competitors present and nothing decided: it can be voted on now
        playable: !decided && sides.filter((s) => s.entryId).length >= 2,
      };
    });
    return {
      id: round.id,
      position: round.position,
      kind: round.kind,
      phase: round.phase,
      label: roundLabel(round, builtMatches.length, mainIndex),
      matches: builtMatches,
    };
  });

  const nameOfWinner = (match) => match?.sides.find((s) => s.winner)?.name ?? null;
  const nameOfLoser = (match) =>
    match?.decided ? (match.sides.find((s) => s.entryId && !s.winner)?.name ?? null) : null;
  const mainRounds = outRounds.filter((r) => r.phase === 'main');
  const lastMain = mainRounds[mainRounds.length - 1];
  const finalMatch = lastMain && lastMain.matches.length === 1 ? lastMain.matches[0] : null;
  const thirdMatch = outRounds.find((r) => r.phase === 'third_place')?.matches[0] ?? null;
  const champion = finalMatch?.decided ? nameOfWinner(finalMatch) : null;

  return {
    rounds: outRounds,
    started: outRounds.length > 0,
    champion,
    runnerUp: champion ? nameOfLoser(finalMatch) : null,
    thirdPlace: thirdMatch?.decided ? nameOfWinner(thirdMatch) : null,
    complete: Boolean(champion) && (!thirdMatch || thirdMatch.decided),
    playableMatches: outRounds.flatMap((r) => r.matches.filter((m) => m.playable)),
  };
}
