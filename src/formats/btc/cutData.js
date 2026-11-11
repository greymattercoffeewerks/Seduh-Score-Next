// What BTC's "The cut" (the Standings section) and its sign-off sheet show, in one place so the screens stay thin.
// Pure parts: `deriveCutRows` (the table's rows), `lockState` (may the top 8 be locked, and if not, why),
// `cutQualifiers` / `cutOthers` (the eight and the rest). The reads are advisory: a failed one is `null`, never an
// error that stops the page.
//
// Scoring discipline (spec U3): nothing here decides who qualifies. The ORDER and the ties come from the database's
// own `btc_seeding_order` (seeding.js `fetchSeedingOrder`) and the recorded tie-breaks: rows are listed in the
// database's seed order and a team is "qualifying" because its seed is 8 or better there. The per-round points and the
// finish times are shown beside that order as evidence; they never reorder it. The places are numbered like
// core/ranking.js's `rank()` but over the database's order, never re-sorted (`rankCutRows`).
import { getSupabase } from '../../core/supabaseClient.js';
import { positionsInOrder } from '../../core/ranking.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { formatDuration } from '../../core/duration.js';
import { roundOf } from './drawPlan.js';
import { cupsForRound, TOKENS_PER_CUP } from './scoring.js';
import { KNOCKOUT_PLACES } from './words.js';
import { blockingGroups, fetchPrelimTimes, seedingTieGroups, teamTimeEvidence } from './seeding.js';

const advisory = (promise) =>
  raceTimeout(Promise.resolve(promise), DEFAULT_LOAD_TIMEOUT_MS).catch((err) => {
    console.warn('btc: an advisory read for the cut failed', err);
    return null;
  });

// The preliminary matches of an event (any round), as the cut needs them: id, round, status, sides.
export async function fetchPreliminaryMatches(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_matches')
    .select('id, round, prelim_round, status, team1_id, team2_id')
    .eq('event_id', eventId)
    .eq('round', 'preliminary');
  if (error) throw error;
  return data ?? [];
}

const SCORE_COLUMNS =
  'match_id, status, team1_id, team2_id, team1_tokens, team2_tokens, team1_total, team2_total';

export async function fetchPreliminaryScores(matchIds, client = getSupabase()) {
  if (matchIds.length === 0) return [];
  const { data, error } = await client
    .from('btc_match_scores')
    .select(SCORE_COLUMNS)
    .in('match_id', matchIds);
  if (error) throw error;
  return data ?? [];
}

/**
 * The reads the cut needs besides the seed order. Each one that fails is `null`: `matches` (so "both rounds
 * confirmed" cannot be said), `scores` (per-round points), `times` (finish times).
 */
export async function loadCutExtras(eventId, client = getSupabase()) {
  const matches = await advisory(fetchPreliminaryMatches(eventId, client));
  const scores =
    matches === null
      ? null
      : await advisory(
          fetchPreliminaryScores(
            matches.map((m) => m.id),
            client,
          ),
        );
  const times = await advisory(fetchPrelimTimes(eventId, client));
  return { matches, scores, times };
}

// Pure. Points per team per preliminary round, counting what the standings view counts: a CONFIRMED match with every
// cup scored. { byTeam: Map<teamId, Map<round, points>>, null when the scores could not be read }.
export function pointsByRound(matches, scores) {
  if (matches === null || scores === null) return null;
  const roundOfMatch = new Map(matches.map((m) => [m.id, roundOf(m)]));
  const complete = cupsForRound('preliminary') * TOKENS_PER_CUP;
  const byTeam = new Map();
  const add = (teamId, round, points) => {
    if (!byTeam.has(teamId)) byTeam.set(teamId, new Map());
    const rounds = byTeam.get(teamId);
    rounds.set(round, (rounds.get(round) ?? 0) + Number(points));
  };
  for (const score of scores) {
    if (score.status !== 'confirmed' || !roundOfMatch.has(score.match_id)) continue;
    if (Number(score.team1_tokens) + Number(score.team2_tokens) !== complete) continue;
    const round = roundOfMatch.get(score.match_id);
    add(score.team1_id, round, score.team1_total);
    add(score.team2_id, round, score.team2_total);
  }
  return byTeam;
}

