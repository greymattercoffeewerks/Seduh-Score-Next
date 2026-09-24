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
  'heat status': 'Heat status (for example re-opened)',
  'stage settings': 'Stage settings',
  'stage placings': 'Stage placings',
  votes: 'Votes',
  bonuses: 'Bonuses',
  'match details': 'Match details (for example re-opened)',
  bracket: 'Bracket',
};

const WHEN_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function areaLabel(area) {
  return AREA_LABELS[area] ?? area;
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
  const where = [areaLabel(c.area), c.label].filter(Boolean).join(' · ');
  const when = formatWhen(c.at);
  const changes = Number(c.changes) || 0;
  const reasoned = Number(c.reasoned) || 0;

  let reasonText;
  if (reasoned === 0 || !c.reason) {
    reasonText = 'No reason given.';
  } else if (reasoned < changes) {
    reasonText = `Reason given by the ${c.by}: “${c.reason}” (given for ${reasoned} of ${changes} records)`;
  } else {
    reasonText = `Reason given by the ${c.by}: “${c.reason}”`;
  }

  return el(
    'li',
    { className: 'results-record-item' },
    [
      el('span', { className: 'results-record-where', text: where }),
      when ? el('span', { className: 'results-record-when tabular-nums', text: when }) : null,
      el('span', {
        className: 'results-record-what',
        text: `${plural(changes, 'record', 'records')} changed by the ${c.by}.`,
      }),
      el('span', { className: 'results-record-reason', text: reasonText }),
    ].filter(Boolean),
  );
}

function buildOverflow(record) {
  const areas = Object.entries(record.by_area ?? {}).map(([area, n]) =>
    el('li', { text: `${areaLabel(area)}: ${n}` }),
  );
  return [
    paragraph(
      `${record.logged_changes} changes were recorded after results were confirmed — too many to list here.`,
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
      'Every score on Seduh Score is logged the moment it is entered, and the log cannot be edited or deleted. ' +
        'This section shows what changed after results were confirmed. It does not show individual scores.',
    ),
  ];

  if (record.overflow) {
    nodes.push(...buildOverflow(record));
  } else if (!record.corrections?.length) {
    nodes.push(paragraph('No scores were changed after a heat, match or stage was confirmed.'));
  } else {
    nodes.push(
      el('h4', { className: 'results-record-heading', text: 'Changes after confirmation' }),
      el('ul', { className: 'results-record-list' }, record.corrections.map(buildCorrection)),
    );
    if (record.truncated) {
      nodes.push(
        paragraph(
          `Showing the first ${record.corrections.length} of ${record.correction_count} changes. Ask the organiser for the full record.`,
        ),
      );
    }
  }

  if (record.placings?.length) {
    nodes.push(
      el('h4', {
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

  nodes.push(
    paragraph(
      'If a confirmed heat or match was re-opened, the re-opening is listed above. The exact scores and every ' +
        'individual change are available on request: contact the organiser and ask for the full record.',
    ),
  );
  return nodes;
}

export function buildScoringRecord(eventId, { client } = {}) {
  const body = el('div', { className: 'results-record-body' });
  const details = el('details', { className: 'results-record' }, [
    el('summary', { className: 'results-record-summary', text: 'How this was scored' }),
    body,
  ]);

  let state = 'idle';

  function showStatus(text) {
    body.replaceChildren(
      el('p', {
        className: 'results-record-note',
        text,
        attrs: { role: 'status', 'aria-live': 'polite' },
      }),
    );
  }

  async function load() {
    state = 'loading';
    showStatus('Loading the scoring record…');
    try {
      const record = await raceTimeout(getScoringRecord(eventId, client), DEFAULT_LOAD_TIMEOUT_MS);
      state = 'loaded';
      body.replaceChildren(...buildRecordBody(record));
    } catch (err) {
      state = 'error';
      const retry = el('button', {
        className: 'results-record-retry',
        text: 'Try again',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', () => {
        if (state !== 'loading') load();
      });
      body.replaceChildren(
        el('p', {
          className: 'results-record-note',
          text: err?.timedOut
            ? 'This is taking longer than expected.'
            : 'Something went wrong loading the scoring record.',
          attrs: { role: 'status', 'aria-live': 'polite' },
        }),
        retry,
      );
    }
  }

  details.addEventListener('toggle', () => {
    if (details.open && (state === 'idle' || state === 'error')) load();
  });

  return details;
}
