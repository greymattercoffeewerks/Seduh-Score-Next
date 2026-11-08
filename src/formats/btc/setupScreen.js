// BTC Setup screen (Phase T-BTC.2) — team roster and judge pool for an event.
// Combines both into one screen, mirroring legacy's own Setup screen
// (bbtc/index.html's rSetup()) rather than splitting them across two routes —
// there's no independent reason for an organiser to manage one without the
// other. Built on the current best-practice shape this codebase has
// converged on (core/dom.js's setBusyDisabled/withFocusPreservation, a toast
// for transient feedback, a bounded raceTimeout against a hung initial
// load) — see src/community/guess-the-bean/setupScreen.js for the closest
// sibling this was modeled on.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { publishBtcLive } from './liveSession.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams, createTeam, updateTeam, removeTeam } from './teams.js';
import { listJudges, createJudge, updateJudge, removeJudge } from './judges.js';
import { countrySelect } from './countrySelect.js';
import { teamLabel } from './words.js';
import {
  DEMO_TEAM_COUNT,
  DEMO_JUDGE_COUNT,
  DEMO_MATCH_COUNT,
  DEMO_LOAD_TIMEOUT_MS,
  DEMO_TIMEOUT_MESSAGE,
  DEMO_REFRESH_FAILED_MESSAGE,
  loadDemo,
  describeDemoError,
  describeDemoLoaded,
} from './demo.js';

export function validateRosterName(name, label) {
  if (!name.trim()) return `${label} name is required.`;
  return null;
}

// The database's own limit on a team's optional "represents" label (btc_teams_represents_length).
export const REPRESENTS_MAX = 60;

export function validateRepresents(value) {
  if (value.trim().length > REPRESENTS_MAX) {
    return `Represents must be ${REPRESENTS_MAX} characters or fewer.`;
  }
  return null;
}

// '' (nothing chosen or typed) is stored as null, never as an empty string.
const orNull = (value) => (value.trim() === '' ? null : value.trim());

