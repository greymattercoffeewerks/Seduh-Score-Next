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
// Edit (live-event finding #4, 2026-10-04): a wrong name used to be unfixable from the app —
// registering again with the same phone returns the EXISTING person unchanged. Each row now has an
// Edit button opening an inline form (name, phone, email, cafe, bib); one atomic RPC
// (core/registry.updateRosterEntry) corrects the person's shared profile AND this event's entry,
// leaving other events' snapshots alone. Each row also shows the phone and email on file, so the
// organiser can check them. A phone is required for a cupper with a profile (it is the profile's
// identity within the org); a walk-up entry with no profile edits name/cafe/bib only. Field lengths
// are capped (FIELD_LIMITS, matching the RPC) in the registration form too, so a value registration
// accepted can always be saved again. The open form's
// text lives in `editing.draft`, mutated synchronously by each field's input handler (the same
// discipline as the registration `draft`), so a withdraw/register elsewhere that re-renders the
// whole screen rebuilds the open form from what has been typed rather than wiping it.
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
import { isPersonLinked, requestPersonLink, LINKED_LABEL } from '../../core/identity.js';
import { el, labeledField } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { findPublishedResultForEvent } from '../../core/publicResults.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import {
  listEntries,
  listPeopleByIds,
  setEntryWithdrawn,
  updateRosterEntry,
  phoneWillChange,
} from '../../core/registry.js';
import { DEFAULT_COUNTRY } from '../../core/phone.js';
import { describeDemoDataError, DEMO_CLEARED, renderDemoDataCard } from '../../core/demoData.js';
import { loadDemo, clearDemo, describeLoaded, DEMO_INTRO, DEMO_WARNING } from './demo.js';
import { confirmDialog } from '../../core/feedback.js';
import { phoneCountrySelect, phoneRow } from '../../core/phoneField.js';
import {
  REGISTRATION_LIMITS,
  phoneProblem,
  registerAndLink,
  tooLongProblem,
  validateEdit,
  buildEditFields,
  describeRegistrationEditError,
  initialEditDraft,
  savedEditSentence,
  isEntryInPublishedResults,
  matchFieldsChanged,
  PUBLISHED_EDIT_ADVISORY,
  PUBLISHED_EDIT_WARNING,
} from '../../core/registration.js';

// The edit rules live in core/registration.js (shared with Throwdown's competitor editor); re-exported here so this
// format's own callers and tests keep their import path.
export {
  buildEditFields,
  initialEditDraft,
  isEntryInPublishedResults,
  matchFieldsChanged,
  PUBLISHED_EDIT_ADVISORY,
  PUBLISHED_EDIT_WARNING,
};

function blankDraft() {
  return {
    displayName: '',
    phone: '',
    phoneCountry: DEFAULT_COUNTRY,
    email: '',
    cafe: '',
    bib: '',
  };
}

// The RPC's caps (migration 20261007100000), enforced in the registration form as well so a value
// registration accepted can always be saved again by Edit. JS counts UTF-16 units, the RPC code
// points, so this is never more lenient than the database.
const FIELD_LIMITS = REGISTRATION_LIMITS;
const FIELD_LABELS = { displayName: 'Name', email: 'Email', cafe: 'Cafe', bib: 'Bib' };

function findTooLong(draft) {
  return tooLongProblem(draft, FIELD_LABELS);
}

