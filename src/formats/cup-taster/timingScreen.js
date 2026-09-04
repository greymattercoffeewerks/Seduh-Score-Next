// Timing surface, app mode (handoff §14 T4.3). Rebuild-then-refocus (§15.3)
// for real actions (start, tap, auto-max), but the countdown itself is
// deliberately NOT part of that rebuild cycle: a full DOM rebuild every
// second would flicker and reset focus for no reason. `startTicking()`
// mutates only the countdown element's textContent every second; a full
// `render()` only runs after start/tap/auto-max — the actions that actually
// change persisted state.
//
// The countdown display is intentionally not an aria-live region — a value
// changing every second would spam screen-reader announcements. It's still
// reachable/readable on demand (plain text, focusable countdown card), just
// not auto-announced each tick; only real state changes (a stop recorded,
// the heat completing, crossing the urgent threshold) go through the
// screen-feedback live region.
import { findHeatById, listHeatEntries, hydrateEntries } from './heats.js';
import { listEntriesByIds } from '../../core/registry.js';
import { findEvent } from '../../core/events.js';
import { startHeat, recordTap, autoMaxRemainingEntries, describeTimingConflict } from './timing.js';
import { recordManualTime, parseElapsedInput, secsToParts } from './timingManual.js';
import { cupTasterOutboxHandlers } from './outboxHandlers.js';
import { remainingSecs, isExpired } from '../../core/countdown.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { formatDuration } from '../../core/duration.js';

const URGENT_THRESHOLD_SECS = 10;

export function renderRosterPreview(hydratedEntries) {
  const items = hydratedEntries.map((entry) =>
    el('li', {}, [el('span', { text: entry.displayName })]),
  );
  return el('ul', { className: 'timing-row-list' }, items);
}

// Shared by this screen's own "unstopped" row (the toggle below) and
// timingManualScreen.js's ALWAYS-shown entry row (every row, every heat) —
// extracted here rather than into timingManual.js since that file is
// otherwise pure DB/logic with no DOM (`el`) usage at all, same reasoning
// as buildScoringLink below. `extraChildren` lets a caller append its own
// trailing node(s) (timingManualScreen.js's already-recorded status span)
// INSIDE the same flex row the inputs/button live in, matching that
// screen's own established layout — not a sibling, which would break its
// CSS.
export function renderManualTimeFields(entry, { onSave, extraChildren = [], id } = {}) {
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

  return el('div', { className: 'manual-time-fields', id }, [
    minutesInput,
    el('span', { className: 'manual-time-separator', text: ':' }),
    secondsInput,
    saveButton,
    ...extraChildren,
  ]);
}

