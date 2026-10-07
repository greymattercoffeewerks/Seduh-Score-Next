import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildResultsSheet,
  mountResultsSheet,
  sheetContentFor,
  syncScrollHint,
} from './resultsSheet.js';
import { formatDurationLong } from '../core/duration.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

function fakeClient(response) {
  return {
    from() {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
}

function payload(overrides = {}) {
  return {
    format: 'cup_taster',
    eventName: 'October Cup',
    city: 'Bandar Seri Begawan',
    venue: 'Sports Hub',
    eventDate: '2026-10-04',
    competitors: 4,
    rounds: 2,
    winningTimeSecs: 235,
    podium: [
      { rank: 1, name: 'Alex', cafe: 'Kedai Runduk', correct: 3, total: 7 },
      { rank: 2, name: 'Sam', cafe: null, correct: 3, total: 7 },
      { rank: 3, name: 'Jo', cafe: 'Ambang', correct: 2, total: 7 },
    ],
    ...overrides,
  };
}

const STANDINGS = [
  {
    place: 1,
    name: 'Alex',
    cafe: 'Kedai Runduk',
    round: 'Finals',
    correct: 3,
    total: 7,
    timeSecs: 235,
  },
  { place: 2, name: 'Sam', cafe: null, round: 'Finals', correct: 3, total: 7, timeSecs: 289 },
  {
    place: 3,
    name: 'Jo',
    cafe: 'Ambang',
    round: 'Semi-Finals',
    correct: 2,
    total: 7,
    timeSecs: 355,
  },
  { place: 3, name: 'Kai', cafe: null, round: 'Semi-Finals', correct: 2, total: 7, timeSecs: 380 },
  { place: 5, name: 'Lee', cafe: null, round: 'Preliminary', correct: 1, total: 5, timeSecs: 262 },
];

const rowText = (sheet) =>
  [...sheet.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.children].map((cell) => cell.textContent),
  );
const headers = (sheet) => [...sheet.querySelectorAll('thead th')].map((th) => th.textContent);

describe('sheetContentFor', () => {
  it('prints the full standings when the organiser published them', () => {
    const content = sheetContentFor(payload({ standings: STANDINGS }));
    expect(content.kind).toBe('standings');
    expect(content.rows.map((row) => row.name)).toEqual(['Alex', 'Sam', 'Jo', 'Kai', 'Lee']);
  });

  it('prints the podium when no standings were published, taking each rank as that row’s place', () => {
    const content = sheetContentFor(payload());
    expect(content.kind).toBe('podium');
    expect(content.rows.map((row) => [row.place, row.name])).toEqual([
      [1, 'Alex'],
      [2, 'Sam'],
      [3, 'Jo'],
    ]);
  });

  it('falls back to the podium for an empty standings list rather than printing an empty table', () => {
    expect(sheetContentFor(payload({ standings: [] })).kind).toBe('podium');
  });

  it('drops rows without a usable name and ignores anything that is not a standings row', () => {
    const content = sheetContentFor(
      payload({
        standings: [
          null,
          'oops',
          { place: 1 },
          { name: '   ' },
          { name: 123 },
          { name: 'Real', place: 2 },
          7,
        ],
      }),
    );
    expect(content.rows.map((row) => row.name)).toEqual(['Real']);
  });

  it('keeps only numbers that really are numbers', () => {
    const [row] = sheetContentFor(
      payload({
        standings: [{ name: 'A', place: '1', correct: NaN, total: Infinity, timeSecs: null }],
      }),
    ).rows;
    expect(row).toMatchObject({ place: null, correct: null, total: null, timeSecs: null });
  });

  it('keeps only text that really is text — an object or number in a café or round becomes nothing', () => {
    const [row] = sheetContentFor(
      payload({ standings: [{ name: 'A', cafe: { x: 1 }, round: 5 }] }),
    ).rows;
    expect(row.cafe).toBeNull();
    expect(row.round).toBeNull();
    const [podiumRow] = sheetContentFor(
      payload({ podium: [{ rank: 1, name: 'B', cafe: ['x'] }] }),
    ).rows;
    expect(podiumRow.cafe).toBeNull();
  });

  it('tolerates a payload with no podium at all', () => {
    expect(sheetContentFor({ podium: undefined })).toEqual({ kind: 'podium', rows: [] });
  });
});

describe('buildResultsSheet', () => {
  it('prints the event’s name, date, place and facts', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    expect(sheet.querySelector('h1').textContent).toBe('October Cup');
    expect(sheet.querySelector('.results-sheet-meta').textContent).toBe(
      '04 Oct 2026 · Sports Hub · Bandar Seri Begawan',
    );
    expect(sheet.querySelector('.results-sheet-facts').textContent).toContain('4 competitors');
    expect(sheet.querySelector('.results-sheet-facts').textContent).toContain('2 rounds');
    expect(sheet.querySelector('.results-sheet-facts').textContent).toContain('3:55');
    expect(sheet.querySelector('.results-sheet-kicker').textContent).toContain('Cup Taster');
  });

  it('shows the full standings with score and time first and the round reached last, ties as published', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    expect(headers(sheet)).toEqual(['Place', 'Competitor', 'Café', 'Score', 'Time', 'Reached']);
    const rows = rowText(sheet);
    expect(rows).toHaveLength(5);
    // The two third-placed competitors both read 3, and the next is 5th — not renumbered.
    expect(rows.map((cells) => cells[0])).toEqual(['1', '2', '3', '3', '5']);
    expect(rows[0].slice(1, 3)).toEqual(['Alex', 'Kedai Runduk']);
    expect(rows[0][3]).toContain('3/7');
    expect(rows[0][4]).toContain('3:55');
    expect(rows[0][5]).toBe('Finals');
    expect(rows[4][3]).toContain('1/5');
    expect(rows[4][5]).toBe('Preliminary');
  });

  it('shows the podium table — without the full-standings columns — when only the podium was published, each table named for its event', () => {
    const sheet = buildResultsSheet(payload());
    expect(headers(sheet)).toEqual(['Place', 'Competitor', 'Café', 'Score']);
    expect(rowText(sheet)).toHaveLength(3);
    expect(sheet.querySelector('caption').textContent).toBe('Podium — October Cup');
    expect(
      buildResultsSheet(payload({ standings: STANDINGS })).querySelector('caption').textContent,
    ).toBe('Full standings — October Cup');
  });

  it('reads a score as words for a screen reader, and a time with its long form', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    const cells = [...sheet.querySelector('tbody tr').children];
    expect(cells[3].querySelector('.sr-only').textContent).toBe('3 correct out of 7');
    expect(cells[4].querySelector('.sr-only').textContent).toBe(formatDurationLong(235));
  });

  it('shows a dash, not a made-up value, where a café, round, score or time was not published', () => {
    const sheet = buildResultsSheet(payload({ standings: [{ name: 'Alone', place: 1 }] }));
    expect(rowText(sheet)[0]).toEqual(['1', 'Alone', '—', '—', '—', '—']);
  });

  it('prints only the fixed public fields from the full standings — contact details and set marks on a row never reach the page', () => {
    const sheet = buildResultsSheet(
      payload({
        phone: '+6738123456',
        email: 'top@example.com',
        standings: [
          {
            ...STANDINGS[0],
            phone: '+6738000000',
            email: 'alex@example.com',
            setMarks: ['Y', 'N'],
            notes: 'secret',
          },
        ],
      }),
    );
    expect(sheet.textContent).not.toMatch(/8123456|8000000|example\.com|secret/);
    expect(sheet.innerHTML).not.toMatch(/8123456|8000000|example\.com|secret/);
  });

  it('prints only the fixed public fields from the podium too', () => {
    const withExtras = payload({
      podium: [
        {
          ...payload().podium[0],
          phone: '+6738000000',
          email: 'alex@example.com',
          setMarks: ['Y'],
        },
      ],
    });
    const sheet = buildResultsSheet(withExtras);
    expect(headers(sheet)).toEqual(['Place', 'Competitor', 'Café', 'Score']);
    expect(sheet.innerHTML).not.toMatch(/8000000|example\.com|setMarks/);
    expect(Object.keys(sheetContentFor(withExtras).rows[0]).sort()).toEqual(
      ['cafe', 'correct', 'name', 'place', 'round', 'timeSecs', 'total'].sort(),
    );
  });

  it('renders markup in a title, venue, name, café or round as plain text, never as elements', () => {
    const hostile = {
      eventName: '<img src=x onerror=alert(1)> Cup',
      venue: '<i>venue</i>',
      city: '<u>city</u>',
      standings: [
        {
          place: 1,
          name: '<b>Bold</b>',
          cafe: '<script>alert(1)</script>',
          round: '<u>round</u>',
          correct: 1,
          total: 1,
          timeSecs: 5,
        },
      ],
    };
    const sheet = buildResultsSheet(payload(hostile));
    expect(sheet.querySelector('img, script, i, u')).toBeNull();
    // Text only: nothing the payload said became an element in any of these places.
    expect(sheet.querySelector('h1').children).toHaveLength(0);
    expect(sheet.querySelector('.results-sheet-meta').children).toHaveLength(0);
    expect(sheet.querySelector('.results-sheet-meta').textContent).toContain('<i>venue</i>');
    const [, nameCell, cafeCell, , , roundCell] = sheet.querySelector('tbody tr').children;
    for (const cell of [nameCell, cafeCell, roundCell]) expect(cell.children).toHaveLength(0);
    expect(nameCell.textContent).toBe('<b>Bold</b>');
    expect(cafeCell.textContent).toBe('<script>alert(1)</script>');
    expect(roundCell.textContent).toBe('<u>round</u>');

    // ...and on the podium path.
    const podiumSheet = buildResultsSheet(
      payload({ podium: [{ rank: 1, name: '<b>x</b>', cafe: '<i>c</i>', correct: 1, total: 1 }] }),
    );
    const [, podiumName, podiumCafe] = podiumSheet.querySelector('tbody tr').children;
    expect(podiumName.children).toHaveLength(0);
    expect(podiumCafe.children).toHaveLength(0);
    expect(podiumName.textContent).toBe('<b>x</b>');
  });

  it('never prints "[object Object]", "NaN" or "undefined" for fields of the wrong type', () => {
    const sheet = buildResultsSheet(
      payload({
        eventName: 42,
        competitors: '4',
        rounds: {},
        winningTimeSecs: 'fast',
        venue: {},
        city: 7,
      }),
    );
    expect(sheet.querySelector('h1').textContent).toBe('Results');
    expect(sheet.querySelector('.results-sheet-facts')).toBeNull();
    expect(sheet.querySelector('.results-sheet-meta').textContent).toBe('04 Oct 2026');
    expect(sheet.textContent).not.toMatch(/\[object|NaN|undefined/);
  });

  it('builds the sheet, minus the date, when the event date is not a real date — it never throws', () => {
    expect(() => buildResultsSheet(payload({ eventDate: 'not-a-date', podium: [] }))).not.toThrow();
    const sheet = buildResultsSheet(payload({ eventDate: 'soon' }));
    expect(sheet.querySelector('.results-sheet-meta').textContent).toBe(
      'Sports Hub · Bandar Seri Begawan',
    );
    expect(sheet.textContent).not.toMatch(/Invalid/);
    // A date that is not text at all is no date either.
    const numeric = buildResultsSheet(payload({ eventDate: 20261004 }));
    expect(numeric.querySelector('.results-sheet-meta').textContent).not.toContain('2026');
  });

  it('says how many competitors are not listed in the full standings, in the singular and the plural', () => {
    const one = buildResultsSheet(payload({ standings: STANDINGS, notListed: 1 }));
    expect(one.textContent).toContain(
      '1 competitor is not listed — they withdrew or did not take part.',
    );
    const many = buildResultsSheet(payload({ standings: STANDINGS, notListed: 3 }));
    expect(many.textContent).toContain(
      '3 competitors are not listed — they withdrew or did not take part.',
    );
  });

  it('says nothing about anyone being left out when nobody was, on a podium-only sheet, or for a count that is not a number', () => {
    expect(buildResultsSheet(payload({ standings: STANDINGS })).textContent).not.toContain(
      'not listed',
    );
    expect(
      buildResultsSheet(payload({ standings: STANDINGS, notListed: 0 })).textContent,
    ).not.toContain('not listed');
    expect(buildResultsSheet(payload({ notListed: 2 })).textContent).not.toContain('not listed');
    expect(
      buildResultsSheet(payload({ standings: STANDINGS, notListed: '2' })).textContent,
    ).not.toContain('not listed');
  });

  it('says plainly when there is nothing to list, rather than printing an empty table', () => {
    const sheet = buildResultsSheet(payload({ podium: [], standings: undefined }));
    expect(sheet.querySelector('table')).toBeNull();
    expect(sheet.querySelector('.results-sheet-scroll-hint')).toBeNull();
    expect(sheet.textContent).toContain('No placings were published for this event.');
  });

  it('explains how to read the placings and says when and where it was published', () => {
    const sheet = buildResultsSheet(
      payload({ standings: STANDINGS, publishedAt: '2026-10-05T13:59:00Z' }),
    );
    const notes = [...sheet.querySelectorAll('.results-sheet-note')].map(
      (note) => note.textContent,
    );
    expect(notes.join(' ')).toContain('last round they reached');
    expect(notes.join(' ')).toContain('time is their total time in it');
    expect(notes.join(' ')).toContain('Published 05 Oct 2026');
    expect(notes.join(' ')).toContain('seduhscore.com/results');
  });

  it('leaves the published date out rather than printing "Invalid Date"', () => {
    const sheet = buildResultsSheet(payload({ publishedAt: 'not a date' }));
    expect(sheet.textContent).not.toMatch(/Invalid|NaN/);
    expect(sheet.textContent).not.toContain('Published ');
  });

  it('names a non-Cup-Taster format correctly and falls back to a plain title when the event has no name', () => {
    const sheet = buildResultsSheet(payload({ format: 'btc', eventName: undefined }));
    expect(sheet.querySelector('.results-sheet-kicker').textContent).toContain('BTC');
    expect(sheet.querySelector('h1').textContent).toBe('Results');
  });

  it('puts the table in a keyboard-reachable scroll region named for the event, with a cue for sighted phone users', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    const wrap = sheet.querySelector('.results-sheet-table-wrap');
    expect(wrap.getAttribute('role')).toBe('region');
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(wrap.getAttribute('aria-label')).toBe('October Cup — full standings, scrollable table');
    expect(wrap.querySelector('table')).not.toBeNull();
    // The cue is for eyes only: a screen reader already hears the region is scrollable.
    expect(sheet.querySelector('.results-sheet-scroll-hint').getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(
      buildResultsSheet(payload())
        .querySelector('.results-sheet-table-wrap')
        .getAttribute('aria-label'),
    ).toBe('October Cup — podium, scrollable table');
  });
});

