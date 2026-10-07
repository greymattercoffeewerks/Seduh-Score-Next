// The "Edit time" control for a stopped row (live-event finding #1; logic and
// the rules it follows live in timeCorrection.js). A disclosure, like the
// mid-heat "Enter time manually" toggle in timingScreen.js: a button that
// reveals a small form — new minutes:seconds, a REQUIRED reason (quick-pick
// chips plus "Other"), Save / Cancel. Shared by the timing screens and the
// scoring screen, so it lives in its own file rather than in either.
//
// Local until Save: opening, cancelling and every validation problem (including
// "that is already the recorded time", reported back through `done`) stay in
// the panel — never the caller's render(), which rebuilds every row from fresh
// server state. `onCorrect(entryId, rawSecs, reason, done)` only ever receives
// an already-validated integer and a trimmed reason, plus a `done` callback:
//   done()                      — the save did not go through; re-enable Save
//   done({ error })             — same, and show `error.message` beside the field
//                                  (a CorrectionInputError names the field)
//   done({ queued: true })      — saved on this device, waiting to sync; close the
//                                  panel and park the Edit button
// A parked button is not just DOM state: the screens rebuild every row from
// server state, which still holds the OLD time until the outbox drains, so each
// render asks the outbox which entries have a queued correction
// (timeCorrection.js's loadPendingWork) and passes them as `queued` — the row
// comes back parked, and the same old time is never corrected twice.
//
// A screen's render() rebuilds the whole subtree — another cupper's Stop, the
// countdown reaching zero, every score tap on the scoring screen — so an open
// editor would be destroyed with its reason half-chosen. The screen therefore
// calls captureCorrectionDrafts(root) just before it clears `root` and
// restoreCorrectionDrafts(root, drafts) just after it rebuilds, which reopens
// each open editor with what had been typed and puts focus back in the field
// that had it (restore returns true when it did, so the screen does not pull
// focus away to its feedback region). What is restored is deliberately narrow: a
// typed time only if the person changed it AND the recorded time is still the one
// they started from — otherwise a fresh prefill stands, so a restored draft can
// never write an older time over another device's correction.
//
// Returns `{ toggle, panel }` rather than one node so the caller can put the
// toggle beside the time and let the panel wrap onto its own full-width line
// (see .timing-row in timingScreen.css).
import { el } from '../../core/dom.js';
import { formatDuration } from '../../core/duration.js';
import { parseElapsedInput, secsToParts } from './timingManual.js';
import { CORRECTION_REASONS, REASON_MAX_LENGTH, validateReason } from './timeCorrection.js';

const OTHER = '__other__';

