// Guess the Bean — participant entry flow (Phase 4, port of legacy's
// booth/guess/index.html: github.com/greymattercoffee/Seduh-Score, dev
// branch). Public, unauthenticated — no login anywhere on this screen, by
// design (the spec's own "no auth on audience surfaces" rule).
//
// Seven view states (legacy has the same shape, one more than the spec's
// own "six" count — 'loading' is real and distinct, just not itemized
// separately in the spec's prose): loading, no-session (no ?session= at
// all), not-found (session_id doesn't resolve to a real row), not-active
// (guess_enabled = false), closed (revealed = true), form, confirmed.
// `guess_enabled = false` wins over `revealed = true` when BOTH are true at
// once — ported byte-for-byte from legacy's own precedence
// (`data.guessEnabled === false ? 'not-active' : (data.revealed ? 'closed' : 'form')`),
// not re-derived from scratch.
//
// `?demo=1` (session id defaults to 'demo' if `?session=` is also omitted)
// skips the existence check entirely and always shows the form — AND skips
// the actual submit_guess RPC call on "submit," faking a confirmed result
// client-side only. This is the criterion the spec's own Phase 3 pass/fail
// list misattributed to booth/setup.html; the real legacy code for it lives
// here, confirmed by reading the actual source.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { fetchSessionStatus, submitGuess } from './sessions.js';

const GUESS_MAX = 100000000;

export function validateEntry(draft) {
  const errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > 80) errors.name = 'Name is too long (80 characters max).';

  const guessRaw = draft.guess.trim();
  const guess = Number.parseInt(guessRaw, 10);
  if (!/^\d+$/.test(guessRaw) || guess <= 0) {
    errors.guess = 'Enter a positive whole number.';
  } else if (guess > GUESS_MAX) {
    errors.guess = "That's too many beans — try something under 100 million.";
  }

  const phone = draft.phone.trim();
  const instagram = draft.instagram.trim();
  if (!phone && !instagram) {
    errors.contact = 'Enter a phone/WhatsApp number or Instagram username.';
  } else if (phone.length > 30 || instagram.length > 50) {
    errors.contact = 'Contact details are too long.';
  }

  return errors;
}

function parseSessionParams(search = window.location.search) {
  const params = new URLSearchParams(search);
  const demo = params.get('demo') === '1';
  const sessionId = demo ? params.get('session') || 'demo' : params.get('session');
  return { demo, sessionId };
}

// role="alert" on every error paragraph — each one IS its own live region
// (no separate aria-live wrapper needed), announced automatically the
// moment it's inserted. aria-invalid + aria-describedby on the offending
// input link the error back to its field for a screen-reader user tabbing
// through, not just a sighted one reading the layout. Found in review
// (ui-accessibility-reviewer): plain `<p>` error text with no live-region
// role or field association meant a screen-reader user submitting an
// invalid guess got total silence.
function fieldError(id, message) {
  return el('p', { className: 'gtb-field-error', text: message, attrs: { id, role: 'alert' } });
}