// `onSaveManual` is the mid-heat device-failure fallback (handoff §7.1: "a
// heat may mix tapped and hand-entered times if a stopwatch fails
// mid-heat") — closes a real, previously-documented gap (ROADMAP.md's own
// "T4.3's app-mode timing screen has no manual-entry fallback" entry): the
// organiser's own device is what runs THIS screen's tap interface, so if
// it fails (or a specific cupper's clock genuinely can't be reached) mid-
// heat, every OTHER cupper keeps timing normally by tap while this one
// entry gets a hand-typed time instead — both `time_source` values coexist
// in the same heat, exactly as the spec describes. Opt-in per row (a small
// toggle next to Stop, not always-visible inputs) — this screen's primary
// path is the fast tap, and permanently showing input fields on every row
// would compete with that. Purely a LOCAL DOM toggle (hidden/shown, no
// render()) so opening it never interrupts the live countdown or reloads
// from the network — see this module's own top comment on why a full
// rebuild is reserved for real state changes only. A stale toggle left
// open across an unrelated action's real render() (e.g. a different row's
// Stop) resets to closed — accepted, matching this screen's existing
// no-draft-persistence precedent (pendingEntryCheck etc.), and this is a
// rare fallback path, not the primary workflow.
export function renderTimingRows(hydratedEntries, { onStop, onSaveManual }) {
  const rows = hydratedEntries.map((entry) => {
    const nameNode = el(
      'span',
      { className: 'timing-row-name-inner' },
      [
        entry.station ? el('span', { className: 'station-badge', text: entry.station }) : null,
        el('span', { className: 'timing-row-name-text', text: entry.displayName }),
      ].filter(Boolean),
    );

    let resultNode;
    if (entry.elapsed_secs == null) {
      const stopButton = el('button', {
        className: 'btn btn-primary tap-target btn-stop',
        text: 'Stop',
        attrs: { 'aria-label': `Stop ${entry.displayName}'s clock` },
      });

      // `aria-controls` completes the standard disclosure-widget pattern
      // alongside aria-expanded (WAI-ARIA Authoring Practices) — found in
      // this pass (holistic accessibility review): aria-expanded alone was
      // already wired, but nothing formally associated the toggle with the
      // region it discloses. Support is inconsistent across screen
      // readers, so this is additive, not a substitute for the toggle's own
      // aria-expanded/focus-management, which already carries the real
      // weight here.
      const manualFieldsId = `manual-time-fields-${entry.entry_id}`;
      const manualToggle = el('button', {
        className: 'btn btn-outline tap-target btn-manual-toggle',
        text: 'Enter time manually',
        attrs: {
          type: 'button',
          'aria-label': `Enter ${entry.displayName}'s time manually`,
          'aria-expanded': 'false',
          'aria-controls': manualFieldsId,
        },
      });
      const cancelButton = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Cancel',
        attrs: { type: 'button', 'aria-label': `Cancel manual entry for ${entry.displayName}` },
      });
      // A parse failure (parseElapsedInput throwing) is a pure client-side
      // validation error — no write was ever attempted, so it's handled
      // entirely locally, same as the toggle itself: no render(), the
      // fields and whatever the organiser already typed stay exactly as
      // they were, only this message changes. Found in review
      // (code-reviewer): routing it through the full render() cycle (the
      // original version's shape) silently closed the toggle AND discarded
      // a correctly-typed sibling field along with the invalid one — a
      // real cost for the exact time-pressured moment this fallback exists
      // for. `onSaveManual` itself (mountTimingScreen's own handler) is
      // only ever called with an already-validated integer now, never raw
      // strings — the network/RPC path stays the one place a real render()
      // is warranted, since only that path can change persisted state.
      const localError = el('p', {
        className: 'manual-time-local-error',
        attrs: { role: 'alert' },
      });
      const manualFields = renderManualTimeFields(entry, {
        id: manualFieldsId,
        onSave: (entryId, minutesRaw, secondsRaw) => {
          let rawSecs;
          try {
            rawSecs = parseElapsedInput(minutesRaw, secondsRaw);
          } catch (err) {
            localError.textContent = err.message;
            return;
          }
          localError.textContent = '';
          onSaveManual(entryId, rawSecs);
        },
        extraChildren: [cancelButton, localError],
      });
      manualFields.hidden = true;

      manualToggle.addEventListener('click', () => {
        stopButton.hidden = true;
        manualToggle.hidden = true;
        manualToggle.setAttribute('aria-expanded', 'true');
        manualFields.hidden = false;
        // Rebuild-then-refocus (§15.3) applies to a real disclosure open
        // too, not just a full render() — found in review
        // (ui-accessibility-reviewer): hiding manualToggle (the element
        // that was just focused, per browser click-focus behavior) drops
        // focus to <body> with no defined landing spot otherwise. The
        // minutes input is the natural first field to land on.
        manualFields.querySelector('input')?.focus();
      });
      cancelButton.addEventListener('click', () => {
        localError.textContent = '';
        manualFields.hidden = true;
        stopButton.hidden = false;
        manualToggle.hidden = false;
        manualToggle.setAttribute('aria-expanded', 'false');
        // Same rebuild-then-refocus reasoning as above, in reverse —
        // cancelButton (just focused) is about to be hidden.
        manualToggle.focus();
      });
      stopButton.addEventListener('click', () => onStop(entry.entry_id));

      resultNode = el('div', { className: 'timing-row-actions' }, [
        stopButton,
        manualToggle,
        manualFields,
      ]);
    } else {
      resultNode = el('span', {
        className: 'timing-row-result',
        attrs: { 'data-maxed': entry.maxed ? 'true' : 'false' },
        text: entry.maxed
          ? `Max time (${formatDuration(entry.elapsed_secs)})`
          : formatDuration(entry.elapsed_secs),
      });
    }

    return el('li', { className: 'timing-row' }, [
      el('div', { className: 'timing-row-name' }, [nameNode]),
      resultNode,
    ]);
  });
  return el('ul', { className: 'timing-row-list' }, rows);
}

