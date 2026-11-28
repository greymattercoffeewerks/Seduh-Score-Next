// The one "highlight" fact under a published result: the small line beside the competitor and round counts.
// Which fact it is depends on the format, because what matters differs: Cup Taster is decided partly on time, so it
// shows the winning time; a Throwdown knockout has no time or score worth showing, so it shows nothing; BTC can show
// the score between the two final teams. The choice is a lookup by the payload's `format` string, so a new format
// adds one line here and no format is imported (a payload is plain published data).
//
// Every value is checked before it is drawn: a payload is unvalidated jsonb, and an absent or non-numeric time
// used to print as "NaN:NaNNaN minutes NaN seconds".
import { formatDuration, formatDurationLong } from '../core/duration.js';

export function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const HIGHLIGHT_BY_FORMAT = Object.freeze({
  cup_taster: 'winning-time',
  throwdown: null,
  btc: 'final-score',
});

// A format this page does not know (or a legacy row with no format) keeps the old behaviour: the time, if it is a
// real number.
const DEFAULT_HIGHLIGHT = 'winning-time';

function scoreText(value) {
  const n = finiteNumber(value);
  return n == null ? null : String(Math.round(n * 100) / 100);
}

// Returns null (draw nothing) or { value, speakAs, label }: `value` is the visible text, `speakAs` the screen-reader
// expansion when it differs, `label` the words after it.
export function highlightFactFor(event) {
  const kind = Object.hasOwn(HIGHLIGHT_BY_FORMAT, event?.format)
    ? HIGHLIGHT_BY_FORMAT[event.format]
    : DEFAULT_HIGHLIGHT;

  if (kind === 'winning-time') {
    const secs = finiteNumber(event?.winningTimeSecs);
    if (secs == null) return null;
    return {
      value: formatDuration(secs),
      speakAs: formatDurationLong(secs),
      label: 'winning time',
    };
  }

  if (kind === 'final-score') {
    const finalists = Array.isArray(event?.finalScore) ? event.finalScore : [];
    const scores = finalists.map((f) => scoreText(f?.score));
    if (finalists.length !== 2 || scores.includes(null)) return null;
    return {
      value: `${scores[0]} – ${scores[1]}`,
      speakAs: `${scores[0]} to ${scores[1]}`,
      label: 'final score',
    };
  }

  return null;
}
