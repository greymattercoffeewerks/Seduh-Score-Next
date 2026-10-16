// One password sign-in request, classified, with no screen attached. Every sign-in surface (the organiser
// console's core/loginScreen.js, the admin console's src/admin/signInScreen.js) used to carry its own copy of
// "race the request against the shared timeout, then work out what the failure was"; they now share this and
// each keeps its OWN words for what the person is told (the two surfaces say it differently on purpose).
//
// No DOM, no client construction (the client is injected: the admin console signs in against its own client,
// the organiser console against the shared one), and nothing here ever rejects: a stalled or failed request is
// an expected outcome over venue wifi, reported as a result.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

// supabase-js reports a wrong email/password as code 'invalid_credentials' (older versions only carry the
// message).
export function isInvalidCredentials(error) {
  return (
    error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message ?? '')
  );
}

export function isRateLimited(error) {
  return error?.code === 'over_request_rate_limit' || error?.status === 429;
}

// Resolves to { ok: true } or { ok: false, kind, error? } where `kind` is one of:
//   'timeout'     the request never settled within `timeoutMs`
//   'transport'   the request threw (no connection, aborted fetch)
//   'invalid'     the server refused the email and password
//   'rate_limit'  the server refused because of too many attempts
//   'other'       any other refusal; `error` is the server's own error
//
// `retryTrimmed` is for a password pasted from a chat, which often carries a space at either end: it is tried
// exactly as typed first, and ONLY a wrong-password refusal of that, with surrounding space present, earns one
// more try without it (which spends a second sign-in from a shared per-IP rate budget, so never otherwise).
// `isCancelled()` stops that second try when the caller no longer wants the result.
export async function signInWithPasswordRequest(
  client,
  { email, password },
  { retryTrimmed = false, isCancelled = () => false, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
) {
  const attempt = (pw) =>
    raceTimeout(client.auth.signInWithPassword({ email, password: pw }), timeoutMs);
  let error;
  try {
    ({ error } = await attempt(password));
    if (retryTrimmed && error && isInvalidCredentials(error)) {
      const trimmed = password.trim();
      if (trimmed && trimmed !== password && !isCancelled()) ({ error } = await attempt(trimmed));
    }
  } catch (thrown) {
    // signInWithPassword's own contract is to RETURN {error} for a refusal, so a throw is the transport (and
    // raceTimeout throws, marked `timedOut`, if the request never settles).
    return { ok: false, kind: thrown?.timedOut ? 'timeout' : 'transport' };
  }
  if (!error) return { ok: true };
  if (isInvalidCredentials(error)) return { ok: false, kind: 'invalid', error };
  if (isRateLimited(error)) return { ok: false, kind: 'rate_limit', error };
  return { ok: false, kind: 'other', error };
}
