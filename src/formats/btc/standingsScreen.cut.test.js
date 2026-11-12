import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { answerFeedback, answerIfOpen, openFeedbackText } from '../../core/feedbackTestKit.js';
import { mountStandingsScreen } from './standingsScreen.js';
import { publishBtcLive } from './liveSession.js';

vi.mock('./liveSession.js', () => ({ publishBtcLive: vi.fn(async () => {}) }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A view row of btc_seeding_order. Teams are level when they share points.
const row = (teamId, seed, points, extra = {}) => ({
  event_id: 'ev1',
  team_id: teamId,
  seed,
  played: 2,
  wins: 1,
  total_points: points,
  tied_count: 1,
  tiebreak_rank: null,
  reason: null,
  group_resolved: true,
  ...extra,
});
const level = (teamId, seed, points, extra = {}) =>
  row(teamId, seed, points, { tied_count: 2, group_resolved: false, ...extra });

const TEAM_COUNT = 10;
// Ten teams, nobody level: points fall by 5 a place.
const plain = () =>
  Array.from({ length: TEAM_COUNT }, (_, i) => row(`t${i + 1}`, i + 1, 100 - i * 5));

const match = (id, round, status = 'confirmed') => ({
  id,
  event_id: 'ev1',
  round: 'preliminary',
  prelim_round: round,
  status,
  team1_id: null,
  team2_id: null,
});

function fakeClient(order, { matches, scores = [], times = [], generateError } = {}) {
  const db = {
    events: [
      { id: 'ev1', org_id: 'org1', name: 'ABTC Test', is_test: false, event_date: '2027-03-20' },
    ],
    btc_teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({
      id: `t${i + 1}`,
      event_id: 'ev1',
      name: `Team ${i + 1}`,
      country_code: i === 0 ? 'BN' : null,
    })),
    btc_judges: [],
    btc_bracket_slots: [],
    btc_matches: matches ?? [match('m1', 1), match('m2', 2)],
    btc_match_scores: scores,
    btc_prelim_times: times,
    btc_seeding_order: order.map((r) => ({ ...r })),
  };
  const rpcCalls = [];
  function builder(table) {
    const filters = [];
    const ins = [];
    const b = {
      select: () => b,
      eq(column, value) {
        filters.push([column, value]);
        return b;
      },
      in(column, values) {
        ins.push([column, values]);
        return b;
      },
      order: () => b,
      single() {
        const rows = (db[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      then(resolve, reject) {
        const rows = (db[table] ?? [])
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .filter((r) => ins.every(([c, vs]) => vs.includes(r[c])))
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    db,
    rpcCalls,
    from: (table) => builder(table),
    rpc(name, args) {
      rpcCalls.push([name, args]);
      if (name === 'generate_btc_bracket') {
        if (generateError) return Promise.resolve({ data: null, error: generateError });
        db.btc_bracket_slots = [
          { id: 's1', event_id: 'ev1', round: 'quarterfinal', slot_label: 'qf1', match_id: null },
        ];
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('The cut, on the standings screen', () => {
  let root;
  beforeEach(() => {
    publishBtcLive.mockClear();
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  const mount = async (client, options = {}) => {
    await mountStandingsScreen(root, { eventId: 'ev1', client, ...options });
    await flush();
  };
  const lockButton = () => root.querySelector('[data-focus-key="lock-top-8"]');
  const reason = () => root.querySelector('#btc-lock-reason').textContent;
  const bodyRows = () => [...root.querySelectorAll('.ok-cut-row')];
  const teamsShown = () =>
    bodyRows().map((r) => r.querySelector('[data-label="Team"]').textContent.match(/Team \d+$/)[0]);

  describe('the table', () => {
    it('lists teams in the database seed order with the headers the committee reads, and a line after 8th', async () => {
      await mount(fakeClient(plain()));
      const headers = [...root.querySelectorAll('.ok-cut-table th')].map((th) => th.textContent);
      expect(headers).toEqual([
        'Place',
        'Team',
        'R1 pts',
        'R2 pts',
        'Total',
        'R1 time',
        'R2 time',
        'Time sum',
      ]);
      // collapsed by default: the top 8 and the line; the rest sit behind "Show all"
      expect(bodyRows()).toHaveLength(8);
      const line = root.querySelector('.ok-cut-line');
      expect(line.textContent).toBe('Cut line · top 8 go through');
      expect(root.querySelector('.ok-cut-toggle').textContent).toBe('Show all 10');
      expect(root.querySelector('.ok-cut-level')).toBeNull();
      expect(root.querySelector('.ok-cut-row[data-level]')).toBeNull();
    });

    it('never re-ranks: a seed order that disagrees with points is shown as the database gave it', async () => {
      const order = plain();
      // the database says t3 is seed 2 and t2 seed 3 (an organiser-recorded order) at different points
      order[1].seed = 3;
      order[2].seed = 2;
      await mount(fakeClient(order));
      expect(teamsShown().slice(0, 3)).toEqual(['Team 1', 'Team 3', 'Team 2']);
    });

    it('shows round points from the confirmed matches, and the total from the standings', async () => {
      const scores = [
        {
          match_id: 'm1',
          status: 'confirmed',
          team1_id: 't1',
          team2_id: 't2',
          team1_tokens: 30,
          team2_tokens: 15,
          team1_total: 37,
          team2_total: 15,
        },
        {
          match_id: 'm2',
          status: 'confirmed',
          team1_id: 't1',
          team2_id: 't3',
          team1_tokens: 25,
          team2_tokens: 20,
          team1_total: 30,
          team2_total: 20,
        },
      ];
      const order = plain();
      order[0].total_points = 67;
      await mount(fakeClient(order, { scores }));
      const first = bodyRows()[0];
      const cell = (label) => first.querySelector(`[data-label="${label}"]`).textContent;
      expect(cell('R1 pts')).toBe('37');
      expect(cell('R2 pts')).toBe('30');
      expect(cell('Total')).toBe('67');
    });

    it('reads finish times from btc_prelim_times and shows a sum only when both parse', async () => {
      const t = (team, round, note) => ({
        event_id: 'ev1',
        team_id: team,
        prelim_round: round,
        time_note: note,
      });
      const times = [
        t('t1', 1, '8:12'),
        t('t1', 2, '9:05'),
        t('t2', 1, '8:40'),
        t('t2', 2, 'about 9'),
      ];
      await mount(fakeClient(plain(), { times }));
      const cells = (index, label) =>
        bodyRows()[index].querySelector(`[data-label="${label}"]`).textContent;
      expect(cells(0, 'R1 time')).toBe('8:12');
      expect(cells(0, 'R2 time')).toBe('9:05');
      expect(cells(0, 'Time sum')).toBe('17:17');
      expect(cells(1, 'R2 time')).toBe('about 9');
      expect(cells(1, 'Time sum')).toBe('–');
      expect(cells(2, 'R1 time')).toBe('–');
      expect(root.textContent).toContain('It is a guide');
    });

    it('says when the finish times could not be loaded, and still shows the table', async () => {
      const client = fakeClient(plain());
      const realFrom = client.from;
      client.from = (table) =>
        table === 'btc_prelim_times'
          ? { select: () => ({ eq: () => Promise.reject(new Error('down')) }) }
          : realFrom(table);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await mount(client);
      expect(root.textContent).toContain('The finish times could not be loaded just now');
      expect(bodyRows()).toHaveLength(8);
    });

    it('shows a team with its flag as decoration and its code as text', async () => {
      await mount(fakeClient(plain()));
      const first = bodyRows()[0].querySelector('[data-label="Team"]');
      expect(first.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(first.textContent).toContain('BN');
    });

    it('Show all reveals the teams below the line, and Show only the top 8 puts them away', async () => {
      await mount(fakeClient(plain()));
      root.querySelector('.ok-cut-toggle').click();
      expect(bodyRows()).toHaveLength(10);
      expect(root.querySelector('.ok-cut-toggle').textContent).toBe('Show only the top 8');
      root.querySelector('.ok-cut-toggle').click();
      expect(bodyRows()).toHaveLength(8);
    });

    it('a toast that holds focus hands it to the heading when it goes, never to the page body', async () => {
      vi.useFakeTimers();
      try {
        const client = fakeClient(plain());
        await mountStandingsScreen(root, { eventId: 'ev1', client });
        await vi.advanceTimersByTimeAsync(10);
        lockButton().click();
        answerIfOpen('confirm');
        await vi.advanceTimersByTimeAsync(10);
        expect(document.activeElement.getAttribute('data-focus-key')).toBe('standings-toast');
        await vi.advanceTimersByTimeAsync(5000);
        expect(root.querySelector('[data-focus-key="standings-toast"]')).toBeNull();
        expect(document.activeElement).toBe(root.querySelector('h1'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('a team with no result yet has no place and says so', async () => {
      const order = plain().slice(0, 9); // t10 has no row in the seed order
      await mount(fakeClient(order));
      root.querySelector('.ok-cut-toggle').click();
      const last = bodyRows().at(-1);
      expect(last.querySelector('[data-label="Place"]').textContent).toBe('–');
      expect(last.textContent).toContain('No result yet');
    });
  });

  describe('ties and the line', () => {
    it('a tie inside the top 8: marked level in words, no tie card is needed to lock, no warning tint', async () => {
      const order = plain();
      order[1] = level('t2', 2, 90);
      order[2] = level('t3', 3, 90);
      await mount(fakeClient(order));
      const tied = bodyRows().filter((r) => r.hasAttribute('data-level'));
      expect(tied).toHaveLength(2);
      expect(tied.every((r) => r.getAttribute('data-level') === 'inside')).toBe(true);
      expect(tied[0].textContent).toContain('Level');
      expect(tied[0].textContent).not.toContain('decides who goes through');
      // the card is offered to settle seeds, but the lock is not held back by a tie that is not at the line
      expect(root.querySelector('.btc-seeding-card')).not.toBeNull();
      expect(lockButton().hasAttribute('aria-disabled')).toBe(false);
    });

    it('a tie across 8th and 9th: highlighted in words, the lock is disabled until the order is recorded', async () => {
      const order = plain();
      order[7] = level('t8', 8, 60);
      order[8] = level('t9', 9, 60);
      const client = fakeClient(order);
      await mount(client);
      const crossing = root.querySelectorAll('.ok-cut-row[data-level="crossing"]');
      // the rows above the line plus the crossing row that stays visible below it
      expect(crossing).toHaveLength(2);
      expect(root.querySelector('.ok-cut-row[data-level="crossing"]').textContent).toContain(
        'Level at the line · decides who goes through',
      );
      // the row below the line that is level with the 8th stays visible even though the table is collapsed
      expect(bodyRows().map((r) => r.getAttribute('data-side'))).toContain('below');
      expect(lockButton().getAttribute('aria-disabled')).toBe('true');
      expect(reason()).toContain('level across the cut line');
      lockButton().click();
      expect(openFeedbackText()).toBeNull(); // a refused gate asks nothing
      await flush();
      expect(client.rpcCalls).toEqual([]);
    });

    it('a three-way tie across the line is one group; it unlocks only when all three are ordered', async () => {
      const order = plain();
      order[6] = level('t7', 7, 60, { tied_count: 3 });
      order[7] = level('t8', 8, 60, { tied_count: 3 });
      order[8] = level('t9', 9, 60, { tied_count: 3 });
      const client = fakeClient(order);
      await mount(client);
      expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(1);
      expect(root.querySelector('.btc-seeding-group h3').textContent).toBe(
        'Level for 7th to 9th · 60 pts',
      );
      expect(root.querySelectorAll('.ok-cut-row[data-level="crossing"]')).toHaveLength(3);
      expect(lockButton().getAttribute('aria-disabled')).toBe('true');

      // ordered: the tie is settled, the words say so, and the lock opens
      for (const r of client.db.btc_seeding_order) {
        if (['t7', 't8', 't9'].includes(r.team_id)) {
          r.group_resolved = true;
          r.tiebreak_rank = 1;
          r.reason = 'cup-off';
        }
      }
      root.remove();
      root = document.createElement('div');
      document.body.appendChild(root);
      await mount(client);
      expect(root.querySelector('.ok-cut-row[data-level="crossing"]').textContent).toContain(
        'order settled',
      );
      expect(lockButton().hasAttribute('aria-disabled')).toBe(false);
    });
  });

  describe('Lock the top 8', () => {
    it('is disabled, with the reason, while a round is not confirmed', async () => {
      const matches = [match('m1', 1), match('m2', 2, 'pending'), match('m3', 2, 'scoring')];
      const client = fakeClient(plain(), { matches });
      await mount(client);
      expect(lockButton().getAttribute('aria-disabled')).toBe('true');
      expect(reason()).toBe('Round 2 still has 2 matches to confirm.');
      lockButton().click();
      answerIfOpen('confirm');
      await flush();
      expect(client.rpcCalls).toEqual([]);
      expect(root.querySelector('.screen-feedback').textContent).toBe(reason());
    });

    it('is disabled while round 2 is not drawn at all', async () => {
      await mount(fakeClient(plain(), { matches: [match('m1', 1)] }));
      expect(reason()).toBe('Round 2 has not been drawn yet.');
    });

    it('counts an unnumbered match as round 1', async () => {
      const matches = [{ ...match('m1', null), prelim_round: null }, match('m2', 2)];
      await mount(fakeClient(plain(), { matches }));
      expect(lockButton().hasAttribute('aria-disabled')).toBe(false);
    });

    it('is disabled when fewer than 8 teams have a result', async () => {
      await mount(fakeClient(plain().slice(0, 6)));
      expect(reason()).toBe('Only 6 teams have a result; the knockout needs 8.');
    });

    it('is disabled, and says so, when the matches could not be read', async () => {
      const client = fakeClient(plain());
      const realFrom = client.from;
      client.from = (table) =>
        table === 'btc_matches'
          ? { select: () => ({ eq: () => ({ eq: () => Promise.reject(new Error('down')) }) }) }
          : realFrom(table);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await mount(client);
      expect(reason()).toContain('could not check that both rounds are confirmed');
      expect(lockButton().getAttribute('aria-disabled')).toBe('true');
    });

    it('asks first, naming the eight in seed order, then generates the bracket and publishes', async () => {
      const client = fakeClient(plain());
      const handlers = { composed: true };
      await mount(client, { handlers });
      expect(reason()).toContain('cannot be undone');
      lockButton().click();
      const question = openFeedbackText();
      answerFeedback('confirm');
      await flush();
      for (let i = 1; i <= 8; i++) expect(question).toContain(`${i}. Team ${i}`);
      expect(question).not.toContain('Team 9');
      expect(client.rpcCalls).toEqual([
        ['generate_btc_bracket', { p_org_id: 'org1', p_event_id: 'ev1' }],
      ]);
      expect(publishBtcLive).toHaveBeenCalledWith(
        { event: expect.objectContaining({ id: 'ev1' }), takeOver: false },
        handlers,
      );
      expect(document.activeElement.textContent).toBe('Bracket generated.');
      expect(root.textContent).toContain('The top 8 are locked');
      expect(root.querySelector('.btc-seeding-card')).toBeNull();
      expect(
        [...root.querySelectorAll('a')]
          .find((a) => a.textContent === 'Open the bracket')
          .getAttribute('href'),
      ).toBe('#/events/ev1/btc/bracket');
    });

    it('names the settled order, not the points order, when the tie across the line was recorded', async () => {
      const order = plain();
      order[7] = level('t8', 8, 60, { group_resolved: true, tiebreak_rank: 2 });
      order[8] = level('t9', 9, 60, { group_resolved: true, tiebreak_rank: 1 });
      // the database seeds the organiser's choice, t9, 8th
      order[7].seed = 9;
      order[8].seed = 8;
      await mount(fakeClient(order));
      lockButton().click();
      const question = openFeedbackText();
      answerFeedback('confirm');
      await flush();
      expect(question).toContain('8. Team 9');
      expect(question).not.toContain('Team 8\n');
    });

    it('does nothing when the confirmation is declined', async () => {
      const client = fakeClient(plain());
      await mount(client);
      lockButton().click();
      answerFeedback('cancel');
      await flush();
      expect(client.rpcCalls).toEqual([]);
      expect(root.querySelector('.ok-cut-lock h2').textContent).toBe('Lock the top 8');
    });

    it('says what to do when the database refuses for a tie it knows about and the page was out of date', async () => {
      const client = fakeClient(plain(), {
        generateError: { code: 'P0001', message: 'teams are tied for the 8th qualifying spot' },
      });
      await mount(client);
      lockButton().click();
      answerIfOpen('confirm');
      await flush();
      expect(root.querySelector('.screen-feedback').textContent).toContain(
        'Teams are level across the cut line.',
      );
      expect(publishBtcLive).not.toHaveBeenCalled();
      expect(lockButton()).not.toBeNull();
    });

    it('finishes even if the publish never settles, and logs a refused one', async () => {
      publishBtcLive.mockImplementationOnce(() => new Promise(() => {}));
      await mount(fakeClient(plain()));
      lockButton().click();
      answerIfOpen('confirm');
      await flush();
      expect(root.textContent).toContain('Bracket generated.');

      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      publishBtcLive.mockRejectedValueOnce(new TypeError('no handler map'));
      root.remove();
      root = document.createElement('div');
      document.body.appendChild(root);
      await mount(fakeClient(plain()));
      lockButton().click();
      answerIfOpen('confirm');
      await flush();
      expect(root.textContent).toContain('Bracket generated.');
      expect(error).toHaveBeenCalledWith(
        'btc: live-view publish was refused',
        expect.any(TypeError),
      );
    });

    it('still publishes and says it is generated when the re-read of the bracket fails afterwards', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = fakeClient(plain());
      await mount(client);
      const realFrom = client.from;
      const realRpc = client.rpc;
      let generated = false;
      client.rpc = (...args) =>
        realRpc(...args).then((result) => {
          generated = true;
          return result;
        });
      client.from = (table) => {
        if (generated && table === 'btc_bracket_slots') throw new Error('network down');
        return realFrom(table);
      };
      lockButton().click();
      answerIfOpen('confirm');
      await flush();
      expect(publishBtcLive).toHaveBeenCalledTimes(1);
      expect(root.textContent).toContain('Bracket generated.');
      expect(root.textContent).toContain('The top 8 are locked');
    });

    it('links to the sign-off sheet', async () => {
      await mount(fakeClient(plain()));
      const link = [...root.querySelectorAll('a')].find((a) =>
        a.textContent.includes('Sign-off sheet'),
      );
      expect(link.getAttribute('href')).toBe('#/events/ev1/btc/sign-off');
    });
  });

  describe('the screen around the cut', () => {
    it('shows the test banner for a test event and the beta band for a shadow one, never both', async () => {
      const test = fakeClient(plain());
      test.db.events[0].is_test = true;
      await mount(test);
      expect(root.querySelector('.is-test-banner')).not.toBeNull();
      root.innerHTML = '';
      const shadow = fakeClient(plain());
      shadow.db.events[0].is_shadow = true;
      await mount(shadow);
      expect(root.querySelector('.ok-beta-band')).not.toBeNull();
      expect(root.querySelector('.is-test-banner')).toBeNull();
    });

    it('with no teams says so and shows no table', async () => {
      const client = fakeClient([]);
      client.db.btc_teams = [];
      await mount(client);
      expect(root.textContent).toContain('No teams yet. Add teams in Setup first.');
      expect(root.querySelector('.ok-cut-table')).toBeNull();
    });

    it('shows a load error with Retry, and Retry reloads', async () => {
      const client = fakeClient(plain());
      client.db.events = null;
      const realFrom = client.from;
      let fail = true;
      client.from = (table) =>
        fail && table === 'btc_teams'
          ? {
              select: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: null, error: new Error('down') }),
                }),
              }),
            }
          : realFrom(table);
      client.db.events = [{ id: 'ev1', org_id: 'org1', name: 'ABTC Test', is_test: false }];
      await mount(client);
      expect(root.querySelector('.screen-feedback[data-tone="error"]')).not.toBeNull();
      fail = false;
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click();
      await flush();
      expect(root.querySelector('.ok-cut-table')).not.toBeNull();
      expect(document.activeElement).toBe(root.querySelector('h1'));
    });

    it('writes nothing once its signal is aborted', async () => {
      const controller = new AbortController();
      const client = fakeClient(plain());
      const pending = mountStandingsScreen(root, {
        eventId: 'ev1',
        client,
        signal: controller.signal,
      });
      controller.abort();
      root.innerHTML = '';
      await pending;
      await flush();
      expect(root.querySelector('.ok-cut-table')).toBeNull();
    });
  });
});
