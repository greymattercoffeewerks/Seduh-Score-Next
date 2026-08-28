// Timing surface, manual mode (handoff §14 T4.4). Unlike the app-mode
// screen (timingScreen.js), there is no master clock and no "start heat"
// action — a manual heat is ready for entry the moment it exists, so this
// screen only ever shows two states: entry rows (heat 'pending') or the
// completed read-only view (heat past 'pending'). Every row stays editable
// throughout the 'pending' state (a judge fixing a typo is expected
// workflow, not a race — see timingManual.js), so rebuild-then-refocus
// (§15.3) here returns focus to the feedback region after every save,
// matching timingScreen.js's own success-path fallback. When a save is the
// one that completes the heat, the announcement says so explicitly rather
// than just "time recorded" — the screen itself has just swapped to the
// read-only complete view underneath the user, and focus/tone alone don't
// convey that state change on their own.
import { findHeatById, listHeatEntries, hydrateEntries } from './heats.js';
import { listEntriesByIds } from '../../core/registry.js';
import { findEvent } from '../../core/events.js';
import { recordManualTime } from './timingManual.js';
import { describeTimingConflict } from './timing.js';
import { renderTimingRows } from './timingScreen.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { formatDuration } from '../../core/duration.js';

// Splits a total-seconds value into [minutes, seconds] for pre-filling the
// two input fields — the inverse of parseElapsedInput below. `null` in,
// `[null, null]` out, so an unrecorded entry's inputs start genuinely empty
// rather than pre-filled with "0" (which would look identical to a real,
// deliberately-entered zero).
function secsToParts(totalSecs) {
  if (totalSecs == null) return [null, null];
  return [Math.floor(totalSecs / 60), totalSecs % 60];
}

// Exported for direct unit testing, same as formatDuration's own precedent.
// Rejects an empty field rather than treating it as 0 (the
// `Number('') === 0` trap this project has hit before, see
// heatsScreen.js's readManualAssignmentForm) — an accidental Save on an
// untouched row must never silently record the fastest possible time.
// Seconds is bounded to 0–59 (unlike minutes) specifically to catch an
// obvious mis-entry (e.g. "3:75") as a clear validation error rather than
// silently accepting it as valid arithmetic.
export function parseElapsedInput(minutesRaw, secondsRaw) {
  const minutes = Number(minutesRaw);
  if (minutesRaw === '' || !Number.isInteger(minutes) || minutes < 0) {
    throw new Error(`Minutes must be a whole number, 0 or greater — got "${minutesRaw}"`);
  }
  const seconds = Number(secondsRaw);
  if (secondsRaw === '' || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
    throw new Error(`Seconds must be a whole number from 0 to 59 — got "${secondsRaw}"`);
  }
  return minutes * 60 + seconds;
}

export function renderManualEntryRows(hydratedEntries, { onSave }) {
  const rows = hydratedEntries.map((entry) => {
    const nameNode = el(
      'span',
      { className: 'timing-row-name-inner' },
      [
        entry.station ? el('span', { className: 'station-badge', text: entry.station }) : null,
        el('span', { className: 'timing-row-name-text', text: entry.displayName }),
      ].filter(Boolean),
    );

    const [prefillMin, prefillSec] = secsToParts(entry.elapsed_secs_raw ?? entry.elapsed_secs);
    const minutesInput = el('input', {
      className: 'field-input manual-time-input',
      attrs: {
        type: 'number',
        min: '0',
        inputmode: 'numeric',
        'aria-label': `${entry.displayName}: minutes`,
        value: prefillMin != null ? String(prefillMin) : '',
      },
    });
    const secondsInput = el('input', {
      className: 'field-input manual-time-input',
      attrs: {
        type: 'number',
        min: '0',
        max: '59',
        inputmode: 'numeric',
        'aria-label': `${entry.displayName}: seconds`,
        value: prefillSec != null ? String(prefillSec) : '',
      },
    });
    const saveLabel = entry.elapsed_secs != null ? 'Update' : 'Save';
    const saveButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: saveLabel,
      attrs: { 'aria-label': `${saveLabel} ${entry.displayName}'s time` },
    });
    saveButton.addEventListener('click', () =>
      onSave(entry.entry_id, minutesInput.value, secondsInput.value),
    );

    const statusNode =
      entry.elapsed_secs != null
        ? el('span', {
            className: 'timing-row-result',
            attrs: { 'data-maxed': entry.maxed ? 'true' : 'false' },
            text: entry.maxed
              ? `Max time (${formatDuration(entry.elapsed_secs)})`
              : `Recorded: ${formatDuration(entry.elapsed_secs)}`,
          })
        : null;

    return el('li', { className: 'timing-row manual-timing-row' }, [
      el('div', { className: 'timing-row-name' }, [nameNode]),
      el(
        'div',
        { className: 'manual-time-fields' },
        [
          minutesInput,
          el('span', { className: 'manual-time-separator', text: ':' }),
          secondsInput,
          saveButton,
          statusNode,
        ].filter(Boolean),
      ),
    ]);
  });
  return el('ul', { className: 'timing-row-list' }, rows);
}

