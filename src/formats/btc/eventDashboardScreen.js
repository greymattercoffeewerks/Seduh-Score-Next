// BTC per-event dashboard: the organiser's run sheet (Organiser UX spec U1 and U4). One next-step card on top,
// then a card per phase (Setup, Round 1, Round 2, The cut, Knockout, Podium) with a right-hand rail holding what
// needs attention, whether the event is live and the records to download. Built on the format-agnostic organiser
// kit in `core/`; what a phase IS and when it is done is `runSheet.js`, derived on every load, never stored.
// The four screen links stay as a secondary row at the bottom.
//
// Lives here, not core/: the phases, the routes and the live publish are BTC's. A new format brings its own
// derivation and reuses the same cards.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { buildHomepageListingCard } from '../../core/homepageListingCard.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import { getDisputePack } from '../../core/disputePack.js';
import { buildRunSheet } from '../../core/runSheet.js';
import { buildEventWarnings } from '../../core/eventWarnings.js';
import { buildLiveCard } from '../../core/liveCard.js';
import { buildRecordsCard } from '../../core/recordsCard.js';
import { renderStatusBand } from '../../core/statusBand.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadDashboardData } from './dashboardData.js';
import { btcLinks, currentPhaseLabel, deriveBtcPhases, deriveBtcWarnings } from './runSheet.js';
import { publishBtcLive } from './liveSession.js';
import { loadScoresTables } from './scoresExportData.js';
import { scoresFilename } from './scoresExport.js';

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

// A file name made from the event's name: letters, digits and hyphens.
function recordFilename(event) {
  const slug = String(event.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'btc-event'}-record.json`;
}

// The files this event offers: the exact record (the existing get_dispute_pack) and the two scores CSVs for the
// shadow comparison (docs/specs/BTC-SCORES-CSV-PROPOSAL.md). Each build() reads on the click, never on page load.
function recordsFor(event, client) {
  const now = new Date();
  return [
    {
      label: 'Download the record (JSON)',
      filename: recordFilename(event),
      build: () => getDisputePack(event.org_id, event.id, client),
    },
    {
      label: 'Download matches (CSV)',
      filename: scoresFilename(event, 'matches', now),
      build: async () => (await loadScoresTables(event.id, client)).matches,
    },
    {
      label: 'Download cups (CSV)',
      filename: scoresFilename(event, 'cups', now),
      build: async () => (await loadScoresTables(event.id, client)).cups,
    },
  ];
}

export async function mountBtcEventDashboardScreen(
  root,
  {
    eventId,
    client = getSupabase(),
    signal,
    handlers = null,
    audienceLinks = null,
    listQueued,
  } = {},
) {
  let loadFailedMessage = null;
  let loading = false;
  let focusAfterRender = null;
  let data = null;
  let isLive = null;

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
    try {
      const loaded = await loadDashboardData(eventId, {
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
      // Same Retry-only focus gap Cup Taster's own eventDashboardScreen.js closed: the very first successful
      // mount is covered by router.js's heading fallback, but a Retry click does not go through the router.
      focusAfterRender = '#btc-event-dashboard-heading';
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
    // Bounded below the kit's own 10 s wait, so a stalled flush still gets the read-back and the honest message
    // ("saved on this device") instead of the kit's generic failure while the publish may yet go through.
    await raceTimeout(
      publishBtcLive({ event: data.event, takeOver: true }, handlers),
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
    return el('nav', { className: 'btc-event-links', attrs: { 'aria-label': 'Event screens' } }, [
      link('Setup', links.setup),
      link('Matches', links.matches),
      link('Standings', links.standings),
      link('Bracket', links.bracket),
    ]);
  }

  function render() {
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }
    const { event } = data;
    const phases = deriveBtcPhases({ ...data, eventId });
    const warnings = deriveBtcWarnings({ ...data, eventId });
    const links = btcLinks(eventId);

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container btc-event-dashboard-screen' });

    // `is_shadow` is not in the database yet, so findEvent does not return it and no beta band shows. The
    // flag is read off the row as it comes (core/statusBand.js), so the band appears the day the column is
    // selected, with no change here.
    const band = renderStatusBand(event);
    if (band) container.appendChild(band);

    container.appendChild(
      el('h1', {
        id: 'btc-event-dashboard-heading',
        text: event.name,
        attrs: { tabindex: '-1' },
      }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta btc-event-meta',
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

    container.appendChild(
      el('div', { className: 'ok-dashboard' }, [
        el('div', { className: 'ok-dashboard-main' }, [
          runSection,
          buildHomepageListingCard(event, { client }),
        ]),
        el('div', { className: 'ok-dashboard-rail' }, [
          buildEventWarnings(warnings),
          liveCard.element,
          buildRecordsCard(recordsFor(event, client)),
        ]),
      ]),
    );
    container.appendChild(linksRow(links));
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
      // No timers or listeners outside the elements themselves: nothing to tear down.
    },
  };
}
