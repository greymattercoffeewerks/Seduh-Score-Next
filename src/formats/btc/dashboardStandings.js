// The dashboard's standings preview: the top of the preliminary order with the cut line after 8th. It is a
// preview and says so. The database orders by points; teams level on points are put in order by the organiser,
// who records it on the standings screen with the finish times beside them (the committee's rule: the shortest
// combined preliminary time goes through). Display only: nothing here ranks, sorts or decides who qualifies
// (cutData.js draws the order the database gave; this file only takes the top rows of it).
import { el } from '../../core/dom.js';
import { kitId } from '../../core/kitLink.js';
import { deriveCutRows, isLevelRows, rankCutRows } from './cutData.js';
import { KNOCKOUT_PLACES, teamLabelNode } from './words.js';

// How many rows the preview shows: the eight, and two below the line so a close call is visible.
export const PREVIEW_ROWS = KNOCKOUT_PLACES + 2;

export const DRAFT_NOTE = 'Draft. The organiser confirms the cut on the Standings screen.';
export const LEVEL_NOTE =
  'The last team through and the first below the line are level on points. The committee gives the place to the shortest combined preliminary time. Check the times on the Standings screen.';

// Pure. What the card shows: { state: 'unread'|'empty'|'rows', rows, hidden, level }.
//   rows: [{ position, team, wins, points, aboveLine }] (the top PREVIEW_ROWS of the database's order)
//   hidden: how many ranked teams are not shown; level: whether the cut line splits two teams level on points
// `seedingRows` is null when the advisory read failed, so the card never draws a wrong order.
export function describeStandingsPreview({ teams, seedingRows }) {
  if (!seedingRows) return { state: 'unread', rows: [], hidden: 0, level: false };
  const all = deriveCutRows({ teams, seedingRows }).filter((row) => row.seed !== null);
  if (all.length === 0) return { state: 'empty', rows: [], hidden: 0, level: false };
  const ranked = rankCutRows(all);
  const rows = ranked.slice(0, PREVIEW_ROWS).map(({ item, position }, index) => ({
    position,
    team: item.team,
    wins: item.wins,
    points: item.totalPoints,
    aboveLine: index < KNOCKOUT_PLACES,
  }));
  const last = all[KNOCKOUT_PLACES - 1];
  const next = all[KNOCKOUT_PLACES];
  return {
    state: 'rows',
    rows,
    hidden: Math.max(0, all.length - rows.length),
    level: Boolean(last && next && isLevelRows(last, next)),
  };
}

// DOM. The card. `href` is the standings screen (where the cut is confirmed).
export function buildDashboardStandings({ teams, seedingRows, href }) {
  const view = describeStandingsPreview({ teams, seedingRows });
  const headingId = kitId('dash-standings-heading');
  const parts = [
    el('div', { className: 'needs-you-head' }, [
      el('h2', { id: headingId, className: 'ok-card-heading', text: 'Standings' }),
      el('span', { className: 'eyebrow', text: 'Preview' }),
    ]),
  ];
  if (view.state === 'unread') {
    parts.push(
      el('p', {
        className: 'empty',
        text: 'The standings could not be read just now. Open the Standings screen.',
      }),
    );
  } else if (view.state === 'empty') {
    parts.push(
      el('p', {
        className: 'empty',
        text: 'No results yet. Teams appear after their first match.',
      }),
    );
  } else {
    const body = [];
    view.rows.forEach((row, index) => {
      body.push(
        el('tr', {}, [
          el('td', { className: 'mono', text: String(row.position) }),
          el('th', { attrs: { scope: 'row' } }, [teamLabelNode(row.team)]),
          el('td', { className: 'mono', text: String(row.wins) }),
          el('td', { className: 'mono', text: String(row.points) }),
        ]),
      );
      if (index === KNOCKOUT_PLACES - 1 && view.rows.length > KNOCKOUT_PLACES) {
        body.push(
          el('tr', {}, [
            el('td', { attrs: { colspan: '4' } }, [
              el('div', {
                className: 'cutline',
                text: `The cut · top ${KNOCKOUT_PLACES} go through`,
              }),
            ]),
          ]),
        );
      }
    });
    parts.push(
      el('table', { className: 'btc-dash-standings' }, [
        el('caption', { className: 'sr-only', text: 'Preliminary standings, top of the order' }),
        el('thead', {}, [
          el(
            'tr',
            {},
            ['#', 'Team', 'Won', 'Points'].map((label) =>
              el('th', { className: 'eyebrow', attrs: { scope: 'col' }, text: label }),
            ),
          ),
        ]),
        el('tbody', {}, body),
      ]),
    );
    if (view.level) parts.push(el('p', { className: 'ok-card-note', text: LEVEL_NOTE }));
    if (view.hidden > 0) {
      parts.push(el('p', { className: 'ok-card-note', text: `${view.hidden} more teams below.` }));
    }
    parts.push(el('p', { className: 'ok-card-note', text: DRAFT_NOTE }));
  }
  if (href) {
    parts.push(
      el('a', { className: 'btn btn-outline tap-target', text: 'Open standings', attrs: { href } }),
    );
  }
  return el('section', { className: 'ok-card', attrs: { 'aria-labelledby': headingId } }, parts);
}
