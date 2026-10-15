// The admin sign-in: email and password, nothing else. Reuses the organiser console's form primitives
// (core/loginScreen.js renderLoginForm, validateCredentials, isInvalidCredentials) but not its mount function
// or its shared client: this surface signs in against its OWN client (adminClient.js, spec D-A15), and a
// password-only session here is never enough to see anything (D-A5), so a successful sign-in only moves on to
// the access check.
//
// Unlike the organiser sign-in this does not retry a password with its surrounding spaces trimmed: that
// helps a password pasted from a chat, which is a thing organisers get sent and an operator does not, and it
// would spend a second attempt from the sign-in rate limit.
import {
  renderLoginForm,
  validateCredentials,
  isInvalidCredentials,
  INVALID_CREDENTIALS_MESSAGE,
} from '../core/loginScreen.js';
import { el } from '../core/dom.js';
import { RATE_LIMIT_MESSAGE } from './mfa.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { frame, setFeedback, setFormBusy } from './screenParts.js';

const SLOW = 'This is taking longer than expected. Check your connection and try again.';
const OFFLINE = 'Could not sign in. Check your connection and try again.';

export function mountSignInScreen(root, { client, notice, onSignedIn } = {}) {
  const draft = { email: '', password: '' };
  let signingIn = false;
  let showPassword = false;

  const { container, feedback } = frame('Admin sign in');
  const form = renderLoginForm(draft, {
    disabled: false,
    showPassword,
    onTogglePassword: (isShown) => {
      showPassword = isShown;
    },
  });

  // The page's own messages (in the live region) say what is missing, not the browser's bubble.
  form.noValidate = true;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signingIn) return;
    // What the form shows now: iOS autofill can fill a field without reporting it. (The email field drops
    // surrounding space itself, as every type=email input does; the password is sent exactly as typed.)
    draft.email = form.querySelector('[data-field="email"]').value;
    draft.password = form.querySelector('[data-field="password"]').value;
    const invalid = validateCredentials(draft);
    if (invalid) {
      setFeedback(feedback, invalid, 'error');
      return;
    }
    signingIn = true;
    setFeedback(feedback, '');
    setFormBusy(form, true, { idle: 'Sign in', working: 'Signing in…' });

    let error;
    try {
      ({ error } = await raceTimeout(
        client.auth.signInWithPassword({ email: draft.email, password: draft.password }),
        DEFAULT_LOAD_TIMEOUT_MS,
      ));
    } catch (thrown) {
      error = { transport: true, timedOut: Boolean(thrown?.timedOut) };
    }
    if (!error) {
      onSignedIn?.();
      return;
    }
    signingIn = false;
    setFormBusy(form, false, { idle: 'Sign in', working: 'Signing in…' });
    if (error.transport) setFeedback(feedback, error.timedOut ? SLOW : OFFLINE, 'error');
    else if (isInvalidCredentials(error))
      setFeedback(feedback, INVALID_CREDENTIALS_MESSAGE, 'error');
    else if (error.code === 'over_request_rate_limit' || error.status === 429)
      setFeedback(feedback, RATE_LIMIT_MESSAGE, 'error');
    else setFeedback(feedback, OFFLINE, 'error');
  });

  container.append(el('div', { className: 'card' }, [form]));
  if (notice) setFeedback(feedback, notice, 'pending');
  root.appendChild(container);
  return { unmount() {} };
}
