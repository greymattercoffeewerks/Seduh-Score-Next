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
  if (secs < 0) {
    // A negative input (clock skew between client and server — the tap path
    // computes this against a server-recorded started_at) floors to 0 for
    // the authoritative `elapsed`, but `raw` still preserves the true
    // unclamped value — this is the ONE place both bounds are enforced, so
    // a caller inspecting `raw` can always recover what was actually
    // measured, never a value this function already lost.
    return { elapsed: 0, raw: secs, maxed: false };
  }
  return { elapsed: secs, raw: secs, maxed: false };
}
