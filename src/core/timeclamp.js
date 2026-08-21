// The sole duration cap (handoff §5.2, §6, §14 T2.5). Both the tap path and the
// manual-entry path call this — never a second cap, never a database CHECK
// standing in for it (the cap depends on ct_heats.duration_secs, a different
// table than ct_heat_entries.elapsed_secs, which a CHECK constraint can't
// reference). Enforced by the no-raw-elapsed-write ESLint rule: elapsed_secs may
// only be written from a clampElapsed() call or a `.elapsed` read off its result.
export function clampElapsed(secs, durationSecs) {
  if (secs >= durationSecs) {
    return { elapsed: durationSecs, raw: secs, maxed: true };
  }
  return { elapsed: secs, raw: secs, maxed: false };
}
