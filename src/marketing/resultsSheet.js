// Printable results sheet for one published event — the page behind "Results sheet" on the public
// Results archive (/results/?sheet=<event id>). Built ONLY from the published row
// (core/publicResults.js's anon-safe read of `public_results`), never from live tables, so it is
// sanitised by construction: whatever the organiser chose to publish is all there is to print.
// "Save as PDF" is the browser's own print dialog against the paper layout in results.css, the same
// no-PDF-library approach as the organiser's report (core/export.js's header comment).
//
// `payload` is unvalidated jsonb read back from an anon-readable table, so every field is rebuilt
// from known keys and checked for type before it is shown — a row published by a future version, a
// hand-edited row or a malformed one degrades to a missing cell, never to a crash or to unexpected
// content on a page people print and put up. Everything is built with textContent (core/dom.js `el`),
// never innerHTML.
import { el, withSrExpansion } from '../core/dom.js';
import { formatDuration, formatDurationLong } from '../core/duration.js';
import { listPublishedResults } from '../core/publicResults.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { formatDate, formatLabel, scoreCell } from './resultsScreen.js';

const PUBLISHED_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// `formatDate` (the archive's own) throws on a value that is not a real date, so the check comes
// first: a malformed `eventDate` is a missing date on the sheet, not a page that fails to build.
function formatEventDate(value) {
  const text = cleanText(value);
  if (!text || Number.isNaN(new Date(`${text}T00:00:00`).getTime())) return null;
  return formatDate(text);
}

function cleanStandingsEntry(entry) {
  const name = cleanText(entry?.name);
  if (!name) return null;
  return {
    place: finiteNumber(entry.place),
    name,
    cafe: cleanText(entry.cafe) || null,
    round: cleanText(entry.round) || null,
    correct: finiteNumber(entry.correct),
    total: finiteNumber(entry.total),
    timeSecs: finiteNumber(entry.timeSecs),
  };
}

function cleanPodiumEntry(entry) {
  const name = cleanText(entry?.name);
  if (!name) return null;
  return {
    place: finiteNumber(entry.rank),
    name,
    cafe: cleanText(entry.cafe) || null,
    round: null,
    correct: finiteNumber(entry.correct),
    total: finiteNumber(entry.total),
    timeSecs: null,
  };
}

// Which table the sheet prints: the full standings when the organiser published them (the payload
// carries `standings` only in that case), otherwise the podium.
export function sheetContentFor(event) {
  if (Array.isArray(event.standings) && event.standings.length > 0) {
    return { kind: 'standings', rows: event.standings.map(cleanStandingsEntry).filter(Boolean) };
  }
  return {
    kind: 'podium',
    rows: (Array.isArray(event.podium) ? event.podium : []).map(cleanPodiumEntry).filter(Boolean),
  };
}

function textCell(text) {
  return el('td', { text: text ?? '—' });
}

function scoreOrDash(row) {
  return row.correct != null && row.total != null
    ? el('td', { className: 'results-sheet-score' }, [scoreCell(row.correct, row.total)])
    : textCell('—');
}

function timeOrDash(row) {
  return row.timeSecs != null
    ? el('td', { className: 'results-sheet-time tabular-nums' }, [
        ...withSrExpansion(formatDuration(row.timeSecs), formatDurationLong(row.timeSecs)),
      ])
    : textCell('—');
}

// Score and time come before the round reached: on a phone the table scrolls sideways, and those two
// are what the sheet is for.
function buildTable({ kind, rows }, title) {
  const standings = kind === 'standings';
  const columns = standings
    ? ['Place', 'Competitor', 'Café', 'Score', 'Time', 'Reached']
    : ['Place', 'Competitor', 'Café', 'Score'];
  return el('table', { className: 'results-sheet-table' }, [
    el('caption', {
      className: 'sr-only',
      text: `${standings ? 'Full standings' : 'Podium'} — ${title}`,
    }),
    el('thead', {}, [
      el(
        'tr',
        {},
        columns.map((label) => el('th', { attrs: { scope: 'col' }, text: label })),
      ),
    ]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('td', { className: 'results-sheet-place tabular-nums', text: row.place ?? '—' }),
          el('td', { className: 'results-sheet-name', text: row.name }),
          textCell(row.cafe),
          scoreOrDash(row),
          ...(standings ? [timeOrDash(row), textCell(row.round)] : []),
        ]),
      ),
    ),
  ]);
}