// Pure. The table's rows, in the DATABASE's seed order (a team with no result has no seed and follows, in roster
// order). `seedingRows` are seeding.js `fetchSeedingOrder` rows; `teams` the roster; `matches`, `scores`, `times` are
// the advisory reads (null when they failed).
//   row: { teamId, team, seed|null, played, wins, totalPoints, tiedCount, resolved, round1|null, round2|null,
//          roundsAddUp, evidence|null }
export function deriveCutRows({
  teams,
  seedingRows,
  matches = null,
  scores = null,
  times = null,
  lockedSeeds = null,
}) {
  const byTeam = new Map((seedingRows ?? []).map((row) => [row.teamId, row]));
  const perRound = pointsByRound(matches, scores);
  // Once a bracket exists its first-round slots are authoritative (a preliminary match can still be re-confirmed after
  // the lock, which moves the live view): the locked eight keep their locked seed, everyone else follows them.
  const seedOf = (teamId, seeded) => {
    if (!lockedSeeds) return seeded ? seeded.seed : null;
    if (lockedSeeds.has(teamId)) return lockedSeeds.get(teamId);
    return seeded ? seeded.seed + KNOCKOUT_PLACES : null;
  };
  const rows = teams.map((team) => {
    const seeded = byTeam.get(team.id) ?? null;
    const rounds = perRound?.get(team.id) ?? new Map();
    const roundSum = [...rounds.values()].reduce((a, b) => a + b, 0);
    const totalPoints = seeded?.totalPoints ?? 0;
    return {
      teamId: team.id,
      team,
      seed: seedOf(team.id, seeded),
      played: seeded?.played ?? 0,
      wins: seeded?.wins ?? 0,
      totalPoints,
      // once the bracket exists the cut is decided: no group is open
      tiedCount: lockedSeeds ? 1 : (seeded?.tiedCount ?? 1),
      resolved: lockedSeeds ? true : seeded ? seeded.groupResolved === true : true,
      round1: perRound ? (rounds.get(1) ?? null) : null,
      round2: perRound ? (rounds.get(2) ?? null) : null,
      // The two round figures are a display aid; when they do not add up to the database's total (a third round, a
      // match not complete) the screen says so rather than leave the two to disagree silently.
      roundsAddUp: perRound ? roundSum === totalPoints : true,
      evidence: times ? teamTimeEvidence(team.id, times) : null,
    };
  });
  return rows.sort((a, b) => {
    if (a.seed === null && b.seed === null) return 0; // roster order (stable sort)
    if (a.seed === null) return 1;
    if (b.seed === null) return -1;
    return a.seed - b.seed;
  });
}

// Pure. { teamId → seed } from the bracket's quarterfinal slots (btc_bracket_slots seed_1/seed_2 are authoritative once
// the bracket exists), or null when there is no bracket. `entries` are bracket.js `fetchBracket` entries.
export function lockedSeedsFromBracket(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const seeds = new Map();
  for (const { slot } of entries) {
    if (slot.round !== 'quarterfinal') continue;
    if (slot.team1_id && slot.seed_1 != null) seeds.set(slot.team1_id, Number(slot.seed_1));
    if (slot.team2_id && slot.seed_2 != null) seeds.set(slot.team2_id, Number(slot.seed_2));
  }
  return seeds;
}

// Pure. Whether the live seed order's top eight is no longer the locked eight (scores were changed after locking).
export function lockedDiffers(seedingRows, lockedSeeds) {
  if (!lockedSeeds || lockedSeeds.size === 0) return false;
  const live = seedingRows.filter((row) => row.seed <= KNOCKOUT_PLACES).map((row) => row.teamId);
  return live.length !== lockedSeeds.size || live.some((id) => !lockedSeeds.has(id));
}

export const LOCKED_DIFFERS_NOTE =
  'Scores changed after the top 8 were locked, so the standings no longer match the locked eight. The locked eight are the teams in the knockout.';

