// Standings ranking (handoff §6, §14 T2.2). Competition ranking: ties share a
// position, and the next distinct row's position is its 1-based index in sort
// order — which automatically skips by the size of any tie ahead of it, whether
// or not that tie starts at position 1.

// Combines comparators in priority order — the first non-zero result wins. Lets
// a caller build e.g. "most correct, then fastest time" (handoff §7.3) from two
// single-key comparators instead of writing one bespoke compound function.
export function chainComparators(...comparators) {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

// Numbers items that are ALREADY in the order to show (a caller whose order comes from elsewhere, e.g. a database
// seed order): equal neighbours share a position and the next distinct one is its 1-based index. No sort, so the order
// given is the order kept. `isSame(a, b)` says whether two adjacent items share a position.
export function positionsInOrder(items, isSame) {
  const result = [];
  let position = 1;
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && !isSame(items[i], items[i - 1])) position = i + 1;
    result.push({ item: items[i], position });
  }
  return result;
}

// Returns a new array of { item, position }, sorted by compareFn. Does not
// mutate `items`.
export function rank(items, compareFn) {
  const sorted = [...items].sort(compareFn);
  return positionsInOrder(sorted, (a, b) => compareFn(a, b) === 0);
}
