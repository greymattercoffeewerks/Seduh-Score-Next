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
// only a structural change (add/remove/move) or a save re-renders. The one
// exception is the kind <select>: its `change` is a single discrete commit
// (not a per-keystroke stream like the number fields), and it's the one
// field whose value the same-kind advisory hint below is actually ABOUT —
// unlike every other field-edit-no-rebuild case here, leaving it un-rendered
// doesn't just delay the hint, it leaves stale, actively wrong advisory text
// on screen (found in review). So a kind change re-renders, same as
// add/remove/move.
//
// A stage that already has heats (setup.js's stageHasHeats) is rendered
// read-only and can't be edited, reordered past, or removed — real event
// data hangs off it. saveStagePlan itself is the actual gate (it re-checks
// against the database, not just this screen's own locked flag, which is
// only ever as fresh as the last load); this screen's job is to make that
// restriction visible before the organiser tries, not to be the only thing
// enforcing it.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listStagesForEvent, stageHasHeats, saveStagePlan, STAGE_KINDS } from './setup.js';

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

// Pure. Whether draftStages[index]'s kind is shared by any OTHER row in the
// plan — same-kind rows are a legitimate, supported shape (a real
// sequential elimination round), not a mistake, but the organiser's own
// "one prelim, more capacity" mental model diverges from that, so
// renderStageRow surfaces this as an advisory. Named and exported, matching
// this file's own normalizeTerminalCutoff/buildPlanFromDraft convention,
// rather than left inline in render() (found in review).
export function hasDuplicateKind(draftStages, index) {
  return draftStages.some((row, i) => i !== index && row.kind === draftStages[index].kind);
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

export function renderStageRow(
  row,
  index,
  total,
  {
    onMoveUp,
    onMoveDown,
    onRemove,
    disableActions,
    moveUpUnsafe,
    moveDownUnsafe,
    removeUnsafe,
    duplicateKind,
    onKindChange,
  } = {},
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
  const cutoffHintId = `${rowId}-cutoff-hint`;
  const kindHintId = `${rowId}-kind-hint`;

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
    // Unlike every other field here, a kind change re-renders — see this
    // module's own top comment for why. onKindChange is undefined in the
    // handful of tests that call renderStageRow directly with no caller
    // wired up; harmless, since there's then nothing to notify.
    onKindChange?.(row);
  });

  // Advisory only, not a validation error — a second same-kind stage row is
  // a legitimate, supported shape (a real sequential elimination round), not
  // a mistake to block. This exists purely because the organiser's own
  // mental model of "one prelim, more capacity" and the schema's actual
  // model ("each same-kind row is its own round, own cutoff, survivors carry
  // forward") diverge — ROADMAP.md's "Stage-plan setup scoping" entry has
  // the full incident this closes. Same aria-describedby-plus-always-visible-
  // text pattern as the terminal-stage cutoff hint below, not a placeholder
  // or color-only signal.
  let kindHint = null;
  if (duplicateKind) {
    kindSelect.setAttribute('aria-describedby', kindHintId);
    kindHint = el('p', {
      id: kindHintId,
      className: 'form-field-hint',
      text: `Another ${row.kind} stage already exists in this plan — same-kind stages run as separate, sequential rounds (each with its own cutoff, survivors carrying forward), not added capacity for one round.`,
    });
  }

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
  let cutoffHint = null;
  if (isTerminal) {
    cutoffInput.value = '';
    cutoffInput.disabled = true;
    cutoffInput.setAttribute('aria-describedby', cutoffHintId);
    // A real, always-rendered, token-colored explanation — not placeholder
    // text alone. Found in review: placeholder-only text falls back to
    // browser/OS default color (measured right at the AA contrast floor in
    // one engine, commonly worse in others) and disappears entirely from a
    // disabled field for some assistive tech read modes. Matches the
    // locked-row explanation above, which is likewise real text, not a
    // color- or placeholder-only signal.
    cutoffHint = el('p', {
      id: cutoffHintId,
      className: 'form-field-hint',
      text: 'Not applicable — terminal stage, nobody advances past it.',
    });
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
  moveUpButton.disabled = Boolean(disableActions) || index === 0 || Boolean(moveUpUnsafe);
  moveUpButton.addEventListener('click', () => onMoveUp(row));

  const moveDownButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Move down',
    attrs: { type: 'button', 'aria-label': `Move ${stageLabel} down` },
  });
  moveDownButton.disabled =
    Boolean(disableActions) || index === total - 1 || Boolean(moveDownUnsafe);
  moveDownButton.addEventListener('click', () => onMoveDown(row));

  const removeButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Remove',
    attrs: { type: 'button', 'aria-label': `Remove ${stageLabel}` },
  });
  removeButton.disabled = Boolean(disableActions) || Boolean(removeUnsafe);
  removeButton.addEventListener('click', () => onRemove(row));

  // tabindex="-1": not in the tab order, but a valid target for
  // moveStage()'s own focus restoration after a reorder rebuilds the whole
  // subtree — a plain <div> is otherwise unfocusable, which left focus
  // stranded on <body> after every Move up/down (found in review).
  return el('div', { className: 'card stage-row', attrs: { id: rowId, tabindex: '-1' } }, [
    el('h3', { text: stageLabel }),
    el('div', { className: 'stage-row-fields' }, [
      labeledField('Kind', kindSelect, kindHint ? [kindHint] : []),
      labeledField('Set count', setCountInput),
      labeledField('Duration (seconds)', durationInput),
      labeledField('Cutoff', cutoffInput, cutoffHint ? [cutoffHint] : []),
    ]),
    el('div', { className: 'stage-row-actions' }, [moveUpButton, moveDownButton, removeButton]),
  ]);
}

