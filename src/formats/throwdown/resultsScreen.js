// Throwdown's results page (organiser console, printable): the podium, then the full match log round by round, every
// result in words (a vote result with its count, a walkover as "Walkover", a bye as "Bye"). Derived from the same rows
// and the same bracket module as every other surface, so it can never disagree with the console or the projector.
// "Print" uses the browser's own print dialog (Save as PDF is the browser's); a formatted report and the public
// archive are TD.2, not here.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadThrowdown } from './data.js';
import { describeThrowdownError, resultLine, matchTitle } from './words.js';

export function buildResultsView(event, bracket) {
  return el(
    'section',
    { className: 'screen-container td-results' },
    [
      event.is_test
        ? el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' })
        : null,
      el('h1', {
        id: 'td-results-heading',
        text: `${event.name} — results`,
        attrs: { tabindex: '-1' },
      }),
      bracket.champion
        ? el(
            'section',
            { className: 'card td-card', attrs: { 'aria-labelledby': 'td-podium-h' } },
            [
              el('h2', { id: 'td-podium-h', text: 'Podium' }),
              el(
                'ol',
                { className: 'td-podium' },
                [
                  el('li', { text: `Champion: ${bracket.champion}` }),
                  bracket.runnerUp ? el('li', { text: `Runner-up: ${bracket.runnerUp}` }) : null,
                  bracket.thirdPlace
                    ? el('li', { text: `3rd place: ${bracket.thirdPlace}` })
                    : null,
                ].filter(Boolean),
              ),
            ],
          )
        : el('p', { className: 'td-note', text: 'The event is not finished yet. Results so far:' }),
      ...bracket.rounds.map((round) =>
        el('section', { className: 'card td-card', attrs: { 'aria-label': round.label } }, [
          el('h2', { text: round.label }),
          el('table', { className: 'td-log' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Match', attrs: { scope: 'col' } }),
                el('th', { text: 'Winner', attrs: { scope: 'col' } }),
                el('th', { text: 'Result', attrs: { scope: 'col' } }),
              ]),
            ]),
            el(
              'tbody',
              {},
              round.matches.map((m) =>
                el('tr', {}, [
                  el('td', { text: matchTitle(m) }),
                  el('td', { text: m.sides.find((s) => s.winner)?.name ?? '—' }),
                  el('td', { text: resultLine(m) ?? 'Not decided' }),
                ]),
              ),
            ),
          ]),
        ]),
      ),
    ].filter(Boolean),
  );
}

export async function mountThrowdownResultsScreen(
  root,
  { eventId, client = getSupabase(), signal } = {},
) {
  async function attempt() {
    root.innerHTML = '';
    root.appendChild(
      el('div', {
        className: 'screen-feedback',
        text: 'Loading results…',
        attrs: { role: 'status' },
      }),
    );
    try {
      const [event, data] = await raceTimeout(
        Promise.all([findEvent(eventId, client), loadThrowdown(eventId, client)]),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      if (signal?.aborted) return;
      root.innerHTML = '';
      const view = buildResultsView(event, data.bracket);
      const print = el('button', {
        className: 'btn btn-outline tap-target td-no-print',
        text: 'Print or save as PDF',
        attrs: { type: 'button' },
      });
      print.addEventListener('click', () => window.print());
      view.append(
        print,
        el('a', {
          className: 'btn btn-outline tap-target td-no-print',
          text: 'Back to the event',
          attrs: { href: `#/events/${eventId}` },
        }),
      );
      root.appendChild(view);
    } catch (err) {
      if (signal?.aborted) return;
      root.innerHTML = '';
      const message = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeThrowdownError(err);
      const fb = el('div', {
        className: 'screen-feedback',
        text: message,
        attrs: { role: 'status' },
      });
      fb.dataset.tone = 'error';
      const retry = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Retry',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', attempt);
      root.append(fb, retry);
    }
  }
  await attempt();
  return { unmount() {} };
}
