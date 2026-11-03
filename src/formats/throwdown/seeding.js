// Throwdown's draw: who meets whom in Round 1 (spec section 6). Pure. The database applies the same reading when it
// starts the event (td_start_event), checked against the same cases (seeding.test.js and pgTAP 071), so what the
// organiser previews is what is committed.
//
// A pair is [first, second], each an entry id or null. Round 1 is a list of pairs.
import { seededShuffle } from '../../core/seededShuffle.js';

// Random draw: shuffle by the recorded seed, then take consecutive pairs. An odd count leaves the last competitor
// alone in a pair (a bye).
export function randomPairs(entryIds, seed) {
  const order = seededShuffle(entryIds, seed);
  const pairs = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1] ?? null]);
  return pairs;
}

// Manual draw, read exactly as the database reads it: a pair with one name is a bye, an opponent-only slot moves to
// the first position, a fully empty pair is dropped.
export function normalisePairs(pairs) {
  const out = [];
  for (const [a, b] of pairs) {
    const first = a ?? b ?? null;
    if (first === null) continue;
    out.push([first, a === null ? null : (b ?? null)]);
  }
  return out;
}

// Why a draw cannot start, as stable codes (the same words the database's hints use). `activeEntryIds` is every
// competitor not withdrawn. Empty list = it can start.
export function drawProblems({ mode, pairs, activeEntryIds }) {
  const problems = [];
  const placed = pairs.flat().filter(Boolean);
  if (new Set(placed).size !== placed.length) problems.push('td_draw_duplicate');
  const active = new Set(activeEntryIds);
  if (placed.some((id) => !active.has(id))) problems.push('td_draw_entry');
  const real = normalisePairs(pairs).filter(([, b]) => b !== null);
  if (real.length === 0) problems.push('td_draw_empty');
  if (mode === 'random' && activeEntryIds.some((id) => !placed.includes(id))) {
    problems.push('td_draw_incomplete');
  }
  return problems;
}

// What the draw will make: the Round 1 matches, with byes marked. For the preview before Start.
export function previewRoundOne(pairs) {
  return normalisePairs(pairs).map(([a, b], i) => ({ position: i + 1, a, b, bye: b === null }));
}

// A manual board: `slotCount` slots (the organiser's number, independent of the competitor count) as pairs of nulls.
export function emptyBoard(slotCount) {
  const pairCount = Math.ceil(Math.max(2, slotCount) / 2);
  return Array.from({ length: pairCount }, () => [null, null]);
}

// Puts a competitor in a slot, taking them out of any other slot first (a competitor fills at most one).
export function assignSlot(pairs, pairIndex, side, entryId) {
  const next = pairs.map((pair) => pair.map((id) => (entryId && id === entryId ? null : id)));
  next[pairIndex][side] = entryId ?? null;
  return next;
}
