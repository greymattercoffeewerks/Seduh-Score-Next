// The words and shapes every venue display shares, extracted from Cup Taster's projector screens when BTC became
// the second format to need them (the project's second-use rule): a kicker over a big title, a standings page
// (a heading with its range, then ranked rows), and the champion block. Format-agnostic: a format gives it
// text, rows and column widths; nothing here knows what is being ranked. Styled in core/stageVocabulary.css,
// sized with `--stage-fit` like every screen inside core/stageDisplay.css's frame.
//
// Meaning is carried by words, never by colour alone: a tie or an advancing place is written in the row's own
// suffix, and the champion is labelled "Champion".
import { el } from './dom.js';

export function stageKicker(text) {
  return el('p', { className: 'stage-kicker', text });
}

export function stageTitle(text) {
  return el('h2', { className: 'stage-title', text });
}

// A line of secondary text under a title ("Results appear here as soon as the judges confirm.").
export function stageSupport(text) {
  return el('p', { className: 'stage-support', text });
}

// The heading of a standings page: the title, and on the right where this page sits in the whole list
// ("9 to 16 of 17"), from core/pageRotator.js's pageRange.
export function renderStandingsHead(title, rangeText) {
  return el('div', { className: 'stage-standings-head' }, [
    stageTitle(title),
    el('span', { className: 'stage-range', text: rangeText }),
  ]);
}

// The text on the right of a page heading: "5 cuppers", "9 to 16 of 17". `noun` names what is ranked
// ("cuppers", "teams"); a page of one says how many there are in all.
export function standingsRangeText(range, pageCount, noun) {
  if (pageCount === 1) return `${range.total} ${noun}`;
  return range.first === range.last
    ? `${range.first} of ${range.total}`
    : `${range.first} to ${range.last} of ${range.total}`;
}

// A ranked table. `rows` are { position, name, suffix?, cells } where `cells` holds one entry per extra
// column: a string, or an array of nodes (a time with its spoken form). `columns` are { className?, width? },
// one per cell, for the format's own hook class and the column's width (a CSS length, so it scales with the
// screen; set on the cell, so the format, not the stylesheet, decides). A cell is a string, an array of nodes,
// or anything else (a number), which is written as its text; none of it is ever markup. The name is cut with
// an ellipsis and the suffix (" (tied)", " (advancing)") never is.
export function renderStandingsTable(rows, columns = []) {
  const body = rows.map((row) =>
    el('tr', { className: 'stage-standing-row' }, [
      el('td', { className: 'stage-standing-pos', text: String(row.position) }),
      el('td', { className: 'stage-standing-name' }, [
        el(
          'div',
          { className: 'stage-name-row' },
          [
            el('span', { className: 'stage-name-text', text: row.name }),
            row.suffix ? el('span', { className: 'stage-name-suffix', text: row.suffix }) : null,
          ].filter(Boolean),
        ),
      ]),
      ...row.cells.map((cell, i) => {
        const column = columns[i] ?? {};
        const td = el(
          'td',
          { className: ['stage-standing-cell', column.className].filter(Boolean).join(' ') },
          Array.isArray(cell) ? cell : [document.createTextNode(String(cell ?? ''))],
        );
        if (column.width) td.style.width = column.width;
        return td;
      }),
    ]),
  );
  return el('table', { className: 'stage-standings' }, [el('tbody', {}, body)]);
}

// The decided event: the champion's name large and centred under a "Champion" label, an optional score line
// and an optional podium line. Returns the nodes for a frame's main area.
export function renderChampion({ label = 'Champion', name, scoreLine = null, podiumLine = null }) {
  return [
    el('p', { className: 'stage-champion-label', text: label }),
    el('h2', { className: 'stage-champion-name', text: name }),
    scoreLine
      ? typeof scoreLine === 'string'
        ? el('p', { className: 'stage-champion-score', text: scoreLine })
        : el('p', { className: 'stage-champion-score' }, [scoreLine])
      : null,
    podiumLine ? el('p', { className: 'stage-podium', text: podiumLine }) : null,
  ].filter(Boolean);
}
