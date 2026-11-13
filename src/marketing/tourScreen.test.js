import { beforeEach, describe, expect, it } from 'vitest';
import { BTC_BOARD, btcBoardTotals, mountTourScreen } from './tourScreen.js';
import {
  FORMATS,
  countLine,
  onTheWay,
  pickerFormats,
  publicFormats,
  waysToPlay,
} from './tourFormats.js';

const clone = () => structuredClone(FORMATS);
const byId = (list, id) => list.find((f) => f.id === id);

// A made-up live format, with the copy a live format needs and no media of its own.
const extraLive = () => ({
  id: 'extra-live',
  name: 'Extra Live',
  kind: 'Teams',
  status: 'live',
  public: true,
  icon: 'bracket',
  description: 'A format added later.',
  section: { kicker: 'Later', copy: 'Added by one list entry.', gets: ['One thing'] },
  compare: {
    who: 'Somebody',
    won: 'Somehow',
    shape: 'Some shape',
    screen: 'Some screen',
    goodFor: 'Something',
  },
  modes: [],
});

const extraPlanned = () => ({
  id: 'extra-planned',
  name: 'Extra Planned',
  kind: 'League',
  status: 'planned',
  public: true,
  icon: 'league',
  description: 'A planned format added later.',
  modes: [],
});

