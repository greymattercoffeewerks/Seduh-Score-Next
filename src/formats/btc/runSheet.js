// BTC's run sheet: what phase the event is in, derived from the reads the organiser screens already make. Pure
// (rows in, phases and warnings out: no DOM, no database, no clock); core/runSheet.js and core/eventWarnings.js
// draw what this returns. Nothing is stored: the phases are derived on every load (spec U1, section 3).
//
// Phases, in order: Setup, Round 1, Round 2, The cut, Knockout, Podium. Each is
//   { id, label, status, count, progress, nextAction: { label, href }, blockedReason }
// (the contract in core/runSheet.js). Two statuses mean "not yet", and the difference matters:
//   - `blocked`: the organiser can fix it now (a team has no country: Round 1, owner decision Q3).
//   - `waiting`: it depends on an earlier phase finishing; there is nothing to press.
//
// Rules this file keeps:
//   - An unnumbered preliminary match is round 1 (`roundOf`, the rule the database uses). Round 2 holds every
//     round from 2 up: the March format has two, and a later one must still hold the cut back.
//   - Who qualifies is never worked out here. The tie groups at the cut come from the database's seed order
//     (`seeding.js`); the podium is `derivePodium`; this file only counts and words them.
//   - A read that failed is `null`, and a phase that needed it says so instead of claiming a number.
import { roundOf } from './drawPlan.js';
import { judgeCountryConflicts } from './countryConflicts.js';
import { derivePodium } from './podium.js';
import { blockingGroups, seedingTieGroups } from './seeding.js';
import { roundLabel } from './roundNames.js';

const MIN_JUDGES = 3;
const KNOCKOUT_ROUNDS = ['quarterfinal', 'semifinal', 'final', 'third_place'];
const KNOCKOUT_SHORT = {
  quarterfinal: 'QF',
  semifinal: 'SF',
  final: 'Final',
  third_place: 'Third',
};