export async function mountSetupScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  let event = null;
  let draftStages = [];
  let keyCounter = 0;
  let saving = false;
  let pendingError = null;
  let pendingSuccess = null;
  let focusAfterRender = null;
  let loadFailedMessage = null;
  let loading = false;

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

  // A defined loading state, not a blank screen, for the initial mount —
  // loadPersisted() is findEvent + listStagesForEvent in parallel, THEN a
  // stageHasHeats round trip per stage, which on this project's "unreliable
  // venue wifi" design target can leave `root` empty for a real stretch of
  // time. Matches reportScreen.js's own renderLoading() precedent, found
  // missing here in review. attemptLoad() below bounds how long this can
  // show for (DEFAULT_LOAD_TIMEOUT_MS, core/timeout.js's raceTimeout) —
  // 2026-08-29 follow-up closing a real gap: a request that neither
  // resolves nor rejects used to leave this screen stuck here indefinitely,
  // with no retry affordance (see CHANGELOG.md's dated entry).
  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container setup-screen' });
    container.appendChild(el('h1', { text: 'Stage plan' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading stage plan…',
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
    const container = el('section', { className: 'screen-container setup-screen' });
    container.appendChild(el('h1', { text: 'Stage plan' }));
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
  // screen stuck on renderLoading() forever — and gives renderLoadError()'s
  // Retry button a function to re-invoke. `loading` guards against a
  // double-click (or the initial mount racing a fast Retry click) starting
  // two concurrent loads whose resolution order isn't guaranteed, the same
  // in-flight discipline handleSave()'s own `saving` flag uses.
  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      event = persisted.event;
      draftStages = hydrateDraftFromPersisted(persisted.stages, persisted.lockedIds);
      loadFailedMessage = null;
      // Found in review (ui-accessibility-reviewer): without this, a
      // successful Retry silently dropped focus to <body> — renderLoading()
      // destroys the focused Retry button via root.innerHTML = '', and
      // render()'s own focus logic only fires on an error tone or an
      // explicit focusAfterRender, neither true on a load that just
      // succeeded. Same #stage-plan-heading target addStage()/removeStage()/
      // moveStage() already use.
      focusAfterRender = '#stage-plan-heading';
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
    // handler like handleSave, still resolving after the router already
    // navigated elsewhere) must never write to `root` again — router.js
    // aborts `signal` the instant a newer navigation starts. See
    // ROADMAP.md's "A real DOM-write race between the router..." entry.
    if (signal?.aborted) return;
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

    // The highest index carrying a locked stage — removing (or, via move,
    // shifting the ordinal of) ANY unlocked row before that index would
    // renumber the locked stage too, which saveStagePlan always refuses.
    // Disabling the controls that would produce that plan up front, rather
    // than letting the organiser attempt it and get a save-time error
    // naming a DIFFERENT stage than the one they touched (found in
    // review), and giving Move up/down real disabled state instead of a
    // silent no-op next to a locked neighbor (also found in review).
    const lastLockedIndex = draftStages.reduce((max, row, index) => (row.locked ? index : max), -1);
    const rows = draftStages.map((row, index) =>
      renderStageRow(row, index, draftStages.length, {
        onMoveUp: (r) => moveStage(r, -1),
        onMoveDown: (r) => moveStage(r, 1),
        onRemove: (r) => removeStage(r),
        disableActions: saving,
        moveUpUnsafe: index > 0 && draftStages[index - 1].locked,
        moveDownUnsafe: index < draftStages.length - 1 && draftStages[index + 1].locked,
        removeUnsafe: index < lastLockedIndex,
        duplicateKind: hasDuplicateKind(draftStages, index),
        onKindChange: (r) => {
          focusAfterRender = `#stage-row-${r.key} select`;
          render();
        },
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

  await attemptLoad();

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down.
    },
  };
}
