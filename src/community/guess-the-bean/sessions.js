// Guess the Bean — session data layer (Phase 3, session management).
// Thin Supabase wrappers, same shape as core/events.js's own module —
// nothing here knows about DOM. RLS (supabase/migrations/20260914121000_
// guess_the_bean_rls.sql, 20260914131000_guess_the_bean_session_lifecycle.sql)
// is what actually enforces "own sessions only," not this file; every
// function here is a thin pass-through, same "the DB is the enforcement,
// this is just plumbing" shape as core/events.js's own comment.
import { getSupabase } from '../../core/supabaseClient.js';

export async function createSession({ creatorId, name, beanCount }, client = getSupabase()) {
  const { data, error } = await client
    .from('sessions')
    .insert({ creator_id: creatorId, name, bean_count: beanCount })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Newest first — RLS (sessions_select_own) already scopes this to the
// caller's own sessions; no explicit .eq('creator_id', ...) needed, same as
// core/events.js's own listEventsForOrg relying on RLS for org scoping.
export async function listMySessions(client = getSupabase()) {
  const { data, error } = await client
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateSession(sessionId, patch, client = getSupabase()) {
  const { data, error } = await client
    .from('sessions')
    .update(patch)
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Danger zone: "Reset Data" — clears every guess (contacts cascade with
// them) and resets `revealed`, but leaves the session itself and its
// guess_enabled setting untouched. A SECURITY DEFINER RPC, not a plain
// client-side delete — guesses/contacts are locked to "never deletable
// except service role" at the RLS level (the spec's own checklist); see
// that migration's own comment for the full reasoning.
export async function resetSessionData(sessionId, client = getSupabase()) {
  const { error } = await client.rpc('reset_guess_session_data', {
    p_session_id: sessionId,
  });
  if (error) throw error;
}

// Danger zone: "End Session" — a plain delete works here (unlike guesses/
// contacts) because sessions_delete (creator-only) exists precisely so this
// doesn't need its own RPC; guesses/contacts cascade automatically via their
// own pre-existing on-delete-cascade FKs.
export async function endSession(sessionId, client = getSupabase()) {
  const { error } = await client.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// The participant entry URL a QR code / shared link points at. Phase 4
// builds the page this actually resolves to (guess-the-bean/play/); the
// query-param shape (?session=<uuid>) matches legacy's own
// booth/guess/index.html convention (github.com/greymattercoffee/Seduh-Score,
// dev branch) — same URL scheme, ported forward rather than reinvented.
export function buildParticipantUrl(sessionId, origin = window.location.origin) {
  return `${origin}/guess-the-bean/play/?session=${encodeURIComponent(sessionId)}`;
}

// The stage/display audience has its own Vite entry, just as the participant
// form does. Orientation is intentionally not a URL parameter: the display
// reads the organiser-configured session.orientation value.
export function buildDisplayUrl(sessionId, origin = window.location.origin) {
  return `${origin}/guess-the-bean/display/?session=${encodeURIComponent(sessionId)}`;
}

// Export: the creator's own guesses+contacts for one session, rejoined by
// guess id — same shape as legacy's own onExportData, which this ports.
// Read-only; RLS already lets the creator see both tables for their own
// session (guesses_select/contacts_select), so no RPC is needed here, unlike
// the danger-zone actions above.
export async function fetchSessionExport(sessionId, client = getSupabase()) {
  const { data: guesses, error: guessesError } = await client
    .from('guesses')
    .select('id, name, guess, created_at')
    .eq('session_id', sessionId);
  if (guessesError) throw guessesError;

  const guessIds = guesses.map((g) => g.id);
  // Skip the query entirely for a session with zero guesses — an empty
  // .in() list isn't guaranteed to behave the same as "match nothing" across
  // every Postgrest client version, so don't rely on it.
  let contacts = [];
  if (guessIds.length > 0) {
    const { data, error } = await client
      .from('contacts')
      .select('guess_id, phone, instagram')
      .in('guess_id', guessIds);
    if (error) throw error;
    contacts = data;
  }

  const contactsByGuessId = new Map(contacts.map((c) => [c.guess_id, c]));
  return guesses.map((g) => {
    const c = contactsByGuessId.get(g.id);
    return {
      name: g.name,
      guess: g.guess,
      phone: c?.phone ?? '',
      instagram: c?.instagram ?? '',
      createdAt: g.created_at,
    };
  });
}

// ============ Phase 4: participant entry flow (public, unauthenticated) ============

// Public, unauthenticated read of a session's SAFE columns only — anon's own
// grant is column-scoped to exactly these four (Phase 1's own
// 20260914121000_guess_the_bean_rls.sql), which is exactly what the
// participant entry flow needs and no more. `.maybeSingle()`, not
// `.single()` — a nonexistent session_id is a normal, expected outcome here
// (the 'not-found' view state), not an error.
export async function fetchSessionStatus(sessionId, client = getSupabase()) {
  const { data, error } = await client
    .from('sessions')
    .select('id, guess_enabled, revealed, orientation')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Phase 5's anonymous live feed intentionally reads only these non-sensitive
// arrival fields.  The numeric guess is deliberately absent before the reveal
// (see 20260915110000_guess_the_bean_display_feed.sql).
export async function fetchSessionGuessFeed(sessionId, client = getSupabase()) {
  const { data, error } = await client
    .from('guesses')
    .select('id, name, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data;
}

// The revealed result set comes from a narrowly-scoped RPC rather than a
// broad anonymous SELECT grant on `guesses.guess`.  It is ordered by arrival
// time, then id for deterministic same-timestamp ordering; the display's
// stable closest-guess sort therefore keeps the earliest arrival on a tie.
export async function fetchSessionGuesses(sessionId, client = getSupabase()) {
  const { data, error } = await client.rpc('session_display_guesses', {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data;
}

// Atomic guess+contact submission via the submit_guess RPC — see
// supabase/migrations/20260915100000_guess_the_bean_submit_guess_rpc.sql's
// own comment for why this is one server-side transaction rather than two
// client-side inserts (the spec's own Phase 4 AC: no orphaned guess if the
// network drops mid-submit). Returns the new guess's id.
export async function submitGuess(
  { sessionId, name, guess, phone, instagram },
  client = getSupabase(),
) {
  const { data, error } = await client.rpc('submit_guess', {
    p_session_id: sessionId,
    p_name: name,
    p_guess: guess,
    p_phone: phone || null,
    p_instagram: instagram || null,
  });
  if (error) throw error;
  return data;
}
