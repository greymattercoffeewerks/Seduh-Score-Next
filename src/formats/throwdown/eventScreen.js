// Throwdown's organiser screen: one hub for the whole event, because a knockout has no separate stages to move between.
// Before the draw it shows the competitors, the setup and the draw (random or manual); after it, the bracket, the
// matches being played (judges' taps, confirm, walkover) and the champion banner. Setup is locked once Round 1
// exists (the database refuses a change too); a module that is not on leaves no trace here.
//
// Every write goes through formats/throwdown/data.js (the shared outbox), so a tap made on a bad connection is kept
// and replayed; the counts shown are the server's plus the taps still waiting (pendingVoteDeltas).
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { findEvent } from '../../core/events.js';
import {
  loadDemoRoster,
  describeDemoRosterError,
  describeDemoRosterLoaded,
  renderDemoRosterCard,
} from '../../core/demoRoster.js';
import {
  setEntryWithdrawn,
  listPeopleByIds,
  updateRosterEntry,
  phoneWillChange,
} from '../../core/registry.js';
import { requestPersonLink } from '../../core/identity.js';
import { findPublishedResultForEvent } from '../../core/publicResults.js';
import {
  REGISTRATION_LIMITS,
  registerAndLink,
  isEntryInPublishedResults,
  matchFieldsChanged,
  PUBLISHED_EDIT_ADVISORY,
  PUBLISHED_EDIT_WARNING,
} from '../../core/registration.js';
import { phoneCountrySelect, phoneRow } from '../../core/phoneField.js';
import { droppedErrorFor, isTransientErrorCode } from '../../core/outbox.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { newSeed } from '../../core/seededShuffle.js';
import {
  loadThrowdown,
  saveSettings,
  startEvent,
  castVote,
  undoVote,
  confirmMatch,
  recordWalkover,
  reopenMatch,
  pendingSnapshot,
} from './data.js';
import { reopenState, reopenWords, matchesAwaitingUndo } from './reopen.js';
import { tallyVotes, leadOf, canConfirm, voteState, tiedSlotIds } from './votes.js';
import {
  MAX_FEED_ROUND,
  PROBLEM_WORDS as REDEMPTION_PROBLEM_WORDS,
  hasRedemptionRound,
  redemptionForm,
  redemptionModuleFromForm,
  redemptionProblem,
} from './redemption.js';
import {
  randomPairs,
  normalisePairs,
  drawProblems,
  previewRoundOne,
  emptyBoard,
  assignSlot,
} from './seeding.js';
import { publishThrowdownLive } from './liveSession.js';
import { describeThrowdownError, resultLine, matchTitle, listWords, ROLE_WORDS } from './words.js';
import { presetKeys } from '../../core/scoresheet.js';
import { ROUND_ROLES } from './roundRole.js';
import { scoringContext, scoredView, cupsForMatch, auditRule } from './scoredMatch.js';
import { buildAudit } from './scoreAudit.js';
import { createScoreEntry } from './scoreEntry.js';
import {
  blankCompetitorDraft,
  validateCompetitorDraft,
  buildCompetitor,
  addedWords,
  initialEditDraft,
  validateCompetitorEdit,
  buildCompetitorEdit,
  describeCompetitorEditError,
  editedWords,
} from './competitorForm.js';

const PRESET_WORDS = { latte_art_v1: 'Latte art (6 lines, 27 points a cup)' };

