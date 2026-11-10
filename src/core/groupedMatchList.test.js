import { describe, it, expect, vi } from 'vitest';
import {
  groupItems,
  summarizeGroup,
  isGroupCollapsed,
  toneOf,
  renderGroupedMatchList,
} from './groupedMatchList.js';

// Two formats' fixtures, to prove the module is not BTC-shaped: BTC matches carry a nullable round number and a
// status; Throwdown ties carry a named knockout round and a state, and show a winner instead of a score.
const btcMatches = [
  { id: 'a', round: 2, state: 'pending' },
  { id: 'b', round: null, state: 'confirmed' },
  { id: 'c', round: 1, state: 'confirmed' },
  { id: 'd', round: 2, state: 'scoring' },
];
const btcKey = (m) => m.round ?? 1;
const btcView = (m) => ({
  number: m.id,
  sides: [`${m.id}-home`, `${m.id}-away`],
  score: m.state === 'confirmed' ? '30 – 20' : null,
  meta: 'Judges: x',
  status: {
    label: { pending: 'Scheduled', scoring: 'Scoring', confirmed: 'Confirmed' }[m.state],
    tone: { pending: 'not_started', scoring: 'in_progress', confirmed: 'done' }[m.state],
  },
  actions: [],
});

const ties = [
  { id: 't1', stage: 'semi', winner: 'Mira' },
  { id: 't2', stage: 'quarter', winner: 'Jun' },
  { id: 't3', stage: 'quarter', winner: null },
];
const tieView = (t) => ({
  number: null,
  sides: ['Left', 'Right'],
  score: t.winner ? `${t.winner} wins` : null,
  status: t.winner ? { label: 'Decided', tone: 'done' } : { label: 'Open', tone: 'not_started' },
});

function render(opts) {
  return renderGroupedMatchList({ idPrefix: 'g', ...opts });
}

describe('groupItems', () => {
  it('groups by key, orders numeric keys numerically and keeps item order inside a group', () => {
    const groups = groupItems(btcMatches, btcKey);
    expect(groups.map((g) => g.key)).toEqual([1, 2]);
    expect(groups[0].items.map((m) => m.id)).toEqual(['b', 'c']); // the unnumbered one counts as 1
    const reversed = groupItems(
      [
        { id: 'z', round: 1 },
        { id: 'b', round: 1 },
      ],
      (m) => m.round,
    );
    expect(reversed[0].items.map((m) => m.id)).toEqual(['z', 'b']); // given order, not sorted
    expect(groups[1].items.map((m) => m.id)).toEqual(['a', 'd']);
  });

  it('orders text keys by their text, with numbers inside text read numerically', () => {
    const groups = groupItems([{ k: 'round 10' }, { k: 'round 9' }, { k: 'quarter' }], (i) => i.k);
    expect(groups.map((g) => g.key)).toEqual(['quarter', 'round 9', 'round 10']);
  });

  it('skips an item whose key is null or undefined, and handles no items', () => {
    expect(groupItems([{ k: null }, {}], (i) => i.k)).toEqual([]);
    expect(groupItems(undefined, () => 1)).toEqual([]);
  });
});

describe('summarizeGroup / isGroupCollapsed', () => {
  const v = (tone) => ({ status: { tone } });

  it('is done only when every row is done, and not started only when none has started', () => {
    expect(summarizeGroup([v('done'), v('done')])).toMatchObject({
      total: 2,
      done: 2,
      state: 'done',
    });
    expect(summarizeGroup([v('done'), v('not_started')]).state).toBe('in_progress');
    expect(summarizeGroup([v('in_progress'), v('not_started')])).toMatchObject({
      active: 1,
      state: 'in_progress',
    });
    expect(summarizeGroup([v('not_started'), v('not_started')]).state).toBe('not_started');
  });

  it('an empty group is not done', () => {
    expect(summarizeGroup([])).toMatchObject({ total: 0, state: 'not_started' });
  });

  it('reads an unknown tone as not started', () => {
    expect(toneOf({ status: { tone: 'weird' } })).toBe('not_started');
    expect(toneOf({})).toBe('not_started');
  });

  it('collapses a finished group by default, and an override always wins', () => {
    const done = summarizeGroup([v('done')]);
    const open = summarizeGroup([v('not_started')]);
    expect(isGroupCollapsed(done, undefined)).toBe(true);
    expect(isGroupCollapsed(open, undefined)).toBe(false);
    expect(isGroupCollapsed(done, false)).toBe(false);
    expect(isGroupCollapsed(open, true)).toBe(true);
  });
});

