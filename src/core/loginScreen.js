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
// Lives in core/, not a format directory — auth is format-agnostic.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export function validateCredentials(draft) {
  if (!draft.email.trim()) return 'Email is required.';
  if (!draft.password) return 'Password is required.';
  return null;
}

export function renderLoginForm(draft, { disabled }) {
  const emailInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'email',
      autocomplete: 'username',
      'aria-label': 'Email',
      'data-field': 'email',
      required: 'required',
    },
  });
  emailInput.value = draft.email;
  emailInput.disabled = disabled;
  emailInput.addEventListener('input', () => {
    draft.email = emailInput.value;
  });

  const passwordInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'password',
      autocomplete: 'current-password',
      'aria-label': 'Password',
      'data-field': 'password',
      required: 'required',
    },
  });
  passwordInput.value = draft.password;
  passwordInput.disabled = disabled;
  passwordInput.addEventListener('input', () => {
    draft.password = passwordInput.value;
  });

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Signing in…' : 'Sign in',
    attrs: { type: 'submit' },
  });
  submitButton.disabled = disabled;

  return el('form', { className: 'login-form' }, [
    labeledField('Email', emailInput),
    labeledField('Password', passwordInput),
    submitButton,
  ]);
}

export async function mountLoginScreen(root, { client = getSupabase(), onSignedIn, signal } = {}) {
  let draft = { email: '', password: '' };
  let signingIn = false;
  let pendingError = null;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationError = validateCredentials(draft);
    if (validationError) {
      pendingError = validationError;
      render();
      return;
    }
    if (signingIn) return;
    signingIn = true;
    render();

    let error;
    try {
      ({ error } = await raceTimeout(
        client.auth.signInWithPassword({
          email: draft.email.trim(),
          password: draft.password,
        }),
        DEFAULT_LOAD_TIMEOUT_MS,
      ));
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
      pendingError = error.message;
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

    const form = renderLoginForm(draft, { disabled: signingIn });
    form.addEventListener('submit', handleSubmit);

    container.appendChild(el('div', { className: 'card' }, [form]));
    container.appendChild(feedback);
    root.appendChild(container);

    if (feedback.dataset.tone === 'error') {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  render();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
