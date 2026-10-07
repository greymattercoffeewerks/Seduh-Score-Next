// "Choose your password" — shown, in front of every console route, to someone who signed in with a
// one-time password (an owner created or reset their account on the Team screen; the account is
// flagged `must_change_password` in its user metadata). They cannot reach anything else until they
// have chosen their own. Format-agnostic, like loginScreen.js, and built the same way: the
// Show/Hide toggle flips in place, the busy state is aria-disabled rather than native-disabled, and
// the request races the shared timeout so a stalled connection cannot leave the form stuck.
//
// The flag is cleared by the same call that changes the password (`updateUser({ password, data })`).
// It lives in user_metadata, which the person can edit themselves, so it is a prompt, not a lock:
// what actually protects the org is that the one-time password is single-use by convention and the
// owner can reset or remove the account at any time.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField, passwordToggle, setBusyDisabled, withFocusPreservation } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(password, confirmation) {
  if (!password) return 'Choose a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'The two passwords do not match.';
  return null;
}

// Supabase refuses a new password equal to the current one with code `same_password`; say what to do
// instead of the API's "New password should be different from the old password."
export function describePasswordError(error) {
  if (error?.code === 'same_password') {
    return 'Choose a different password from the one-time password you were given.';
  }
  if (error?.code === 'weak_password') {
    return 'That password is too easy to guess. Choose a longer or less common one.';
  }
  return error?.message || 'Could not save your password. Try again.';
}

export function renderSetPasswordForm(draft, { disabled, showPassword = false, onTogglePassword }) {
  function passwordInput(key, label) {
    const input = el('input', {
      className: 'field-input',
      attrs: {
        type: 'password',
        autocomplete: 'new-password',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': label,
        'data-field': key,
        required: 'required',
      },
    });
    input.value = draft[key];
    setBusyDisabled(input, disabled);
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => {
        draft[key] = input.value;
      });
    }
    return input;
  }

  const newInput = passwordInput('password', 'New password');
  const confirmInput = passwordInput('confirmation', 'Confirm new password');
  // One toggle for both boxes: seeing them side by side is how a typo is spotted.
  const [toggleButton, toggleStatus] = passwordToggle([newInput, confirmInput], {
    shown: showPassword,
    onToggle: onTogglePassword,
  });

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Saving…' : 'Save password',
    // Not 'submit': loginScreen's own submit button carries that key, and focus preservation would
    // carry focus from the sign-in form's button onto this one when this screen replaces it.
    attrs: { type: 'submit', 'data-focus-key': 'set-password-submit' },
  });
  setBusyDisabled(submitButton, disabled);

  return el('form', { className: 'login-form' }, [
    labeledField('New password', newInput),
    // After BOTH boxes: it flips both, and sitting between them read as controlling only the first.
    labeledField('Confirm password', confirmInput, [toggleButton, toggleStatus]),
    submitButton,
  ]);
}

export async function mountSetPasswordScreen(
  root,
  { client = getSupabase(), onDone, signal } = {},
) {
  const draft = { password: '', confirmation: '' };
  let saving = false;
  let pendingError = null;
  let showPassword = false;
  let firstRender = true;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    // What the boxes show now, not only what input events reported (iOS autofill / password managers).
    const form = event.currentTarget;
    draft.password = form.querySelector('[data-field="password"]').value;
    draft.confirmation = form.querySelector('[data-field="confirmation"]').value;

    const invalid = validateNewPassword(draft.password, draft.confirmation);
    if (invalid) {
      pendingError = invalid;
      render();
      return;
    }

    saving = true;
    render();
    const password = draft.password;
    let error;
    try {
      ({ error } = await raceTimeout(
        client.auth.updateUser({ password, data: { must_change_password: false } }),
        DEFAULT_LOAD_TIMEOUT_MS,
      ));
    } catch (err) {
      pendingError = err.timedOut
        ? 'This is taking longer than expected — check your connection and try again.'
        : 'Could not save your password — check your connection and try again.';
      saving = false;
      render();
      return;
    }

    if (error) {
      pendingError = describePasswordError(error);
      saving = false;
      render();
      return;
    }

    onDone?.();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      const heading = el('h1', {
        id: 'set-password-heading',
        text: 'Choose your password',
        attrs: { tabindex: '-1' },
      });
      container.appendChild(heading);
      container.appendChild(
        el('p', {
          className: 'stage-meta',
          text: 'You signed in with a one-time password. Choose your own to continue.',
        }),
      );

      const feedback = el('div', {
        className: 'screen-feedback',
        attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
      });
      if (pendingError) {
        setFeedback(feedback, pendingError, 'error');
        pendingError = null;
      }

      const form = renderSetPasswordForm(draft, {
        disabled: saving,
        showPassword,
        onTogglePassword: (isShown) => {
          showPassword = isShown;
        },
      });
      form.addEventListener('submit', handleSubmit);

      container.appendChild(el('div', { className: 'card' }, [form]));
      container.appendChild(feedback);
      root.appendChild(container);

      if (feedback.dataset.tone === 'error') {
        firstRender = false;
        feedback.scrollIntoView?.({ block: 'nearest' });
        feedback.focus();
        return true;
      }
      if (firstRender) {
        // Arriving from the sign-in screen: land on the heading, so a screen reader says what this
        // screen is, instead of "Save password, button".
        firstRender = false;
        heading.focus();
        return true;
      }
    });
  }

  render();

  return {
    unmount() {
      // No live state beyond the DOM subtree the caller removes — nothing to tear down.
    },
  };
}
