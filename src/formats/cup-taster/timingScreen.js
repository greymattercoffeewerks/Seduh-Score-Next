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
import { startHeat, recordTap, autoMaxRemainingEntries } from './timing.js';
import { remainingSecs, isExpired } from '../../core/countdown.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';

const URGENT_THRESHOLD_SECS = 10;

export function formatCountdown(totalSecs) {
  const clamped = Math.max(0, totalSecs);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function renderRosterPreview(hydratedEntries) {
  const items = hydratedEntries.map((entry) =>
    el('li', {}, [el('span', { text: entry.displayName })]),
  );
  return el('ul', { className: 'timing-row-list' }, items);
}

export function renderTimingRows(hydratedEntries, { onStop }) {
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
      stopButton.addEventListener('click', () => onStop(entry.entry_id));
      resultNode = stopButton;
    } else {
      resultNode = el('span', {
        className: 'timing-row-result',
        attrs: { 'data-maxed': entry.maxed ? 'true' : 'false' },
        text: entry.maxed
          ? `Max time (${formatCountdown(entry.elapsed_secs)})`
          : formatCountdown(entry.elapsed_secs),
      });
    }

    return el('li', { className: 'timing-row' }, [
      el('div', { className: 'timing-row-name' }, [nameNode]),
      resultNode,
    ]);
  });
  return el('ul', { className: 'timing-row-list' }, rows);
}

export async function mountTimingScreen(root, { eventId, heatId, client = getSupabase() } = {}) {
  let focusAfterRender = null;
  let pendingError = null;
  let pendingSuccess = null;
  let tickHandle = null;
  let countdownEl = null;
  let expiryHandled = false;
  let urgentAnnounced = false;
  let visibilityHandler = null;
  let renderGeneration = 0;

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

  async function handleExpiry(feedback) {
    if (expiryHandled) return;
    expiryHandled = true;
    stopTicking();
    try {
      const maxed = await autoMaxRemainingEntries(heatId, client, {});
      // Always set a message, even when nothing needed maxing — that empty
      // case is reachable (not just hypothetical): tryAdvanceToScoring
      // swallows a failed status transition, so a heat can sit in 'timing'
      // with every entry already stopped until the master clock also
      // expires and this handler fires as the retry. Leaving pendingSuccess
      // null here would mean feedback.dataset.tone never gets set on that
      // render, which is also the render's only focus target — an
      // unmanaged-focus regression, not just a missing message.
      pendingSuccess =
        maxed.length > 0
          ? `Time's up — ${maxed.length} cupper${maxed.length === 1 ? '' : 's'} automatically maxed.`
          : "Time's up — every cupper already had a final time.";
    } catch (err) {
      pendingError = describeError(err);
    }
    await renderOrShowError(feedback);
  }

  function tick(startedAtMs, durationSecs, feedback) {
    const remaining = remainingSecs(startedAtMs, durationSecs, Date.now());
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remaining);
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
      handleExpiry(feedback);
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
          await startHeat(heatId, client, {});
          focusAfterRender = '#countdown-heading';
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
      countdownEl.textContent = formatCountdown(initialRemaining);
      countdownEl.dataset.urgent = initialRemaining <= URGENT_THRESHOLD_SECS ? 'true' : 'false';
      container.appendChild(countdownEl);

      const rows = renderTimingRows(data.hydrated, {
        onStop: async (entryId) => {
          const stoppedEntry = data.hydrated.find((entry) => entry.entry_id === entryId);
          try {
            await recordTap(heatId, entryId, client, {});
            pendingSuccess = `${stoppedEntry?.displayName ?? 'Cupper'}'s time recorded.`;
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
      tickHandle = setInterval(() => tick(startedAtMs, data.heat.duration_secs, feedback), 1000);
      // A backgrounded/throttled tab may miss scheduled ticks entirely —
      // force an immediate check on return rather than waiting for the next
      // 1s tick, so an already-expired heat resolves as soon as the
      // organiser looks at the screen again. Stays registered for the whole
      // 'timing' period (not just once) — stopTicking() at the top of the
      // next render() is what removes it, whether that next render comes
      // from a tap, expiry, or an error retry.
      visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          tick(startedAtMs, data.heat.duration_secs, feedback);
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
          el('p', { text: 'Every cupper has a final time. Proceed to scoring.' }),
          renderTimingRows(data.hydrated, { onStop: () => {} }),
        ]),
      );
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