export async function mountManualTimingScreen(
  root,
  { eventId, heatId, client = getSupabase() } = {},
) {
  let pendingError = null;
  let pendingSuccess = null;
  let renderGeneration = 0;
  // Captures whether the heat was still 'pending' right before the save
  // currently in flight — checked against the freshly-loaded status in the
  // following render() to detect whether THIS save was the one that
  // completed the heat, so the announcement can say so rather than the
  // generic "time recorded" leaving a screen-reader user unaware the whole
  // screen just changed shape underneath them.
  let checkForCompletionOnNextRender = false;
  // Ground truth over the outbox flush's own bookkeeping — same principle
  // and shape as timingScreen.js's own pendingEntryCheck (see its comment).
  let pendingEntryCheck = null;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function renderOrShowError(feedback) {
    try {
      await render();
    } catch (err) {
      setFeedback(feedback, describeError(err), 'error');
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  async function loadState() {
    const event = await findEvent(eventId, client);
    const heat = await findHeatById(heatId, client);
    const heatEntries = await listHeatEntries(heatId, client);
    const roster = await listEntriesByIds(
      heatEntries.map((entry) => entry.entry_id),
      client,
    );
    const hydrated = hydrateEntries(heatEntries, roster);
    return { event, heat, hydrated };
  }

  async function render() {
    const myGeneration = ++renderGeneration;
    const data = await loadState();
    // Same protection as timingScreen.js's render race guard: two Save
    // clicks on two different rows in quick succession each kick off their
    // own async chain, and without this a slower one finishing later could
    // rebuild the DOM with stale data on top of a newer, already-applied
    // save.
    if (myGeneration !== renderGeneration) return;

    // Ground truth over the outbox flush's own bookkeeping — resolved here,
    // against THIS render's freshly-reloaded state, before
    // checkForCompletionOnNextRender (below) or anything else reads
    // pendingError/pendingSuccess. Same principle as timingScreen.js's own
    // pendingEntryCheck (see its comment there).
    if (pendingEntryCheck) {
      const { heatEntryId, displayName, expectedElapsedSecs, flushResult } = pendingEntryCheck;
      pendingEntryCheck = null;
      const freshEntry = data.hydrated.find((entry) => entry.id === heatEntryId);
      // Compares against the EXACT value this call attempted to write —
      // matters even more for 'overwrite' than a real tap's 'reject': a
      // correction can land on an entry that already had SOME non-null
      // elapsed_secs from an earlier save, so a bare null-check couldn't
      // distinguish "my correction landed" from "my correction was
      // rejected and the OLD value is still sitting there" at all.
      if (freshEntry?.elapsed_secs === expectedElapsedSecs) {
        pendingSuccess = `${displayName ?? 'Cupper'}'s time recorded.`;
        // onSave only exists while this render's own branch is 'pending'
        // (see the `else if` below), so the heat was necessarily 'pending'
        // right before this save — checked against this same freshly-
        // loaded status just below, only once the save itself is confirmed.
        checkForCompletionOnNextRender = true;
      } else if (flushResult?.permanentFailure) {
        pendingError =
          describeTimingConflict(flushResult.error) ?? describeError(flushResult.error);
      } else {
        pendingError =
          "This cupper's time has not synced yet — it may still be waiting to sync. Try again in a moment.";
      }
    }

    if (checkForCompletionOnNextRender) {
      checkForCompletionOnNextRender = false;
      if (pendingSuccess && data.heat.status !== 'pending') {
        pendingSuccess += ' Timing complete — every cupper has a final time.';
      }
    }

    root.innerHTML = '';

    const container = el('section', { className: 'screen-container timing-screen' });

    // D9: is_test must render unmistakably on every surface an organiser or
    // audience member can see.
    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: `Timing (manual) — Heat ${data.heat.heat_number}` }));

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

    if (data.heat.timing_mode !== 'manual') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `This heat is timing_mode "${data.heat.timing_mode}" — not the manual-timing surface.`,
          }),
        ]),
      );
    } else if (data.heat.status === 'pending') {
      const rows = renderManualEntryRows(data.hydrated, {
        onSave: async (entryId, minutesValue, secondsValue) => {
          const savedEntry = data.hydrated.find((entry) => entry.entry_id === entryId);
          try {
            const totalSecs = parseElapsedInput(minutesValue, secondsValue);
            const { expectedElapsedSecs, flushResult } = await recordManualTime(
              data.heat,
              savedEntry,
              totalSecs,
              data.event.org_id,
              client,
              {},
            );
            pendingEntryCheck = {
              heatEntryId: savedEntry.id,
              displayName: savedEntry.displayName,
              expectedElapsedSecs,
              flushResult,
            };
          } catch (err) {
            pendingError = describeError(err);
          }
          await renderOrShowError(feedback);
        },
      });
      container.appendChild(
        el('div', { className: 'card' }, [el('h2', { text: 'Cuppers' }), rows]),
      );
    } else {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('h2', {
            id: 'timing-complete-heading',
            text: 'Timing complete',
            attrs: { tabindex: '-1' },
          }),
          el('p', { text: 'Every cupper has a final time. Proceed to scoring.' }),
          renderTimingRows(data.hydrated, { onStop: () => {} }),
        ]),
      );
    }

    container.appendChild(feedback);
    root.appendChild(container);

    // Rebuild-then-refocus (§15.3): a saved row's Save button is replaced by
    // fresh, re-prefilled inputs on every render, so there's no single
    // stable element to return focus to — every action here lands on the
    // feedback region instead, unlike timingScreen.js's screen (which
    // still has an explicit target for its one distinct action, starting
    // the heat).
    if (feedback.dataset.tone) {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  await render();

  return {
    // No ticking interval or document-level listener exists on this screen
    // (no master clock in manual mode) — nothing to tear down today, but
    // returning the same { unmount() } shape as timingScreen.js keeps the
    // two screens' contracts consistent for a future caller (a router) that
    // mounts either one without needing to know which. Still bumps the
    // generation counter, for the same reason timingScreen.js's unmount()
    // does: an in-flight render must never survive past teardown.
    unmount() {
      renderGeneration++;
    },
  };
}
