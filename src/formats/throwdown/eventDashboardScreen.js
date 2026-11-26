// Throwdown per-event dashboard: the organiser's run sheet. One next-step card on top, then a card per phase, with a
// right-hand rail holding what needs attention, whether the event is live and the match log to download. Built on the
// format-agnostic organiser kit in `core/`; what a phase IS and when it is done is `runSheet.js`, derived on every
// load, never stored. The Matches and Results links stay as a secondary row at the bottom.
//
// Lives here, not core/: the phases, the routes and the live publish are Throwdown's. Same shape as BTC's dashboard
// (copied, not imported: a format never imports another format).
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { buildHomepageListingCard } from '../../core/homepageListingCard.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import { buildRunSheet } from '../../core/runSheet.js';
import { buildEventWarnings } from '../../core/eventWarnings.js';
import { buildLiveCard } from '../../core/liveCard.js';
import { buildRecordsCard } from '../../core/recordsCard.js';
import { renderStatusBand } from '../../core/statusBand.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadThrowdownDashboardData } from './dashboardData.js';
import {
  currentPhaseLabel,
  deriveThrowdownPhases,
  deriveThrowdownWarnings,
  throwdownLinks,
} from './runSheet.js';
import { matchLogCsv, matchLogFilename } from './recordsExport.js';
import { publishThrowdownLive } from './liveSession.js';

const TAKE_OVER_WAIT_MS = 8000;

const NOT_SENT_MESSAGE =
  'Not on the displays yet. It is saved on this device and sends when the connection returns.';

// "Sat 14 Mar 2027 · Venue · City", whatever of it the event has.
function metaLine(event, phaseLabel) {
  const parts = [phaseLabel];
  if (event.event_date) {
    const date = new Date(`${event.event_date}T00:00:00`);
    parts.push(
      Number.isNaN(date.getTime())
        ? event.event_date
        : date.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
    );
  }
  if (event.venue) parts.push(event.venue);
  if (event.city) parts.push(event.city);
  return parts.filter(Boolean).join(' · ');
}

export async function mountThrowdownEventDashboardScreen(
  root,
  {
    eventId,
    client = getSupabase(),
    signal,
    handlers = null,
    audienceLinks = null,
    listQueued,
    // Injectable so the preview harness and tests can feed the dashboard without a database.
    loadData = loadThrowdownDashboardData,
  } = {},
) {
  let loadFailedMessage = null;
  let loading = false;
  let focusAfterRender = null;
  let data = null;
  let isLive = null;

  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container td-event-dashboard-screen' });
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
    const container = el('section', { className: 'screen-container td-event-dashboard-screen' });
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
    try {
      const loaded = await loadData(eventId, {
        client,
        ...(listQueued ? { listQueued } : {}),
      });
      // "Live now" is advisory: a failed or slow check says "could not check", never stops the page.
      isLive = await raceTimeout(
        findActiveLiveEventId(loaded.event.org_id, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      )
        .then((activeId) => activeId === eventId)
        .catch(() => null);
      data = loaded;
      loadFailedMessage = null;
      // A Retry click does not go through the router's heading fallback, so focus the heading here.
      focusAfterRender = '#td-event-dashboard-heading';
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'Still loading. Check the connection, then press Retry.'
        : describeError(err);
    }
    loading = false;
    render();
  }

  // Puts this event on the audience displays. The publish is queued then flushed, and it never throws for a
  // network failure, so the answer is read back: only a live row naming this event is "shown".
  async function takeOver() {
    await raceTimeout(
      publishThrowdownLive({ event: data.event, takeOver: true }, handlers),
      TAKE_OVER_WAIT_MS,
    ).catch(() => {});
    const live = await raceTimeout(
      findActiveLiveEventId(data.event.org_id, client),
      DEFAULT_LOAD_TIMEOUT_MS,
    ).catch(() => null);
    return live === eventId ? { ok: true } : { ok: false, message: NOT_SENT_MESSAGE };
  }

  function linksRow(links) {
    const link = (text, href) =>
      el('a', { className: 'btn btn-outline tap-target', text, attrs: { href } });
    return el('nav', { className: 'td-event-links', attrs: { 'aria-label': 'Event screens' } }, [
      link('Matches', links.matches),
      link('Results', links.results),
    ]);
  }

  function render() {
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }
    const { event } = data;
    const phases = deriveThrowdownPhases({ ...data, eventId });
    const warnings = deriveThrowdownWarnings({ ...data, eventId });
    const links = throwdownLinks(eventId);

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container td-event-dashboard-screen' });

    const band = renderStatusBand(event);
    if (band) container.appendChild(band);

    container.appendChild(
      el('h1', {
        id: 'td-event-dashboard-heading',
        text: event.name,
        attrs: { tabindex: '-1' },
      }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta td-event-meta',
        text: metaLine(event, currentPhaseLabel(phases)),
      }),
    );

    const sheet = buildRunSheet(phases);
    const [nextCard, runSection] = [...sheet.children];
    container.appendChild(nextCard);

    const liveCard = buildLiveCard({
      isLive,
      surfaces: ['Projector', 'Phone'],
      urls: audienceLinks ?? {},
      takeOver: handlers ? takeOver : null,
    });

    // The match log is built from the bracket already loaded, on the click, never on page load.
    const records = [
      {
        label: 'Download the match log (CSV)',
        filename: matchLogFilename(event),
        build: () => matchLogCsv(data.bracket),
      },
    ];

    container.appendChild(
      el('div', { className: 'ok-dashboard' }, [
        el('div', { className: 'ok-dashboard-main' }, [
          runSection,
          buildHomepageListingCard(event, { client }),
        ]),
        el('div', { className: 'ok-dashboard-rail' }, [
          buildEventWarnings(warnings),
          liveCard.element,
          buildRecordsCard(records),
        ]),
      ]),
    );
    container.appendChild(linksRow(links));
    root.appendChild(container);

    if (focusAfterRender) {
      root.querySelector(focusAfterRender)?.focus();
      focusAfterRender = null;
    }
  }

  await attemptLoad();

  return {
    unmount() {
      // No timers or listeners outside the elements themselves: nothing to tear down.
    },
  };
}
