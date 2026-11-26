// "Needs you": the event's warnings as Petrol's `.queue` list: a severity edge, a title, one action per row, most
// urgent first. Same data and ordering as `eventWarnings.js` (it reuses `normaliseWarnings`), drawn for the console
// at night and day. An attention item carries a `.status` mark with its word, because the edge is colour only.
// Format-agnostic: the format decides what is worth a warning.
import { el } from './dom.js';
import { kitId } from './kitLink.js';
import { kitState, statusMark } from './vocabulary.js';
import { SEVERITY_LABELS, normaliseWarnings } from './eventWarnings.js';

/**
 * @param {object[]} warnings `[{ id, severity, text, href, actionLabel }]`, as for `buildEventWarnings`
 * @param {{ heading?: string, emptyText?: string }} [options]
 * @returns {HTMLElement}
 */
export function buildNeedsYou(
  warnings,
  { heading = 'Needs you', emptyText = 'Nothing needs you right now.' } = {},
) {
  const list = normaliseWarnings(warnings);
  const headingId = kitId('needs-you-heading');
  const head = el(
    'div',
    { className: 'needs-you-head' },
    [
      el('h2', { id: headingId, className: 'ok-card-heading', text: heading }),
      list.length > 0 ? el('span', { className: 'eyebrow', text: 'Most urgent first' }) : null,
    ].filter(Boolean),
  );
  const body =
    list.length === 0
      ? el('p', { className: 'empty', text: emptyText, attrs: { 'data-kind': 'done' } })
      : el(
          'ul',
          { className: 'queue' },
          list.map((warning) => {
            const urgent = warning.severity !== 'info';
            const title = el(
              'p',
              { className: 'queue-title' },
              [
                urgent
                  ? statusMark(kitState(warning.severity), SEVERITY_LABELS[warning.severity])
                  : null,
                urgent ? document.createTextNode(' ') : null,
                document.createTextNode(warning.text),
              ].filter((part) => part !== null),
            );
            const row = [el('div', {}, [title])];
            if (warning.href) {
              row.push(
                el('a', {
                  className: 'btn btn-outline tap-target',
                  text: warning.actionLabel,
                  attrs: { href: warning.href },
                }),
              );
            }
            return el('li', { attrs: urgent ? { 'data-severity': 'attention' } : {} }, row);
          }),
        );
  return el(
    'section',
    { className: 'ok-card needs-you', attrs: { 'aria-labelledby': headingId } },
    [head, body],
  );
}
