// The status band an organiser or audience surface shows when an event is not a plain real one (D9): the TEST
// band for `is_test` and the beta band for `is_shadow`. One place decides which band an event gets, so a format
// never re-derives it. Format-agnostic: it reads two booleans on the event and names no format.
//
//  - TEST (`is_test`): the violet stripe that has always been there (`.is-test-banner`, base.css), unchanged.
//    `--color-test` is reserved for it (D9).
//  - Beta (`is_shadow`): a graphite bar with a 4px amber bottom edge and a small hazard stripe, in words
//    "Seduh Score ABTC Beta Test" plus one plain line saying the paper scores are the official result. NEVER
//    violet. `is_shadow` is not in the database yet: no flag, no band (a missing or non-true flag is "not a
//    shadow run", never an error).
//  - An event is never both. If a row somehow has both flags, the TEST band wins (test data is the more
//    dangerous thing to mistake for real) and the beta band is not drawn beside it.
//
// The wording is the constants below, so changing it later is a one-line edit.
// Styled in src/ui/tokens/components.css (`.ok-beta-band`) and base.css (`.is-test-banner`).
import { el } from './dom.js';

export const BETA_BAND_TITLE = 'Seduh Score ABTC Beta Test';
export const BETA_BAND_NOTE = "Shadow run. The committee's paper scores are the official result.";
export const TEST_BAND_TEXT = 'Test Data — Not a Live Event';

// Pure. Which band an event gets: 'test', 'beta' or null.
export function bandKind(event) {
  if (event?.is_test === true) return 'test';
  if (event?.is_shadow === true) return 'beta';
  return null;
}

// Pure. What the band says: { kind, title, note } (`note` is null for the TEST band, which has one line), or
// null when the event gets no band.
export function describeBand(event, words = {}) {
  const kind = bandKind(event);
  if (kind === 'test') return { kind, title: TEST_BAND_TEXT, note: null };
  if (kind === 'beta') {
    // The default wording is the constants above; a format or caller may pass its own (`words.title`,
    // `words.note`), so a second format never has to say "ABTC" or "the committee".
    const title =
      typeof words?.title === 'string' && words.title.trim() ? words.title : BETA_BAND_TITLE;
    const note = typeof words?.note === 'string' && words.note.trim() ? words.note : BETA_BAND_NOTE;
    return { kind, title, note };
  }
  return null;
}

// DOM. The band element for an event, or null when it needs none. Persistent and not dismissible: the caller
// puts it at the top of the page and redraws it with the event.
export function renderStatusBand(event, words = {}) {
  const band = describeBand(event, words);
  if (!band) return null;
  if (band.kind === 'test') {
    // Exactly the element every screen drew before this module existed.
    return el('div', { className: 'is-test-banner', text: band.title });
  }
  return el('div', { className: 'ok-beta-band', attrs: { role: 'note', 'data-band': 'beta' } }, [
    el('span', { className: 'ok-beta-band-hazard', attrs: { 'aria-hidden': 'true' } }),
    el('div', { className: 'ok-beta-band-text' }, [
      el('p', { className: 'ok-beta-band-title', text: band.title }),
      el('p', { className: 'ok-beta-band-note', text: band.note }),
    ]),
  ]);
}
