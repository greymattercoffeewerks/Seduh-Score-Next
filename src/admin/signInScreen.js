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
  INVALID_CREDENTIALS_MESSAGE,
} from '../core/loginScreen.js';
import { signInWithPasswordRequest } from '../core/signInRequest.js';
import { el } from '../core/dom.js';
import { RATE_LIMIT_MESSAGE } from './mfa.js';
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

    // No trimmed-password retry here (see the header): `retryTrimmed` stays off.
    const result = await signInWithPasswordRequest(client, {
      email: draft.email,
      password: draft.password,
    });
    if (result.ok) {
      onSignedIn?.();
      return;
    }
    signingIn = false;
    setFormBusy(form, false, { idle: 'Sign in', working: 'Signing in…' });
    const message = {
      timeout: SLOW,
      invalid: INVALID_CREDENTIALS_MESSAGE,
      rate_limit: RATE_LIMIT_MESSAGE,
    }[result.kind];
    setFeedback(feedback, message ?? OFFLINE, 'error');
  });

  container.append(el('div', { className: 'card' }, [form]));
  if (notice) setFeedback(feedback, notice, 'pending');
  root.appendChild(container);
  return { unmount() {} };
}
