// Events list/create screen (2026-08-29 app-wiring pass) — the organiser's
// real landing page, closing a gap that blocked the whole app from being
// usable at all: without this, creating the one real event for October
// meant a manual Studio insert, which contradicts this project's own
// "project quality, reliability and trustworthiness" bar for its first
// live/audience use.
//
// Lives in `core/`, not `formats/cup-taster/` — `core/events.js` already
// treats `format` as plain caller-supplied input (a future format calls
// `createEvent`/`listEventsForOrg` unedited), so the screen listing/
// creating those same rows is the same kind of module. The one rule this
// file must hold to: it never hardcodes `'cup_taster'` internally —
// `defaultFormat` is a caller-supplied prop (main.js's own route wiring
// passes it in), keeping that literal in the one composition-root file
// already allowed to know about Cup Taster.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField } from './dom.js';
import { describeError } from './errors.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { createEvent, listEventsForOrg } from './events.js';

export function blankDraft() {
  return { name: '', eventDate: '', venue: '', isTest: false };
}

// Pure. Name is the only required field — date/venue are optional
// metadata, matching createEvent's own `?? null` handling for them.
export function validateDraft(draft) {
  if (!draft.name.trim()) return 'Name is required.';
  return null;
}

export function renderEventsList(events) {
  if (events.length === 0) {
    return el('p', { className: 'stage-meta', text: 'No events yet — create one below.' });
  }
  const items = events.map((event) => {
    const link = el('a', {
      text: event.name,
      attrs: { href: `#/events/${event.id}` },
    });
    const meta = [event.event_date, event.venue].filter(Boolean).join(' · ');
    const children = [link];
    if (meta) children.push(el('span', { className: 'stage-meta', text: meta }));
    if (event.is_test) {
      children.push(el('span', { className: 'is-test-indicator', text: 'Test data' }));
    }
    return el('li', {}, children);
  });
  return el('ul', { className: 'events-list' }, items);
}

// `disabled`, not a checked-state-only lock — matches renderRegistrationForm's
// own established shape (rosterScreen.js) for a create form disabled
// in-flight.
export function renderCreateForm(draft, { disabled }) {
  const nameInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'Event name', 'data-field': 'name', required: 'required' },
  });
  nameInput.value = draft.name;
  nameInput.disabled = disabled;
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
  });

  const dateInput = el('input', {
    className: 'field-input',
    attrs: { type: 'date', 'aria-label': 'Event date (optional)', 'data-field': 'eventDate' },
  });
  dateInput.value = draft.eventDate;
  dateInput.disabled = disabled;
  dateInput.addEventListener('input', () => {
    draft.eventDate = dateInput.value;
  });

  const venueInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'Venue (optional)', 'data-field': 'venue' },
  });
  venueInput.value = draft.venue;
  venueInput.disabled = disabled;
  venueInput.addEventListener('input', () => {
    draft.venue = venueInput.value;
  });

  // Defaults UNCHECKED — D9's "unmistakable" bar means the organiser
  // actively opts IN to marking something test data, never the reverse.
  // Every other screen in this app only ever DISPLAYS is_test (the
  // is-test-banner); this is the one place it's actually set.
  const isTestInput = el('input', {
    attrs: { type: 'checkbox', 'data-field': 'isTest' },
  });
  isTestInput.checked = draft.isTest;
  isTestInput.disabled = disabled;
  isTestInput.addEventListener('change', () => {
    draft.isTest = isTestInput.checked;
  });
  const isTestField = el('label', { className: 'checkbox-field' }, [
    isTestInput,
    el('span', { text: 'This is test data' }),
  ]);

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Creating…' : 'Create event',
    attrs: { type: 'submit' },
  });
  submitButton.disabled = disabled;

  return el('form', { className: 'create-event-form' }, [
    labeledField('Event name', nameInput),
    // Visible label text now matches each input's own aria-label
    // ("(optional)") — found in the app-wiring holistic pass: a sighted
    // user had no visual cue these two fields were optional while a
    // screen-reader user (hearing the aria-label) did; the two modalities
    // must agree on the same information.
    labeledField('Event date (optional)', dateInput),
    labeledField('Venue (optional)', venueInput),
    isTestField,
    submitButton,
  ]);
}

export async function mountEventsScreen(
  root,
  { orgId, client = getSupabase(), defaultFormat, signal } = {},
) {
  let events = [];
  let draft = blankDraft();
  let creating = false;
  let loading = false;
  let pendingError = null;
  let pendingSuccess = null;
  let loadFailedMessage = null;
  let focusAfterRender = null;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function loadPersisted() {
    return listEventsForOrg(orgId, client);
  }

  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });
    container.appendChild(el('h1', { text: 'Events' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading events…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.focus();
  }

  function renderLoadError() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });
    container.appendChild(el('h1', { text: 'Events' }));
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

  // Races loadPersisted() against a timeout so a hung request never leaves
  // this, the organiser's real landing page, stuck on "Loading…" forever —
  // same pattern setupScreen.js/rosterScreen.js already established.
  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      events = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render();
  }

  async function handleCreate(event) {
    event.preventDefault();
    const validationError = validateDraft(draft);
    if (validationError) {
      pendingError = validationError;
      render();
      return;
    }
    if (creating) return;
    creating = true;
    render();

    try {
      await createEvent(
        orgId,
        {
          format: defaultFormat,
          name: draft.name.trim(),
          eventDate: draft.eventDate || null,
          venue: draft.venue.trim() || null,
          isTest: draft.isTest,
        },
        client,
      );
      draft = blankDraft();
      events = await listEventsForOrg(orgId, client);
      pendingSuccess = 'Event created.';
      focusAfterRender = '#events-heading';
    } catch (err) {
      pendingError = describeError(err);
    }

    creating = false;
    render();
  }

  function render() {
    // A discarded-but-still-in-flight mount (this screen's OWN attemptLoad
    // or a post-await handler like handleCreate, still resolving after the
    // router already navigated elsewhere) must never write to `root` again
    // — router.js aborts `signal` the instant a newer navigation starts,
    // well before this screen's own promise chain gets a chance to
    // finish. Single guard at render()'s own entry point covers every
    // call site (initial load, Retry, create) in one place. See
    // ROADMAP.md's "A real DOM-write race between the router..." entry.
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });
    container.appendChild(
      el('h1', { id: 'events-heading', text: 'Events', attrs: { tabindex: '-1' } }),
    );

    const feedback = el('div', {
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

    container.appendChild(
      el('div', { className: 'card' }, [
        el('h2', { text: 'Your events' }),
        renderEventsList(events),
      ]),
    );

    const form = renderCreateForm(draft, { disabled: creating });
    form.addEventListener('submit', handleCreate);
    container.appendChild(
      el('div', { className: 'card' }, [el('h2', { text: 'Create event' }), form]),
    );

    container.appendChild(feedback);
    root.appendChild(container);

    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone === 'error') {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  await attemptLoad();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
