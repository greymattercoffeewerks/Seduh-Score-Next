// The rows of a "rank impact" moment: how the top of a ranked list moved between two snapshots of it.
// Extracted from Cup Taster's projector moments when BTC became the second format to need it (the project's
// second-use rule). Format-agnostic: it knows rows, keys and positions, not what is ranked; the format supplies
// the headline (what the movement means in its own words) and draws the rows with core/rankMovementRows.js.
//
// A row is only ranked if `isRanked(row)` says it has earned a place (an entrant who has not competed sits tied
// at the bottom and never "moves down"). The rows shown are those ranked at `topPlace` or better, ties
// included, capped at `maxRows`; `more` says how many were left out, so a trimmed list never reads as a
// complete one; `moved` says whether any shown row changed place (a result that left the top of the table as it
// was has nothing to announce). Returns null when the two lists cannot be compared safely (two ranked rows with
// one key: core/rankMovement.js), so a movement is never pinned on the wrong entrant.
import { rankMovement, sharedPositions } from './rankMovement.js';

export function rankImpactRows(
  previous,
  next,
  { keyOf, positionOf, labelOf, isRanked = () => true, topPlace = 5, maxRows = 8 },
) {
  const movement = rankMovement(previous, next, { keyOf, positionOf, isRanked });
  if (!movement) return null;
  const ranked = (next ?? []).filter(isRanked);
  const shared = sharedPositions(ranked, positionOf);
  const top = ranked.filter((row) => positionOf(row) <= topPlace);
  const rows = top.slice(0, maxRows).map((row) => ({
    position: positionOf(row),
    label: labelOf(row),
    tied: shared.has(positionOf(row)),
    ...movement.get(keyOf(row)),
  }));
  return {
    rows,
    more: top.length - rows.length,
    moved: rows.some((row) => row.change !== 'same'),
  };
}

// Who leads, and whether that is news: the ranked rows at place 1 now against before. null when nobody ranked
// leads. `unchanged` is true when the same entrants led before (a lead that did not move is not a headline);
// a sole leader is { kind: 'sole', label }, several are { kind: 'shared', labels, count, namedTogether } where
// `namedTogether` says two names are short enough to string into one line (`maxNamesChars`, both together).
// The format supplies the words ("takes the lead", "share the lead").
export function leadMovement(
  previous,
  next,
  { keyOf, positionOf, labelOf, isRanked = () => true, maxNamesChars = 40 },
) {
  const leadersOf = (list) => (list ?? []).filter((row) => isRanked(row) && positionOf(row) === 1);
  const now = leadersOf(next);
  if (now.length === 0) return null;
  const before = leadersOf(previous);
  const unchanged =
    before.length === now.length && now.every((row) => before.some((b) => keyOf(b) === keyOf(row)));
  if (now.length === 1) return { kind: 'sole', label: labelOf(now[0]), unchanged };
  const labels = now.map(labelOf);
  return {
    kind: 'shared',
    labels,
    count: now.length,
    unchanged,
    namedTogether: now.length === 2 && labels.join('').length <= maxNamesChars,
  };
}

// The row that moved most in one direction, from rankImpactRows' rows: the biggest climb first (then the higher
// place, then the name, so the answer never depends on input order), or for `entered` the highest place. null
// when no row changed that way.
export function topMover(rows, change) {
  const candidates = rows.filter((row) => row.change === change);
  candidates.sort(
    (a, b) =>
      (change === 'up' ? b.places - a.places : 0) ||
      a.position - b.position ||
      (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
  return candidates[0] ?? null;
}
