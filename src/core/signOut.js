// Signing out, in one place. The header's Sign out button (appShell.js) and the "no organisation" screen
// (noOrgScreen.js) both sign out and then have the router show the sign-in screen; they used to each
// carry their own copy, and only one of them had a timeout.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { listAccountOperations } from './outbox.js';

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

// Signing out never removes what has not synced: it stays on this device for the account that made it and
// is sent when that account is signed in again. But a person must not walk away believing it was sent, so
// both Sign out buttons ask first when the account has changes waiting, in two steps (press Sign out again;
// the button keeps its label, so nothing in the header or menu moves). Resolves to the sentence to show, or null when there is nothing to warn about.
// `accountOperations` is injectable for the same reason `client` is. If the outbox cannot be read, say so
// and let the person decide: neither "nothing is waiting" nor "something is" is known.
export const SIGN_OUT_UNCHECKED_MESSAGE =
  'Could not check whether everything has synced. To sign out now, press Sign out again; anything not sent stays on this device.';

export async function unsyncedSignOutWarning(email, accountOperations = listAccountOperations) {
  let count;
  try {
    count = (await raceTimeout(accountOperations(), DEFAULT_LOAD_TIMEOUT_MS)).length;
  } catch {
    return SIGN_OUT_UNCHECKED_MESSAGE;
  }
  if (count === 0) return null;
  const who = email || 'this account';
  const many = count !== 1;
  return `${count} ${many ? 'changes have' : 'change has'} not been sent yet. ${many ? 'They stay' : 'It stays'} on this device and ${many ? 'are' : 'is'} sent once ${who} is signed in. To sign out now, press Sign out again.`;
}
