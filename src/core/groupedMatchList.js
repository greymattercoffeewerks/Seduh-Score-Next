// A list of matches (or heats, or knockout ties) grouped by a key, each group with a header ("Round 2",
// "6 of 10 confirmed", a status tag) and, for a finished group, a collapse to just that header. `core/` renders,
// orders and announces; the format decides what a group IS and what a row says. It hands over
//
//   groupKey(item) -> string | number        which group an item belongs to (BTC: the preliminary round;
//                                            Throwdown: the knockout round; Cup Taster: the stage)
//   groupLabel(key, items) -> string         the group's name ("Round 2", "Quarterfinals")
//   rowView(item) -> {
//     number,   // the item's own number in its group ("3"), or null
//     sides,    // [node|string, ...]: the sides (usually two), flags and all, built by the format
//     score,    // text once there is a score ("34 – 28"), else null
//     meta,     // node|string|null: judges, a missing-time marker, anything small
//     status,   // { label, tone }: tone is 'done' | 'in_progress' | 'not_started'; 'done' counts as confirmed
//     actions,  // [node]: the row's buttons and links (one main action, maybe a Remove)
//   }
//
// This module never branches on a format (the format names above are examples only). The list keeps NO state: the caller owns which groups
// the organiser has opened or closed (`overrides`, a Map of key -> collapsed) and rebuilds on a toggle, the way
// every screen in this app does (`core/dom.js` withFocusPreservation keeps the toggle focused through the rebuild).
// A group whose every row is done starts collapsed; an override always wins. An optional `filter` node is drawn
// above the groups for a format with a longer list (BTC does not use it: about ten matches a round).
// Styled in components.css (`.ok-groups`, `.ok-group*`, `.ok-row*`).
import { el } from './dom.js';
import { kitState, statusMark } from './vocabulary.js';

export const ROW_TONES = ['done', 'in_progress', 'not_started'];

const DEFAULT_GROUP_WORDS = {
  done: 'Complete',
  in_progress: 'In progress',
  not_started: 'Not started',
};

// Pure. A row's tone, coerced: anything unknown reads as not_started.
export function toneOf(view) {
  const tone = view?.status?.tone;
  return ROW_TONES.includes(tone) ? tone : 'not_started';
}

// Pure. Items grouped by `groupKey`, groups in ascending key order (numbers numerically, anything else by its
// text), items kept in their given order inside a group. An item whose key is null or undefined is skipped:
// the format decides what an unnumbered item means (BTC maps it to round 1) before it gets here.
export function groupItems(items, groupKey) {
  const byKey = new Map();
  for (const item of items ?? []) {
    const key = groupKey(item);
    if (key === null || key === undefined) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const compare = (a, b) =>
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'en', { numeric: true });
  return [...byKey.keys()].sort(compare).map((key) => ({ key, items: byKey.get(key) }));
}

// Pure. Where a group stands, from its rows' views: { total, done, active, state } where state is 'done' when
// every row is done (and there is at least one), 'not_started' when none is started, else 'in_progress'.
export function summarizeGroup(views) {
  const total = views.length;
  const tones = views.map(toneOf);
  const done = tones.filter((t) => t === 'done').length;
  const active = tones.filter((t) => t === 'in_progress').length;
  let state = 'in_progress';
  if (total > 0 && done === total) state = 'done';
  else if (done === 0 && active === 0) state = 'not_started';
  return { total, done, active, state };
}

// Pure. Whether a group is drawn collapsed: the caller's override when there is one, else a finished group is.
export function isGroupCollapsed(summary, override) {
  return typeof override === 'boolean' ? override : summary.state === 'done';
}

const hasValue = (value) => value !== null && value !== undefined && value !== '';
// A side or meta may be text or a node the format built (a flag and a code): text becomes a text node.
const toNode = (value) =>
  typeof value === 'object' && value !== null
    ? value
    : document.createTextNode(String(value ?? ''));

function renderRow(view, joiner) {
  const tone = toneOf(view);
  const sides = Array.isArray(view.sides) ? view.sides : [];
  const children = [];
  if (hasValue(view.number)) {
    children.push(el('span', { className: 'ok-row-number', text: String(view.number) }));
  }
  // Any number of sides (a head-to-head row has two, a one-subject row has one), joined by the format's word.
  const sideNodes = [];
  sides.forEach((side, i) => {
    if (i > 0) {
      sideNodes.push(
        document.createTextNode(' '),
        el('span', { className: 'ok-row-vs', text: joiner }),
        document.createTextNode(' '),
      );
    }
    sideNodes.push(el('span', { className: 'ok-row-side' }, [toNode(side)]));
  });
  const info = [el('span', { className: 'ok-row-sides' }, sideNodes)];
  if (hasValue(view.meta)) {
    info.push(el('span', { className: 'ok-row-meta' }, [toNode(view.meta)]));
  }
  children.push(el('div', { className: 'ok-row-info' }, info));
  const tail = [];
  if (hasValue(view.score)) {
    tail.push(el('span', { className: 'ok-row-score', text: String(view.score) }));
  }
  tail.push(statusMark(kitState(tone), view.status?.label ?? 'Not started'));
  children.push(el('div', { className: 'ok-row-tail' }, tail));
  const actions = (view.actions ?? []).filter(Boolean);
  if (actions.length > 0) children.push(el('div', { className: 'ok-row-actions' }, actions));
  return el('li', { className: 'ok-row', attrs: { 'data-status': tone } }, children);
}

