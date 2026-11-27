// Throwdown's vote arithmetic. A vote is one row (one judge's tap for one slot, no judge identity); totals, the
// leader and "is it level?" are ALWAYS derived here from those rows and never stored. The database holds the same
// rule (td_match_results, td_confirm_match); the two are checked against the same cases (votes.test.js and pgTAP
// 072) so a screen can never enable Confirm for a result the database would refuse.

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

// The brewers sharing the top count (the ones the tie-break vote may go to). Empty before the first vote.
export function tiedSlotIds(tallies) {
  const top = tallies.reduce((max, t) => Math.max(max, t.votes), 0);
  return top === 0 ? [] : tallies.filter((t) => t.votes === top).map((t) => t.slotId);
}

export function canConfirm(tallies) {
  return tallies.length >= 2 && leadOf(tallies).leaderSlotId !== null;
}

// Whether a match can take another tap. One tap is one judge's vote, so a match takes taps while fewer than `judgeCount`
// are in, plus exactly ONE tie-break vote when every judge has voted and the votes are level (an even panel). The
// database holds the same rule (td_cast_vote, hint td_votes_full); votes.test.js and pgTAP 072 check the same cases.
//   open:          another tap is accepted
//   tieBreakOpen:  every judge is in and it is level, so the one tie-break vote is open
//   tieBreakUsed:  the count is the judges plus the tie-break vote (an even panel that was level, then one more)
//   over:          more taps than the rule allows (taps still waiting to sync that will be refused, or older data)
//
// A pool match (a redemption group of 3 or 4) follows the same rule, with one difference the database also holds
// (td_cast_vote, hint td_tiebreak_slot): the tie-break vote can go only to a brewer who is IN the tie, so `tiedSlotIds`
// names who. In a pair both sides are always in the tie. After the tie-break vote there is exactly one more vote than
// judges, whatever the panel size, because a pool's tie can happen with an odd panel too (1-1-1 with three judges).
export function voteState(tallies, judgeCount) {
  const lead = leadOf(tallies);
  const tieBreakOpen = lead.total === judgeCount && lead.level;
  const pool = tallies.length > 2;
  const tieBreakUsed = pool
    ? lead.total === judgeCount + 1 && !lead.level
    : judgeCount % 2 === 0 && lead.total === judgeCount + 1 && lead.top === judgeCount / 2 + 1;
  return {
    total: lead.total,
    open: lead.total < judgeCount || tieBreakOpen,
    tieBreakOpen,
    tieBreakUsed,
    over: lead.total > judgeCount && !tieBreakUsed,
  };
}
