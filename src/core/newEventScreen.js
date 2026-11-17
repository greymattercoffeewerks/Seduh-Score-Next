// "+ New event" (2026-11-17, the Organiser home): a screen of its own at #/events/new, reached from the Events home.
// The format is chosen from cards (name, a one-line description) instead of a dropdown, then the name, date, venue and
// city, then the "This is test data" checkbox, which defaults UNCHECKED (D9: the organiser opts in, never the
// reverse; this is the one place in the app that SETS is_test, every other screen only displays it). Creation goes
// through core/events.js `createEvent`, unchanged.
//
// Format-agnostic: `formatOptions` ([{ value, label, kind?, description? }]) and `defaultFormat` come from the
// composition root, so this file never names a format. With one format (or none given) the cards are left out and
// every event is created as `defaultFormat`.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField } from './dom.js';
import { describeError } from './errors.js';
import { createEvent } from './events.js';
import { goToHash } from './navigation.js';

export function blankDraft(defaultFormat) {
  return { name: '', eventDate: '', venue: '', city: '', isTest: false, format: defaultFormat };
}

// Pure. Name is the only required field — date/venue are optional
// metadata, matching createEvent's own `?? null` handling for them.
export function validateDraft(draft) {
  if (!draft.name.trim()) return 'Name is required.';
  return null;
}

// Which organisation the new event will be created in, said where the person reads it: someone who works in two
// organisations must never create an event in the wrong one. The organisation is fixed when the screen mounts.
export function newEventHeading(orgName) {
  const name = orgName?.trim();
  return name ? `New event in ${name}` : 'New event';
}

function submitLabel(draft, formatOptions, creating) {
  if (creating) return 'Creating…';
  const label = formatOptions?.find((option) => option.value === draft.format)?.label;
  return label && formatOptions.length > 1 ? `Create ${label} event` : 'Create event';
}

// The format cards: native radios (one choice always selected, arrow keys move between them) drawn as cards. The
// selected card says so with a check and an edge as well as its tint (`.is-selected`).
function renderFormatCards(draft, { disabled, formatOptions, onChange }) {
  const cards = formatOptions.map((option) => {
    const input = el('input', {
      className: 'sr-only',
      attrs: { type: 'radio', name: 'format', value: option.value, 'data-field': 'format' },
    });
    input.checked = option.value === draft.format;
    input.disabled = disabled;
    const card = el('label', { className: 'events-format-card' }, [
      input,
      ...(option.kind ? [el('span', { className: 'events-format-kind', text: option.kind })] : []),
      el('span', { className: 'events-format-name', text: option.label }),
      ...(option.description
        ? [el('span', { className: 'events-format-description', text: option.description })]
        : []),
    ]);
    card.classList.toggle('is-selected', input.checked);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      draft.format = option.value;
      for (const other of card.parentElement?.children ?? []) {
        other.classList.toggle('is-selected', other === card);
      }
      onChange?.();
    });
    return card;
  });
  return el('fieldset', { className: 'events-format-fieldset' }, [
    el('legend', { className: 'ok-card-heading', text: '1 · Format' }),
    el('div', { className: 'events-format-cards' }, cards),
  ]);
}