export function renderTimeCorrection(entry, { onCorrect, queued = false }) {
  const name = entry.displayName;
  const panelId = `time-correction-panel-${entry.entry_id}`;
  const errorId = `${panelId}-error`;
  const legendId = `${panelId}-legend`;
  const reasonGroupName = `time-correction-reason-${entry.entry_id}`;

  // The accessible names of all three buttons START with their visible text
  // (WCAG 2.5.3, label in name) and then say whose time it is — a screen of
  // several rows has several of each.
  const toggle = el('button', {
    className: 'btn btn-outline tap-target',
    id: `time-correction-toggle-${entry.entry_id}`,
    text: 'Edit time',
    attrs: {
      type: 'button',
      'aria-label': `Edit time, ${name}`,
      'aria-expanded': 'false',
      'aria-controls': panelId,
    },
  });

  const [prefillMin, prefillSec] = secsToParts(entry.elapsed_secs);
  const minutesInput = el('input', {
    className: 'field-input time-correction-input',
    attrs: {
      type: 'number',
      min: '0',
      inputmode: 'numeric',
      'aria-label': `${name}: corrected minutes`,
      value: String(prefillMin),
    },
  });
  const secondsInput = el('input', {
    className: 'field-input time-correction-input',
    attrs: {
      type: 'number',
      min: '0',
      max: '59',
      inputmode: 'numeric',
      'aria-label': `${name}: corrected seconds`,
      value: String(prefillSec),
    },
  });

  const reasonOptions = [...CORRECTION_REASONS, OTHER].map((value) => {
    const radio = el('input', {
      attrs: { type: 'radio', name: reasonGroupName, value },
    });
    const label = el('label', { className: 'time-correction-reason' }, [
      radio,
      el('span', { text: value === OTHER ? 'Other' : value }),
    ]);
    return { radio, label, value };
  });
  const otherInput = el('input', {
    className: 'field-input time-correction-other',
    attrs: {
      type: 'text',
      maxlength: String(REASON_MAX_LENGTH),
      'aria-label': `${name}: other reason`,
      placeholder: 'What happened?',
    },
  });
  otherInput.hidden = true;

  // Always in the document (visually hidden while empty, not display: none) so a
  // screen reader has a live region to announce into when text arrives.
  const localError = el('p', {
    className: 'time-correction-error',
    id: errorId,
    attrs: { role: 'alert' },
  });
  const saveButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Save correction',
    attrs: { type: 'button', 'aria-label': `Save correction, ${name}` },
  });
  const cancelButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Cancel',
    attrs: { type: 'button', 'aria-label': `Cancel, ${name}` },
  });

  // The group carries the "no reason chosen" error (aria-invalid belongs on the
  // radiogroup, not on one radio inside it).
  const reasonGroup = el(
    'fieldset',
    {
      className: 'time-correction-reasons',
      attrs: { role: 'radiogroup', 'aria-labelledby': legendId },
    },
    [
      el('legend', { id: legendId, text: 'Why is the time changing?' }),
      ...reasonOptions.map((option) => option.label),
      otherInput,
    ],
  );

  const panel = el(
    'div',
    {
      className: 'time-correction-panel',
      id: panelId,
      attrs: {
        role: 'group',
        'aria-label': `Edit ${name}'s time`,
        'data-entry-id': entry.entry_id,
      },
    },
    [
      el('p', {
        className: 'form-field-hint',
        text: `Recorded ${formatDuration(entry.elapsed_secs)}. Your reason is kept in the heat's history.`,
      }),
      el('div', { className: 'time-correction-fields' }, [
        minutesInput,
        el('span', { className: 'time-correction-separator', text: ':' }),
        secondsInput,
      ]),
      reasonGroup,
      localError,
      el('div', { className: 'time-correction-buttons' }, [saveButton, cancelButton]),
    ],
  );
  panel.hidden = true;

  const checkedReason = () => reasonOptions.find((option) => option.radio.checked);

  function clearError() {
    localError.textContent = '';
    for (const control of [minutesInput, secondsInput, otherInput, reasonGroup]) {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  }

  // Says what is wrong, ties it to the field (aria-invalid + aria-describedby),
  // moves focus there and brings it into view — the panel is tall on a phone.
  // `marked` is what carries the invalid state; `focusTarget` is what to focus
  // (for the reason group, its first radio).
  function showError(message, marked, focusTarget = marked) {
    localError.textContent = message;
    marked.setAttribute('aria-invalid', 'true');
    marked.setAttribute('aria-describedby', errorId);
    focusTarget.focus();
    localError.scrollIntoView?.({ block: 'nearest' });
  }

  function showReasonError(message) {
    if (checkedReason()?.value === OTHER) showError(message, otherInput);
    else showError(message, reasonGroup, reasonOptions[0].radio);
  }

  // Typing, or choosing a reason, clears whatever the last Save complained about.
  for (const input of [minutesInput, secondsInput, otherInput]) {
    input.addEventListener('input', clearError);
  }
  for (const option of reasonOptions) {
    option.radio.addEventListener('change', () => {
      clearError();
      // Reveal the free-text box, but do NOT move focus into it: arrow keys fire
      // `change` on each radio, and focusing the box would trap a keyboard user
      // on "Other" instead of letting them arrow past it.
      otherInput.hidden = option.value !== OTHER;
    });
  }

  // Parked, not `disabled`: a disabled button drops out of the tab order, so a
  // keyboard or screen-reader user could never find out why it is unavailable.
  function parkToggle() {
    toggle.textContent = 'Waiting to sync';
    toggle.setAttribute('aria-label', `Waiting to sync, ${name}`);
    toggle.setAttribute('aria-disabled', 'true');
  }

  function openPanel({ focus }) {
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    // Hiding the just-focused toggle would drop focus to <body>; the minutes
    // field is the natural first place to land (§15.3).
    if (focus) minutesInput.focus();
  }

  function closePanel() {
    clearError();
    panel.hidden = true;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-disabled') === 'true') return;
    openPanel({ focus: true });
  });
  cancelButton.addEventListener('click', () => {
    closePanel();
    toggle.focus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanel();
      toggle.focus();
    }
  });

  // Same "busy but still focusable" pattern as core/dom.js's setBusyDisabled, with
  // the accessible name changed too (an aria-label would otherwise hide "Saving…").
  function setSaving(saving) {
    saveButton.textContent = saving ? 'Saving…' : 'Save correction';
    saveButton.setAttribute(
      'aria-label',
      saving ? `Saving correction, ${name}` : `Save correction, ${name}`,
    );
    if (saving) {
      saveButton.setAttribute('aria-disabled', 'true');
      saveButton.setAttribute('aria-busy', 'true');
    } else {
      saveButton.removeAttribute('aria-disabled');
      saveButton.removeAttribute('aria-busy');
    }
  }

  saveButton.addEventListener('click', () => {
    if (saveButton.getAttribute('aria-disabled') === 'true') return;
    let rawSecs;
    let reason;
    try {
      rawSecs = parseElapsedInput(minutesInput.value, secondsInput.value);
    } catch (err) {
      showError(err.message, err.message.startsWith('Seconds') ? secondsInput : minutesInput);
      return;
    }
    try {
      const chosen = checkedReason();
      reason = validateReason(chosen?.value === OTHER ? otherInput.value : chosen?.value);
    } catch (err) {
      // A pure local validation failure — nothing queued, nothing to re-enable,
      // and no render() so a sibling row's typing survives.
      showReasonError(err.message);
      return;
    }
    clearError();
    setSaving(true);
    onCorrect(entry.entry_id, rawSecs, reason, (outcome = {}) => {
      setSaving(false);
      if (outcome.queued) {
        closePanel();
        parkToggle();
      } else if (outcome.error) {
        if (outcome.error.field === 'reason') showReasonError(outcome.error.message);
        else showError(outcome.error.message, minutesInput);
      }
    });
  });

  // The control that has keyboard focus inside this panel, in a form that survives
  // the panel being rebuilt.
  function focusedControl() {
    const active = document.activeElement;
    if (!active || !panel.contains(active)) return null;
    if (active === minutesInput) return 'minutes';
    if (active === secondsInput) return 'seconds';
    if (active === otherInput) return 'other';
    const option = reasonOptions.find((candidate) => candidate.radio === active);
    return option ? `radio:${option.value}` : null;
  }

  // What captureCorrectionDrafts/restoreCorrectionDrafts (below) read and write.
  panel.correctionDraft = {
    // A save that is in flight: its editor is not carried across a re-render (see capture).
    isBusy: () => saveButton.getAttribute('aria-busy') === 'true',
    get: () => ({
      minutes: minutesInput.value,
      seconds: secondsInput.value,
      // What this editor was built against, and whether the person changed the
      // time at all: together they decide whether the typed time may come back.
      recorded: entry.elapsed_secs,
      edited:
        minutesInput.value !== String(prefillMin) || secondsInput.value !== String(prefillSec),
      reason: checkedReason()?.value ?? null,
      other: otherInput.value,
      focused: focusedControl(),
    }),
    // Returns true when focus was put back into a field.
    apply: (draft) => {
      if (toggle.getAttribute('aria-disabled') === 'true') return false;
      openPanel({ focus: false });
      if (draft.edited && draft.recorded === entry.elapsed_secs) {
        minutesInput.value = draft.minutes;
        secondsInput.value = draft.seconds;
      }
      otherInput.value = draft.other;
      const option = reasonOptions.find((candidate) => candidate.value === draft.reason);
      if (option) option.radio.checked = true;
      otherInput.hidden = option?.value !== OTHER;
      const controls = {
        minutes: minutesInput,
        seconds: secondsInput,
        other: otherInput,
        ...Object.fromEntries(reasonOptions.map((o) => [`radio:${o.value}`, o.radio])),
      };
      const target = draft.focused ? controls[draft.focused] : null;
      if (target && !target.hidden) {
        target.focus();
        return true;
      }
      return false;
    },
  };

  if (queued) parkToggle();
  return { toggle, panel };
}

