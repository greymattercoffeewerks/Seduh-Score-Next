// BTC per-event dashboard (app-wiring pass). The organiser's landing hub for a BTC
// event, mirroring the role cup-taster/eventDashboardScreen.js plays there — but BTC has
// no stage plan to pick between (it's a fixed preliminary-round-robin-then-bracket
// shape, not Cup Taster's configurable stage chain), so this is a flat set of links
// rather than a per-stage card list: Setup (teams/judges), Matches (preliminary match
// creation), Standings (read-only), Bracket (generate + create bracket matches).
// Scoring a specific match is reached FROM Matches/Bracket's own match rows, not from
// this hub directly — same relationship Cup Taster's own dashboard has to Timing/Scoring
// (reached from a heat row, never a dashboard button).
//
// Lives here, not core/ — reads nothing beyond core/events.js's findEvent, but the
// four links below are genuinely BTC-specific routes; a hypothetical future format
// needs its own equivalent hub, not this one reused.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

export async function mountBtcEventDashboardScreen(
  root,
  { eventId, client = getSupabase(), signal } = {},
) {
  let loadFailedMessage = null;
  let loading = false;
  let focusAfterRender = null;

  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container btc-event-dashboard-screen' });
    container.appendChild(el('h1', { text: 'Event' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading event…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.focus();
  }

  function renderLoadError() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container btc-event-dashboard-screen' });
    container.appendChild(el('h1', { text: 'Event' }));
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
    retryButton.addEventListener('click', () => attemptLoad());
    container.appendChild(retryButton);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    let event = null;
    try {
      event = await raceTimeout(findEvent(eventId, client), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
      // Same Retry-only focus gap Cup Taster's own eventDashboardScreen.js closed —
      // the very first successful mount is already covered by router.js's own
      // generic heading fallback, but a Retry click doesn't go through the router.
      focusAfterRender = '#btc-event-dashboard-heading';
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render(event);
  }

  function render(event) {
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container btc-event-dashboard-screen' });

    if (event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', {
        id: 'btc-event-dashboard-heading',
        text: event.name,
        attrs: { tabindex: '-1' },
      }),
    );

    container.appendChild(
      el('div', { className: 'card btc-event-dashboard-actions' }, [
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Setup',
          attrs: { href: `#/events/${eventId}/btc/setup` },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Matches',
          attrs: { href: `#/events/${eventId}/btc/matches` },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Standings',
          attrs: { href: `#/events/${eventId}/btc/standings` },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Bracket',
          attrs: { href: `#/events/${eventId}/btc/bracket` },
        }),
      ]),
    );

    root.appendChild(container);

    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    }
  }

  await attemptLoad();

  return {
    unmount() {
      // No live state, no listeners, no timers — nothing to tear down.
    },
  };
}