// Pure. Trims every field; blank optional fields collapse to null rather
// than an empty string, matching registerPerson/createEntry's own `?? null`
// convention for optional columns. The phone goes on as TYPED, with the country chosen beside it:
// core/registry.js interprets it (core/phone.js), the one place that happens, so every entry reaching
// the phone-based dedup, and later any Seduh ID backfill, is in one canonical shape and no second
// caller can skip the check. validateDraft below only gives the organiser the same answer early.
export function buildCupperFromDraft(draft) {
  return {
    displayName: draft.displayName.trim(),
    phone: draft.phone.trim(),
    phoneCountry: draft.phoneCountry ?? DEFAULT_COUNTRY,
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
  const tooLong = findTooLong(draft);
  if (tooLong) return tooLong.message;
  return phoneProblem(draft.phone, draft.phoneCountry)?.message ?? null;
}

// Pure. `linked` is whether the entry has a profile to carry a phone/email. Returns
// { field, message } for the first problem, or null. `storedPhone` is the value on file: left
// unchanged it is checked for shape only, so an old number never blocks saving another field.
export function validateEditDraft(draft, { linked, storedPhone = null }) {
  return validateEdit(draft, {
    linked,
    storedPhone,
    labels: FIELD_LABELS,
    messages: { name: 'Name is required.', phone: 'Phone is required.' },
  });
}

// Pure. A phone/email clash arrives as a P0002 whose details name the field and the person who
// already has it; anything else is described generically (core/registration.js).
export function describeRosterEditError(err) {
  return describeRegistrationEditError(err);
}

export function renderRegistrationForm(draft, { disabled }) {
  const nameInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'text',
      'aria-label': 'Name',
      'data-field': 'displayName',
      maxlength: String(REGISTRATION_LIMITS.displayName),
    },
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
  const phoneCountry = phoneCountrySelect({
    label: 'Country code',
    value: draft.phoneCountry,
    disabled,
    onChange: (value) => {
      draft.phoneCountry = value;
    },
  });

  const emailInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'email',
      'aria-label': 'Email (optional)',
      'data-field': 'email',
      maxlength: String(REGISTRATION_LIMITS.email),
    },
  });
  emailInput.value = draft.email;
  emailInput.disabled = disabled;
  emailInput.addEventListener('input', () => {
    draft.email = emailInput.value;
  });

  const cafeInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'text',
      'aria-label': 'Cafe (optional)',
      'data-field': 'cafe',
      maxlength: String(REGISTRATION_LIMITS.cafe),
    },
  });
  cafeInput.value = draft.cafe;
  cafeInput.disabled = disabled;
  cafeInput.addEventListener('input', () => {
    draft.cafe = cafeInput.value;
  });

  const bibInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'text',
      'aria-label': 'Bib (optional)',
      'data-field': 'bib',
      maxlength: String(REGISTRATION_LIMITS.bib),
    },
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
        labeledField('Phone', phoneRow(phoneCountry, phoneInput)),
        labeledField('Email', emailInput),
        labeledField('Cafe', cafeInput),
        labeledField('Bib', bibInput),
      ]),
      submitButton,
    ],
  );
}

