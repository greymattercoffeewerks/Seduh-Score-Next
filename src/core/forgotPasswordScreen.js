// "Forgot password?" — the screen that asks for a recovery link (D-PW1). One email field. Whatever the
// server says about the address, the screen shows the SAME words (RESET_REQUESTED_MESSAGE), because this
// form must not be a way to learn which addresses have an account (D-PW5); see passwordRecovery.js for
// exactly which refusals are folded into that answer and why. The only different answers are ones that say
// nothing about the address: no connection, and too many requests from this connection.
//
// Reached at #/forgot-password, which is NOT behind the sign-in gate (the person cannot sign in). Built
// like loginScreen.js: the field is read at submit (autofill), the busy state is aria-disabled, and the
// request races the shared timeout (inside requestPasswordReset).
import { getSupabase } from './supabaseClient.js';
import { el, labeledField, setBusyDisabled, setFeedback, withFocusPreservation } from './dom.js';
import { isEmailShaped } from './email.js';
import {
  requestPasswordReset,
  resetRedirectUrl,
  RESET_REQUESTED_MESSAGE,
} from './passwordRecovery.js';

export const FORGOT_ADDRESS_MESSAGE = 'Enter the email address you sign in with.';
export const FORGOT_UNREACHABLE_MESSAGE =
  'Could not reach the server — check your connection and try again.';
export const FORGOT_BUSY_MESSAGE = 'Too many requests just now. Wait a minute, then try again.';

export async function mountForgotPasswordScreen(
  root,
  { client = getSupabase(), signal, requestOptions = {}, redirectTo = resetRedirectUrl() } = {},
) {
  const draft = { email: '' };
  let sending = false;
  let sent = false;
  let pendingError = null;
  let firstRender = true;
  let unmounted = false;

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;
    // What the box shows now, not only what an input event reported (autofill).
    draft.email = event.currentTarget.querySelector('[data-field="email"]').value;
    if (!isEmailShaped(draft.email)) {
      pendingError = FORGOT_ADDRESS_MESSAGE;
      render();
      return;
    }
    sending = true;
    render();
    // Captured now: the field stays editable while the request is in flight.
    const email = draft.email.trim();
    const { kind } = await requestPasswordReset(client, email, { redirectTo, ...requestOptions });
    if (unmounted || signal?.aborted) return;
    sending = false;
    if (kind === 'requested') sent = true;
    else pendingError = kind === 'busy' ? FORGOT_BUSY_MESSAGE : FORGOT_UNREACHABLE_MESSAGE;
    render();
  }

  function renderForm(container, feedback) {
    const emailInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'email',
        autocomplete: 'username',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': 'Email',
        'data-field': 'email',
        required: 'required',
      },
    });
    emailInput.value = draft.email;
    setBusyDisabled(emailInput, sending);
    for (const type of ['input', 'change']) {
      emailInput.addEventListener(type, () => {
        draft.email = emailInput.value;
      });
    }
    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: sending ? 'Sending…' : 'Send link',
      attrs: { type: 'submit', 'data-focus-key': 'forgot-submit' },
    });
    setBusyDisabled(submitButton, sending);
    const form = el('form', { className: 'login-form' }, [
      labeledField('Email', emailInput),
      submitButton,
    ]);
    form.addEventListener('submit', handleSubmit);
    container.append(
      el('p', {
        className: 'stage-meta',
        text: 'Enter the email address you sign in with. We will send a link to choose a new password.',
      }),
      el('div', { className: 'card' }, [form]),
      feedback,
      backToSignIn(),
    );
  }

  function renderSent(container, feedback) {
    // The answer sits in the status line, the same node and wording as every other outcome of the request.
    setFeedback(feedback, RESET_REQUESTED_MESSAGE, 'success');
    const another = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Use a different address',
      attrs: { type: 'button' },
    });
    another.addEventListener('click', () => {
      sent = false;
      draft.email = '';
      firstRender = true;
      render();
    });
    container.append(
      feedback,
      el('p', {
        className: 'stage-meta',
        text: 'The link works once and for a short time. If nothing arrives in a few minutes, check your spam folder, then ask the owner of your organisation or the Seduh Score operator.',
      }),
      another,
      backToSignIn(),
    );
  }

  const backToSignIn = () =>
    el('a', {
      className: 'login-secondary-link tap-target',
      text: 'Back to sign in',
      attrs: { href: '#/events' },
    });

  function render() {
    if (signal?.aborted || unmounted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      const heading = el('h1', {
        id: 'forgot-password-heading',
        text: sent ? 'Check your email' : 'Forgot your password?',
        attrs: { tabindex: '-1' },
      });
      container.appendChild(heading);
      const feedback = el('div', {
        className: 'screen-feedback',
        attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
      });
      if (pendingError) {
        setFeedback(feedback, pendingError, 'error');
        pendingError = null;
      }
      if (sent) renderSent(container, feedback);
      else renderForm(container, feedback);
      root.appendChild(container);

      if (feedback.dataset.tone === 'error') {
        firstRender = false;
        feedback.scrollIntoView?.({ block: 'nearest' });
        feedback.focus();
        return true;
      }
      if (sent) {
        // The answer: focus lands on the status line that holds it (a node inserted already populated is
        // not reliably announced as a live region; focusing it is what delivers the words).
        firstRender = false;
        feedback.focus();
        return true;
      }
      if (firstRender) {
        // Arriving here: the heading names the screen for a screen reader.
        firstRender = false;
        heading.focus();
        return true;
      }
    });
  }

  render();

  return {
    unmount() {
      // The only live thing is the request in flight: it must not write to a page that moved on.
      unmounted = true;
    },
  };
}
