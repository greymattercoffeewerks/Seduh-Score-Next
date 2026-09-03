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
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listStagesForEvent, stageHasHeats } from './setup.js';
import { ordinalLabel } from './reportScreen.js';

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
  { eventId, client = getSupabase(), signal } = {},
) {
  let loadFailedMessage = null;
  let loading = false;

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
    return { event, stages, hasHeatsFlags };
  }

  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    let data = null;
    try {
      data = await raceTimeout(loadState(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
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

    container.appendChild(el('h1', { text: data.event.name }));

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
  }

  await attemptLoad();

  return {
    unmount() {
      // No live state, no listeners, no timers — nothing to tear down.
    },
  };
}
