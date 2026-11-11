import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const publishBtcLive = vi.fn();
vi.mock('./liveSession.js', () => ({ publishBtcLive: (...args) => publishBtcLive(...args) }));
const getDisputePack = vi.fn();
vi.mock('../../core/disputePack.js', () => ({ getDisputePack: (...a) => getDisputePack(...a) }));

const downloadJson = vi.fn();
const downloadCsv = vi.fn();
vi.mock('../../core/export.js', async (original) => ({
  ...(await original()),
  downloadJson: (...a) => downloadJson(...a),
  downloadCsv: (...a) => downloadCsv(...a),
}));

import { mountBtcEventDashboardScreen } from './eventDashboardScreen.js';

const EVENT = {
  id: 'ev1',
  org_id: 'org1',
  name: 'Regional Bracket',
  format: 'btc',
  is_test: false,
  event_date: '2027-03-14',
  venue: 'Hall A',
  city: 'Bandar',
};

// A fake PostgREST client: each table answers with its rows (or an `error`); filters are accepted and ignored.
function fakeClient(tables) {
  const answer = (table) => tables[table] ?? { data: [], error: null };
  return {
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        single: () => Promise.resolve(answer(table)),
        maybeSingle: () => Promise.resolve(answer(table)),
        then: (res, rej) => Promise.resolve(answer(table)).then(res, rej),
      };
      return builder;
    },
  };
}

const tablesFor = (over = {}) => ({
  events: { data: EVENT, error: null },
  btc_teams: { data: [], error: null },
  btc_judges: { data: [], error: null },
  btc_matches: { data: [], error: null },
  btc_bracket_slots: { data: [], error: null },
  live_sessions: { data: null, error: null },
  ...over,
});

const mount = (root, over, options = {}) =>
  mountBtcEventDashboardScreen(root, {
    eventId: 'ev1',
    client: fakeClient(tablesFor(over)),
    listQueued: async () => [],
    ...options,
  });

const team = (i, country = 'BN') => ({ id: `t${i}`, name: `Team ${i}`, country_code: country });

const CRLF = String.fromCharCode(13, 10);