describe('mountTourScreen', () => {
  let root;
  const mount = (formats) => {
    mountTourScreen(root, formats ? { formats } : undefined);
    return root;
  };
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('links Cup Taster to the organiser console with its own real event photo', () => {
    mount();
    expect(root.querySelector('#cup-taster')).not.toBeNull();
    const cupLink = root.querySelector('#cup-taster .tour-primary-link');
    expect(cupLink.getAttribute('href')).toBe('/app/#/events');
    expect(cupLink.textContent).toContain('Open Cup Taster');
    expect(root.querySelector('.tour-cup-media img').getAttribute('src')).toBe(
      '/marketing/hero-cupping-bowls.jpg',
    );
  });

  it('lists BTC as live too, with an aria-hidden illustration board and no fabricated photo', () => {
    mount();
    const btcSection = root.querySelector('#btc');
    expect(btcSection).not.toBeNull();
    expect(btcSection.querySelector('h2').textContent).toBe('BTC.');
    const btcLink = btcSection.querySelector('.tour-primary-link');
    expect(btcLink.getAttribute('href')).toBe('/app/#/events');
    expect(btcLink.textContent).toContain('Open BTC');
    // No <img>: BTC has no real event photography, so the section must not imply a photo it doesn't have.
    expect(btcSection.querySelector('img')).toBeNull();
    const board = btcSection.querySelector('.tour-board');
    expect(board.getAttribute('aria-hidden')).toBe('true');
    expect(board.textContent).toContain('Illustration');
  });

  it('describes BTC as rounds, a cut to the top 8 and a knockout, not the old round-robin bracket', () => {
    mount();
    const text = root.querySelector('#btc .tour-copy').textContent;
    expect(text).toMatch(/preliminary rounds/i);
    expect(text).toMatch(/top 8/);
    expect(text).toMatch(/knockout/i);
    expect(text).not.toMatch(/round-robin|quarterfinal/i);
  });

  it('draws the BTC board from real token scoring: three tokens a cup, +5 more tokens, +2 fastest', () => {
    expect(BTC_BOARD.cups).toHaveLength(15);
    for (const [a, b] of BTC_BOARD.cups) expect(a + b).toBe(3);
    const { tokens, total } = btcBoardTotals();
    expect(tokens).toEqual([26, 19]);
    expect(total).toEqual([31, 21]);
    mount();
    const board = root.querySelector('#btc .tour-board');
    expect(board.querySelector('.tour-score').textContent).toBe('31:21');
    expect(board.querySelectorAll('.tour-cupcell')).toHaveLength(15);
    expect(board.textContent).toContain('Tokens 26–19');
    expect(board.textContent).toContain('+5');
    expect(board.textContent).toContain('+2');
  });

  it('lists Throwdown as live with an illustration bracket, no photo and no redemption claim', () => {
    mount();
    const section = root.querySelector('#throwdown');
    expect(section).not.toBeNull();
    expect(section.querySelector('h2').textContent).toBe('Throwdown.');
    const link = section.querySelector('.tour-primary-link');
    expect(link.getAttribute('href')).toBe('/app/#/events');
    expect(link.textContent).toContain('Open Throwdown');
    expect(section.querySelector('img')).toBeNull();
    const board = section.querySelector('.tour-board');
    expect(board.getAttribute('aria-hidden')).toBe('true');
    expect(board.textContent).toContain('Illustration');
    // Redemption and revival are not built: the section may only name them as coming later.
    expect(section.querySelector('.tour-copy').textContent).not.toMatch(/redemption|revival/i);
    expect(section.querySelector('.tour-gets').textContent).not.toMatch(/redemption|revival/i);
    expect(section.querySelector('.tour-note').textContent).toMatch(/later/i);
  });

  it('numbers the sections from the list: three live formats, On the way 04, Community 05', () => {
    mount();
    const numbers = [...root.querySelectorAll('.tour-section-label > span:first-child')].map(
      (node) => node.textContent,
    );
    expect(numbers).toEqual(['?', '01', '02', '03', '+', '04', '05']);
  });

  it('lists all live formats in the shared public header\'s own "Live —" indicator, not just Cup Taster', () => {
    mount();
    expect(root.querySelector('.public-header-live').textContent).toContain(
      'Live — Cup Taster, BTC, Throwdown',
    );
  });

  it('finishes with all four Community tools and the hub', () => {
    mount();
    const links = [...root.querySelectorAll('#community a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toEqual([
      '/tools/timer/',
      '/tools/brew-planner/',
      '/tools/random-selector/',
      '/guess-the-bean/',
      '/community/',
    ]);
    expect(root.querySelector('.public-header-link-active').textContent).toBe('Formats');
    expect(root.querySelector('.public-footer-link').getAttribute('href')).toBe('/community/');
  });

  it('puts the comparison table in a sideways-scrolling wrapper, one column per live format', () => {
    mount();
    const wrapper = root.querySelector('.tour-table-scroll');
    expect(wrapper.querySelector('table')).not.toBeNull();
    // a scroll region must be keyboard-reachable and named
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('role')).toBe('region');
    expect(wrapper.getAttribute('aria-labelledby')).toBe('compare-title');
    const heads = [...wrapper.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toEqual(['At a glance', 'Cup Taster', 'BTC', 'Throwdown']);
    expect(wrapper.querySelectorAll('tbody tr')).toHaveLength(5);
    for (const row of wrapper.querySelectorAll('tbody tr'))
      expect(row.querySelectorAll('td')).toHaveLength(3);
  });

  it('says what is shared by every format, without claims that do not hold for all three', () => {
    mount();
    const titles = [...root.querySelectorAll('.tour-shared h3')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Audience screens',
      'Patchy Wi-Fi is fine',
      'Test events look like tests',
      'A team at the table',
    ]);
    // Only BTC exports CSV, only BTC has the cut: neither may appear in the all-formats strip.
    expect(root.querySelector('.tour-shared').textContent).not.toMatch(/csv|the cut|bracket/i);
  });
});

