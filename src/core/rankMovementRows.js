// The rows of a "what moved" screen on a venue display: place, name and how the name got there, in words
// (New, Up 2, Down 1, Holds), from core/rankMovement.js's output. Format-agnostic — a row is
// { position, label, tied, change, places } and any format's projector draws it the same way; the look is
// core/stageMoments.css, token-only. Words carry the meaning, the colour only adds emphasis, and a shared
// place says "(tied)" in its own element so a long name is cut with an ellipsis and never the word.
import { el } from './dom.js';

const CHANGE_WORDS = {
  entered: () => 'New',
  up: (row) => `Up ${row.places}`,
  down: (row) => `Down ${row.places}`,
  same: () => 'Holds',
};

export function describeMovement(row) {
  return CHANGE_WORDS[row.change](row);
}

function moveRow(row) {
  return el(
    'li',
    { className: 'stage-move stage-reveal-item', attrs: { 'data-change': row.change } },
    [
      el('span', { className: 'stage-move-pos', text: String(row.position) }),
      el(
        'span',
        { className: 'stage-move-name' },
        [
          el('span', { className: 'stage-move-name-text', text: row.label }),
          row.tied ? el('span', { className: 'stage-move-name-suffix', text: ' (tied)' }) : null,
        ].filter(Boolean),
      ),
      el('span', { className: 'stage-move-change', text: describeMovement(row) }),
    ],
  );
}

// `more` (optional): how many rows the caller left out, written as a last line so a trimmed list never reads
// as a complete one.
export function renderMovementRows(rows, { more = 0 } = {}) {
  const items = rows.map(moveRow);
  if (more > 0) items.push(el('li', { className: 'stage-move-more', text: `+${more} more` }));
  return el('ul', { className: 'stage-moves' }, items);
}