describe('renderGroupedMatchList: a BTC-shaped list (matches by round)', () => {
  const opts = {
    items: btcMatches,
    groupKey: btcKey,
    groupLabel: (k) => `Round ${k}`,
    rowView: btcView,
  };

  it('draws one group per round with its count and status, and collapses a finished round', () => {
    const node = render({
      ...opts,
      items: btcMatches.filter((m) => m.state === 'confirmed'),
    });
    const groups = node.querySelectorAll('.ok-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].dataset.collapsed).toBe('true');
    expect(groups[0].querySelector('.ok-group-count').textContent).toBe('2 of 2 confirmed');
    expect(groups[0].querySelector('.ok-rows')).toBeNull();
    const toggle = groups[0].querySelector('button');
    expect(toggle.textContent).toBe('Show 2 matches');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps an unfinished round open with a row per match', () => {
    const node = render(opts);
    const [r1, r2] = node.querySelectorAll('.ok-group');
    expect(r1.dataset.collapsed).toBe('true'); // b and c are both confirmed
    expect(r2.dataset.collapsed).toBe('false');
    expect(r2.querySelector('.ok-group-heading').textContent).toBe('Round 2');
    expect(r2.querySelector('.ok-group-count').textContent).toBe('0 of 2 confirmed');
    expect(r2.querySelectorAll('.ok-row')).toHaveLength(2);
    const tags = [...r2.querySelectorAll('.ok-row .ok-tag')].map((t) => t.textContent);
    expect(tags).toEqual(['Scheduled', 'Scoring']);
    expect(r2.querySelector('.ok-group-header .ok-tag').dataset.status).toBe('in_progress');
  });

  it('honours an override both ways and reports the new state through onToggle', () => {
    const onToggle = vi.fn();
    const node = render({
      ...opts,
      overrides: new Map([
        [1, false],
        [2, true],
      ]),
      onToggle,
    });
    const [r1, r2] = node.querySelectorAll('.ok-group');
    expect(r1.dataset.collapsed).toBe('false');
    expect(r2.dataset.collapsed).toBe('true');
    r1.querySelector('button').click();
    expect(onToggle).toHaveBeenLastCalledWith(1, true);
    r2.querySelector('button').click();
    expect(onToggle).toHaveBeenLastCalledWith(2, false);
  });

  it('puts the score, meta, number and actions in the row', () => {
    const action = document.createElement('a');
    action.textContent = 'View';
    const node = render({
      ...opts,
      overrides: new Map([[1, false]]),
      rowView: (m) => ({ ...btcView(m), actions: [action.cloneNode(true)] }),
    });
    const row = node.querySelector('.ok-group[data-state="done"] .ok-row');
    expect(row.querySelector('.ok-row-number').textContent).toBe('b');
    expect(row.querySelector('.ok-row-score').textContent).toBe('30 – 20');
    expect(row.querySelector('.ok-row-meta').textContent).toBe('Judges: x');
    expect(row.querySelector('.ok-row-actions a').textContent).toBe('View');
  });

  it('says so when there is nothing to list', () => {
    const node = render({ ...opts, items: [], emptyText: 'No matches yet.' });
    expect(node.textContent).toBe('No matches yet.');
    expect(node.querySelector('.ok-group')).toBeNull();
  });

  it('draws an optional filter slot above the groups, and nothing when it is unused', () => {
    const filter = document.createElement('select');
    const withFilter = render({ ...opts, filter });
    expect(withFilter.firstElementChild.className).toBe('ok-groups-filter');
    expect(withFilter.querySelector('select')).toBe(filter);
    expect(render(opts).querySelector('.ok-groups-filter')).toBeNull();
  });
});

describe('renderGroupedMatchList: a Throwdown-shaped list (ties by knockout round)', () => {
  const opts = {
    items: ties,
    groupKey: (t) => t.stage,
    groupLabel: (k) => ({ quarter: 'Quarterfinals', semi: 'Semifinals' })[k],
    rowView: tieView,
    doneWord: 'decided',
    itemWords: ['tie', 'ties'],
  };

  it('uses the format words and its own group labels, with no score column when there is none', () => {
    const node = render(opts);
    const groups = [...node.querySelectorAll('.ok-group')];
    // keys sort by text: quarter, semi
    expect(groups.map((g) => g.querySelector('h3').textContent)).toEqual([
      'Quarterfinals',
      'Semifinals',
    ]);
    expect(groups[0].querySelector('.ok-group-count').textContent).toBe('1 of 2 decided');
    expect(groups[1].dataset.collapsed).toBe('true');
    expect(groups[1].querySelector('button').textContent).toBe('Show 1 tie');
    expect(groups[0].querySelector('.ok-row-number')).toBeNull();
    expect(groups[0].querySelectorAll('.ok-row-score')).toHaveLength(1);
  });

  it('lets the format rename the header tag words', () => {
    const node = render({ ...opts, groupWords: { done: 'Finished' } });
    expect(node.querySelectorAll('.ok-group-header .ok-tag')[1].textContent).toBe('Finished');
  });

  describe('renderGroupedMatchList: rows that are not head-to-head', () => {
    it('draws a one-subject row with no dangling joiner, and uses the format joiner for two sides', () => {
      const one = render({
        items: [{ id: 1 }],
        groupKey: () => 'heat',
        groupLabel: () => 'Heat 1',
        rowView: () => ({ sides: ['Alice'], status: { label: 'Open', tone: 'not_started' } }),
      });
      expect(one.querySelector('.ok-row-sides').textContent.trim()).toBe('Alice');
      expect(one.querySelector('.ok-row-vs')).toBeNull();
      const two = render({
        items: [{ id: 1 }],
        groupKey: () => 'g',
        groupLabel: () => 'G',
        rowView: () => ({ sides: ['A', 'B'], status: { label: 'Open', tone: 'not_started' } }),
        sideJoiner: 'against',
      });
      expect(two.querySelector('.ok-row-vs').textContent).toBe('against');
    });
  });
});
