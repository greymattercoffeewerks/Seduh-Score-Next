// Throwdown's vote arithmetic. A vote is one row (one judge's tap for one slot, no judge identity); totals, the
// leader and "is it level?" are ALWAYS derived here from those rows and never stored. The database holds the same
// rule (td_match_results, td_confirm_match); the two are checked against the same cases (votes.test.js and pgTAP
// 071) so a screen can never enable Confirm for a result the database would refuse.

// Votes per slot, in slot order. `slots` are the match's slot rows ({ id, position, entryId }); `votes` any list of
// vote rows ({ slotId }) (rows for other matches are simply not counted). A slot with no competitor takes no votes.
export function tallyVotes(slots, votes) {
  const counts = new Map();
  for (const vote of votes) counts.set(vote.slotId, (counts.get(vote.slotId) ?? 0) + 1);
  return [...slots]
    .filter((slot) => slot.entryId)
    .sort((a, b) => a.position - b.position)
    .map((slot) => ({ slotId: slot.id, position: slot.position, votes: counts.get(slot.id) ?? 0 }));
}

// Who is ahead. `leaderSlotId` is the slot with STRICTLY the most votes, or null when two or more share the top (or
// nobody has voted): the confirm control is disabled while this is null, so a level result can never be committed.
export function leadOf(tallies) {
  const total = tallies.reduce((sum, t) => sum + t.votes, 0);
  const top = tallies.reduce((max, t) => Math.max(max, t.votes), 0);
  const leaders = tallies.filter((t) => t.votes === top);
  const decisive = total > 0 && leaders.length === 1;
  return {
    total,
    top,
    level: !decisive,
    leaderSlotId: decisive ? leaders[0].slotId : null,
  };
}

export function canConfirm(tallies) {
  return tallies.length >= 2 && leadOf(tallies).leaderSlotId !== null;
}
