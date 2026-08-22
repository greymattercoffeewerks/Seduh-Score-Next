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