describe('syncScrollHint', () => {
  // jsdom does no layout, so a table's width is stated outright.
  function sized(sheet, { scrollWidth, clientWidth }) {
    const wrap = sheet.querySelector('.results-sheet-table-wrap');
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: clientWidth });
  }
  const hintOn = (sheet) =>
    sheet.querySelector('.results-sheet-scroll-hint').hasAttribute('data-active');

  it('turns the cue on while the table overflows its region, and off again when it fits', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    expect(hintOn(sheet)).toBe(false); // nothing is measured until asked
    sized(sheet, { scrollWidth: 437, clientWidth: 280 });
    syncScrollHint(sheet);
    expect(hintOn(sheet)).toBe(true);
    sized(sheet, { scrollWidth: 280, clientWidth: 280 });
    syncScrollHint(sheet);
    expect(hintOn(sheet)).toBe(false);
  });

  it('is not fooled by a sub-pixel difference between the two widths', () => {
    const sheet = buildResultsSheet(payload({ standings: STANDINGS }));
    sized(sheet, { scrollWidth: 281, clientWidth: 280 });
    syncScrollHint(sheet);
    expect(hintOn(sheet)).toBe(false);
  });

  it('does nothing, and does not throw, for a sheet with no table', () => {
    const sheet = buildResultsSheet(payload({ podium: [], standings: undefined }));
    expect(() => syncScrollHint(sheet)).not.toThrow();
  });
});

