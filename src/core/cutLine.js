// "The cut": a ranked table with a line drawn after place N. Everything above the line goes through, everything below
// does not, and any group of rows that are LEVEL (equal on whatever the format ranks by) and cross the line is
// highlighted, because their order decides who gets through. Format-agnostic: it knows neither what the rows are
// (teams, cuppers, heats) nor what N is; a format supplies
//   - `ranked`: rows from core/ranking.js `rank()` ({ item, position }) in the order to show. They are drawn as given.
//     This module NEVER sorts or ranks, and never decides who qualifies: it only draws the line after place N of
//     the order it is handed (a format whose order comes from a database passes that order).
//   - `qualifyCount`: N.
//   - `isLevel(a, b)`: whether two ADJACENT items are level. Must be an equivalence on the order (level with the
//     next is level with the one after).
//   - `columns`: [{ key, header, cell(item, row) → string | Node, numeric?, className? }]. `row` is the view the pure
//     part derives (below), so a cell can say "decides who qualifies".
//   - optional `isSettled(items)`: whether a level group has been put in order by a person (the format records
//     that). A settled group keeps its "Level" word and says "settled"; an unsettled one that crosses the line
//     says it decides who goes through.
//
// The pure part (`describeCut`) is unit-tested with rows shaped like two formats; the DOM part is a thin renderer on
// core/dom.js. It has a slot for the cards that belong beside the table (a tie card, a lock card): the `rail` nodes.
// Styled in components.css (`.ok-cut*`). Level and crossing are said in WORDS in the place cell, never by colour alone.
import { el } from './dom.js';

// Pure. The view of a ranked list around a cut line.
//   rows: [{ item, position, index, side: 'above'|'below', groupId, groupSize, crossing, settled }]
//         (`groupId` is null for a row that is not level with a neighbour)
//   lineAfter: the number of rows above the line, or null when there is no line to draw (N is 0 or covers every row)
//   crossingGroups: [{ id, items, settled }]
export function describeCut({ ranked, qualifyCount, isLevel, isSettled }) {
  const list = Array.isArray(ranked) ? ranked : [];
  const n = Number.isInteger(qualifyCount) && qualifyCount > 0 ? qualifyCount : 0;
  const level = typeof isLevel === 'function' ? isLevel : () => false;
  const settledOf = typeof isSettled === 'function' ? isSettled : () => false;

  // Runs of adjacent level rows.
  const groups = [];
  let start = 0;
  for (let i = 1; i <= list.length; i++) {
    if (i < list.length && level(list[i - 1].item, list[i].item)) continue;
    if (i - start >= 2) groups.push({ start, end: i - 1 });
    start = i;
  }
  const groupOfIndex = new Map();
  const described = groups.map((group, id) => {
    const items = list.slice(group.start, group.end + 1).map((row) => row.item);
    const crossing = n > 0 && group.start < n && group.end >= n;
    for (let i = group.start; i <= group.end; i++) groupOfIndex.set(i, id);
    return { id, items, size: items.length, crossing, settled: settledOf(items) === true };
  });

  const rows = list.map((row, index) => {
    const id = groupOfIndex.has(index) ? groupOfIndex.get(index) : null;
    const group = id === null ? null : described[id];
    return {
      item: row.item,
      position: row.position,
      index,
      side: index < n ? 'above' : 'below',
      groupId: id,
      groupSize: group ? group.size : 1,
      crossing: group ? group.crossing : false,
      settled: group ? group.settled : false,
    };
  });

  return {
    rows,
    lineAfter: n > 0 && n < list.length ? n : null,
    crossingGroups: described
      .filter((group) => group.crossing)
      .map(({ id, items, settled }) => ({ id, items, settled })),
  };
}

// Pure. The words beside a place. A row that is not level says nothing.
export function levelWords(row) {
  if (row.groupId === null) return null;
  if (row.crossing) {
    return row.settled
      ? 'Level at the line · order settled'
      : 'Level at the line · decides who goes through';
  }
  return row.settled ? 'Level · order settled' : 'Level';
}

