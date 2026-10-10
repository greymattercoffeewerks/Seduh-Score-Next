import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBracketScreen } from './bracketScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

vi.mock('./liveSession.js', () => ({ publishBtcLive: vi.fn(async () => {}) }));

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// A view row as the database returns it. Teams are level when they share points and wins.
const row = (teamId, seed, points, wins, extra = {}) => ({
  event_id: 'ev1',
  team_id: teamId,
  seed,
  played: 3,
  wins,
  total_points: points,
  tied_count: 1,
  tiebreak_rank: null,
  reason: null,
  group_resolved: true,
  ...extra,
});
const level = (teamId, seed, points, wins, extra = {}) =>
  row(teamId, seed, points, wins, { tied_count: 2, group_resolved: false, ...extra });

// Nine teams, T1 ... T9: T8 and T9 are level across the cut-off; T2 and T3 are level inside the top eight.
function nineTeamsWithTies() {
  return [
    row('t1', 1, 90, 3),
    level('t2', 2, 60, 2),
    level('t3', 3, 60, 2),
    row('t4', 4, 55, 2),
    row('t5', 5, 50, 1),
    row('t6', 6, 45, 1),
    row('t7', 7, 40, 1),
    level('t8', 8, 35, 1),
    level('t9', 9, 35, 1),
  ];
}

