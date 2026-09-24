// Public Results archive — a highlights/testimonial-style page showcasing
// published competition results. Reads real data via
// core/publicResults.js's listPublishedResults() (anon-safe), populated by
// an organiser's explicit "Publish to results archive" action
// (src/formats/cup-taster/reportScreen.js's "Public results" card). Still
// deliberately NOT linked from the landing page or public header nav, and
// still `noindex` (results/index.html) — per the plan agreed with the user,
// wiring that in is a separate, later decision once there's a real event's
// worth of published content to show, not part of this build.
import { el, withSrExpansion } from '../core/dom.js';
import { formatDuration, formatDurationLong } from '../core/duration.js';
import { revealOnScroll } from '../core/scrollReveal.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { listPublishedResults } from '../core/publicResults.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { buildScoringRecord } from './scoringRecord.js';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

// core/publicResults.js's own header comment treats `payload` as opaque —
// "any future format's organiser screen publishes the same way, and the
// public archive page reads every format's rows through the same anon-safe
// select." This page previously hardcoded the literal string "Cup Taster"
// in two places with no way to render anything else once a second format
// starts publishing too — found in review (module-boundary-checker).
// `event.format` is now threaded through the payload itself
// (resultsPublishing.js), so this page renders the right label per row
// instead of assuming one format forever. Known formats named the same way
// tourScreen.js's own copy already names them; an unrecognized value still
// renders something readable rather than a raw snake_case string or a
// crash.
const FORMAT_LABELS = {
  cup_taster: 'Cup Taster',
  throwdown: 'Throwdown',
  liga_seduh: 'Liga Seduh',
  // A real bug, not just a naming nit: btc_tables.sql's own events row and every BTC
  // fixture/seed in this codebase use format = 'btc' (BBTC is the Brunei-specific
  // INSTANCE of the format, not the format's own name — see src/formats/btc/CLAUDE.md).
  // This key used to read 'bbtc', which no real BTC event's format column has ever
  // matched — a published BTC result would have silently fallen through to the generic
  // snake_case-to-title-case fallback below ("Btc") instead of showing this label.
  btc: 'BTC',
};

