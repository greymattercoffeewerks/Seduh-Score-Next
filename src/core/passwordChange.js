// Changing the password of the SIGNED-IN person, with no screen attached: the one save used by both the
// signed-in Change password screen and the screen a recovery link opens. Format-agnostic, no DOM, the
// client is injected, and every request races the shared timeout (core/timeout.js).
//
// Supabase does not ask for the current password on `updateUser`, so what protects a stolen, unlocked
// session is what happens after: every OTHER session of the login is ended (D-PW6), which also signs
// out whoever was holding the old password. The "your password was changed" email (D-PW7) is a separate,
// later task.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { signOutRequest } from './signOutRequest.js';

// `must_change_password` is cleared by the same call (see setPasswordScreen.js): a person who chose
// their own password is no longer on a one-time one, whichever screen they chose it on.
//
// Resolves to `{ error }` (the server's refusal, `error` null on success) plus, on success, `othersSignedOut`:
// whether the other sessions were really ended. A password that is saved but whose sign-out of the other
// sessions failed is still a saved password, so that is reported, not turned into a failure. A request
// that never settles, or a dropped connection, THROWS (a `timedOut` error from raceTimeout), exactly as
// the form helper (passwordForm.js) expects.
export async function savePasswordAndEndOtherSessions(client, password) {
  const { error } = await raceTimeout(
    client.auth.updateUser({ password, data: { must_change_password: false } }),
    DEFAULT_LOAD_TIMEOUT_MS,
  );
  if (error) return { error };
  return { error: null, othersSignedOut: await endOtherSessions(client) };
}

// `scope: 'others'` keeps this session and ends every other one of the same login. Never throws.
export async function endOtherSessions(client) {
  return (await signOutRequest(client, { scope: 'others' })).ok;
}

// Whether this session can change the password at all. A login with a verified authenticator app is
// refused a password change from a session that has not passed the second factor (`insufficient_aal`);
// that is exactly "signed in at level 1 while level 2 is available". Asked BEFORE the form is shown, so a
// form that is bound to fail is never put in front of anyone. This reads the session's own token (the client
// may refresh an expired one over the network first, so callers bound the wait). If it cannot be answered, the
// form is shown and the server's own refusal (worded by passwordForm.js) is the backstop.
export async function passwordChangeBlockedByAuthenticator(client) {
  try {
    const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2';
  } catch {
    return false;
  }
}
