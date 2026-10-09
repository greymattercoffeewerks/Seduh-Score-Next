import { describe, it, expect, beforeAll } from 'vitest';
import {
  stageKicker,
  stageTitle,
  stageSupport,
  renderStandingsHead,
  standingsRangeText,
  renderStandingsTable,
  renderChampion,
} from './stageVocabulary.js';

const text = (node, selector) => node.querySelector(selector)?.textContent ?? null;

describe('stageKicker and stageTitle', () => {
  it('are a paragraph and a level-2 heading with the shared classes', () => {
    const kicker = stageKicker('On stage now');
    const title = stageTitle('Heat 3');
    expect(kicker.tagName).toBe('P');
    expect(kicker.className).toBe('stage-kicker');
    expect(kicker.textContent).toBe('On stage now');
    expect(title.tagName).toBe('H2');
    expect(title.className).toBe('stage-title');
    expect(title.textContent).toBe('Heat 3');
  });

  it('set text, never markup', () => {
    const title = stageTitle('<img src=x onerror=alert(1)>');
    expect(title.querySelector('img')).toBeNull();
    expect(title.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('stageSupport', () => {
  it('is a paragraph of secondary text, set as text', () => {
    const support = stageSupport('Results appear here as soon as the judges confirm.');
    expect(support.tagName).toBe('P');
    expect(support.className).toBe('stage-support');
    expect(stageSupport('<b>x</b>').querySelector('b')).toBeNull();
  });
});

describe('renderStandingsHead', () => {
  it('is the title and, beside it, where this page sits in the list', () => {
    const head = renderStandingsHead('Preliminary standings', '9 to 16 of 17');
    expect(head.className).toBe('stage-standings-head');
    expect(text(head, '.stage-title')).toBe('Preliminary standings');
    expect(text(head, '.stage-range')).toBe('9 to 16 of 17');
  });
});

describe('standingsRangeText', () => {
  it('says how many there are when everything fits on one page, naming what is ranked', () => {
    expect(standingsRangeText({ first: 1, last: 5, total: 5 }, 1, 'cuppers')).toBe('5 cuppers');
    expect(standingsRangeText({ first: 1, last: 8, total: 8 }, 1, 'teams')).toBe('8 teams');
  });

  it('gives the span on a page of several, and "N of M" for a page holding one', () => {
    expect(standingsRangeText({ first: 9, last: 16, total: 17 }, 3, 'cuppers')).toBe(
      '9 to 16 of 17',
    );
    expect(standingsRangeText({ first: 17, last: 17, total: 17 }, 3, 'cuppers')).toBe('17 of 17');
    // first, last and total all different from one another, so none can stand in for another
    expect(standingsRangeText({ first: 9, last: 9, total: 17 }, 3, 'cuppers')).toBe('9 of 17');
    expect(standingsRangeText({ first: 9, last: 12, total: 12 }, 2, 'cuppers')).toBe(
      '9 to 12 of 12',
    );
  });

  it('counts the whole list, not the last row, when everything fits on one page', () => {
    expect(standingsRangeText({ first: 1, last: 5, total: 12 }, 1, 'cuppers')).toBe('12 cuppers');
  });
});

describe('renderStandingsTable', () => {
  const rows = [
    {
      position: 1,
      name: 'Ayu',
      suffix: ' (tied)',
      cells: ['5/7', [document.createTextNode('3:21')]],
    },
    { position: 2, name: 'Bima', suffix: '', cells: ['4/7', '—'] },
  ];

  it('is a table of ranked rows: the position, then the name, then one cell per value', () => {
    const table = renderStandingsTable(rows, [{ className: 'score' }, { className: 'time' }]);
    expect(table.tagName).toBe('TABLE');
    expect(table.className).toBe('stage-standings');
    const trs = [...table.querySelectorAll('tr.stage-standing-row')];
    expect(trs).toHaveLength(2);
    expect(text(trs[0], '.stage-standing-pos')).toBe('1');
    expect(text(trs[0], '.stage-name-text')).toBe('Ayu');
    expect(trs[0].querySelectorAll('td')).toHaveLength(4);
    // the position, then the name, then each value, in that order, inside a tbody
    expect([...trs[0].children].map((td) => td.className)).toEqual([
      'stage-standing-pos',
      'stage-standing-name',
      'stage-standing-cell score',
      'stage-standing-cell time',
    ]);
    expect(table.firstElementChild.tagName).toBe('TBODY');
    expect(text(trs[0], 'td.score')).toBe('5/7');
    expect(text(trs[0], 'td.time')).toBe('3:21');
    expect(text(trs[1], 'td.time')).toBe('—');
  });

  it('writes a tie or an advancing place in the row as its own element, and none when there is none', () => {
    const table = renderStandingsTable(rows, []);
    const [first, second] = [...table.querySelectorAll('tr')];
    expect(text(first, '.stage-name-suffix')).toBe(' (tied)');
    expect(first.querySelector('.stage-name-text').textContent).toBe('Ayu');
    expect(second.querySelector('.stage-name-suffix')).toBeNull();
  });

  it("gives every value cell the shared class plus the column's own hook and width", () => {
    const table = renderStandingsTable(rows, [
      { className: 'score', width: '12vw' },
      { className: 'time', width: '14vw' },
    ]);
    const cells = [...table.querySelectorAll('tr')[0].querySelectorAll('.stage-standing-cell')];
    expect(cells.map((c) => c.className)).toEqual([
      'stage-standing-cell score',
      'stage-standing-cell time',
    ]);
    expect(cells.map((c) => c.style.width)).toEqual(['12vw', '14vw']);
  });

  it('sets no width when a column has none, and tolerates fewer column specs than cells', () => {
    const table = renderStandingsTable(rows, [{ className: 'score' }]);
    const cells = [...table.querySelectorAll('tr')[0].querySelectorAll('.stage-standing-cell')];
    expect(cells).toHaveLength(2);
    expect(cells[0].style.width).toBe('');
    expect(cells[1].className).toBe('stage-standing-cell');
  });

  it('shows names, suffixes and cells as text, never markup', () => {
    const table = renderStandingsTable(
      [{ position: 1, name: '<b>x</b>', suffix: '<i>y</i>', cells: ['<u>z</u>'] }],
      [{}],
    );
    expect(table.querySelector('b, i, u')).toBeNull();
    expect(table.textContent).toContain('<b>x</b>');
    expect(table.textContent).toContain('<u>z</u>');
  });

  it("writes each row's own position (a tie shares one), not its place in the list", () => {
    const table = renderStandingsTable(
      [
        { position: 1, name: 'A', cells: [] },
        { position: 2, name: 'B', cells: [] },
        { position: 2, name: 'C', cells: [] },
        { position: 4, name: 'D', cells: [] },
      ],
      [],
    );
    expect([...table.querySelectorAll('.stage-standing-pos')].map((td) => td.textContent)).toEqual([
      '1',
      '2',
      '2',
      '4',
    ]);
  });

  it('writes a number as its text, and nothing for a missing value, instead of failing', () => {
    const table = renderStandingsTable(
      [{ position: 1, name: 'A', cells: [7, 0, undefined, null] }],
      [],
    );
    expect([...table.querySelectorAll('.stage-standing-cell')].map((td) => td.textContent)).toEqual(
      ['7', '0', '', ''],
    );
  });

  it('is an empty body for no rows', () => {
    expect(renderStandingsTable([], []).querySelectorAll('tr')).toHaveLength(0);
  });
});

describe('renderChampion', () => {
  it('is a label, the name, and the optional score and podium lines, in that order', () => {
    const nodes = renderChampion({
      name: 'Ayu',
      scoreLine: '5/7 · 3:21',
      podiumLine: '2nd Bima · 3rd Citra',
    });
    expect(nodes.map((n) => n.className)).toEqual([
      'stage-champion-label',
      'stage-champion-name',
      'stage-champion-score',
      'stage-podium',
    ]);
    expect(nodes.map((n) => n.textContent)).toEqual([
      'Champion',
      'Ayu',
      '5/7 · 3:21',
      '2nd Bima · 3rd Citra',
    ]);
    expect(nodes[1].tagName).toBe('H2');
  });

  it('leaves out a score or podium line that is not given', () => {
    expect(renderChampion({ name: 'Ayu' }).map((n) => n.className)).toEqual([
      'stage-champion-label',
      'stage-champion-name',
    ]);
    expect(renderChampion({ name: 'Ayu', podiumLine: '2nd Bima' }).map((n) => n.className)).toEqual(
      ['stage-champion-label', 'stage-champion-name', 'stage-podium'],
    );
  });

  it('takes its own label (a format may say "Winner")', () => {
    expect(renderChampion({ label: 'Winner', name: 'Ayu' })[0].textContent).toBe('Winner');
  });

  it('shows the name as text, never markup', () => {
    const [, name] = renderChampion({ name: '<img src=x onerror=alert(1)>' });
    expect(name.querySelector('img')).toBeNull();
  });

  it('shows the label, the score line and the podium line as text, never markup', () => {
    const nodes = renderChampion({
      label: '<b>L</b>',
      name: 'Ayu',
      scoreLine: '<i>S</i>',
      podiumLine: '<u>P</u>',
    });
    for (const node of nodes) expect(node.querySelector('b, i, u')).toBeNull();
    expect(nodes.map((n) => n.textContent)).toEqual(['<b>L</b>', 'Ayu', '<i>S</i>', '<u>P</u>']);
  });

  it('shows a score line without a podium line', () => {
    expect(renderChampion({ name: 'Ayu', scoreLine: '5/7' }).map((n) => n.className)).toEqual([
      'stage-champion-label',
      'stage-champion-name',
      'stage-champion-score',
    ]);
  });
});

describe('what the stylesheet must keep doing (jsdom cannot lay it out, so these pin the rules)', () => {
  let css;
  let html;
  // The body of the rule that starts with exactly this selector.
  const rule = (selector) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) return '';
    return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };

  beforeAll(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    css = fs
      .readFileSync(path.join(dir, 'stageVocabulary.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    html = fs.readFileSync(path.join(dir, '../../app/index.html'), 'utf8');
  });

  it('cuts a long name with an ellipsis and never cuts the tie or advancing words', () => {
    expect(rule('.stage-name-text')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.stage-name-text')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.stage-name-suffix')).toMatch(/flex:\s*none/);
  });

  it('lets the name cell shrink instead of widening the table, and keeps value cells right-aligned and unwrapped', () => {
    expect(rule('.stage-standing-name')).toMatch(/max-width:\s*0/);
    expect(rule('.stage-standing-cell')).toMatch(/text-align:\s*right/);
    expect(rule('.stage-standing-cell')).toMatch(/white-space:\s*nowrap/);
  });

  it('sizes from --stage-fit and never from vh, so a banner or odd aspect cannot crop a screen', () => {
    expect(css).toMatch(/--stage-fit/);
    expect(css).not.toMatch(/\d(dvh|vh|cqh)/);
  });

  it('is linked by the app, before the format stylesheets that refine it', () => {
    const vocabulary = html.indexOf('/src/core/stageVocabulary.css');
    expect(vocabulary).toBeGreaterThan(-1);
    expect(vocabulary).toBeGreaterThan(html.indexOf('/src/core/stageDisplay.css'));
    expect(vocabulary).toBeLessThan(html.indexOf('/src/formats/cup-taster/projectorScreens.css'));
    expect(vocabulary).toBeLessThan(html.indexOf('/src/formats/cup-taster/projectorMoments.css'));
  });
});