// The "scroll sideways" cue is shown only while the table really does overflow its region — a long
// list on a phone, or a long name at any width — and is hidden when it fits (a podium on a phone, a
// wide screen). Measured, not guessed from the screen width, so it is never wrong in either direction.
export function syncScrollHint(sheet) {
  const wrap = sheet.querySelector('.results-sheet-table-wrap');
  const hint = sheet.querySelector('.results-sheet-scroll-hint');
  if (!wrap || !hint) return;
  if (wrap.scrollWidth > wrap.clientWidth + 1) hint.setAttribute('data-active', 'true');
  else hint.removeAttribute('data-active');
}

function formatPublished(publishedAt) {
  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : PUBLISHED_FORMAT.format(date);
}

export function buildResultsSheet(event) {
  const content = sheetContentFor(event);
  const title = cleanText(event.eventName) || 'Results';
  const meta = [
    formatEventDate(event.eventDate),
    cleanText(event.venue) || null,
    cleanText(event.city) || null,
  ].filter(Boolean);

  const facts = [];
  const competitors = finiteNumber(event.competitors);
  const rounds = finiteNumber(event.rounds);
  const winningTime = finiteNumber(event.winningTimeSecs);
  if (competitors != null) {
    facts.push(
      el('li', {}, [
        el('b', { text: String(competitors) }),
        document.createTextNode(' competitors'),
      ]),
    );
  }
  if (rounds != null) {
    facts.push(
      el('li', {}, [el('b', { text: String(rounds) }), document.createTextNode(' rounds')]),
    );
  }
  if (winningTime != null) {
    facts.push(
      el('li', {}, [
        el('b', { className: 'tabular-nums' }, [
          ...withSrExpansion(formatDuration(winningTime), formatDurationLong(winningTime)),
        ]),
        document.createTextNode(' winning time'),
      ]),
    );
  }

  const published = formatPublished(event.publishedAt);
  return el(
    'article',
    { className: 'results-sheet-paper' },
    [
      el('p', {
        className: 'results-sheet-kicker',
        text: `Seduh Score · ${formatLabel(event.format)} results`,
      }),
      el('h1', { className: 'results-sheet-title', text: title, attrs: { tabindex: '-1' } }),
      meta.length > 0 ? el('p', { className: 'results-sheet-meta', text: meta.join(' · ') }) : null,
      facts.length > 0 ? el('ul', { className: 'results-sheet-facts' }, facts) : null,
      content.rows.length > 0
        ? el(
            'div',
            {
              className: 'results-sheet-table-wrap',
              attrs: {
                tabindex: '0',
                role: 'region',
                'aria-label': `${title} — ${
                  content.kind === 'standings' ? 'full standings' : 'podium'
                }, scrollable table`,
              },
            },
            [buildTable(content, title)],
          )
        : el('p', {
            className: 'results-sheet-note',
            text: 'No placings were published for this event.',
          }),
      // Sighted phone users only: the region above is already announced as scrollable to a screen reader.
      content.rows.length > 0
        ? el('p', {
            className: 'results-sheet-scroll-hint',
            text: 'Scroll sideways to see every column →',
            attrs: { 'aria-hidden': 'true' },
          })
        : null,
      // The field entered and the rows printed can differ (someone withdrew, or never scored): say so,
      // so the gap is explained on the page rather than looking like a missing result.
      content.kind === 'standings' && finiteNumber(event.notListed) > 0
        ? el('p', {
            className: 'results-sheet-note',
            text:
              `${event.notListed} ${event.notListed === 1 ? 'competitor is' : 'competitors are'} not ` +
              'listed — they withdrew or did not take part.',
          })
        : null,
      el('p', {
        className: 'results-sheet-note',
        text:
          'Placings follow how far each competitor advanced and their result in the last round they ' +
          'reached. Score is correct answers out of the sets scored in that round' +
          (content.kind === 'standings' ? '; time is their total time in it.' : '.'),
      }),
      el('p', {
        className: 'results-sheet-note results-sheet-published',
        text:
          `${published ? `Published ${published} · ` : ''}seduhscore.com/results — how results are ` +
          'recorded and corrected is described on that page.',
      }),
    ].filter(Boolean),
  );
}