export function renderEntryForm(draft, { errors, submitting, submitError }) {
  const guessInput = el('input', {
    className: 'gtb-input gtb-guess-input',
    attrs: {
      type: 'number',
      min: '1',
      inputmode: 'numeric',
      placeholder: 'your guess',
      'aria-label': 'How many beans in the jar?',
      'data-field': 'guess',
    },
  });
  guessInput.value = draft.guess;
  setBusyDisabled(guessInput, submitting);
  guessInput.addEventListener('input', () => {
    draft.guess = guessInput.value;
  });
  if (errors.guess) {
    guessInput.setAttribute('aria-invalid', 'true');
    guessInput.setAttribute('aria-describedby', 'gtb-guess-error');
  }

  const nameInput = el('input', {
    className: 'gtb-input',
    attrs: { type: 'text', autocomplete: 'name', 'aria-label': 'Your name', 'data-field': 'name' },
  });
  nameInput.value = draft.name;
  setBusyDisabled(nameInput, submitting);
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
  });
  if (errors.name) {
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.setAttribute('aria-describedby', 'gtb-name-error');
  }

  const phoneInput = el('input', {
    className: 'gtb-input',
    attrs: {
      type: 'text',
      inputmode: 'tel',
      autocomplete: 'tel',
      'aria-label': 'Phone or WhatsApp — so we can reach you if you win',
      'data-field': 'phone',
    },
  });
  phoneInput.value = draft.phone;
  setBusyDisabled(phoneInput, submitting);
  phoneInput.addEventListener('input', () => {
    draft.phone = phoneInput.value;
  });

  const instagramInput = el('input', {
    className: 'gtb-input',
    attrs: {
      type: 'text',
      placeholder: '@yourhandle',
      autocapitalize: 'none',
      'aria-label': 'Instagram username',
      'data-field': 'instagram',
    },
  });
  instagramInput.value = draft.instagram;
  setBusyDisabled(instagramInput, submitting);
  instagramInput.addEventListener('input', () => {
    draft.instagram = instagramInput.value;
  });
  if (errors.contact) {
    // Applies to both — the error is about the phone/instagram PAIR, not
    // either field individually.
    phoneInput.setAttribute('aria-invalid', 'true');
    phoneInput.setAttribute('aria-describedby', 'gtb-contact-error');
    instagramInput.setAttribute('aria-invalid', 'true');
    instagramInput.setAttribute('aria-describedby', 'gtb-contact-error');
  }

  const submitButton = el('button', {
    className: 'gtb-btn gtb-btn-primary tap-target',
    text: submitting ? 'Locking it in…' : 'Lock in my guess 🫘',
    attrs: { type: 'submit', 'data-focus-key': 'submit' },
  });
  setBusyDisabled(submitButton, submitting);

  const fields = [
    labeledField(
      'How many beans in the jar?',
      guessInput,
      errors.guess ? [fieldError('gtb-guess-error', errors.guess)] : [],
    ),
    labeledField(
      'Your name',
      nameInput,
      errors.name ? [fieldError('gtb-name-error', errors.name)] : [],
    ),
    labeledField(
      'Phone / WhatsApp',
      phoneInput,
      [el('span', { className: 'gtb-field-hint', text: 'so we can reach you if you win' })],
    ),
    labeledField('Instagram username', instagramInput),
  ];

  const form = el('form', { className: 'gtb-entry-form' }, [
    ...fields,
    ...(errors.contact ? [fieldError('gtb-contact-error', errors.contact)] : []),
    submitButton,
    ...(submitError
      ? [
          el('p', {
            className: 'gtb-field-error gtb-contact-error',
            text: submitError,
            attrs: { id: 'gtb-submit-error', role: 'alert', tabindex: '-1' },
          }),
        ]
      : []),
    el('p', {
      className: 'gtb-fineprint',
      text: 'One of phone or Instagram is enough — we only use it to contact the winner.',
    }),
  ]);

  return form;
}

function heroEl() {
  return el('div', { className: 'gtb-hero', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'gtb-hero-bean gtb-hero-bean-1', text: '🫘' }),
    el('span', { className: 'gtb-hero-bean gtb-hero-bean-2', text: '🫘' }),
    el('span', { className: 'gtb-hero-bean gtb-hero-bean-3', text: '🫘' }),
    el('span', { className: 'gtb-hero-jar', text: '🫙' }),
  ]);
}

function statusCard(emoji, title, body) {
  return el('div', { className: 'gtb-screen gtb-status' }, [
    el('div', { className: 'gtb-status-emoji', text: emoji, attrs: { 'aria-hidden': 'true' } }),
    el('h1', { text: title }),
    el('p', { className: 'gtb-lead', text: body }),
  ]);
}

// Fixed 14-particle CSS burst, ported from legacy's own burstHtml() — pure
// decoration (aria-hidden), and entirely inert under prefers-reduced-motion
// via the matching CSS rule in entryScreen.css (same "layer motion on top of
// a static base state" pattern this codebase already applies elsewhere,
// e.g. timer.css's blink).
function confettiBurst() {
  const container = el('div', { className: 'gtb-burst', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const distance = 70 + (i % 4) * 22;
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance - 30);
    const rotate = Math.round((Math.random() - 0.5) * 540);
    const piece = el('i', { className: 'gtb-burst-piece' });
    piece.style.setProperty('--dx', `${dx}px`);
    piece.style.setProperty('--dy', `${dy}px`);
    piece.style.setProperty('--rot', `${rotate}deg`);
    piece.style.animationDelay = `${i * 18}ms`;
    container.appendChild(piece);
  }
  return container;
}

