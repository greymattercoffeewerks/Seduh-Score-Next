// The Per-event window, as the UI shows it (gating spec 6b, D-G15). UX only: the database decides what is locked
// (restrictive row-level security on every event-scoped table, migration 20261023140000); this module turns the
// `window` object that public.my_entitlements returns for an event into words, and decides nothing the database
// would not also refuse. With no window object (no Per-event plan, the key switched off, an older database) nothing
// is shown and the screen behaves as it always has.
import { loadEntitlements } from './entitlements.js';
import { raceTimeout } from './timeout.js';

// How long before the end the organiser is warned.
export const WINDOW_WARNING_HOURS = 48;
// How long the console waits for the answer before opening the screen without it (fail-open for the UI).
export const WINDOW_LOOKUP_TIMEOUT_MS = 2500;
const BRUNEI_TZ = 'Asia/Brunei';

// 'none' (no window), 'open' (ends later than the warning period), 'ending' (inside the warning period), 'locked'.
// `locked` is the database's own answer (it is false while the key is switched off); a window that has passed its
// end while the database says it is not locked (the key is off) is simply 'open' with nothing to show.
export function windowStateOf(snapshot, now = Date.now()) {
  const win = snapshot?.window;
  if (!win || typeof win !== 'object') return { kind: 'none', endsAt: null };
  const endsAt = win.ends_at ? new Date(win.ends_at) : null;
  if (endsAt && Number.isNaN(endsAt.getTime())) return { kind: 'none', endsAt: null };
  if (win.locked === true) return { kind: 'locked', endsAt };
  // The key is switched off: nothing will close, so nothing is announced.
  if (win.enforced !== true) return { kind: 'open', endsAt };
  if (!endsAt) return { kind: 'none', endsAt: null };
  const msLeft = endsAt.getTime() - now;
  if (msLeft > 0 && msLeft <= WINDOW_WARNING_HOURS * 3600 * 1000) return { kind: 'ending', endsAt };
  return { kind: 'open', endsAt };
}

function brunei(date, options) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: BRUNEI_TZ, ...options }).format(date);
}

// "the end of 13 November 2026" for a window that ends at midnight Brunei time (the usual case: 00:00 on the day
// after the fifth day), else "13 November 2026 at 18:30". Always in Brunei time, the zone the window is counted in.
export function describeWindowEnd(endsAt) {
  const midnight =
    brunei(endsAt, { hour: '2-digit', minute: '2-digit', hour12: false }) === '24:00' ||
    brunei(endsAt, { hour: '2-digit', minute: '2-digit', hour12: false }) === '00:00';
  const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  if (midnight) {
    return `the end of ${brunei(new Date(endsAt.getTime() - 1000), dateOptions)}`;
  }
  return `${brunei(endsAt, dateOptions)} at ${brunei(endsAt, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

// The sentence for the notice shown while the window is about to end; null when there is nothing to say.
export function windowWarningText(state) {
  if (state?.kind !== 'ending' || !state.endsAt) return null;
  // Short on purpose: the notice overlays the top of the screen, and on a 360px phone every line hides more of it.
  return (
    `This event's Per-event plan ends at ${describeWindowEnd(state.endsAt)} (Brunei time); after that its screens close. ` +
    'Ask Grey Matter Coffee Werks to extend it.'
  );
}

export const WINDOW_LOCKED_HEADING = "This event's Per-event plan has ended";

export function windowLockedText(state) {
  const ended = state?.endsAt
    ? ` It ended at ${describeWindowEnd(state.endsAt)} (Brunei time).`
    : '';
  return (
    'The setup, roster, scoring and live screens for this event are closed.' +
    ended +
    ' Results that were published stay on the public results page.'
  );
}

// A moment's memory per organisation and event, so moving between an event's screens does not ask again each time (on bad
// venue wifi every question can cost the full timeout). Short on purpose: a lock or an extension shows within the minute.
export const WINDOW_CACHE_MS = 30000;
const windowCache = new Map();

// Asks the database for the event's window. Resolves to a state, or to { kind: 'none' } when the answer cannot be
// had in time: a plan problem must never keep an organiser out of a screen, and the database refuses what it must.
// A failed or timed-out answer is not remembered.
export async function loadWindowState(
  orgId,
  eventId,
  client,
  { now = Date.now(), timeoutMs = WINDOW_LOOKUP_TIMEOUT_MS, cache = windowCache } = {},
) {
  const key = `${orgId}:${eventId}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < WINDOW_CACHE_MS) return windowStateOf(hit.snapshot, now);
  try {
    const snapshot = await raceTimeout(loadEntitlements(orgId, eventId, client), timeoutMs);
    if (snapshot) cache.set(key, { snapshot, at: now });
    return windowStateOf(snapshot, now);
  } catch {
    return { kind: 'none', endsAt: null };
  }
}