export async function mountThrowdownEventScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  const state = {
    loading: true,
    loadError: null,
    event: null,
    data: null,
    form: null, // setup form values
    draw: null, // { seed, pairs } (random) or { slotCount, pairs } (manual)
    pending: new Map(), // matchId -> { deltas, queued, decisionQueued }
    startQueued: false,
    deciding: false, // a confirm, walkover or draw is in flight: no tap may queue behind it
    walkoverOpen: null, // matchId whose Walkover disclosure is open
    focusTarget: null, // id to focus after the next render (a phase change replaces the focused control)
    walkover: null, // { matchId, slotId } waiting for the second tap
    reopen: null, // matchId whose Undo result is waiting for the second tap
    sheetOpen: null, // { matchId, slotId, seat, draft } the paper sheet being typed in
    picks: new Map(), // matchId -> slot position the organiser picked for a level scored match
    feedback: null,
    busy: false,
    addDraft: blankCompetitorDraft(), // the Add a competitor form's typed values
    addError: null, // { field, message } from validating that form
    edit: null, // the one open competitor edit: { entryId, linked, storedPhone, inPublishedResults, draft, error }
  };

  // The setup's scoresheet choice: on/off, the preset, and the cups per round role (0 = tap-voted).
  function scoresheetForm(saved) {
    const cups = Object.fromEntries(
      ROUND_ROLES.map((r) => [r, saved ? (saved.cups?.[r] ?? 0) : 0]),
    );
    if (!saved) Object.assign(cups, { final: 2, third_place: 1 });
    return { on: Boolean(saved), preset: saved?.preset ?? presetKeys()[0], cups };
  }

  const activeEntries = () => state.data.entries.filter((e) => !e.withdrawn);
  const nameOf = (id) => state.data.entries.find((e) => e.id === id)?.display_name ?? '';

  // The server's rows and the outbox's waiting changes are two reads that can straddle a landing operation (counted
  // in both, or in neither). The queue is read before and after the server; if it changed in between, read again.
  async function refresh() {
    try {
      let pending = await pendingSnapshot();
      let event;
      let data;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        [event, data] = await raceTimeout(
          Promise.all([findEvent(eventId, client), loadThrowdown(eventId, client)]),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
        const after = await pendingSnapshot();
        const steady = after.signature === pending.signature;
        pending = after;
        if (steady) break;
      }
      if (signal?.aborted) return;
      state.event = event;
      state.data = data;
      state.loadError = null;
      state.form ??= {
        judgeCount: data.settings.judge_count,
        thirdPlace: data.settings.third_place,
        seedingMode: data.settings.seeding_mode,
        scoresheet: scoresheetForm(data.settings.modules?.scoresheet),
        redemption: redemptionForm(data.settings.modules?.redemption),
      };
      state.pending = pending.matches;
      state.startQueued = pending.startQueued;
      if (state.feedback === staleFeedback) state.feedback = null;
    } catch (err) {
      if (state.data) {
        // A failed REFRESH keeps the screen: the organiser must still see the match and the taps waiting on this
        // device (the queue is local, so it reads offline). Only a first load with nothing to show becomes the error.
        try {
          const pending = await pendingSnapshot();
          state.pending = pending.matches;
          state.startQueued = pending.startQueued;
        } catch {
          // keep the last snapshot
        }
        // Only a dropped connection says "No connection"; any other failure (an expired sign-in, a server refusal) is
        // said in its own words, with the screen still kept.
        if (isConnectionFailure(err)) {
          if (!state.feedback?.tone) state.feedback = staleFeedback;
        } else {
          state.feedback = { tone: 'error', text: describeThrowdownError(err) };
        }
      } else {
        state.loadError = err.timedOut
          ? 'This is taking longer than expected — check your connection and try Retry.'
          : describeThrowdownError(err);
      }
    }
    state.loading = false;
    render();
  }

  // A read that never reached the database: our own timeout, a fetch failure (supabase-js answers it with no SQLSTATE), or
  // a transient database code. Sign-in problems (PGRST3xx) are not the connection, whatever the outbox does with them.
  const isConnectionFailure = (err) =>
    Boolean(err?.timedOut) ||
    !err?.code ||
    (isTransientErrorCode(err.code) && !String(err.code).startsWith('PGRST'));

  // Shown (as the same object, so a later successful refresh can recognise and clear it) when a refresh fails but the
  // last loaded screen is kept.
  const staleFeedback = {
    tone: 'error',
    text: 'No connection. Showing the last loaded screen. Taps made on this device are saved and send when the connection is back.',
  };

  // A judge's tap must never be dropped because another write is in flight: taps queue (the outbox keeps their order)
  // and the screen reloads once the burst settles.
  // A caller that awaits refreshSoon() is answered when the screen has caught up with its write: joining a reload already
  // running returns that run, which goes round once more for the new write, so code after the await sees the final screen.
  let refreshRun = null;
  let refreshAgain = false;
  function refreshSoon() {
    if (refreshRun) {
      refreshAgain = true;
      return refreshRun;
    }
    refreshRun = (async () => {
      try {
        do {
          refreshAgain = false;
          await refresh();
        } while (refreshAgain);
      } finally {
        refreshRun = null;
      }
    })();
    return refreshRun;
  }
  async function tapAct(work, announce) {
    if (signal?.aborted) return;
    try {
      const outcome = await work();
      const dropped = droppedErrorFor(outcome.result, outcome.operationId);
      state.feedback = dropped
        ? { tone: 'error', text: describeThrowdownError(dropped) }
        : { tone: null, text: announce ?? '' };
    } catch (err) {
      state.feedback = { tone: 'error', text: describeThrowdownError(err) };
    }
    await refreshSoon();
  }

  // Runs a write, reports a refusal in words, reloads. Never lets two writes overlap.
  async function act(work, { publish = false } = {}) {
    if (state.busy || signal?.aborted) return;
    state.busy = true;
    state.deciding = publish;
    state.feedback = null;
    render();
    try {
      const outcome = await work();
      const dropped = outcome ? droppedErrorFor(outcome.result, outcome.operationId) : null;
      if (dropped) state.feedback = { tone: 'error', text: describeThrowdownError(dropped) };
      else if (publish)
        await publishThrowdownLive({ event: state.event, takeOver: true }, handlers);
    } catch (err) {
      state.feedback = { tone: 'error', text: describeThrowdownError(err) };
    }
    state.busy = false;
    state.deciding = false;
    if (publish && !state.feedback) state.focusTarget = 'td-now-h';
    await refreshSoon();
  }

  // ---------- pieces ----------

  // ONE live region for the screen's lifetime, re-attached on every render with only its words changed: a freshly
  // inserted live region is not reliably announced (core/viewer-shell.js).
  const feedbackEl = el('div', {
    className: 'screen-feedback',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  function feedbackNode() {
    feedbackEl.textContent = state.feedback?.text ?? '';
    if (state.feedback?.tone) feedbackEl.dataset.tone = state.feedback.tone;
    else delete feedbackEl.dataset.tone;
    return feedbackEl;
  }

  function button(
    label,
    onClick,
    { className = 'btn btn-outline tap-target', key, disabled = false, ignoreBusy = false } = {},
  ) {
    const b = el('button', {
      className,
      text: label,
      attrs: { type: 'button', 'data-focus-key': key ?? label },
    });
    if (disabled || (state.busy && !ignoreBusy)) setBusyDisabled(b, true);
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onClick();
    });
    return b;
  }

  // ---------- editing a competitor ----------
  // The same capability as Cup Taster's roster Edit (core/registration.js holds the shared rules). Available before and
  // after the draw: a typo in a name must be fixable mid-event. The phone and email live on the person, so opening the
  // form reads the person (and the published results, best effort, only to warn).
  const editId = (entry, field) => `td-edit-${entry.id}-${field}`;
  const NO_PHONE_LOAD =
    'This competitor’s phone could not be loaded, so it cannot be edited right now.';

  async function openEdit(entry) {
    if (state.busy || signal?.aborted || (state.edit && state.edit.entryId !== entry.id)) return;
    state.busy = true;
    state.feedback = null;
    render();
    let person = null;
    let published = null;
    let failed = null;
    try {
      if (entry.person_id) {
        [person] = await raceTimeout(
          listPeopleByIds([entry.person_id], client),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
        // A linked entry whose profile did not load is not treated as a walk-up: that would hide the phone box and
        // fail the save with a confusing message.
        if (!person) failed = `${NO_PHONE_LOAD} Reload and try again.`;
      }
    } catch {
      failed = `${NO_PHONE_LOAD} Check your connection and try again.`;
    }
    if (!failed) {
      try {
        const result = await raceTimeout(
          findPublishedResultForEvent(eventId, client),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
        published = result?.payload ?? null;
      } catch {
        // no warning rather than no editor
      }
    }
    if (signal?.aborted) return;
    state.busy = false;
    if (failed) {
      state.feedback = { tone: 'error', text: failed };
      state.focusTarget = `td-edit-btn-${entry.id}`;
    } else {
      state.edit = {
        entryId: entry.id,
        linked: Boolean(entry.person_id),
        storedPhone: person?.phone ?? null,
        inPublishedResults: isEntryInPublishedResults(published, entry),
        draft: initialEditDraft(entry, person),
        error: null,
      };
      state.focusTarget = editId(entry, 'displayName');
    }
    render();
  }

  function cancelEdit() {
    if (state.busy || !state.edit) return;
    state.focusTarget = `td-edit-btn-${state.edit.entryId}`;
    state.edit = null;
    state.feedback = null;
    render();
  }

  async function saveEdit(entry) {
    const edit = state.edit;
    if (state.busy || !edit || signal?.aborted) return;
    const where = { linked: edit.linked, storedPhone: edit.storedPhone };
    const problem = validateCompetitorEdit(edit.draft, where);
    if (problem) {
      edit.error = problem;
      state.feedback = null;
      state.focusTarget = editId(entry, problem.field);
      render();
      return;
    }
    edit.error = null;
    state.busy = true;
    state.feedback = null;
    render();
    const fields = buildCompetitorEdit(edit.draft, where);
    const detailsChanged = matchFieldsChanged(edit.draft, entry);
    const dropsPublishedResult = edit.inPublishedResults && detailsChanged;
    try {
      await updateRosterEntry(state.event.org_id, entry.id, fields, client);
      // A phone change clears the database link and nothing re-links on its own, so ask again (best effort, as at
      // registration). Compared canonically: an unchanged number is not a change.
      if (edit.linked && entry.person_id && phoneWillChange(fields)) {
        requestPersonLink(state.event.org_id, entry.person_id, client);
      }
      state.edit = null;
      state.feedback = {
        tone: 'success',
        text: editedWords(fields.displayName, { detailsChanged, dropsPublishedResult }),
      };
      state.focusTarget = `td-edit-btn-${entry.id}`;
    } catch (err) {
      // Shown inside the form beside the box it is about, so what was typed is not lost.
      const { message, field } = describeCompetitorEditError(err);
      edit.error = { field, message };
      state.focusTarget = field ? editId(entry, field) : `td-edit-error-${entry.id}`;
    }
    state.busy = false;
    await refreshSoon();
  }

  function editForm(entry) {
    const edit = state.edit;
    const busy = state.busy;
    const errId = `td-edit-error-${entry.id}`;
    const noteId = `td-edit-note-${entry.id}`;
    const inputs = {};
    // What a box is described by: its refusal (when it is the box refused) and, for the two boxes the published results
    // match on, the published-results note, so it is read where the person is typing.
    const describedBy = (field) =>
      [
        edit.error?.field === field ? errId : null,
        edit.inPublishedResults && (field === 'displayName' || field === 'cafe') ? noteId : null,
      ]
        .filter(Boolean)
        .join(' ');
    function input(field, label, { type = 'text', maxlength } = {}) {
      const attrs = {
        type,
        'aria-label': label,
        autocomplete: 'off',
        'data-focus-key': editId(entry, field),
        'data-field': field,
      };
      if (maxlength) attrs.maxlength = String(maxlength);
      if (edit.error?.field === field) attrs['aria-invalid'] = 'true';
      if (describedBy(field)) attrs['aria-describedby'] = describedBy(field);
      const node = el('input', { className: 'field-input', id: editId(entry, field), attrs });
      node.value = edit.draft[field];
      // Busy: read-only and aria-disabled, never native `disabled` (core/dom.js setBusyDisabled).
      node.readOnly = busy;
      setBusyDisabled(node, busy);
      inputs[field] = node;
      return node;
    }
    const nameInput = input('displayName', `Name for ${entry.display_name}`, {
      maxlength: REGISTRATION_LIMITS.displayName,
    });
    const phoneInput = edit.linked
      ? input('phone', `Phone for ${entry.display_name}`, { type: 'tel' })
      : null;
    const countrySelect = edit.linked
      ? phoneCountrySelect({
          label: `Phone country for ${entry.display_name}`,
          value: edit.draft.phoneCountry,
          busy,
          id: editId(entry, 'phoneCountry'),
          focusKey: editId(entry, 'phoneCountry'),
          onChange: (value) => {
            // While saving, the choice is not taken: re-render so the box shows the held country again.
            if (state.busy) {
              render();
              return;
            }
            edit.draft.phoneCountry = value;
            clearEditError();
          },
        })
      : null;
    const cafeInput = input('cafe', `Café or team (optional) for ${entry.display_name}`, {
      maxlength: REGISTRATION_LIMITS.cafe,
    });
    const errorFor = (field) =>
      edit.error?.field === field
        ? [el('p', { className: 'form-field-error', id: errId, text: edit.error.message })]
        : [];
    // Only for an entry the published results name. Always shown; it becomes the stronger warning the moment the name or
    // café changes, and is rewritten only when the sentence changes so a screen reader does not repeat it per keystroke.
    const noteWords = () =>
      matchFieldsChanged(edit.draft, entry) ? PUBLISHED_EDIT_WARNING : PUBLISHED_EDIT_ADVISORY;
    const note = edit.inPublishedResults
      ? el('p', { className: 'td-note', id: noteId, attrs: { role: 'status' }, text: noteWords() })
      : null;
    function clearEditError() {
      if (!edit.error) return;
      edit.error = null;
      for (const [field, box] of Object.entries(inputs)) {
        box.removeAttribute('aria-invalid');
        if (describedBy(field)) box.setAttribute('aria-describedby', describedBy(field));
        else box.removeAttribute('aria-describedby');
      }
      form.querySelectorAll('.form-field-error').forEach((p) => p.remove());
    }
    for (const [field, box] of Object.entries(inputs)) {
      box.addEventListener('input', () => {
        edit.draft[field] = box.value;
        if (note && note.textContent !== noteWords()) note.textContent = noteWords();
        clearEditError();
      });
    }
    const save = el('button', {
      className: 'btn btn-primary tap-target',
      text: busy ? 'Saving…' : 'Save',
      attrs: {
        type: 'submit',
        'data-focus-key': `td-edit-save-${entry.id}`,
        'aria-label': `${busy ? 'Saving' : 'Save'} changes to ${entry.display_name}`,
      },
    });
    if (busy) setBusyDisabled(save, true);
    const cancel = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: {
        type: 'button',
        'data-focus-key': `td-edit-cancel-${entry.id}`,
        'aria-label': `Cancel editing ${entry.display_name}`,
      },
    });
    if (busy) setBusyDisabled(cancel, true);
    cancel.addEventListener('click', () => {
      if (!state.busy) cancelEdit();
    });
    // A refusal with no box to point at (a dropped connection, say) is its own alert line and takes focus.
    const generalError =
      edit.error && !edit.error.field
        ? el('p', {
            className: 'form-field-error',
            id: errId,
            text: edit.error.message,
            attrs: { role: 'alert', tabindex: '-1' },
          })
        : null;
    const form = el(
      'form',
      {
        className: 'td-edit',
        attrs: { 'aria-label': `Edit ${entry.display_name}`, 'data-entry-id': entry.id },
      },
      [
        note,
        generalError,
        labeledField('Name', nameInput, errorFor('displayName')),
        phoneInput
          ? labeledField('Phone', phoneRow(countrySelect, phoneInput), errorFor('phone'))
          : null,
        labeledField('Café or team (optional)', cafeInput, errorFor('cafe')),
        edit.linked
          ? null
          : el('p', {
              className: 'td-note',
              text: 'This entry has no phone on file, so only the name and café or team can be changed.',
            }),
        el('div', { className: 'td-roster-actions' }, [save, cancel]),
      ].filter(Boolean),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveEdit(entry);
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !state.busy) cancelEdit();
    });
    return form;
  }

  function competitorsCard() {
    const locked = state.data.bracket.started;
    const draft = state.addDraft;
    const disabled = state.busy;
    // Each box keeps its text in state.addDraft, so a refusal (a bad phone, a dropped connection) re-renders with
    // what was typed still there.
    function input(field, { label, type = 'text', maxlength }) {
      const attrs = {
        type,
        'aria-label': label,
        autocomplete: 'off',
        'data-focus-key': `td-new-${field}`,
        'data-field': field,
      };
      if (maxlength) attrs.maxlength = String(maxlength);
      if (field === 'phone') attrs['aria-describedby'] = 'td-new-phone-hint';
      if (state.addError?.field === field) {
        attrs['aria-invalid'] = 'true';
        attrs['aria-describedby'] = 'td-add-error';
      }
      const node = el('input', { className: 'field-input', id: `td-new-${field}`, attrs });
      node.value = draft[field];
      // Busy: read-only and aria-disabled, never native `disabled`, which drops a focused box's focus to <body>
      // (core/dom.js setBusyDisabled).
      node.readOnly = disabled;
      setBusyDisabled(node, disabled);
      node.addEventListener('input', () => {
        draft[field] = node.value;
      });
      return node;
    }
    // The refusal sits under the box it is about, and that box points to it (aria-describedby above).
    const errorFor = (field) =>
      state.addError?.field === field
        ? [
            el('p', {
              className: 'form-field-error',
              id: 'td-add-error',
              text: state.addError.message,
            }),
          ]
        : [];
    const nameInput = input('displayName', {
      label: 'Competitor name',
      maxlength: REGISTRATION_LIMITS.displayName,
    });
    const phoneInput = input('phone', { label: 'Phone', type: 'tel' });
    const countrySelect = phoneCountrySelect({
      label: 'Phone country',
      value: draft.phoneCountry,
      busy: disabled,
      id: 'td-new-phoneCountry',
      focusKey: 'td-new-phoneCountry',
      onChange: (value) => {
        // While saving, the choice is not taken: re-render so the box shows the held country again.
        if (state.busy) {
          render();
          return;
        }
        draft.phoneCountry = value;
      },
    });
    const cafeInput = input('cafe', {
      label: 'Café or team (optional)',
      maxlength: REGISTRATION_LIMITS.cafe,
    });
    const submit = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Add competitor',
      attrs: { type: 'submit', 'data-focus-key': 'td-add-submit' },
    });
    if (disabled) setBusyDisabled(submit, true);
    const form = el('form', { className: 'td-add', attrs: { 'aria-label': 'Add a competitor' } }, [
      labeledField('Name', nameInput, errorFor('displayName')),
      labeledField('Phone', phoneRow(countrySelect, phoneInput), [
        // An error replaces the hint (components.css's own sibling rule cannot reach a box inside .phone-row).
        ...(state.addError?.field === 'phone'
          ? errorFor('phone')
          : [
              el('p', {
                className: 'form-field-hint',
                id: 'td-new-phone-hint',
                text: 'Links their results to their Seduh ID. Never shown to the audience.',
              }),
            ]),
      ]),
      labeledField('Café or team (optional)', cafeInput, errorFor('cafe')),
      submit,
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (state.busy) return;
      const problem = validateCompetitorDraft(draft);
      if (problem) {
        state.addError = problem;
        state.feedback = null;
        state.focusTarget = `td-new-${problem.field}`;
        render();
        return;
      }
      state.addError = null;
      act(async () => {
        const known = new Set(state.data.entries.map((entry) => entry.id));
        const entry = await registerAndLink(
          state.event.org_id,
          eventId,
          buildCompetitor(draft),
          client,
        );
        state.addDraft = blankCompetitorDraft();
        state.focusTarget = 'td-new-displayName';
        state.feedback = { tone: 'success', text: addedWords(entry, known.has(entry.id)) };
      });
    });
    const rows = state.data.entries.map((entry) => {
      const editingThis = state.edit?.entryId === entry.id;
      // Hidden while its own form is open (the form's Cancel returns focus here). While ANOTHER row's form is open it is
      // parked, not removed: one edit at a time, and a stray tap must not discard what is typed in the open one.
      let editButton = null;
      if (!editingThis) {
        editButton = button('Edit', () => openEdit(entry), { key: `td-edit-btn-${entry.id}` });
        editButton.id = `td-edit-btn-${entry.id}`;
        editButton.setAttribute('aria-label', `Edit ${entry.display_name}`);
        if (state.edit) editButton.setAttribute('aria-disabled', 'true');
      }
      return el(
        'li',
        { className: 'td-roster-row' },
        [
          el('span', {
            className: 'td-roster-name',
            text: entry.display_name + (entry.withdrawn ? ' (withdrawn)' : ''),
          }),
          el(
            'div',
            { className: 'td-roster-actions' },
            [
              editButton,
              button(
                entry.withdrawn ? 'Restore' : 'Withdraw',
                () => act(() => setEntryWithdrawn(entry.id, !entry.withdrawn, client)),
                { key: `td-withdraw-${entry.id}` },
              ),
            ].filter(Boolean),
          ),
          editingThis ? editForm(entry) : null,
        ].filter(Boolean),
      );
    });
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-competitors-h' } },
      [
        el('h2', { id: 'td-competitors-h', text: `Competitors (${activeEntries().length})` }),
        rows.length
          ? el('ul', { className: 'td-roster' }, rows)
          : el('p', { text: 'No competitors yet.' }),
        locked
          ? el('p', {
              className: 'td-note',
              text: 'The draw has started. Edit corrects a name, phone or café or team, and the bracket uses the new name. Withdrawing a competitor does not change the bracket: record a walkover on their match.',
            })
          : form,
        // Test events only (the database refuses a real event regardless): eight made-up competitors, no typing.
        !locked && state.event.is_test
          ? renderDemoRosterCard({
              idPrefix: 'td',
              noun: 'competitors',
              busy: state.busy,
              onLoad: () =>
                act(async () => {
                  try {
                    const loaded = await loadDemoRoster(state.event.org_id, eventId, client);
                    state.feedback = { tone: 'success', text: describeDemoRosterLoaded(loaded) };
                  } catch (err) {
                    state.feedback = { tone: 'error', text: describeDemoRosterError(err) };
                  }
                }),
            })
          : null,
      ].filter(Boolean),
    );
  }

  function setupCard() {
    const f = state.form;
    const judges = el('input', {
      className: 'field-input',
      attrs: {
        type: 'number',
        min: '1',
        max: '15',
        inputmode: 'numeric',
        value: String(f.judgeCount),
        'aria-label': 'Number of judges',
        'data-focus-key': 'td-judges',
      },
    });
    judges.addEventListener('change', () => {
      f.judgeCount = Number(judges.value);
    });
    const third = el('input', { attrs: { type: 'checkbox', 'data-focus-key': 'td-third' } });
    third.checked = f.thirdPlace;
    third.addEventListener('change', () => {
      f.thirdPlace = third.checked;
    });
    const mode = (value, label) => {
      const input = el('input', {
        attrs: { type: 'radio', name: 'td-seeding', value, 'data-focus-key': `td-mode-${value}` },
      });
      input.checked = f.seedingMode === value;
      input.addEventListener('change', () => {
        f.seedingMode = value;
        state.draw = null;
        render();
      });
      return el('label', { className: 'td-choice' }, [input, document.createTextNode(` ${label}`)]);
    };
    const sheet = f.scoresheet;
    const sheetToggle = el('input', {
      attrs: { type: 'checkbox', 'data-focus-key': 'td-sheet-on' },
    });
    sheetToggle.checked = sheet.on;
    sheetToggle.addEventListener('change', () => {
      sheet.on = sheetToggle.checked;
      render();
    });
    const sheetBlock = [
      el('label', { className: 'td-choice' }, [
        sheetToggle,
        document.createTextNode(' Scoresheet rounds (judges’ paper sheets decide some rounds)'),
      ]),
    ];
    if (sheet.on) {
      const preset = el(
        'select',
        {
          className: 'field-input',
          attrs: { 'aria-label': 'Scoresheet', 'data-focus-key': 'td-sheet-preset' },
        },
        presetKeys().map((k) => el('option', { text: PRESET_WORDS[k] ?? k, attrs: { value: k } })),
      );
      preset.value = sheet.preset;
      preset.addEventListener('change', () => {
        sheet.preset = preset.value;
      });
      sheetBlock.push(
        el('label', { className: 'td-choice' }, [document.createTextNode('Sheet '), preset]),
        el('fieldset', { className: 'td-choice-group' }, [
          el('legend', { text: 'Cups per competitor' }),
          ...ROUND_ROLES.map((role) => {
            const select = el(
              'select',
              {
                className: 'field-input',
                attrs: { 'aria-label': ROLE_WORDS[role], 'data-focus-key': `td-cups-${role}` },
              },
              [
                el('option', { text: 'Votes (taps)', attrs: { value: '0' } }),
                ...[1, 2, 3].map((n) =>
                  el('option', {
                    text: `${n} ${n === 1 ? 'cup' : 'cups'}`,
                    attrs: { value: String(n) },
                  }),
                ),
              ],
            );
            select.value = String(sheet.cups[role]);
            select.addEventListener('change', () => {
              sheet.cups[role] = Number(select.value);
            });
            return el('label', { className: 'td-choice' }, [
              document.createTextNode(`${ROLE_WORDS[role]} `),
              select,
            ]);
          }),
          el('p', {
            className: 'td-note',
            text: 'Scores are typed in on this screen from the judges’ paper sheets. The audience sees only who won.',
          }),
        ]),
      );
    }
    const redemptionBlock = redemptionSetupBlock(f.redemption);
    const blocks = [
      el('label', { className: 'td-choice' }, [document.createTextNode('Judges '), judges]),
      el('label', { className: 'td-choice' }, [
        third,
        document.createTextNode(' Play a 3rd place match'),
      ]),
      el('fieldset', { className: 'td-choice-group' }, [
        el('legend', { text: 'Draw' }),
        mode('random', 'Random draw'),
        mode('manual', 'Manual draw (draw-a-number events)'),
      ]),
      ...sheetBlock,
      ...redemptionBlock,
    ];
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-setup-h' } },
      [
        el('h2', { id: 'td-setup-h', text: 'Setup' }),
        ...blocks,
        el('p', { className: 'td-note', text: 'Setup is locked as soon as Round 1 starts.' }),
      ],
    );
  }

  // The redemption module's setup: on/off, the group size, the cap on brewers who come back, and the feeding rounds. A
  // module that is off draws nothing else and stores nothing (redemption.js redemptionModuleFromForm).
  function redemptionSetupBlock(red) {
    const toggle = el('input', {
      attrs: { type: 'checkbox', 'data-focus-key': 'td-redemption-on' },
    });
    toggle.checked = red.on;
    toggle.addEventListener('change', () => {
      red.on = toggle.checked;
      render();
    });
    const block = [
      el('label', { className: 'td-choice' }, [
        toggle,
        document.createTextNode(
          ' Redemption round (competitors who lose get a second chance in a group)',
        ),
      ]),
    ];
    if (!red.on) return block;
    const cap = el('input', {
      className: 'field-input',
      attrs: {
        type: 'number',
        min: '0',
        max: '99',
        step: '1',
        inputmode: 'numeric',
        'data-focus-key': 'td-red-cap',
      },
    });
    cap.value = String(red.cap);
    cap.addEventListener('change', () => {
      red.cap = cap.value === '' ? Number.NaN : Number(cap.value);
    });
    const rounds = Array.from({ length: MAX_FEED_ROUND }, (_, i) => i + 1).map((n) => {
      const box = el('input', {
        attrs: { type: 'checkbox', 'data-focus-key': `td-red-feed-${n}` },
      });
      box.checked = red.feed.includes(n);
      box.addEventListener('change', () => {
        red.feed = box.checked ? [...red.feed, n] : red.feed.filter((x) => x !== n);
      });
      return el('label', { className: 'td-choice' }, [
        box,
        document.createTextNode(` After Round ${n}`),
      ]);
    });
    block.push(
      el('label', { className: 'td-choice' }, [
        document.createTextNode('At most this many come back (0 = no limit) '),
        cap,
      ]),
      el('fieldset', { className: 'td-choice-group' }, [
        el('legend', { text: 'Losers of these rounds are drawn into groups' }),
        ...rounds,
        el('p', {
          className: 'td-note',
          text: 'Losers are drawn at random into pairs (1 v 1; with an odd number, one group has three). Each group votes for one winner, who goes back into the bracket. A redemption round only follows a round that leaves more than four winners, and only with at least two brewers to draw. The same brewer can come back more than once.',
        }),
      ]),
    );
    return block;
  }

  function pairsTable(pairs) {
    return el(
      'ol',
      { className: 'td-preview' },
      previewRoundOne(pairs).map((m) =>
        el('li', {
          text: m.bye ? `${nameOf(m.a)} — bye` : `${nameOf(m.a)} vs ${nameOf(m.b)}`,
        }),
      ),
    );
  }

  // The chosen modules as saved: nothing at all when the scoresheet toggle is off. The database copies the preset's lines.
  function modulesFromForm() {
    const sheet = state.form.scoresheet;
    const modules = redemptionModuleFromForm(state.form.redemption);
    if (!sheet.on) return modules;
    const cups = Object.fromEntries(Object.entries(sheet.cups).filter(([, n]) => n > 0));
    return { scoresheet: { preset: sheet.preset, cups }, ...modules };
  }

  function startDraw(mode, pairs, seed) {
    const settings = {
      judgeCount: state.form.judgeCount,
      thirdPlace: state.form.thirdPlace,
      seedingMode: mode,
      modules: modulesFromForm(),
    };
    if (state.form.scoresheet.on && Object.keys(modulesFromForm().scoresheet.cups).length === 0) {
      state.feedback = {
        tone: 'error',
        text: describeThrowdownError({ hint: 'td_scoresheet_invalid' }),
      };
      render();
      return Promise.resolve();
    }
    const redemptionIssue = redemptionProblem(state.form.redemption);
    if (redemptionIssue) {
      state.feedback = { tone: 'error', text: REDEMPTION_PROBLEM_WORDS[redemptionIssue] };
      render();
      return Promise.resolve();
    }
    return act(
      async () => {
        await saveSettings(state.event.org_id, eventId, settings, client);
        return startEvent(
          {
            orgId: state.event.org_id,
            eventId,
            mode,
            seed,
            slotCount: pairs.length * 2,
            pairs,
          },
          handlers,
        );
      },
      { publish: true },
    );
  }

  function drawCard() {
    const active = activeEntries();
    const mode = state.form.seedingMode;
    const body = [];
    const problemsFor = (pairs) =>
      drawProblems({ mode, pairs, activeEntryIds: active.map((e) => e.id) });
    const problemText = (code) => describeThrowdownError({ hint: code });
    if (mode === 'random') {
      if (active.length < 2) body.push(el('p', { text: 'Add at least two competitors to draw.' }));
      else {
        body.push(
          button(
            state.draw ? 'Draw again' : 'Draw the bracket',
            () => {
              const seed = newSeed();
              state.draw = {
                seed,
                pairs: randomPairs(
                  active.map((e) => e.id),
                  seed,
                ),
              };
              render();
            },
            {
              className: 'btn btn-outline tap-target',
              key: 'td-draw',
              disabled: state.startQueued,
            },
          ),
        );
      }
      if (state.draw?.pairs) {
        body.push(
          el('p', {
            className: 'td-note',
            text: `Draw code ${state.draw.seed} (the same code always gives this draw).`,
          }),
          pairsTable(state.draw.pairs),
          button('Start Round 1', () => startDraw('random', state.draw.pairs, state.draw.seed), {
            className: 'btn btn-primary tap-target',
            key: 'td-start',
            disabled: state.startQueued || problemsFor(state.draw.pairs).length > 0,
          }),
        );
        const randomProblems = problemsFor(state.draw.pairs);
        if (randomProblems.length) {
          body.push(
            el('p', { className: 'td-note', text: randomProblems.map(problemText).join(' ') }),
          );
        }
      }
    } else {
      state.draw ??= { slotCount: Math.max(2, active.length + (active.length % 2)), pairs: null };
      state.draw.pairs ??= emptyBoard(state.draw.slotCount);
      const count = el('input', {
        className: 'field-input',
        attrs: {
          type: 'number',
          min: '2',
          max: '64',
          inputmode: 'numeric',
          value: String(state.draw.slotCount),
          'aria-label': 'Number of slots',
          'data-focus-key': 'td-slots',
        },
      });
      count.addEventListener('change', () => {
        const n = Math.min(64, Math.max(2, Number(count.value) || 2));
        const board = emptyBoard(n);
        state.draw.pairs.forEach((p, i) => {
          if (board[i]) board[i] = [...p];
        });
        state.draw = { slotCount: n, pairs: board };
        render();
      });
      body.push(
        el('label', { className: 'td-choice' }, [document.createTextNode('Slots '), count]),
      );
      const rows = state.draw.pairs.map((pair, i) =>
        el(
          'li',
          { className: 'td-slot-row' },
          [0, 1].map((side) => {
            const select = el(
              'select',
              {
                className: 'field-input',
                attrs: {
                  'aria-label': `Match ${i + 1}, slot ${side + 1}`,
                  'data-focus-key': `td-slot-${i}-${side}`,
                },
              },
              [
                el('option', { text: '— empty —', attrs: { value: '' } }),
                ...active.map((e) =>
                  el('option', { text: e.display_name, attrs: { value: e.id } }),
                ),
              ],
            );
            select.value = pair[side] ?? '';
            select.addEventListener('change', () => {
              state.draw.pairs = assignSlot(state.draw.pairs, i, side, select.value || null);
              render();
            });
            return select;
          }),
        ),
      );
      body.push(el('ol', { className: 'td-board' }, rows));
      const problems = problemsFor(state.draw.pairs);
      body.push(pairsTable(normalisePairs(state.draw.pairs)));
      if (problems.length)
        body.push(el('p', { className: 'td-note', text: problems.map(problemText).join(' ') }));
      body.push(
        button('Start Round 1', () => startDraw('manual', normalisePairs(state.draw.pairs), null), {
          className: 'btn btn-primary tap-target',
          key: 'td-start',
          disabled: state.startQueued || problems.length > 0,
        }),
      );
    }
    return el('section', { className: 'card td-card', attrs: { 'aria-labelledby': 'td-draw-h' } }, [
      el('h2', { id: 'td-draw-h', text: 'Draw' }),
      ...(state.startQueued
        ? [
            el('p', {
              className: 'td-note',
              text: 'The draw is waiting to sync. It starts when the connection is back.',
            }),
          ]
        : []),
      ...body,
    ]);
  }

  function championBanner() {
    const b = state.data.bracket;
    if (!b.champion) return null;
    return el(
      'section',
      { className: 'td-champion', attrs: { role: 'status', 'aria-label': 'Champion' } },
      [
        el('p', { className: 'td-champion-label', text: 'Champion' }),
        el('p', { className: 'td-champion-name', text: b.champion }),
        b.runnerUp ? el('p', { text: `Runner-up: ${b.runnerUp}` }) : null,
        b.thirdPlace ? el('p', { text: `3rd place: ${b.thirdPlace}` }) : null,
      ].filter(Boolean),
    );
  }

  // The count shown for a side: the database's plus taps still waiting to sync.
  function displayedTallies(match) {
    const pending = state.pending.get(match.id) ?? {
      deltas: new Map(),
      queued: 0,
      decisionQueued: false,
    };
    const slots = match.sides.map((s) => ({
      id: s.slotId,
      position: s.position,
      entryId: s.entryId,
    }));
    const votes = match.sides.flatMap((s) =>
      Array.from({ length: Math.max(0, s.votes + (pending.deltas.get(s.slotId) ?? 0)) }, () => ({
        slotId: s.slotId,
      })),
    );
    return {
      tallies: tallyVotes(slots, votes),
      queued: pending.queued,
      decisionQueued: pending.decisionQueued,
    };
  }

  function walkoverDetails(match, decisionQueued) {
    const details = el('details', { className: 'td-walkover' }, [
      el('summary', { className: 'tap-target', text: 'Walkover (a competitor does not show)' }),
      ...match.sides.map((side, i) =>
        button(
          `${side.name} advances`,
          () => {
            state.walkover = { matchId: match.id, slotId: side.slotId };
            render();
          },
          { key: `td-walkover-${match.id}-${i}`, disabled: decisionQueued },
        ),
      ),
    ]);
    if (state.walkoverOpen === match.id) details.open = true;
    details.addEventListener('toggle', () => {
      if (details.open) state.walkoverOpen = match.id;
      else if (state.walkoverOpen === match.id) state.walkoverOpen = null;
    });
    return details;
  }

  function voteCard(match) {
    const { tallies, queued, decisionQueued } = displayedTallies(match);
    const lead = leadOf(tallies);
    const judges = state.data.settings.judge_count;
    // One tap is one judge's vote (votes.js voteState, the same rule as td_cast_vote): the Vote buttons stop once every
    // judge has voted, taps still waiting to sync included, except for ONE tie-break vote when an even panel is level.
    // Undo frees a vote. The note below says why Vote is off; each Vote button points at it (aria-describedby).
    const cap = voteState(tallies, judges);
    // the tie-break vote goes only to a brewer in the tie (a group of three or four can have one left out of it)
    const tied = new Set(tiedSlotIds(tallies));
    const noteId = `td-vote-note-${match.id}`;
    const sides = match.sides.map((side, i) => {
      const count = tallies.find((t) => t.slotId === side.slotId)?.votes ?? 0;
      // what this tap does to the cap, spoken with the new count so a screen reader hears why Vote then stops
      const after = voteState(
        tallies.map((t) => (t.slotId === side.slotId ? { ...t, votes: t.votes + 1 } : t)),
        judges,
      );
      const afterWords = after.tieBreakOpen
        ? match.isPool
          ? ` Level with every judge in: the tie-break judge casts one more vote, for ${listWords(
              match.sides
                .filter((s2) =>
                  tiedSlotIds(
                    tallies.map((t) =>
                      t.slotId === side.slotId ? { ...t, votes: t.votes + 1 } : t,
                    ),
                  ).includes(s2.slotId),
                )
                .map((s2) => s2.name),
            )}.`
          : ' Level with every judge in: the tie-break judge casts one more vote.'
        : after.open
          ? ''
          : ' Every judge has voted.';
      const vote = button(
        `Vote ${side.name}`,
        () =>
          tapAct(
            () =>
              castVote(
                { orgId: state.event.org_id, matchId: match.id, slotId: side.slotId },
                handlers,
              ),
            `${side.name}: ${count + 1} ${count + 1 === 1 ? 'vote' : 'votes'}.${afterWords}`,
          ),
        {
          className: 'btn btn-primary tap-target td-vote',
          key: `td-vote-${match.id}-${i}`,
          ignoreBusy: true,
          disabled:
            !cap.open ||
            decisionQueued ||
            state.deciding ||
            (cap.tieBreakOpen && !tied.has(side.slotId)),
        },
      );
      vote.setAttribute('aria-describedby', noteId);
      return el('div', { className: 'td-side' }, [
        vote,
        el('p', {
          className: 'td-count',
          text: `${count} ${count === 1 ? 'vote' : 'votes'}`,
        }),
        button(
          'Undo',
          () =>
            tapAct(
              () =>
                undoVote(
                  { orgId: state.event.org_id, matchId: match.id, slotId: side.slotId },
                  handlers,
                ),
              `${side.name}: ${Math.max(0, count - 1)} ${count - 1 === 1 ? 'vote' : 'votes'}`,
            ),
          {
            key: `td-undo-${match.id}-${i}`,
            ignoreBusy: true,
            disabled: count === 0 || decisionQueued || state.deciding,
          },
        ),
      ]);
    });
    const status = decisionQueued
      ? 'The result is waiting to sync. Voting is closed for this match.'
      : cap.total === 0
        ? `Waiting for votes (${judges} ${judges === 1 ? 'judge' : 'judges'}).`
        : cap.over
          ? queued
            ? `More taps than judges (${cap.total} for ${judges}). Taps past the limit will be refused when they sync; check the count then, before using Undo.`
            : `More votes than judges (${cap.total} for ${judges}). Use Undo to take back the extra votes.`
          : cap.tieBreakOpen
            ? match.isPool
              ? `The votes are level and every judge has voted. The tie-break judge casts one more vote, for ${listWords(
                  match.sides.filter((s) => tied.has(s.slotId)).map((s) => s.name),
                )}.`
              : 'The votes are level and every judge has voted. The tie-break judge casts one more vote.'
            : lead.level
              ? 'The votes are level. Take another vote before confirming.'
              : cap.tieBreakUsed
                ? `${judges} of ${judges} votes in, plus the tie-break vote. Every judge has voted.`
                : cap.open
                  ? `${cap.total} of ${judges} votes in.`
                  : `${cap.total} of ${judges} votes in. Every judge has voted.`;
    const winnerName = lead.leaderSlotId
      ? match.sides.find((s) => s.slotId === lead.leaderSlotId)?.name
      : null;
    return el(
      'article',
      { className: 'card td-match', attrs: { 'aria-label': matchTitle(match) } },
      [
        el('h3', { text: matchTitle(match) }),
        el('div', { className: 'td-sides' }, sides),
        el('p', {
          className: 'td-note',
          id: noteId,
          text: status + (queued ? ` ${queued} waiting to sync.` : ''),
        }),
        button(
          winnerName ? `Confirm: ${winnerName} wins` : 'Confirm result',
          () =>
            act(
              () =>
                confirmMatch(
                  {
                    orgId: state.event.org_id,
                    matchId: match.id,
                    expectedWinnerSlotId: lead.leaderSlotId,
                  },
                  handlers,
                ),
              { publish: true },
            ),
          {
            className: 'btn btn-primary tap-target',
            key: `td-confirm-${match.id}`,
            disabled: decisionQueued || !canConfirm(tallies),
          },
        ),
        walkoverRow(match, decisionQueued),
      ],
    );
  }

  // The walkover control (either side advances), shared by the tap card and the scored card.
  function walkoverRow(match, decisionQueued) {
    return state.walkover?.matchId === match.id
      ? el('div', { className: 'td-walkover' }, [
          el('p', {
            text: `${match.sides.find((s) => s.slotId === state.walkover.slotId)?.name} advances by walkover?`,
          }),
          button(
            'Confirm walkover',
            () => {
              const winnerSlotId = state.walkover.slotId;
              state.walkover = null;
              return act(
                () =>
                  recordWalkover(
                    { orgId: state.event.org_id, matchId: match.id, winnerSlotId },
                    handlers,
                  ),
                { publish: true },
              );
            },
            {
              className: 'btn btn-primary tap-target',
              key: `td-walkover-ok-${match.id}`,
            },
          ),
          button(
            'Cancel',
            () => {
              state.walkover = null;
              render();
            },
            { key: `td-walkover-cancel-${match.id}` },
          ),
        ])
      : walkoverDetails(match, decisionQueued);
  }

  // The read-only score breakdown of a decided scored match (console only).
  function auditDetails(match) {
    if (match.resultKind !== 'scores') return null;
    const view = scoredView(scoringContext(state.data), match);
    if (!view || !auditRule(view)) return null;
    return el('details', { className: 'td-audit-details' }, [
      el('summary', { className: 'tap-target', text: 'Score breakdown' }),
      buildAudit(view, match.sides.find((s) => s.winner)?.name),
    ]);
  }

  // ---------- undoing a confirmed result ----------
  // Offered on a decided match while nothing after it has started (reopen.js; the database checks again). Two taps: Undo
  // result, then Yes, undo. The match then reappears under Now playing with its votes or sheets kept.
  function undoControl(m, roundLabel) {
    if (matchesAwaitingUndo(state.data.bracket, state.pending).has(m.id)) return null;
    const st = reopenState(state.data.bracket, m.id, {
      sheets: state.data.scoreSheets,
      pending: state.pending,
      entries: state.data.entries,
      thirdPlace: state.data.settings.third_place,
    });
    if (st.reason === 'queued') {
      return el('p', { className: 'td-note', text: 'Undo waiting to sync.' });
    }
    if (!st.allowed) return null;
    if (state.reopen !== m.id) {
      const undo = button(
        'Undo result',
        () => {
          state.reopen = m.id;
          state.focusTarget = `td-reopen-q-${m.id}`;
          render();
        },
        { key: `td-reopen-${m.id}` },
      );
      // several matches can offer Undo at once: the name says which (it starts with the visible words, WCAG 2.5.3)
      undo.setAttribute('aria-label', `Undo result: ${roundLabel}, ${matchTitle(m)}`);
      undo.id = `td-reopen-btn-${m.id}`;
      return undo;
    }
    const words = reopenWords(m, st.later, {
      scored: cupsForMatch(scoringContext(state.data), m) !== null,
    });
    const detailId = `td-reopen-d-${m.id}`;
    const yes = button(
      'Yes, undo',
      () => {
        state.reopen = null;
        // a refusal re-renders this match with Undo result again (focus goes back there; success moves it to Now playing)
        state.focusTarget = `td-reopen-btn-${m.id}`;
        return act(
          () =>
            reopenMatch(
              { orgId: state.event.org_id, matchId: m.id, expectedWinnerSlotId: m.winnerSlotId },
              handlers,
            ),
          { publish: true },
        ).then(() => {
          // ...unless the refusal is that the match can no longer be undone (another device started the next round),
          // so the button is gone: focus the Bracket heading, beside the refusal, never the page body
          if (state.feedback?.tone === 'error' && !root.querySelector(`#td-reopen-btn-${m.id}`)) {
            root.querySelector('#td-bracket-h')?.focus();
          }
        });
      },
      { className: 'btn btn-primary tap-target', key: `td-reopen-ok-${m.id}` },
    );
    yes.setAttribute('aria-describedby', detailId);
    return el('div', { className: 'td-reopen' }, [
      el('p', {
        id: `td-reopen-q-${m.id}`,
        className: 'td-reopen-q',
        text: words.question,
        attrs: { tabindex: '-1' },
      }),
      el('p', { id: detailId, className: 'td-note', text: words.detail }),
      el('div', { className: 'td-reopen-actions' }, [
        yes,
        button(
          'Keep result',
          () => {
            state.reopen = null;
            state.focusTarget = `td-reopen-btn-${m.id}`;
            render();
          },
          { key: `td-reopen-cancel-${m.id}` },
        ),
      ]),
    ]);
  }

  function bracketCard() {
    const awaitingUndo = matchesAwaitingUndo(state.data.bracket, state.pending);
    const rounds = state.data.bracket.rounds.map((round) =>
      el('section', { className: 'td-round', attrs: { 'aria-label': round.label } }, [
        el('h3', { text: round.label }),
        el(
          'ul',
          { className: 'td-round-list' },
          round.matches.map((m) => {
            const result = resultLine(m);
            return el(
              'li',
              { className: 'td-round-match' },
              [
                el('span', { text: matchTitle(m) }),
                m.decided
                  ? el('span', {
                      className: 'td-result',
                      text: `${m.sides.find((s) => s.winner)?.name ?? ''} — ${result}`,
                    })
                  : el('span', {
                      className: 'td-result',
                      text: awaitingUndo.has(m.id)
                        ? 'Removed when the undo syncs'
                        : m.playable
                          ? 'Being decided'
                          : 'Waiting',
                    }),
                auditDetails(m),
                undoControl(m, round.label),
              ].filter(Boolean),
            );
          }),
        ),
      ]),
    );
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-bracket-h' } },
      [el('h2', { id: 'td-bracket-h', text: 'Bracket', attrs: { tabindex: '-1' } }), ...rounds],
    );
  }

  const { scoredCard } = createScoreEntry({
    state,
    button,
    act,
    tapAct,
    handlers,
    render: () => render(),
    scoringContext: () => scoringContext(state.data),
    walkoverRow,
  });

  // ---------- render ----------

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container td-screen' });
      if (state.loading) {
        container.appendChild(el('h1', { text: 'Event' }));
        container.appendChild(
          el('div', {
            className: 'screen-feedback',
            text: 'Loading event…',
            attrs: { role: 'status', 'aria-live': 'polite' },
          }),
        );
        root.appendChild(container);
        return false;
      }
      if (state.loadError) {
        container.appendChild(el('h1', { text: 'Event' }));
        const fb = el('div', {
          className: 'screen-feedback',
          text: state.loadError,
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        fb.dataset.tone = 'error';
        container.append(
          fb,
          button(
            'Retry',
            () => {
              state.loading = true;
              render();
              refresh();
            },
            { key: 'td-retry' },
          ),
        );
        root.appendChild(container);
        return false;
      }
      if (state.event.is_test) {
        container.appendChild(
          el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
        );
      }
      container.appendChild(
        el('h1', { id: 'td-heading', text: state.event.name, attrs: { tabindex: '-1' } }),
      );
      const fb = feedbackNode();
      if (state.feedback?.tone) fb.dataset.tone = state.feedback.tone;
      container.appendChild(fb);
      const banner = championBanner();
      if (banner) container.appendChild(banner);
      if (!state.data.bracket.started) {
        container.append(competitorsCard(), setupCard(), drawCard());
      } else {
        const awaitingUndo = matchesAwaitingUndo(state.data.bracket, state.pending);
        const playable = state.data.bracket.playableMatches.filter((m) => !awaitingUndo.has(m.id));
        container.appendChild(
          el('section', { className: 'td-now', attrs: { 'aria-labelledby': 'td-now-h' } }, [
            el('h2', {
              id: 'td-now-h',
              attrs: { tabindex: '-1' },
              text: playable.length
                ? 'Now playing'
                : state.data.bracket.complete
                  ? 'Finished'
                  : 'Waiting for results',
            }),
            ...playable.map((m) =>
              cupsForMatch(scoringContext(state.data), m) !== null ? scoredCard(m) : voteCard(m),
            ),
          ]),
        );
        container.append(
          ...[
            bracketCard(),
            hasRedemptionRound(state.data.bracket)
              ? el('a', {
                  className: 'btn btn-outline tap-target',
                  text: 'Redemption round: who is in',
                  attrs: { href: `#/events/${eventId}/throwdown/redemption` },
                })
              : null,
            el('a', {
              className: 'btn btn-outline tap-target',
              text: 'Results and match log',
              attrs: { href: `#/events/${eventId}/throwdown/results` },
            }),
            competitorsCard(),
          ].filter(Boolean),
        );
      }
      root.appendChild(container);
      if (state.focusTarget) {
        const target = root.querySelector(`#${state.focusTarget}`);
        state.focusTarget = null;
        if (target) {
          target.focus();
          return true;
        }
      }
      return false;
    });
  }

  // When the connection comes back, reload: the outbox drains on its own, and the screen should catch up with it.
  const onOnline = () => {
    if (!signal?.aborted) refreshSoon();
  };
  globalThis.addEventListener?.('online', onOnline);
  signal?.addEventListener('abort', () => globalThis.removeEventListener?.('online', onOnline));

  render();
  await refresh();

  return {
    unmount() {
      globalThis.removeEventListener?.('online', onOnline);
    },
  };
}
