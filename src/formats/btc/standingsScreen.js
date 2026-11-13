// BTC standings screen. Since Organiser UX stage S4 (2026-11) it holds "The cut" (owner decision Q8): the
// preliminary standings as a table with a line after 8th, the card that puts teams level across it in order (the
// existing seedingCard.js and its RPC, moved here from the bracket screen), and the one button that locks the top 8
// and generates the bracket (the existing generate_btc_bracket path). The sign-off sheet for the committee is its own
// page (signOffScreen.js), opened from here.
//
// Scoring discipline: this screen never decides who qualifies. The order and the ties come from the database's
// `btc_seeding_order` and the recorded tie-breaks (seeding.js, cutData.js); the per-round points and the finish
// times are shown beside that order and never reorder it.
//
// Same loading/error/retry/toast/focus shape every other BTC screen uses (core/dom.js's withFocusPreservation,
// core/timeout.js's raceTimeout against a hung request, heading focus on a successful load).
import { getSupabase } from '../../core/supabaseClient.js';
import { el, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { confirmInPlace } from '../../core/feedback.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { renderStatusBand } from '../../core/statusBand.js';
import { renderCutLine } from '../../core/cutLine.js';
import { listTeams } from './teams.js';
import { generateBracket, fetchBracket } from './bracket.js';
import { publishBtcLive } from './liveSession.js';
import { renderSeedingTies } from './seedingCard.js';
import { createSeedingController } from './seedingController.js';
import { isCutoffTieRefusal, CUTOFF_TIE_MESSAGE } from './seeding.js';
import {
  NO_VALUE,
  cutQualifiers,
  deriveCutRows,
  LOCKED_DIFFERS_NOTE,
  lockedDiffers,
  lockedSeedsFromBracket,
  isLevelRows,
  isSettledRows,
  loadCutExtras,
  lockState,
  pointsCell,
  rankCutRows,
  timeCells,
} from './cutData.js';
import { KNOCKOUT_PLACES, teamLabelNode } from './words.js';
import { btcLinks } from './runSheet.js';

// The table's columns (spec U3): place, team (flag and code), R1 points, R2 points, total, R1 time, R2 time, and the
// time sum, a display aid.
export function cutColumns() {
  return [
    {
      key: 'place',
      header: 'Place',
      cell: (item, row) => (item.seed === null ? NO_VALUE : String(row.position)),
    },
    {
      key: 'team',
      header: 'Team',
      cell: (item) => {
        const label = teamLabelNode(item.team);
        if (item.seed !== null) return label;
        return el('span', {}, [
          label,
          el('span', { className: 'ok-cut-note', text: 'No result yet' }),
        ]);
      },
    },
    { key: 'r1', header: 'R1 pts', numeric: true, cell: (item) => pointsCell(item.round1) },
    { key: 'r2', header: 'R2 pts', numeric: true, cell: (item) => pointsCell(item.round2) },
    {
      key: 'total',
      header: 'Total',
      numeric: true,
      className: 'ok-cut-total',
      cell: (item) => String(item.totalPoints),
    },
    { key: 't1', header: 'R1 time', numeric: true, cell: (item) => timeCells(item).round1 },
    { key: 't2', header: 'R2 time', numeric: true, cell: (item) => timeCells(item).round2 },
    { key: 'tsum', header: 'Time sum', numeric: true, cell: (item) => timeCells(item).sum },
  ];
}

export async function mountStandingsScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  const state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    bracketExists: false,
    // { teamId → seed } from the bracket's quarterfinal slots, or null before there is a bracket
    lockedSeeds: null,
    extras: { matches: null, scores: null, times: null },
    collapsed: true,
    generating: false,
    toastMessage: null,
    refreshNoteMessage: null,
    announcement: '',
    // null | 'heading' | 'toast' | 'seeding-form' | 'seeding-error' | 'seeding-button'
    pendingFocus: null,
  };
  let toastTimer;
  const announcer = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const refreshNoteMessage = el('span', { className: 'btc-bracket-refresh-note-message' });
  const refreshButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Reload',
    attrs: { type: 'button', 'data-focus-key': 'standings-refresh-reload' },
  });
  const refreshNote = el(
    'div',
    { className: 'btc-bracket-refresh-note', attrs: { role: 'status', 'aria-live': 'polite' } },
    [refreshNoteMessage, refreshButton],
  );
  refreshButton.addEventListener('click', () => {
    if (!state.loading) attemptLoad();
  });
  root.append(announcer, refreshNote);

  const teamName = (id) => state.teams.find((t) => t.id === id)?.name ?? 'Unknown team';

  // `focus: false` leaves keyboard focus where it is (a message about a control the person is still on; it is also
  // said through the live region). A long message stays up long enough to read.
  function showToast(message, { focus = true } = {}) {
    state.toastMessage = message;
    if (focus) state.pendingFocus = 'toast';
    else state.announcement = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        // A toast that holds keyboard focus must not leave it on a node that is about to go: move it to the heading.
        if (document.activeElement?.getAttribute?.('data-focus-key') === 'standings-toast') {
          state.pendingFocus = 'heading';
        }
        state.toastMessage = null;
        render();
      },
      Math.max(1500, message.length * 60),
    );
  }

  const seeding = createSeedingController({
    eventId,
    client,
    getOrgId: () => state.event.org_id,
    teamName,
    render: () => render(),
    showToast,
    announce: (message) => {
      state.announcement = message;
    },
    setPendingFocus: (key) => {
      state.pendingFocus = key;
    },
    setRefreshNote: (message) => {
      state.refreshNoteMessage = message;
    },
    clearRefreshNote: () => {
      state.refreshNoteMessage = null;
    },
    isOtherBusy: () => state.generating,
    refreshBracketExists: async () => {
      const entries = await fetchBracket(eventId, client);
      state.bracketExists = entries.length > 0;
      state.lockedSeeds = lockedSeedsFromBracket(entries);
      return state.bracketExists;
    },
  });

  async function loadPersisted() {
    const [event, teams, bracket, seedingRead, extras] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      fetchBracket(eventId, client),
      seeding.read(),
      loadCutExtras(eventId, client),
    ]);
    return { event, teams, bracket, seedingRead, extras };
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const loaded = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.event = loaded.event;
      state.teams = loaded.teams;
      state.bracketExists = loaded.bracket.length > 0;
      state.lockedSeeds = lockedSeedsFromBracket(loaded.bracket);
      state.extras = loaded.extras;
      seeding.load(loaded.seedingRead);
      state.loadFailedMessage = null;
      state.refreshNoteMessage = null;
      state.pendingFocus = 'heading';
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'Still loading. Check the connection, then press Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  // The audience display follows every change the room should see (liveSession.js). Best-effort: a failed or
  // offline publish stays queued and changes nothing about the action that triggered it.
  function requestLivePublish() {
    publishBtcLive({ event: state.event, takeOver: false }, handlers).catch((error) => {
      console.error('btc: live-view publish was refused', error);
    });
  }

  const currentLock = () =>
    lockState({
      matches: state.extras.matches,
      seedingRows: seeding.state.rows,
      readFailed: seeding.state.readFailed,
      formOpen: Boolean(seeding.state.groupKey),
      bracketExists: state.bracketExists,
    });

  // The confirmation names the eight, in the database's seed order; the dialog is the last chance to stop.
  function lockNames() {
    const rows = cutQualifiers(
      deriveCutRows({ teams: state.teams, seedingRows: seeding.state.rows }),
    );
    return rows.map((row, i) => `${i + 1}. ${row.team.name}`).join('\n');
  }

  async function handleLock(trigger) {
    if (state.generating || seeding.state.busy) return;
    const lock = currentLock();
    // The card says why: say it here too, in words, rather than let the database refuse with a message the
    // organiser cannot act on.
    if (!lock.allowed) {
      showToast(lock.reason, { focus: false });
      render();
      return;
    }
    const confirmed = await confirmInPlace(trigger, {
      title: `Lock the top ${KNOCKOUT_PLACES} and generate the bracket?`,
      body: `This cannot be undone.\n\n${lockNames()}`,
      confirmLabel: 'Lock and generate',
      isTest: Boolean(state.event?.is_test),
    });
    if (!confirmed) return;
    state.generating = true;
    render();
    try {
      await generateBracket(state.event.org_id, eventId, client);
      // The bracket exists from here on, whether or not the re-read below succeeds.
      state.bracketExists = true;
      requestLivePublish();
      try {
        state.lockedSeeds = lockedSeedsFromBracket(await fetchBracket(eventId, client));
      } catch {
        // The bracket exists either way; the next load reads it.
      }
      seeding.reset();
      showToast('Bracket generated.');
    } catch (err) {
      // The refusal may mean the order held here is out of date (another device re-confirmed a match):
      // re-read it, so the screen shows what is true, and a form open on a group that no longer exists closes.
      seeding.apply(await seeding.read());
      showToast(isCutoffTieRefusal(err) ? CUTOFF_TIE_MESSAGE : describeError(err));
    }
    state.generating = false;
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

  function renderLockCard() {
    const links = btcLinks(eventId);
    const signOff = el('a', {
      className: 'btn btn-outline tap-target',
      text: 'Sign-off sheet (PDF)',
      attrs: { href: links.signOff },
    });
    if (state.bracketExists) {
      return el('div', { className: 'card ok-cut-lock' }, [
        el('h2', { text: 'The top 8 are locked' }),
        el('p', {
          className: 'stage-meta',
          text: 'The top 8 are locked. The seeds are fixed.',
        }),
        el('div', { className: 'btc-bracket-form-actions' }, [
          el('a', {
            className: 'btn btn-primary tap-target',
            text: 'Open the bracket',
            attrs: { href: links.bracket },
          }),
          signOff,
        ]),
      ]);
    }
    const lock = currentLock();
    const button = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.generating ? 'Generating…' : 'Lock the top 8 and generate the bracket',
      attrs: {
        type: 'button',
        'data-focus-key': 'lock-top-8',
        'aria-describedby': 'btc-lock-reason',
      },
    });
    setBusyDisabled(button, state.generating || seeding.state.busy);
    // Marked, not disabled (focus stays and the reason stays reachable); pressing it says why in words.
    if (!lock.allowed) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => handleLock(button));
    return el('div', { className: 'card ok-cut-lock' }, [
      el('h2', { text: 'Lock the top 8' }),
      el('p', {
        id: 'btc-lock-reason',
        className: 'stage-meta',
        text: lock.allowed
          ? 'Both rounds are confirmed and no team is level across the cut line. Locking generates the bracket from these seeds and cannot be undone.'
          : lock.reason,
      }),
      el('div', { className: 'btc-bracket-form-actions' }, [button, signOff]),
    ]);
  }

  function renderCut() {
    const seeded = seeding.state;
    if (seeded.readFailed && seeded.rows.length === 0) {
      const retry = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Check again',
        attrs: { type: 'button', 'data-focus-key': 'seeding-retry' },
      });
      setBusyDisabled(retry, seeded.busy);
      retry.addEventListener('click', () => seeding.cardProps().handlers.onRetry());
      return el('div', { className: 'card' }, [
        el('h2', { text: 'The cut' }),
        el('p', {
          className: 'form-field-error',
          text: 'We could not read the standings just now, so the cut cannot be shown.',
          attrs: { role: 'status' },
        }),
        retry,
      ]);
    }
    const rows = deriveCutRows({
      teams: state.teams,
      seedingRows: seeded.rows,
      matches: state.extras.matches,
      scores: state.extras.scores,
      times: state.extras.times,
      lockedSeeds: state.lockedSeeds,
    });
    const tieCard = state.bracketExists ? null : renderSeedingTies(seeding.cardProps());
    const cut = renderCutLine({
      ranked: rankCutRows(rows),
      qualifyCount: KNOCKOUT_PLACES,
      isLevel: isLevelRows,
      isSettled: isSettledRows,
      columns: cutColumns(),
      rowKey: (item) => item.teamId,
      caption: 'The cut: teams in order, with a line after 8th place',
      lineText: `Cut line · top ${KNOCKOUT_PLACES} go through`,
      collapseBelow: state.collapsed,
      onToggle: (collapsed) => {
        state.collapsed = collapsed;
        render();
      },
      rail: [tieCard, renderLockCard()],
    });
    const notes = [
      'In seed order: points, then the order you set for level teams. Round points and finish times are for reference.',
      state.extras.times === null
        ? 'The finish times could not be loaded just now, so none are shown.'
        : 'Time sum shows only when both rounds have one time in minutes:seconds. It is a guide: you decide level teams.',
    ];
    if (lockedDiffers(seeded.rows, state.lockedSeeds)) notes.push(LOCKED_DIFFERS_NOTE);
    if (rows.some((row) => !row.roundsAddUp)) {
      notes.push(
        'For some teams the round points do not add up to the total (a later round, or a match not complete). The total is the one used.',
      );
    }
    return el('div', { className: 'card ok-cut-card' }, [
      el('h2', { text: 'The cut' }),
      ...notes.map((text) => el('p', { className: 'stage-meta', text })),
      cut,
    ]);
  }

  function renderLoaded() {
    const container = el('section', {
      className: 'screen-container btc-standings-screen',
      attrs: { 'data-density': 'compact' },
    });
    const band = renderStatusBand(state.event);
    if (band) container.appendChild(band);
    container.appendChild(el('h1', { text: 'Standings', attrs: { tabindex: '-1' } }));

    if (state.teams.length === 0) {
      container.appendChild(
        el('p', {
          className: 'stage-meta',
          text: 'No teams yet. Add teams in Setup first.',
        }),
      );
    } else {
      container.appendChild(renderCut());
    }

    let toastNode = null;
    if (state.toastMessage) {
      toastNode = el('div', {
        className: 'screen-feedback',
        text: state.toastMessage,
        attrs: {
          role: 'status',
          'aria-live': 'polite',
          tabindex: '-1',
          'data-focus-key': 'standings-toast',
        },
      });
      container.appendChild(toastNode);
    }

    root.appendChild(container);
    announcer.textContent = state.announcement;
    state.announcement = '';

    const key = state.pendingFocus;
    state.pendingFocus = null;
    const byKey = (value) => container.querySelector(`[data-focus-key="${value}"]`);
    const groupKey = seeding.state.groupKey;
    let target = null;
    if (key === 'heading') target = container.querySelector('h1');
    else if (key === 'toast') target = toastNode;
    else if (key === 'seeding-form') target = byKey(`seeding-form-heading-${groupKey}`);
    else if (key === 'seeding-error') target = byKey(`seeding-error-${groupKey}`);
    else if (key === 'seeding-button')
      target = byKey(`seeding-open-${seeding.state.lastClosedKey}`);
    if (target) {
      target.focus();
      return true;
    }
    return undefined;
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      // The screen-reader announcer and the actionable refresh note stay attached: a node removed and put back
      // with its text already set is not reliably announced.
      for (const node of [...root.childNodes]) {
        if (node !== announcer && node !== refreshNote) node.remove();
      }
      refreshNoteMessage.textContent = state.refreshNoteMessage ?? '';
      refreshNote.hidden = !state.refreshNoteMessage;
      refreshButton.hidden = !state.refreshNoteMessage;
      setBusyDisabled(refreshButton, state.loading);

      if (state.loading) {
        renderLoading();
        return undefined;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        return true;
      }
      return renderLoaded();
    });
  }

  await attemptLoad();

  return {
    unmount() {
      clearTimeout(toastTimer);
      state.refreshNoteMessage = null;
      refreshNoteMessage.textContent = '';
      refreshNote.hidden = true;
      refreshButton.hidden = true;
    },
  };
}