// One row's inline edit form. `editing` is the screen's own state ({ draft, linked, error,
// errorField }); every field's input handler writes into `editing.draft` synchronously (through
// onEditInput) so a re-render rebuilds the form from what has been typed. A problem with a field
// is tied to it (aria-invalid + aria-describedby) and shown in an always-present role=alert line.
function renderEditForm(entry, editing, { disabled, onEditInput, onSaveEdit, onCancelEdit }) {
  // Only for an entry the published results name. Always shown; it turns into the stronger warning, and is announced
  // as a status, the moment the name or café is changed.
  const publishedNote = editing.inPublishedResults
    ? el('p', {
        id: `roster-edit-published-${entry.id}`,
        className: 'stage-meta roster-edit-published',
        text: matchFieldsChanged(editing.draft, entry)
          ? PUBLISHED_EDIT_WARNING
          : PUBLISHED_EDIT_ADVISORY,
        attrs: { role: 'status' },
      })
    : null;
  if (publishedNote && matchFieldsChanged(editing.draft, entry)) {
    publishedNote.dataset.tone = 'warning';
  }
  const errorId = `roster-edit-error-${entry.id}`;
  const inputs = {};

  function field(key, label, attrs = {}) {
    const input = el('input', {
      className: 'field-input',
      id: `roster-edit-${entry.id}-${key}`,
      attrs: {
        type: 'text',
        'aria-label': label,
        'data-field': key,
        ...(FIELD_LIMITS[key] ? { maxlength: String(FIELD_LIMITS[key]) } : {}),
        ...attrs,
      },
    });
    input.value = editing.draft[key];
    input.disabled = disabled;
    if (editing.errorField === key) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errorId);
    }
    inputs[key] = input;
    return input;
  }

  const nameInput = field('displayName', `Name for ${entry.display_name}`);
  const phoneInput = editing.linked
    ? field('phone', `Phone for ${entry.display_name}`, { type: 'tel' })
    : null;
  // Beside the phone: the country a number typed without + is read in. Joins `inputs` so the
  // same input handler records it and clears the last error; an unchanged stored phone is
  // checked for shape only, so leaving this alone never changes what is saved.
  const phoneCountryInput = phoneInput
    ? phoneCountrySelect({
        label: `Country code for ${entry.display_name}`,
        value: editing.draft.phoneCountry,
        disabled,
        id: `roster-edit-${entry.id}-phoneCountry`,
        onChange: () => {},
      })
    : null;
  if (phoneCountryInput) inputs.phoneCountry = phoneCountryInput;
  const emailInput = editing.linked
    ? field('email', `Email for ${entry.display_name} (optional)`, { type: 'email' })
    : null;
  const cafeInput = field('cafe', `Cafe for ${entry.display_name} (optional)`);
  const bibInput = field('bib', `Bib for ${entry.display_name} (optional)`);

  const errorLine = el('p', {
    id: errorId,
    className: 'roster-edit-error',
    text: editing.error ?? '',
    attrs: { role: 'alert', tabindex: '-1' },
  });

  // Typing clears what the last Save complained about — locally, no re-render.
  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('input', () => {
      onEditInput(key, input.value);
      if (publishedNote) {
        const changed = matchFieldsChanged(editing.draft, entry);
        const next = changed ? PUBLISHED_EDIT_WARNING : PUBLISHED_EDIT_ADVISORY;
        // only when the sentence changes, so a screen reader does not repeat it on every keystroke
        if (publishedNote.textContent !== next) publishedNote.textContent = next;
        if (changed) publishedNote.dataset.tone = 'warning';
        else delete publishedNote.dataset.tone;
      }
      errorLine.textContent = '';
      for (const other of Object.values(inputs)) {
        other.removeAttribute('aria-invalid');
        other.removeAttribute('aria-describedby');
      }
    });
  }

  const saveButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: disabled ? 'Saving…' : 'Save',
    attrs: {
      type: 'submit',
      'aria-label': `${disabled ? 'Saving' : 'Save'} changes to ${entry.display_name}`,
    },
  });
  saveButton.disabled = disabled;
  const cancelButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Cancel',
    attrs: { type: 'button', 'aria-label': `Cancel editing ${entry.display_name}` },
  });
  cancelButton.disabled = disabled;
  cancelButton.addEventListener('click', () => onCancelEdit());

  const form = el(
    'form',
    {
      className: 'roster-edit-form',
      attrs: { 'aria-label': `Edit ${entry.display_name}`, 'data-entry-id': entry.id },
    },
    [
      el('p', { className: 'roster-edit-title', text: `Editing ${entry.display_name}` }),
      publishedNote,
      errorLine,
      el(
        'div',
        { className: 'roster-form-fields' },
        [
          labeledField('Name', nameInput),
          phoneInput ? labeledField('Phone', phoneRow(phoneCountryInput, phoneInput)) : null,
          emailInput ? labeledField('Email', emailInput) : null,
          labeledField('Cafe', cafeInput),
          labeledField('Bib', bibInput),
        ].filter(Boolean),
      ),
      editing.linked
        ? null
        : el('p', {
            className: 'stage-meta',
            text: 'A walk-up entry has no phone or email on file.',
          }),
      el('div', { className: 'roster-edit-buttons' }, [saveButton, cancelButton]),
    ].filter(Boolean),
  );
  form.addEventListener('submit', (domEvent) => {
    domEvent.preventDefault();
    onSaveEdit(entry);
  });
  form.addEventListener('keydown', (domEvent) => {
    if (domEvent.key === 'Escape' && !disabled) onCancelEdit();
  });
  return form;
}

