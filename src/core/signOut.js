// Signing out, in one place. The header's Sign out button (appShell.js) and the "no organisation" screen
// (noOrgScreen.js) both sign out and then have the router show the sign-in screen; they used to each
// carry their own copy, and only one of them had a timeout.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export const SIGN_OUT_FAILED_MESSAGE = 'Could not sign out — check your connection and try again.';
export const SIGN_OUT_SLOW_MESSAGE =
  'Signing out is taking longer than expected — check your connection and try again.';

// Signs out, racing the shared timeout so a stalled connection cannot leave the button stuck.
// Resolves to null on success, or to the message to show: a failure is an expected outcome over venue
// wifi, so this never rejects.
export async function signOutWithTimeout(client) {
  try {
    const { error } = await raceTimeout(client.auth.signOut(), DEFAULT_LOAD_TIMEOUT_MS);
    return error ? SIGN_OUT_FAILED_MESSAGE : null;
  } catch (err) {
    return err?.timedOut ? SIGN_OUT_SLOW_MESSAGE : SIGN_OUT_FAILED_MESSAGE;
  }
}
