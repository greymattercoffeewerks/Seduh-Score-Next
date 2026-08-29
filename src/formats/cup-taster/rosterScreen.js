// Roster registration screen (handoff §14 T4.1's own known gap — setup.js's
// module comment always pointed here: "Roster registration itself is
// core/registry's registerEntry ... nothing Cup-Taster-specific about
// registering a person and entering them into an event, so it lives there,
// reusable by a future identity-core format." This screen is the DOM layer
// on top of that already-shared, already-tested logic — same relationship
// setupScreen.js has to setup.js's validateStagePlan/saveStagePlan.
//
// Withdraw/reinstate, not remove: event_entries is a snapshot real event
// data (ct_stage_entries, ct_heats, ct_results) keys off by entry_id with
// `on delete cascade`, so deleting a row instead of flagging it could
// silently destroy already-recorded results. heats.js's own roster read
// already filters withdrawn entries out of generation; this screen is
// simply the one place that flag gets set (core/registry.setEntryWithdrawn,
// new — nothing could set it before this).
//
// Rebuild-then-refocus throughout (§15.3): both the registration form and
// the roster list re-render from a fresh state snapshot on every action.
// Draft form state (`draft`, closure-level) is mutated SYNCHRONOUSLY by
// every field's own input handler, before any await — the same discipline
// setupScreen.js's draftStages establishes — so a withdraw/reinstate toggle
// elsewhere on the screen (which also triggers a full render()) rebuilds
// the registration form from whatever the organiser has typed so far,
// rather than wiping it blank mid-entry.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listEntries, registerEntry, setEntryWithdrawn } from '../../core/registry.js';

function blankDraft() {
  return { displayName: '', phone: '', email: '', cafe: '', bib: '' };
}

// Pure. Trims every field; blank optional fields collapse to null rather
// than an empty string, matching registerPerson/createEntry's own `?? null`
// convention for optional columns.
export function buildCupperFromDraft(draft) {
  return {
    displayName: draft.displayName.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim() || null,
    cafe: draft.cafe.trim() || null,
    bib: draft.bib.trim() || null,
  };
}

// Pure. D16: name and phone are the two required fields — email is
// optional, cafe/bib are display-only extras. Returns a user-facing message
// naming the specific missing field, or null when the draft is submittable.
export function validateDraft(draft) {
  if (!draft.displayName.trim()) return 'Name is required.';
  if (!draft.phone.trim()) return 'Phone is required.';
  return null;
}

export function renderRegistrationForm(draft, { disabled }) {
  const nameInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'Name', 'data-field': 'displayName' },
  });
  nameInput.value = draft.displayName;
  nameInput.disabled = disabled;
  nameInput.addEventListener('input', () => {
    draft.displayName = nameInput.value;
  });

  const phoneInput = el('input', {
    className: 'field-input',
    attrs: { type: 'tel', 'aria-label': 'Phone', 'data-field': 'phone' },
  });
  phoneInput.value = draft.phone;
  phoneInput.disabled = disabled;
  phoneInput.addEventListener('input', () => {
    draft.phone = phoneInput.value;
  });

  const emailInput = el('input', {
    className: 'field-input',
    attrs: { type: 'email', 'aria-label': 'Email (optional)', 'data-field': 'email' },
  });
  emailInput.value = draft.email;
  emailInput.disabled = disabled;
  emailInput.addEventListener('input', () => {
    draft.email = emailInput.value;
  });

  const cafeInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'Cafe (optional)', 'data-field': 'cafe' },
  });
  cafeInput.value = draft.cafe;
  cafeInput.disabled = disabled;
  cafeInput.addEventListener('input', () => {
    draft.cafe = cafeInput.value;
  });

  const bibInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'Bib (optional)', 'data-field': 'bib' },
  });
  bibInput.value = draft.bib;
  bibInput.disabled = disabled;
  bibInput.addEventListener('input', () => {
    draft.bib = bibInput.value;
  });

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Registering…' : 'Register',
    attrs: { type: 'submit' },
  });
  submitButton.disabled = disabled;

  return el(
    'form',
    { className: 'card roster-form', attrs: { 'aria-labelledby': 'roster-form-heading' } },
    [
      el('h2', { id: 'roster-form-heading', text: 'Register a cupper' }),
      el('div', { className: 'roster-form-fields' }, [
        labeledField('Name', nameInput),
        labeledField('Phone', phoneInput),
        labeledField('Email', emailInput),
        labeledField('Cafe', cafeInput),
        labeledField('Bib', bibInput),
      ]),
      submitButton,
    ],
  );
}

