// Throwdown's results page (organiser console, printable): the podium, then the full match log round by round, every
// result in words (a vote result with its count, a walkover as "Walkover", a bye as "Bye"). Derived from the same rows
// and the same bracket module as every other surface, so it can never disagree with the console or the projector.
// "Print" uses the browser's own print dialog (Save as PDF is the browser's); a formatted report is TD.2. The Public
// results card (publishCard.js) publishes the event to the public archive, which is also what feeds Seduh ID.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadThrowdown } from './data.js';
import { describeThrowdownError, resultLine, matchTitle } from './words.js';
import { scoringContext, scoredView, auditRule } from './scoredMatch.js';
import { buildAudit } from './scoreAudit.js';
import { buildPublishCard } from './publishCard.js';

// The printable score breakdown of every decided scored match (console only; empty when the event has no scored rounds).
function auditSections(bracket, ctx) {
  if (!ctx) return [];
  return bracket.rounds.flatMap((round) =>
    round.matches
      .filter((m) => m.resultKind === 'scores')
      .map((m) => {
        const view = scoredView(ctx, m);
        if (!view || !auditRule(view)) return null;
        return el(
          'section',
          { className: 'card td-card', attrs: { 'aria-label': `Scores: ${matchTitle(m)}` } },
          [
            el('h2', { text: `${round.label} scores: ${matchTitle(m)}` }),
            buildAudit(view, m.sides.find((s) => s.winner)?.name),
          ],
        );
      })
      .filter(Boolean),
  );
}

// Every undone result (td_match_reopens), oldest first, in words: which match, whose win, how it had been decided, when
// it was undone. The round may since have been removed and made again, so it is named by its stored position and phase.
const KIND_WORDS = { votes: 'by votes', walkover: 'by walkover', scores: 'by scoresheets' };
export function correctionLines(reopens, bracket, entries) {
  return reopens.map((r) => {
    const round = bracket.rounds.find(
      (x) => x.position === r.round_position && x.phase === r.round_phase,
    );
    const where = `${round?.label ?? (r.round_phase === 'third_place' ? '3rd place match' : `Round ${r.round_position}`)}, match ${r.match_position}`;
    const winner =
      entries.find((e) => e.id === r.previous_winner_entry_id)?.display_name ?? 'the winner';
    const at = new Date(r.reopened_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const removed =
      r.rounds_removed > 0
        ? ` ${r.rounds_removed === 1 ? 'The round after it was' : `The ${r.rounds_removed} rounds after it were`} removed and made again.`
        : '';
    return `${where}: ${winner}’s win ${KIND_WORDS[r.previous_result_kind] ?? ''} was undone at ${at}.${removed}`;
  });
}

function correctionsSection(lines) {
  if (!lines.length) return null;
  return el(
    'section',
    { className: 'card td-card', attrs: { 'aria-labelledby': 'td-corrections-h' } },
    [
      el('h2', { id: 'td-corrections-h', text: 'Corrections' }),
      el(
        'ul',
        { className: 'td-corrections' },
        lines.map((text) => el('li', { text })),
      ),
    ],
  );
}

// scoring: scoringContext(data) of the event, or null when the scoresheet module is off. corrections: correctionLines(...).
export function buildResultsView(event, bracket, scoring = null, corrections = []) {
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
      correctionsSection(corrections),
    ]
      .filter(Boolean)
      .concat(auditSections(bracket, scoring)),
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
      const view = buildResultsView(
        event,
        data.bracket,
        scoringContext(data),
        correctionLines(data.reopens ?? [], data.bracket, data.entries),
      );
      const print = el('button', {
        className: 'btn btn-outline tap-target td-no-print',
        text: 'Print or save as PDF',
        attrs: { type: 'button' },
      });
      print.addEventListener('click', () => window.print());
      // The public archive: publish, update or unpublish (never offered for a test event; the card says why).
      const { card } = buildPublishCard({ event, bracket: data.bracket, client, signal });
      view.append(
        card,
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
