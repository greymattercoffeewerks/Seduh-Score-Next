// One sign-out request against an injected client, raced against the shared timeout, with no screen and no
// outbox attached. core/signOut.js (the organiser console's sign-out, which also looks at the outbox for
// unsynced changes and so imports IndexedDB code) and src/admin/gate.js (the admin console's, which must not
// pull that in) both build on it.
//
// Never rejects: a failed or stalled sign-out is an expected outcome over venue wifi, reported as a result.
// `scope` is passed through only when given ('local' this tab only, 'global' every session of the login); with
// none, the client's own default applies and the call is exactly `client.auth.signOut()`.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

// Resolves to { ok: true } or { ok: false, timedOut } (`timedOut` true when it never settled).
export async function signOutRequest(client, { scope, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  try {
    const { error } = await raceTimeout(
      scope ? client.auth.signOut({ scope }) : client.auth.signOut(),
      timeoutMs,
    );
    return error ? { ok: false, timedOut: false } : { ok: true };
  } catch (thrown) {
    return { ok: false, timedOut: Boolean(thrown?.timedOut) };
  }
}
