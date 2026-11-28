import { endActiveTour } from '../../core/tour.js';
import { dashboardTourSteps } from './tours.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const publishThrowdownLive = vi.fn();
vi.mock('./liveSession.js', () => ({
  publishThrowdownLive: (...args) => publishThrowdownLive(...args),
}));

const matchLogCsv = vi.hoisted(() => vi.fn());
vi.mock('./recordsExport.js', async (original) => {
  const actual = await original();
  matchLogCsv.mockImplementation(actual.matchLogCsv);
  return { ...actual, matchLogCsv: (...a) => matchLogCsv(...a) };
});

const downloadCsv = vi.fn();
vi.mock('../../core/export.js', async (original) => ({
  ...(await original()),
  downloadCsv: (...a) => downloadCsv(...a),
}));

import { mountThrowdownEventDashboardScreen } from './eventDashboardScreen.js';
import { bracketOf, dashboardData, entriesOf, match } from './dashboardFixtures.js';

const EVENT = {
  id: 'ev1',
  org_id: 'org1',
  name: 'Throwdown Nov',
  is_test: false,
  event_date: '2026-11-27',
  venue: 'Hall A',
  city: 'Bandar',
};

// Only `live_sessions` is read by the screen itself (the live check and the take-over read-back).
function fakeClient(state) {
  return {
    from(table) {
      const answer = () => (table === 'live_sessions' ? state.live : { data: null, error: null });
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve(answer()),
        single: () => Promise.resolve(answer()),
        then: (res, rej) => Promise.resolve(answer()).then(res, rej),
      };
      return builder;
    },
  };
}

// Four competitors: one semi-final level at 2-2 with 3 judges, the other undecided; 2 writes queued.
function midEvent(over = {}) {
  const entries = entriesOf(4);
  const bracket = bracketOf(entries, [
    { matches: [match(['e1', 'e2'], { votes: [2, 2] }), match(['e3', 'e4'], { votes: [1, 0] })] },
  ]);
  return { ...dashboardData({ entries, bracket, queuedCount: 2 }), event: EVENT, ...over };
}

function beforeDraw(over = {}) {
  const entries = entriesOf(4);
  const bracket = bracketOf(entries, []);
  return { ...dashboardData({ entries, bracket }), event: EVENT, ...over };
}

const loaderOf = (data) => async () => data;

