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
  { eventId, heatId, client = getSupabase(), signal } = {},
) {
  function renderLoadError(err) {
    // A discarded-but-still-in-flight lookup (still resolving after the
    // router already navigated elsewhere) must never write to `root`
    // again — router.js aborts `signal` the instant a newer navigation
    // starts. See ROADMAP.md's "A real DOM-write race between the
    // router..." entry.
    if (signal?.aborted) return;
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
    // A stale, still-in-flight findHeatById() shouldn't go on to mount
    // EITHER inner screen — both already carry their own signal guard (via
    // `signal` passed through below), so this isn't preventing a DOM
    // clobber that would otherwise happen; it's avoiding a wasted
    // event/heat/entries/roster round trip for a mount() call that would
    // just immediately discard its own result once it got there anyway
    // (found in review — corrected from an earlier, incorrect claim that
    // the inner screens' own initial paint was unguarded).
    if (signal?.aborted) {
      loading = false;
      return;
    }
    inner =
      heat.timing_mode === 'manual'
        ? await mountManualTimingScreen(root, { eventId, heatId, client, signal })
        : await mountTimingScreen(root, { eventId, heatId, client, signal });
    loading = false;
  }

  await attemptLoad();

  return {
    unmount() {
      return inner?.unmount?.();
    },
  };
}
