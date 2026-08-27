// Stage plan setup screen (handoff §14 T4.1's own known UI gap — setup.js
// shipped as a tested logic module only; this closes it). Lets an organiser
// build an ARBITRARY chain of stages — add, remove, reorder, each with its
// own kind/set_count/duration_secs/cutoff — ahead of an event, backed by
// setup.js's generalized validateStagePlan/saveStagePlan (no more fixed
// two-sequence restriction). Deliberately roster-free: cupper registration
// is separately scoped, not this screen's concern — this is the stage plan
// alone.
//
// Draft state (`draftStages`, closure-level) is mutated SYNCHRONOUSLY by
// every field's own change/input handler, before any await — the same
// lost-update-race discipline scoringScreen.js established for T4.5 (see
// its own module comment), applied here so add/remove/reorder always act on
// the latest typed values, never a stale snapshot. A field edit alone never
// triggers a rebuild (typing in one row must not destroy every other row's
// live input, mid-edit, per CONVENTIONS.md's rebuild-then-refocus rule) —
// only a structural change (add/remove/move) or a save re-renders.
//
// A stage that already has heats (setup.js's stageHasHeats) is rendered
// read-only and can't be edited, reordered past, or removed — real event
// data hangs off it. saveStagePlan itself is the actual gate (it re-checks
// against the database, not just this screen's own locked flag, which is
// only ever as fresh as the last load); this screen's job is to make that
// restriction visible before the organiser tries, not to be the only thing
// enforcing it.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { listStagesForEvent, stageHasHeats, saveStagePlan } from './setup.js';

const STAGE_KINDS = ['prelims', 'semis', 'finals'];
const DEFAULT_SET_COUNT = 5;
const DEFAULT_DURATION_SECS = 480;
const DEFAULT_CUTOFF = 8;

function defaultDraftRow(key) {
  return {
    key,
    id: null,
    kind: 'prelims',
    setCount: DEFAULT_SET_COUNT,
    durationSecs: DEFAULT_DURATION_SECS,
    cutoff: DEFAULT_CUTOFF,
    locked: false,
  };
}

// Pure. The terminal (last) row's cutoff is always null, matching
// validateStagePlan's own terminal-stage rule — mutates in place so the
// screen's field-disabling logic and the submitted plan always agree on
// which row is terminal, without either recomputing it independently.
export function normalizeTerminalCutoff(draftStages) {
  draftStages.forEach((row, index) => {
    row.cutoff = index === draftStages.length - 1 ? null : row.cutoff;
  });
}

// Pure. Draft rows (screen-local shape) -> a plan setup.js's
// validateStagePlan/saveStagePlan can consume. Forces the terminal row's
// cutoff to null independently of normalizeTerminalCutoff having already
// run, so this function is correct on its own rather than relying on
// caller discipline.
export function buildPlanFromDraft(draftStages) {
  return draftStages.map((row, index) => ({
    id: row.id ?? undefined,
    kind: row.kind,
    ordinal: index + 1,
    setCount: row.setCount,
    durationSecs: row.durationSecs,
    cutoff: index === draftStages.length - 1 ? null : row.cutoff,
  }));
}

function fieldWrapper(labelText, input) {
  return el('div', { className: 'stage-field' }, [
    el('span', {
      className: 'stage-field-label',
      text: labelText,
      attrs: { 'aria-hidden': 'true' },
    }),
    input,
  ]);
}

export function renderStageRow(
  row,
  index,
  total,
  { onMoveUp, onMoveDown, onRemove, disableActions } = {},
) {
  const stageLabel = `Stage ${index + 1}`;
  const rowId = `stage-row-${row.key}`;

  if (row.locked) {
    return el('div', { className: 'card stage-row', attrs: { id: rowId, 'data-locked': 'true' } }, [
      el('h3', { text: `${stageLabel} — ${row.kind}` }),
      el('p', {
        className: 'stage-meta',
        text: `${row.setCount} sets, ${row.durationSecs}s, cutoff ${row.cutoff ?? '—'} — locked, heats already generated`,
      }),
    ]);
  }

  const isTerminal = index === total - 1;

  const kindSelect = el('select', {
    className: 'field-input',
    attrs: { 'aria-label': `${stageLabel}: kind`, 'data-field': 'kind' },
  });
  for (const kind of STAGE_KINDS) {
    kindSelect.appendChild(el('option', { text: kind, attrs: { value: kind } }));
  }
  kindSelect.value = row.kind;
  kindSelect.addEventListener('change', () => {
    row.kind = kindSelect.value;
  });

  const setCountInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'number',
      min: '1',
      'aria-label': `${stageLabel}: set count`,
      'data-field': 'setCount',
    },
  });
  setCountInput.value = String(row.setCount);
  setCountInput.addEventListener('input', () => {
    row.setCount = Number(setCountInput.value);
  });

  const durationInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'number',
      min: '1',
      'aria-label': `${stageLabel}: duration in seconds`,
      'data-field': 'durationSecs',
    },
  });
  durationInput.value = String(row.durationSecs);
  durationInput.addEventListener('input', () => {
    row.durationSecs = Number(durationInput.value);
  });

  const cutoffInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'number',
      min: '1',
      'aria-label': `${stageLabel}: cutoff`,
      'data-field': 'cutoff',
    },
  });
  if (isTerminal) {
    cutoffInput.value = '';
    cutoffInput.disabled = true;
    cutoffInput.placeholder = 'Not applicable — terminal stage';
  } else {
    cutoffInput.value = row.cutoff == null ? '' : String(row.cutoff);
    cutoffInput.addEventListener('input', () => {
      row.cutoff = cutoffInput.value === '' ? null : Number(cutoffInput.value);
    });
  }

  const moveUpButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Move up',
    attrs: { type: 'button', 'aria-label': `Move ${stageLabel} up` },
  });
  moveUpButton.disabled = disableActions || index === 0;
  moveUpButton.addEventListener('click', () => onMoveUp(row));

  const moveDownButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Move down',
    attrs: { type: 'button', 'aria-label': `Move ${stageLabel} down` },
  });
  moveDownButton.disabled = disableActions || index === total - 1;
  moveDownButton.addEventListener('click', () => onMoveDown(row));

  const removeButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Remove',
    attrs: { type: 'button', 'aria-label': `Remove ${stageLabel}` },
  });
  removeButton.disabled = Boolean(disableActions);
  removeButton.addEventListener('click', () => onRemove(row));

  return el('div', { className: 'card stage-row', attrs: { id: rowId } }, [
    el('h3', { text: stageLabel }),
    el('div', { className: 'stage-row-fields' }, [
      fieldWrapper('Kind', kindSelect),
      fieldWrapper('Set count', setCountInput),
      fieldWrapper('Duration (seconds)', durationInput),
      fieldWrapper('Cutoff', cutoffInput),
    ]),
    el('div', { className: 'stage-row-actions' }, [moveUpButton, moveDownButton, removeButton]),
  ]);
}