describe('mountThrowdownEventDashboardScreen', () => {
  let root;
  let state;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    state = { live: { data: null, error: null } };
    publishThrowdownLive.mockReset();
    downloadCsv.mockReset();
    matchLogCsv.mockClear();
  });
  afterEach(() => {
    root.remove();
  });

  const mount = (data, options = {}) =>
    mountThrowdownEventDashboardScreen(root, {
      eventId: 'ev1',
      client: fakeClient(state),
      loadData: loaderOf(data),
      ...options,
    });

  it('shows the event name as the heading, with a meta line, and focuses it', async () => {
    await mount(midEvent());
    const h1 = root.querySelector('h1');
    expect(h1.id).toBe('td-event-dashboard-heading');
    expect(h1.textContent).toBe('Throwdown Nov');
    expect(document.activeElement).toBe(h1);
    const meta = root.querySelector('.td-event-meta').textContent;
    expect(meta).toContain('Semi-finals');
    expect(meta).toContain('Hall A');
    expect(meta).toContain('Bandar');
    expect(meta).toContain('2026');
  });

  it('draws the phases from the data and one next-step card (mid event)', async () => {
    await mount(midEvent());
    const titles = [...root.querySelectorAll('.ok-phase-title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'Setup',
      'Draw and start',
      'Semi-finals',
      'Rounds to come',
      '3rd place',
      'Results',
    ]);
    expect(root.querySelectorAll('.ok-next')).toHaveLength(1);
    expect(root.querySelector('[data-phase="round-1"]').dataset.status).toBe('in_progress');
  });

  it('draws the setup and draw phases before the draw, with the draw as the next step', async () => {
    await mount(beforeDraw());
    expect(root.querySelector('[data-phase="setup"]').dataset.status).toBe('in_progress');
    expect(root.querySelector('[data-phase="draw"]').dataset.status).toBe('not_started');
    expect(root.querySelectorAll('.ok-next')).toHaveLength(1);
    expect(root.querySelector('.ok-next-action').textContent).toBe('Draw and start');
  });

  it('lists the level match and the queued writes under Needs attention', async () => {
    await mount(midEvent());
    const text = root.querySelector('.ok-warn').textContent;
    expect(text).toContain('is level at 2–2');
    expect(text).toContain('2 taps or actions are saved on this device');
  });

  it('says nothing needs attention when there is nothing to flag', async () => {
    await mount(beforeDraw());
    expect(root.querySelector('.ok-warn').textContent).toContain('Nothing needs attention');
  });

  it('shows the test band for a test event and none for a real one', async () => {
    await mount(midEvent({ event: { ...EVENT, is_test: true } }));
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    await mount(midEvent());
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('keeps the Matches and Results links, scoped to this event, in a nav at the bottom', async () => {
    await mount(midEvent());
    const nav = root.querySelector('.td-event-links');
    expect(nav.getAttribute('aria-label')).toBe('Event screens');
    expect(
      [...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Matches', '#/events/ev1/throwdown/matches'],
      ['Results', '#/events/ev1/throwdown/results'],
    ]);
    expect(nav.nextElementSibling).toBeNull();
  });

  it('draws nothing once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await mount(midEvent(), { signal: controller.signal });
    // The loading state is drawn before the load; the aborted render must not replace it with the dashboard.
    expect(root.querySelector('h1').textContent).toBe('Event');
    expect(root.querySelector('.ok-phase')).toBeNull();
  });

  describe('guided tour', () => {
    it('has every anchor its tour points at, and the button starts it', async () => {
      await mount(beforeDraw());
      for (const step of dashboardTourSteps) {
        expect(root.querySelector(step.target), step.target).not.toBeNull();
      }
      root.querySelector('[data-tour-help]').click();
      expect(document.querySelector('.tour-title').textContent).toBe(dashboardTourSteps[0].title);
      endActiveTour();
    });

    it('offers no tour once the draw is made', async () => {
      await mount(midEvent());
      expect(root.querySelector('[data-tour-help]')).toBeNull();
    });
  });

  describe('bracket planner', () => {
    it('is on the dashboard before the draw, closed, with what the saved setup will do', async () => {
      await mount(beforeDraw());
      const card = root.querySelector('#td-preview-h');
      expect(card).not.toBeNull();
      expect(root.textContent).toContain('Plan the event');
      expect(root.querySelector('#td-plan').hidden).toBe(true);
      // The Matches link beside it names where the setup is changed.
      expect(root.querySelector('.td-plan-setup-link a').getAttribute('href')).toBe(
        '#/events/ev1/throwdown/matches',
      );
    });

    it('opens, and a what-if brewer count changes the shape without saving anything', async () => {
      await mount(beforeDraw());
      root.querySelector('[aria-controls="td-plan"]').click();
      expect(root.querySelector('#td-plan').hidden).toBe(false);
      const box = root.querySelector('[data-focus-key="td-plan-count"]');
      box.value = '21';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      expect(root.textContent).toContain('21');
      expect(publishThrowdownLive).not.toHaveBeenCalled();
    });

    it('is gone once the draw is made', async () => {
      await mount(midEvent());
      expect(root.querySelector('#td-preview-h')).toBeNull();
      expect(root.querySelector('.td-plan-setup-link')).toBeNull();
    });
  });

  describe('live card', () => {
    const links = {
      phone: 'https://x.test/#/live/o/phone',
      projector: 'https://x.test/#/live/o/projector',
      splash: 'https://x.test/#/live/o/splash',
    };

    it('says Not showing and offers Show this event when nothing is live', async () => {
      await mount(midEvent(), { handlers: {}, audienceLinks: links });
      const card = root.querySelector('.ok-live');
      expect(card.dataset.state).toBe('not_showing');
      expect(card.textContent).toContain('Not showing');
      expect(card.querySelector('.ok-live-show').hidden).toBe(false);
      expect(card.querySelectorAll('.ok-live-link')).toHaveLength(3);
    });

    it('says Live now when this event is the live one', async () => {
      state.live = { data: { event_id: 'ev1' }, error: null };
      await mount(midEvent(), { handlers: {}, audienceLinks: links });
      expect(root.querySelector('.ok-live').textContent).toContain('Live now on Projector / Phone');
      expect(root.querySelector('.ok-live-show').hidden).toBe(true);
    });

    it('says Not showing when ANOTHER event is the live one on load', async () => {
      state.live = { data: { event_id: 'other-event' }, error: null };
      await mount(midEvent(), { handlers: {}, audienceLinks: links });
      const card = root.querySelector('.ok-live');
      expect(card.dataset.state).toBe('not_showing');
      expect(card.querySelector('.ok-live-show').hidden).toBe(false);
    });

    it('claims nothing when the live check fails, and the page still shows', async () => {
      state.live = { data: null, error: { code: 'x' } };
      await mount(midEvent(), { handlers: {} });
      expect(root.querySelector('.ok-live').textContent).toContain('Live status unavailable');
      expect(root.querySelector('h1').textContent).toBe('Throwdown Nov');
    });

    it('Show this event publishes with takeOver and the handlers, then reads back that it is live', async () => {
      const handlers = { td_cast_vote: () => {} };
      publishThrowdownLive.mockImplementation(async () => {
        state.live = { data: { event_id: 'ev1' }, error: null };
      });
      await mount(midEvent(), { handlers });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() => expect(root.querySelector('.ok-live').dataset.state).toBe('live'));
      const [arg, passedHandlers] = publishThrowdownLive.mock.calls[0];
      expect(arg.takeOver).toBe(true);
      expect(arg.event.id).toBe('ev1');
      expect(passedHandlers).toBe(handlers);
    });

    it('does not claim success when the publish only queued (offline)', async () => {
      publishThrowdownLive.mockResolvedValue(undefined);
      await mount(midEvent(), { handlers: {} });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() =>
        expect(root.querySelector('.ok-live-status').textContent).toContain('saved on this device'),
      );
      expect(root.querySelector('.ok-live').dataset.state).toBe('not_showing');
    });

    it('does not claim success when ANOTHER event is the live one after the publish', async () => {
      publishThrowdownLive.mockImplementation(async () => {
        state.live = { data: { event_id: 'other-event' }, error: null };
      });
      await mount(midEvent(), { handlers: {} });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() =>
        expect(root.querySelector('.ok-live-status').textContent).toContain('saved on this device'),
      );
      expect(root.querySelector('.ok-live').dataset.state).not.toBe('live');
    });

    it('offers no take-over control without a handler map', async () => {
      await mount(midEvent());
      expect(root.querySelector('.ok-live-show').hidden).toBe(true);
    });
  });

  describe('records card', () => {
    it('offers one entry, the match log, named for the event and the date', async () => {
      await mount(midEvent());
      const buttons = [...root.querySelectorAll('.ok-records button')];
      expect(buttons).toHaveLength(1);
      expect(buttons[0].querySelector('.ok-records-label').textContent).toBe(
        'Download the match log (CSV)',
      );
      expect(buttons[0].querySelector('.ok-records-file').textContent).toMatch(
        /^throwdown-nov-matches-\d{4}-\d{2}-\d{2}\.csv$/,
      );
    });

    it('builds the log only on the click, from the loaded bracket', async () => {
      const data = midEvent();
      await mount(data);
      expect(matchLogCsv).not.toHaveBeenCalled();
      expect(downloadCsv).not.toHaveBeenCalled();
      root.querySelector('.ok-records button').click();
      await vi.waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
      expect(matchLogCsv).toHaveBeenCalledTimes(1);
      expect(matchLogCsv.mock.calls[0][0]).toBe(data.bracket);
      const [filename, text] = downloadCsv.mock.calls[0];
      expect(filename).toMatch(/-matches-/);
      const lines = text.split(String.fromCharCode(13, 10));
      expect(lines[0]).toBe(
        'Round,Match,Competitor A,Competitor B,Votes A,Votes B,Result,Winner,Confirmed at',
      );
      expect(lines[1]).toContain('Competitor 1,Competitor 2,2,2');
    });
  });

  describe('load failures', () => {
    const failures = [
      ['a rejected error', () => Object.assign(new Error('boom'), { code: '42501' })],
      ['a timeout', () => Object.assign(new Error('slow'), { timedOut: true })],
      ['a plain database error object', () => ({ code: 'PGRST301', message: 'nope' })],
    ];

    it.each(failures)(
      '%s shows Retry, then a successful Retry shows the event',
      async (_n, make) => {
        let fail = true;
        const loadData = async () => {
          if (fail) throw make();
          return midEvent();
        };
        await mountThrowdownEventDashboardScreen(root, {
          eventId: 'ev1',
          client: fakeClient(state),
          loadData,
        });
        expect(root.querySelector('button')?.textContent).toBe('Retry');
        expect(root.querySelector('[data-tone="error"]')).not.toBeNull();
        expect(document.activeElement).toBe(root.querySelector('[data-tone="error"]'));
        expect(root.querySelector('.ok-phase')).toBeNull();
        fail = false;
        root.querySelector('button').click();
        await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Throwdown Nov'));
        // The Retry click does not go through the router, so the screen moves focus itself.
        expect(document.activeElement).toBe(root.querySelector('h1'));
      },
    );

    it('a timeout says so in its own words', async () => {
      await mountThrowdownEventDashboardScreen(root, {
        eventId: 'ev1',
        client: fakeClient(state),
        loadData: async () => {
          throw Object.assign(new Error('slow'), { timedOut: true });
        },
      });
      expect(root.querySelector('[data-tone="error"]').textContent).toBe(
        'Still loading. Check the connection, then press Retry.',
      );
    });

    it('a failed read through the real loader fails the load rather than drawing a wrong sheet', async () => {
      const failing = {
        from: () => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            order: () => builder,
            range: () => Promise.resolve({ data: null, error: { code: '42501' } }),
            maybeSingle: () => Promise.resolve({ data: null, error: { code: '42501' } }),
            single: () => Promise.resolve({ data: null, error: { code: '42501' } }),
            then: (res, rej) =>
              Promise.resolve({ data: null, error: { code: '42501' } }).then(res, rej),
          };
          return builder;
        },
      };
      await mountThrowdownEventDashboardScreen(root, {
        eventId: 'ev1',
        client: failing,
        listQueued: async () => [],
      });
      expect(root.querySelector('button')?.textContent).toBe('Retry');
      expect(root.querySelector('.ok-phase')).toBeNull();
    });
  });

  it('opens even when the data has an unreadable queue (queuedCount null)', async () => {
    await mount(beforeDraw({ queuedCount: null }));
    expect(root.querySelector('h1').textContent).toBe('Throwdown Nov');
  });
});
