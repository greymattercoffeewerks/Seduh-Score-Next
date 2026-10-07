// Temporary login screen (2026-08-30) — a plain sign-in form against the
// existing auth.signInWithPassword, nothing more. No sign-up, no password
// reset, no tier/role gating: real access control (D14 entitlements,
// currently a permissive stub) is future work this screen deliberately
// does not anticipate. Account provisioning stays exactly as already
// decided elsewhere (ROADMAP.md: the single org's organiser is provisioned
// via service_role outside the app) — this only adds the missing piece,
// a way for an already-provisioned person to actually establish a session
// without typing signInWithPassword into devtools.
//
// Why it is built the way it is (live-event finding #2: a team member could not sign in on an
// iPad; the auth logs never record what was typed, so the cause is unconfirmed): the fields are read
// from the form at submit because iOS autofill can fill them without an input event; a password that
// is rejected AND has leading/trailing space (a chat paste) is retried once without it, but is never
// trimmed up front, so a password that really contains those spaces still works; Show/Hide flips the
// field in place, so nothing typed, autofilled or reported is lost by a re-render.
//
// Lives in core/, not a format directory — auth is format-agnostic.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField, passwordToggle, setBusyDisabled, withFocusPreservation } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export function validateCredentials(draft) {
  if (!draft.email.trim()) return 'Email is required.';
  if (!draft.password) return 'Password is required.';
  return null;
}

export const INVALID_CREDENTIALS_MESSAGE =
  'That email and password do not match. Check the email, and use the Show/Hide button to read the password back: capital letters count.';

// supabase-js reports a wrong email/password as code 'invalid_credentials' (older versions only
// carry the message).
export function isInvalidCredentials(error) {
  return (
    error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message ?? '')
  );
}

// `onTogglePassword(isShown)` lets the caller remember the choice across its own re-renders; the
// toggle itself changes the field in place.
export function renderLoginForm(
  draft,
  { disabled, showPassword = false, onTogglePassword = () => {} },
) {
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
  setBusyDisabled(emailInput, disabled);
  emailInput.addEventListener('input', () => {
    draft.email = emailInput.value;
  });
  // Autofill tends to fire `change` rather than `input`.
  emailInput.addEventListener('change', () => {
    draft.email = emailInput.value;
  });

  const passwordInput = el('input', {
    className: 'field-input',
    attrs: {
      type: showPassword ? 'text' : 'password',
      autocomplete: 'current-password',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      'aria-label': 'Password',
      'data-field': 'password',
      required: 'required',
    },
  });
  passwordInput.value = draft.password;
  setBusyDisabled(passwordInput, disabled);
  passwordInput.addEventListener('input', () => {
    draft.password = passwordInput.value;
  });
  passwordInput.addEventListener('change', () => {
    draft.password = passwordInput.value;
  });

  const [toggleButton, toggleStatus] = passwordToggle([passwordInput], {
    shown: showPassword,
    onToggle: onTogglePassword,
  });

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Signing in…' : 'Sign in',
    attrs: { type: 'submit', 'data-focus-key': 'submit' },
  });
  setBusyDisabled(submitButton, disabled);

  return el('form', { className: 'login-form' }, [
    labeledField('Email', emailInput),
    labeledField('Password', passwordInput, [toggleButton, toggleStatus]),
    submitButton,
  ]);
}

export async function mountLoginScreen(root, { client = getSupabase(), onSignedIn, signal } = {}) {
  let draft = { email: '', password: '' };
  let signingIn = false;
  let pendingError = null;
  let showPassword = false;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  // The values as the form shows them right now. `draft` follows input/change events, but iOS
  // autofill can fill a field without reporting it, so what is submitted is what is displayed.
  function syncDraftFromForm(form) {
    draft.email = form.querySelector('[data-field="email"]').value;
    draft.password = form.querySelector('[data-field="password"]').value;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    syncDraftFromForm(event.currentTarget);
    const validationError = validateCredentials(draft);
    if (validationError) {
      pendingError = validationError;
      render();
      return;
    }
    if (signingIn) return;
    signingIn = true;
    render();

    // Captured now: the field stays editable while the request is in flight, and the retry must
    // be of what was submitted, not of whatever has been typed since.
    const email = draft.email.trim();
    const password = draft.password;
    const attempt = (pw) =>
      raceTimeout(client.auth.signInWithPassword({ email, password: pw }), DEFAULT_LOAD_TIMEOUT_MS);

    let error;
    try {
      ({ error } = await attempt(password));
      // A password copied from a chat often carries a space at either end. Tried exactly as typed
      // first; only a rejection of that, with surrounding space present, earns one more try (which
      // spends a second sign-in from the venue's shared per-IP rate budget, so never otherwise).
      const trimmed = password.trim();
      if (
        error &&
        isInvalidCredentials(error) &&
        trimmed &&
        trimmed !== password &&
        !signal?.aborted
      ) {
        ({ error } = await attempt(trimmed));
      }
    } catch (err) {
      // A thrown exception here is a network/transport failure, not an
      // expected auth rejection (signInWithPassword's own documented
      // contract is to return {error}, not throw, for invalid
      // credentials) — this project's "unreliable venue wifi" design
      // target treats this as a real, expected failure mode. raceTimeout
      // itself throws the same way (with `.timedOut = true`) if the
      // request never settles at all — found missing in review: without
      // this wrap, a stalled connection left the form disabled and
      // "Signing in…" forever, with no way to even correct a typo and
      // retry.
      pendingError = err.timedOut
        ? 'This is taking longer than expected — check your connection and try again.'
        : 'Could not sign in — check your connection and try again.';
      signingIn = false;
      render();
      return;
    }

    if (error) {
      // Supabase Auth's own error messages (e.g. "Invalid login
      // credentials") are already meant to be shown to a user verbatim —
      // unlike core/errors.js's describeError(), which guards against
      // leaking a raw DB error's internals, this is the API's intended
      // user-facing text.
      pendingError = isInvalidCredentials(error) ? INVALID_CREDENTIALS_MESSAGE : error.message;
      signingIn = false;
      render();
      return;
    }

    onSignedIn?.();
  }

  function render() {
    // A discarded-but-still-in-flight signIn attempt (the router aborts
    // `signal` the instant a newer navigation starts) must never write to
    // `root` again — same guard shape as every other screen's own render()
    // entry point. See ROADMAP.md's "A real DOM-write race between the
    // router..." entry.
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      container.appendChild(el('h1', { text: 'Sign in' }));

      // `aria-live`/`role="status"` kept for consistency with every other
      // screen's feedback region, but the real delivery mechanism on THIS
      // screen is the explicit feedback.focus() below — root.innerHTML=''
      // rebuilds this node fresh every render(), and a live-region
      // announcement isn't reliably triggered by inserting an
      // already-populated new node (only by mutating an existing one).
      const feedback = el('div', {
        className: 'screen-feedback',
        attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
      });
      if (pendingError) {
        setFeedback(feedback, pendingError, 'error');
        pendingError = null;
      }

      const form = renderLoginForm(draft, {
        disabled: signingIn,
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
        feedback.scrollIntoView?.({ block: 'nearest' });
        feedback.focus();
        return true;
      }
    });
  }

  render();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
