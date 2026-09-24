// "How this was scored" — a lazy-loading disclosure on the public Results archive that
// shows what changed after results were confirmed, from get_scoring_record()
// (supabase/migrations/20260924110000_get_scoring_record.sql via core/publicResults.js).
//
// Decisions it embodies (2026-09-24): corrections are public; the actor is only ever the role
// "Organiser"; NO individual scores are shown anywhere — exact raw data is released only on
// request through the organiser's dispute pack. Everything is built with textContent
// (core/dom.js `el`), never innerHTML: `reason` is organiser-typed free text and must never
// be interpreted as markup.
//
// Nothing is fetched until the reader opens the disclosure, and it is fetched once (a failed
// load offers a retry). Reasons are always attributed ("Reason given by the Organiser") and
// never presented as verified.
import { el } from '../core/dom.js';
import { getScoringRecord } from '../core/publicResults.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

const AREA_LABELS = {
  times: 'Times',
  results: 'Results',
  'heat status': 'Heat status',
  'stage settings': 'Stage settings',
  'stage placings': 'Stage placings',
  votes: 'Votes',
  bonuses: 'Bonuses',
  'match details': 'Match details',
  bracket: 'Bracket',
};

const WHEN_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const COUNT_FORMAT = new Intl.NumberFormat('en-GB');

function areaLabel(area) {
  return AREA_LABELS[area] ?? area;
}

function count(n) {
  return COUNT_FORMAT.format(Number(n) || 0);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : WHEN_FORMAT.format(date);
}

function paragraph(text, className = 'results-record-note') {
  return el('p', { className, text });
}

function buildCorrection(c) {
  const by = c.by || 'Organiser';
  const reason = typeof c.reason === 'string' ? c.reason.trim() : '';
  const where = [areaLabel(c.area), c.label].filter(Boolean).join(' · ');
  const when = formatWhen(c.at);
  const changes = Number(c.changes) || 0;
  const reasoned = Number(c.reasoned) || 0;

  let reasonText;
  if (reasoned === 0 || !reason) {
    reasonText = 'No reason given.';
  } else if (reasoned < changes) {
    reasonText = `Reason given by the ${by}: “${reason}” (given for ${reasoned} of ${changes} records)`;
  } else {
    reasonText = `Reason given by the ${by}: “${reason}”`;
  }

  return el(
    'li',
    { className: 'results-record-item' },
    [
      el('span', { className: 'results-record-where', text: where }),
      when ? el('span', { className: 'results-record-when tabular-nums', text: when }) : null,
      el('span', {
        className: 'results-record-what',
        text: `${plural(changes, 'record', 'records')} changed by the ${by}.`,
      }),
      el('span', { className: 'results-record-reason', text: reasonText }),
    ].filter(Boolean),
  );
}

function buildOverflow(record) {
  const areas = Object.entries(record.by_area ?? {}).map(([area, n]) =>
    el('li', { text: `${areaLabel(area)}: ${count(n)}` }),
  );
  return [
    paragraph(
      `${count(record.logged_changes)} changes were recorded after results were confirmed — too many to list here.`,
    ),
    areas.length ? el('ul', { className: 'results-record-areas' }, areas) : null,
    paragraph('Ask the organiser for the full record.'),
  ].filter(Boolean);
}