// The routes the dashboard sends the organiser to. One table so a stage that moves a section changes one line.
export function btcLinks(eventId) {
  const base = `#/events/${encodeURIComponent(eventId)}/btc`;
  return {
    setup: `${base}/setup`,
    matches: `${base}/matches`,
    standings: `${base}/standings`,
    bracket: `${base}/bracket`,
    // The cut (the tie card, "Lock the top 8" and the sign-off sheet) is a section of Standings since S4.
    cut: `${base}/standings`,
    signOff: `${base}/sign-off`,
    scoring: (matchId) => `${base}/matches/${encodeURIComponent(matchId)}/scoring`,
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Pure. The teams of an event with no country.
export const teamsWithoutCountry = (teams) => teams.filter((team) => !team.country_code);

// Pure. Setup is done when the field is an even number of at least two teams, there are at least three judges
// and every team has a country (Q3). Returns { done, noCountry, problems: string[] }.
export function setupState({ teams, judges }) {
  const noCountry = teamsWithoutCountry(teams).length;
  const problems = [];
  if (teams.length === 0) problems.push('teams');
  else if (teams.length % 2 === 1) problems.push('odd');
  if (judges.length < MIN_JUDGES) problems.push('judges');
  if (noCountry > 0) problems.push('countries');
  return { done: problems.length === 0, noCountry, problems };
}

function setupPhase(data, links) {
  const { teams, judges } = data;
  const state = setupState(data);
  const parts = [plural(teams.length, 'team', 'teams'), plural(judges.length, 'judge', 'judges')];
  if (teams.length > 0 && state.noCountry > 0) parts.push(`${state.noCountry} without a country`);
  let nextAction = null;
  if (teams.length === 0) nextAction = { label: 'Add teams', href: links.setup };
  else if (state.problems.includes('odd')) {
    nextAction = { label: 'Add a team', href: links.setup };
  } else if (state.problems.includes('judges')) {
    nextAction = { label: 'Add judges', href: links.setup };
  } else if (state.noCountry > 0) nextAction = { label: 'Set countries', href: links.setup };
  const status = state.done
    ? 'done'
    : teams.length === 0 && judges.length === 0
      ? 'not_started'
      : 'in_progress';
  let blockedReason = null;
  if (state.problems.includes('odd')) {
    blockedReason = `${teams.length} teams is an odd number. The draw needs an even number: add or remove a team.`;
  } else if (state.problems.includes('judges')) {
    blockedReason = `Needs at least ${MIN_JUDGES} judges.`;
  }
  return {
    id: 'setup',
    label: 'Setup',
    status,
    count: parts.join(' · '),
    nextAction,
    blockedReason: state.done ? null : blockedReason,
  };
}

// The preliminary matches of a round: [{ match, judgeIds }] in the order they were made.
function roundMatches(matches, inRound) {
  return matches.filter((m) => m.match.round === 'preliminary' && inRound(roundOf(m.match)));
}

const isConfirmed = (m) => m.match.status === 'confirmed';
const isScoring = (m) => m.match.status === 'scoring';

function progressOf(list) {
  return {
    done: list.filter(isConfirmed).length,
    active: list.filter(isScoring).length,
    total: list.length,
  };
}

// The first match of a list that is not confirmed, preferring one already being scored.
function nextToScore(list) {
  return list.find(isScoring) ?? list.find((m) => !isConfirmed(m)) ?? null;
}

function roundPhase({ id, label, list, drawn, dependency, links, drawLabel, blockedBy }) {
  if (list.length > 0) {
    const progress = progressOf(list);
    const open = list.length - progress.done;
    const next = nextToScore(list);
    return {
      id,
      label,
      status: open === 0 ? 'done' : 'in_progress',
      count: `${progress.done} of ${list.length} confirmed`,
      progress,
      nextAction:
        open === 0 || !next ? null : { label: 'Score next', href: links.scoring(next.match.id) },
      blockedReason: null,
    };
  }
  if (dependency) {
    return {
      id,
      label,
      status: 'waiting',
      count: 'Not drawn',
      nextAction: null,
      blockedReason: dependency,
    };
  }
  if (blockedBy) {
    return {
      id,
      label,
      status: 'blocked',
      count: 'Not drawn',
      nextAction: blockedBy.action,
      blockedReason: blockedBy.reason,
    };
  }
  return {
    id,
    label,
    status: 'not_started',
    count: drawn ? drawn : 'Not drawn',
    nextAction: { label: drawLabel, href: links.matches },
    blockedReason: null,
  };
}

function round1Phase(data, links, r1) {
  const missing = teamsWithoutCountry(data.teams).length;
  const blockedBy =
    missing > 0
      ? {
          reason: `${plural(missing, 'team has', 'teams have')} no country: set ${missing === 1 ? 'it' : 'them'} in Setup.`,
          action: { label: 'Set countries', href: links.setup },
        }
      : null;
  return roundPhase({
    id: 'round1',
    label: 'Round 1',
    list: r1,
    dependency: null,
    links,
    drawLabel: 'Draw round 1',
    blockedBy,
  });
}

function round2Phase(links, r1, r2) {
  let dependency = null;
  if (r2.length === 0) {
    const open = r1.filter((m) => !isConfirmed(m)).length;
    if (r1.length === 0) dependency = 'Round 2 waits for round 1 to be drawn and confirmed.';
    else if (open > 0) {
      dependency = `Round 2 waits for round 1: ${plural(open, 'match is', 'matches are')} not confirmed.`;
    }
  }
  return roundPhase({
    id: 'round2',
    label: 'Round 2',
    list: r2,
    dependency,
    links,
    drawLabel: 'Draw round 2',
    blockedBy: null,
  });
}

// The preliminary round is over when both rounds have matches and every one is confirmed.
function preliminaryComplete(r1, r2) {
  return r1.length > 0 && r2.length > 0 && [...r1, ...r2].every(isConfirmed);
}

function cutPhase(data, links, r1, r2) {
  const base = { id: 'cut', label: 'The cut', progress: null };
  const bracketMade = data.bracket.length > 0;
  if (bracketMade) {
    return {
      ...base,
      status: 'done',
      count: 'Top 8 locked',
      nextAction: null,
      blockedReason: null,
    };
  }
  if (!preliminaryComplete(r1, r2)) {
    const open = [...r1, ...r2].filter((m) => !isConfirmed(m)).length;
    const why =
      r2.length === 0
        ? 'The cut waits for round 2 to be drawn and confirmed.'
        : `The cut waits for round 2: ${plural(open, 'match is', 'matches are')} not confirmed.`;
    return {
      ...base,
      status: 'waiting',
      count: 'Waiting for round 2',
      nextAction: null,
      blockedReason: why,
    };
  }
  if (!data.seedingRows) {
    return {
      ...base,
      status: 'in_progress',
      count: 'Could not check ties',
      nextAction: { label: 'Open Standings', href: links.cut },
      blockedReason: null,
    };
  }
  const blocking = blockingGroups(seedingTieGroups(data.seedingRows));
  if (blocking.length > 0) {
    return {
      ...base,
      status: 'in_progress',
      count: `${plural(blocking.length, 'tie', 'ties')} at the cut to settle`,
      nextAction: { label: 'Settle ties', href: links.cut },
      blockedReason: null,
    };
  }
  return {
    ...base,
    status: 'in_progress',
    count: 'Top 8 ready',
    nextAction: { label: 'Lock the top 8', href: links.cut },
    blockedReason: null,
  };
}

function knockoutPhase(data, links) {
  const base = { id: 'knockout', label: 'Knockout' };
  const entries = data.bracket;
  if (entries.length === 0) {
    return {
      ...base,
      status: 'waiting',
      count: 'Bracket not made',
      progress: null,
      nextAction: null,
      blockedReason: 'The knockout waits for the cut.',
    };
  }
  const confirmedSlot = (entry) => entry.match?.status === 'confirmed';
  const parts = KNOCKOUT_ROUNDS.map((round) => {
    const slots = entries.filter((e) => e.slot.round === round);
    return slots.length === 0
      ? null
      : `${KNOCKOUT_SHORT[round]} ${slots.filter(confirmedSlot).length} of ${slots.length}`;
  }).filter(Boolean);
  const done = entries.filter(confirmedSlot).length;
  const active = entries.filter((e) => e.match?.status === 'scoring').length;
  const progress = { done, active, total: entries.length };
  const endEntries = entries.filter(
    (e) => e.slot.round === 'final' || e.slot.round === 'third_place',
  );
  const finished = endEntries.length > 0 && endEntries.every(confirmedSlot);
  let nextAction = null;
  if (!finished) {
    const scoring = entries.find((e) => e.match && e.match.status !== 'confirmed');
    const needsJudges = entries.find((e) => !e.match && e.slot.team1_id && e.slot.team2_id);
    if (scoring) {
      nextAction = { label: 'Score next', href: links.scoring(scoring.slot.match_id) };
    } else if (needsJudges) {
      nextAction = { label: 'Assign judges', href: links.bracket };
    } else {
      nextAction = { label: 'Open the bracket', href: links.bracket };
    }
  }
  return {
    ...base,
    status: finished ? 'done' : 'in_progress',
    count: parts.join(' · '),
    progress,
    nextAction,
    blockedReason: null,
  };
}

function podiumPhase(data, links) {
  const base = { id: 'podium', label: 'Podium', progress: null };
  const finalSlot = data.bracket.find((e) => e.slot.round === 'final');
  if (!finalSlot) {
    return {
      ...base,
      status: 'waiting',
      count: 'Not decided',
      nextAction: null,
      blockedReason: 'The podium waits for the knockout.',
    };
  }
  // The scores read failed: say so instead of claiming the podium is undecided (as the cut does for ties).
  if (data.bracketScores === null || data.bracketScores === undefined) {
    return {
      ...base,
      status: 'in_progress',
      count: 'Could not check the result',
      nextAction: { label: 'Open the bracket', href: links.bracket },
      blockedReason: null,
    };
  }
  const podium = derivePodium({
    entries: data.bracket,
    scores: data.bracketScores,
    teams: data.teams,
  });
  const decided = podium.places.filter((p) => p.state === 'decided');
  if (podium.complete) {
    return {
      ...base,
      status: 'done',
      count: podium.places.map((p) => `${p.label}: ${p.teamName}`).join(' · '),
      nextAction: null,
      blockedReason: null,
    };
  }
  if (podium.places.some((p) => p.state === 'tied')) {
    return {
      ...base,
      status: 'in_progress',
      count: 'A match is level on points',
      nextAction: { label: 'Record the winner', href: links.bracket },
      blockedReason: null,
    };
  }
  if (decided.length === 0) {
    return {
      ...base,
      status: 'waiting',
      count: 'Not decided',
      nextAction: null,
      blockedReason: 'The podium waits for the final and third place.',
    };
  }
  return {
    ...base,
    status: 'in_progress',
    count: decided.map((p) => `${p.label}: ${p.teamName}`).join(' · '),
    nextAction: { label: 'Show the podium', href: links.bracket },
    blockedReason: null,
  };
}

/**
 * Pure. The six phases of a BTC event.
 * @param {{
 *   eventId: string, teams: object[], judges: object[],
 *   matches: { match: object, judgeIds: string[] }[],
 *   bracket: { slot: object, match: object|null }[], bracketScores: object[]|null,
 *   seedingRows?: object[]|null
 * }} data what the dashboard read; `seedingRows` is null when that read failed
 */
export function deriveBtcPhases(data) {
  const links = btcLinks(data.eventId);
  const r1 = roundMatches(data.matches, (n) => n === 1);
  const r2 = roundMatches(data.matches, (n) => n >= 2);
  return [
    setupPhase(data, links),
    round1Phase(data, links, r1),
    round2Phase(links, r1, r2),
    cutPhase(data, links, r1, r2),
    knockoutPhase(data, links),
    podiumPhase(data, links),
  ].map((phase) => ({ progress: null, ...phase }));
}

/**
 * Pure. The warnings worth an organiser's attention, in the order they are listed (core/eventWarnings.js sorts
 * by severity): finish times missing, a judge from a team's own country, and confirms still queued on this
 * device. `withoutTimes` and `queuedConfirms` are null when their read failed. There is no "stuck in scoring"
 * warning on purpose (owner decision Q4).
 * @param {{
 *   eventId: string, teams: object[], judges: object[], matches: { match: object, judgeIds: string[] }[],
 *   withoutTimes: number|null, queuedConfirms: number|null
 * }} data
 */
export function deriveBtcWarnings(data) {
  const links = btcLinks(data.eventId);
  const warnings = [];
  if (data.withoutTimes === null) {
    warnings.push({
      id: 'times-unchecked',
      severity: 'info',
      text: 'Could not check whether every preliminary match has finish times.',
      href: links.matches,
      actionLabel: 'Open matches',
    });
  } else if (data.withoutTimes > 0) {
    warnings.push({
      id: 'times-missing',
      severity: 'warning',
      text: `${plural(data.withoutTimes, 'match has', 'matches have')} no finish times. A tie on points may need them.`,
      href: links.matches,
      actionLabel: 'Open matches',
    });
  }
  const conflicted = data.matches.filter(
    ({ match, judgeIds }) =>
      judgeCountryConflicts({
        judges: data.judges,
        teams: data.teams,
        team1Id: match.team1_id,
        team2Id: match.team2_id,
        judgeIds,
      }).length > 0,
  );
  if (conflicted.length > 0) {
    warnings.push({
      id: 'judge-country',
      severity: 'warning',
      text: `${plural(conflicted.length, 'match has', 'matches have')} a judge from the same country as a team.`,
      href: links.matches,
      actionLabel: 'Check judges',
    });
  }
  if (data.queuedConfirms > 0) {
    warnings.push({
      id: 'queued-confirms',
      severity: 'warning',
      text: `${plural(data.queuedConfirms, 'confirm is', 'confirms are')} saved on this device and not sent yet. They send when the connection is back.`,
      href: null,
      actionLabel: undefined,
    });
  }
  return warnings;
}

// Pure. The meta line under the heading: the knockout round the event is in, or the round being played.
export function currentPhaseLabel(phases) {
  const active = phases.find((p) => p.status === 'in_progress' || p.status === 'blocked');
  if (active) return active.label;
  if (phases.every((p) => p.status === 'done')) return 'Finished';
  return phases.find((p) => p.status !== 'done')?.label ?? '';
}

export { roundLabel };
