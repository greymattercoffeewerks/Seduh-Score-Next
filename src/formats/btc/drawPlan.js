// The Draw panel's state, as pure functions (Build B part 2; spec section 4.3). No DOM, no database, no clock: the panel
// (drawPanel.js) draws what these return and matchesScreen.js wires the calls.
//
// Who plays whom is decided ONLY by draw.js (drawRound1, drawRound2Random, drawRound2ByResults, assignJudges). This file
// asks those functions for a draw, and afterwards applies the organiser's hand edits (a swap, a changed judge, a ticked
// conflict) to what they returned. It never pairs teams or picks a judge itself, and it never recounts a rematch or a
// same-country pairing on its own: describePairs (draw.js) does.
import {
  DrawError,
  assignJudges,
  describePairs,
  drawRound1,
  drawRound2ByResults,
  drawRound2Random,
} from './draw.js';
import { judgeCountryConflicts } from './countryConflicts.js';
import { buildRoundMatches } from './rounds.js';
import { countryName } from '../../core/country.js';

// An unnumbered preliminary match reads as round 1 (Build A), the same rule the database uses.
export const roundOf = (match) => match.prelim_round ?? 1;

// `matches` is the screen's [{ match, judgeIds }] list. A round can be drawn when it has no matches yet and, for round
// 2, round 1 exists and is fully confirmed (the database refuses otherwise: btc_prior_round_open).
export function roundStatus(round, matches, deadRounds = new Set()) {
  const inRound = (r) => matches.filter((m) => roundOf(m.match) === r);
  const drawn = inRound(round).length > 0;
  if (drawn) {
    return { drawn: true, available: false, reason: `Round ${round} has already been drawn.` };
  }
  if (deadRounds.has(round)) {
    // the database still holds this round's draw record although its matches were removed (create_btc_round refuses)
    return {
      drawn: false,
      available: false,
      reason: `Round ${round} cannot be drawn again here: its draw record is still in the database although its matches were removed. Ask the platform owner to clear it.`,
    };
  }
  if (round === 1) return { drawn: false, available: true, reason: null };
  const first = inRound(1);
  if (first.length === 0) {
    return {
      drawn: false,
      available: false,
      reason: 'Round 2 can be drawn once round 1 has been drawn and every match is confirmed.',
    };
  }
  const open = first.filter((m) => m.match.status !== 'confirmed').length;
  if (open > 0) {
    return {
      drawn: false,
      available: false,
      reason: `Round 2 can be drawn once every round 1 match is confirmed. ${open} of ${first.length} ${open === 1 ? 'is' : 'are'} still open.`,
    };
  }
  return { drawn: false, available: true, reason: null };
}

// The round the panel opens on: the first one that has not been drawn.
export function defaultRound(matches) {
  return roundStatus(1, matches).drawn ? 2 : 1;
}

function teamCountryMap(teams) {
  return new Map(teams.map((t) => [t.id, t.country_code ?? null]));
}

function priorPairsFor(round, matches) {
  return matches
    .filter((m) => roundOf(m.match) < round)
    .map((m) => [m.match.team1_id, m.match.team2_id]);
}

function assignmentsFor(judgeIds) {
  return judgeIds.map((ids, matchIndex) => ({ matchIndex, judgeIds: ids }));
}

// Runs the draw. `round2Mode` is 'random' or 'by_results' and only matters for round 2. `standings` is the round 1 table
// ([{ teamId, totalPoints }], standings.js) or null when it could not be read. Throws DrawError (draw.js) with a code
// the panel shows in words: an odd team count, too few judges, no standings.
export function generateDraw({
  round,
  round2Mode,
  seed,
  avoid,
  teams,
  judges,
  matches,
  standings,
}) {
  const teamIds = teams.map((t) => t.id);
  const teamCountry = teamCountryMap(teams);
  const priorPairs = priorPairsFor(round, matches);
  let result;
  let mode;
  if (round === 1) {
    mode = 'random';
    result = drawRound1({ teamIds, seed, teamCountry });
  } else if (round2Mode === 'by_results') {
    mode = 'by_results';
    if (!Array.isArray(standings)) {
      throw new DrawError(
        'no_standings',
        'The round 1 results could not be read, so round 2 cannot be drawn by results yet. Try again, or draw it at random.',
      );
    }
    result = drawRound2ByResults({
      standings: standings.map((row) => ({ teamId: row.teamId, points: row.totalPoints })),
      priorPairs,
      seed,
      avoidRematches: avoid,
      teamCountry,
    });
  } else {
    mode = 'random';
    result = drawRound2Random({ teamIds, priorPairs, seed, avoidRematches: avoid, teamCountry });
  }
  const judged = assignJudges({ pairs: result.pairs, judges, teamCountry });
  return {
    round,
    mode,
    seed: result.seed,
    avoid,
    manual: false,
    pairs: result.pairs,
    judgeIds: judged.assignments.map((a) => [...a.judgeIds]),
    ticks: result.pairs.map(() => false),
    warnings: result.warnings,
  };
}