// The loading, error and not-available states each get a heading (so the page is never headless) and
// return it, so the caller can move focus there once the state is on screen.
function statusSection(message, { onRetry = null } = {}) {
  const heading = el('h1', {
    className: 'results-sheet-status-title',
    text: 'Results sheet',
    attrs: { tabindex: '-1' },
  });
  const section = el('section', { className: 'results-sheet-status' }, [
    heading,
    el('p', { text: message }),
    ...(onRetry
      ? [
          (() => {
            const retry = el('button', {
              className: 'results-sheet-button',
              text: 'Try again',
              attrs: { type: 'button' },
            });
            retry.addEventListener('click', onRetry);
            return retry;
          })(),
        ]
      : []),
    el('p', {}, [
      el('a', {
        className: 'results-sheet-back',
        text: '← All results',
        attrs: { href: '/results/' },
      }),
    ]),
  ]);
  return { nodes: [section], focus: heading };
}

export async function mountResultsSheet(root, { eventId, client } = {}) {
  let currentSheet = null;
  // The header, footer and live region are built once and stay put: only the content between them is
  // swapped as the page moves from loading to a sheet or an error. A live region that is itself
  // replaced is not reliably announced; this one keeps its place and only its text changes.
  const content = el('div', { className: 'results-sheet-content' });
  const announcer = el('p', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  root.replaceChildren(
    el(
      'main',
      { className: 'results-page results-sheet-page', attrs: { 'data-surface': 'stage' } },
      [
        buildPublicHeader({ active: 'results' }),
        announcer,
        content,
        buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
      ],
    ),
  );
  // Until a sheet is shown the page keeps a neutral title; the printed header and the default file name
  // for "Save as PDF" both come from the page title, so a sheet names the page after its event.
  document.title = 'Results sheet — Seduh Score';

  function show({ nodes, focus = null }, announcement) {
    content.replaceChildren(...nodes);
    announcer.textContent = announcement;
    focus?.focus();
  }

  // `refocus` is for a retry: the button that was pressed is replaced by the loading state, so focus
  // goes to its heading instead of falling back to the page.
  async function load(refocus = false) {
    const loadingHeading = el('h1', {
      className: 'results-sheet-status-title',
      text: 'Results sheet',
      attrs: { tabindex: '-1' },
    });
    show(
      {
        nodes: [
          el('section', { className: 'results-sheet-status' }, [
            loadingHeading,
            el('p', { text: 'Loading the results sheet…' }),
          ]),
        ],
        focus: refocus ? loadingHeading : null,
      },
      'Loading the results sheet…',
    );

    let rows;
    try {
      rows = await raceTimeout(listPublishedResults(client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch (err) {
      const message = err.timedOut
        ? 'This is taking longer than expected — check your connection and try again.'
        : 'Something went wrong loading the results sheet — please try again.';
      show(statusSection(message, { onRetry: () => load(true) }), message);
      return;
    }

    const row = rows.find((candidate) => candidate.event_id === eventId);
    if (!row) {
      const message = 'This results sheet is not available — it may have been unpublished.';
      show(statusSection(message), message);
      return;
    }

    const event = { ...row.payload, publishedAt: row.published_at, eventId: row.event_id };
    const sheet = buildResultsSheet(event);
    document.title = `${cleanText(event.eventName) || 'Results'} — Results`;

    const printButton = el('button', {
      className: 'results-sheet-button',
      text: 'Print / Save as PDF',
      attrs: { type: 'button' },
    });
    printButton.addEventListener('click', () => window.print());

    show(
      {
        nodes: [
          el('section', { className: 'results-sheet-toolbar' }, [
            el('a', {
              className: 'results-sheet-back',
              text: '← All results',
              attrs: { href: '/results/' },
            }),
            el('p', {
              className: 'results-sheet-help',
              text:
                'This is the printable results sheet. Use the button to open your print window, then ' +
                'choose “Save as PDF” as the destination. On an iPhone or iPad, pinch out on the print ' +
                'preview, then tap Share to save it as a PDF.',
            }),
            printButton,
          ]),
          sheet,
        ],
        focus: sheet.querySelector('h1'),
      },
      `Results sheet for ${cleanText(event.eventName) || 'this event'} is ready.`,
    );
    currentSheet = sheet;
    syncScrollHint(sheet);
    // Web fonts change the table's width once they load.
    document.fonts?.ready?.then(() => currentSheet === sheet && syncScrollHint(sheet));
  }

  // One listener for the life of the page: the cue follows whichever sheet is showing.
  window.addEventListener('resize', () => currentSheet && syncScrollHint(currentSheet));

  await load();
}