export function renderRosterEntries(entries, { onToggleWithdrawn, disabled }) {
  if (entries.length === 0) {
    return el('p', { className: 'stage-meta', text: 'No cuppers registered yet.' });
  }

  const sorted = [...entries].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const items = sorted.map((entry) => {
    const meta = [entry.cafe, entry.bib ? `Bib ${entry.bib}` : null].filter(Boolean).join(' · ');

    const toggleButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: entry.withdrawn ? 'Reinstate' : 'Withdraw',
      attrs: {
        type: 'button',
        id: `roster-toggle-${entry.id}`,
        'aria-label': `${entry.withdrawn ? 'Reinstate' : 'Withdraw'} ${entry.display_name}`,
      },
    });
    toggleButton.disabled = disabled;
    toggleButton.addEventListener('click', () => onToggleWithdrawn(entry));

    return el(
      'li',
      { attrs: { id: `roster-row-${entry.id}`, 'data-withdrawn': String(entry.withdrawn) } },
      [
        el(
          'div',
          { className: 'roster-entry-info' },
          [
            el('span', { text: entry.display_name }),
            meta ? el('span', { className: 'stage-meta', text: meta }) : null,
            entry.withdrawn
              ? el('span', { className: 'roster-withdrawn-tag', text: 'Withdrawn' })
              : null,
          ].filter(Boolean),
        ),
        toggleButton,
      ],
    );
  });

  return el(
    'ul',
    { className: 'roster-list', attrs: { 'aria-label': 'Registered cuppers' } },
    items,
  );
}

