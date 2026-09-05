// Per-event dashboard (2026-08-29 app-wiring pass) — lets the organiser
// pick a stage before entering Heats/Standings, since an event can have
// multiple stages (prelims -> semis -> finals), each with its own
// generation/timing/scoring/standings flow.
//
// Lives in `formats/cup-taster/`, not `core/` — this screen reads
// `ct_stages` via setup.js, genuinely format-specific (a hypothetical
// future format might not have "stages" at all).
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listStagesForEvent, stageHasHeats } from './setup.js';
import { ordinalLabel } from './reportScreen.js';

// live_sessions enforces at most one active row per org (a partial unique
// index — see supabase/migrations/20260821220000_live_sessions_table.sql),
// flipped automatically by publish_session whenever ANY heat starts or is
// confirmed, in EITHER event (see liveSession.js's own top comment) — never
// by an organiser navigating between events. Found in a real production
// test (2026-09-05, user report): with two events in progress, the
// Splash/Projector/Phone surfaces kept showing whichever event most
// recently had heat activity, with nothing in the organiser UI indicating
// that, or which event was actually live right now. This read (via
// core/publish.js's findActiveLiveEventId — format-agnostic, moved there
// from here in review) and the badge below close that visibility gap — they
// don't change which event goes live, only surface the fact.

// "Not currently live" alone doesn't distinguish a brand-new event that
// hasn't started from one that WAS live and just got bumped by another
// event's heat activity — the exact confusion this whole feature exists to
// close (found in review, ui-accessibility-reviewer: the code already knows
// which other event is live, via findActiveLiveEventId's own result — this
// param just stops discarding it). Naming the other event tells the
// organiser exactly where to look, without them hunting through every event
// on the Events list to find which one shows "Live now."
function renderLiveStatusBadge(isLive, liveElsewhereEventName) {
  if (isLive) {
    return el('p', { className: 'event-live-status event-live-status-live' }, [
      el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'Live now — showing on Splash / Projector / Phone' }),
    ]);
  }
  if (liveElsewhereEventName) {
    return el('p', {
      className: 'event-live-status',
      text: `Not currently live — "${liveElsewhereEventName}" is live instead`,
    });
  }
  return el('p', {
    className: 'event-live-status',
    text: 'Not currently live',
  });
}

function stageStatusLine(stage) {
  const parts = [
    stage.cutoff == null ? 'Terminal — champion stage' : `Cutoff: top ${stage.cutoff}`,
  ];
  if (stage.status) parts.push(stage.status);
  return parts.join(' · ');
}

export function renderStageCard(eventId, stage, hasHeats) {
  const heatsLabel = hasHeats ? 'Heats' : 'Generate heats';
  return el('div', { className: 'card stage-card' }, [
    el('h3', { text: `${ordinalLabel(stage.ordinal)} — ${stage.kind}` }),
    el('p', { className: 'stage-meta', text: stageStatusLine(stage) }),
    el('div', { className: 'stage-card-actions' }, [
      el('a', {
        className: 'btn btn-outline tap-target',
        text: heatsLabel,
        attrs: { href: `#/events/${eventId}/stages/${stage.id}/heats` },
      }),
      el('a', {
        className: 'btn btn-outline tap-target',
        text: 'Standings',
        attrs: { href: `#/events/${eventId}/stages/${stage.id}/standings` },
      }),
    ]),
  ]);
}

export async function mountEventDashboardScreen(
  root,
  { eventId, orgId, client = getSupabase(), signal } = {},
) {
  let loadFailedMessage = null;
  let loading = false;
  let focusAfterRender = null;

  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container event-dashboard-screen' });
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
    const container = el('section', { className: 'screen-container event-dashboard-screen' });
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
    retryButton.addEventListener('click', () => {
      attemptLoad();
    });
    container.appendChild(retryButton);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  async function loadState() {
    const event = await findEvent(eventId, client);
    const stages = await listStagesForEvent(eventId, client);
    const hasHeatsFlags = await Promise.all(stages.map((stage) => stageHasHeats(stage.id, client)));
    const activeLiveEventId = await findActiveLiveEventId(orgId, client);
    const isLive = activeLiveEventId === eventId;
    // Only fetched when there's actually another event to name — the
    // common cases (this event IS live, or no event is live anywhere for
    // the org) need no extra read at all.
    const liveElsewhereEventName =
      !isLive && activeLiveEventId ? (await findEvent(activeLiveEventId, client)).name : null;
    return { event, stages, hasHeatsFlags, isLive, liveElsewhereEventName };
  }

  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    let data = null;
    try {
      data = await raceTimeout(loadState(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
      // Found in review (ui-accessibility-reviewer, Phase 6 cross-screen a11y
      // pass): the very first successful mount is already covered by
      // router.js's own generic "focus the new screen's own heading"
      // fallback (this screen focuses nothing itself during that load,
      // and document.activeElement reverts to <body> once the focused
      // loading feedback node is removed by root.innerHTML = ''). But a
      // Retry click after a load error does NOT go through the router
      // again — renderLoading() destroys the focused Retry button the
      // same way, with nothing taking its place, so without this a
      // successful Retry silently dropped focus to <body>. Same fix
      // rosterScreen.js/setupScreen.js already carry for the identical
      // gap (see their own attemptLoad() comments).
      focusAfterRender = '#event-dashboard-heading';
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render(data);
  }

  function render(data) {
    // A discarded-but-still-in-flight mount (attemptLoad, still resolving
    // after the router already navigated elsewhere) must never write to
    // `root` again — router.js aborts `signal` the instant a newer
    // navigation starts. See ROADMAP.md's "A real DOM-write race between
    // the router..." entry.
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container event-dashboard-screen' });

    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', {
        id: 'event-dashboard-heading',
        text: data.event.name,
        attrs: { tabindex: '-1' },
      }),
    );

    container.appendChild(renderLiveStatusBadge(data.isLive, data.liveElsewhereEventName));

    container.appendChild(
      el('div', { className: 'card event-dashboard-actions' }, [
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Setup',
          attrs: { href: `#/events/${eventId}/setup` },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Roster',
          attrs: { href: `#/events/${eventId}/roster` },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Report',
          attrs: { href: `#/events/${eventId}/report` },
        }),
      ]),
    );

    if (data.stages.length === 0) {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', { text: 'No stage plan yet.' }),
          el('a', {
            className: 'btn btn-primary tap-target',
            text: 'Build the stage plan',
            attrs: { href: `#/events/${eventId}/setup` },
          }),
        ]),
      );
    } else {
      container.appendChild(el('h2', { text: 'Stages' }));
      data.stages.forEach((stage, index) => {
        container.appendChild(renderStageCard(eventId, stage, data.hasHeatsFlags[index]));
      });
    }

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