// The editors that are open right now, with what is typed in them. Call just
// before a screen clears `root` to re-render. An editor whose Save is in flight is
// left out: its row is about to be parked (or has landed), and reopening it with a
// fresh, enabled Save would invite a second correction of the same old time.
export function captureCorrectionDrafts(root) {
  return [...root.querySelectorAll('.time-correction-panel')]
    .filter((panel) => !panel.hidden && panel.correctionDraft && !panel.correctionDraft.isBusy())
    .map((panel) => ({ entryId: panel.dataset.entryId, ...panel.correctionDraft.get() }));
}

// Reopens those editors in the rebuilt `root`, filled in as they were. A row
// that no longer has an editor (its heat moved on) is skipped, as is `skipEntryId` —
// the row whose correction has just gone through. A row that is now parked has an
// editor, but the toggle that opens it is parked too, so nothing reopens it: apply()
// declines for a parked toggle. Returns true if focus went back into one of the fields.
export function restoreCorrectionDrafts(root, drafts, { skipEntryId } = {}) {
  const panels = [...root.querySelectorAll('.time-correction-panel')];
  let focusRestored = false;
  for (const draft of drafts) {
    if (draft.entryId === skipEntryId) continue;
    const panel = panels.find((candidate) => candidate.dataset.entryId === draft.entryId);
    if (panel?.correctionDraft?.apply(draft)) focusRestored = true;
  }
  return focusRestored;
}