/**
 * DOM. The grouped list. Returns an element (an empty-state paragraph inside it when there are no items).
 * @param {object} options
 * @param {Array} options.items
 * @param {(item) => string|number|null} options.groupKey
 * @param {(key, items) => string} options.groupLabel
 * @param {(item) => object} options.rowView
 * @param {Map<string|number, boolean>} [options.overrides] key -> collapsed, the organiser's own choices
 * @param {(key, collapsed: boolean) => void} [options.onToggle] called with the NEW collapsed state
 * @param {Node|null} [options.filter] an optional filter control, drawn above the groups
 * @param {string} [options.emptyText]
 * @param {string} [options.doneWord] 'confirmed' in "6 of 10 confirmed"
 * @param {[string, string]} [options.itemWords] ['match', 'matches'], for "Show 10 matches"
 * @param {string} [options.idPrefix] makes each group's list id unique on the page
 * @param {object} [options.groupWords] the header tag's words, by state
 * @param {string} [options.sideJoiner] the word between a row's sides ('vs')
 */
export function renderGroupedMatchList({
  items,
  groupKey,
  groupLabel,
  rowView,
  overrides = new Map(),
  onToggle = () => {},
  filter = null,
  emptyText = 'Nothing here yet.',
  doneWord = 'confirmed',
  itemWords = ['match', 'matches'],
  idPrefix = 'ok-group',
  groupWords = {},
  sideJoiner = 'vs',
}) {
  const words = { ...DEFAULT_GROUP_WORDS, ...groupWords };
  const groups = groupItems(items, groupKey);
  const nodes = [];
  if (filter) nodes.push(el('div', { className: 'ok-groups-filter' }, [filter]));
  if (groups.length === 0) {
    nodes.push(el('p', { className: 'stage-meta', text: emptyText }));
    return el('div', { className: 'ok-groups' }, nodes);
  }
  const count = (n) => `${n} ${n === 1 ? itemWords[0] : itemWords[1]}`;
  for (const group of groups) {
    const views = group.items.map(rowView);
    const summary = summarizeGroup(views);
    const label = groupLabel(group.key, group.items);
    const collapsed = isGroupCollapsed(summary, overrides.get(group.key));
    const listId = `${idPrefix}-${String(group.key).replace(/[^A-Za-z0-9_-]/g, '-')}`;

    const toggle = el('button', {
      className: 'btn btn-outline tap-target ok-group-toggle',
      text: collapsed ? `Show ${count(summary.total)}` : `Hide ${itemWords[1]}`,
      attrs: {
        type: 'button',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-label': collapsed
          ? `Show ${count(summary.total)} in ${label}`
          : `Hide ${itemWords[1]} in ${label}`,
        'data-focus-key': `group-toggle-${group.key}`,
        ...(collapsed ? {} : { 'aria-controls': listId }),
      },
    });
    toggle.addEventListener('click', () => onToggle(group.key, !collapsed));

    const section = el('section', {
      className: 'ok-group',
      attrs: { 'data-state': summary.state, 'data-collapsed': collapsed ? 'true' : 'false' },
    });
    section.appendChild(
      el('header', { className: 'ok-group-header' }, [
        el('div', { className: 'ok-group-title' }, [
          el('h3', { className: 'ok-group-heading', text: label }),
          el('span', {
            className: 'ok-group-count',
            text: `${summary.done} of ${summary.total} ${doneWord}`,
          }),
          statusMark(kitState(summary.state), words[summary.state]),
        ]),
        toggle,
      ]),
    );
    if (!collapsed) {
      section.appendChild(
        el(
          'ul',
          {
            id: listId,
            className: 'ok-rows',
            attrs: { 'aria-label': `${label}, ${count(summary.total)}` },
          },
          views.map((view) => renderRow(view, sideJoiner)),
        ),
      );
    }
    nodes.push(section);
  }
  return el('div', { className: 'ok-groups' }, nodes);
}