function fakeClient(
  order,
  { orderError, recordError, recordResult, generateError, hangRecord } = {},
) {
  const db = {
    events: [{ id: 'ev1', org_id: 'org1', name: 'BTC Test Event', is_test: false }],
    btc_teams: Array.from({ length: 9 }, (_, i) => ({
      id: `t${i + 1}`,
      event_id: 'ev1',
      name: `Team ${i + 1}`,
    })),
    btc_judges: [],
    btc_bracket_slots: [],
    btc_matches: [],
    btc_seeding_order: order.map((r) => ({ ...r })),
  };
  const rpcCalls = [];
  const fromCalls = [];
  const control = { failOrderRead: orderError ?? null };
  function builder(table) {
    const filters = [];
    const b = {
      select: () => b,
      eq(column, value) {
        filters.push([column, value]);
        return b;
      },
      in: () => b,
      order: () => b,
      single() {
        const rows = (db[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      then(resolve, reject) {
        if (table === 'btc_seeding_order' && control.failOrderRead) {
          return Promise.resolve({ data: null, error: control.failOrderRead }).then(
            resolve,
            reject,
          );
        }
        const rows = (db[table] ?? [])
          .filter((r) => filters.every(([c, v]) => r[c] === v))
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    db,
    control,
    rpcCalls,
    fromCalls,
    from(table) {
      fromCalls.push(table);
      return builder(table);
    },
    rpc(name, args) {
      rpcCalls.push([name, args]);
      if (name === 'generate_btc_bracket') {
        if (generateError) return Promise.resolve({ data: null, error: generateError });
        db.btc_bracket_slots = [
          {
            id: 's1',
            event_id: 'ev1',
            round: 'quarterfinal',
            slot_label: 'qf1',
            team1_id: 't1',
            team2_id: 't8',
            match_id: null,
            seed_1: 1,
            seed_2: 8,
          },
        ];
        return Promise.resolve({ data: db.btc_bracket_slots, error: null });
      }
      if (name === 'record_btc_seeding_tiebreak') {
        if (hangRecord) {
          return new Promise((resolve) => {
            control.release = () => resolve({ data: null, error: null });
          });
        }
        if (recordError) return Promise.resolve({ data: null, error: recordError });
        recordResult?.(db, args);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

// What the database does on a successful record: ranks by array position, group resolved, order by rank.
function applyOrder(db, args) {
  args.p_team_ids.forEach((teamId, index) => {
    const r = db.btc_seeding_order.find((x) => x.team_id === teamId);
    r.tiebreak_rank = index + 1;
    r.reason = args.p_reason;
    r.group_resolved = true;
  });
  const seeds = args.p_team_ids
    .map((id) => db.btc_seeding_order.find((x) => x.team_id === id).seed)
    .sort((a, b) => a - b);
  args.p_team_ids.forEach((teamId, index) => {
    db.btc_seeding_order.find((x) => x.team_id === teamId).seed = seeds[index];
  });
}

describe('the seeding ties card on the bracket screen', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  const mount = async (client) => {
    await mountBracketScreen(root, { eventId: 'ev1', client });
    await flush();
  };
  const card = () => root.querySelector('.btc-seeding-card');
  const group = (n) => root.querySelectorAll('.btc-seeding-group')[n];
  const text = (node) => node?.textContent ?? null;
  const names = (node) => [...node.querySelectorAll('.btc-seeding-team')].map((n) => n.textContent);
  const openButtonOf = (g) =>
    [...g.querySelectorAll('button')].find((b) => /order/i.test(b.textContent));
  const byKey = (key) => root.querySelector(`[data-focus-key="${key}"]`);

  it('shows nothing when no teams are level', async () => {
    await mount(fakeClient([row('t1', 1, 90, 3), row('t2', 2, 60, 2)]));
    expect(card()).toBeNull();
    expect(root.textContent).toContain('Generate bracket');
  });

  it('lists each group of level teams with where they stand, and says which one decides who qualifies', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    expect(text(card().querySelector('h2'))).toBe('Teams level in the standings');
    const groups = root.querySelectorAll('.btc-seeding-group');
    expect(groups).toHaveLength(2);
    expect(text(group(0).querySelector('h3'))).toBe('Level for 2nd to 3rd · 60 pts, 2 wins');
    expect(names(group(0))).toEqual(['Team 2', 'Team 3']);
    expect(group(0).textContent).not.toContain('decides who qualifies');
    expect(text(group(1).querySelector('h3'))).toBe('Level for 8th to 9th · 35 pts, 1 win');
    expect(group(1).textContent).toContain('their order decides who qualifies');
    expect(group(0).textContent).toContain('Not ordered yet');
    expect(group(1).textContent).toContain('Not ordered yet');
    expect(card().textContent).toContain(
      'cannot be generated until the teams level across the cut-off',
    );
  });

  it('only the unordered group across the cut-off blocks, so ordering it removes the warning', async () => {
    const order = nineTeamsWithTies().map((r) =>
      ['t8', 't9'].includes(r.team_id)
        ? {
            ...r,
            group_resolved: true,
            tiebreak_rank: r.team_id === 't9' ? 1 : 2,
            reason: 'Cup-off',
          }
        : r,
    );
    await mount(fakeClient(order));
    expect(card().textContent).not.toContain('cannot be generated');
    expect(group(1).textContent).toContain('Ordered: Cup-off');
    expect(openButtonOf(group(1)).textContent).toBe('Change order');
    expect(openButtonOf(group(0)).textContent).toBe('Order these teams');
  });

  it('opens a form for one group: the teams in order with move buttons, a reason, and focus on the form', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    const form = root.querySelector('.btc-seeding-form');
    expect(names(form)).toEqual(['Team 8', 'Team 9']);
    expect(document.activeElement.getAttribute('data-focus-key')).toMatch(/^seeding-form-heading-/);
    // the other group stays as it was
    expect(group(0).querySelector('form')).toBeNull();
    // the first team cannot move up and the last cannot move down, but the buttons stay focusable
    expect(byKey('seeding-up-t8').getAttribute('aria-disabled')).toBe('true');
    expect(byKey('seeding-down-t9').getAttribute('aria-disabled')).toBe('true');
    expect(byKey('seeding-down-t8').hasAttribute('aria-disabled')).toBe(false);
    expect(byKey('seeding-up-t8').getAttribute('aria-label')).toBe('Move up: Team 8');
  });

  it('moves a team, keeps keyboard focus on the button just pressed, and ignores a move past the end', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').focus();
    byKey('seeding-down-t8').click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 9', 'Team 8']);
    expect(document.activeElement).toBe(byKey('seeding-down-t8'));
    expect(byKey('seeding-down-t8').getAttribute('aria-disabled')).toBe('true');
    byKey('seeding-down-t8').click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 9', 'Team 8']);
    byKey('seeding-up-t8').click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 8', 'Team 9']);
  });

  it('says which seed each team has, and while ordering which seed it would get', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    const seeds = (node) =>
      [...node.querySelectorAll('.btc-seeding-seed')].map((n) => n.textContent);
    // nobody has ordered these: the seeds they have by default are said to be provisional
    expect(seeds(group(0))).toEqual(['Seed 2 (provisional)', 'Seed 3 (provisional)']);
    expect(seeds(group(1))).toEqual(['Seed 8 (provisional)', 'Seed 9 (provisional)']);
    openButtonOf(group(1)).click();
    const form = root.querySelector('.btc-seeding-form');
    expect(names(form)).toEqual(['Team 8', 'Team 9']);
    expect(seeds(form)).toEqual(['Seed 8', 'Seed 9']);
    byKey('seeding-down-t8').click();
    const moved = root.querySelector('.btc-seeding-form');
    expect(names(moved)).toEqual(['Team 9', 'Team 8']);
    expect(seeds(moved)).toEqual(['Seed 8', 'Seed 9']);
  });

  it('cancel closes the form, changes nothing and puts focus back on the group’s button', async () => {
    const client = fakeClient(nineTeamsWithTies());
    await mount(client);
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').click();
    root.querySelector('[data-focus-key^="seeding-cancel-"]').click();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(names(group(1))).toEqual(['Team 8', 'Team 9']);
    expect(document.activeElement.getAttribute('data-focus-key')).toMatch(/^seeding-open-/);
    expect(client.rpcCalls).toEqual([]);
  });

  it('refuses a save without a reason, in words, and says so to the field', async () => {
    const client = fakeClient(nineTeamsWithTies());
    await mount(client);
    openButtonOf(group(1)).click();
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const error = root.querySelector('.btc-seeding-form [role="alert"]');
    expect(error.textContent).toBe('Give a reason, so the decision can be explained later.');
    expect(document.activeElement).toBe(error);
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
    expect(client.rpcCalls).toEqual([]);
  });

  it('saves the order best first with the reason, then shows the group ordered', async () => {
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = '  Won the cup-off  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(client.rpcCalls).toEqual([
      [
        'record_btc_seeding_tiebreak',
        {
          p_org_id: 'org1',
          p_event_id: 'ev1',
          p_team_ids: ['t9', 't8'],
          p_reason: 'Won the cup-off',
        },
      ],
    ]);
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(group(1).textContent).toContain('Ordered: Won the cup-off');
    expect(names(group(1))).toEqual(['Team 9', 'Team 8']);
    expect(card().textContent).not.toContain('cannot be generated');
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Order saved. Every team level across the cut-off is ordered: you can generate the bracket.',
    );
    expect(document.activeElement.getAttribute('data-focus-key')).toMatch(/^seeding-open-/);
  });

  it('starts a change from the recorded order and reason', async () => {
    const order = nineTeamsWithTies().map((r) =>
      r.team_id === 't8'
        ? { ...r, seed: 9, group_resolved: true, tiebreak_rank: 2, reason: 'Head to head' }
        : r.team_id === 't9'
          ? { ...r, seed: 8, group_resolved: true, tiebreak_rank: 1, reason: 'Head to head' }
          : r,
    );
    await mount(fakeClient(order));
    openButtonOf(group(1)).click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 9', 'Team 8']);
    expect(root.querySelector('.btc-seeding-form input[type="text"]').value).toBe('Head to head');
  });

  it('a refusal that means the page is stale refreshes it, closes the form and says why', async () => {
    const client = fakeClient(nineTeamsWithTies(), {
      recordError: Object.assign(new Error('not tied'), { hint: 'seeding_not_tied' }),
    });
    await mount(client);
    openButtonOf(group(1)).click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // the teams stopped being level while the form was open
    client.db.btc_seeding_order = client.db.btc_seeding_order.map((r) => ({
      ...r,
      tied_count: 1,
      group_resolved: true,
    }));
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(card()).toBeNull();
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/no longer level/);
  });

  it('any other refusal stays in the form, in words, and keeps the draft', async () => {
    const client = fakeClient(nineTeamsWithTies(), {
      recordError: Object.assign(new Error('reason'), { hint: 'seeding_reason_too_long' }),
    });
    await mount(client);
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = 'some reason';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    const error = root.querySelector('.btc-seeding-form [role="alert"]');
    expect(error.textContent).toBe('Keep the reason to 120 characters or fewer.');
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 9', 'Team 8']);
    expect(root.querySelector('.btc-seeding-form input[type="text"]').value).toBe('some reason');
    expect(document.activeElement).toBe(error);
  });

  it('a save that worked but whose refresh failed says so, rather than that it failed', async () => {
    const client = fakeClient(nineTeamsWithTies(), {
      recordResult: (db, args) => {
        applyOrder(db, args);
        client.failNextRead = true;
      },
    });
    await mount(client);
    const refreshNote = root.querySelector('.btc-bracket-refresh-note');
    expect(refreshNote.hidden).toBe(true);
    expect(root.contains(refreshNote)).toBe(true);
    openButtonOf(group(1)).click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // make the re-read of the order fail once
    const realFrom = client.from.bind(client);
    client.from = (table) => {
      if (table === 'btc_seeding_order' && client.failNextRead) {
        client.failNextRead = false;
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: null, error: new Error('offline') }),
          }),
        };
      }
      return realFrom(table);
    };
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(root.querySelector('.btc-bracket-refresh-note')).toBe(refreshNote);
    expect(refreshNote.hidden).toBe(false);
    expect(refreshNote.textContent).toContain(
      'Order saved, but the page could not refresh. Reload to see the standings.',
    );
    expect(root.querySelector('.screen-feedback')).toBeNull();

    byKey('bracket-refresh-reload').click();
    await flush();
    expect(refreshNote.hidden).toBe(true);
    expect(group(1).textContent).toContain('Ordered: x');
  });

  it('still loads the screen, quietly, when the view does not exist yet (its migration not applied)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount(
      fakeClient(nineTeamsWithTies(), {
        orderError: Object.assign(new Error('not in the schema cache'), { code: 'PGRST205' }),
      }),
    );
    expect(card()).toBeNull();
    expect(root.textContent).toContain('Generate bracket');
    expect(root.querySelector('.screen-feedback[data-tone="error"]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('says so when the seed order cannot be read for any other reason, with a way to check again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { orderError: new Error('Failed to fetch') });
    await mount(client);
    expect(root.textContent).toContain('Generate bracket');
    expect(card().textContent).toContain('We could not check for teams that are level just now');
    expect(card().querySelector('[role="status"]')).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    // the connection comes back
    client.control.failOrderRead = null;
    byKey('seeding-retry').click();
    await flush();
    expect(card().textContent).not.toContain('We could not check');
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Checked: 2 groups of level teams.',
    );
  });

  it('keeps the table it has when a later read fails, and says the check failed when retried', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies());
    await mount(client);
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
    client.control.failOrderRead = new Error('offline');
    // a refused save for a stale screen re-reads the order
    client.rpc = () =>
      Promise.resolve({
        data: null,
        error: Object.assign(new Error('x'), { hint: 'seeding_not_tied' }),
      });
    openButtonOf(group(1)).click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
  });

  it('is gone once a bracket exists, and the seed order is not even read', async () => {
    const client = fakeClient(nineTeamsWithTies());
    client.db.btc_bracket_slots = [
      {
        id: 's1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't8',
        match_id: null,
        seed_1: 1,
        seed_2: 8,
      },
    ];
    await mount(client);
    expect(card()).toBeNull();
    expect(client.fromCalls).not.toContain('btc_seeding_order');
  });

  it('shows team names as text, never markup', async () => {
    const client = fakeClient(nineTeamsWithTies());
    client.db.btc_teams[7].name = '<img src=x onerror=alert(1)>';
    await mount(client);
    expect(card().querySelector('img')).toBeNull();
    expect(card().textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows the reason only for a group that is fully ordered', async () => {
    const order = nineTeamsWithTies().map((r) =>
      r.team_id === 't8'
        ? { ...r, tiebreak_rank: 1, reason: 'Head to head', group_resolved: false }
        : r,
    );
    await mount(fakeClient(order));
    expect(group(1).textContent).toContain('Not ordered yet');
    expect(group(1).textContent).not.toContain('Head to head');
  });

  it('labels the form and the lists with the group they are about, and the lists are lists', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    const title = group(1).querySelector('h3');
    expect(title.id).toBeTruthy();
    const list = group(1).querySelector('ol');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-labelledby')).toBe(title.id);
    openButtonOf(group(1)).click();
    expect(root.querySelector('.btc-seeding-form').getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('names the reason field as it is labelled on screen, and marks it required', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    expect(input.getAttribute('aria-label')).toBe('Reason (required)');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('puts the error right above the reason field, not at the top of the form', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    root
      .querySelector('.btc-seeding-form')
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const form = root.querySelector('.btc-seeding-form');
    const kids = [...form.children];
    const errorAt = kids.findIndex((n) => n.getAttribute('role') === 'alert');
    const fieldAt = kids.findIndex((n) => n.querySelector?.('input[type="text"]'));
    expect(errorAt).toBeGreaterThan(-1);
    expect(fieldAt).toBe(errorAt + 1);
  });

  it('end-of-list move buttons are inert but not "busy": only aria-disabled', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    expect(byKey('seeding-up-t8').getAttribute('aria-disabled')).toBe('true');
    expect(byKey('seeding-up-t8').hasAttribute('aria-busy')).toBe(false);
  });

  it('while one group is being ordered the others cannot be opened, so a draft is never dropped', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').click();
    const otherOpen = openButtonOf(group(0));
    expect(otherOpen.getAttribute('aria-disabled')).toBe('true');
    otherOpen.click();
    expect(root.querySelectorAll('.btc-seeding-form')).toHaveLength(1);
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 9', 'Team 8']);
  });

  it('says in words, to a screen reader, what a move did', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    byKey('seeding-down-t8').click();
    const live = root.querySelector('.sr-only[role="status"]');
    expect(live.textContent).toBe('Team 8 is now seed 9, Team 9 is now seed 8.');
    byKey('seeding-up-t8').click();
    expect(live.textContent).toBe('Team 8 is now seed 8, Team 9 is now seed 9.');
  });

  it('keeps the same live region across rebuilds (a fresh node would not be announced)', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    const before = root.querySelector('.sr-only[role="status"]');
    byKey('seeding-down-t8').click();
    expect(root.querySelector('.sr-only[role="status"]')).toBe(before);
  });

  it('Generate is marked inert while teams level across the cut-off are unordered, and pressing it says why without asking the database', async () => {
    const client = fakeClient(nineTeamsWithTies());
    await mount(client);
    const generate = byKey('generate-bracket');
    expect(generate.getAttribute('aria-disabled')).toBe('true');
    expect(generate.getAttribute('aria-describedby')).toBe('btc-seeding-blocking');
    expect(root.querySelector('#btc-seeding-blocking').textContent).toMatch(/cannot be generated/);
    generate.click();
    await flush();
    expect(root.querySelector('.screen-feedback').textContent).toMatch(
      /Teams are level across the 8th and 9th places/,
    );
    expect(client.rpcCalls).toEqual([]);
  });

  it('Generate works once that group is ordered', async () => {
    const order = nineTeamsWithTies().map((r) =>
      ['t8', 't9'].includes(r.team_id)
        ? { ...r, group_resolved: true, tiebreak_rank: 1, reason: 'x' }
        : r,
    );
    const client = fakeClient(order);
    await mount(client);
    const generate = byKey('generate-bracket');
    expect(generate.hasAttribute('aria-disabled')).toBe(false);
    generate.click();
    await flush();
    expect(client.rpcCalls.map(([name]) => name)).toEqual(['generate_btc_bracket']);
    expect(root.querySelector('.screen-feedback').textContent).toBe('Bracket generated.');
  });

  it('a refused Generate re-reads the order, so a tie that appeared meanwhile shows up, and a form open on a group that vanished closes', async () => {
    const level = nineTeamsWithTies();
    const client = fakeClient(
      // no cut-off tie when the page loaded ...
      level.map((r) =>
        ['t8', 't9'].includes(r.team_id)
          ? row(r.team_id, r.seed, r.total_points - (r.team_id === 't9' ? 5 : 0), r.wins)
          : r,
      ),
      {
        generateError: {
          code: 'P0001',
          message: 'generate_btc_bracket: teams are tied for the 8th qualifying spot',
        },
      },
    );
    await mount(client);
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(1);
    // ... and another device re-confirmed a match, making T8 and T9 level
    client.db.btc_seeding_order = level.map((r) => ({ ...r }));
    byKey('generate-bracket').click();
    await flush();
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
    expect(root.querySelector('.screen-feedback').textContent).toMatch(
      /Teams are level across the 8th and 9th places/,
    );
  });

  it('a save that never answers ends with a message and a way to try again, not a spinner for ever', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(nineTeamsWithTies(), { hangRecord: true });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      await vi.advanceTimersByTimeAsync(0);
      openButtonOf(group(1)).click();
      const input = root.querySelector('.btc-seeding-form input[type="text"]');
      input.value = 'x';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      root
        .querySelector('.btc-seeding-form')
        .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Saving…');
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
      expect(root.textContent).toContain('Saving…');
      await vi.advanceTimersByTimeAsync(1);
      const error = root.querySelector('.btc-seeding-form [role="alert"]');
      expect(error.textContent).toBe(
        'Could not confirm the save. Check your connection, then try again.',
      );
      expect(document.activeElement).toBe(error);
      expect(root.textContent).not.toContain('Saving…');
      expect(root.querySelector('.btc-seeding-form input[type="text"]').value).toBe('x');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- what the first round of tests did not pin ----

  const resolvedCutoff = (rows) =>
    rows.map((r) =>
      ['t8', 't9'].includes(r.team_id)
        ? { ...r, group_resolved: true, tiebreak_rank: r.team_id === 't8' ? 1 : 2, reason: 'x' }
        : r,
    );
  const submitForm = () => {
    const form = root.querySelector('.btc-seeding-form');
    const event = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(event);
    return event;
  };
  const typeReason = (text) => {
    const input = root.querySelector('.btc-seeding-form input[type="text"]');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('writes the announcement only once the live region is in the page, says it once, and clears it', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    const proto = Node.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'textContent');
    const writes = [];
    Object.defineProperty(proto, 'textContent', {
      configurable: true,
      get: original.get,
      set(value) {
        if (this.getAttribute?.('role') === 'status' && this.classList?.contains('sr-only')) {
          writes.push([value, this.isConnected]);
        }
        original.set.call(this, value);
      },
    });
    try {
      byKey('seeding-down-t8').click();
    } finally {
      Object.defineProperty(proto, 'textContent', original);
    }
    expect(writes.filter(([value]) => value !== '')).toEqual([
      ['Team 8 is now seed 9, Team 9 is now seed 8.', true],
    ]);
    const live = root.querySelector('.sr-only[role="status"]');
    expect(live.getAttribute('aria-live')).toBe('polite');
    // an unrelated rebuild does not say it again
    root.querySelector('[data-focus-key^="seeding-cancel-"]').click();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('');
  });

  it('saving another group while the cut-off one is still unordered says only "Order saved." and keeps the warning', async () => {
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    openButtonOf(group(0)).click();
    typeReason('Head to head');
    submitForm();
    await flush();
    expect(root.querySelector('.screen-feedback').textContent).toBe('Order saved.');
    expect(card().textContent).toContain('cannot be generated until');
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('saving an already ordered cut-off group again says only "Order saved."', async () => {
    const client = fakeClient(resolvedCutoff(nineTeamsWithTies()), { recordResult: applyOrder });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('Changed my mind');
    submitForm();
    await flush();
    expect(root.querySelector('.screen-feedback').textContent).toBe('Order saved.');
  });

  it('when the bracket already exists the save is refused in words, the form closes and the bracket replaces the card', async () => {
    const client = fakeClient(nineTeamsWithTies(), {
      recordError: Object.assign(new Error('exists'), { hint: 'seeding_bracket_exists' }),
    });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('x');
    // another device generated the bracket while this form was open
    client.db.btc_bracket_slots = [
      {
        id: 's1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't8',
        match_id: null,
        seed_1: 1,
        seed_2: 8,
      },
    ];
    submitForm();
    await flush();
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'The bracket has already been generated, so the seeds are fixed.',
    );
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(card()).toBeNull();
    expect(root.querySelector('.btc-bracket-rounds')).not.toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('a refusal that stays in the form leaves nothing busy and shows the error as an alert', async () => {
    const client = fakeClient(nineTeamsWithTies(), {
      recordError: Object.assign(new Error('long'), { hint: 'seeding_reason_too_long' }),
    });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('x');
    submitForm();
    await flush();
    expect(root.querySelector('.btc-seeding-form [role="alert"]')).not.toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
    const submit = root.querySelector('[data-focus-key^="seeding-submit-"]');
    expect(submit.getAttribute('aria-describedby')).toBe(
      root.querySelector('.btc-seeding-form [role="alert"]').id,
    );
  });

  it('Check again says so when the read fails again, and ignores a second press while it is reading', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { orderError: new Error('Failed to fetch') });
    await mount(client);
    const reads = () => client.fromCalls.filter((t) => t === 'btc_seeding_order').length;
    const before = reads();
    let release;
    const realFrom = client.from.bind(client);
    client.from = (table) => {
      if (table !== 'btc_seeding_order') return realFrom(table);
      client.fromCalls.push(table);
      return {
        select: () => ({
          eq: () =>
            new Promise((resolve) => {
              release = () => resolve({ data: null, error: new Error('still down') });
            }),
        }),
      };
    };
    byKey('seeding-retry').click();
    expect(byKey('seeding-retry').getAttribute('aria-busy')).toBe('true');
    byKey('seeding-retry').click();
    expect(reads()).toBe(before + 1);
    release();
    await flush();
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Still could not check. Try again.',
    );
    expect(card().textContent).toContain('We could not check for teams that are level just now');
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('while a save is in flight everything in the card is inert and says it is busy', async () => {
    const client = fakeClient(nineTeamsWithTies(), { hangRecord: true });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('x');
    submitForm();
    await flush();
    const busy = (node) =>
      node.getAttribute('aria-disabled') === 'true' && node.getAttribute('aria-busy') === 'true';
    expect(busy(byKey('seeding-up-t8'))).toBe(true);
    expect(busy(byKey('seeding-down-t8'))).toBe(true);
    expect(busy(root.querySelector('[data-focus-key^="seeding-submit-"]'))).toBe(true);
    expect(busy(root.querySelector('[data-focus-key^="seeding-cancel-"]'))).toBe(true);
    expect(busy(root.querySelector('.btc-seeding-form input[type="text"]'))).toBe(true);
    expect(busy(openButtonOf(group(0)))).toBe(true);
    expect(busy(byKey('generate-bracket'))).toBe(true); // Generate says it is waiting too
    expect(
      root.querySelector('.btc-seeding-form input[type="text"]').getAttribute('maxlength'),
    ).toBe('120');
    expect(byKey('seeding-down-t8').getAttribute('aria-label')).toBe('Move down: Team 8');
    // nothing happens when they are pressed
    byKey('seeding-down-t8').click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 8', 'Team 9']);
    client.control.release();
    await flush();
  });

  it('a Generate that is running blocks seeding changes', async () => {
    const client = fakeClient(resolvedCutoff(nineTeamsWithTies()));
    const realRpc = client.rpc.bind(client);
    let releaseGenerate;
    const calls = [];
    client.rpc = (name, args) => {
      calls.push(name);
      return name === 'generate_btc_bracket'
        ? new Promise((resolve) => {
            releaseGenerate = () => resolve(realRpc(name, args));
          })
        : realRpc(name, args);
    };
    await mount(client);
    byKey('generate-bracket').click();
    await flush();
    expect(root.textContent).toContain('Generating…');
    expect(openButtonOf(group(0)).getAttribute('aria-busy')).toBe('true');
    openButtonOf(group(0)).click();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(calls).toEqual(['generate_btc_bracket']);
    releaseGenerate();
    await flush();
  });

  it('a submit of the form while a save is in flight is stopped before the page can navigate, and sends nothing more', async () => {
    const client = fakeClient(nineTeamsWithTies(), { hangRecord: true });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('x');
    submitForm();
    await flush();
    const again = submitForm();
    expect(again.defaultPrevented).toBe(true);
    expect(client.rpcCalls.filter(([name]) => name === 'record_btc_seeding_tiebreak')).toHaveLength(
      1,
    );
    client.control.release();
    await flush();
  });

  it('Generate is held back, with the reason in words, while an order is open and unsaved', async () => {
    const client = fakeClient(resolvedCutoff(nineTeamsWithTies()));
    await mount(client);
    openButtonOf(group(0)).click();
    byKey('seeding-down-t2').click();
    const generate = byKey('generate-bracket');
    expect(generate.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector(`#${generate.getAttribute('aria-describedby')}`).textContent).toBe(
      'Save or cancel the order you have open before generating the bracket.',
    );
    generate.focus();
    generate.click();
    await flush();
    expect(client.rpcCalls).toEqual([]);
    expect(root.querySelector('.btc-seeding-form')).not.toBeNull();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 3', 'Team 2']);
    // focus stays on the button; the message is said through the live region, not by moving focus
    expect(document.activeElement).toBe(byKey('generate-bracket'));
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe(
      'Save or cancel the order you have open before generating the bracket.',
    );
  });

  it('pressing the button of another group while one is open says why instead of doing nothing', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    openButtonOf(group(0)).click();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe(
      'Save or cancel the order you have open first.',
    );
    expect(root.querySelectorAll('.btc-seeding-form')).toHaveLength(1);
  });

  it('says that the order is being saved', async () => {
    const client = fakeClient(nineTeamsWithTies(), { hangRecord: true });
    await mount(client);
    openButtonOf(group(1)).click();
    typeReason('x');
    submitForm();
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('Saving the order…');
    client.control.release();
    await flush();
  });

  it('names each open button by its group, and the move buttons so that their label contains what is on screen', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    expect(openButtonOf(group(0)).getAttribute('aria-label')).toBe(
      'Order these teams: Level for 2nd to 3rd · 60 pts, 2 wins',
    );
    expect(openButtonOf(group(1)).getAttribute('aria-label')).toBe(
      'Order these teams: Level for 8th to 9th · 35 pts, 1 win',
    );
    openButtonOf(group(1)).click();
    const down = byKey('seeding-down-t8');
    expect(down.textContent).toBe('Move down');
    expect(down.getAttribute('aria-label').startsWith(down.textContent)).toBe(true);
  });

  it('a save that is running blocks Generate', async () => {
    const order = resolvedCutoff(nineTeamsWithTies());
    const client = fakeClient(order, { hangRecord: true });
    await mount(client);
    openButtonOf(group(0)).click();
    typeReason('x');
    submitForm();
    await flush();
    byKey('generate-bracket').click();
    await flush();
    expect(client.rpcCalls.map(([name]) => name)).toEqual(['record_btc_seeding_tiebreak']);
    client.control.release();
    await flush();
  });

  it('a refused Generate re-reads the order, so a tie that appeared meanwhile shows up', async () => {
    const level = nineTeamsWithTies();
    const client = fakeClient(
      level.map((r) =>
        r.team_id === 't9' ? row('t9', 9, 30, 1) : r.team_id === 't8' ? row('t8', 8, 36, 1) : r,
      ),
      {
        generateError: {
          code: 'P0001',
          message: 'generate_btc_bracket: teams are tied for the 8th qualifying spot',
        },
      },
    );
    await mount(client);
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(1);
    client.db.btc_seeding_order = level.map((r) => ({ ...r }));
    byKey('generate-bracket').click();
    await flush();
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
  });

  it('keeps the table it has and does not show "could not check" while it holds rows', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies());
    await mount(client);
    client.control.failOrderRead = new Error('offline');
    client.rpc = () =>
      Promise.resolve({
        data: null,
        error: Object.assign(new Error('x'), { hint: 'seeding_not_tied' }),
      });
    openButtonOf(group(1)).click();
    typeReason('x');
    submitForm();
    await flush();
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(2);
    expect(card().textContent).not.toContain('We could not check');
  });

  it('a move at either end changes nothing and says nothing', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    byKey('seeding-up-t8').click();
    byKey('seeding-down-t9').click();
    expect(names(root.querySelector('.btc-seeding-form'))).toEqual(['Team 8', 'Team 9']);
    expect(root.querySelector('.sr-only[role="status"]').textContent).toBe('');
  });

  it('an error is cleared by the next move, and by opening the form again', async () => {
    await mount(fakeClient(nineTeamsWithTies()));
    openButtonOf(group(1)).click();
    submitForm();
    expect(root.querySelector('.btc-seeding-form [role="alert"]')).not.toBeNull();
    byKey('seeding-down-t8').click();
    expect(root.querySelector('.btc-seeding-form [role="alert"]')).toBeNull();
    submitForm();
    expect(root.querySelector('.btc-seeding-form [role="alert"]')).not.toBeNull();
    root.querySelector('[data-focus-key^="seeding-cancel-"]').click();
    openButtonOf(group(1)).click();
    expect(root.querySelector('.btc-seeding-form [role="alert"]')).toBeNull();
  });

  // ---- the delta review ----

  it('a refresh that changes WHO is in the open group (same numbers) closes the form instead of crashing the screen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    // a save whose refresh fails leaves the list possibly stale, with "Check again" beside it
    openButtonOf(group(0)).click();
    typeReason('x');
    client.control.failOrderRead = new Error('offline');
    submitForm();
    await flush();
    expect(byKey('seeding-retry')).not.toBeNull();
    // an order is opened on the cut-off group, and meanwhile the group changes under it
    openButtonOf(group(1)).click();
    expect(root.querySelector('.btc-seeding-form')).not.toBeNull();
    client.db.btc_seeding_order = client.db.btc_seeding_order.map((r) =>
      r.team_id === 't9'
        ? { ...r, total_points: 5, wins: 0, tied_count: 1, group_resolved: true }
        : r.team_id === 't7'
          ? { ...r, total_points: 35, wins: 1, tied_count: 2, group_resolved: false }
          : r,
    );
    client.control.failOrderRead = null;
    byKey('seeding-retry').click();
    await flush();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(root.querySelector('.btc-seeding-card')).not.toBeNull();
    expect(names(root.querySelector('.btc-seeding-card'))).toContain('Team 7');
  });

  it('a group that GREW under an open form closes the form too (the draft would never validate)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    // a save whose refresh fails leaves the list possibly stale, with "Check again" beside it
    openButtonOf(group(0)).click();
    typeReason('x');
    client.control.failOrderRead = new Error('offline');
    submitForm();
    await flush();
    expect(byKey('seeding-retry')).not.toBeNull();
    // an order is opened on the cut-off group, and meanwhile the group changes under it
    openButtonOf(group(1)).click();
    expect(root.querySelector('.btc-seeding-form')).not.toBeNull();
    client.db.btc_seeding_order = client.db.btc_seeding_order.map((r) =>
      ['t8', 't9'].includes(r.team_id)
        ? { ...r, tied_count: 3 }
        : r.team_id === 't7'
          ? { ...r, total_points: 35, wins: 1, tied_count: 3, group_resolved: false }
          : r,
    );
    client.control.failOrderRead = null;
    byKey('seeding-retry').click();
    await flush();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(root.querySelector('.btc-seeding-card')).not.toBeNull();
    expect(names(root.querySelectorAll('.btc-seeding-group')[1])).toEqual([
      'Team 7',
      'Team 8',
      'Team 9',
    ]);
  });

  it('a group that stopped being level under an open form closes the form', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    // a save whose refresh fails leaves the list possibly stale, with "Check again" beside it
    openButtonOf(group(0)).click();
    typeReason('x');
    client.control.failOrderRead = new Error('offline');
    submitForm();
    await flush();
    expect(byKey('seeding-retry')).not.toBeNull();
    // an order is opened on the cut-off group, and meanwhile the group changes under it
    openButtonOf(group(1)).click();
    expect(root.querySelector('.btc-seeding-form')).not.toBeNull();
    client.db.btc_seeding_order = client.db.btc_seeding_order.map((r) =>
      ['t8', 't9'].includes(r.team_id) ? { ...r, tied_count: 1, group_resolved: true } : r,
    );
    client.control.failOrderRead = null;
    byKey('seeding-retry').click();
    await flush();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
    expect(root.querySelector('.btc-seeding-card')).not.toBeNull();
    expect(root.querySelectorAll('.btc-seeding-group')).toHaveLength(1);
  });

  it('when the list could not be refreshed it says so, offers Check again beside the old list, and does not claim the bracket is blocked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    expect(card().textContent).toContain('cannot be generated until');
    openButtonOf(group(0)).click();
    typeReason('x');
    client.control.failOrderRead = new Error('offline');
    submitForm();
    await flush();
    expect(root.querySelector('.btc-bracket-refresh-note-message').textContent).toBe(
      'Order saved, but the page could not refresh. Reload to see the standings.',
    );
    expect(card().textContent).toContain(
      'We could not refresh this list, so it may be out of date.',
    );
    expect(byKey('seeding-retry')).not.toBeNull();
    expect(card().textContent).not.toContain('cannot be generated until');
    // Generate is no longer held back by what may be out of date: the database decides
    expect(byKey('generate-bracket').hasAttribute('aria-disabled')).toBe(false);
    client.control.failOrderRead = null;
    byKey('seeding-retry').click();
    await flush();
    expect(card().textContent).not.toContain('We could not refresh this list');
    expect(card().textContent).toContain('cannot be generated until');
  });

  it('Generate goes to the database while the last read failed (it is not held back by a list that may be stale)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = fakeClient(nineTeamsWithTies(), { recordResult: applyOrder });
    await mount(client);
    openButtonOf(group(0)).click();
    typeReason('x');
    client.control.failOrderRead = new Error('offline');
    submitForm();
    await flush();
    client.rpcCalls.length = 0;
    byKey('generate-bracket').click();
    await flush();
    expect(client.rpcCalls.map(([name]) => name)).toEqual(['generate_btc_bracket']);
  });

  it('after a save that could not be confirmed the screen looks at what is saved before giving the form back', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(nineTeamsWithTies(), { hangRecord: true });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      await vi.advanceTimersByTimeAsync(0);
      openButtonOf(group(1)).click();
      typeReason('x');
      submitForm();
      await vi.advanceTimersByTimeAsync(0);
      const reads = () => client.fromCalls.filter((t) => t === 'btc_seeding_order').length;
      const before = reads();
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS);
      expect(reads()).toBe(before + 1);
      expect(root.querySelector('.btc-seeding-form [role="alert"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a successful Generate takes the card away', async () => {
    const client = fakeClient(resolvedCutoff(nineTeamsWithTies()));
    await mount(client);
    byKey('generate-bracket').click();
    await flush();
    expect(root.querySelector('.btc-seeding-card')).toBeNull();
    expect(root.querySelector('.btc-seeding-form')).toBeNull();
  });

  it('does not tell the organiser to look "above" for a card that is not there', async () => {
    await mount(fakeClient([row('t1', 1, 90, 3), row('t2', 2, 60, 2)]));
    expect(root.textContent).not.toContain('(above)');
    expect(root.textContent).toContain('If teams are level across the 8th and 9th places');
  });
});
