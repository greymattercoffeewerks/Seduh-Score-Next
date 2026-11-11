import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSignOffScreen } from './signOffScreen.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const seedRow = (teamId, seed, points) => ({
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
});

function fakeClient({ failTeams = false } = {}) {
  const db = {
    events: [
      { id: 'ev1', org_id: 'org1', name: 'ABTC Test', is_test: false, event_date: '2027-03-20' },
    ],
    btc_teams: Array.from({ length: 10 }, (_, i) => ({
      id: `t${i + 1}`,
      event_id: 'ev1',
      name: `Team ${i + 1}`,
    })),
    btc_bracket_slots: [],
    btc_matches: [
      { id: 'm1', event_id: 'ev1', round: 'preliminary', prelim_round: 1, status: 'confirmed' },
      { id: 'm2', event_id: 'ev1', round: 'preliminary', prelim_round: 2, status: 'confirmed' },
    ],
    btc_match_scores: [],
    btc_prelim_times: [],
    btc_seeding_order: Array.from({ length: 10 }, (_, i) =>
      seedRow(`t${i + 1}`, i + 1, 100 - i * 5),
    ),
  };
  const builder = (table) => {
    const filters = [];
    const ins = [];
    const b = {
      select: () => b,
      eq(c, v) {
        filters.push([c, v]);
        return b;
      },
      in(c, v) {
        ins.push([c, v]);
        return b;
      },
      order: () => b,
      single: () =>
        Promise.resolve({
          data: { ...db[table].find((r) => filters.every(([c, v]) => r[c] === v)) },
          error: null,
        }),
      then(resolve, reject) {
        if (failTeams && table === 'btc_teams')
          return Promise.resolve({ data: null, error: new Error('down') }).then(resolve, reject);
        const rows = db[table]
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .filter((r) => ins.every(([c, vs]) => vs.includes(r[c])))
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  };
  return { db, from: builder, rpc: () => Promise.resolve({ data: null, error: null }) };
}

describe('the BTC sign-off page', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('names exactly the eight in seed order: Team 1 to Team 8', async () => {
    await mountSignOffScreen(root, { eventId: 'ev1', client: fakeClient() });
    await flush();
    const teamCells = [...root.querySelectorAll('.ok-signoff-table tbody tr')].map((tr) =>
      tr.querySelectorAll('td')[1].textContent.replace(/^.*?(Team \d+)$/, '$1'),
    );
    expect(teamCells).toEqual(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`));
  });

  it('once the bracket exists, names the eight in its quarterfinal slots, not the live view, and says they differ', async () => {
    const client = fakeClient();
    const qf = (n, t1, t2) => ({
      id: `s${n}`,
      event_id: 'ev1',
      round: 'quarterfinal',
      slot_label: `qf${n}`,
      team1_id: t1,
      team2_id: t2,
      seed_1: n,
      seed_2: 9 - n,
      match_id: null,
    });
    client.db.btc_bracket_slots = [
      qf(1, 't1', 't8'),
      qf(2, 't2', 't7'),
      qf(3, 't3', 't6'),
      qf(4, 't4', 't5'),
    ];
    // a re-confirm after the lock: t9 now beats t8 in the live seed order
    for (const r of client.db.btc_seeding_order) {
      if (r.team_id === 't8') r.seed = 9;
      if (r.team_id === 't9') r.seed = 8;
    }
    await mountSignOffScreen(root, { eventId: 'ev1', client });
    await flush();
    const names = [...root.querySelectorAll('.ok-signoff-table tbody tr')].map((tr) =>
      tr.querySelectorAll('td')[1].textContent.replace(/^.*?(Team \d+)$/, '$1'),
    );
    expect(names).toEqual(Array.from({ length: 8 }, (_, i) => `Team ${i + 1}`));
    expect(root.querySelector('.ok-signoff-status').getAttribute('data-status')).toBe('final');
    expect(root.querySelector('.ok-signoff-status').textContent).toContain(
      'no longer match the locked eight',
    );
  });

  it('shows the sheet with the eight, a toolbar that is hidden when printing, and moves focus to the heading', async () => {
    await mountSignOffScreen(root, { eventId: 'ev1', client: fakeClient() });
    await flush();
    expect(root.querySelector('.ok-signoff-status').getAttribute('data-status')).toBe('final');
    expect(root.querySelectorAll('.ok-signoff-table tbody tr')).toHaveLength(8);
    expect(root.querySelector('.ok-no-print')).not.toBeNull();
    expect(root.querySelector('.ok-no-print').contains(root.querySelector('.ok-signoff'))).toBe(
      false,
    );
    expect(document.activeElement).toBe(root.querySelector('h1'));
    const back = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Back to Standings');
    expect(back.getAttribute('href')).toBe('#/events/ev1/btc/standings');
  });

  it('Print / Save as PDF opens the browser print dialog, and the page title names the event while printing', async () => {
    window.print = vi.fn();
    const before = document.title;
    const screen = await mountSignOffScreen(root, { eventId: 'ev1', client: fakeClient() });
    await flush();
    [...root.querySelectorAll('button')]
      .find((b) => b.textContent === 'Print / Save as PDF')
      .click();
    expect(window.print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toBe('Top 8 sign-off — ABTC Test');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe(before);
    screen.unmount();
  });

  it('says a failed print in words', async () => {
    window.print = vi.fn(() => {
      throw new Error('blocked');
    });
    await mountSignOffScreen(root, { eventId: 'ev1', client: fakeClient() });
    await flush();
    [...root.querySelectorAll('button')]
      .find((b) => b.textContent === 'Print / Save as PDF')
      .click();
    expect(root.querySelector('.btc-signoff-toolbar [role="status"]').textContent).toBe('blocked');
  });

  it('shows a load error with Retry', async () => {
    const client = fakeClient({ failTeams: true });
    await mountSignOffScreen(root, { eventId: 'ev1', client });
    await flush();
    expect(root.querySelector('.screen-feedback[data-tone="error"]')).not.toBeNull();
    expect(root.querySelector('.ok-signoff')).toBeNull();
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(true);
  });
});