describe('mountBtcEventDashboardScreen', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    publishBtcLive.mockReset();
    getDisputePack.mockReset();
    downloadJson.mockReset();
    downloadCsv.mockReset();
  });
  afterEach(() => {
    root.remove();
  });

  it('shows the event name as the heading, with a meta line, and focuses it', async () => {
    await mount(root, {});
    const h1 = root.querySelector('h1');
    expect(h1.textContent).toBe('Regional Bracket');
    expect(document.activeElement).toBe(h1);
    const meta = root.querySelector('.btc-event-meta').textContent;
    expect(meta).toContain('Hall A');
    expect(meta).toContain('Bandar');
    expect(meta).toContain('2027');
  });

  it('draws the six phases in order and one next-step card', async () => {
    await mount(root, {});
    const titles = [...root.querySelectorAll('.ok-phase-title')].map((n) => n.textContent);
    expect(titles).toEqual(['Setup', 'Round 1', 'Round 2', 'The cut', 'Knockout', 'Podium']);
    expect(root.querySelectorAll('.ok-next')).toHaveLength(1);
    expect(root.querySelector('.ok-next-action').textContent).toBe('Add teams');
  });

  it('keeps the four screen links, scoped to this event, in a nav at the bottom', async () => {
    await mount(root, {});
    const nav = root.querySelector('.btc-event-links');
    expect(
      [...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Setup', '#/events/ev1/btc/setup'],
      ['Matches', '#/events/ev1/btc/matches'],
      ['Standings', '#/events/ev1/btc/standings'],
      ['Bracket', '#/events/ev1/btc/bracket'],
    ]);
    expect(nav.nextElementSibling).toBeNull();
  });

  it('blocks round 1 and says why when teams have no country', async () => {
    const teams = [team(1), team(2, null), team(3, null), team(4)];
    await mount(root, {
      btc_teams: { data: teams, error: null },
      btc_judges: { data: [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }], error: null },
    });
    const round1 = root.querySelector('[data-phase="round1"]');
    expect(round1.dataset.status).toBe('blocked');
    expect(round1.textContent).toContain('2 teams have no country: set them in Setup.');
  });

  it('shows the test band for a test event, none for a real one, and the beta band only for is_shadow', async () => {
    await mount(root, { events: { data: { ...EVENT, is_test: true }, error: null } });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    expect(root.querySelector('.ok-beta-band')).toBeNull();

    await mount(root, {});
    expect(root.querySelector('.is-test-banner')).toBeNull();
    expect(root.querySelector('.ok-beta-band')).toBeNull();

    await mount(root, { events: { data: { ...EVENT, is_shadow: true }, error: null } });
    expect(root.querySelector('.ok-beta-band').textContent).toContain('Seduh Score ABTC Beta Test');
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('lists the missing-times warning in Needs attention', async () => {
    await mount(root, {
      btc_matches: {
        data: [
          {
            id: 'm1',
            round: 'preliminary',
            status: 'confirmed',
            team1_time_note: '8:42',
            team2_time_note: null,
          },
        ],
        error: null,
      },
    });
    expect(root.querySelector('.ok-warn').textContent).toContain('no finish times');
  });

  it('warns about confirms queued on this device for this event only', async () => {
    await mount(
      root,
      {
        btc_matches: {
          data: [{ id: 'm1', round: 'preliminary', status: 'scoring', prelim_round: 1 }],
          error: null,
        },
      },
      {
        listQueued: async () => [
          { type: 'confirm_btc_match', payload: { p_match_id: 'm1' } },
          { type: 'confirm_btc_match', payload: { p_match_id: 'other-event' } },
          { type: 'publish_btc_live_session', payload: {} },
        ],
      },
    );
    expect(root.querySelector('.ok-warn').textContent).toContain(
      '1 confirm is saved on this device',
    );
  });

  it('opens even when the outbox cannot be read', async () => {
    await mount(root, {}, { listQueued: async () => Promise.reject(new Error('idb')) });
    expect(root.querySelector('h1').textContent).toBe('Regional Bracket');
    expect(root.querySelector('.ok-warn').textContent).toContain('Nothing needs attention');
  });

  describe('live card', () => {
    const links = {
      phone: 'https://x.test/#/live/o/phone',
      projector: 'https://x.test/#/live/o/projector',
      splash: 'https://x.test/#/live/o/splash',
    };

    it('says Not showing and offers Show this event when nothing is live', async () => {
      await mount(root, {}, { handlers: {}, audienceLinks: links });
      const card = root.querySelector('.ok-live');
      expect(card.textContent).toContain('Not showing');
      expect(card.querySelector('.ok-live-show').hidden).toBe(false);
      expect(card.querySelectorAll('.ok-live-link')).toHaveLength(3);
    });

    it('says Live now when this event is the live one', async () => {
      await mount(
        root,
        { live_sessions: { data: { event_id: 'ev1' }, error: null } },
        { handlers: {}, audienceLinks: links },
      );
      expect(root.querySelector('.ok-live').textContent).toContain('Live now on Projector / Phone');
      expect(root.querySelector('.ok-live-show').hidden).toBe(true);
    });

    it('claims nothing when the live check fails', async () => {
      await mount(root, { live_sessions: { data: null, error: { code: 'x' } } }, { handlers: {} });
      expect(root.querySelector('.ok-live').textContent).toContain('Live status unavailable');
    });

    it('Show this event publishes with takeOver and the composed handlers, then reads back that it is live', async () => {
      const handlers = { confirm_btc_match: () => {} };
      const tables = tablesFor();
      publishBtcLive.mockImplementation(async () => {
        tables.live_sessions = { data: { event_id: 'ev1' }, error: null };
      });
      await mountBtcEventDashboardScreen(root, {
        eventId: 'ev1',
        client: fakeClient(tables),
        handlers,
        listQueued: async () => [],
      });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() => expect(root.querySelector('.ok-live').dataset.state).toBe('live'));
      const [arg, passedHandlers] = publishBtcLive.mock.calls[0];
      expect(arg.takeOver).toBe(true);
      expect(arg.event.id).toBe('ev1');
      expect(passedHandlers).toBe(handlers);
    });

    it('does not claim success when the publish only queued (offline)', async () => {
      publishBtcLive.mockResolvedValue(undefined);
      await mount(root, {}, { handlers: {} });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() =>
        expect(root.querySelector('.ok-live-status').textContent).toContain('saved on this device'),
      );
      expect(root.querySelector('.ok-live').dataset.state).toBe('not_showing');
    });

    it('does not claim success when ANOTHER event is the live one after the publish', async () => {
      const tables = tablesFor();
      publishBtcLive.mockImplementation(async () => {
        tables.live_sessions = { data: { event_id: 'other-event' }, error: null };
      });
      await mountBtcEventDashboardScreen(root, {
        eventId: 'ev1',
        client: fakeClient(tables),
        handlers: {},
        listQueued: async () => [],
      });
      root.querySelector('.ok-live-show').click();
      await vi.waitFor(() =>
        expect(root.querySelector('.ok-live-status').textContent).toContain('saved on this device'),
      );
      expect(root.querySelector('.ok-live').dataset.state).not.toBe('live');
    });

    it('offers no take-over control without a handler map', async () => {
      await mount(root, {});
      expect(root.querySelector('.ok-live-show').hidden).toBe(true);
    });
  });

  describe('records card', () => {
    it('offers the JSON record and the two scores CSVs, named for the event and the date', async () => {
      await mount(root, {});
      const buttons = [...root.querySelectorAll('.ok-records button')];
      expect(buttons.map((b) => b.querySelector('.ok-records-label').textContent)).toEqual([
        'Download the record (JSON)',
        'Download matches (CSV)',
        'Download cups (CSV)',
      ]);
      const files = buttons.map((b) => b.querySelector('.ok-records-file').textContent);
      expect(files[0]).toBe('regional-bracket-record.json');
      expect(files[1]).toMatch(/^regional-bracket-matches-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(files[2]).toMatch(/^regional-bracket-cups-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('reads the scores only when a CSV is clicked, then saves the right header', async () => {
      const read = [];
      const base = fakeClient(tablesFor());
      const client = { from: (table) => (read.push(table), base.from(table)) };
      await mountBtcEventDashboardScreen(root, {
        eventId: 'ev1',
        client,
        listQueued: async () => [],
      });
      expect(read).not.toContain('btc_cup_votes');
      expect(read).not.toContain('btc_match_bonuses');
      root.querySelectorAll('.ok-records button')[1].click();
      await vi.waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
      expect(downloadCsv.mock.calls[0][0]).toMatch(/-matches-/);
      expect(downloadCsv.mock.calls[0][1].split(CRLF)[0]).toMatch(/^Event,Round,Match,Status,/);
      root.querySelectorAll('.ok-records button')[2].click();
      await vi.waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(2));
      expect(downloadCsv.mock.calls[1][1].split(CRLF)[0]).toBe(
        'Event,Round,Match,Team 1,Team 2,Cup,Team 1 tokens,Team 2 tokens,Cup won by',
      );
    });

    it('builds the record through get_dispute_pack for this event', async () => {
      const calls = [];
      getDisputePack.mockImplementation(async (...args) => {
        calls.push(args);
        return { ok: true };
      });
      await mount(root, {});
      root.querySelector('.ok-records button').click();
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0].slice(0, 2)).toEqual(['org1', 'ev1']);
      await vi.waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
      expect(downloadJson.mock.calls[0]).toEqual(['regional-bracket-record.json', { ok: true }]);
    });
  });

  it('shows a retry button and message when the initial load fails', async () => {
    await mount(root, { events: { data: null, error: { code: '42501' } } });
    expect(root.querySelector('button')?.textContent).toBe('Retry');
    expect(root.querySelector('[data-tone="error"]')).not.toBeNull();
  });

  it('a failed required read (the roster) fails the load rather than drawing a wrong sheet', async () => {
    await mount(root, { btc_teams: { data: null, error: { code: '42501' } } });
    expect(root.querySelector('button')?.textContent).toBe('Retry');
    expect(root.querySelector('.ok-phase')).toBeNull();
  });

  it('retries after a failed load and shows the event once it succeeds', async () => {
    const tables = tablesFor({ events: { data: null, error: { code: '42501' } } });
    await mountBtcEventDashboardScreen(root, {
      eventId: 'ev1',
      client: fakeClient(tables),
      listQueued: async () => [],
    });
    tables.events = { data: EVENT, error: null };
    root.querySelector('button').click();
    await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Regional Bracket'));
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });
});
