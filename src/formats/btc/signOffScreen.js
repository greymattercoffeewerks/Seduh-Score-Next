// The BTC sign-off page (Organiser UX S4, spec Q9): the committee's sheet for the top 8, saved as a PDF with the
// browser's own Print → Save as PDF (no library; the Cup Taster report does the same). The page is
// core/signOffSheet.js fed by signOff.js; this file only loads the data and puts a toolbar (hidden when printing)
// above it. A failed advisory read is not hidden: the sheet says NOT FINAL when it could not check.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { renderSignOffSheet } from '../../core/signOffSheet.js';
import { listTeams } from './teams.js';
import { fetchBracket } from './bracket.js';
import { fetchSeedingOrder } from './seeding.js';
import { loadCutExtras, lockedSeedsFromBracket } from './cutData.js';
import { buildBtcSignOff } from './signOff.js';
import { btcLinks } from './runSheet.js';

// The page title is the default file name of "Save as PDF", so it names the event for the duration of a print.
let titleBeforePrint = null;

export async function mountSignOffScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  const state = { loading: true, loadFailedMessage: null, data: null };
  let printTitle = null;
  const onBeforePrint = () => {
    if (!printTitle || titleBeforePrint !== null) return;
    titleBeforePrint = document.title;
    document.title = printTitle;
  };
  const onAfterPrint = () => {
    if (titleBeforePrint === null) return;
    document.title = titleBeforePrint;
    titleBeforePrint = null;
  };
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);

  async function loadPersisted() {
    const [event, teams, bracket, seedingRows, extras] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      fetchBracket(eventId, client),
      // Unlike Standings, a missing seed-order view fails the whole page: a sheet that cannot read the order must
      // not be printed (a front end ahead of its migration shows the retry card, never an empty sheet).
      fetchSeedingOrder(eventId, client),
      loadCutExtras(eventId, client),
    ]);
    return {
      event,
      teams,
      bracketExists: bracket.length > 0,
      lockedSeeds: lockedSeedsFromBracket(bracket),
      seedingRows,
      extras,
    };
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const loaded = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.data = loaded;
      printTitle = `${loaded.event.is_test ? 'TEST — ' : ''}Top 8 sign-off — ${loaded.event.name}`;
      state.loadFailedMessage = null;
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'Still loading. Check the connection, then press Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container btc-signoff-screen' });
      if (state.loading) {
        container.append(
          el('h1', { text: 'Sign-off sheet' }),
          el('div', {
            className: 'screen-feedback',
            text: 'Loading the sign-off sheet…',
            attrs: { role: 'status', 'aria-live': 'polite' },
          }),
        );
        root.appendChild(container);
        return undefined;
      }
      if (state.loadFailedMessage) {
        const feedback = el('div', {
          className: 'screen-feedback',
          text: state.loadFailedMessage,
          attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
        });
        feedback.dataset.tone = 'error';
        const retry = el('button', {
          className: 'btn btn-outline tap-target',
          text: 'Retry',
          attrs: { type: 'button' },
        });
        retry.addEventListener('click', () => attemptLoad());
        container.append(el('h1', { text: 'Sign-off sheet' }), feedback, retry);
        root.appendChild(container);
        feedback.focus();
        return true;
      }

      const links = btcLinks(eventId);
      const feedback = el('p', {
        className: 'stage-meta',
        attrs: { role: 'status', 'aria-live': 'polite' },
      });
      const printButton = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Print / Save as PDF',
        attrs: { type: 'button' },
      });
      printButton.addEventListener('click', () => {
        try {
          window.print();
        } catch (err) {
          feedback.textContent = describeError(err);
        }
      });
      container.appendChild(
        el('div', { className: 'card no-print ok-no-print btc-signoff-toolbar' }, [
          el('h1', { text: 'Sign-off sheet', attrs: { tabindex: '-1' } }),
          el('p', {
            className: 'stage-meta',
            text: 'Choose Print, then Save as PDF in the print window. Each signatory signs and dates the printed copy.',
          }),
          el('div', { className: 'btc-bracket-form-actions' }, [
            printButton,
            el('a', {
              className: 'btn btn-outline tap-target',
              text: 'Back to Standings',
              attrs: { href: links.standings },
            }),
          ]),
          feedback,
        ]),
      );
      const { data } = state;
      container.appendChild(
        renderSignOffSheet(
          buildBtcSignOff({
            event: data.event,
            teams: data.teams,
            seedingRows: data.seedingRows,
            matches: data.extras.matches,
            scores: data.extras.scores,
            times: data.extras.times,
            bracketExists: data.bracketExists,
            lockedSeeds: data.lockedSeeds,
          }),
        ),
      );
      root.appendChild(container);
      container.querySelector('h1')?.focus();
      return true;
    });
  }

  await attemptLoad();

  return {
    unmount() {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
      onAfterPrint();
    },
  };
}
