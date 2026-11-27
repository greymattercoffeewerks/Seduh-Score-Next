// The content of the results story card (core/resultsStoryCard.js draws it): pure, built only from a PUBLISHED
// result's payload, so the card says nothing the Results page does not already say. The payload is unvalidated jsonb
// (publicResults.js), so every field is read defensively and a result with no winner makes no card.

export const RESULTS_ADDRESS = 'seduhscore.com/results';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The venue line: the venue and the city, once each (a venue that already names the city is not repeated). */
export function venueLine(event) {
  const venue = text(event?.venue);
  const city = text(event?.city);
  if (venue && city && !venue.toLowerCase().includes(city.toLowerCase()))
    return `${venue}, ${city}`;
  return venue || city;
}

/** True when the event has a named winner to put on a card. */
export function canMakeResultsCard(event) {
  const winner = Array.isArray(event?.podium) ? event.podium[0] : null;
  return Boolean(text(event?.eventName) && text(winner?.name));
}

/**
 * @param {object} event  a published payload
 * @param {{ formatLabel: (format: string) => string, formatDate: (iso: string) => string }} words
 * @returns {object|null} a spec for `drawResultsStoryCard`, or null when there is no card to make
 */
export function resultsStorySpec(event, { formatLabel, formatDate }) {
  if (!canMakeResultsCard(event)) return null;
  const [winner, ...rest] = event.podium;
  const venue = venueLine(event);
  return {
    eyebrow: `${formatLabel(event.format)} · Final result`,
    title: text(event.eventName),
    winner: { name: text(winner.name), detail: text(winner.cafe) || undefined },
    places: rest
      .filter((entry) => text(entry?.name))
      .map((entry) => ({
        place: entry.rank,
        name: text(entry.name),
        detail: text(entry.cafe) || undefined,
      })),
    venue: venue || undefined,
    // Only a city is a place, not a named venue.
    venueLabel: text(event.venue) ? 'Venue' : 'Location',
    date: event.eventDate ? formatDate(event.eventDate) : undefined,
    address: RESULTS_ADDRESS,
  };
}

/** A file name that is safe on every system: lower-case words of the event name. */
export function resultsStoryFilename(event) {
  const slug = text(event?.eventName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `seduh-score-${slug || 'results'}-story.png`;
}
