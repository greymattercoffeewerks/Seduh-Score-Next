// How an audience screen learns an organiser's brand (BRANDING-SPEC 4.3, task BR-E1). The screens are anonymous, so
// the brand comes through one narrow database door, `public_event_branding`, never a table read. Format-agnostic.
//
//   askBrandDoor(client, { orgId, eventId })   one question, one of four answers (below); never throws
//   createBrandSource({ client, orgId, onBrand })   asks once, asks again when the event changes and on a slow
//                                              timer, and tells `onBrand` only when the brand really changed
//
// THE RULE THAT SHAPES ALL OF THIS: branding never blocks or delays a screen. The screen is mounted unbranded and
// the brand arrives later, if it arrives at all. Every failure (no row, slow, error, an image that will not load, a
// lapsed tier, a door the database does not have yet) leaves the screen as it is and is only logged. Asking again
// after a failure never takes a brand AWAY: only the door saying "nothing is set" does that (a lapsed tier, a
// cleared brand), so a dropped connection mid-event does not strip an organiser's name off the projector.
//
// The published live payload is not involved (no brand in the snapshot), so the realtime path is untouched.
import { raceTimeout } from './timeout.js';
import { normaliseBrand } from './brandSlot.js';

export const BRAND_DOOR = 'public_event_branding';
// Short: the screen is already showing. A slow door is a failed door.
export const DOOR_TIMEOUT_MS = 4000;
// An organiser's edit reaches a running screen within this, with no reload.
export const REASK_MS = 10 * 60 * 1000;
export const LOGO_PRELOAD_TIMEOUT_MS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST says a function it does not have with PGRST202 (and a 404 over HTTP). That is "this database has no
// door yet" (a front end shipped ahead of its migration): quiet, and tried again on the slow timer, so a screen that
// was opened before the migration was pushed finds the door once it exists.
const isDoorAbsent = (error) =>
  error?.code === 'PGRST202' || error?.code === '42883' || error?.status === 404;

/**
 * Asks the door once. Answers, never throws:
 *   { status: 'brand', brand }   a usable brand (normalised: name, logo address, alt, accent)
 *   { status: 'none' }           the door answered and there is nothing to show (not entitled, nothing set)
 *   { status: 'absent' }         the database has no such door (yet)
 *   { status: 'invalid' }        the organisation id cannot be one, so nothing was asked (final)
 *   { status: 'error', error }   it could not be asked (offline, slow, a fault)
 * The event is optional; without one the door answers for the organisation alone.
 */
export async function askBrandDoor(client, { orgId, eventId = null, timeoutMs = DOOR_TIMEOUT_MS }) {
  // A value that cannot be an id is never sent.
  if (typeof orgId !== 'string' || !UUID.test(orgId)) return { status: 'invalid' };
  // Always both arguments, the event null when there is none: a call that leaves one out only matches a function
  // declared with a default for it, and "no such function" must never be the answer to a call that was merely
  // shaped differently from the declaration.
  const args = {
    p_org_id: orgId,
    p_event_id: typeof eventId === 'string' && UUID.test(eventId) ? eventId : null,
  };
  let response;
  try {
    response = await raceTimeout(client.rpc(BRAND_DOOR, args), timeoutMs);
  } catch (error) {
    return { status: 'error', error };
  }
  if (response?.error) {
    return isDoorAbsent(response.error)
      ? { status: 'absent' }
      : { status: 'error', error: response.error };
  }
  const data = response?.data;
  // A function that returns a table answers with a list; one that returns a single record with an object.
  const row = Array.isArray(data) ? data[0] : data;
  if (row === null || typeof row !== 'object') return { status: 'none' };
  // The same cleaning every brand gets (core/brandSlot.js): the door's answer is untrusted input.
  const brand = normaliseBrand({
    displayName: row.display_name,
    logoUrl: row.logo_url,
    logoAlt: row.logo_alt,
    accentHex: row.accent_hex,
  });
  return brand ? { status: 'brand', brand } : { status: 'none' };
}

