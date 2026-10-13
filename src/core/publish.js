import { getSupabase } from './supabaseClient.js';
import { findEvent } from './events.js';
import { raceTimeout } from './timeout.js';

// `live_sessions` permits at most one active row per org, so looking up its
// event is format-agnostic. Moved here from Cup Taster's dashboard in 2026-09-05
// so every format can reuse the query without coupling to another format.
export async function findActiveLiveEventId(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('live_sessions')
    .select('event_id')
    .eq('org_id', orgId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data?.event_id ?? null;
}

// Whether starting or confirming something in `eventId` would take the venue screens away from ANOTHER event
// of the same organisation, and if so which one. An organisation has one live session at a time, and the
// first heat started or match confirmed in an event publishes it and replaces whatever was on the screens
// (publish_session); nothing asked the organiser first. Null means "nothing to warn about": this event is
// already the live one, nothing is live, or the check could not be made. It fails OPEN on purpose: it runs
// on the timing and scoring screens, which must work offline, so an unreachable database never blocks a
// start; the worst case is today's behaviour (no warning). Returns { eventId, name, isTest } of the live event.
//
// It is also time-boxed: a request that hangs (a captive portal, a half-open connection) must not hold up
// "Start heat" or a scoring screen's load for an optional hint, so after LIVE_CHECK_TIMEOUT_MS it gives up
// and answers null.
export const LIVE_CHECK_TIMEOUT_MS = 2500;

async function lookUpLiveEvent(orgId, eventId, client) {
  const liveEventId = await findActiveLiveEventId(orgId, client);
  if (!liveEventId || liveEventId === eventId) return null;
  const live = await findEvent(liveEventId, client);
  return { eventId: liveEventId, name: live.name ?? '', isTest: live.is_test === true };
}

export async function findLiveElsewhere(orgId, eventId, client = getSupabase()) {
  try {
    return await raceTimeout(lookUpLiveEvent(orgId, eventId, client), LIVE_CHECK_TIMEOUT_MS);
  } catch (error) {
    // Logged, not silent: a bug here would otherwise just switch the guard off without a trace.
    console.warn(
      'findLiveElsewhere: could not check what is on the venue screens',
      error?.message ?? error,
    );
    return null;
  }
}

// What to tell the organiser, for a thing that is about to put THIS event on the venue screens. A test event
// replacing a real one is the case that matters most (a rehearsal taking over mid-event), so it is said first
// and plainly. `thisEvent` is { name, isTest }; `live` is findLiveElsewhere's answer.
export function takeOverWarning(thisEvent, live) {
  const named = live.name ? `“${live.name}”` : null;
  if (thisEvent.isTest && !live.isTest) {
    return `This is a test event, and ${named ?? 'another event'} is on the venue screens. Continuing will replace it with this test event.`;
  }
  return `${named ?? 'Another event'} is on the venue screens. Continuing will put this event there instead.`;
}
