import { describe, it, expect, vi } from 'vitest';
import {
  buildHome,
  collectAttention,
  countsLine,
  describeSafely,
  eventMeta,
  filterByFormat,
  findLiveEvent,
  findNextEvent,
  formatEventDate,
  rowTags,
} from './eventHome.js';

const NOW = new Date('2026-11-17T10:00:00Z');
const ev = (id, extra = {}) => ({
  id,
  name: `Event ${id}`,
  format: 'btc',
  event_date: null,
  venue: 'HQ',
  city: null,
  is_test: false,
  ended_at: null,
  ...extra,
});
const summaries = (entries) => new Map(Object.entries(entries));

describe('formatEventDate', () => {
  it('writes a calendar day this year without the year, and another year with it', () => {
    expect(formatEventDate('2026-11-21', NOW)).toBe('Sat 21 Nov');
    expect(formatEventDate('2027-03-05', NOW)).toBe('Fri 5 Mar 2027');
  });

  it('reads a calendar day in UTC, so no time zone moves it', () => {
    expect(formatEventDate('2026-12-31', new Date('2026-06-01T00:00:00Z'))).toBe('Thu 31 Dec');
    expect(formatEventDate('2026-11-21T23:30:00+08:00', NOW)).toBe('Sat 21 Nov');
  });

  it('answers null for anything that is not a date', () => {
    for (const bad of [null, undefined, '', 'soon', 20261121, '2026-13-45', '21/11/2026']) {
      expect(formatEventDate(bad, NOW), String(bad)).toBeNull();
    }
  });
});

describe('eventMeta', () => {
  it('joins what is set, in date, venue, city order, and nothing else', () => {
    expect(
      eventMeta({ event_date: '2026-11-21', venue: 'The Roastery', city: 'Gadong' }, NOW),
    ).toBe('Sat 21 Nov · The Roastery · Gadong');
    expect(eventMeta({ event_date: null, venue: '  ', city: 'Gadong' }, NOW)).toBe('Gadong');
    expect(eventMeta({}, NOW)).toBe('');
  });
});

