// Countdown engine (handoff §6, §8.2, §14 T2.4). Engine only: no setInterval,
// setTimeout, requestAnimationFrame, or DOM reference anywhere in this module —
// `started_at` + `duration_secs` are published once (§8.2), and every viewer
// (organiser, projector, phone) recomputes remaining time locally against its
// own clock. Purely a function of (startedAt, durationSecs, now) — nothing is
// cached or ticked, so two callers with the same inputs always agree, and a
// background/suspended gap self-corrects on the next call rather than drifting.
export function remainingSecs(startedAt, durationSecs, now) {
  const elapsedSecs = Math.floor((now - startedAt) / 1000);
  return Math.max(0, durationSecs - elapsedSecs);
}

export function isExpired(startedAt, durationSecs, now) {
  return remainingSecs(startedAt, durationSecs, now) <= 0;
}