describe('mountResultsSheet', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    document.title = 'Seduh Score';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const rows = (...extra) => [
    {
      event_id: 'ev1',
      payload: payload({ standings: STANDINGS }),
      published_at: '2026-10-05T13:59:00Z',
    },
    ...extra,
  ];
  const announced = () => root.querySelector('[role="status"]').textContent;

  it('shows the sheet for the requested event and names the page after it, so the saved PDF is too', async () => {
    await mountResultsSheet(root, {
      eventId: 'ev1',
      client: fakeClient({ data: rows(), error: null }),
    });
    expect(root.querySelector('.results-sheet-paper h1').textContent).toBe('October Cup');
    expect(document.title).toBe('October Cup — Results');
  });

  it('moves focus to the sheet’s heading and announces it is ready', async () => {
    await mountResultsSheet(root, {
      eventId: 'ev1',
      client: fakeClient({ data: rows(), error: null }),
    });
    expect(document.activeElement).toBe(root.querySelector('.results-sheet-paper h1'));
    expect(announced()).toBe('Results sheet for October Cup is ready.');
  });

  it('keeps one live region, in place, as the page moves from loading to the sheet', async () => {
    let release;
    const client = {
      from: () => ({
        select: () => ({
          order: () =>
            new Promise((resolve) => {
              release = () => resolve({ data: rows(), error: null });
            }),
        }),
      }),
    };
    const mounting = mountResultsSheet(root, { eventId: 'ev1', client });
    const live = root.querySelector('[role="status"]');
    expect(live.textContent).toBe('Loading the results sheet…');
    expect(root.querySelector('h1').textContent).toBe('Results sheet');
    release();
    await mounting;
    expect(root.querySelector('[role="status"]')).toBe(live);
    expect(live.textContent).toContain('is ready');
  });

  it('picks the requested event out of several, never another one', async () => {
    const other = {
      event_id: 'ev2',
      payload: payload({ eventName: 'Earlier Cup' }),
      published_at: '2026-08-02T10:00:00Z',
    };
    await mountResultsSheet(root, {
      eventId: 'ev2',
      client: fakeClient({ data: rows(other), error: null }),
    });
    expect(root.querySelector('.results-sheet-paper h1').textContent).toBe('Earlier Cup');
  });

  it('opens the browser’s print dialog from the Print / Save as PDF button, and says how to save on a phone', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await mountResultsSheet(root, {
      eventId: 'ev1',
      client: fakeClient({ data: rows(), error: null }),
    });
    const button = root.querySelector('.results-sheet-button');
    expect(button.textContent).toBe('Print / Save as PDF');
    expect(root.querySelector('.results-sheet-help').textContent).toContain('iPhone or iPad');
    button.click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('links back to the archive and marks Results as the current page in the site header', async () => {
    await mountResultsSheet(root, {
      eventId: 'ev1',
      client: fakeClient({ data: rows(), error: null }),
    });
    expect(root.querySelector('.results-sheet-back').getAttribute('href')).toBe('/results/');
    expect(root.querySelector('.public-header-link-active').textContent).toBe('Results');
  });

  it('says the sheet is not available — under its own heading, with focus there — for an event that is not published', async () => {
    await mountResultsSheet(root, {
      eventId: 'gone',
      client: fakeClient({ data: rows(), error: null }),
    });
    expect(root.querySelector('.results-sheet-paper')).toBeNull();
    expect(root.querySelector('h1').textContent).toBe('Results sheet');
    expect(root.textContent).toContain('This results sheet is not available');
    expect(root.querySelector('.results-sheet-back')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(announced()).toContain('not available');
    expect(document.title).toBe('Results sheet — Seduh Score');
  });

  it('shows an error under its own heading when the results cannot be loaded, and Try again loads them', async () => {
    let attempt = 0;
    const client = {
      from: () => ({
        select: () => ({
          order: () => {
            attempt += 1;
            return Promise.resolve(
              attempt === 1
                ? { data: null, error: new Error('network error') }
                : { data: rows(), error: null },
            );
          },
        }),
      }),
    };
    await mountResultsSheet(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('Something went wrong loading the results sheet');
    expect(root.querySelector('h1').textContent).toBe('Results sheet');
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(document.title).toBe('Results sheet — Seduh Score');

    const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    retry.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('.results-sheet-paper h1').textContent).toBe('October Cup');
  });

  it('switches the scroll cue on after mounting when the table overflows, and follows a resize', async () => {
    let tableWidth = 500;
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList.contains('results-sheet-table-wrap') ? tableWidth : 0;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function () {
      return this.classList.contains('results-sheet-table-wrap') ? 300 : 0;
    });
    await mountResultsSheet(root, {
      eventId: 'ev1',
      client: fakeClient({ data: rows(), error: null }),
    });
    const hint = root.querySelector('.results-sheet-scroll-hint');
    expect(hint.hasAttribute('data-active')).toBe(true);

    tableWidth = 300; // the window is widened until the table fits
    window.dispatchEvent(new Event('resize'));
    expect(hint.hasAttribute('data-active')).toBe(false);
  });

  it('holds focus on the page’s heading through Try again, rather than dropping it to the page', async () => {
    let attempt = 0;
    const client = {
      from: () => ({
        select: () => ({
          order: () => {
            attempt += 1;
            return attempt === 1
              ? Promise.resolve({ data: null, error: new Error('network error') })
              : new Promise(() => {}); // the retry is still loading
          },
        }),
      }),
    };
    await mountResultsSheet(root, { eventId: 'ev1', client });
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click();

    expect(root.textContent).toContain('Loading the results sheet');
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(document.activeElement.textContent).toBe('Results sheet');
  });

  it('says the load is slow rather than hanging on "Loading…" forever, and offers Try again', async () => {
    vi.useFakeTimers();
    const client = { from: () => ({ select: () => ({ order: () => new Promise(() => {}) }) }) };
    const mounting = mountResultsSheet(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('Loading the results sheet');
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
    await mounting;
    expect(root.textContent).toContain('taking longer than expected');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(
      true,
    );
  });
});