describe('the format picker is driven by one list', () => {
  let root;
  const mount = (formats) => {
    mountTourScreen(root, formats ? { formats } : undefined);
  };
  const pickerNames = () =>
    [...root.querySelectorAll('.tour-pick-name')].map((node) => node.textContent);

  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('shows one card per public format, live first and the planned format last', () => {
    mount();
    expect(pickerNames()).toEqual(['Cup Taster', 'BTC', 'Throwdown', 'Liga Seduh']);
    const links = [...root.querySelectorAll('.tour-pick')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['#cup-taster', '#btc', '#throwdown', '#next']);
    expect(root.querySelector('.tour-picker').getAttribute('aria-label')).toBe('Formats');
  });

  it('orders live, then testing, then planned, whatever order the list is in', () => {
    const list = clone();
    list.unshift({ ...extraPlanned(), id: 'p1', name: 'Planned First' });
    list.push({ ...extraPlanned(), id: 't1', name: 'Testing Last', status: 'testing' });
    expect(pickerFormats(list).map((f) => f.name)).toEqual([
      'Cup Taster',
      'BTC',
      'Throwdown',
      'Testing Last',
      'Planned First',
      'Liga Seduh',
    ]);
  });

  it('an extra list entry adds a picker card, wrapping in an auto-fill grid', () => {
    const list = clone();
    list.push(extraPlanned());
    mount(list);
    expect(pickerNames()).toEqual([
      'Cup Taster',
      'BTC',
      'Throwdown',
      'Liga Seduh',
      'Extra Planned',
    ]);
  });

  it('an extra LIVE entry also gets a section, a table column and the next section number', () => {
    const list = clone();
    list.splice(3, 0, extraLive());
    mount(list);
    expect(root.querySelector('#extra-live h2').textContent).toBe('Extra Live.');
    expect(root.querySelector('#extra-live img')).toBeNull();
    expect(root.querySelector('.tour-pick[data-format="extra-live"]').getAttribute('href')).toBe(
      '#extra-live',
    );
    const heads = [...root.querySelectorAll('.tour-table thead th')].map((th) => th.textContent);
    expect(heads).toContain('Extra Live');
    const numbers = [...root.querySelectorAll('.tour-section-label > span:first-child')].map(
      (node) => node.textContent,
    );
    expect(numbers).toEqual(['?', '01', '02', '03', '04', '+', '05', '06']);
    expect(root.querySelector('.page-hero-intro').textContent).toMatch(/^Four live/);
  });

  it('the BTC tie rule awards no +5 to either team', () => {
    expect(
      btcBoardTotals({
        cups: [
          [2, 1],
          [1, 2],
        ],
        moreTokensBonus: 5,
        fastestBonus: 2,
        fastestTeam: 0,
      }),
    ).toEqual({ tokens: [3, 3], total: [5, 3], moreTokens: -1 });
  });

  it('computes the count line from the list', () => {
    expect(countLine(FORMATS)).toBe('3 live · 1 mode in testing · 1 planned');
    mount();
    expect(root.querySelector('.tour-picker-count').textContent).toBe(
      '3 live · 1 mode in testing · 1 planned',
    );
    const list = clone();
    list.push(extraPlanned(), { ...extraPlanned(), id: 'x2', status: 'testing' });
    byId(list, 'cup-taster').modes.push({
      id: 'm3',
      name: 'Third',
      status: 'testing',
      public: true,
      description: 'd',
    });
    expect(countLine(list)).toBe('3 live · 1 format in testing · 2 modes in testing · 2 planned');
  });

  it("shows a format's public modes as chips, testing modes in gold with their status in words", () => {
    mount();
    const chips = [...root.querySelectorAll('.tour-pick[data-format="cup-taster"] .tour-mode-tag')];
    expect(chips.map((c) => c.textContent)).toEqual(['Classic', 'Spoons Out! · In testing']);
    expect(chips[0].classList.contains('tour-state-testing')).toBe(false);
    expect(chips[1].classList.contains('tour-state-testing')).toBe(true);
    expect(root.querySelector('.tour-pick[data-format="btc"] .tour-mode-tag')).toBeNull();
  });

  it('public: false hides a format everywhere: picker, table, section, count and the pipeline', () => {
    const list = clone();
    byId(list, 'btc').public = false;
    byId(list, 'liga-seduh').public = false;
    mount(list);
    expect(pickerNames()).toEqual(['Cup Taster', 'Throwdown']);
    expect(root.querySelector('#btc')).toBeNull();
    expect([...root.querySelectorAll('.tour-table thead th')].map((t) => t.textContent)).toEqual([
      'At a glance',
      'Cup Taster',
      'Throwdown',
    ]);
    expect(root.textContent).not.toContain('Liga Seduh');
    expect(root.querySelector('.page-hero-intro').textContent).toMatch(/^Two live/);
    expect(root.querySelector('.public-header-live').textContent).toBe(
      'Live — Cup Taster, Throwdown',
    );
    expect(countLine(list)).toBe('2 live · 1 mode in testing');
    expect(publicFormats(list).map((f) => f.id)).toEqual(['cup-taster', 'throwdown']);
  });

  it('public: false on a mode hides it from the chips, Ways to play and On the way', () => {
    const list = clone();
    byId(list, 'cup-taster').modes[1].public = false;
    mount(list);
    expect(root.textContent).not.toContain('Spoons Out!');
    // one public mode left: no "Ways to play" list either
    expect(root.querySelector('.tour-modes')).toBeNull();
    expect(countLine(list)).toBe('3 live · 1 planned');
    expect(onTheWay(list).map((r) => r.name)).toEqual(['Liga Seduh']);
  });

  it('hides everything on the way when nothing is left to come', () => {
    const list = clone().filter((f) => f.id !== 'liga-seduh');
    byId(list, 'cup-taster').modes[1].public = false;
    mount(list);
    expect(root.querySelector('#next')).toBeNull();
    const numbers = [...root.querySelectorAll('.tour-section-label > span:first-child')].map(
      (node) => node.textContent,
    );
    expect(numbers).toEqual(['?', '01', '02', '03', '+', '04']);
  });
});