export async function mountEntryScreen(
  root,
  { client = getSupabase(), search = window.location.search, signal } = {},
) {
  const { demo, sessionId } = parseSessionParams(search);
  let view = 'loading';
  let draft = { name: '', guess: '', phone: '', instagram: '' };
  let errors = {};
  let submitting = false;
  let submitError = null;
  let submittedGuess = null;
  let pollTimer = null;
  let mounted = true;
  let lastFocusedView = null;

  function focusHeading() {
    const heading = root.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  // Every render() fully replaces the DOM, so without withFocusPreservation
  // (core/dom.js) every state change — a keystroke-driven re-render is NOT
  // one of these, since inputs mutate `draft` without calling render(), but
  // submitting/error/busy transitions all are — would silently drop focus
  // to <body>. On top of that generic restore, an actual VIEW change
  // (form -> closed via the realtime watch, form -> confirmed via submit,
  // the initial boot() landing on any state) has no equivalent control to
  // restore focus TO, so those cases explicitly move focus to the new
  // view's own heading instead — same `lastFocusedView`-gated pattern
  // setupScreen.js already established for its own three-view flow. Found
  // in review (ui-accessibility-reviewer): this file was written AFTER that
  // fix landed on its sibling screens but never got it applied here.
  function render() {
    if (signal?.aborted) return;
    const isViewChange = view !== lastFocusedView;
    lastFocusedView = view;

    withFocusPreservation(root, () => {
      root.innerHTML = '';

      if (view === 'loading') {
        root.appendChild(
          el('div', { className: 'gtb-screen' }, [
            el('div', { className: 'gtb-spinner', attrs: { role: 'status', 'aria-label': 'Loading' } }),
          ]),
        );
        return;
      }
      if (view === 'no-session') {
        root.appendChild(
          statusCard('🤔', 'Missing session', 'Scan the QR code on the big screen again.'),
        );
        focusHeading();
        return true;
      }
      if (view === 'not-found') {
        root.appendChild(
          statusCard('☕', 'No active session found', 'Ask the friendly humans at the booth for help.'),
        );
        focusHeading();
        return true;
      }
      if (view === 'not-active') {
        root.appendChild(
          statusCard(
            '☕',
            "Guess the Bean isn't running right now",
            'Check out what else is happening at the booth!',
          ),
        );
        focusHeading();
        return true;
      }
      if (view === 'closed') {
        root.appendChild(
          statusCard(
            '🔒',
            'Guessing is closed',
            'Look up! The results are being revealed on the big screen.',
          ),
        );
        focusHeading();
        return true;
      }
      if (view === 'form') {
        const form = renderEntryForm(draft, { errors, submitting, submitError });
        form.addEventListener('submit', handleSubmit);
        root.appendChild(
          el('section', { className: 'gtb-screen gtb-entry-screen' }, [
            heroEl(),
            el('h1', { text: 'Guess the Bean' }),
            el('p', { className: 'gtb-lead', text: 'One jar. One winner. How good is your gut?' }),
            el('div', { className: 'gtb-card' }, [form]),
          ]),
        );
        if (isViewChange) {
          focusHeading();
          return true;
        }
        // Not a view change — either a busy/submitting re-render (let
        // withFocusPreservation restore focus to the submit button/field
        // it came from) or a validation/submit-error re-render (move focus
        // to the specific error instead, since there's nothing to
        // "preserve" — the field that failed validation never lost focus
        // in the user's own mental model, but explicitly re-announcing the
        // error is more useful here than silently restoring to wherever
        // the cursor happened to be).
        if (errors.guess || errors.name || errors.contact) {
          // Only 3 error keys exist (validateEntry's own return shape):
          // guess/name/contact — 'contact' has no matching data-field of
          // its own, since it's attached to BOTH phone and instagram
          // (renderEntryForm sets aria-describedby on both); focusing
          // 'phone' first is an arbitrary but reasonable choice between the
          // two, not a 4th, more general field this ternary is pretending
          // to support.
          const firstErrorField = errors.guess ? 'guess' : errors.name ? 'name' : 'phone';
          root.querySelector(`[data-field="${firstErrorField}"]`)?.focus();
          return true;
        }
        if (submitError) {
          root.querySelector('#gtb-submit-error')?.focus();
          return true;
        }
        return;
      }
      if (view === 'confirmed') {
        root.appendChild(
          el('section', { className: 'gtb-screen gtb-confirm-screen' }, [
            confettiBurst(),
            el('div', { className: 'gtb-confirm-check', attrs: { 'aria-hidden': 'true' }, text: '✓' }),
            el('h1', { text: `You're in, ${draft.name}!` }),
            el('p', { className: 'gtb-confirm-label', text: 'Your guess' }),
            el('p', { className: 'gtb-guess-pill', text: String(submittedGuess) }),
            el('p', {
              className: 'gtb-lead',
              text: 'Eyes on the big screen — the closest guess takes the win. Good luck! 🍀',
            }),
          ]),
        );
        focusHeading();
        return true;
      }
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    errors = validateEntry(draft);
    if (Object.keys(errors).length) {
      render();
      return;
    }
    submitting = true;
    submitError = null;
    render();

    const guess = Number.parseInt(draft.guess.trim(), 10);
    if (!demo) {
      try {
        await raceTimeout(
          submitGuess(
            {
              sessionId,
              name: draft.name.trim(),
              guess,
              phone: draft.phone.trim(),
              instagram: draft.instagram.trim(),
            },
            client,
          ),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
      } catch (err) {
        submitting = false;
        submitError = err.timedOut
          ? 'This is taking longer than expected — check your connection and try again.'
          : describeError(err);
        render();
        return;
      }
    }

    submitting = false;
    submittedGuess = guess;
    view = 'confirmed';
    render();
  }

  function computeView(status) {
    if (!status) return 'not-found';
    if (!status.guess_enabled) return 'not-active';
    if (status.revealed) return 'closed';
    return 'form';
  }

  // Polling, not Supabase Realtime (postgres_changes) — deliberate, and NOT
  // the first choice. A postgres_changes subscription was built and tested
  // first (same shape as core/viewer-shell.js's own realtime watch), but
  // live-testing against this project's local Supabase stack found it never
  // delivers a single event for THIS table — `realtime.subscription` never
  // gains a row for it despite the client reporting SUBSCRIBED, while the
  // existing `live_sessions` channel (viewer-shell.js's own, unchanged)
  // keeps working correctly side by side on the same stack. Tried: a full
  // `supabase stop`/`start` cycle, a plain `docker restart` of the realtime
  // container, and a brand-new, uniquely-named, trivially-public table
  // (ruling out any `public.sessions`/`auth.sessions` name collision) — all
  // three still failed to register a subscription. Root cause not
  // conclusively found (a local self-hosted Realtime container quirk this
  // project's actual deployment target — a managed cloud Supabase project,
  // per CLAUDE.md's Repo section — may not even share), but there's a
  // second, independent reason not to just ship it once delivery worked:
  // this table's `anon` grant is column-scoped (id/guess_enabled/revealed/
  // orientation only, deliberately excluding creator_id/name/bean_count —
  // 20260914121000_guess_the_bean_rls.sql), and Postgres logical replication
  // (what postgres_changes is built on) reads the WAL directly, which has no
  // concept of column-level GRANTs — only RLS is enforced per-row for
  // realtime delivery. Whether a working subscription would have leaked the
  // withheld columns to anon was never actually verified, because delivery
  // itself failed first. Polling reuses the exact same anon-safe
  // `fetchSessionStatus` REST call this screen's own initial load already
  // uses — already proven column-safe — so it carries no version of that
  // open question at all. Revisit real Realtime for this table only once
  // it's verified working AND column-safe against an actual environment,
  // not assumed either way.
  const STATUS_POLL_MS = 4000;
  // Guards against overlapping ticks on a slow connection (a booth's shared
  // wifi, the exact condition this project designs around elsewhere) —
  // setInterval fires every STATUS_POLL_MS regardless of whether the
  // PREVIOUS tick's fetch already resolved. Without this, two fetches could
  // be in flight at once; harmless in isolation (both still gate on
  // `view === 'form'`), but wasted requests are still worth skipping
  // outright rather than merely tolerating. Found in review (code-reviewer).
  let pollInFlight = false;

  async function pollStatus() {
    if (view !== 'form' || pollInFlight) return;
    pollInFlight = true;
    let status;
    try {
      status = await fetchSessionStatus(sessionId, client);
    } catch {
      return; // a transient poll failure — the form stays open, matching
      // legacy's own silently-ignored onSnapshot error callback; a
      // submitted guess is already safe regardless, and the next poll tries
      // again.
    } finally {
      pollInFlight = false;
    }
    // Re-checked AFTER the await, not just before it — a poll in flight
    // when unmount() runs must not still call render() against a `root`
    // the caller believes is torn down.
    if (!mounted || view !== 'form') return;
    const nextView = computeView(status);
    if (nextView !== 'form') {
      view = nextView;
      render();
    }
  }

  async function boot() {
    if (!sessionId) {
      view = 'no-session';
      render();
      return;
    }
    if (demo) {
      view = 'form';
      render();
      return;
    }

    // `view` is already 'loading' at this point — render it BEFORE awaiting
    // the fetch below, not after. Without this, every real (non-demo)
    // participant saw a blank screen for the whole network round-trip
    // instead of the spinner the 'loading' branch implies exists — found in
    // review (code-reviewer), matching the shape setupScreen.js's own
    // loadSessions() already gets right (render 'loading' first, then await).
    render();
    let status;
    try {
      status = await raceTimeout(fetchSessionStatus(sessionId, client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch {
      view = 'not-found';
      render();
      return;
    }
    view = computeView(status);
    render();

    if (view === 'form') {
      pollTimer = setInterval(pollStatus, STATUS_POLL_MS);
    }
  }

  await boot();

  return {
    unmount() {
      mounted = false;
      clearInterval(pollTimer);
    },
  };
}
