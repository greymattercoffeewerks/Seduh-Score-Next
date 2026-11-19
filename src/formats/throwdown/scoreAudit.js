// The read-only audit of a decided scored match: per judge seat, per cup, per line, with the totals. Console and the
// printable results page only; no public surface imports this file (a test pins that).
import { el } from '../../core/dom.js';
import { auditRows, auditRule } from './scoredMatch.js';
import { ruleWords } from './words.js';

function judgeTable(view, competitor, judge) {
  const cupNumbers = Array.from({ length: view.cups }, (_, i) => i + 1);
  const caption = `Judge ${judge.seat}: ${competitor.name}`;
  if (!judge.sheet) {
    return el('p', { className: 'td-note', text: `${caption}: no sheet.` });
  }
  return el('table', { className: 'td-log td-audit-table' }, [
    el('caption', { text: `${caption} (total ${judge.total})` }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Line', attrs: { scope: 'col' } }),
        ...cupNumbers.map((c) => el('th', { text: `Cup ${c}`, attrs: { scope: 'col' } })),
      ]),
    ]),
    el('tbody', {}, [
      ...view.lines.map((line) =>
        el('tr', {}, [
          el('th', { text: `${line.label} (of ${line.max})`, attrs: { scope: 'row' } }),
          ...cupNumbers.map((c) => el('td', { text: String(judge.sheet[c]?.[line.key] ?? '') })),
        ]),
      ),
      el('tr', {}, [
        el('th', { text: 'Cup total', attrs: { scope: 'row' } }),
        ...cupNumbers.map((c) => el('td', { text: String(judge.cupTotals[c] ?? '') })),
      ]),
    ]),
  ]);
}

// view: scoredView() of a decided scored match. Returns a node; `className` lets the caller style the wrapper.
export function buildAudit(view, winnerName) {
  const rule = auditRule(view);
  const rows = auditRows(view);
  const summary = [
    winnerName ? `${winnerName} won on ${ruleWords(rule) || 'the sheets'}.` : null,
    `Totals: ${rows.map((r) => `${r.name} ${r.total}`).join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return el('div', { className: 'td-audit' }, [
    el('p', { className: 'td-note', text: summary }),
    ...rows.flatMap((r) => r.judges.map((j) => judgeTable(view, r, j))),
  ]);
}