export function renderRosterEntries(
  entries,
  {
    onToggleWithdrawn,
    disabled,
    peopleById = new Map(),
    editing = null,
    savedNote = null,
    onEdit,
    onEditInput,
    onSaveEdit,
    onCancelEdit,
  },
) {
  if (entries.length === 0) {
    return el('p', { className: 'stage-meta', text: 'No cuppers registered yet.' });
  }

  const sorted = [...entries].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const items = sorted.map((entry) => {
    const person = peopleById.get(entry.person_id) ?? null;
    const meta = [entry.cafe, entry.bib ? `Bib ${entry.bib}` : null].filter(Boolean).join(' · ');
    // The phone and email on file, so the organiser can check they were entered correctly.
    const contact = person ? [person.phone, person.email].filter(Boolean).join(' · ') : '';
    const editingThisRow = editing?.entryId === entry.id;

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

    // Hidden while its own form is open (the form's Cancel returns focus here). While ANOTHER
    // row's form is open it is parked, not removed: one edit at a time, and a stray tap must not
    // silently discard what is typed in the open one.
    let editButton = null;
    if (onEdit && !editingThisRow) {
      editButton = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Edit',
        attrs: {
          type: 'button',
          id: `roster-edit-btn-${entry.id}`,
          'aria-label': `Edit ${entry.display_name}`,
          ...(editing ? { 'aria-disabled': 'true' } : {}),
        },
      });
      editButton.disabled = disabled;
      editButton.addEventListener('click', () => {
        if (editButton.getAttribute('aria-disabled') === 'true') return;
        onEdit(entry);
      });
    }

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
            contact ? el('span', { className: 'stage-meta roster-contact', text: contact }) : null,
            savedNote?.entryId === entry.id
              ? el(
                  'p',
                  {
                    id: `roster-saved-${entry.id}`,
                    className: 'roster-saved',
                    attrs: { role: 'status', tabindex: '-1' },
                  },
                  [
                    document.createTextNode(savedNote.message),
                    savedNote.republishHref
                      ? el('span', {}, [
                          document.createTextNode(' '),
                          el('a', {
                            className: 'roster-republish-link',
                            text: 'Republish the results',
                            attrs: { href: savedNote.republishHref },
                          }),
                          document.createTextNode('.'),
                        ])
                      : null,
                  ].filter(Boolean),
                )
              : null,
            entry.withdrawn
              ? el('span', { className: 'roster-withdrawn-tag', text: 'Withdrawn' })
              : null,
            isPersonLinked(person)
              ? el('span', { className: 'roster-linked-tag', text: LINKED_LABEL })
              : null,
          ].filter(Boolean),
        ),
        el(
          'div',
          { className: 'roster-entry-actions' },
          [editButton, toggleButton].filter(Boolean),
        ),
        editingThisRow
          ? renderEditForm(entry, editing, { disabled, onEditInput, onSaveEdit, onCancelEdit })
          : null,
      ].filter(Boolean),
    );
  });

  return el(
    'ul',
    { className: 'roster-list', attrs: { 'aria-label': 'Registered cuppers' } },
    items,
  );
}