describe('describeSafely', () => {
  it('turns a missing, empty or throwing describer into the empty answer', () => {
    const empty = {
      summary: null,
      ready: null,
      phase: null,
      next: null,
      progress: null,
      action: null,
      attention: [],
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(describeSafely(null, ev('a'), null)).toEqual(empty);
    expect(describeSafely(() => null, ev('a'), null)).toEqual(empty);
    expect(
      describeSafely(
        () => {
          throw new Error('bug');
        },
        ev('a'),
        null,
      ),
    ).toEqual(empty);
    spy.mockRestore();
  });

  it('passes the facts and the live flag, and cleans what comes back', () => {
    const describer = vi.fn(() => ({
      summary: '  3 teams  ',
      ready: 'yes',
      phase: '',
      next: 'next: x'.repeat(100),
      progress: { done: 12, total: 10, active: -1, text: 'six of ten' },
      action: { label: 'Go', href: 'javascript:alert(1)' },
    }));
    const info = describeSafely(describer, ev('a'), { isLive: true, facts: { teams: 3 } });
    expect(describer).toHaveBeenCalledWith(ev('a'), { teams: 3 }, { isLive: true });
    expect(info.summary).toBe('3 teams');
    expect(info.ready).toBeNull();
    expect(info.phase).toBeNull();
    expect(info.next.length).toBe(200);
    // never past its total, never negative
    expect(info.progress).toEqual({ done: 10, total: 10, active: 0, text: 'six of ten' });
    // an unsafe link is no link
    expect(info.action).toBeNull();
  });

  it('drops a progress with nothing to count', () => {
    expect(
      describeSafely(() => ({ progress: { done: 1, total: 0 } }), ev('a'), null).progress,
    ).toBeNull();
  });
});

describe('findLiveEvent and findNextEvent', () => {
  it('the live event is the open one whose session is active; a finished event is never live', () => {
    const events = [ev('done', { ended_at: '2026-10-01' }), ev('open')];
    const map = summaries({ done: { isLive: true }, open: { isLive: true } });
    expect(findLiveEvent(events, map).id).toBe('open');
    expect(findLiveEvent([events[0]], map)).toBeNull();
    expect(findLiveEvent(events, summaries({}))).toBeNull();
  });

  it('the next event is the soonest dated open one from today on', () => {
    const events = [
      ev('past', { event_date: '2026-11-01' }),
      ev('later', { event_date: '2026-12-05' }),
      ev('soon', { event_date: '2026-11-19' }),
      ev('today', { event_date: '2026-11-17' }),
    ];
    expect(findNextEvent(events, '2026-11-17').id).toBe('today');
    expect(findNextEvent(events.slice(0, 3), '2026-11-17').id).toBe('soon');
  });

  it('falls back to the newest open event when none is dated from today on, and ignores finished ones', () => {
    const events = [
      ev('newest-undated'),
      ev('old', { event_date: '2026-01-01' }),
      ev('done', { event_date: '2026-12-01', ended_at: '2026-12-02' }),
    ];
    expect(findNextEvent(events, '2026-11-17').id).toBe('newest-undated');
    expect(findNextEvent([events[2]], '2026-11-17')).toBeNull();
    expect(findNextEvent([], '2026-11-17')).toBeNull();
  });
});

describe('filterByFormat', () => {
  it('keeps everything for all, one format otherwise, and nothing for a format nobody has', () => {
    const events = [ev('a', { format: 'btc' }), ev('b', { format: 'cup_taster' })];
    expect(filterByFormat(events, 'all')).toHaveLength(2);
    expect(filterByFormat(events, undefined)).toHaveLength(2);
    expect(filterByFormat(events, 'btc').map((e) => e.id)).toEqual(['a']);
    expect(filterByFormat(events, 'throwdown')).toEqual([]);
  });
});

describe('buildHome', () => {
  const events = [
    ev('live'),
    ev('soon', { event_date: '2026-11-19' }),
    ev('setup', { format: 'throwdown' }),
    ev('done1', { ended_at: '2026-10-01' }),
    ev('done2', { ended_at: '2026-09-01', format: 'cup_taster' }),
  ];

  it('separates live, the rest of the open events and the finished ones, and counts them', () => {
    const home = buildHome({
      events,
      summariesById: summaries({ live: { isLive: true, facts: {} } }),
      today: '2026-11-17',
    });
    expect(home.liveView.event.id).toBe('live');
    expect(home.nextView).toBeNull();
    expect(home.upcoming.map((v) => v.event.id)).toEqual(['soon', 'setup']);
    expect(home.finished.map((v) => v.event.id)).toEqual(['done1', 'done2']);
    expect(home.counts).toEqual({ live: 1, comingUp: 2, finished: 2, total: 5 });
  });

  it('features the next event when nothing is live, and does not list it twice', () => {
    const home = buildHome({ events, summariesById: summaries({}), today: '2026-11-17' });
    expect(home.liveView).toBeNull();
    expect(home.nextView.event.id).toBe('soon');
    expect(home.upcoming.map((v) => v.event.id)).toEqual(['live', 'setup']);
    expect(home.counts.comingUp).toBe(3);
  });

  it('the format filter narrows both groups but never the card, the counts or the attention', () => {
    const home = buildHome({
      events: events.map((event) => (event.id === 'setup' ? { ...event, venue: '' } : event)),
      summariesById: summaries({ live: { isLive: true, facts: {} } }),
      formatFilter: 'cup_taster',
      today: '2026-11-17',
    });
    expect(home.liveView.event.id).toBe('live');
    expect(home.upcoming).toEqual([]);
    expect(home.finished.map((v) => v.event.id)).toEqual(['done2']);
    expect(home.counts.total).toBe(5);
    expect(home.attention.map((a) => a.id)).toEqual(['setup:venue']);
  });
});

describe('countsLine', () => {
  it('says what there is, leaves out what there is not, and says when there is nothing', () => {
    expect(countsLine({ live: 1, comingUp: 3, finished: 9, total: 13 })).toBe(
      '1 live · 3 coming up · 9 finished',
    );
    expect(countsLine({ live: 0, comingUp: 0, finished: 2, total: 2 })).toBe('2 finished');
    expect(countsLine({ live: 0, comingUp: 0, finished: 0, total: 0 })).toBe('No events yet');
  });
});

describe('rowTags', () => {
  const view = (event, extra = {}) => ({
    event,
    isLive: false,
    info: describeSafely(null, event, null),
    ...extra,
  });
  it('finished, live, ready and in setup each get their own state; unknown gets none', () => {
    expect(rowTags(view(ev('a', { ended_at: 'x' })))).toEqual([
      { state: 'done', label: 'Finished' },
    ]);
    expect(rowTags(view(ev('a'), { isLive: true }))).toEqual([{ state: 'live', label: 'Live' }]);
    expect(rowTags(view(ev('a'), { info: { ready: true } }))).toEqual([
      { state: 'done', label: 'Ready' },
    ]);
    expect(rowTags(view(ev('a'), { info: { ready: false } }))).toEqual([
      { state: 'queued', label: 'In setup' },
    ]);
    expect(rowTags(view(ev('a')))).toEqual([]);
  });

  it('test data is ALWAYS tagged, after the state (D9), including on a finished or live event', () => {
    expect(rowTags(view(ev('a', { is_test: true })))).toEqual([
      { state: 'test', label: 'Test data' },
    ]);
    expect(rowTags(view(ev('a', { is_test: true, ended_at: 'x' }))).map((t) => t.state)).toEqual([
      'done',
      'test',
    ]);
    expect(rowTags(view(ev('a', { is_test: true }), { isLive: true })).map((t) => t.state)).toEqual(
      ['live', 'test'],
    );
  });
});

describe('collectAttention', () => {
  const view = (event, info = {}, isLive = false) => ({
    event,
    isLive,
    info: { attention: [], ...info },
  });

  it('names each item for its event, so two events can warn the same thing, and links to the event by default', () => {
    const items = collectAttention([
      view(ev('a'), {
        attention: [{ id: 'no-judges', severity: 'warning', text: 'has no judges.' }],
      }),
      view(ev('b'), {
        attention: [{ id: 'no-judges', severity: 'warning', text: 'has no judges.' }],
      }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['a:no-judges', 'b:no-judges']);
    expect(items[0].text).toBe('Event a: has no judges.');
    expect(items[0].href).toBe('#/events/a');
  });

  it('keeps a link a format gave, and drops an unsafe one for the event', () => {
    const [kept, unsafe] = collectAttention([
      view(ev('a'), {
        attention: [
          { id: 'x', severity: 'info', text: 't', href: '#/events/a/setup' },
          { id: 'y', severity: 'info', text: 't', href: 'javascript:alert(1)' },
        ],
      }),
    ]);
    expect(kept.href).toBe('#/events/a/setup');
    expect(unsafe.href).toBe('#/events/a');
  });

  it('flags an open real event with no venue, and test data that is waiting, but never a live, finished or venue-ful one', () => {
    const items = collectAttention([
      view(ev('novenue', { venue: null })),
      view(ev('blank', { venue: '   ' })),
      view(ev('test', { is_test: true })),
      view(ev('livetest', { is_test: true }), {}, true),
      view(ev('done', { venue: null, ended_at: 'x' })),
      view(ev('fine')),
    ]);
    expect(items.map((i) => i.id).sort()).toEqual(['blank:venue', 'novenue:venue', 'test:test']);
  });

  it('a finished event never raises a format item', () => {
    expect(
      collectAttention([
        view(ev('done', { ended_at: 'x' }), {
          attention: [{ id: 'x', severity: 'error', text: 'late' }],
        }),
      ]),
    ).toEqual([]);
  });

  it("orders problems before checks before notes, keeping each format's own order inside one", () => {
    const items = collectAttention([
      view(ev('a'), {
        attention: [
          { id: 'n1', severity: 'info', text: 'n1' },
          { id: 'w1', severity: 'warning', text: 'w1' },
          { id: 'e1', severity: 'error', text: 'e1' },
          { id: 'w2', severity: 'warning', text: 'w2' },
        ],
      }),
    ]);
    expect(items.map((i) => i.id)).toEqual(['a:e1', 'a:w1', 'a:w2', 'a:n1']);
  });
});