function formatLabel(format) {
  // `payload` is unvalidated jsonb read back from an anon-readable table
  // (this migration's own comment: "never re-derives or validates the
  // payload's own internal shape") — a row published before `format` was
  // added to the payload, or any other malformed row, shouldn't crash the
  // whole page. Same "honest no data" fallback discipline this codebase
  // already applies elsewhere (analytics.js's own avgCorrect handling).
  if (!format) return 'Competition';
  return (
    FORMAT_LABELS[format] ??
    format.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

// Text stays mixed-case here — the visible all-caps rendering comes from
// CSS text-transform (.results-latest-meta, .results-table th, etc.), same
// convention as tourScreen.js/tour.css's own kickers/labels, not baked into
// the string.
function formatDate(isoDate) {
  return DATE_FORMAT.format(new Date(`${isoDate}T00:00:00`));
}

function formatShortDate(isoDate) {
  return SHORT_DATE_FORMAT.format(new Date(isoDate));
}

// The same visible-plus-hidden-expansion pairing this codebase already uses
// for every other ambiguous colon-separated numeral (core/duration.js's own
// header comment, viewerBody.js's precedent) — a competition "score" of
// "7/8" reads unambiguously, but this project treats that discipline as
// something every new surface inherits, not something re-litigated per page.
function scoreCell(correct, total) {
  return el('span', { className: 'results-score tabular-nums' }, [
    document.createTextNode(`${correct}/${total}`),
    el('span', { className: 'sr-only', text: `${correct} correct out of ${total}` }),
  ]);
}

function buildHero(stats) {
  return el(
    'section',
    { className: 'results-hero', attrs: { 'aria-labelledby': 'results-title' } },
    [
      el('p', { className: 'results-kicker', text: 'Community archive' }),
      el('h1', { id: 'results-title' }, [
        document.createTextNode('Every table tells a '),
        el('span', { text: 'story.' }),
      ]),
      el('p', {
        className: 'results-hero-intro',
        text:
          'A living record of competition days run with Seduh Score — celebrating the ' +
          'people, places, and performances behind the results.',
      }),
      el('div', { className: 'results-stats' }, [
        el('div', { className: 'results-stat' }, [
          el('b', { className: 'tabular-nums', text: String(stats.events) }),
          el('p', { text: 'published events' }),
        ]),
        el('div', { className: 'results-stat' }, [
          el('b', { className: 'tabular-nums', text: String(stats.results) }),
          el('p', { text: 'competitor results' }),
        ]),
        el('div', { className: 'results-stat' }, [
          el('b', { className: 'tabular-nums', text: String(stats.cities) }),
          el('p', { text: 'cities represented' }),
        ]),
      ]),
    ],
  );
}

function podiumRow(entry) {
  return el('li', { className: 'results-podium-row' }, [
    el('span', {
      className: 'results-podium-rank tabular-nums',
      text: String(entry.rank).padStart(2, '0'),
    }),
    el(
      'div',
      { className: 'results-podium-who' },
      [
        el('span', { className: 'results-podium-name', text: entry.name }),
        // `cafe` is optional — resultsPublishing.js's own payload falls back
        // to null when the podium finisher's own entry has none on record.
        // Filtered out here, not passed through as null — core/dom.js's
        // el() appends every array entry as-is, and appendChild(null)
        // throws.
        entry.cafe ? el('span', { className: 'results-podium-venue', text: entry.cafe }) : null,
      ].filter(Boolean),
    ),
    scoreCell(entry.correct, entry.total),
  ]);
}

function buildLatestResult(event, client) {
  const timeSpan = el('span', { className: 'tabular-nums' }, [
    ...withSrExpansion(
      formatDuration(event.winningTimeSecs),
      formatDurationLong(event.winningTimeSecs),
    ),
  ]);
  // eventDate is nullable (resultsPublishing.js's own payload falls back to
  // null when the event has none recorded) — formatDate() itself throws on
  // null (Intl.DateTimeFormat.format rejects an Invalid Date), so it's only
  // ever called once known non-null, matching the `event.city ?? '—'`
  // guard archiveRow already applies to its own optional field. Found in
  // review (code-reviewer): an earlier version called formatDate()
  // unconditionally here, crashing the whole page for any event published
  // without a date.
  const metaParts = [event.eventDate ? formatDate(event.eventDate) : null, event.city].filter(
    Boolean,
  );
  return el(
    'section',
    { className: 'results-latest', attrs: { 'aria-labelledby': 'latest-title' } },
    [
      el('div', { className: 'results-latest-heading' }, [
        el('p', { className: 'results-kicker', text: 'Latest result' }),
        el('h2', { id: 'latest-title', text: event.eventName }),
        el('span', { className: 'results-latest-meta', text: metaParts.join(' · ') }),
      ]),
      el('div', { className: 'results-latest-card' }, [
        el('div', { className: 'results-latest-summary' }, [
          el('p', { className: 'results-eyebrow', text: formatLabel(event.format) }),
          el('ul', { className: 'results-fact-list' }, [
            el('li', {}, [
              el('b', { className: 'tabular-nums', text: String(event.competitors) }),
              document.createTextNode(' competitors'),
            ]),
            el('li', {}, [
              el('b', { className: 'tabular-nums', text: String(event.rounds) }),
              document.createTextNode(' rounds'),
            ]),
            el('li', {}, [timeSpan, document.createTextNode(' winning time')]),
            el('li', {}, [
              document.createTextNode(`${formatShortDate(event.publishedAt)} result published`),
            ]),
          ]),
        ]),
        el('ol', { className: 'results-podium' }, event.podium.map(podiumRow)),
      ]),
      buildScoringRecord(event.eventId, { client, title: event.eventName }),
    ],
  );
}

function archiveRow(event) {
  // `payload` is caller-assembled, unvalidated jsonb (this migration's own
  // comment: "never re-derives or validates the payload's own internal
  // shape") — a row with no podium isn't something the schema rules out,
  // even though today's one writer (resultsPublishing.js) always includes
  // at least a champion. Found in review (code-reviewer): an earlier
  // version assumed `event.podium[0]` always exists.
  const winner = event.podium[0];
  if (!winner) return null;
  return el('tr', { className: 'results-archive-row' }, [
    el('td', { className: 'results-archive-date' }, [
      el('span', {
        className: 'tabular-nums',
        text: event.eventDate ? formatDate(event.eventDate) : '—',
      }),
    ]),
    el('td', {}, [
      el('span', { className: 'results-archive-name', text: event.eventName }),
      el('span', { className: 'results-archive-format', text: formatLabel(event.format) }),
    ]),
    el('td', { text: event.city ?? '—' }),
    el('td', { className: 'results-archive-winner', text: winner.name }),
    el('td', { className: 'results-archive-result' }, [scoreCell(winner.correct, winner.total)]),
  ]);
}

function buildArchive(events, client) {
  return el(
    'section',
    { className: 'results-archive', attrs: { 'aria-labelledby': 'archive-title' } },
    [
      el('div', { className: 'results-archive-heading' }, [
        el('p', { className: 'results-kicker', text: 'Recent competitions' }),
        el('h2', { id: 'archive-title', text: 'The archive.' }),
      ]),
      el(
        'div',
        {
          className: 'results-table-wrap',
          attrs: {
            tabindex: '0',
            role: 'region',
            'aria-label': 'Published competition results, scrollable table',
          },
        },
        [
          el('table', { className: 'results-table' }, [
            el('caption', { className: 'sr-only', text: 'Published competition results' }),
            el('thead', {}, [
              el('tr', {}, [
                el('th', { attrs: { scope: 'col' }, text: 'Date' }),
                el('th', { attrs: { scope: 'col' }, text: 'Competition' }),
                el('th', { attrs: { scope: 'col' }, text: 'Location' }),
                el('th', { attrs: { scope: 'col' }, text: 'Winner' }),
                el('th', { attrs: { scope: 'col' }, text: 'Result' }),
              ]),
            ]),
            el('tbody', {}, events.map(archiveRow).filter(Boolean)),
          ]),
        ],
      ),
      // Outside the (horizontally scrolling) table on purpose: this is prose and must reflow
      // at 360px, and a full-width row per event would also break the table's semantics.
      el(
        'div',
        { className: 'results-archive-records' },
        events
          .filter((event) => event.podium?.[0])
          .map((event) => buildScoringRecord(event.eventId, { client, title: event.eventName })),
      ),
    ],
  );
}

// A genuine empty state, distinct from a load error — this page has never
// had to represent "zero results published yet" before (the fake data was
// never empty), so nothing existing already covers it.
function buildEmptyState() {
  return el(
    'section',
    { className: 'results-hero', attrs: { 'aria-labelledby': 'results-title' } },
    [
      el('p', { className: 'results-kicker', text: 'Community archive' }),
      el('h1', { id: 'results-title' }, [
        document.createTextNode('Every table tells a '),
        el('span', { text: 'story.' }),
      ]),
      el('p', {
        className: 'results-hero-intro',
        text: 'No results published yet — check back soon.',
      }),
    ],
  );
}

function buildLoadingState() {
  return el('section', { className: 'results-hero' }, [
    el('div', {
      className: 'screen-feedback',
      text: 'Loading results…',
      attrs: { role: 'status', 'aria-live': 'polite' },
    }),
  ]);
}

function buildErrorState(message) {
  return el('section', { className: 'results-hero' }, [
    el('div', {
      className: 'screen-feedback',
      text: message,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    }),
  ]);
}

function toEventPayload(row) {
  return { ...row.payload, publishedAt: row.published_at, eventId: row.event_id };
}

export async function mountResultsScreen(root, { client } = {}) {
  function renderMain(...children) {
    root.replaceChildren(
      el('main', { className: 'results-page', attrs: { 'data-surface': 'stage' } }, [
        buildPublicHeader({ active: 'results' }),
        ...children,
        buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
      ]),
    );
  }

  renderMain(buildLoadingState());

  let rows;
  try {
    rows = await raceTimeout(listPublishedResults(client), DEFAULT_LOAD_TIMEOUT_MS);
  } catch (err) {
    renderMain(
      buildErrorState(
        err.timedOut
          ? 'This is taking longer than expected — check your connection and try again.'
          : 'Something went wrong loading results — please try again.',
      ),
    );
    return;
  }

  if (rows.length === 0) {
    renderMain(buildEmptyState());
    return;
  }

  const events = rows.map(toEventPayload);
  const latest = events[0];
  const stats = {
    events: events.length,
    results: events.reduce((sum, event) => sum + (event.competitors ?? 0), 0),
    cities: new Set(events.map((event) => event.city).filter(Boolean)).size,
  };

  const hero = buildHero(stats);
  const latestSection = buildLatestResult(latest, client);
  // events[0] is already the "Latest result" feature above — the archive
  // table below covers everything else, not a repeat of the same row.
  const archiveSection = events.length > 1 ? buildArchive(events.slice(1), client) : null;

  renderMain(hero, latestSection, ...(archiveSection ? [archiveSection] : []));

  revealOnScroll(latestSection);
  if (archiveSection) revealOnScroll(archiveSection);
}
