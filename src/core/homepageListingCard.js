// "List this event on the Seduh Score homepage while it is live" (2026-10-29): the organiser's opt-in for the
// public landing page's live bar (supabase migration 20261029100000, events.list_on_homepage, default off).
// Format-agnostic: each format's event dashboard drops this card in unedited. The database decides who may
// set the flag (the same members who may edit the event); this only asks and reports. A test event is never
// listed, so the card says so instead of offering a checkbox that could not do anything.
import { el } from './dom.js';
import { describeError } from './errors.js';
import { getSupabase } from './supabaseClient.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export async function setEventHomepageListing(eventId, listed, client = getSupabase()) {
  const { data, error } = await client
    .from('events')
    .update({ list_on_homepage: listed })
    .eq('id', eventId)
    .select('list_on_homepage');
  if (error) throw error;
  // An update RLS hides touches no row and is not an error: say so instead of showing a lie.
  if (!Array.isArray(data) || data.length !== 1)
    throw new Error('not allowed to change this event');
  return data[0].list_on_homepage === true;
}

// The flag is read by the card itself, NOT through core/events.js's findEvent: that select feeds every organiser
// screen, and a column the cloud database does not have yet (the migration is pushed separately from the deploy)
// would break all of them. Here a failed read just hides the card.
export async function findEventHomepageListing(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('events')
    .select('list_on_homepage')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.list_on_homepage === true : null;
}

/**
 * Returns the card element at once; it fills in (or removes itself) once the flag has been read.
 * @param {{ id: string, is_test: boolean }} event
 * @param {{ client?: object, load?: (eventId: string) => Promise<boolean|null>,
 *           save?: (eventId: string, listed: boolean) => Promise<boolean> }} [options]
 */
export function buildHomepageListingCard(event, { client, load, save } = {}) {
  const heading = el('h2', { className: 'homepage-listing-heading', text: 'Seduh Score homepage' });
  if (event.is_test) {
    return el('div', { className: 'card homepage-listing-card' }, [
      heading,
      el('p', {
        text: 'Test events are never listed on the Seduh Score homepage.',
      }),
    ]);
  }
  const write = save ?? ((eventId, listed) => setEventHomepageListing(eventId, listed, client));
  const read = load ?? ((eventId) => findEventHomepageListing(eventId, client));
  const input = el('input', {
    attrs: { type: 'checkbox', 'data-field': 'listOnHomepage', 'aria-disabled': 'true' },
  });
  // `aria-disabled`, never `disabled`: a disabled control drops keyboard focus to the page body, and the person
  // who just pressed Space would have to find their place again.
  let busy = true;
  let stored = false;
  const setBusy = (value) => {
    busy = value;
    input.setAttribute('aria-disabled', String(value));
  };
  const status = el('p', {
    className: 'homepage-listing-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const slow = 'This is taking longer than expected — check your connection and try again.';
  input.addEventListener('change', async () => {
    if (busy) {
      input.checked = stored;
      return;
    }
    const wanted = input.checked;
    setBusy(true);
    status.textContent = 'Saving…';
    try {
      stored = await raceTimeout(write(event.id, wanted), DEFAULT_LOAD_TIMEOUT_MS);
      input.checked = stored;
      status.textContent = stored
        ? 'Listed: shown on the homepage only while this event is live.'
        : 'Not listed.';
    } catch (err) {
      input.checked = stored;
      status.textContent = `Could not save that. ${err.timedOut ? slow : describeError(err)}`;
    }
    setBusy(false);
  });
  const card = el('div', { className: 'card homepage-listing-card' }, [
    heading,
    el('label', { className: 'checkbox-field tap-target' }, [
      input,
      el('span', { text: 'List this event on the Seduh Score homepage while it is live' }),
    ]),
    el('p', {
      className: 'homepage-listing-hint',
      text:
        'Off by default. When on, anyone visiting the homepage sees the event name and your ' +
        'organisation name with a link to the live view, only while the event is running.',
    }),
    status,
  ]);
  raceTimeout(read(event.id), DEFAULT_LOAD_TIMEOUT_MS).then(
    (listed) => {
      if (listed === null) return card.remove();
      stored = listed;
      input.checked = listed;
      setBusy(false);
    },
    (err) => {
      // A slow answer says so (the setting may exist); any other failure (a database without the column yet, no
      // such event) hides the card, since there is nothing to offer.
      if (err?.timedOut) status.textContent = `Could not load this setting. ${slow}`;
      else card.remove();
    },
  );
  return card;
}
