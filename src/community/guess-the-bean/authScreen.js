// Guess the Bean — magic-link auth stub (Phase 2 of
// Handoffs and Specs/guess-the-bean-next-port-SPEC.md). Supabase
// `signInWithOtp({ email })` only — no password field anywhere in this file,
// no sign-up flow, no password reset. This is a DIFFERENT auth surface from
// core/loginScreen.js's temporary `signInWithPassword` organiser console
// login: that one is a placeholder ahead of D14 entitlements for the
// single-org Cup Taster console; this one is Guess the Bean's own locked
// spec decision (many creators, each a Community-tier account, no org
// concept at all — see supabase/migrations/20260914120000_guess_the_bean_tables.sql's
// own comment on why sessions.creator_id anchors directly to auth.users(id)).
//
// Lives in src/community/, not core/ — this auth flow is Guess-the-Bean-
// specific (its own redirect target, its own copy), not format-agnostic
// infrastructure a future format would reuse unedited. See
// src/community/guess-the-bean/CLAUDE.md for why this tool doesn't fit
// src/tools/ (has auth+Supabase) or src/formats/<format>/ (no roster/
// scoring/advancement) either.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

export function validateEmail(draft) {
  if (!draft.email.trim()) return 'Email is required.';
  return null;
}

export function renderAuthForm(draft, { disabled, linkSent }) {
  const emailInput = el('input', {
    className: 'gtb-input',
    attrs: {
      type: 'email',
      autocomplete: 'email',
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

  const submitButton = el('button', {
    className: 'gtb-btn gtb-btn-primary tap-target',
    text: disabled ? 'Sending…' : linkSent ? 'Resend link' : 'Send magic link',
    attrs: { type: 'submit', 'data-focus-key': 'submit' },
  });
  setBusyDisabled(submitButton, disabled);

  return el('form', { className: 'gtb-auth-form' }, [
    labeledField('Email', emailInput),
    submitButton,
  ]);
}

export async function mountAuthScreen(root, { client = getSupabase(), onSignedIn, signal } = {}) {
  let draft = { email: '' };
  let sending = false;
  let linkSent = false;
  let pendingError = null;
  let pendingNotice = null;

  // A magic link's own redirect lands back on THIS page with the session
  // already established (Supabase's client parses the URL fragment itself)
  // — onAuthStateChange, not a one-time getSession() poll, is what actually
  // catches that SIGNED_IN transition, since it can fire asynchronously
  // after this function has already returned. Mirrors appShell.js's own
  // reactive subscription shape.
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') onSignedIn?.();
  });

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationError = validateEmail(draft);
    if (validationError) {
      pendingError = validationError;
      render();
      return;
    }
    if (sending) return;
    sending = true;
    render();

    let error;
    try {
      ({ error } = await raceTimeout(
        client.auth.signInWithOtp({
          email: draft.email.trim(),
          // origin + pathname only, never the raw href — a query string or
          // hash present when the form is submitted (a shared link with a
          // tracking param, say) would otherwise round-trip into the email
          // and back for no reason. Not yet a live bug (this page has no
          // router of its own to add one), but Phase 3 plausibly adds
          // client-side routing here, at which point a stray param would
          // become a real one. Found in review (code-reviewer).
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        }),
        DEFAULT_LOAD_TIMEOUT_MS,
      ));
    } catch (err) {
      // Same "unreliable venue wifi" design target as loginScreen.js — a
      // stalled request must never leave the form disabled forever.
      pendingError = err.timedOut
        ? 'This is taking longer than expected — check your connection and try again.'
        : 'Could not send the link — check your connection and try again.';
      sending = false;
      render();
      return;
    }

    sending = false;
    if (error) {
      pendingError = error.message;
      render();
      return;
    }

    linkSent = true;
    pendingNotice = `Check ${draft.email.trim()} for a sign-in link.`;
    render();
  }

  function render() {
    // Same router-navigation-race guard as every other screen — see
    // CONVENTIONS.md's "Rebuild-then-refocus, never refocus-then-rebuild."
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'gtb-screen gtb-auth-screen' });
      container.appendChild(el('h1', { text: 'Sign in' }));
      container.appendChild(
        el('p', {
          className: 'gtb-auth-copy',
          text: 'No password — we’ll email you a link to sign in.',
        }),
      );

      const feedback = el('div', {
        className: 'gtb-feedback',
        attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
      });
      if (pendingError) {
        setFeedback(feedback, pendingError, 'error');
        pendingError = null;
      } else if (pendingNotice) {
        setFeedback(feedback, pendingNotice, 'success');
        pendingNotice = null;
      }

      const form = renderAuthForm(draft, { disabled: sending, linkSent });
      form.addEventListener('submit', handleSubmit);

      container.appendChild(el('div', { className: 'gtb-card' }, [form]));
      container.appendChild(feedback);
      root.appendChild(container);

      if (feedback.dataset.tone) {
        feedback.scrollIntoView?.({ block: 'nearest' });
        feedback.focus();
        return true;
      }
    });
  }

  render();

  return {
    unmount() {
      subscription.unsubscribe();
    },
  };
}
