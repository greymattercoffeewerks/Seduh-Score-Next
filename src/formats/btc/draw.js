// The BTC preliminary draw (Build B, part 1; docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md section 4.1).
// Pure: ids in, pairs and judge assignments out. No database, no DOM, no clock, no Math.random. The only randomness is
// the recorded SEED, run through core/seededShuffle.js, so "why did the draw produce this?" always has an answer:
// the same seed and the same teams give the same pairs.
//
// Four functions, each returning what it decided plus `warnings`:
//   drawRound1          random pairs (the seed shuffles, consecutive teams meet).
//   drawRound2Random    a seeded shuffle, then repair so nobody meets an earlier opponent again (when that is possible).
//   drawRound2ByResults strongest against weakest by points (equal points ordered by the seeded shuffle), same repair.
//   assignJudges        three distinct judges per match, loads within one of each other, nobody judging a team from
//                       their own country where that can be avoided.
//
// An odd number of teams is REFUSED (open question O1 is KIV: no bye logic). Refusals are thrown as `DrawError`s with a
// `code`, so a screen can key on the code and show its own words; the message is plain language already.
//
// Nothing here is Cup-Taster- or database-shaped: ids are opaque strings, and the module imports only core/ and its
// sibling pure helper. Whether a judge conflict is ALLOWED is not decided here either: the database accepts one (a
// committee may need an exception) and records it in btc_round_draws.conflict_ticks.

import { newSeed, seededShuffle } from '../../core/seededShuffle.js';
import { judgeCountryConflicts } from './countryConflicts.js';

export class DrawError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DrawError';
    this.code = code;
  }
}

// The most search steps the rematch fallback may take. Real fields (about 20 teams, one or two earlier rounds) finish
// in a few dozen steps; the cap only keeps a pathological input (every pair already played) from running away. When the
// cap is hit the best arrangement found so far is returned, and `rematches` says how many repeats it still holds.
const SEARCH_NODE_CAP = 200000;
// The same kind of cap for the judge search (assignJudges): only reached when the trades leave a conflict behind.
const JUDGE_SEARCH_NODE_CAP = 20000;

// ---------------------------------------------------------------- shared checks

function assertTeamIds(teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    throw new DrawError('no_teams', 'There are no teams to draw.');
  }
  if (teamIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new DrawError('bad_team_id', 'Every team needs an id.');
  }
  if (new Set(teamIds).size !== teamIds.length) {
    throw new DrawError('duplicate_team', 'A team appears more than once in the draw.');
  }
  if (teamIds.length < 2) {
    throw new DrawError('too_few_teams', 'A draw needs at least 2 teams.');
  }
  if (teamIds.length % 2 === 1) {
    // O1: the committee has not decided how to handle a bye, so the draw refuses rather than guess.
    throw new DrawError(
      'odd_team_count',
      `There are ${teamIds.length} teams, an odd number. Every team must have an opponent, so the draw cannot run until the committee decides how to handle the extra team.`,
    );
  }
}

function seedOrNew(seed) {
  return typeof seed === 'string' && seed.length > 0 ? seed : newSeed();
}

