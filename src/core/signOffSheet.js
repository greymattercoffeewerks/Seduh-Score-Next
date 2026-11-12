// A print-designed sign-off page: the document a committee signs to say "these are the teams (or people) going
// through". Saved as a PDF with the browser's own Print → Save as PDF (no library, deliberately: see
// core/CLAUDE.md). Format-agnostic: a format supplies the words and the rows,
//   { title, eventName, dateText, event, bandWords, status: { kind: 'final' | 'draft', text },
//     qualifiers: { heading, columns: [{ key, header, numeric?, cell(row) → string | Node }], rows },
//     notes: { heading, items: [{ title, text }], emptyText },
//     others: { heading, items: [string] },
//     signatories: [{ role }],
//     generatedAt: Date }
// and this draws it. It decides nothing: it never works out who qualifies, it prints the rows it is given, and a
// `draft` status is printed unmistakably ("NOT FINAL") so an unsigned draft is never mistaken for the record.
//
// The pure part (`buildSignOff`) checks and normalises the spec; the DOM part (`renderSignOffSheet`) draws it.
// Styled in components.css (`.ok-signoff*`, with an `@media print` block: A4, the toolbar and the app chrome hidden).
import { el } from './dom.js';
import { renderStatusBand } from './statusBand.js';

const pad = (n) => String(n).padStart(2, '0');

// Pure. "2026-11-10 14:05" in the device's local time (a printed sheet is read where it was made).
export function formatGeneratedAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

// Pure. The spec, checked and given defaults: every list is a list, every text is trimmed text, `status.kind` is
// 'final' or 'draft' (anything else is 'draft': when in doubt the sheet says it is not final).
export function buildSignOff(spec = {}) {
  const qualifiers = spec.qualifiers ?? {};
  const notes = spec.notes ?? {};
  const others = spec.others ?? {};
  const statusKind = spec.status?.kind === 'final' ? 'final' : 'draft';
  return {
    title: cleanText(spec.title),
    eventName: cleanText(spec.eventName),
    dateText: cleanText(spec.dateText),
    event: spec.event ?? null,
    bandWords: spec.bandWords ?? {},
    status: { kind: statusKind, text: cleanText(spec.status?.text) },
    qualifiers: {
      heading: cleanText(qualifiers.heading),
      columns: Array.isArray(qualifiers.columns) ? qualifiers.columns : [],
      rows: Array.isArray(qualifiers.rows) ? qualifiers.rows : [],
    },
    notes: {
      heading: cleanText(notes.heading),
      items: (Array.isArray(notes.items) ? notes.items : []).filter(
        (item) => cleanText(item?.text) !== '',
      ),
      emptyText: cleanText(notes.emptyText),
    },
    others: {
      heading: cleanText(others.heading),
      items: (Array.isArray(others.items) ? others.items : []).filter(
        (item) => cleanText(item) !== '',
      ),
    },
    signatories: (Array.isArray(spec.signatories) ? spec.signatories : []).filter(
      (s) => cleanText(s?.role) !== '',
    ),
    generatedAt: formatGeneratedAt(spec.generatedAt),
  };
}

function cellNode(value) {
  if (value instanceof Node) return value;
  return document.createTextNode(value == null ? '' : String(value));
}

/**
 * DOM. The sheet, an `<article class="ok-signoff">`. The caller adds a toolbar outside it (class `no-print`).
 */
export function renderSignOffSheet(spec) {
  const model = buildSignOff(spec);
  const parts = [];

  const band = renderStatusBand(model.event, model.bandWords);
  if (band) parts.push(el('div', { className: 'ok-signoff-band' }, [band]));

  parts.push(
    el(
      'header',
      { className: 'ok-signoff-head' },
      [
        el('h2', { className: 'ok-signoff-title', text: model.title }),
        model.eventName ? el('p', { className: 'ok-signoff-event', text: model.eventName }) : null,
        model.dateText ? el('p', { className: 'ok-signoff-date', text: model.dateText }) : null,
      ].filter(Boolean),
    ),
  );

  // A draft always says so, even when the format gave no words for it.
  const statusText = model.status.text || (model.status.kind === 'draft' ? 'NOT FINAL' : '');
  if (statusText) {
    parts.push(
      el('p', {
        className: 'ok-signoff-status',
        text: statusText,
        attrs: { 'data-status': model.status.kind },
      }),
    );
  }

  const { columns, rows, heading } = model.qualifiers;
  parts.push(
    el(
      'section',
      { className: 'ok-signoff-section' },
      [
        heading ? el('h3', { className: 'ok-signoff-heading', text: heading }) : null,
        el('table', { className: 'ok-signoff-table' }, [
          el('thead', {}, [
            el(
              'tr',
              {},
              columns.map((col) =>
                el('th', {
                  text: col.header,
                  className: col.numeric ? 'ok-signoff-num' : undefined,
                  attrs: { scope: 'col' },
                }),
              ),
            ),
          ]),
          el(
            'tbody',
            {},
            rows.map((row) =>
              el(
                'tr',
                {},
                columns.map((col) =>
                  el('td', { className: col.numeric ? 'ok-signoff-num' : undefined }, [
                    cellNode(col.cell(row)),
                  ]),
                ),
              ),
            ),
          ),
        ]),
      ].filter(Boolean),
    ),
  );

  if (model.notes.heading) {
    const body =
      model.notes.items.length > 0
        ? el(
            'ul',
            { className: 'ok-signoff-notes' },
            model.notes.items.map((item) =>
              el(
                'li',
                {},
                [
                  item.title ? el('strong', { text: `${cleanText(item.title)}: ` }) : null,
                  document.createTextNode(cleanText(item.text)),
                ].filter(Boolean),
              ),
            ),
          )
        : el('p', { className: 'ok-signoff-none', text: model.notes.emptyText });
    parts.push(
      el('section', { className: 'ok-signoff-section ok-signoff-box' }, [
        el('h3', { className: 'ok-signoff-heading', text: model.notes.heading }),
        body,
      ]),
    );
  }

  if (model.others.heading && model.others.items.length > 0) {
    parts.push(
      el('section', { className: 'ok-signoff-section' }, [
        el('h3', { className: 'ok-signoff-heading', text: model.others.heading }),
        el(
          'ol',
          { className: 'ok-signoff-others' },
          model.others.items.map((item) => el('li', { text: cleanText(item) })),
        ),
      ]),
    );
  }

  if (model.signatories.length > 0) {
    parts.push(
      el(
        'section',
        { className: 'ok-signoff-signatures' },
        model.signatories.map((s) =>
          el('div', { className: 'ok-signoff-signature' }, [
            el('p', { className: 'ok-signoff-role', text: cleanText(s.role) }),
            el('p', { className: 'ok-signoff-line', text: 'Name' }),
            el('p', { className: 'ok-signoff-line', text: 'Signature and date' }),
          ]),
        ),
      ),
    );
  }

  if (model.generatedAt) {
    parts.push(
      el('p', {
        className: 'ok-signoff-generated',
        text: `Generated by Seduh Score on ${model.generatedAt}`,
      }),
    );
  }

  return el('article', { className: 'ok-signoff' }, parts);
}
