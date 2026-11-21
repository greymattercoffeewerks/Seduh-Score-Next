// "What is new since the last snapshot?" for a venue display's moments (core/momentPlayer.js). A display is sent
// snapshots, never events, so a fresh result is an entry the previous snapshot did not have. Pure and
// format-agnostic: the caller says where the list is, what makes an entry the same entry, and how to order them.
//
//   detectNewResults(previous, next, { listOf, keyOf, orderBy })
//     listOf(snapshot) -> the array of results in a snapshot (missing is fine)
//     keyOf(result)    -> a string that is the same for the same result across snapshots (include what makes a
//                         re-recorded result news, e.g. its confirmed-at time, when it should be announced again)
//     orderBy(result)  -> a number or string to sort by, oldest first (ties broken by key, so the order is stable)
//
// Returns the results in `next` that `previous` did not have, oldest first. With no previous snapshot it returns
// nothing: a display just opened (or reloaded mid-event) has no earlier snapshot, so nothing is known to have
// happened. Does not mutate either snapshot.
export function detectNewResults(previous, next, { listOf, keyOf, orderBy }) {
  if (!previous || !next) return [];
  const seen = new Set((listOf(previous) ?? []).map(keyOf));
  const fresh = (listOf(next) ?? []).filter((result) => !seen.has(keyOf(result)));
  const sortKey = (result) => {
    const value = orderBy(result);
    return typeof value === 'string' ? Date.parse(value) || value : value;
  };
  return fresh
    .map((result) => ({ result, order: sortKey(result), key: keyOf(result) }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.key < b.key ? -1 : 1))
    .map((entry) => entry.result);
}
