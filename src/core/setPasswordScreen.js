// "Choose your password" — shown, in front of every console route, to someone who signed in with a
// one-time password (an owner created or reset their account on the Team screen; the account is
// flagged `must_change_password` in its user metadata). They cannot reach anything else until they
// have chosen their own. The form, its checks and the screen skeleton are shared with the recovery and
// Change password screens (passwordForm.js); this file is only this screen's words and its save.
//
// The flag is cleared by the same call that changes the password (`updateUser({ password, data })`).
// It lives in user_metadata, which the person can edit themselves, so it is a prompt, not a lock:
// what actually protects the org is that the one-time password is single-use by convention and the
// owner can reset or remove the account at any time.
import { getSupabase } from './supabaseClient.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { mountPasswordFormScreen } from './passwordForm.js';

// Kept importable from here: this was their home before the form was shared.
export {
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
  describePasswordError,
  renderSetPasswordForm,
} from './passwordForm.js';

export async function mountSetPasswordScreen(
  root,
  { client = getSupabase(), onDone, signal } = {},
) {
  return mountPasswordFormScreen(root, {
    heading: 'Choose your password',
    headingId: 'set-password-heading',
    intro: 'You signed in with a one-time password. Choose your own to continue.',
    signal,
    save: (password) =>
      raceTimeout(
        client.auth.updateUser({ password, data: { must_change_password: false } }),
        DEFAULT_LOAD_TIMEOUT_MS,
      ),
    onSaved: () => onDone?.(),
  });
}