export async function mountRosterScreen(root, { eventId, client = getSupabase() } = {}) {
  let event = null;
  let entries = [];
  let draft = blankDraft();
  let busy = false;
  let pendingError = null;
  let pendingSuccess = null;
  let focusAfterRender = null;
  let loadFailedMessage = null;
  let loading = false;

  async function loadPersisted() {
    const [ev, evEntries] = await Promise.all([
      findEvent(eventId, client),
      listEntries(eventId, client),
    ]);
    return { event: ev, entries: evEntries };
  }

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  // A defined loading state, not a blank screen — loadPersisted() is two
  // parallel reads, but this project's "unreliable venue wifi" design
  // target means `root` can sit empty for a real stretch of time.
  // heatsScreen.js/setupScreen.js/reportScreen.js all establish this same
  // precedent; reused here rather than skipped. attemptLoad() below bounds
  // how long this can show for (DEFAULT_LOAD_TIMEOUT_MS, core/timeout.js's
  // raceTimeout) — 2026-08-29 follow-up closing a real gap shared with
  // setupScreen.js: a request that neither resolves nor rejects used to
  // leave this screen stuck here indefinitely, with no retry affordance
  // (see CHANGELOG.md's dated entry).
  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container roster-screen' });
    container.appendChild(el('h1', { text: 'Roster' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading roster…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    // Found in review (ui-accessibility-reviewer): a Retry click destroys
    // the focused Retry button (root.innerHTML = '' above) with nothing
    // taking its place — without this, a keyboard/screen-reader user gets
    // total silence for up to DEFAULT_LOAD_TIMEOUT_MS after clicking Retry,
    // with no confirmation the click even registered. Harmless on the
    // initial mount, where nothing was focused yet.
    feedback.focus();
  }

  function renderLoadError() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container roster-screen' });
    container.appendChild(el('h1', { text: 'Roster' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => {
      attemptLoad();
    });
    container.appendChild(retryButton);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  // Races loadPersisted() against a timeout so a hung request (this
  // project's "unreliable venue wifi" design target) never leaves the
  // screen stuck on renderLoading() forever — mirrors setupScreen.js's own
  // attemptLoad(), see its comment for the full reasoning. `loading` guards
  // against a double-click starting two concurrent loads.
  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      event = persisted.event;
      entries = persisted.entries;
      loadFailedMessage = null;
      // Found in review (ui-accessibility-reviewer): without this, a
      // successful Retry silently dropped focus to <body> — see
      // setupScreen.js's own identical fix for the full reasoning.
      focusAfterRender = '#roster-heading';
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render();
  }

  function render() {
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container roster-screen' });

    if (event?.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', { id: 'roster-heading', text: 'Roster', attrs: { tabindex: '-1' } }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta',
        text: `${entries.length} cupper${entries.length === 1 ? '' : 's'} registered`,
      }),
    );

    const feedback = el('div', {
      id: 'roster-feedback',
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      setFeedback(feedback, pendingError, 'error');
      pendingError = null;
    } else if (pendingSuccess) {
      setFeedback(feedback, pendingSuccess, 'success');
      pendingSuccess = null;
    }

    const form = renderRegistrationForm(draft, { disabled: busy });
    form.addEventListener('submit', handleRegister);
    container.appendChild(form);

    container.appendChild(
      renderRosterEntries(entries, { onToggleWithdrawn: handleToggleWithdrawn, disabled: busy }),
    );

    container.appendChild(feedback);
    root.appendChild(container);

    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone === 'error' || feedback.dataset.tone === 'success') {
      // A registration/withdrawal message lives only in this live region, on
      // a node that's destroyed and rebuilt fresh every render (`root.innerHTML
      // = ''` above) — many screen-reader/browser pairs don't reliably
      // announce a brand-new node's content the way they announce a mutation
      // to a persisting one. Moving focus here is what actually guarantees
      // the outcome gets spoken, for both tones, not just error (found in
      // review: only the error tone had this before, leaving every
      // successful registration — the common case on a repeat-many-times
      // screen like this one — silently unconfirmed for a keyboard/AT user).
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  async function handleRegister(domEvent) {
    domEvent.preventDefault();
    if (busy) return;

    const validationMessage = validateDraft(draft);
    if (validationMessage) {
      pendingError = validationMessage;
      render();
      return;
    }

    busy = true;
    render();

    const alreadyRegisteredIds = new Set(entries.map((entry) => entry.id));

    try {
      const cupper = buildCupperFromDraft(draft);
      const result = await registerEntry(event.org_id, eventId, cupper, client);
      try {
        const persisted = await loadPersisted();
        event = persisted.event;
        entries = persisted.entries;
        // result.display_name in both branches — the canonical stored name,
        // never the just-typed draft text, which registerEntry deliberately
        // leaves untouched on a duplicate registration and so can diverge
        // from it (a typo, different casing, a partial name).
        pendingSuccess = alreadyRegisteredIds.has(result.id)
          ? `${result.display_name} is already registered for this event.`
          : `${result.display_name} registered.`;
        draft = blankDraft();
      } catch {
        // The write itself already succeeded by this point — a failure
        // here is only the confirmation read, not the registration. Same
        // hedge setupScreen.js/scoringScreen.js use for their own
        // post-write re-fetch: don't tell the organiser it failed when it
        // may well have succeeded (the next successful load self-corrects).
        pendingSuccess = 'Registered, but the screen could not refresh — reload to see the roster.';
        draft = blankDraft();
      }
    } catch (err) {
      pendingError = describeError(err);
    }

    busy = false;
    render();
  }

  async function handleToggleWithdrawn(entry) {
    if (busy) return;
    busy = true;
    render();

    // Captured before the write, not read back off `entry` afterward — a
    // caller's row object is otherwise not guaranteed to still reflect its
    // pre-toggle state by the time the await resolves.
    const wasWithdrawn = entry.withdrawn;

    try {
      await setEntryWithdrawn(entry.id, !wasWithdrawn, client);
      try {
        const persisted = await loadPersisted();
        event = persisted.event;
        entries = persisted.entries;
        pendingSuccess = `${entry.display_name} ${wasWithdrawn ? 'reinstated' : 'withdrawn'}.`;
      } catch {
        pendingSuccess = 'Saved, but the screen could not refresh — reload to see the roster.';
      }
      focusAfterRender = `#roster-toggle-${entry.id}`;
    } catch (err) {
      pendingError = describeError(err);
      focusAfterRender = `#roster-toggle-${entry.id}`;
    }

    busy = false;
    render();
  }

  await attemptLoad();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
