// Timing route dispatcher (2026-08-29 app-wiring pass). One route entry
// ("...heats/:heatId/timing") covers two real screens — app-mode and
// manual — since a heat's timing_mode isn't knowable from the URL alone.
// Keeps every link-building call site simple: always link to
// `.../timing`, regardless of mode.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findHeatById } from './heats.js';
import { mountTimingScreen } from './timingScreen.js';
import { mountManualTimingScreen } from './timingManualScreen.js';

export async function mountTimingRouteScreen(
  root,
  { eventId, heatId, client = getSupabase() } = {},
) {
  function renderLoadError(err) {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container' });
    const feedback = el('div', {
      className: 'screen-feedback',
      text: describeError(err),
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => attemptLoad());
    container.appendChild(retryButton);
    root.appendChild(container);
    feedback.focus();
  }

  let inner = null;
  let loading = false;
  async function attemptLoad() {
    // Matches eventsScreen.js's/eventDashboardScreen.js's own guard on
    // their Retry path — found missing in review: without it, two rapid
    // Retry clicks after a failed lookup could start two concurrent
    // attemptLoad() calls, each mounting its own timing screen into the
    // same root; the loser's instance would never be assigned to `inner`
    // and so never get its own unmount() called — for timingScreen.js,
    // this project's own "first live/ticking screen," that means an
    // orphaned interval nothing ever stops.
    if (loading) return;
    loading = true;
    let heat;
    try {
      heat = await findHeatById(heatId, client);
    } catch (err) {
      loading = false;
      renderLoadError(err);
      return;
    }
    inner =
      heat.timing_mode === 'manual'
        ? await mountManualTimingScreen(root, { eventId, heatId, client })
        : await mountTimingScreen(root, { eventId, heatId, client });
    loading = false;
  }

  await attemptLoad();

  return {
    unmount() {
      return inner?.unmount?.();
    },
  };
}
