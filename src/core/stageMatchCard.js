// The two-sided match card every venue display shares (a "VS" row), moved here from BTC's projector screens when
// Throwdown became the second format to need it. Format-agnostic: a side is words and numbers the caller already
// decided (a label like "Goes through", a name, an optional country, points, chips); nothing here knows what is
// being scored. Everything is set as text, never markup. Styled in core/stageMatchCard.css.
import { el } from './dom.js';

// One side of a match card: a label (in words: "3rd in the table", "Goes through"), the team's name, and for a result its
// points and the chips that explain them. `winner` is true, false, or null when there is no winner to show
// (a match not yet played, or a tie nobody has decided).
export function renderSide({
  label = null,
  name,
  country = null,
  winner = null,
  points = null,
  chips = [],
}) {
  return el(
    'div',
    {
      className: 'stage-side',
      attrs: winner === null ? {} : { 'data-winner': String(winner) },
    },
    [
      label ? el('span', { className: 'stage-side-label', text: label }) : null,
      // The country on its own small line above the name, so a long country never pushes the name off the card.
      country ? el('span', { className: 'stage-side-country', text: country.name }) : null,
      el('p', { className: 'stage-side-name', text: name }),
      points === null ? null : el('p', { className: 'stage-points', text: String(points) }),
      chips.length
        ? el(
            'div',
            { className: 'stage-chips' },
            chips.map((chip) =>
              el('span', {
                className: 'stage-chip',
                text: chip.text,
                attrs: chip.kind ? { 'data-kind': chip.kind } : {},
              }),
            ),
          )
        : null,
    ].filter(Boolean),
  );
}

export function renderVs(left, right) {
  return el('div', { className: 'stage-vs' }, [
    left,
    el('span', { className: 'stage-vs-mark', text: 'VS', attrs: { 'aria-hidden': 'true' } }),
    right,
  ]);
}
