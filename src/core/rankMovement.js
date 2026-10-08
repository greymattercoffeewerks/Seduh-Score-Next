// How a ranked list moved between two snapshots of it (a venue display is sent snapshots, never events, so
// "who moved" is a comparison of the list before with the list after). Format-agnostic: it knows keys and
// positions, not what a row is, so any format's projector can use it unedited.
//
// A position is a competition rank (1 is best; ties share one). Rows are matched by `keyOf(row)`. A row is
// only "ranked" if `isRanked(row)` says it has earned a place: in a standings list that includes entrants who
// have not competed yet, those sit tied at the bottom, and "moved down 4 places" would be a lie about them.
//
// Returns a Map from key to { from, to, places, change } for every row ranked in `next`:
//   change 'entered'  not ranked in `previous` (from is null, places 0)
//   change 'up' / 'down' / 'same'   by how `to` compares with `from`; `places` is how many positions
// Returns null when two RANKED rows in either list share a key: they cannot be told apart, and a movement
// attributed to the wrong one is worse than none. (Rows that are not ranked are never looked up, so two
// entrants of one name who have not competed yet do not stop the others being compared.)
export function rankMovement(previous, next, { keyOf, positionOf, isRanked = () => true }) {
  const earlier = new Map();
  for (const row of previous ?? []) {
    if (!isRanked(row)) continue;
    const key = keyOf(row);
    if (earlier.has(key)) return null;
    earlier.set(key, positionOf(row));
  }
  const movement = new Map();
  for (const row of next ?? []) {
    if (!isRanked(row)) continue;
    const key = keyOf(row);
    if (movement.has(key)) return null;
    const to = positionOf(row);
    const from = earlier.has(key) ? earlier.get(key) : null;
    const change = from === null ? 'entered' : to < from ? 'up' : to > from ? 'down' : 'same';
    movement.set(key, { from, to, places: from === null ? 0 : Math.abs(from - to), change });
  }
  return movement;
}

// The positions that more than one row holds (the tied places), as a Set: a display writes "tied" or "joint"
// against those rows, in words, so a shared place is never only a colour or a repeated number.
export function sharedPositions(rows, positionOf) {
  const seen = new Set();
  const shared = new Set();
  for (const row of rows) {
    const position = positionOf(row);
    if (seen.has(position)) shared.add(position);
    seen.add(position);
  }
  return shared;
}