// The mode and seed the database record gets: any hand change to a pairing makes it 'manual' with no seed.
export function recordMode(draw) {
  return draw.manual ? 'manual' : draw.mode;
}
export function recordSeed(draw) {
  return draw.manual ? null : draw.seed;
}

function recount(draw, teams, matches) {
  const { warnings } = describePairs({
    pairs: draw.pairs,
    priorPairs: priorPairsFor(draw.round, matches),
    teamCountry: teamCountryMap(teams),
    avoidRematches: draw.avoid,
  });
  return { ...draw, warnings };
}

// Swaps two team slots, each `{ match, slot }` (slot 1 or 2). Any change marks the draw manual, drops its seed from the
// record, and clears the conflict tick of both matches (a tick is for the arrangement the organiser looked at).
export function swapTeams(draw, a, b, { teams, matches }) {
  if (a.match === b.match && a.slot === b.slot) return draw;
  const key = (slot) => (slot === 1 ? 'team1Id' : 'team2Id');
  const pairs = draw.pairs.map((p) => ({ ...p }));
  const first = pairs[a.match][key(a.slot)];
  pairs[a.match][key(a.slot)] = pairs[b.match][key(b.slot)];
  pairs[b.match][key(b.slot)] = first;
  const ticks = [...draw.ticks];
  ticks[a.match] = false;
  ticks[b.match] = false;
  return recount({ ...draw, pairs, ticks, manual: true }, teams, matches);
}

// Changes one of a match's three judges. The pairing is untouched, so the draw keeps its mode and seed; the tick for
// that match is cleared so a conflict has to be accepted again knowingly.
export function setJudge(draw, matchIndex, slot, judgeId) {
  const judgeIds = draw.judgeIds.map((row) => [...row]);
  judgeIds[matchIndex][slot] = judgeId;
  const ticks = [...draw.ticks];
  ticks[matchIndex] = false;
  return { ...draw, judgeIds, ticks };
}

export function setTick(draw, matchIndex, ticked) {
  const ticks = [...draw.ticks];
  ticks[matchIndex] = Boolean(ticked);
  return { ...draw, ticks };
}

// What stops a draw being created, per match: a judge twice in one match, and a judge from a team's own country that
// the organiser has not accepted. `valid` is true only when no match has either.
export function drawIssues(draw, { teams, judges }) {
  const byMatch = draw.pairs.map((pair, m) => {
    const ids = draw.judgeIds[m];
    const duplicate = new Set(ids).size !== ids.length || ids.some((id) => !id);
    const conflicts = judgeCountryConflicts({
      judges,
      teams,
      team1Id: pair.team1Id,
      team2Id: pair.team2Id,
      judgeIds: ids,
    }).map(({ judgeId, teamId }) => {
      const judge = judges.find((j) => j.id === judgeId);
      const team = teams.find((t) => t.id === teamId);
      return {
        judgeId,
        teamId,
        message: `Judge ${judge.name} is from ${countryName(judge.country_code)}, the same country as ${team.name}.`,
      };
    });
    return { duplicate, conflicts, blocked: duplicate || (conflicts.length > 0 && !draw.ticks[m]) };
  });
  return { byMatch, valid: byMatch.every((m) => !m.blocked) };
}

// The p_matches argument of create_btc_round (rounds.js builds the shape).
export function roundMatchesFor(draw) {
  return buildRoundMatches(draw.pairs, assignmentsFor(draw.judgeIds));
}