// Loads the logo ahead of showing it, so it appears with the name and not after it. True when it loaded.
// Resolves false on an error or a timeout, never rejects. (No `Image` means no browser: nothing to wait for.)
export function preloadImage(url, timeoutMs = LOGO_PRELOAD_TIMEOUT_MS) {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const img = new Image();
    const done = (ok) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

/**
 * Keeps one screen's brand up to date. `onBrand(brand | null)` is called when the brand really changes (never with
 * the same brand twice in a row), with null meaning "show the screen unbranded". It is called outside any screen's
 * mount, so a throwing callback is logged and ignored.
 *
 * `setEventId(id)` is for the screen to say which event it is showing (the door may answer per event); it asks
 * again at once. Until a better answer arrives the current brand stays. `stop()` ends everything: no further
 * question, no further callback. A missing door is quiet and is asked again on the slow timer; an organisation id
 * that cannot be one ends the asking. The injected pieces (`preload`) exist for tests.
 */
export function createBrandSource({
  client,
  orgId,
  onBrand,
  reaskMs = REASK_MS,
  timeoutMs = DOOR_TIMEOUT_MS,
  preload = preloadImage,
}) {
  let eventId = null;
  let stopped = false;
  let started = false;
  let timer = null;
  // What was last handed to onBrand, as a comparable string; null for "unbranded". A brand shown without its logo
  // (it would not load) differs from the door's answer, which still has it, so every question tries the logo again;
  // and when the organiser then removes the logo, the answer equals what is shown and nothing is handed over twice.
  let shown = null;
  // One question at a time. A question wanted while one is in flight (the event became known) waits for it and
  // then asks again, so answers land in the order they were asked and an answer about an older event can never land
  // after a newer one. An answer to a question that named NO event is delivered even while a newer question waits,
  // so a brand is never held back for a second round trip; an answer about a SPECIFIC event that is no longer the
  // current one is dropped, and the question that is waiting delivers instead.
  let running = false;
  let again = false;

  function deliver(brand, key) {
    if (key === shown) return;
    shown = key;
    try {
      onBrand(brand);
    } catch (err) {
      console.error('brandDoor: a brand callback failed', err);
    }
  }

  async function ask() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await askOnce();
        } catch (err) {
          // Nothing in a question is meant to throw; if something does, the screen must not feel it.
          console.error('brandDoor: a brand question failed', err);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  }

  async function askOnce() {
    const asked = eventId;
    const outcome = await askBrandDoor(client, { orgId, eventId: asked, timeoutMs });
    if (stopped) return;
    if (outcome.status === 'invalid') {
      // There is no organisation to ask about: nothing will change by asking again.
      stopped = true;
      clearTimeout(timer);
      return;
    }
    // Quiet, and the slow timer asks again: the door may be added while this screen is up.
    if (outcome.status === 'absent') return;
    // The event moved on while this was in flight and the answer was about the old one: the question that is
    // waiting delivers instead (and a failure of that one leaves the screen as it is, not on the old event's brand).
    if (asked !== null && asked !== eventId) return;
    if (outcome.status === 'error') {
      // Keep what is on screen; the slow timer asks again.
      console.warn(
        'brandDoor: could not read the brand, keeping the screen as it is',
        outcome.error,
      );
      return;
    }
    if (outcome.status === 'none') {
      deliver(null, null);
      return;
    }
    const key = JSON.stringify(outcome.brand);
    if (key === shown) return;
    let brand = outcome.brand;
    if (brand.logoUrl && !(await preload(brand.logoUrl))) {
      // The image will not load: show the name and colour without it (or nothing, for a logo-only brand).
      brand = normaliseBrand({ ...brand, logoUrl: null });
    }
    if (stopped) return;
    // A logo-only brand whose new logo will not load has nothing left to show; that is a failure, and a failure
    // never takes down a brand that is already on screen.
    if (!brand && shown !== null) return;
    deliver(brand, brand ? JSON.stringify(brand) : null);
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => {
      ask().finally(schedule);
    }, reaskMs);
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      ask().finally(schedule);
    },
    setEventId(next) {
      const id = typeof next === 'string' ? next : null;
      if (id === eventId) return;
      eventId = id;
      if (started && !stopped) {
        ask().finally(schedule);
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