describe('ways to play and the On the way pipeline', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('lists Ways to play only for a format with two or more public modes', () => {
    mountTourScreen(root);
    expect(root.querySelectorAll('.tour-modes')).toHaveLength(1);
    expect(root.querySelector('#cup-taster .tour-modes')).not.toBeNull();
    expect(root.querySelector('#btc .tour-modes')).toBeNull();
    expect(root.querySelector('#throwdown .tour-modes')).toBeNull();
    const modes = [...root.querySelectorAll('#cup-taster .tour-mode')];
    expect(modes.map((m) => m.querySelector('b').textContent)).toEqual(['Classic', 'Spoons Out!']);
    expect(modes.map((m) => m.querySelector('.tag').textContent)).toEqual(['Live', 'In testing']);
  });

  it('a mode on another format gets a list once it has two modes, and not before', () => {
    const list = clone();
    const btc = byId(list, 'btc');
    const mode = (id) => ({ id, name: id, status: 'live', public: true, description: 'd' });
    btc.modes = [mode('one')];
    expect(waysToPlay(btc)).toEqual([]);
    mountTourScreen(root, { formats: list });
    expect(root.querySelector('#btc .tour-modes')).toBeNull();
    btc.modes.push(mode('two'));
    mountTourScreen(root, { formats: list });
    expect(root.querySelector('#btc .tour-modes')).not.toBeNull();
  });

  it('shows Spoons Out! as a Cup Taster mode In testing, then Liga Seduh as Planned', () => {
    mountTourScreen(root);
    const rows = [...root.querySelectorAll('.tour-next')];
    expect(rows.map((r) => r.querySelector('h3').textContent)).toEqual([
      'Spoons Out!',
      'Liga Seduh',
    ]);
    expect(rows[0].querySelector('.tour-family').textContent).toBe('Cup Taster mode');
    expect(rows[0].querySelector('.tag').textContent).toBe('In testing');
    expect(rows[1].querySelector('.tag').textContent).toBe('Planned');
    // Spoons Out! rules are not all locked: the row carries exactly the approved text, nothing added.
    expect(rows[0].querySelector('p').textContent).toBe(
      byId(FORMATS, 'cup-taster').modes[1].nextText,
    );
    expect(root.querySelector('#next').getAttribute('aria-labelledby')).toBe('next-title');
  });

  it('keeps BTC and Throwdown out of the pipeline: they are live', () => {
    mountTourScreen(root);
    const text = root.querySelector('#next').textContent;
    expect(text).not.toContain('BTC');
    expect(text).not.toContain('Throwdown');
  });

  it('every non-live public format or mode is a pipeline row, testing before planned', () => {
    const list = clone();
    list.push({ ...extraPlanned(), id: 'x', name: 'Zed', status: 'testing' });
    expect(onTheWay(list).map((r) => [r.name, r.status])).toEqual([
      ['Spoons Out!', 'testing'],
      ['Zed', 'testing'],
      ['Liga Seduh', 'planned'],
    ]);
  });
});