export async function mountSetupScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  let state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    judges: [],
    teamDraft: '',
    judgeDraft: '',
    teamCountryDraft: '',
    teamRepresentsDraft: '',
    judgeCountryDraft: '',
    teamError: null,
    teamErrorField: 'name', // which field teamError belongs to: 'name' | 'represents'
    judgeError: null,
    // The one row being edited (teams and judges share it, so one row edits at a time):
    // null | { kind: 'team' | 'judge', id, countryCode, represents, error }.
    edit: null,
    busy: false,
    toastMessage: null,
    // The demo card's own result, kept inside the card and NOT auto-dismissed (the shared toast
    // vanishes after 1.5 s, far too fast to read a result that replaced a whole roster):
    // null | { tone: 'busy' | 'success' | 'error', message }. Cleared when the next roster action
    // makes it out of date (showToast) or the next load starts.
    demoStatus: null,
    demoBusyScored: null,
    // null | 'heading' | 'toast' | 'edit-first' (the first field of the row just opened for editing) |
    // 'focus:<data-focus-key>' (a named control, for example the Edit button of the row just saved or cancelled) —
    // consumed once by render() below. Separate
    // from withFocusPreservation's own restore-by-selector mechanism: that
    // one only ever re-focuses a control that ALREADY had focus before this
    // render (e.g. the name input, mid-typing, on a validation error) —
    // this flag covers the two cases nothing was already focused for: a
    // load finishing (heading) and a toast confirming an action succeeded
    // or failed (toast), both found missing in review
    // (ui-accessibility-reviewer).
    pendingFocus: null,
  };
  let toastTimer;

  // The audience display follows every change the room should see (liveSession.js). Best-effort: a failed or
  // offline publish stays queued and changes nothing about the action that triggered it. A programming error
  // (no handler map, an event without is_test) rejects, so it is logged here rather than left unhandled.
  function requestLivePublish(takeOver) {
    publishBtcLive({ event: state.event, takeOver }, handlers).catch((error) => {
      console.error('btc: live-view publish was refused', error);
    });
  }

  // Deliberately does NOT call render() itself — every call site already
  // ends with its own trailing `state.busy = false; render();`, and a
  // render() here too would tear the toast-focused DOM back down a moment
  // later with pendingFocus already consumed, silently dropping focus to
  // <body> (found live while adding a focus-move regression test — the
  // caller's OWN final render() must be the one that actually shows the
  // toast and applies pendingFocus, not a second, earlier one this
  // function used to trigger itself).
  function showToast(message) {
    state.demoStatus = null;
    state.toastMessage = message;
    state.pendingFocus = 'toast';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.toastMessage = null;
      render();
    }, 1500);
  }

  async function loadPersisted() {
    const [event, teams, judges] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      listJudges(eventId, client),
    ]);
    return { event, teams, judges };
  }

  // Races the initial load against a timeout, same reasoning as every other
  // screen's attemptLoad (rosterScreen.js/setupScreen.js's own precedent) —
  // this project's "unreliable venue wifi" design target means a hung
  // request must never leave the screen stuck loading forever with no
  // retry affordance.
  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.event = persisted.event;
      state.teams = persisted.teams;
      state.judges = persisted.judges;
      state.loadFailedMessage = null;
      // Covers both the initial mount and a successful Retry — renderLoadError()
      // already moves focus to itself on a FAILED load; nothing previously
      // did the equivalent on success, silently leaving focus wherever it
      // was (on Retry) or at <body> (on first mount), with no confirmation
      // a keyboard/screen-reader user could act on. Found in review
      // (ui-accessibility-reviewer).
      state.pendingFocus = 'heading';
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  async function handleAddTeam(domEvent) {
    domEvent.preventDefault();
    if (state.busy) return;
    const validationMessage = validateRosterName(state.teamDraft, 'Team');
    if (validationMessage) {
      state.teamError = validationMessage;
      state.teamErrorField = 'name';
      render();
      return;
    }
    const representsMessage = validateRepresents(state.teamRepresentsDraft);
    if (representsMessage) {
      state.teamError = representsMessage;
      state.teamErrorField = 'represents';
      render();
      return;
    }
    state.busy = true;
    state.teamError = null;
    render();
    try {
      const team = await createTeam(
        eventId,
        state.teamDraft.trim(),
        {
          countryCode: orNull(state.teamCountryDraft),
          represents: orNull(state.teamRepresentsDraft),
        },
        client,
      );
      state.teams = state.teams.some((t) => t.id === team.id)
        ? state.teams
        : [...state.teams, team].sort((a, b) => a.name.localeCompare(b.name));
      state.teamDraft = '';
      state.teamCountryDraft = '';
      state.teamRepresentsDraft = '';
      // Standings list every registered team, so a roster change is visible to the room.
      requestLivePublish(false);
      showToast(`${team.name} added.`);
    } catch (err) {
      state.teamError = describeError(err);
      state.teamErrorField = 'name';
    }
    state.busy = false;
    render();
  }

  async function handleRemoveTeam(team) {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      await removeTeam(team.id, client);
      state.teams = state.teams.filter((t) => t.id !== team.id);
      if (state.edit?.id === team.id) state.edit = null;
      requestLivePublish(false);
      showToast(`${team.name} removed.`);
    } catch (err) {
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  async function handleAddJudge(domEvent) {
    domEvent.preventDefault();
    if (state.busy) return;
    const validationMessage = validateRosterName(state.judgeDraft, 'Judge');
    if (validationMessage) {
      state.judgeError = validationMessage;
      render();
      return;
    }
    state.busy = true;
    state.judgeError = null;
    render();
    try {
      const judge = await createJudge(
        eventId,
        state.judgeDraft.trim(),
        { countryCode: orNull(state.judgeCountryDraft) },
        client,
      );
      state.judges = state.judges.some((j) => j.id === judge.id)
        ? state.judges
        : [...state.judges, judge].sort((a, b) => a.name.localeCompare(b.name));
      state.judgeDraft = '';
      state.judgeCountryDraft = '';
      showToast(`${judge.name} added.`);
    } catch (err) {
      state.judgeError = describeError(err);
    }
    state.busy = false;
    render();
  }

  async function handleRemoveJudge(judge) {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      await removeJudge(judge.id, client);
      state.judges = state.judges.filter((j) => j.id !== judge.id);
      if (state.edit?.id === judge.id) state.edit = null;
      showToast(`${judge.name} removed.`);
    } catch (err) {
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  function editFocusKey(kind, id) {
    return `focus:edit-${kind}-${id}`;
  }

  function handleStartEdit(kind, item) {
    if (state.busy) return;
    state.edit = {
      kind,
      id: item.id,
      countryCode: item.country_code ?? '',
      represents: item.represents ?? '',
      error: null,
    };
    state.pendingFocus = 'edit-first';
    render();
  }

  function handleCancelEdit() {
    if (state.busy || !state.edit) return;
    state.pendingFocus = editFocusKey(state.edit.kind, state.edit.id);
    state.edit = null;
    render();
  }

  // Country and represents do not affect scoring, and a team in a match cannot be removed, so editing is the only
  // way to fix a typo once matches exist. Only a TEAM's change reaches the audience display (judge country is
  // organiser-only); it republishes only if the event is already live, as a team add does.
  async function handleSaveEdit(domEvent) {
    domEvent.preventDefault();
    if (state.busy || !state.edit) return;
    const { kind, id } = state.edit;
    if (kind === 'team') {
      const message = validateRepresents(state.edit.represents);
      if (message) {
        state.edit.error = message;
        render();
        return;
      }
    }
    state.busy = true;
    state.edit.error = null;
    render();
    const draft = state.edit;
    try {
      if (kind === 'team') {
        const team = await updateTeam(
          id,
          { countryCode: orNull(draft.countryCode), represents: orNull(draft.represents) },
          client,
        );
        state.teams = state.teams.map((t) => (t.id === id ? team : t));
        requestLivePublish(false);
        showToast(`${team.name} updated.`);
      } else {
        const judge = await updateJudge(id, { countryCode: orNull(draft.countryCode) }, client);
        state.judges = state.judges.map((j) => (j.id === id ? judge : j));
        showToast(`${judge.name} updated.`);
      }
      state.edit = null;
      // The toast confirms in words; focus goes back to the row's Edit button, where the keyboard user was.
      state.pendingFocus = editFocusKey(kind, id);
    } catch (err) {
      if (state.edit) state.edit.error = describeError(err);
    }
    state.busy = false;
    render();
  }

  // Test events only (the card is not offered otherwise, and the database refuses a real event
  // regardless). Replaces EVERYTHING on the event, so it asks first when there is anything to lose:
  // the roster is the test, because a match cannot exist without teams.
  async function handleLoadDemo(scored) {
    if (state.busy) return;
    const hasData = state.teams.length > 0 || state.judges.length > 0;
    if (
      hasData &&
      !window.confirm(
        scored
          ? `Replace everything on this test event with the full demo (${DEMO_TEAM_COUNT} teams, ${DEMO_JUDGE_COUNT} judges and ${DEMO_MATCH_COUNT} scored matches)? Its current teams, judges, matches, scores and bracket will be erased.`
          : `Replace everything on this test event with the demo roster only (${DEMO_TEAM_COUNT} teams and ${DEMO_JUDGE_COUNT} judges, no matches)? Its current teams, judges, matches, scores and bracket will be erased.`,
      )
    ) {
      return;
    }
    state.busy = true;
    state.demoBusyScored = scored;
    state.demoStatus = { tone: 'busy', message: 'Loading demo…' };
    render();
    let loaded;
    try {
      loaded = await raceTimeout(
        loadDemo(state.event.org_id, eventId, { scored }, client),
        DEMO_LOAD_TIMEOUT_MS,
      );
    } catch (err) {
      state.demoStatus = {
        tone: 'error',
        message: err.timedOut ? DEMO_TIMEOUT_MESSAGE : describeDemoError(err),
      };
      state.busy = false;
      render();
      return;
    }
    // The demo IS loaded from here on: refresh the display (a rehearsal on the projector takes it over, as a
    // test heat does for Cup Taster). If re-reading the roster fails, the roster on screen is the
    // OLD one (rows that no longer exist), so do not keep showing it: fall back to the screen's own
    // load-error view, which says the demo loaded and offers Retry.
    requestLivePublish(true);
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.teams = persisted.teams;
      state.judges = persisted.judges;
      state.edit = null;
      state.demoStatus = { tone: 'success', message: describeDemoLoaded(loaded) };
    } catch {
      state.demoStatus = null;
      state.loadFailedMessage = DEMO_REFRESH_FAILED_MESSAGE;
    }
    state.busy = false;
    render();
  }

  function renderDemoCard() {
    const loadButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy && state.demoBusyScored === true ? 'Loading…' : 'Load demo',
      attrs: {
        type: 'button',
        'data-focus-key': 'demo-load',
        'aria-describedby': 'btc-demo-intro btc-demo-warning',
      },
    });
    setBusyDisabled(loadButton, state.busy);
    loadButton.addEventListener('click', () => handleLoadDemo(true));

    const rosterButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: state.busy && state.demoBusyScored === false ? 'Loading…' : 'Load roster only',
      attrs: {
        type: 'button',
        'data-focus-key': 'demo-roster-only',
        'aria-describedby': 'btc-demo-intro btc-demo-warning',
      },
    });
    setBusyDisabled(rosterButton, state.busy);
    rosterButton.addEventListener('click', () => handleLoadDemo(false));

    // The outcome lives HERE, in the card, and stays until the next action. The status region is
    // always present (empty when idle) so a screen reader announces text put into it; a failure is
    // a separate role="alert" node because an inserted alert is announced reliably.
    const status = state.demoStatus;
    const statusNode = el('p', {
      className: 'stage-meta btc-demo-status',
      text: status && status.tone !== 'error' ? status.message : '',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const errorNode =
      status?.tone === 'error'
        ? el('p', {
            className: 'btc-field-error btc-demo-error',
            text: status.message,
            attrs: { role: 'alert' },
          })
        : null;

    return el(
      'section',
      { className: 'card btc-demo-card', attrs: { 'aria-labelledby': 'btc-demo-heading' } },
      [
        el('h2', { text: 'Demo data', attrs: { id: 'btc-demo-heading' } }),
        el('p', {
          id: 'btc-demo-intro',
          className: 'stage-meta',
          text: `Load a ready-made field instead of typing it. "Load demo" gives ${DEMO_TEAM_COUNT} teams, ${DEMO_JUDGE_COUNT} judges and all ${DEMO_MATCH_COUNT} preliminary matches already scored, so you can go straight to Generate bracket; the results are the same every time. "Load roster only" gives the ${DEMO_TEAM_COUNT} teams and ${DEMO_JUDGE_COUNT} judges with no matches, to score everything yourself.`,
        }),
        el('p', {
          id: 'btc-demo-warning',
          className: 'stage-meta btc-demo-warning',
          text: 'Both options replace everything on this test event: its teams, judges, matches, scores and bracket. Loading again starts over.',
        }),
        el('div', { className: 'btc-demo-actions' }, [loadButton, rosterButton]),
        statusNode,
        errorNode,
      ].filter(Boolean),
    );
  }

  // One card per roster (teams, judges): an add form (name, country, and for a team a free "represents" label), then
  // the rows. A row shows "Country · Name" and an Edit button that swaps the row for an inline form with the same
  // country (and represents) fields, Save and Cancel; one row edits at a time (state.edit).
  function renderRosterSection({
    fieldKey,
    heading,
    singularLabel,
    items,
    draftValue,
    draftError,
    errorField,
    placeholder,
    nameHint,
    withRepresents,
    countryDraft,
    representsDraft,
    onDraftInput,
    onCountryChange,
    onRepresentsInput,
    onSubmit,
    onRemove,
    emptyMessage,
  }) {
    const errorId = `btc-${fieldKey}-error`;
    const hintId = `btc-${fieldKey}-name-hint`;
    const nameError = draftError && errorField === 'name';
    const representsError = draftError && errorField === 'represents';

    // aria-label AND the labeledField text both use singularLabel, matching
    // validateRosterName's own singular wording ("Team name is required.")
    // — the input and its own inline error must name the field the same
    // way, or a screen-reader user moving from one to the other hears two
    // different names for the same control (found in review,
    // code-reviewer). data-field is a stable key withFocusPreservation
    // (core/dom.js) looks for by exactly this attribute, so typing a name,
    // hitting a validation error, and re-rendering doesn't drop focus to
    // <body> (found in review, ui-accessibility-reviewer — nothing on this
    // screen carried a focus-key at all).
    const nameDescribedBy = [nameHint ? hintId : null, nameError ? errorId : null].filter(Boolean);
    const input = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        'aria-label': `${singularLabel} name`,
        placeholder,
        'data-field': fieldKey,
        ...(nameDescribedBy.length ? { 'aria-describedby': nameDescribedBy.join(' ') } : {}),
        ...(nameError ? { 'aria-invalid': 'true' } : {}),
      },
    });
    input.value = draftValue;
    setBusyDisabled(input, state.busy);
    input.addEventListener('input', () => onDraftInput(input.value));

    const countryField = countrySelect({
      value: countryDraft,
      ariaLabel: `${singularLabel} country`,
      dataField: `${fieldKey}-country`,
      onChange: onCountryChange,
    });
    setBusyDisabled(countryField, state.busy);

    let representsInput = null;
    if (withRepresents) {
      representsInput = el('input', {
        className: 'field-input',
        attrs: {
          type: 'text',
          'aria-label': 'Represents (optional)',
          'data-field': `${fieldKey}-represents`,
          ...(representsError ? { 'aria-describedby': errorId, 'aria-invalid': 'true' } : {}),
        },
      });
      representsInput.value = representsDraft;
      setBusyDisabled(representsInput, state.busy);
      representsInput.addEventListener('input', () => onRepresentsInput(representsInput.value));
    }

    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy ? 'Adding…' : 'Add',
      attrs: { type: 'submit', 'data-focus-key': `${fieldKey}-submit` },
    });
    setBusyDisabled(submitButton, state.busy);

    // role="alert" is announced by assistive tech as soon as it enters the
    // DOM, unlike aria-live="polite" (rosterScreen.js's own comment on why
    // a torn-down-and-rebuilt polite region isn't reliably announced) — no
    // scripted focus move needed for this one, since the input that
    // triggered it keeps focus via data-field above. Found missing
    // entirely in review (ui-accessibility-reviewer): previously a plain
    // <p> with no role and no association to the field at all.
    const errorNode = draftError
      ? el('p', {
          id: errorId,
          className: 'btc-field-error',
          text: draftError,
          attrs: { role: 'alert' },
        })
      : null;
    const form = el('form', { className: 'btc-roster-form' }, [
      labeledField(
        `${singularLabel} name`,
        input,
        [
          nameHint ? el('p', { id: hintId, className: 'form-field-hint', text: nameHint }) : null,
          nameError ? errorNode : null,
        ].filter(Boolean),
      ),
      labeledField('Country', countryField),
      ...(representsInput
        ? [
            labeledField(
              'Represents (optional)',
              representsInput,
              representsError ? [errorNode] : [],
            ),
          ]
        : []),
      submitButton,
    ]);
    form.addEventListener('submit', onSubmit);

    const list =
      items.length === 0
        ? el('p', { className: 'stage-meta', text: emptyMessage })
        : el(
            'ul',
            { className: 'roster-list', attrs: { 'aria-label': `${heading} roster` } },
            items.map((item) =>
              state.edit?.kind === fieldKey && state.edit.id === item.id
                ? renderEditRow({ fieldKey, singularLabel, withRepresents, item })
                : renderRosterRow({ fieldKey, withRepresents, item, onRemove }),
            ),
          );

    return el('div', { className: 'card btc-roster-card' }, [
      el('h2', { text: heading }),
      form,
      list,
    ]);
  }

  // "Country · Name" (words.js's teamLabel: the one place the format is written, used for judges too), the team's
  // free "represents" label under it, then Edit and Remove.
  function renderRosterRow({ fieldKey, withRepresents, item, onRemove }) {
    const editButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Edit',
      attrs: {
        type: 'button',
        'aria-label': `Edit ${item.name}`,
        'data-focus-key': `edit-${fieldKey}-${item.id}`,
      },
    });
    setBusyDisabled(editButton, state.busy);
    editButton.addEventListener('click', () => handleStartEdit(fieldKey, item));

    const removeButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Remove',
      attrs: {
        type: 'button',
        'aria-label': `Remove ${item.name}`,
        'data-focus-key': `remove-${fieldKey}-${item.id}`,
      },
    });
    setBusyDisabled(removeButton, state.busy);
    removeButton.addEventListener('click', () => onRemove(item));

    return el('li', {}, [
      el(
        'div',
        { className: 'btc-roster-info' },
        [
          el('span', { text: teamLabel(item) }),
          withRepresents && item.represents
            ? el('span', { className: 'stage-meta', text: `Represents: ${item.represents}` })
            : null,
        ].filter(Boolean),
      ),
      el('div', { className: 'btc-roster-actions' }, [editButton, removeButton]),
    ]);
  }

  function renderEditRow({ fieldKey, singularLabel, withRepresents, item }) {
    const edit = state.edit;
    const errorId = `btc-${fieldKey}-edit-error`;

    const countryField = countrySelect({
      value: edit.countryCode,
      ariaLabel: `${singularLabel} country`,
      dataField: 'edit-country',
      onChange: (value) => {
        edit.countryCode = value;
      },
    });
    setBusyDisabled(countryField, state.busy);

    let representsInput = null;
    if (withRepresents) {
      representsInput = el('input', {
        className: 'field-input',
        attrs: {
          type: 'text',
          'aria-label': 'Represents (optional)',
          'data-field': 'edit-represents',
          ...(edit.error ? { 'aria-describedby': errorId, 'aria-invalid': 'true' } : {}),
        },
      });
      representsInput.value = edit.represents;
      setBusyDisabled(representsInput, state.busy);
      representsInput.addEventListener('input', () => {
        edit.represents = representsInput.value;
      });
    }

    const errorNode = edit.error
      ? el('p', {
          id: errorId,
          className: 'btc-field-error',
          text: edit.error,
          attrs: { role: 'alert' },
        })
      : null;

    const saveButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy ? 'Saving…' : 'Save',
      attrs: {
        type: 'submit',
        'data-focus-key': 'edit-save',
        ...(edit.error && !withRepresents ? { 'aria-describedby': errorId } : {}),
      },
    });
    setBusyDisabled(saveButton, state.busy);
    const cancelButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': 'edit-cancel' },
    });
    setBusyDisabled(cancelButton, state.busy);
    cancelButton.addEventListener('click', () => handleCancelEdit());

    const form = el(
      'form',
      {
        className: 'btc-roster-form btc-roster-edit-form',
        attrs: { 'aria-label': `Edit ${item.name}` },
      },
      [
        labeledField('Country', countryField),
        ...(representsInput
          ? [labeledField('Represents (optional)', representsInput, errorNode ? [errorNode] : [])]
          : []),
        ...(!representsInput && errorNode ? [errorNode] : []),
        el('div', { className: 'btc-roster-actions' }, [saveButton, cancelButton]),
      ],
    );
    form.addEventListener('submit', handleSaveEdit);

    return el('li', { className: 'btc-roster-editing' }, [
      el('span', { text: teamLabel(item) }),
      form,
    ]);
  }

  function renderLoading() {
    const container = el('section', { className: 'screen-container btc-setup-screen' }, [
      el('h1', { text: 'BTC Setup' }),
      el('div', {
        className: 'screen-feedback',
        text: 'Loading setup…',
        attrs: { role: 'status', 'aria-live': 'polite' },
      }),
    ]);
    root.appendChild(container);
  }

  function renderLoadError() {
    const feedback = el('div', {
      className: 'screen-feedback',
      text: state.loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => attemptLoad());
    const container = el('section', { className: 'screen-container btc-setup-screen' }, [
      el('h1', { text: 'BTC Setup' }),
      feedback,
      retryButton,
    ]);
    root.appendChild(container);
    feedback.focus();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';

      if (state.loading) {
        renderLoading();
        return;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        // renderLoadError() already moves focus to its own feedback node —
        // returning true here opts out of withFocusPreservation's own
        // restore-by-selector step, so it can never fight that deliberate
        // move (in practice the old selector rarely matches anything in
        // this minimal error view, but this makes the intent explicit
        // rather than relying on that incidentally).
        return true;
      }

      const container = el('section', { className: 'screen-container btc-setup-screen' });

      if (state.event?.is_test) {
        container.appendChild(
          el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
        );
      }

      container.appendChild(el('h1', { text: 'BTC Setup', attrs: { tabindex: '-1' } }));

      if (state.event?.is_test) container.appendChild(renderDemoCard());

      container.appendChild(
        renderRosterSection({
          fieldKey: 'team',
          heading: 'Teams',
          singularLabel: 'Team',
          items: state.teams,
          draftValue: state.teamDraft,
          draftError: state.teamError,
          errorField: state.teamErrorField,
          placeholder: 'e.g. Grey Matter',
          nameHint: 'A team or country name, not a person’s name',
          withRepresents: true,
          countryDraft: state.teamCountryDraft,
          representsDraft: state.teamRepresentsDraft,
          onDraftInput: (value) => {
            state.teamDraft = value;
          },
          onCountryChange: (value) => {
            state.teamCountryDraft = value;
          },
          onRepresentsInput: (value) => {
            state.teamRepresentsDraft = value;
          },
          onSubmit: handleAddTeam,
          onRemove: handleRemoveTeam,
          emptyMessage: 'No teams added yet.',
        }),
      );

      container.appendChild(
        renderRosterSection({
          fieldKey: 'judge',
          heading: 'Judges',
          singularLabel: 'Judge',
          items: state.judges,
          draftValue: state.judgeDraft,
          draftError: state.judgeError,
          errorField: 'name',
          placeholder: 'e.g. Alex Rivera',
          withRepresents: false,
          countryDraft: state.judgeCountryDraft,
          onDraftInput: (value) => {
            state.judgeDraft = value;
          },
          onCountryChange: (value) => {
            state.judgeCountryDraft = value;
          },
          onSubmit: handleAddJudge,
          onRemove: handleRemoveJudge,
          emptyMessage: 'No judges added yet.',
        }),
      );

      let toastNode = null;
      if (state.toastMessage) {
        toastNode = el('div', {
          className: 'screen-feedback',
          text: state.toastMessage,
          attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
        });
        container.appendChild(toastNode);
      }

      root.appendChild(container);

      // Consumed once per render — see state.pendingFocus's own comment
      // above for why 'heading' and 'toast' both need an explicit move
      // rather than relying on withFocusPreservation's restore-by-selector
      // alone (neither case has a PREVIOUSLY-focused control to restore).
      if (state.pendingFocus === 'heading') {
        state.pendingFocus = null;
        const heading = container.querySelector('h1');
        if (heading) {
          heading.focus();
          return true;
        }
      } else if (state.pendingFocus === 'toast') {
        state.pendingFocus = null;
        if (toastNode) {
          toastNode.focus();
          return true;
        }
      } else if (state.pendingFocus === 'edit-first') {
        state.pendingFocus = null;
        const first = container.querySelector('[data-field="edit-country"]');
        if (first) {
          first.focus();
          return true;
        }
      } else if (state.pendingFocus?.startsWith('focus:')) {
        const key = state.pendingFocus.slice('focus:'.length);
        state.pendingFocus = null;
        const target = [...container.querySelectorAll('[data-focus-key]')].find(
          (node) => node.getAttribute('data-focus-key') === key,
        );
        if (target) {
          target.focus();
          return true;
        }
      }
      return undefined;
    });
  }

  await attemptLoad();

  return {
    unmount() {
      clearTimeout(toastTimer);
    },
  };
}