// Shared by this screen's own "Timing complete" view and
// timingManualScreen.js's identical one (which imports this directly, same
// as it already imports renderTimingRows above) — extracted on 2nd
// verbatim use. Lives here, not in timing.js, since that file is otherwise
// pure DB/logic with no DOM (`el`) usage at all — found in review
// (module-boundary-checker/code-reviewer): timing.js is also imported by
// outboxHandlers.js and timingManualScreen.js's OWN logic-only sibling,
// timingManual.js, neither of which has any reason to pull in core/dom.js
// transitively. Deliberately NOT merged with heatsScreen.js's own
// heatActionLink(), which handles three states (confirmed/scoring/
// pending-or-timing) for a heat LIST; this only ever renders the single
// "timing just finished, go score" case these two screens need once their
// own local status check already confirms it.
export function buildScoringLink(eventId, heatId) {
  return el('a', {
    className: 'btn btn-primary tap-target',
    text: 'Score this heat',
    attrs: { href: `#/events/${eventId}/heats/${heatId}/scoring` },
  });
}

export async function mountTimingScreen(
  root,
  { eventId, heatId, client = getSupabase(), signal } = {},
) {
  let focusAfterRender = null;
  let pendingError = null;
  let pendingSuccess = null;
  let tickHandle = null;
  let countdownEl = null;
  let expiryHandled = false;
  let urgentAnnounced = false;
  let visibilityHandler = null;
  let renderGeneration = 0;
  // Set by an action handler right before triggering the next render(),
  // resolved INSIDE that render() against its own freshly-reloaded state —
  // ground truth over the outbox flush's own bookkeeping, same principle
  // scoringScreen.js's submitConfirmHeat handler already established (its
  // own comment: "the outbox is a single shared queue, so `result` can
  // reflect an unrelated operation... rather than this specific attempt").
  // `flushResult` is used only as a FALLBACK explanation when the ground
  // truth shows the action did NOT visibly take — never to override what
  // the fresh reload actually shows, which is what keeps a stale/unrelated
  // flushResult from ever being reported as if it were about the wrong
  // action.
  let pendingHeatCheck = null;
  let pendingEntryCheck = null;

  function stopTicking() {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    // Each render() while status stays 'timing' (e.g. a tap that isn't the
    // last one) would otherwise register a new document-level listener on
    // top of the last one, leaking a growing pile across a single heat's
    // session — always clear the previous one before a render may add a
    // fresh one.
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  }

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

  // Accepted tradeoff, found in review (code-reviewer): if the countdown
  // reaches zero while an organiser has a row's manual-entry fields open
  // (mid-type, for the exact device-failure scenario this fallback
  // exists for), this still auto-maxes that entry and its own render()
  // silently discards whatever was half-typed, with no distinct warning
  // that an in-progress hand-entry was specifically the thing lost — not
  // just a generic "time's up." Not fixed: §7.1's own "an unstopped clock
  // maxes at the full duration" is unconditional, and delaying/skipping
  // the sweep to protect an unsent, never-enqueued local draft would
  // violate that guarantee for every OTHER still-running entry too. The
  // window this can actually bite in — the clock hits exactly zero while
  // someone is mid-type on this specific fallback path — is narrow enough
  // that documenting it here, rather than building a warn-before-sweep
  // mechanism, is the proportionate response for now.
  async function handleExpiry(data, feedback) {
    if (expiryHandled) return;
    expiryHandled = true;
    stopTicking();
    // The count comes from LOCAL knowledge (this screen's own already-
    // rendered roster), not a value read back from the RPC — auto_max_heat
    // returns void, matching start_heat/record_heat_time's own shape (see
    // timing.js's module comment). pendingHeatCheck below still verifies
    // this against fresh, reloaded state before actually reporting success.
    const stillRunningCount = data.hydrated.filter((entry) => entry.elapsed_secs == null).length;
    try {
      const flushResult = await autoMaxRemainingEntries(heatId, data.event.org_id, client, {
        handlers: cupTasterOutboxHandlers(client),
      });
      pendingHeatCheck = { expect: 'past-timing', stillRunningCount, flushResult };
    } catch (err) {
      pendingError = describeError(err);
    }
    await renderOrShowError(feedback);
  }

  function tick(data, startedAtMs, durationSecs, feedback) {
    const remaining = remainingSecs(startedAtMs, durationSecs, Date.now());
    if (countdownEl) {
      countdownEl.textContent = formatDuration(remaining);
      countdownEl.dataset.urgent = remaining <= URGENT_THRESHOLD_SECS ? 'true' : 'false';
    }
    // A one-time announcement, not a full render — the countdown's own
    // per-second mutation deliberately stays outside the live region (see
    // the module comment), but crossing into the urgent window is a real
    // state change worth surfacing once, not every second after.
    if (!urgentAnnounced && remaining <= URGENT_THRESHOLD_SECS && remaining > 0) {
      urgentAnnounced = true;
      setFeedback(feedback, 'Less than 10 seconds remaining.', 'urgent');
    }
    if (isExpired(startedAtMs, durationSecs, Date.now())) {
      handleExpiry(data, feedback);
    }
  }

  async function render() {
    const myGeneration = ++renderGeneration;
    stopTicking();
    const data = await loadState();
    // A newer render (triggered by a second, faster-resolving action while
    // this one was still awaiting loadState()) has already taken over —
    // abandon this one rather than clobbering newer DOM/feedback with stale
    // data. Known trade-off: pendingError/pendingSuccess set by *this*
    // render's caller are left unconsumed here rather than requeued, so in
    // the narrow window where both fire, the newer render's own message
    // wins outright rather than the two being merged or ordered. Accepted:
    // the alternative (two renders touching the DOM concurrently) is the
    // actual corruption bug this generation counter exists to prevent.
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

    // Ground truth over the outbox flush's own bookkeeping (see the module
    // comment on pendingHeatCheck/pendingEntryCheck above) — resolved here,
    // against THIS render's freshly-reloaded state, before anything below
    // reads pendingError/pendingSuccess to build the feedback region.
    if (pendingHeatCheck) {
      const { expect, stillRunningCount, flushResult } = pendingHeatCheck;
      pendingHeatCheck = null;
      if (expect === 'timing' && data.heat.status === 'timing') {
        focusAfterRender = '#countdown-heading';
      } else if (expect === 'past-timing' && data.heat.status !== 'timing') {
        pendingSuccess =
          stillRunningCount > 0
            ? `Time's up — ${stillRunningCount} cupper${stillRunningCount === 1 ? '' : 's'} automatically maxed.`
            : "Time's up — every cupper already had a final time.";
      } else if (flushResult?.permanentFailure) {
        pendingError =
          describeTimingConflict(flushResult.error) ?? describeError(flushResult.error);
      } else {
        pendingError =
          'This has not synced yet — it may still be waiting to sync. Try again in a moment.';
      }
    }
    if (pendingEntryCheck) {
      const { heatEntryId, displayName, expectedElapsedSecs, flushResult } = pendingEntryCheck;
      pendingEntryCheck = null;
      const freshEntry = data.hydrated.find((entry) => entry.id === heatEntryId);
      // Compares against the EXACT value this call attempted to write, not
      // just non-null — a rejected duplicate tap leaves a non-null
      // elapsed_secs too (someone else's), which a bare null-check can't
      // tell apart from this call's own success (see recordTap's own
      // comment in timing.js).
      if (freshEntry?.elapsed_secs === expectedElapsedSecs) {
        pendingSuccess = `${displayName ?? 'Cupper'}'s time recorded.`;
      } else if (flushResult?.permanentFailure) {
        pendingError =
          describeTimingConflict(flushResult.error) ?? describeError(flushResult.error);
      } else {
        pendingError =
          "This cupper's time has not synced yet — it may still be waiting to sync. Try again in a moment.";
      }
    }

    root.innerHTML = '';

    const container = el('section', { className: 'screen-container timing-screen' });

    // D9: is_test must render unmistakably on every surface an organiser or
    // audience member can see — this project's founding failure mode is a
    // demo heat being indistinguishable from a real one mid-competition.
    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: `Timing — Heat ${data.heat.heat_number}` }));

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

    if (data.heat.timing_mode !== 'app') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `This heat is timing_mode "${data.heat.timing_mode}" — not the app-timing surface.`,
          }),
        ]),
      );
    } else if (data.heat.status === 'pending') {
      const startButton = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Start heat',
      });
      startButton.addEventListener('click', async () => {
        try {
          const { flushResult } = await startHeat(heatId, data.event.org_id, client, {
            handlers: cupTasterOutboxHandlers(client),
          });
          pendingHeatCheck = { expect: 'timing', flushResult };
        } catch (err) {
          pendingError = describeError(err);
        }
        await renderOrShowError(feedback);
      });
      container.appendChild(
        el('div', { className: 'card' }, [
          el('h2', { text: 'Roster' }),
          renderRosterPreview(data.hydrated),
        ]),
      );
      container.appendChild(el('div', { className: 'card' }, [startButton]));
    } else if (data.heat.status === 'timing') {
      container.appendChild(
        el('h2', {
          id: 'countdown-heading',
          text: 'Time remaining',
          attrs: { tabindex: '-1' },
        }),
      );
      countdownEl = el('div', { className: 'countdown-display' });
      const startedAtMs = new Date(data.heat.started_at).getTime();
      const initialRemaining = remainingSecs(startedAtMs, data.heat.duration_secs, Date.now());
      countdownEl.textContent = formatDuration(initialRemaining);
      countdownEl.dataset.urgent = initialRemaining <= URGENT_THRESHOLD_SECS ? 'true' : 'false';
      container.appendChild(countdownEl);

      const rows = renderTimingRows(data.hydrated, {
        onStop: async (entryId) => {
          const stoppedEntry = data.hydrated.find((entry) => entry.entry_id === entryId);
          try {
            const { expectedElapsedSecs, flushResult } = await recordTap(
              data.heat,
              stoppedEntry,
              data.event.org_id,
              client,
              { handlers: cupTasterOutboxHandlers(client) },
            );
            pendingEntryCheck = {
              heatEntryId: stoppedEntry.id,
              displayName: stoppedEntry.displayName,
              expectedElapsedSecs,
              flushResult,
            };
          } catch (err) {
            pendingError = describeError(err);
          }
          await renderOrShowError(feedback);
        },
        // The mid-heat device-failure fallback (see this module's own
        // renderTimingRows comment) — reuses recordManualTime and the
        // exact same pendingEntryCheck ground-truth machinery recordTap's
        // own onStop already established above, so success/conflict
        // messaging behaves identically regardless of which path recorded
        // the time. `rawSecs` arrives already validated — renderTimingRows'
        // own onSave wrapper calls parseElapsedInput itself and only
        // invokes this handler on success, so a bad typo never reaches
        // this far (see that comment for why: a validation failure alone
        // must never trigger a render()).
        onSaveManual: async (entryId, rawSecs) => {
          const targetEntry = data.hydrated.find((entry) => entry.entry_id === entryId);
          try {
            const { expectedElapsedSecs, flushResult } = await recordManualTime(
              data.heat,
              targetEntry,
              rawSecs,
              data.event.org_id,
              client,
              { handlers: cupTasterOutboxHandlers(client) },
            );
            pendingEntryCheck = {
              heatEntryId: targetEntry.id,
              displayName: targetEntry.displayName,
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

      expiryHandled = false;
      urgentAnnounced = initialRemaining <= URGENT_THRESHOLD_SECS;
      tickHandle = setInterval(
        () => tick(data, startedAtMs, data.heat.duration_secs, feedback),
        1000,
      );
      // A backgrounded/throttled tab may miss scheduled ticks entirely —
      // force an immediate check on return rather than waiting for the next
      // 1s tick, so an already-expired heat resolves as soon as the
      // organiser looks at the screen again. Stays registered for the whole
      // 'timing' period (not just once) — stopTicking() at the top of the
      // next render() is what removes it, whether that next render comes
      // from a tap, expiry, or an error retry.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          tick(data, startedAtMs, data.heat.duration_secs, feedback);
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
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
          // Found live: without this, reaching scoring meant leaving this
          // screen entirely (Overview -> stage -> Heats -> this same heat's
          // own "Score this heat" link, heatsScreen.js's heatActionLink) —
          // several avoidable steps right when timing has just finished and
          // an organiser wants to move straight into scoring.
          buildScoringLink(eventId, heatId),
        ]),
      );
      // Found in review (ui-accessibility-reviewer): without this, the
      // render that just completed the heat (last tap, or the auto-max
      // sweep) fell through to the generic feedback-region fallback below
      // — but `feedback` is appended to the DOM AFTER this card, so a
      // keyboard/screen-reader user landing there and pressing Tab moved
      // FORWARD, past the "Score this heat" link that already sits
      // earlier in the DOM, not toward it. Gated on 'success' specifically
      // (not any tone) — found in a second review pass: a concurrent tap
      // that loses the race to complete this same heat reports an ERROR
      // tone on this exact branch (pendingEntryCheck's permanentFailure/
      // not-yet-synced cases), and `feedback` has tabindex="-1" (out of
      // tab order), so redirecting focus to the heading on an error tone
      // would leave a keyboard-only user with no way to reach their own
      // rejection message at all — only the aria-live announcement, which
      // a sighted keyboard user watching focus position wouldn't get. A
      // plain navigation straight to an already-complete heat sets no
      // tone at all, so it's left with no explicit focus move either way,
      // same as before this fix.
      if (feedback.dataset.tone === 'success') {
        focusAfterRender = '#timing-complete-heading';
      }
    }

    container.appendChild(feedback);
    root.appendChild(container);

    // Rebuild-then-refocus (§15.3): only past this point does the target
    // element actually exist to focus. When no explicit target was set (the
    // stop/expiry success paths don't set one — there's no single obvious
    // element to return focus to once a Stop button has been replaced by a
    // static result), fall back to the feedback region itself: it both
    // carries the message that just changed and gives a sighted user a
    // visual anchor, matching heatsScreen.js's established fallback.
    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone) {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  await render();

  return {
    unmount() {
      // A render() already in flight (awaiting loadState()) when unmount()
      // is called would otherwise still pass its own generation check and
      // proceed — rebuilding into a root the caller has already discarded,
      // and registering a fresh interval/visibilitychange listener that
      // nothing will ever clear again, since only the next render() (which
      // will now never come) clears the previous one. Bumping the counter
      // here gives unmount() the same "abandon if superseded" protection a
      // newer render already gets over an older one.
      renderGeneration++;
      stopTicking();
    },
  };
}
