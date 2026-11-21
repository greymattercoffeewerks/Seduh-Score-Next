// Throwdown's live-session payload and the publish that sends it. The audience surfaces read ONE live_sessions row per
// organisation, so every change the room should see ends in a publish (core/publishIntent.js: enqueue an intent
// first so an offline device still queues it, build the payload at flush time from fresh rows).
//
// `assembleThrowdownPayload` is PURE: it takes the derived bracket (formats/throwdown/bracket.js, the same module the
// organiser's screens use, so the room can never disagree with the console) and returns public text and numbers only.
// Public data: competitor names and the results. Vote counts appear only for a decided match (a live tally would
// show the room a result before it is confirmed). A walkover carries no counts, only its kind.
//
// Payload: { eventName, phase: 'setup' | 'live' | 'complete', competitors, competitorNames: [name], judgedRounds,
// rounds: [{ id, label, roundLabel, phase, matches: [{ id, number, sides: [{ name, votes, winner }], resultKind,
// decided, judging? }] }], nowPlaying: [match], upNext: match | null, thenNext: match | null (the first two undecided
// playable matches in BRACKET order, each with roundLabel / roundPhase / roundSize / role / number and, per side, the
// `route` that brought the competitor there), recent: [match + roundLabel, roundPhase, role, confirmedAt],
// stillIn: { of, names: [{ name, next? }] } | null, champion: { name, runnerUp, thirdPlace } | null }
// `roundLabel` is the projector's wording ("Round of 16"); `label` is the older console and phone wording ("Round 1").
// Nothing here is a score, a total, a judge count or the deciding rule of a scoresheet match (D8).
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import { publishIntentHandler, submitPublishIntent } from '../../core/publishIntent.js';
import { loadThrowdown } from './data.js';
import { roundRole, scoredCups } from './roundRole.js';

export const THROWDOWN_LIVE_OPERATION = 'publish_throwdown_live_session';
const RECENT_LIMIT = 3;

// A match decided by scoresheets is public as its winner only: while it is being judged it says so (`judging`), and once
// decided it carries the winner flag and nothing else. No points, totals, judge counts or rule ever enter this payload.
function publicMatch(match, scoresheet, number) {
  const counts = match.resultKind === 'votes';
  const judging =
    !match.decided && scoredCups(scoresheet, match.roundPhase, match.roundSize) !== null;
  return {
    id: match.id,
    number,
    decided: match.decided,
    resultKind: match.resultKind,
    ...(judging ? { judging: true } : {}),
    sides: match.sides
      .filter((s) => s.entryId || !match.isBye)
      .map((s) => ({
        name: s.name,
        votes: counts ? s.votes : null,
        winner: s.winner,
      })),
  };
}

// The projector's name for a round: the structure that exists, as "Round of 16" (the console's "Round 1" means
// nothing to a room that has not seen the plan).
function projectorRoundLabel(round) {
  if (round.phase !== 'main') return round.label;
  const n = round.matches.length;
  return n === 1 || n === 2 || n === 4 ? round.label : `Round of ${n * 2}`;
}

// "R16", "quarter-final": how a competitor's route names the round they came from.
function shortRound(label) {
  const of = /^Round of (\d+)$/.exec(label);
  if (of) return `R${of[1]}`;
  if (label === 'Quarter-finals') return 'quarter-final';
  if (label === 'Semi-finals') return 'semi-final';
  return label.toLowerCase();
}

// Where a competitor came from: the nearest earlier round they played in ("Won R32 match 4", "Lost semi-final match
// 2" for the 3rd place match, "Bye in R16 match 3"). Null in round 1, or when that match is not decided.
function routeFor(entryId, round, bracketRounds, labels) {
  if (!entryId) return null;
  const earlier = bracketRounds
    .filter((r) => r.position < round.position)
    .sort((a, b) => b.position - a.position);
  for (const r of earlier) {
    const index = r.matches.findIndex((m) => m.sides.some((s) => s.entryId === entryId));
    if (index < 0) continue;
    const match = r.matches[index];
    if (!match.decided) return null;
    const place = `${shortRound(labels.get(r.id))} match ${index + 1}`;
    if (match.resultKind === 'bye') return `Bye in ${place}`;
    return `${match.sides.find((s) => s.entryId === entryId)?.winner ? 'Won' : 'Lost'} ${place}`;
  }
  return null;
}

// Who is still in the title race: in the earliest main round with an undecided match, the winners so far plus both
// sides of every match not yet played. Null when no round is under way, or when nobody is out yet.
function stillInOf(bracket, upNextEntryIds) {
  const main = bracket.rounds.filter((r) => r.phase === 'main');
  const current = main.find((r) => r.matches.some((m) => !m.decided));
  if (!current) return null;
  const of = new Set(main[0].matches.flatMap((m) => m.sides.map((s) => s.entryId).filter(Boolean)))
    .size;
  const names = current.matches
    .flatMap((m) => m.sides.filter((s) => s.entryId && (m.decided ? s.winner : true)))
    .map((s) => ({ name: s.name, ...(upNextEntryIds.has(s.entryId) ? { next: true } : {}) }));
  if (names.length === 0 || names.length >= of) return null;
  return { of, names };
}