function buildRecordBody(record) {
  if (!record) {
    return [paragraph('A scoring record is not available for this event.')];
  }

  const nodes = [
    paragraph(
      'Every score on Seduh Score is logged when it is entered, and organisers cannot edit or delete this log from the app. ' +
        'This section shows what changed after results were confirmed. It does not show individual scores.',
    ),
  ];

  if (record.overflow) {
    nodes.push(...buildOverflow(record));
  } else if (!record.corrections?.length) {
    nodes.push(paragraph('No scores were changed after a heat, match or stage was confirmed.'));
  } else {
    nodes.push(
      el('h3', { className: 'results-record-heading', text: 'Changes after confirmation' }),
      el('ul', { className: 'results-record-list' }, record.corrections.map(buildCorrection)),
    );
    if (record.truncated) {
      nodes.push(
        paragraph(
          `Showing the first ${count(record.corrections.length)} of ${count(record.correction_count)} changes. Ask the organiser for the full record.`,
        ),
      );
    }
  }

  if (record.placings?.length) {
    nodes.push(
      el('h3', {
        className: 'results-record-heading',
        text: 'Placings decided by tiebreak or coin toss',
      }),
      el(
        'ul',
        { className: 'results-record-list' },
        record.placings.map((p) =>
          el('li', {
            className: 'results-record-item',
            text: `${p.stage}: ${p.count} by ${p.decided_by}`,
          }),
        ),
      ),
    );
  }

  if (record.rehearsal_flag_changes > 0) {
    const after = record.rehearsal_flag_changes_after_publish ?? 0;
    nodes.push(
      paragraph(
        `This event's rehearsal (test) status was changed ${plural(record.rehearsal_flag_changes, 'time', 'times')}` +
          (after > 0 ? `, ${after} of them after results were published.` : '.'),
      ),
    );
  }

  // "Re-opened" changes are listed with the others, so only say so when the list is complete.
  if (!record.overflow && !record.truncated) {
    nodes.push(
      paragraph('If a confirmed heat or match was re-opened, the re-opening is listed above.'),
    );
  }
  nodes.push(
    paragraph(
      'The exact scores and every individual change can be requested from the organiser: ask for the full record.',
    ),
  );
  return nodes;
}

// `title` (the event's name) makes each disclosure's accessible name unique when several sit on
// one page ("How “Jakarta Cup #09” was scored"); without it the label is the plain phrase.
export function buildScoringRecord(eventId, { client, title } = {}) {
  // One persistent, empty-at-first status region: a live region inserted already populated is
  // often not announced, so the text is set on an element that already exists.
  const status = el('p', {
    className: 'results-record-note',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const content = el('div', { className: 'results-record-content' });
  const body = el('div', { className: 'results-record-body' }, [status, content]);
  const summary = el('summary', {
    className: 'results-record-summary',
    text: title ? `How \u201c${title}\u201d was scored` : 'How this was scored',
  });
  const details = el('details', { className: 'results-record' }, [summary, body]);

  let state = 'idle';

  async function load() {
    state = 'loading';
    status.textContent = 'Loading the scoring record\u2026';
    let record;
    try {
      record = await raceTimeout(getScoringRecord(eventId, client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch (err) {
      state = 'error';
      status.textContent = err?.timedOut
        ? 'This is taking longer than expected.'
        : 'Something went wrong loading the scoring record.';
      const retry = el('button', {
        className: 'results-record-retry',
        text: 'Try again',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', () => {
        if (state === 'loading') return;
        retry.disabled = true;
        load();
      });
      content.replaceChildren(retry);
      return;
    }
    // Built in its own try, apart from the fetch: a rendering bug must not masquerade as a
    // network failure (a retry would just re-fetch and fail the same way). It gets its own
    // message with no retry, and is logged so it is seen.
    let nodes;
    try {
      nodes = buildRecordBody(record);
    } catch (err) {
      state = 'error-render';
      console.error('scoringRecord: could not render the scoring record', err);
      status.textContent = 'The scoring record could not be displayed.';
      content.replaceChildren();
      return;
    }
    state = 'loaded';
    // If keyboard focus is on the retry button that is about to be removed, hand it to the
    // summary rather than letting it fall to <body>.
    const hadFocus = content.contains(document.activeElement);
    status.textContent = '';
    content.replaceChildren(...nodes);
    if (hadFocus) summary.focus();
  }

  details.addEventListener('toggle', () => {
    if (details.open && (state === 'idle' || state === 'error')) load();
  });

  return details;
}
