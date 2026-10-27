// "Choose a new password": the form, its checks and the screen skeleton around it, shared by every
// screen that ends in a new password. Three use it today: the one-time-password gate
// (setPasswordScreen.js), the screen a recovery link opens (recoveryScreen.js) and the signed-in
// Change password screen (changePasswordScreen.js). Each supplies only its words and what "save" means.
// Format-agnostic, like loginScreen.js, and built the same way: the Show/Hide toggle flips in place, the
// busy state is aria-disabled rather than native-disabled, and the form is read at submit (iOS autofill).
//
// The caller's `save(password)` resolves to `{ error }` (anything else in the result is handed on to
// `onSaved`) and is responsible for racing its own requests against the shared timeout
// (core/timeout.js): a throw, whether a timeout or a dropped connection, is worded here.
import {
  el,
  labeledField,
  passwordToggle,
  setBusyDisabled,
  setFeedback,
  withFocusPreservation,
} from './dom.js';

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
// instead of the API's "New password should be different from the old password." `context` names what
// the current password is: the one-time password the person was given (the default, the Team screen's
// flow) or simply their current one (recovery and Change password).
export function describePasswordError(error, { context = 'one-time' } = {}) {
  if (error?.code === 'same_password') {
    return context === 'current'
      ? 'Choose a different password from your current one.'
      : 'Choose a different password from the one-time password you were given.';
  }
  if (error?.code === 'weak_password') {
    return 'That password is too easy to guess. Choose a longer or less common one.';
  }
  // A person with an authenticator app cannot change the password from a password-only session.
  if (error?.code === 'insufficient_aal') return AUTHENTICATOR_REQUIRED_MESSAGE;
  // Never the server's own words: they are English API text ("Auth session missing!"), not something to show a barista.
  return 'Could not save your password. Try again.';
}

// What to say to someone whose account has an authenticator app and who cannot use it here: Supabase
// refuses a password change from a session that has not passed the second factor (`insufficient_aal`),
// and this screen has no code step (that is the operator's console). Said BEFORE a form that would fail.
export const AUTHENTICATOR_REQUIRED_MESSAGE =
  'This account is protected by an authenticator app, so its password cannot be changed here. Ask the Seduh Score team to help you.';

// After a save whose sign-out of the OTHER sessions failed (the password IS changed).
export const OTHERS_NOT_SIGNED_OUT_MESSAGE =
  'We could not sign out your other devices. If you think someone else has your old password, sign out on those devices yourself.';

// What the confirmation after a saved password says (recovery and Change password share it).
export function savedMessage(othersSignedOut) {
  return othersSignedOut
    ? 'Your new password is saved and your other devices were signed out.'
    : `Your new password is saved. ${OTHERS_NOT_SIGNED_OUT_MESSAGE}`;
}

export function renderSetPasswordForm(
  draft,
  { disabled, showPassword = false, onTogglePassword, focusKey = 'set-password-submit' },
) {
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
  const confirmInput = passwordInput('confirmation', 'Confirm password');
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
    attrs: { type: 'submit', 'data-focus-key': focusKey },
  });
  setBusyDisabled(submitButton, disabled);

  return el('form', { className: 'login-form' }, [
    labeledField('New password', newInput),
    // After BOTH boxes: it flips both, and sitting between them read as controlling only the first.
    labeledField('Confirm password', confirmInput, [toggleButton, toggleStatus]),
    submitButton,
  ]);
}

// The screen skeleton: a heading (focused on arrival), an introduction, the form, a polite status line
// for what went wrong, and any `footer` nodes (a way out) under it. `onSaved(result)` fires once, after
// a successful save, and the screen leaves the page as it is: the caller replaces it.
export function mountPasswordFormScreen(
  root,
  {
    heading,
    headingId,
    intro,
    save,
    onSaved,
    signal,
    describeError = describePasswordError,
    footer = () => [],
  },
) {
  const draft = { password: '', confirmation: '' };
  let saving = false;
  let pendingError = null;
  let showPassword = false;
  let firstRender = true;

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
    let result;
    try {
      result = await save(password);
    } catch (err) {
      pendingError = err?.timedOut
        ? 'This is taking longer than expected — check your connection and try again.'
        : 'Could not save your password — check your connection and try again.';
      saving = false;
      render();
      return;
    }

    if (result?.error) {
      pendingError = describeError(result.error);
      saving = false;
      render();
      return;
    }

    // Left as "Saving…" on purpose: the caller replaces this screen at once, and a form that came
    // back to life in between would invite a second save of the same password.
    onSaved?.(result);
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      const headingNode = el('h1', {
        id: headingId,
        text: heading,
        attrs: { tabindex: '-1' },
      });
      container.appendChild(headingNode);
      if (intro) container.appendChild(el('p', { className: 'stage-meta', text: intro }));

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
      for (const node of footer()) container.appendChild(node);
      root.appendChild(container);

      if (feedback.dataset.tone === 'error') {
        firstRender = false;
        feedback.scrollIntoView?.({ block: 'nearest' });
        feedback.focus();
        return true;
      }
      if (firstRender) {
        // Arriving from another screen: land on the heading, so a screen reader says what this
        // screen is, instead of "Save password, button".
        firstRender = false;
        headingNode.focus();
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
