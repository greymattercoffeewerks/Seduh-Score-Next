// "Is this the login's current password?" for the Change password panel, asked with a throwaway client
// (adminClient.js createCheckClient): sign in, then sign that session out again at once.
//
// UI-ONLY PROTECTION. The check is made by browser code, so anyone holding a live aal2 token can call
// `PUT /auth/v1/user` themselves and skip it. It stops a walk-up at an unlocked console and nothing else; the
// server-side check is `current_password` on `updateUser`, which GoTrue enforces only when the project's
// "require current password" setting is on (ADMIN-PASSWORD-DESIGN, D3). Do not describe it as more than that.
//
// The throwaway session is an aal1 session of the same login. It is signed out with `scope: 'local'` (revoked on
// the server, not just dropped); if that fails it is still ended by the `scope: 'others'` sign-out that follows
// a saved password, and it cannot call any admin function (aal1).
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { signOutRequest } from '../core/signOutRequest.js';
import { getCheckClient } from './adminClient.js';

// Resolves to { ok: true } (it is the password), { ok: false, wrong: true } (it is not) or
// { ok: false, error } (the server refused for another reason: a rate limit, say). THROWS on a timeout or a
// dropped connection, like the other requests behind the form (the caller words it).
export async function verifyCurrentPassword(email, password, { makeClient = getCheckClient } = {}) {
  const check = makeClient();
  const { data, error } = await raceTimeout(
    check.auth.signInWithPassword({ email, password }),
    DEFAULT_LOAD_TIMEOUT_MS,
  );
  if (error) {
    return error.code === 'invalid_credentials' ? { ok: false, wrong: true } : { ok: false, error };
  }
  // Only a real session needs ending; whether or not it did not, the answer is already known.
  if (data?.session) await signOutRequest(check, { scope: 'local' });
  return { ok: true };
}
