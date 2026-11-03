// Throwdown's live-session payload and the publish that sends it. The audience surfaces read ONE live_sessions row per
// organisation, so every change the room should see ends in a publish (core/publishIntent.js: enqueue an intent
// first so an offline device still queues it, build the payload at flush time from fresh rows).
//
// `assembleThrowdownPayload` is PURE: it takes the derived bracket (formats/throwdown/bracket.js, the same module the
// organiser's screens use, so the room can never disagree with the console) and returns public text and numbers only.
// Public data: competitor names and the results. Vote counts appear only for a decided match (a live tally would
// show the room a result before it is confirmed). A walkover carries no counts, only its kind.
//
// Payload: { eventName, phase: 'setup' | 'live' | 'complete', competitors, rounds: [{ label, phase, matches:
// [{ id, sides: [{ name, votes, winner }], resultKind, decided }] }], nowPlaying: [match], recent: [match],
// champion: { name, runnerUp, thirdPlace } | null }
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import { publishIntentHandler, submitPublishIntent } from '../../core/publishIntent.js';
import { loadThrowdown } from './data.js';

export const THROWDOWN_LIVE_OPERATION = 'publish_throwdown_live_session';
const RECENT_LIMIT = 3;

function publicMatch(match) {
  const counts = match.resultKind === 'votes';
  return {
    id: match.id,
    decided: match.decided,
    resultKind: match.resultKind,
    sides: match.sides
      .filter((s) => s.entryId || !match.isBye)
      .map((s) => ({
        name: s.name,
        votes: counts ? s.votes : null,
        winner: s.winner,
      })),
  };
}

export function assembleThrowdownPayload({ event, bracket, activeCount }) {
  const rounds = bracket.rounds.map((round) => ({
    label: round.label,
    phase: round.phase,
    matches: round.matches.map(publicMatch),
  }));
  const allMatches = bracket.rounds.flatMap((r) => r.matches);
  const recent = allMatches
    .filter((m) => m.decided && m.resultKind !== 'bye')
    .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt) || (a.id < b.id ? 1 : -1))
    .slice(0, RECENT_LIMIT)
    .map(publicMatch);
  let phase = 'setup';
  if (bracket.started) phase = bracket.complete ? 'complete' : 'live';
  return {
    eventName: event?.name ?? null,
    phase,
    competitors: activeCount,
    rounds,
    nowPlaying: bracket.playableMatches.map(publicMatch),
    recent,
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
  return assembleThrowdownPayload({
    event,
    bracket: state.bracket,
    activeCount: state.entries.filter((e) => !e.withdrawn).length,
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