export async function mountSetupScreen(root, { eventId, client = getSupabase() } = {}) {
  let event = null;
  let draftStages = [];
  let keyCounter = 0;
  let saving = false;
  let pendingError = null;
  let pendingSuccess = null;
  let focusAfterRender = null;
  let loadFailedMessage = null;

  function nextKey() {
    keyCounter += 1;
    return `new-${keyCounter}`;
  }

  function hydrateDraftFromPersisted(stages, lockedIds) {
    return stages.map((stageRow) => ({
      key: stageRow.id,
      id: stageRow.id,
      kind: stageRow.kind,
      setCount: stageRow.set_count,
      durationSecs: stageRow.duration_secs,
      cutoff: stageRow.cutoff,
      locked: lockedIds.has(stageRow.id),
    }));
  }

  async function loadPersisted() {
    const [ev, stages] = await Promise.all([
      findEvent(eventId, client),
      listStagesForEvent(eventId, client),
    ]);
    const lockedFlags = await Promise.all(stages.map((stage) => stageHasHeats(stage.id, client)));
    const lockedIds = new Set(
      stages.filter((_stage, index) => lockedFlags[index]).map((stage) => stage.id),
    );
    return { event: ev, stages, lockedIds };
  }

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  function renderLoadError() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container setup-screen' });
    container.appendChild(el('h1', { text: 'Stage plan' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  function render() {
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container setup-screen' });

    if (event?.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', { id: 'stage-plan-heading', text: 'Stage plan', attrs: { tabindex: '-1' } }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta',
        text: `${draftStages.length} stage${draftStages.length === 1 ? '' : 's'} planned`,
      }),
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

    const rows = draftStages.map((row, index) =>
      renderStageRow(row, index, draftStages.length, {
        onMoveUp: (r) => moveStage(r, -1),
        onMoveDown: (r) => moveStage(r, 1),
        onRemove: (r) => removeStage(r),
        disableActions: saving,
      }),
    );
    container.appendChild(el('div', { className: 'stage-rows' }, rows));

    const addButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Add stage',
      attrs: { type: 'button' },
    });
    addButton.disabled = saving;
    addButton.addEventListener('click', addStage);
    container.appendChild(addButton);

    const saveButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: saving ? 'Saving…' : 'Save stage plan',
      attrs: { type: 'button' },
    });
    saveButton.disabled = saving || draftStages.length === 0;
    saveButton.addEventListener('click', handleSave);
    container.appendChild(saveButton);

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

  function addStage() {
    const row = defaultDraftRow(nextKey());
    draftStages.push(row);
    normalizeTerminalCutoff(draftStages);
    focusAfterRender = `#stage-row-${row.key} select`;
    render();
  }

  function removeStage(row) {
    draftStages = draftStages.filter((r) => r.key !== row.key);
    normalizeTerminalCutoff(draftStages);
    focusAfterRender = '#stage-plan-heading';
    render();
  }

  function moveStage(row, direction) {
    const index = draftStages.findIndex((r) => r.key === row.key);
    const target = index + direction;
    if (target < 0 || target >= draftStages.length) return;
    if (draftStages[target].locked) return;
    [draftStages[index], draftStages[target]] = [draftStages[target], draftStages[index]];
    normalizeTerminalCutoff(draftStages);
    focusAfterRender = `#stage-row-${row.key}`;
    render();
  }

  async function handleSave() {
    if (saving) return;
    saving = true;
    render();

    try {
      const plan = buildPlanFromDraft(draftStages);
      await saveStagePlan(eventId, plan, client);
      try {
        const persisted = await loadPersisted();
        event = persisted.event;
        draftStages = hydrateDraftFromPersisted(persisted.stages, persisted.lockedIds);
        pendingSuccess = 'Stage plan saved.';
      } catch {
        // The write itself already succeeded by this point — a failure
        // here is only the confirmation read, not the save. Same hedge
        // T4.5's scoring surface uses for its own post-confirm re-fetch:
        // don't tell the organiser it failed when it may well have
        // succeeded (the next successful load self-corrects either way).
        pendingSuccess =
          'Stage plan saved, but the screen could not refresh — reload to see the latest state.';
      }
      focusAfterRender = '#stage-plan-heading';
    } catch (err) {
      pendingError = describeError(err);
    }

    saving = false;
    render();
  }

  try {
    const persisted = await loadPersisted();
    event = persisted.event;
    draftStages = hydrateDraftFromPersisted(persisted.stages, persisted.lockedIds);
  } catch (err) {
    loadFailedMessage = describeError(err);
  }
  render();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
