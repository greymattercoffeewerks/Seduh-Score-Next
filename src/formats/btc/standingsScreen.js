// BTC preliminary standings screen (Phase T-BTC.2, sub-step 4). Read-only: no
// writes, no actions — just the ranked table, live off btc_standings via
// standings.js. Bracket generation/advancement (sub-step 5) is a separate screen
// with its own state machine, matching Cup Taster's own split between its
// standings display and its own advancement actions (standingsScreen.js there does
// both because Cup Taster's tiebreak/coin-toss decisions happen at the same stage
// boundary the table is shown at; BTC's decision — who plays whom in the bracket —
// is a materially different, later step, not this screen with a button bolted on).
//
// Same loading/error/retry shape every other BTC screen uses (core/dom.js's
// withFocusPreservation, core/timeout.js's raceTimeout against a hung request,
// heading focus on a successful load).
import { getSupabase } from '../../core/supabaseClient.js';
import { el, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { fetchPreliminaryStandings } from './standings.js';

// Pure. A team that hasn't played yet (0 played) gets no status label at all —
// only useful information is shown, not a manufactured "0-0-0" badge.
function statusLabel(item) {
  return item.played === 0 ? 'Not yet played' : null;
}

export function renderStandingsTable(ranked) {
  const rows = ranked.map(({ item, position }) => {
    const label = statusLabel(item);
    return el(
      'tr',
      { className: 'standings-row', attrs: label ? { 'data-status': 'pending' } : {} },
      [
        el('td', {
          className: 'standings-position',
          text: String(position),
          attrs: { 'data-label': 'Pos' },
        }),
        el('td', {
          className: 'standings-name',
          text: item.teamName,
          attrs: { 'data-label': 'Team' },
        }),
        el('td', {
          className: 'standings-played',
          text: String(item.played),
          attrs: { 'data-label': 'Played' },
        }),
        el('td', {
          className: 'standings-wins',
          text: String(item.wins),
          attrs: { 'data-label': 'Wins' },
        }),
        el('td', {
          className: 'standings-points',
          text: String(item.totalPoints),
          attrs: { 'data-label': 'Points' },
        }),
        el('td', {
          className: 'standings-status',
          text: label ?? '',
          attrs: { 'data-label': 'Status' },
        }),
      ],
    );
  });

  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Pos', attrs: { scope: 'col' } }),
        el('th', { text: 'Team', attrs: { scope: 'col' } }),
        el('th', { text: 'Played', attrs: { scope: 'col' } }),
        el('th', { text: 'Wins', attrs: { scope: 'col' } }),
        el('th', { text: 'Points', attrs: { scope: 'col' } }),
        el('th', { text: 'Status', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

export async function mountStandingsScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  const state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    ranked: [],
  };

  async function loadPersisted() {
    const [event, ranked] = await Promise.all([
      findEvent(eventId, client),
      fetchPreliminaryStandings(eventId, client),
    ]);
    return { event, ranked };
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const loaded = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.event = loaded.event;
      state.ranked = loaded.ranked;
      state.loadFailedMessage = null;
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  function renderLoading() {
    root.appendChild(
      el('section', { className: 'screen-container btc-standings-screen' }, [
        el('h1', { text: 'Standings' }),
        el('div', {
          className: 'screen-feedback',
          text: 'Loading standings…',
          attrs: { role: 'status', 'aria-live': 'polite' },
        }),
      ]),
    );
  }

  function renderLoadError() {
    const feedback = el('div', {
      className: 'screen-feedback',
      text: state.loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => attemptLoad());
    root.appendChild(
      el('section', { className: 'screen-container btc-standings-screen' }, [
        el('h1', { text: 'Standings' }),
        feedback,
        retryButton,
      ]),
    );
    feedback.focus();
  }

  function renderLoaded() {
    const container = el('section', { className: 'screen-container btc-standings-screen' });

    if (state.event?.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: 'Standings', attrs: { tabindex: '-1' } }));

    if (state.ranked.length === 0) {
      container.appendChild(
        el('p', {
          className: 'stage-meta',
          text: 'No teams registered yet — add teams in Setup before standings can show anything.',
        }),
      );
    } else {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            className: 'stage-meta',
            text: 'Preliminary round. Points include the fastest-team and confirmed-match bonuses; the bracket step decides seeding once every match is confirmed.',
          }),
          renderStandingsTable(state.ranked),
        ]),
      );
    }

    root.appendChild(container);
    container.querySelector('h1')?.focus();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      if (state.loading) {
        renderLoading();
        return undefined;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        return true;
      }
      renderLoaded();
      return true;
    });
  }

  await attemptLoad();

  return {
    unmount() {
      // Nothing live to tear down — a single load, no subscriptions or timers.
    },
  };
}