// Pure. The places, numbered by core/ranking.js's `positionsInOrder` (the numbering half of `rank()`, without its
// sort): the order here is the database's seed order, which an organiser's recorded tie-break may make differ from a
// plain points sort. Same `{ item, position }` shape as `rank()`, so core/cutLine.js takes it. Display only.
export const rankCutRows = (rows) =>
  positionsInOrder(rows, (a, b) => a.totalPoints === b.totalPoints);

// Pure. Two adjacent rows are level when the database says both are in a tie group of the same points. A team with no
// result is never level with anyone.
export const isLevelRows = (a, b) =>
  a.seed !== null && b.seed !== null && a.tiedCount > 1 && a.totalPoints === b.totalPoints;

// Pure. A level group is settled when the database says every team in it is resolved.
export const isSettledRows = (items) => items.every((row) => row.resolved);

// Pure. The eight (the teams whose database seed is 8 or better) and everyone else, each in the database's order.
export const cutQualifiers = (rows) =>
  rows.filter((row) => row.seed !== null && row.seed <= KNOCKOUT_PLACES);
export const cutOthers = (rows) =>
  rows.filter((row) => row.seed === null || row.seed > KNOCKOUT_PLACES);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Pure. What a preliminary round needs before the cut: { round, drawn, open } for rounds 1 and 2 and any later one.
export function roundProgress(matches) {
  const rounds = new Set([1, 2, ...matches.map(roundOf)]);
  return [...rounds]
    .sort((a, b) => a - b)
    .map((round) => {
      const inRound = matches.filter((m) => roundOf(m) === round);
      return {
        round,
        drawn: inRound.length,
        open: inRound.filter((m) => m.status !== 'confirmed').length,
      };
    });
}

/**
 * Pure. May the top 8 be locked, and if not, why. Returns { allowed, reason } where `reason` is a sentence that says
 * what to do (null when allowed). Checked in the order a person would fix them.
 * @param {{ matches: object[]|null, seedingRows: object[], readFailed: boolean, formOpen: boolean, bracketExists: boolean }} input
 */
export function lockState({ matches, seedingRows, readFailed, formOpen, bracketExists }) {
  if (bracketExists) return { allowed: false, reason: 'The bracket is already generated.' };
  if (matches === null) {
    return {
      allowed: false,
      reason: 'We could not check that both rounds are confirmed. Reload the page to try again.',
    };
  }
  for (const { round, drawn, open } of roundProgress(matches)) {
    if (round <= 2 && drawn === 0) {
      return { allowed: false, reason: `Round ${round} has not been drawn yet.` };
    }
    if (open > 0) {
      return {
        allowed: false,
        reason: `Round ${round} still has ${plural(open, 'match', 'matches')} to confirm.`,
      };
    }
  }
  if (readFailed) {
    return {
      allowed: false,
      reason: 'We could not check for teams that are level. Use "Check again" first.',
    };
  }
  if (seedingRows.length < KNOCKOUT_PLACES) {
    return {
      allowed: false,
      reason: `Only ${plural(seedingRows.length, 'team has', 'teams have')} a result; the knockout needs ${KNOCKOUT_PLACES}.`,
    };
  }
  if (formOpen) {
    return { allowed: false, reason: 'Save or cancel the order you have open first.' };
  }
  const blocking = blockingGroups(seedingTieGroups(seedingRows));
  if (blocking.length > 0) {
    return {
      allowed: false,
      reason:
        'Teams are level across the cut line. Put them in order first, in "Teams level in the standings".',
    };
  }
  return { allowed: true, reason: null };
}

// Pure. The finish-time cells of a row: { round1, round2, sum } as text ("–" when there is none to show).
export const NO_VALUE = '–';
export function timeCells(row) {
  if (!row.evidence) return { round1: NO_VALUE, round2: NO_VALUE, sum: NO_VALUE };
  const noteOf = (round) => {
    const notes = row.evidence.rounds.find((entry) => entry.round === round)?.notes ?? [];
    return notes.length > 0 ? notes.join(' and ') : NO_VALUE;
  };
  return {
    round1: noteOf(1),
    round2: noteOf(2),
    sum: row.evidence.sumSecs === null ? NO_VALUE : formatDuration(row.evidence.sumSecs),
  };
}

export const pointsCell = (value) =>
  value === null || value === undefined ? NO_VALUE : String(value);
