export const SEDUH_SCORE_CONTACT = 'Contact the Seduh Score team for help.';

const GATING_HINTS = new Set(['entitlement_required', 'entitlement_cap_reached']);

const GATING_MESSAGES = {
  cup_taster_participants: `This event has reached its entry limit. Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
  events_open: `You already have an open event. Finish it first, then try again. Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
  btc_format: `This format needs a plan that includes it. Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
};

// The database owns both the refusal and its stable vocabulary. Only its two gating hints opt into this
// organiser copy; every other 42501 remains the ordinary generic error rather than being mistaken for a plan issue.
export function describeGatingError(error) {
  const hint = error?.hint;
  if (error?.code !== '42501' || !GATING_HINTS.has(hint)) return null;
  const detail = error?.details ?? error?.detail;
  const key = typeof detail === 'string' ? detail.trim() : null;
  return {
    hint,
    key,
    message:
      GATING_MESSAGES[key] ??
      `This action is not available with this plan. Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
  };
}

// Distinguishes a module's own descriptive thrown errors (plain `Error`s
// with a human-readable message, e.g. "heat 2 already exists with a
// different configuration") from whatever a raw Supabase/Postgrest failure
// looks like (carries a `.code`) — only the former is safe to show a user
// verbatim. Format-agnostic: every screen's action handlers should route a
// caught error through this before writing it into a feedback panel, rather
// than piping `err.message` straight through.
export function describeError(err) {
  const gating = describeGatingError(err);
  if (gating) return gating.message;
  if (err instanceof Error && !err.code) return err.message;
  return 'Something went wrong saving that — try again.';
}

// Postgres unique-violation — a raw error code, not Cup-Taster vocabulary,
// so it belongs here rather than in a format module. Originally defined in
// formats/cup-taster/setup.js and reused (imported) by heats.js's own
// race-recovery; hoisted here once core/registry.js needed the same
// check-then-recover pattern for registerEntry, since core/ can't import
// from formats/ (handoff §6).
export const UNIQUE_VIOLATION = '23505';

// PostgREST's "JSON object requested, multiple (or no) rows returned" — what
// a `.single()` read gets when the row it asked for doesn't exist (or isn't
// visible). Raw PostgREST vocabulary, same reasoning as UNIQUE_VIOLATION:
// formats/cup-taster/liveSession.js uses it to tell "the stage/event this
// publish describes is gone" apart from a failure worth retrying.
export const ROW_NOT_FOUND = 'PGRST116';
