// Distinguishes a module's own descriptive thrown errors (plain `Error`s
// with a human-readable message, e.g. "heat 2 already exists with a
// different configuration") from whatever a raw Supabase/Postgrest failure
// looks like (carries a `.code`) — only the former is safe to show a user
// verbatim. Format-agnostic: every screen's action handlers should route a
// caught error through this before writing it into a feedback panel, rather
// than piping `err.message` straight through.
export function describeError(err) {
  if (err instanceof Error && !err.code) return err.message;
  return 'Something went wrong saving that — try again.';
}
