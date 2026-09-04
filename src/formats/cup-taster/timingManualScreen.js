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
import { recordManualTime, parseElapsedInput } from './timingManual.js';
import { describeTimingConflict } from './timing.js';
import { cupTasterOutboxHandlers } from './outboxHandlers.js';
import { renderTimingRows, buildScoringLink, renderManualTimeFields } from './timingScreen.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { formatDuration } from '../../core/duration.js';

// Local, non-network validation feedback — mirrors timingScreen.js's own
// renderTimingRows/renderManualTimeFields wrapper (its own comment explains
// why: a parse failure here is purely client-side, so it must never trigger
// the caller's own render(), which rebuilds EVERY row from fresh server
// state and would discard whatever ANY OTHER row currently has half-typed).
// Found in this pass (holistic accessibility review): this screen's own
// rows are the ALWAYS-shown, PRIMARY entry method (unlike timingScreen.js's
// opt-in fallback toggle), so the same data-loss risk applies here at least
// as much, but this screen never got the 2026-09-04 fix — a mistyped row
// still routed through mountManualTimingScreen's own full render() cycle,
// silently wiping any correctly-typed-but-unsaved value in every OTHER row
// on screen. `onSave` (the caller's own handler) now only ever receives an
// already-validated integer, exactly matching renderTimingRows' own
// onSaveManual contract.
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

    const localError = el('p', {
      className: 'manual-time-local-error',
      attrs: { role: 'alert' },
    });

    const manualFields = renderManualTimeFields(entry, {
      onSave: (entryId, minutesRaw, secondsRaw) => {
        let totalSecs;
        try {
          totalSecs = parseElapsedInput(minutesRaw, secondsRaw);
        } catch (err) {
          localError.textContent = err.message;
          return;
        }
        localError.textContent = '';
        onSave(entryId, totalSecs);
      },
      extraChildren: [statusNode, localError].filter(Boolean),
    });

    return el('li', { className: 'timing-row manual-timing-row' }, [
      el('div', { className: 'timing-row-name' }, [nameNode]),
      manualFields,
    ]);
  });
  return el('ul', { className: 'timing-row-list' }, rows);
}

export async function mountManualTimingScreen(
  root,
  { eventId, heatId, client = getSupabase(), signal } = {},
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
  // Set inside render()'s own "Timing complete" branch when that render is
  // the live completing transition (not a plain navigation to an
  // already-complete heat) — see that branch's own comment.
  let completeHeadingFocus = false;
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
    // A discarded-but-still-in-flight render (this render's own loadState()
    // still resolving after the router already navigated elsewhere) must
    // never write to `root` again — router.js aborts `signal` the instant
    // a newer navigation starts. Distinct from the renderGeneration check
    // above: that one guards against a NEWER render() from THIS SAME
    // screen instance winning; this one guards against the whole screen
    // instance having been superseded by NAVIGATION. See ROADMAP.md's "A
    // real DOM-write race between the router..." entry.
    if (signal?.aborted) return;

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
        // `totalSecs` arrives already validated — renderManualEntryRows' own
        // onSave wrapper calls parseElapsedInput itself and only invokes
        // this handler on success (see its own comment: a validation
        // failure alone must never trigger a render(), matching
        // timingScreen.js's identical onSaveManual contract).
        onSave: async (entryId, totalSecs) => {
          const savedEntry = data.hydrated.find((entry) => entry.entry_id === entryId);
          try {
            const { expectedElapsedSecs, flushResult } = await recordManualTime(
              data.heat,
              savedEntry,
              totalSecs,
              data.event.org_id,
              client,
              { handlers: cupTasterOutboxHandlers(client) },
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
          el('p', { text: 'Every cupper has a final time.' }),
          renderTimingRows(data.hydrated, { onStop: () => {} }),
          // See timingScreen.js's identical use of the same shared
          // helper — same live-found gap (no forward link out of this
          // screen once timing's done).
          buildScoringLink(eventId, heatId),
        ]),
      );
      // Found in review (ui-accessibility-reviewer), same gap as
      // timingScreen.js's identical fix: `feedback` is appended AFTER this
      // card, so a keyboard/screen-reader user landing on it after the
      // completing save would Tab FORWARD, past the "Score this heat" link
      // that already sits earlier in the DOM. Gated on 'success'
      // specifically, not any tone — see timingScreen.js's own comment on
      // its identical guard: a rejected concurrent save also lands on this
      // branch with an ERROR tone, and `feedback` (tabindex="-1", out of
      // tab order) is the only reachable place a keyboard-only user could
      // find that rejection text.
      if (feedback.dataset.tone === 'success') {
        completeHeadingFocus = true;
      }
    }

    container.appendChild(feedback);
    root.appendChild(container);

    // Rebuild-then-refocus (§15.3): a saved row's Save button is replaced by
    // fresh, re-prefilled inputs on every render, so there's no single
    // stable element to return focus to — every action here lands on the
    // feedback region instead, unlike timingScreen.js's screen (which
    // still has an explicit target for its one distinct action, starting
    // the heat) — except the one completing transition above, which now has
    // its own explicit target for the same reason timingScreen.js's does.
    if (completeHeadingFocus) {
      completeHeadingFocus = false;
      root.querySelector('#timing-complete-heading')?.focus();
    } else if (feedback.dataset.tone) {
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