export async function mountRosterScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  let event = null;
  let entries = [];
  // person id -> people row: where each entry's phone and email live.
  let people = new Map();
  // The event's published results payload, or null (not published, a stub, or the read failed: the warning then stays quiet).
  let publishedPayload = null;
  // The one open edit form: { entryId, linked, draft, error, errorField }.
  let editing = null;
  // The confirmation for the last saved edit, shown in that cupper's own row (and focused there) so
  // it is next to what changed instead of in the feedback line below a long list.
  let savedNote = null;
  let draft = blankDraft();
  let busy = false;
  let demoAction = null;
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
    const personIds = [...new Set(evEntries.map((entry) => entry.person_id).filter(Boolean))];
    // Contact details are a convenience on top of the roster: failing to read them must not take
    // the whole roster (mid-event, a live screen) down to the load-error state.
    let profiles = [];
    try {
      profiles = await listPeopleByIds(personIds, client);
    } catch {
      // The roster still renders, without contact lines; Edit explains why it cannot open.
    }
    // Only to warn before an edit that would drop a result off a Seduh ID profile; failing to read it must not
    // take the roster down, so it is best effort.
    let published = null;
    try {
      published = (await findPublishedResultForEvent(eventId, client))?.payload ?? null;
    } catch {
      // no warning rather than no roster
    }
    return {
      event: ev,
      entries: evEntries,
      people: new Map(profiles.map((profile) => [profile.id, profile])),
      published,
    };
  }

  function applyPersisted(persisted) {
    event = persisted.event;
    entries = persisted.entries;
    people = persisted.people;
    publishedPayload = persisted.published ?? null;
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
      applyPersisted(await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS));
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
    // A discarded-but-still-in-flight mount (attemptLoad, or a post-await
    // handler still resolving after the router already navigated
    // elsewhere) must never write to `root` again — router.js aborts
    // `signal` the instant a newer navigation starts. See ROADMAP.md's "A
    // real DOM-write race between the router..." entry.
    if (signal?.aborted) return;
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

    // Test events only (the database refuses a real event regardless): a scored demo event, no typing.
    if (event?.is_test) {
      container.appendChild(
        renderDemoDataCard({
          idPrefix: 'roster',
          intro: DEMO_INTRO,
          busy,
          busyWith: demoAction,
          // Stages can exist with no entries (setup makes them first), so Clear is always offered.
          hasData: true,
          onLoad: handleLoadDemo,
          onClear: handleClearDemo,
        }),
      );
    }

    container.appendChild(
      renderRosterEntries(entries, {
        onToggleWithdrawn: handleToggleWithdrawn,
        disabled: busy,
        peopleById: people,
        editing,
        savedNote,
        onEdit: handleEdit,
        onEditInput: handleEditInput,
        onSaveEdit: handleSaveEdit,
        onCancelEdit: handleCancelEdit,
      }),
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
    savedNote = null;

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
      // Registers, then asks for the Seduh ID link (best-effort, core/registration.js).
      const result = await registerAndLink(event.org_id, eventId, cupper, client);
      try {
        applyPersisted(await loadPersisted());
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

  // Runs one demo call (load or clear) and refreshes the screen. A load or clear replaces the whole test event, so it
  // asks first when there is something to lose.
  async function runDemo(work, successText, action) {
    savedNote = null;
    demoAction = action;
    busy = true;
    render();
    try {
      const reply = await work();
      try {
        applyPersisted(await loadPersisted());
        pendingSuccess = successText(reply);
      } catch {
        pendingSuccess = 'Done, but the screen could not refresh — reload to see the roster.';
      }
    } catch (err) {
      pendingError = describeDemoDataError(err);
    }
    busy = false;
    demoAction = null;
    render();
  }

  async function handleLoadDemo() {
    if (busy) return;
    if (
      !(await confirmDialog({
        title: 'Replace this test event with the demo?',
        body: DEMO_WARNING,
        confirmLabel: 'Erase and load demo',
        isTest: true,
      }))
    ) {
      return;
    }
    await runDemo(() => loadDemo(event.org_id, eventId, client), describeLoaded, 'load');
  }

  async function handleClearDemo() {
    if (busy) return;
    if (
      !(await confirmDialog({
        title: 'Clear the demo from this test event?',
        body: DEMO_WARNING,
        confirmLabel: 'Erase demo',
        isTest: true,
      }))
    ) {
      return;
    }
    await runDemo(
      () => clearDemo(event.org_id, eventId, client),
      () => DEMO_CLEARED,
      'clear',
    );
  }

  async function handleToggleWithdrawn(entry) {
    if (busy) return;
    savedNote = null;
    busy = true;
    render();

    // Captured before the write, not read back off `entry` afterward — a
    // caller's row object is otherwise not guaranteed to still reflect its
    // pre-toggle state by the time the await resolves.
    const wasWithdrawn = entry.withdrawn;

    try {
      await setEntryWithdrawn(entry.id, !wasWithdrawn, client);
      try {
        applyPersisted(await loadPersisted());
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

  function handleEdit(entry) {
    if (busy || (editing && editing.entryId !== entry.id)) return;
    const person = people.get(entry.person_id) ?? null;
    // An entry with a person_id is linked even when its profile did not load: treating it as a
    // walk-up would hide the phone/email fields and then fail the save with a confusing message.
    if (entry.person_id && !person) {
      pendingError =
        'This cupper\u2019s phone and email could not be loaded, so they cannot be edited right now. Reload and try again.';
      render();
      return;
    }
    savedNote = null;
    editing = {
      entryId: entry.id,
      linked: Boolean(entry.person_id),
      storedPhone: person?.phone ?? null,
      inPublishedResults: isEntryInPublishedResults(publishedPayload, entry),
      draft: initialEditDraft(entry, person),
      error: null,
      errorField: null,
    };
    focusAfterRender = `#roster-edit-${entry.id}-displayName`;
    render();
  }

  // Synchronous, before any await — see the module comment.
  function handleEditInput(key, value) {
    if (!editing) return;
    editing.draft[key] = value;
    editing.error = null;
    editing.errorField = null;
  }

  function handleCancelEdit() {
    if (busy || !editing) return;
    const id = editing.entryId;
    editing = null;
    focusAfterRender = `#roster-edit-btn-${id}`;
    render();
  }

  async function handleSaveEdit(entry) {
    if (busy || !editing) return;

    const invalid = validateEditDraft(editing.draft, {
      linked: editing.linked,
      storedPhone: editing.storedPhone,
    });
    if (invalid) {
      editing.error = invalid.message;
      editing.errorField = invalid.field;
      focusAfterRender = `#roster-edit-${entry.id}-${invalid.field}`;
      render();
      return;
    }

    savedNote = null;
    busy = true;
    render();

    const fields = buildEditFields(editing.draft, {
      linked: editing.linked,
      storedPhone: editing.storedPhone,
    });
    const detailsChanged = matchFieldsChanged(editing.draft, entry);
    // The result stays on their Seduh ID profile only while the published name and café still match the roster's.
    const dropsPublishedResult = editing.inPublishedResults && detailsChanged;

    try {
      await updateRosterEntry(event.org_id, entry.id, fields, client);
      // A phone change clears the database link and nothing re-links on its own, so ask again (same
      // best-effort rules as registration). Compared canonically: an unchanged number is not a change.
      if (editing.linked /* has a profile */ && entry.person_id && phoneWillChange(fields)) {
        requestPersonLink(event.org_id, entry.person_id, client);
      }
      let refreshed = true;
      try {
        applyPersisted(await loadPersisted());
      } catch {
        // The write itself succeeded — only the confirmation read failed. Same hedge as the other
        // handlers here: do not say it failed when it did not.
        refreshed = false;
      }
      if (refreshed) {
        savedNote = {
          entryId: entry.id,
          message: savedEditSentence(fields.displayName, { detailsChanged, dropsPublishedResult }),
          republishHref: dropsPublishedResult ? `#/events/${event.id}/report` : null,
        };
        focusAfterRender = `#roster-saved-${entry.id}`;
      } else {
        // No fresh row to attach a note to: the feedback line carries it (and takes focus).
        pendingSuccess = 'Saved, but the screen could not refresh — reload to see the roster.';
      }
      editing = null;
    } catch (err) {
      // Shown inside the form, beside the field it is about, so what was typed is not lost.
      const { message, field } = describeRosterEditError(err);
      editing.error = message;
      editing.errorField = field;
      focusAfterRender = field
        ? `#roster-edit-${entry.id}-${field}`
        : `#roster-edit-error-${entry.id}`;
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