// The draw is a function of the SEED and the SET of teams, not of the order the caller listed them in: the record stores
// only the seed, so a re-entered seed must reproduce the draw whatever order the screen happens to hold the teams in.
function canonical(teamIds) {
  return [...teamIds].sort();
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// priorPairs may be [a, b] arrays or { team1Id, team2Id } objects (what these functions return).
function priorPairKeys(priorPairs) {
  const keys = new Set();
  for (const pair of priorPairs ?? []) {
    const a = Array.isArray(pair) ? pair[0] : pair?.team1Id;
    const b = Array.isArray(pair) ? pair[1] : pair?.team2Id;
    if (typeof a === 'string' && typeof b === 'string') keys.add(pairKey(a, b));
  }
  return keys;
}

function countryOf(teamCountry, teamId) {
  if (!teamCountry) return null;
  const code = teamCountry instanceof Map ? teamCountry.get(teamId) : teamCountry[teamId];
  return code || null;
}

function toPairObjects(idPairs) {
  return idPairs.map(([team1Id, team2Id]) => ({ team1Id, team2Id }));
}

function buildWarnings(idPairs, forbidden, teamCountry, avoidRematches) {
  const rematches = idPairs.filter(([a, b]) => forbidden.has(pairKey(a, b))).length;
  const sameCountryPairs = idPairs.filter(([a, b]) => {
    const ca = countryOf(teamCountry, a);
    return ca !== null && ca === countryOf(teamCountry, b);
  }).length;
  const warnings = [];
  if (rematches > 0) {
    warnings.push({
      code: 'rematch',
      count: rematches,
      message: avoidRematches
        ? `${rematches} ${rematches === 1 ? 'rematch' : 'rematches'} could not be avoided.`
        : `${rematches} ${rematches === 1 ? 'pair has' : 'pairs have'} already played each other.`,
    });
  }
  if (sameCountryPairs > 0) {
    // Information only: same-country pairings are allowed when drawn (owner, 2026-11-07).
    warnings.push({
      code: 'same_country',
      count: sameCountryPairs,
      message: `${sameCountryPairs} ${sameCountryPairs === 1 ? 'match is' : 'matches are'} between teams from the same country.`,
    });
  }
  return { rematches, sameCountryPairs, warnings };
}

// The same warnings for pairs the organiser has edited by hand (the Draw panel recounts after every swap), so the
// screen never re-implements what counts as a rematch or a same-country pairing. `pairs` is [{ team1Id, team2Id }].
export function describePairs({ pairs, priorPairs = [], teamCountry, avoidRematches = true } = {}) {
  const idPairs = (pairs ?? []).map((p) => [p.team1Id, p.team2Id]);
  return buildWarnings(idPairs, priorPairKeys(priorPairs), teamCountry, avoidRematches);
}

// ---------------------------------------------------------------- rematch repair

// Step 1 of a repair: swap partners with the NEAREST other pair so both new pairs are fresh. Changes two pairs at most
// per swap and never creates a rematch, so the rematch count strictly falls and the loop ends. Returns the pairs and
// whether every rematch is gone.
function repairByNeighbourSwaps(idPairs, isRematch) {
  const work = idPairs.map((p) => [...p]);
  for (let pass = 0; pass <= work.length; pass += 1) {
    const k = work.findIndex(([a, b]) => isRematch(a, b));
    if (k < 0) return { pairs: work, ok: true };
    const byDistance = work
      .map((_, m) => m)
      .filter((m) => m !== k)
      .sort((m1, m2) => Math.abs(m1 - k) - Math.abs(m2 - k) || m1 - m2);
    let fixed = false;
    for (const m of byDistance) {
      const [a, b] = work[k];
      const [c, d] = work[m];
      // (a with d, c with b) keeps "strong with weak" when pairs are ranked; (a with c, b with d) is the other swap.
      const options = [
        [
          [a, d],
          [c, b],
        ],
        [
          [a, c],
          [b, d],
        ],
      ];
      const hit = options.find(([p, q]) => !isRematch(p[0], p[1]) && !isRematch(q[0], q[1]));
      if (hit) {
        [work[k], work[m]] = hit;
        fixed = true;
        break;
      }
    }
    if (!fixed) return { pairs: work, ok: false };
  }
  return { pairs: work, ok: false };
}

// Step 2, only when step 1 cannot finish: a depth-first search over whole arrangements for the fewest rematches.
// `order` is the preference order (the first unpaired team is paired next, with the first partner that is not a repeat;
// `weakestFirst` tries partners from the end of the order, which is "strongest against weakest").
function searchFewestRematches(order, isRematch, weakestFirst) {
  const n = order.length;
  const used = new Array(n).fill(false);
  const current = [];
  let best = null;
  let bestCost = Infinity;
  let nodes = 0;

  function visit(cost) {
    nodes += 1;
    if (nodes > SEARCH_NODE_CAP || cost >= bestCost) return;
    const i = used.indexOf(false);
    if (i < 0) {
      best = current.map((p) => [...p]);
      bestCost = cost;
      return;
    }
    used[i] = true;
    const candidates = [];
    for (let j = i + 1; j < n; j += 1) if (!used[j]) candidates.push(j);
    if (weakestFirst) candidates.reverse();
    // fresh partners first, so the first complete arrangement found is already a good one
    candidates.sort(
      (j1, j2) => Number(isRematch(order[i], order[j1])) - Number(isRematch(order[i], order[j2])),
    );
    for (const j of candidates) {
      used[j] = true;
      current.push([order[i], order[j]]);
      visit(cost + Number(isRematch(order[i], order[j])));
      current.pop();
      used[j] = false;
      if (bestCost === 0 || nodes > SEARCH_NODE_CAP) break;
    }
    used[i] = false;
  }

  visit(0);
  return best ?? [];
}

// The ideal pairing for an ordered list, repaired when avoidance is on.
function pairOrdered(order, forbidden, avoidRematches, weakestFirst) {
  const n = order.length;
  const ideal = [];
  if (weakestFirst) {
    for (let k = 0; k < n / 2; k += 1) ideal.push([order[k], order[n - 1 - k]]);
  } else {
    for (let k = 0; k < n; k += 2) ideal.push([order[k], order[k + 1]]);
  }
  if (!avoidRematches || forbidden.size === 0) return ideal;
  const isRematch = (a, b) => forbidden.has(pairKey(a, b));
  const local = repairByNeighbourSwaps(ideal, isRematch);
  if (local.ok) return local.pairs;
  const searched = searchFewestRematches(order, isRematch, weakestFirst);
  const countOf = (ps) => ps.filter(([a, b]) => isRematch(a, b)).length;
  // the search is never worse than the partial local repair; keep whichever has fewer repeats
  return countOf(searched) <= countOf(local.pairs) ? searched : local.pairs;
}

// ---------------------------------------------------------------- the draws

// Round 1: shuffle with the seed and pair consecutive teams.
export function drawRound1({ teamIds, seed, teamCountry } = {}) {
  assertTeamIds(teamIds);
  const usedSeed = seedOrNew(seed);
  const order = seededShuffle(canonical(teamIds), usedSeed);
  const idPairs = pairOrdered(order, new Set(), false, false);
  const { rematches, warnings } = buildWarnings(idPairs, new Set(), teamCountry, false);
  return { pairs: toPairObjects(idPairs), seed: usedSeed, rematches, warnings };
}

// Round 2, random: the same shuffle, then (when avoidRematches) a repair so nobody meets an earlier opponent again.
// `rematches` counts the repeats that remain: 0 whenever a repeat-free arrangement is found. The search is capped, so a
// pathological field (about 30 teams or more with very few allowed opponents each) can report a repeat that a longer
// search would avoid; the count is always honest. Realistic fields (about 20 teams, a few rounds) never hit the cap.
export function drawRound2Random({
  teamIds,
  priorPairs = [],
  seed,
  avoidRematches = true,
  teamCountry,
} = {}) {
  assertTeamIds(teamIds);
  const usedSeed = seedOrNew(seed);
  const forbidden = priorPairKeys(priorPairs);
  const order = seededShuffle(canonical(teamIds), usedSeed);
  const idPairs = pairOrdered(order, forbidden, avoidRematches, false);
  const { rematches, warnings } = buildWarnings(idPairs, forbidden, teamCountry, avoidRematches);
  return { pairs: toPairObjects(idPairs), seed: usedSeed, rematches, warnings };
}

// Round 2, by results: order by points (highest first; equal points in the seeded shuffle's order, so the result can
// be explained), then the strongest meets the weakest, second against second-last, and so on. `team1Id` is the
// stronger side. `standings` is [{ teamId, points }] and must name every team: a draw on partial results would pair
// teams on a table that is not final, so an incomplete table is refused.
export function drawRound2ByResults({
  standings,
  priorPairs = [],
  seed,
  avoidRematches = true,
  teamCountry,
} = {}) {
  if (!Array.isArray(standings)) {
    throw new DrawError(
      'no_standings',
      'The round 1 results are needed to draw round 2 by results.',
    );
  }
  const teamIds = standings.map((row) => row?.teamId);
  assertTeamIds(teamIds);
  if (standings.some((row) => typeof row.points !== 'number' || !Number.isFinite(row.points))) {
    throw new DrawError(
      'incomplete_standings',
      'Every team needs a points total before round 2 can be drawn by results.',
    );
  }
  const usedSeed = seedOrNew(seed);
  const forbidden = priorPairKeys(priorPairs);
  const points = new Map(standings.map((row) => [row.teamId, row.points]));
  // Array#sort is stable: equal points keep the seeded shuffle's order.
  const order = seededShuffle(canonical(teamIds), usedSeed).sort(
    (a, b) => points.get(b) - points.get(a),
  );
  const rank = new Map(order.map((id, i) => [id, i]));
  // a repair can seat the stronger team second; team1 is always the higher-ranked side
  const idPairs = pairOrdered(order, forbidden, avoidRematches, true).map(([a, b]) =>
    rank.get(a) <= rank.get(b) ? [a, b] : [b, a],
  );
  const { rematches, warnings } = buildWarnings(idPairs, forbidden, teamCountry, avoidRematches);
  return { pairs: toPairObjects(idPairs), seed: usedSeed, rematches, warnings };
}

// ---------------------------------------------------------------- judges

// Three distinct judges per match, by rotation. `pairs` is [{ team1Id, team2Id }]; `judges` is [{ id, country_code }]
// (a judge with no country never conflicts); `teamCountry` maps team id to country code (Map or plain object).
//
// Loads: judges are dealt out cyclically, so every judge judges floor(3M/J) or ceil(3M/J) matches, never more than one
// apart. Conflicts: a judge sharing a country with either team of a match is swapped with a judge in another match
// when that makes BOTH placements fresh, which keeps every load exactly as it was. What cannot be fixed that way (few
// judges, many teams from one country) is returned in `conflicts` instead of failing; the organiser edits the result.
// Deterministic: the same inputs give the same assignment. Fewer than 3 judges is refused.
export function assignJudges({ pairs, judges, teamCountry } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new DrawError('no_pairs', 'There are no matches to assign judges to.');
  }
  const pool = Array.isArray(judges) ? judges : [];
  if (pool.some((j) => typeof j?.id !== 'string' || j.id.length === 0)) {
    throw new DrawError('bad_judge_id', 'Every judge needs an id.');
  }
  if (new Set(pool.map((j) => j.id)).size !== pool.length) {
    throw new DrawError('duplicate_judge', 'A judge appears more than once in the pool.');
  }
  if (pool.length < 3) {
    throw new DrawError(
      'too_few_judges',
      `Each match needs 3 different judges, but only ${pool.length} ${pool.length === 1 ? 'judge is' : 'judges are'} available.`,
    );
  }

  const teams = [];
  for (const p of pairs) {
    for (const id of [p.team1Id, p.team2Id]) {
      if (!teams.some((t) => t.id === id)) {
        teams.push({ id, country_code: countryOf(teamCountry, id) });
      }
    }
  }
  const conflictsOf = (pair, judgeId) =>
    judgeCountryConflicts({
      judges: pool,
      teams,
      team1Id: pair.team1Id,
      team2Id: pair.team2Id,
      judgeIds: [judgeId],
    }).length;

  // the cyclic deal: match m gets judges 3m, 3m+1, 3m+2 (mod J), distinct because J >= 3
  const slots = pairs.map((_, m) => [0, 1, 2].map((k) => pool[(3 * m + k) % pool.length].id));

  // trade conflicted placements between matches; every accepted trade strictly lowers the conflict total
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < slots.length && !improved; a += 1) {
      for (let ia = 0; ia < 3 && !improved; ia += 1) {
        const x = slots[a][ia];
        const before = conflictsOf(pairs[a], x);
        if (before === 0) continue;
        // a one-sided move: hand the slot to a fresh judge when the loads stay within one of each other
        const load = Object.fromEntries(pool.map((j) => [j.id, 0]));
        for (const row of slots) for (const id of row) load[id] += 1;
        for (const { id: y } of pool) {
          if (slots[a].includes(y) || conflictsOf(pairs[a], y) >= before) continue;
          load[x] -= 1;
          load[y] += 1;
          const counts = Object.values(load);
          const spreadOk = Math.max(...counts) - Math.min(...counts) <= 1;
          load[x] += 1;
          load[y] -= 1;
          if (spreadOk) {
            slots[a][ia] = y;
            improved = true;
            break;
          }
        }
        for (let step = 1; step < slots.length && !improved; step += 1) {
          const b = (a + step) % slots.length;
          for (let ib = 0; ib < 3; ib += 1) {
            const y = slots[b][ib];
            if (y === x || slots[a].includes(y) || slots[b].includes(x)) continue;
            const after = conflictsOf(pairs[a], y) + conflictsOf(pairs[b], x);
            const was = before + conflictsOf(pairs[b], y);
            if (after < was) {
              slots[a][ia] = y;
              slots[b][ib] = x;
              improved = true;
              break;
            }
          }
        }
      }
    }
  }

  // The trading above stops at a local optimum, so it can leave a conflict that a different arrangement avoids. When any
  // remain, search whole arrangements (capped, deterministic) for one with fewer; keep it only if strictly better.
  const countConflicts = (rows) =>
    rows.reduce((sum, ids, m) => sum + ids.reduce((s, id) => s + conflictsOf(pairs[m], id), 0), 0);
  const localCost = countConflicts(slots);
  if (localCost > 0) {
    const totalSlots = 3 * pairs.length;
    const floorLoad = Math.floor(totalSlots / pool.length);
    const capLoad = Math.ceil(totalSlots / pool.length);
    const load = new Array(pool.length).fill(0);
    const chosen = [];
    let bestRows = null;
    let bestCost = localCost;
    let nodes = 0;
    const visitMatch = (m, cost) => {
      nodes += 1;
      if (nodes > JUDGE_SEARCH_NODE_CAP || cost >= bestCost) return;
      if (m === pairs.length) {
        if (Math.max(...load) - Math.min(...load) <= 1) {
          bestRows = chosen.map((row) => row.map((j) => pool[j].id));
          bestCost = cost;
        }
        return;
      }
      // every judge must still be able to reach the minimum load
      const needed = load.reduce((n, l) => n + Math.max(0, floorLoad - l), 0);
      if (needed > 3 * (pairs.length - m)) return;
      const open = [];
      for (let j = 0; j < pool.length; j += 1) {
        if (load[j] < capLoad) open.push({ j, c: conflictsOf(pairs[m], pool[j].id) });
      }
      // fewest conflicts first, then the lightest load, then pool order
      open.sort((a, b) => a.c - b.c || load[a.j] - load[b.j] || a.j - b.j);
      for (let x = 0; x < open.length; x += 1) {
        for (let y = x + 1; y < open.length; y += 1) {
          for (let z = y + 1; z < open.length; z += 1) {
            const panel = [open[x], open[y], open[z]];
            for (const t of panel) load[t.j] += 1;
            chosen.push(panel.map((t) => t.j).sort((a, b) => a - b));
            visitMatch(m + 1, cost + panel[0].c + panel[1].c + panel[2].c);
            chosen.pop();
            for (const t of panel) load[t.j] -= 1;
            if (bestCost === 0 || nodes > JUDGE_SEARCH_NODE_CAP) return;
          }
        }
      }
    };
    visitMatch(0, 0);
    if (bestRows) bestRows.forEach((row, m) => (slots[m] = row));
  }

  const assignments = slots.map((judgeIds, matchIndex) => ({
    matchIndex,
    judgeIds: [...judgeIds],
  }));
  const conflicts = [];
  slots.forEach((judgeIds, matchIndex) => {
    for (const judgeId of judgeIds) {
      for (const c of judgeCountryConflicts({
        judges: pool,
        teams,
        team1Id: pairs[matchIndex].team1Id,
        team2Id: pairs[matchIndex].team2Id,
        judgeIds: [judgeId],
      })) {
        conflicts.push({ matchIndex, judgeId: c.judgeId, teamId: c.teamId });
      }
    }
  });
  const loads = Object.fromEntries(pool.map((j) => [j.id, 0]));
  for (const judgeIds of slots) for (const id of judgeIds) loads[id] += 1;

  const warnings = [];
  if (conflicts.length > 0) {
    const matchCount = new Set(conflicts.map((c) => c.matchIndex)).size;
    warnings.push({
      code: 'judge_conflict',
      count: matchCount,
      message: `${matchCount} ${matchCount === 1 ? 'match has' : 'matches have'} a judge from a team's own country. Change the judge, or accept it for that match.`,
    });
  }
  return { assignments, conflicts, loads, warnings };
}