// Whether any round is decided by scoresheets (a yes or no only: how many cups, judges or lines never leave).
function usesJudgedRounds(scoresheet) {
  return Object.values(scoresheet?.cups ?? {}).some((n) => Number.isInteger(n));
}

export function assembleThrowdownPayload({
  event,
  bracket,
  activeCount,
  scoresheet = null,
  competitorNames = [],
}) {
  const labels = new Map(bracket.rounds.map((r) => [r.id, projectorRoundLabel(r)]));
  const where = new Map(); // match id -> { round, number }
  const rounds = bracket.rounds.map((round) => ({
    id: round.id,
    label: round.label,
    roundLabel: labels.get(round.id),
    phase: round.phase,
    matches: round.matches.map((m, index) => {
      where.set(m.id, { round, number: index + 1 });
      return publicMatch(m, scoresheet, index + 1);
    }),
  }));
  const withRound = (m, { routes = false } = {}) => {
    const { round, number } = where.get(m.id);
    const base = publicMatch(m, scoresheet, number);
    const shown = m.sides.filter((s) => s.entryId || !m.isBye);
    return {
      ...base,
      roundLabel: labels.get(round.id),
      roundPhase: round.phase,
      roundSize: round.matches.length,
      role: roundRole(round.phase, round.matches.length),
      confirmedAt: m.confirmedAt ?? null,
      ...(routes
        ? {
            sides: base.sides.map((side, i) => ({
              ...side,
              route: routeFor(shown[i]?.entryId, round, bracket.rounds, labels),
            })),
          }
        : {}),
    };
  };
  const allMatches = bracket.rounds.flatMap((r) => r.matches);
  const recent = allMatches
    .filter((m) => m.decided && m.resultKind !== 'bye')
    .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt) || (a.id < b.id ? 1 : -1))
    .slice(0, RECENT_LIMIT)
    .map((m) => withRound(m));
  const [first, second] = bracket.playableMatches;
  let phase = 'setup';
  if (bracket.started) phase = bracket.complete ? 'complete' : 'live';
  return {
    eventName: event?.name ?? null,
    phase,
    competitors: activeCount,
    competitorNames,
    judgedRounds: usesJudgedRounds(scoresheet),
    rounds,
    nowPlaying: bracket.playableMatches.map((m) =>
      publicMatch(m, scoresheet, where.get(m.id).number),
    ),
    upNext: first ? withRound(first, { routes: true }) : null,
    thenNext: second ? withRound(second, { routes: true }) : null,
    recent,
    stillIn: stillInOf(bracket, new Set(first ? first.sides.map((s) => s.entryId) : [])),
    champion: bracket.champion
      ? { name: bracket.champion, runnerUp: bracket.runnerUp, thirdPlace: bracket.thirdPlace }
      : null,
  };
}

async function buildThrowdownLivePayload(eventId, client = getSupabase()) {
  const [event, state] = await Promise.all([
    findEvent(eventId, client),
    loadThrowdown(eventId, client),
  ]);
  const active = state.entries.filter((e) => !e.withdrawn);
  return assembleThrowdownPayload({
    event,
    bracket: state.bracket,
    activeCount: active.length,
    scoresheet: state.settings.modules?.scoresheet ?? null,
    competitorNames: active.map((e) => e.display_name),
  });
}

async function buildPayloadForIntent({ orgId, eventId, onlyIfLive }, client) {
  if (onlyIfLive && (await findActiveLiveEventId(orgId, client)) !== eventId) return null;
  return buildThrowdownLivePayload(eventId, client);
}

export function publishThrowdownLiveSessionHandlers(client) {
  return {
    [THROWDOWN_LIVE_OPERATION]: publishIntentHandler(client, (intent) =>
      buildPayloadForIntent(intent, client),
    ),
  };
}

// `takeOver: true` is for what is running the event (a result, the draw): it makes this event the organisation's
// live session. Anything else republishes only if this event is already live.
function intentFor(event, takeOver) {
  if (typeof event?.is_test !== 'boolean') {
    throw new TypeError('Throwdown live publish: the event must carry an explicit boolean is_test');
  }
  return {
    orgId: event.org_id,
    eventId: event.id,
    format: 'throwdown',
    isTest: event.is_test,
    onlyIfLive: takeOver !== true,
  };
}

export async function publishThrowdownLive({ event, takeOver }, handlers) {
  const intent = intentFor(event, takeOver);
  if (!handlers) {
    throw new TypeError('publishThrowdownLive: the composed outbox handler map is required');
  }
  try {
    await submitPublishIntent(THROWDOWN_LIVE_OPERATION, intent, handlers);
  } catch (error) {
    console.error('throwdown liveSession: live-view publish failed (may still be queued)', error);
  }
}