/**
 * DOM. `<div class="ok-cut">` holding the table (and its show-all button) and, when `rail` has nodes, the rail beside
 * it. Rebuilt by the caller on every change; `collapseBelow` and `onToggle` are the caller's state.
 * @param {object} options
 * @param {{ item: any, position: number }[]} options.ranked
 * @param {number} options.qualifyCount
 * @param {(a: any, b: any) => boolean} options.isLevel
 * @param {(items: any[]) => boolean} [options.isSettled]
 * @param {{ key: string, header: string, cell: (item: any, row: object) => string | Node, numeric?: boolean, className?: string }[]} options.columns
 * @param {(item: any) => string} [options.rowKey] a stable id for `data-row-key` (tests, focus)
 * @param {string} [options.caption] the table's accessible name
 * @param {string} [options.lineText] the words on the line (default "Cut line · top N go through")
 * @param {boolean} [options.collapseBelow] hide the rows below the line, except level rows that cross it
 * @param {(collapsed: boolean) => void} [options.onToggle] shows the "Show all" button when there is something to hide
 * @param {Node[]} [options.rail] cards to put beside the table (the tie card, the lock card)
 */
export function renderCutLine({
  ranked,
  qualifyCount,
  isLevel,
  isSettled,
  columns,
  rowKey,
  caption = 'The cut',
  lineText,
  collapseBelow = false,
  onToggle,
  rail = [],
}) {
  const view = describeCut({ ranked, qualifyCount, isLevel, isSettled });
  const cols = columns ?? [];

  // Rows below the line that stay visible while collapsed: a level group across the line is the thing to look at.
  const hideable = (row) => row.side === 'below' && !row.crossing;
  const hiddenCount = view.rows.filter(hideable).length;
  const collapsed = collapseBelow && hiddenCount > 0 && view.lineAfter !== null;

  const head = el('thead', {}, [
    el(
      'tr',
      {},
      cols.map((col) =>
        el('th', {
          text: col.header,
          className: col.numeric ? 'ok-cut-num' : undefined,
          attrs: { scope: 'col' },
        }),
      ),
    ),
  ]);

  const body = [];
  view.rows.forEach((row) => {
    if (view.lineAfter !== null && row.index === view.lineAfter) {
      body.push(
        el('tr', { className: 'ok-cut-line-row' }, [
          el('td', {
            className: 'ok-cut-line',
            text: lineText ?? `Cut line · top ${qualifyCount} go through`,
            attrs: { colspan: String(Math.max(cols.length, 1)) },
          }),
        ]),
      );
    }
    if (collapsed && hideable(row)) return;
    const words = levelWords(row);
    const cells = cols.map((col, colIndex) => {
      const value = col.cell(row.item, row);
      const children = [];
      if (value instanceof Node) children.push(value);
      else if (value != null) children.push(document.createTextNode(String(value)));
      // The words go with the first cell (the place), so they are read with it, in a stacked or a wide layout.
      if (colIndex === 0 && words) {
        children.push(el('span', { className: 'ok-cut-level', text: words }));
      }
      return el(
        'td',
        {
          className: ['ok-cut-cell', col.numeric ? 'ok-cut-num' : '', col.className ?? '']
            .filter(Boolean)
            .join(' '),
          attrs: { 'data-label': col.header },
        },
        children,
      );
    });
    const attrs = { 'data-side': row.side };
    if (row.groupId !== null) {
      attrs['data-level'] = row.crossing ? 'crossing' : 'inside';
      attrs['data-settled'] = row.settled ? 'true' : 'false';
    }
    if (typeof rowKey === 'function') attrs['data-row-key'] = String(rowKey(row.item));
    body.push(el('tr', { className: 'ok-cut-row', attrs }, cells));
  });

  const table = el('table', { className: 'ok-cut-table' }, [
    el('caption', { className: 'sr-only', text: caption }),
    head,
    el('tbody', {}, body),
  ]);

  const main = el('div', { className: 'ok-cut-main' }, [table]);
  if (typeof onToggle === 'function' && view.lineAfter !== null && hiddenCount > 0) {
    const button = el('button', {
      className: 'btn btn-outline tap-target ok-cut-toggle',
      text: collapsed ? `Show all ${view.rows.length}` : `Show only the top ${qualifyCount}`,
      attrs: {
        type: 'button',
        'data-focus-key': 'cut-toggle',
      },
    });
    button.addEventListener('click', () => onToggle(!collapsed));
    main.appendChild(button);
  }

  const railNodes = (rail ?? []).filter(Boolean);
  const root = el('div', { className: 'ok-cut' }, [main]);
  if (railNodes.length > 0) root.appendChild(el('div', { className: 'ok-cut-rail' }, railNodes));
  return root;
}
