// The Change password panel (`#/password`): the signed-in operator chooses a new password. Not an admin function:
// the change goes to Supabase Auth (GoTrue), not to the database, so it is not audited by the console (the Auth log
// is the record) and does not use ctx.callAdmin. The database gate is untouched: the session stays aal2, so the
// gate stays `ready` (tests/e2e/admin-console-password.spec.js proves it).
//
// Built on core/passwordForm.js and core/passwordChange.js with this console's own client (ctx.client), words and
// minimum length (12). The panel is mounted only by the shell, i.e. only once the gate is `ready`.
//
// Two checks on the current password, because only one of them is the server's:
//   1. `current_password` goes to `updateUser`; GoTrue enforces it only if the project's "require current
//      password" setting is on, and ignores it otherwise.
//   2. The form also checks it with a throwaway client (currentPassword.js). UI-only protection: it stops a walk-up
//      at an unlocked console, nothing else. A stolen aal2 token can call `PUT /auth/v1/user` directly.
// The password is never stored, logged or put in an attribute: it lives in the form's inputs and the request.
import { el } from '../core/dom.js';
import { mountPasswordFormScreen } from '../core/passwordForm.js';
import { savePasswordAndEndOtherSessions } from '../core/passwordChange.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { verifyCurrentPassword } from './currentPassword.js';

export const ADMIN_MIN_PASSWORD_LENGTH = 12;

const INTRO =
  'Choose a new password of at least 12 characters. Your other sessions will be signed out; this one stays signed in.';

export const SAVED_MESSAGE = 'Your new password is saved and your other sessions were signed out.';
export const OTHERS_NOT_ENDED_MESSAGE =
  'Your new password is saved, but we could not sign out your other sessions. If you think someone else has your old password, use "Sign out everywhere" at the top of this page.';
const MAYBE_SAVED = ' If your last attempt timed out, the new password may already be in effect.';

// Code -> words. Never the server's own text. `maybeSaved` appends the timeout caveat where it matters.
export function describePasswordPanelError(error, { maybeSaved = false } = {}) {
  const code = error?.code;
  const late = maybeSaved ? MAYBE_SAVED : '';
  switch (code) {
    case 'wrong_current_password':
    case 'current_password_mismatch':
    case 'current_password_required':
      return `That is not your current password.${late}`;
    case 'same_password':
      return `Choose a different password from your current one.${late}`;
    case 'weak_password':
      return 'That password is too easy to guess. Choose a longer or less common one.';
    case 'insufficient_aal':
      return 'This session has not passed the authenticator check, so Supabase refuses the change. Sign out, sign in again with your authenticator app and retry.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Wait a few minutes, then try again.';
    case 'session_not_found':
    case 'session_expired':
    case 'bad_jwt':
      return 'Your session ended. Sign in again, then retry.';
    case 'check_timed_out':
      return 'Checking your current password is taking longer than expected. Nothing was changed. Check your connection and try again.';
    case 'check_offline':
      return 'Could not check your current password. Nothing was changed. Check your connection and try again.';
    case 'save_timed_out':
      return 'Saving is taking longer than expected, and the new password may have been saved. Check your connection, then try again.';
    case 'save_offline':
      return 'The connection dropped, and the new password may have been saved. Check your connection, then try again.';
    default:
      if (error?.status === 429) {
        return 'Too many attempts. Wait a few minutes, then try again.';
      }
      return 'Could not save your password. Try again.';
  }
}

// Errors that mean this session is no longer honoured: the console asks the gate again, as for a refused admin call.
const SESSION_GONE = new Set(['session_not_found', 'session_expired', 'bad_jwt']);

export function mountPasswordPanel(host, ctx) {
  const { client } = ctx;
  const controller = new AbortController();
  let maybeSaved = false;

  async function currentEmail() {
    const { data } = await raceTimeout(client.auth.getSession(), DEFAULT_LOAD_TIMEOUT_MS);
    return data?.session?.user?.email ?? null;
  }

  // Resolves to { error } or the shared save's result; never throws (a throw is turned into a coded error so the
  // words say whether the new password may already be in effect).
  async function save(password, currentPassword) {
    let stage = 'check';
    try {
      const email = await currentEmail();
      if (!email) return { error: { code: 'session_not_found' } };
      const verified = await verifyCurrentPassword(email, currentPassword);
      if (!verified.ok) {
        return { error: verified.wrong ? { code: 'wrong_current_password' } : verified.error };
      }
      stage = 'save';
      maybeSaved = false;
      const result = await savePasswordAndEndOtherSessions(client, password, { currentPassword });
      if (result.error && SESSION_GONE.has(result.error.code)) ctx.onGateRefused?.();
      return result;
    } catch (thrown) {
      const timedOut = Boolean(thrown?.timedOut);
      if (stage === 'save') maybeSaved = true;
      return { error: { code: `${stage}_${timedOut ? 'timed_out' : 'offline'}` } };
    }
  }

  function showDone(othersSignedOut) {
    host.replaceChildren(
      el('section', { className: 'screen-container login-screen' }, [
        el('h1', {
          id: 'adm-password-heading',
          text: 'Password changed',
          attrs: { tabindex: '-1', 'data-heading': '' },
        }),
        el('p', {
          className: 'adm-muted',
          text: othersSignedOut ? SAVED_MESSAGE : OTHERS_NOT_ENDED_MESSAGE,
          attrs: { role: 'status', 'aria-live': 'polite' },
        }),
      ]),
    );
    host.querySelector('[data-heading]').focus();
  }

  mountPasswordFormScreen(host, {
    heading: 'Change password',
    headingId: 'adm-password-heading',
    intro: INTRO,
    signal: controller.signal,
    minLength: ADMIN_MIN_PASSWORD_LENGTH,
    askCurrent: true,
    toggleCurrent: true,
    inlineErrors: true,
    save,
    describeError: (error) => describePasswordPanelError(error, { maybeSaved }),
    onSaved: (result) => {
      if (controller.signal.aborted) return;
      showDone(result.othersSignedOut);
    },
  });

  return {
    unmount() {
      controller.abort();
    },
  };
}
