// Fixed-field advancement with border-tie detection (handoff §7.2, §14 T2.3).
// v4.x advanced everyone tied at the cutoff (a cutoff of 8 could send 10
// through); this fixes the field size instead:
//   - a tie wholly above the cutoff needs nothing — both advance regardless.
//   - a tie straddling the cutoff triggers a tiebreak among only the tied group.
//
// Takes ranked entries (the { item, position } shape core/ranking produces) and
// a cutoff count. Walks position groups in rank order, accumulating members
// into `advancing` until a group's cumulative size would exceed `cutoff` — that
// one group (not everything above it) is the border tie, returned in full since
// none of its members can be resolved without a tiebreak.
export function computeAdvancement(rankedEntries, cutoff) {
  const groups = groupByPosition(rankedEntries);

  const advancing = [];
  let tiedAtBorder = [];
  let cumulative = 0;

  for (const group of groups) {
    if (cumulative >= cutoff) break;

    if (cumulative + group.length <= cutoff) {
      advancing.push(...group);
      cumulative += group.length;
    } else {
      tiedAtBorder = group;
      break;
    }
  }

  return {
    advancing,
    tiedAtBorder,
    tiebreakNeeded: tiedAtBorder.length > 0,
  };
}

function groupByPosition(rankedEntries) {
  const groups = [];
  let current = null;
  let currentPosition = null;

  for (const entry of rankedEntries) {
    if (entry.position !== currentPosition) {
      current = [];
      groups.push(current);
      currentPosition = entry.position;
    }
    current.push(entry);
  }

  return groups;
}
