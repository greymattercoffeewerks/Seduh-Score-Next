// Pure M:SS formatting for any duration in seconds — used both for a live
// countdown's remaining time (formats/cup-taster/timingScreen.js) and a
// cupper's recorded elapsed time (formats/cup-taster/timingManualScreen.js),
// so it lives here rather than in either screen, on its 2nd verbatim use
// (handoff §6).
export function formatDuration(totalSecs) {
  const clamped = Math.max(0, totalSecs);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// A screen-reader-friendly expansion of the same value formatDuration()
// renders visibly — "2 minutes 0 seconds," not "2:00" (found in review,
// ui-accessibility-reviewer: a bare colon-separated numeral in a static
// table cell, unlike the live countdown elsewhere in this app, isn't
// shielded by an aria-live="off" region + a separate one-shot plain-
// language announcement, so it's read verbatim by assistive tech — and
// colon-separated numerals are a known ambiguous case for TTS engines,
// inconsistently vocalized as a clock time, a ratio, or a duration).
// Callers pair this with the visible formatDuration() text via a visually-
// hidden (.sr-only) span, matching this codebase's own established "text-
// carried, not [visual-format]-alone" convention (viewerBody.js's cupper-
// status suffixes are the precedent) rather than a `title` attribute, which
// has patchy screen-reader support on non-interactive elements like `<td>`.
export function formatDurationLong(totalSecs) {
  const clamped = Math.max(0, totalSecs);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const minuteWord = minutes === 1 ? 'minute' : 'minutes';
  const secondWord = seconds === 1 ? 'second' : 'seconds';
  return `${minutes} ${minuteWord} ${seconds} ${secondWord}`;
}
