// The Draw panel as a compact summary card (Organiser UX S3, the canvas's "Draw summary card"): once rounds are drawn
// and no round is waiting to be drawn, the full panel is a long scroll nobody needs, so the screen shows what was drawn
// and how, with "Open the draw panel" to bring the panel back. Pure decision plus a thin DOM part; holds no state.
import { el } from '../../core/dom.js';
import { groupItems } from '../../core/groupedMatchList.js';
import { roundOf, roundStatus } from './drawPlan.js';

// Pure. Whether the summary replaces the panel: something is drawn and no round can be drawn now (round 2 waiting for
// round 1 to be confirmed counts as "nothing to draw yet"). `deadRounds` and `scoredRounds` are the screen's own.
export function showDrawSummary({ matches, deadRounds, scoredRounds, panelOpen }) {
  if (panelOpen) return false;
  const drawn = [...new Set(matches.map((m) => roundOf(m.match)))];
  if (drawn.length === 0) return false;
  // the rounds the panel offers are 1 and 2 (drawPanel.js): any of them open for drawing keeps the panel out
  return ![1, 2].some((r) => roundStatus(r, matches, deadRounds, scoredRounds).available);
}

const MODE_WORDS = {
  random: 'random draw',
  by_results: 'by round 1 results',
  manual: 'changed by hand',
};

// Pure. One line per drawn round: "Round 1: 10 matches, random draw, seed kopi-7".
export function drawSummaryLines(matches, records) {
  return groupItems(matches, (m) => roundOf(m.match)).map(({ key: round, items }) => {
    const count = items.length;
    const record = records.get(round);
    const parts = [`${count} ${count === 1 ? 'match' : 'matches'}`];
    if (record) {
      parts.push(MODE_WORDS[record.mode] ?? record.mode);
      if (record.seed) parts.push(`seed ${record.seed}`);
    } else {
      parts.push('no draw record (made by hand)');
    }
    return `Round ${round}: ${parts.join(', ')}`;
  });
}

// ctx: { matches, records: Map(round -> { mode, seed }), busy, onOpen }
export function renderDrawSummary({ matches, records, busy, onOpen }) {
  const open = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Open the draw panel',
    attrs: { type: 'button', 'data-focus-key': 'draw-open' },
  });
  if (busy) open.setAttribute('aria-disabled', 'true');
  open.addEventListener('click', () => {
    if (!busy) onOpen();
  });
  return el(
    'section',
    { className: 'card ok-draw-summary', attrs: { 'aria-label': 'Draw summary' } },
    [
      el('h2', { text: 'Draw' }),
      el(
        'ul',
        { className: 'ok-draw-summary-list' },
        drawSummaryLines(matches, records).map((line) => el('li', { text: line })),
      ),
      open,
    ],
  );
}
