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

// 12 since 2026-10-29: the cloud project's minimum password length is 12, and a shorter one is refused as
// `weak_password` (worded as "too easy to guess"), so the form says it before the request is made.
export const MIN_PASSWORD_LENGTH = 12;

// `minLength` is optional: a console that wants a longer password than the default (the admin console asks for
// 12) passes its own; everyone else keeps the project minimum.
export function validateNewPassword(password, confirmation, minLength = MIN_PASSWORD_LENGTH) {
  return checkNewPassword(password, confirmation, minLength)?.message ?? null;
}

// The same checks, naming the box at fault (`data-field`) so a screen can mark it: `{ message, field }` or null.
function checkNewPassword(password, confirmation, minLength) {
  if (!password) return { message: 'Choose a password.', field: 'password' };
  if (password.length < minLength) {
    return { message: `Use at least ${minLength} characters.`, field: 'password' };
  }
  if (password !== confirmation) {
    return { message: 'The two passwords do not match.', field: 'confirmation' };
  }
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
  // The project requires the current password to set a new one (a recovery link is the exception). Retrying the
  // same thing cannot help, so say which password it wants.
  if (error?.code === 'current_password_required' || error?.code === 'current_password_mismatch') {
    return context === 'current'
      ? 'That is not your current password.'
      : 'That is not the one-time password you were given. Check it and try again.';
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

// With `askCurrent`, a "Current password" box comes first (autocomplete `current-password`); the caller decides
// what to do with it. Off for every existing screen.
export function renderSetPasswordForm(
  draft,
  {
    disabled,
    showPassword = false,
    onTogglePassword,
    focusKey = 'set-password-submit',
    askCurrent = false,
    currentLabel = 'Current password',
    // Opt-in (the admin console): see mountPasswordFormScreen.
    toggleCurrent = false,
    inlineErrors = false,
    invalidField = null,
    errorId = null,
  },
) {
  function passwordInput(key, label, autocomplete = 'new-password') {
    const input = el('input', {
      className: 'field-input',
      attrs: {
        type: 'password',
        autocomplete,
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
    if (inlineErrors && invalidField === key) {
      input.setAttribute('aria-invalid', 'true');
      if (errorId) input.setAttribute('aria-describedby', errorId);
    }
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => {
        draft[key] = input.value;
        // The person is fixing it: the mark goes (the message line stays until the next submit).
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      });
    }
    return input;
  }

  const currentInput = askCurrent
    ? passwordInput('current', currentLabel, 'current-password')
    : null;
  const newInput = passwordInput('password', 'New password');
  const confirmInput = passwordInput('confirmation', 'Confirm password');
  // One toggle for the new-password boxes: seeing them side by side is how a typo is spotted. With `toggleCurrent`
  // it flips the current-password box too, so one control shows or hides every password in the form.
  const toggled =
    toggleCurrent && currentInput
      ? [currentInput, newInput, confirmInput]
      : [newInput, confirmInput];
  const [toggleButton, toggleStatus] = passwordToggle(toggled, {
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

  // `novalidate`: the browser's own "Please fill out this field" bubble would pre-empt the screen's worded
  // message (and is not worded for this product). `required` stays, for assistive technology.
  return el('form', { className: 'login-form', attrs: inlineErrors ? { novalidate: '' } : {} }, [
    ...(currentInput ? [labeledField(currentLabel, currentInput)] : []),
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
    minLength = MIN_PASSWORD_LENGTH,
    // Ask for the current password too; `save(password, currentPassword)` then receives it.
    askCurrent = false,
    // What the extra box is called ("Current password", or "One-time password" on the screen that follows one).
    currentLabel = 'Current password',
    // Opt-in, default off so the organiser console is unchanged: the Show/Hide toggle also covers the current-password
    // box; and `inlineErrors` swaps the browser's native required bubble for the screen's own message, marks the box
    // at fault `aria-invalid` (linked to the message with `aria-describedby`, cleared once typed in) and moves focus
    // to it instead of to the message line (the link makes the message read from there, so it is not said twice).
    toggleCurrent = false,
    inlineErrors = false,
  },
) {
  const draft = { current: '', password: '', confirmation: '' };
  let saving = false;
  let pendingError = null;
  let pendingField = null;
  const errorId = `${headingId ?? 'password-form'}-error`;
  let showPassword = false;
  let firstRender = true;

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    // What the boxes show now, not only what input events reported (iOS autofill / password managers).
    const form = event.currentTarget;
    draft.password = form.querySelector('[data-field="password"]').value;
    draft.confirmation = form.querySelector('[data-field="confirmation"]').value;
    if (askCurrent) draft.current = form.querySelector('[data-field="current"]').value;

    const invalid =
      askCurrent && !draft.current
        ? { message: `Enter your ${currentLabel.toLowerCase()}.`, field: 'current' }
        : checkNewPassword(draft.password, draft.confirmation, minLength);
    if (invalid) {
      pendingError = invalid.message;
      pendingField = invalid.field;
      render();
      return;
    }

    saving = true;
    render();
    const password = draft.password;
    const current = draft.current;
    let result;
    try {
      result = await save(password, current);
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
        id: inlineErrors ? errorId : undefined,
        className: 'screen-feedback',
        attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
      });
      if (pendingError) {
        setFeedback(feedback, pendingError, 'error');
        pendingError = null;
      }
      const invalidField = pendingField;
      pendingField = null;

      const form = renderSetPasswordForm(draft, {
        disabled: saving,
        showPassword,
        askCurrent,
        currentLabel,
        toggleCurrent,
        inlineErrors,
        invalidField,
        errorId,
        onTogglePassword: (isShown) => {
          showPassword = isShown;
        },
      });
      form.addEventListener('submit', handleSubmit);

      container.appendChild(el('div', { className: 'card' }, [form]));
      container.appendChild(feedback);
      for (const node of footer()) container.appendChild(node);
      root.appendChild(container);

      const fieldAtFault =
        inlineErrors && invalidField && form.querySelector(`[data-field="${invalidField}"]`);
      if (fieldAtFault) {
        firstRender = false;
        fieldAtFault.focus();
        return true;
      }
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
