import { describe, it, expect, vi } from 'vitest';
import { describeCut, levelWords, renderCutLine } from './cutLine.js';
import { rank } from './ranking.js';

// Two fixtures shaped like two different formats, to prove the module is not BTC-shaped.
// BTC: teams ranked by points, the top 8 of 10 go through.
const btcTeams = (points) =>
  rank(
    points.map((p, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, pts: p })),
    (a, b) => b.pts - a.pts,
  );
// Cup Taster: cuppers ranked by correct count, then fastest time; the top 3 advance. Level = same correct AND time.
const cupTasterRows = rank(
  [
    { id: 'a', name: 'Ana', correct: 7, secs: 200 },
    { id: 'b', name: 'Bo', correct: 6, secs: 180 },
    { id: 'c', name: 'Cy', correct: 6, secs: 180 },
    { id: 'd', name: 'Di', correct: 6, secs: 180 },
    { id: 'e', name: 'Ed', correct: 4, secs: 150 },
  ],
  (a, b) => b.correct - a.correct || a.secs - b.secs,
);
const levelBtc = (a, b) => a.pts === b.pts;
const levelCup = (a, b) => a.correct === b.correct && a.secs === b.secs;

describe('describeCut', () => {
  it('draws the line after place N and marks every row above or below it', () => {
    const view = describeCut({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 30, 20, 10, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
    });
    expect(view.lineAfter).toBe(8);
    expect(view.rows.map((r) => r.side)).toEqual([...Array(8).fill('above'), 'below', 'below']);
    expect(view.rows.every((r) => r.groupId === null && !r.crossing)).toBe(true);
    expect(view.crossingGroups).toEqual([]);
  });

  it('a tie inside the top N is a group, but it does not cross the line', () => {
    const view = describeCut({
      ranked: btcTeams([90, 80, 80, 60, 50, 40, 30, 20, 10, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
    });
    expect(view.rows.filter((r) => r.groupId !== null).map((r) => r.item.id)).toEqual(['t2', 't3']);
    expect(view.rows.some((r) => r.crossing)).toBe(false);
    expect(view.crossingGroups).toEqual([]);
  });

  it('a tie across places N and N+1 crosses the line; every member is marked', () => {
    const view = describeCut({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 30, 20, 20, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
    });
    expect(view.rows.filter((r) => r.crossing).map((r) => r.item.id)).toEqual(['t8', 't9']);
    expect(view.crossingGroups).toHaveLength(1);
    expect(view.crossingGroups[0].items.map((i) => i.id)).toEqual(['t8', 't9']);
    expect(view.crossingGroups[0].settled).toBe(false);
  });

  it('a three-way tie across the line is one group of three', () => {
    const view = describeCut({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 20, 20, 20, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
    });
    expect(view.crossingGroups).toHaveLength(1);
    expect(view.crossingGroups[0].items).toHaveLength(3);
    expect(view.rows.filter((r) => r.crossing).map((r) => r.groupSize)).toEqual([3, 3, 3]);
  });

  it('a group that ends exactly at place N does not cross', () => {
    const view = describeCut({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 20, 20, 10, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
    });
    expect(view.rows.some((r) => r.crossing)).toBe(false);
  });

  it('asks the format whether a group is settled, and reports it', () => {
    const settled = vi.fn(() => true);
    const view = describeCut({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 30, 20, 20, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
      isSettled: settled,
    });
    expect(settled).toHaveBeenCalledWith([
      expect.objectContaining({ id: 't8' }),
      expect.anything(),
    ]);
    expect(view.rows.filter((r) => r.settled)).toHaveLength(2);
    expect(view.crossingGroups[0].settled).toBe(true);
  });

  it('works for a second format: Cup Taster advancement, three through, a tie across the line', () => {
    const view = describeCut({ ranked: cupTasterRows, qualifyCount: 3, isLevel: levelCup });
    expect(view.lineAfter).toBe(3);
    expect(view.rows.map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(view.rows.filter((r) => r.crossing).map((r) => r.item.id)).toEqual(['b', 'c', 'd']);
    // positions come from the caller's ranking, untouched
    expect(view.rows.map((r) => r.position)).toEqual([1, 2, 2, 2, 5]);
  });

  it('draws no line when N covers every row, or is zero or not a number', () => {
    const ranked = btcTeams([3, 2, 1]);
    for (const qualifyCount of [3, 9, 0, -1, NaN, undefined]) {
      const view = describeCut({ ranked, qualifyCount, isLevel: levelBtc });
      expect(view.lineAfter, String(qualifyCount)).toBeNull();
    }
  });

  it('does not reorder or mutate what it is given', () => {
    const ranked = btcTeams([20, 90, 20]);
    const before = JSON.stringify(ranked);
    const view = describeCut({ ranked, qualifyCount: 1, isLevel: levelBtc });
    expect(JSON.stringify(ranked)).toBe(before);
    expect(view.rows.map((r) => r.item.id)).toEqual(ranked.map((r) => r.item.id));
  });

  it('survives empty or missing input', () => {
    expect(describeCut({ ranked: [], qualifyCount: 8, isLevel: levelBtc }).rows).toEqual([]);
    expect(describeCut({}).rows).toEqual([]);
  });
});

describe('levelWords', () => {
  const base = { groupId: 1, crossing: false, settled: false };
  it('says nothing for a row that is not level', () => {
    expect(levelWords({ groupId: null, crossing: false, settled: false })).toBeNull();
  });
  it('says it in words for each state', () => {
    expect(levelWords(base)).toBe('Level');
    expect(levelWords({ ...base, settled: true })).toBe('Level · order settled');
    expect(levelWords({ ...base, crossing: true })).toBe(
      'Level at the line · decides who goes through',
    );
    expect(levelWords({ ...base, crossing: true, settled: true })).toBe(
      'Level at the line · order settled',
    );
  });
});

describe('renderCutLine', () => {
  const columns = [
    { key: 'place', header: 'Place', cell: (item, row) => String(row.position) },
    { key: 'name', header: 'Team', cell: (item) => item.name },
    { key: 'pts', header: 'Pts', numeric: true, cell: (item) => item.pts },
  ];
  const render = (options = {}) =>
    renderCutLine({
      ranked: btcTeams([90, 80, 70, 60, 50, 40, 30, 20, 20, 5]),
      qualifyCount: 8,
      isLevel: levelBtc,
      columns,
      rowKey: (item) => item.id,
      ...options,
    });

  it('renders a table with headers, a line row after place N and the words beside a level place', () => {
    const node = render();
    const headers = [...node.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['Place', 'Team', 'Pts']);
    const rows = [...node.querySelectorAll('tbody tr')];
    const lineIndex = rows.findIndex((r) => r.classList.contains('ok-cut-line-row'));
    expect(lineIndex).toBe(8);
    expect(rows[lineIndex].textContent).toBe('Cut line · top 8 go through');
    expect(rows[lineIndex].querySelector('td').getAttribute('colspan')).toBe('3');
    const crossing = node.querySelectorAll('tr[data-level="crossing"]');
    expect(crossing).toHaveLength(2);
    expect(crossing[0].textContent).toContain('Level at the line · decides who goes through');
    expect(crossing[0].getAttribute('data-row-key')).toBe('t8');
  });

  it('collapsing hides the teams below the line except a level group that crosses it', () => {
    const node = render({ collapseBelow: true, onToggle: () => {} });
    const keys = [...node.querySelectorAll('tr[data-row-key]')].map((r) =>
      r.getAttribute('data-row-key'),
    );
    expect(keys).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
    expect(keys).not.toContain('t10');
  });

  it('shows a "Show all N" button that reports the toggle', () => {
    const onToggle = vi.fn();
    const node = render({ collapseBelow: true, onToggle });
    const button = node.querySelector('.ok-cut-toggle');
    expect(button.textContent).toBe('Show all 10');
    button.click();
    expect(onToggle).toHaveBeenCalledWith(false);
    const open = render({ collapseBelow: false, onToggle });
    expect(open.querySelector('.ok-cut-toggle').textContent).toBe('Show only the top 8');
  });

  it('shows no toggle when nothing can be hidden, or no handler is given', () => {
    expect(render({ onToggle: () => {} }).querySelector('.ok-cut-toggle')).not.toBeNull();
    expect(render().querySelector('.ok-cut-toggle')).toBeNull();
    const tight = render({
      ranked: btcTeams([9, 8, 7]),
      qualifyCount: 3,
      onToggle: () => {},
    });
    expect(tight.querySelector('.ok-cut-toggle')).toBeNull();
    expect(tight.querySelector('.ok-cut-line-row')).toBeNull();
  });

  it('has a slot beside the table for the tie card and the lock card, and none when it is empty', () => {
    const card = document.createElement('div');
    card.className = 'tie-card';
    const node = render({ rail: [null, card] });
    expect(node.querySelector('.ok-cut-rail .tie-card')).toBe(card);
    expect(render({ rail: [null] }).querySelector('.ok-cut-rail')).toBeNull();
  });

  it('puts the cell text in as text, never markup, and gives each cell its label for the phone layout', () => {
    const node = render({
      ranked: rank([{ id: 'x', name: '<img src=x onerror=alert(1)>', pts: 1 }], () => 0),
      qualifyCount: 1,
    });
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('td[data-label="Team"]').textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('is the cut line for a second format too (Cup Taster advancement)', () => {
    const node = renderCutLine({
      ranked: cupTasterRows,
      qualifyCount: 3,
      isLevel: levelCup,
      columns: [{ key: 'n', header: 'Cupper', cell: (item) => item.name }],
      lineText: 'Advance line · top 3 advance',
    });
    expect(node.querySelector('.ok-cut-line').textContent).toBe('Advance line · top 3 advance');
    expect(node.querySelectorAll('tr[data-level="crossing"]')).toHaveLength(3);
  });
});