// `disabled`, not a checked-state-only lock — matches renderRegistrationForm's own established shape
// (rosterScreen.js) for a form disabled in-flight.
export function renderNewEventForm(draft, { disabled, formatOptions, eventsHref = '#/events' }) {
  const hasChoice = formatOptions?.length > 1;
  const submitButton = el('button', {
    className: 'btn btn-primary btn-lg tap-target',
    text: submitLabel(draft, formatOptions, disabled),
    attrs: { type: 'submit' },
  });
  submitButton.disabled = disabled;

  const formatSection = hasChoice
    ? renderFormatCards(draft, {
        disabled,
        formatOptions,
        // The button names the chosen format, in place (no redraw: that would drop focus from the card).
        onChange: () => {
          submitButton.textContent = submitLabel(draft, formatOptions, false);
        },
      })
    : null;

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

  // Separate from Venue (a public results archive wants "City" and "Venue" as
  // two distinct fields — user decision, 2026-09-17), not derived from it —
  // an organiser could otherwise run the same venue in two different cities
  // over time with no way to tell them apart on the archive page.
  const cityInput = el('input', {
    className: 'field-input',
    attrs: { type: 'text', 'aria-label': 'City (optional)', 'data-field': 'city' },
  });
  cityInput.value = draft.city;
  cityInput.disabled = disabled;
  cityInput.addEventListener('input', () => {
    draft.city = cityInput.value;
  });

  // Defaults UNCHECKED — D9's "unmistakable" bar means the organiser actively opts IN to marking something test data.
  const isTestInput = el('input', {
    attrs: {
      type: 'checkbox',
      'data-field': 'isTest',
      'aria-describedby': 'new-event-test-hint',
    },
  });
  isTestInput.checked = draft.isTest;
  isTestInput.disabled = disabled;
  isTestInput.addEventListener('change', () => {
    draft.isTest = isTestInput.checked;
  });
  const isTestField = el('div', { className: 'events-test-field' }, [
    el('label', { className: 'checkbox-field' }, [
      isTestInput,
      el('span', { text: 'This is test data' }),
    ]),
    el('p', {
      className: 'stage-meta',
      id: 'new-event-test-hint',
      text: 'For a rehearsal. Every audience screen shows a TEST banner, and you can delete it afterwards.',
    }),
  ]);

  const details = el(
    'section',
    { className: 'ok-card', attrs: { 'aria-labelledby': 'new-event-details-heading' } },
    [
      el('h2', {
        id: 'new-event-details-heading',
        className: 'ok-card-heading',
        text: hasChoice ? '2 · Details' : 'Details',
      }),
      el('div', { className: 'events-details-grid' }, [
        // Visible label text matches each input's own aria-label ("(optional)"): a sighted user and a screen-reader
        // user must get the same information.
        labeledField('Event name', nameInput),
        labeledField('Event date (optional)', dateInput),
        labeledField('Venue (optional)', venueInput),
        labeledField('City (optional)', cityInput),
      ]),
      isTestField,
    ],
  );

  return el(
    'form',
    { className: 'create-event-form' },
    [
      formatSection,
      details,
      el('div', { className: 'events-form-actions' }, [
        submitButton,
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Cancel',
          attrs: { href: eventsHref },
        }),
        el('p', {
          className: 'stage-meta',
          text: 'Next you set the event up: teams, judges or cuppers, depending on the format.',
        }),
      ]),
    ].filter(Boolean),
  );
}

export async function mountNewEventScreen(
  root,
  {
    orgId,
    orgName = null,
    client = getSupabase(),
    // [{ value, label, kind?, description? }]; with more than one the cards are drawn.
    formatOptions,
    defaultFormat,
    eventsHref = '#/events',
    signal,
    // Where to go once the event exists (its own home, where its setup starts). A test passes its own.
    onCreated = (created) => goToHash(`#/events/${created.id}`),
  } = {},
) {
  let draft = blankDraft(defaultFormat);
  let creating = false;
  let pendingError = null;
  let focusAfterRender = null;

  async function handleCreate(event) {
    event.preventDefault();
    // Superseded (the organisation changed and this screen is still on show while the new one loads):
    // sending a create now would put the event in the organisation the person has just left, with no
    // sign of it in the one they are looking at.
    if (signal?.aborted) return;
    const validationError = validateDraft(draft);
    if (validationError) {
      pendingError = validationError;
      render();
      return;
    }
    if (creating) return;
    creating = true;
    render();

    let created = null;
    try {
      created = await createEvent(
        orgId,
        {
          format: draft.format,
          name: draft.name.trim(),
          eventDate: draft.eventDate || null,
          venue: draft.venue.trim() || null,
          city: draft.city.trim() || null,
          isTest: draft.isTest,
        },
        client,
      );
    } catch (err) {
      pendingError = describeError(err);
    }
    creating = false;
    if (created) {
      if (!signal?.aborted) onCreated(created);
      return;
    }
    render();
  }

  function render() {
    // A discarded-but-still-in-flight mount must never write to `root` again (router.js aborts `signal` the instant
    // a newer navigation starts).
    if (signal?.aborted) return;
    root.innerHTML = '';
    const container = el('section', {
      className: 'screen-container events-screen new-event-screen',
    });
    container.appendChild(
      el('p', { className: 'events-breadcrumb' }, [
        el('a', { text: 'Events', attrs: { href: eventsHref } }),
      ]),
    );
    container.appendChild(
      el('h1', {
        id: 'new-event-heading',
        text: newEventHeading(orgName),
        attrs: { tabindex: '-1' },
      }),
    );

    const feedback = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      feedback.textContent = pendingError;
      feedback.dataset.tone = 'error';
      pendingError = null;
    }
    container.appendChild(feedback);

    const form = renderNewEventForm(draft, { disabled: creating, formatOptions, eventsHref });
    // Named by its heading, so someone who jumps straight to the form hears which organisation it is for.
    form.setAttribute('aria-labelledby', 'new-event-heading');
    form.addEventListener('submit', handleCreate);
    container.appendChild(form);
    root.appendChild(container);

    if (focusAfterRender) {
      root.querySelector(focusAfterRender)?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone === 'error') {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  render();

  return {
    unmount() {
      // Nothing to tear down: no timers, no listeners beyond the DOM subtree itself.
    },
  };
}
