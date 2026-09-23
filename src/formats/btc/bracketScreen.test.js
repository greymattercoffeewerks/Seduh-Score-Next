import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBracketScreen } from './bracketScreen.js';

// Flushes both microtasks and a macrotask boundary — more reliable than a fixed count
// of bare `await Promise.resolve()` ticks against the fake client's own `.then()`-based
// query builder chains (generate-then-refetch awaits more promise hops than a single RPC
// call does).
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Table-based fake client (matchesScreen.test.js's own shape) extended with `.in()`
// (fetchBracket's own matches lookup) and a two-RPC dispatch (generate_btc_bracket /
// create_btc_bracket_match).
function fakeClient(initialDb, { generateError, createError } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;
  const rpcCalls = [];

  function matchesFilters(row, filters, inFilters) {
    return (
      filters.every(([col, val]) => row[col] === val) &&
      inFilters.every(([col, vals]) => vals.includes(row[col]))
    );
  }

  function makeBuilder(table) {
    const filters = [];
    const inFilters = [];
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      in(col, vals) {
        inFilters.push([col, vals]);
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters, inFilters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters, inFilters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from: (table) => makeBuilder(table),
    rpc: (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'generate_btc_bracket') {
        if (generateError) return Promise.resolve({ data: null, error: generateError });
        db.btc_bracket_slots = [
          {
            id: 's-qf1',
            event_id: args.p_event_id,
            round: 'quarterfinal',
            slot_label: 'qf1',
            team1_id: 't1',
            team2_id: 't2',
            match_id: null,
          },
        ];
        return Promise.resolve({ data: db.btc_bracket_slots, error: null });
      }
      if (name === 'create_btc_bracket_match') {
        if (createError) return Promise.resolve({ data: null, error: createError });
        idCounter += 1;
        const created = { id: `m${idCounter}`, round: 'quarterfinal', status: 'pending' };
        db.btc_matches = [...(db.btc_matches ?? []), created];
        const slot = db.btc_bracket_slots.find((s) => s.id === args.p_slot_id);
        if (slot) slot.match_id = created.id;
        return Promise.resolve({ data: created, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    rpcCalls,
  };
}

function baseDb() {
  return {
    events: [{ id: 'ev1', org_id: 'org1', name: 'BTC Test Event', is_test: true }],
    btc_teams: [
      { id: 't1', event_id: 'ev1', name: 'Alpha' },
      { id: 't2', event_id: 'ev1', name: 'Beta' },
    ],
    btc_judges: [
      { id: 'j1', event_id: 'ev1', name: 'Judge One' },
      { id: 'j2', event_id: 'ev1', name: 'Judge Two' },
      { id: 'j3', event_id: 'ev1', name: 'Judge Three' },
    ],
    btc_bracket_slots: [],
    btc_matches: [],
  };
}

describe('mountBracketScreen', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('shows the generate-bracket action when no bracket exists yet', async () => {
    const client = fakeClient(baseDb());
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('button[data-focus-key="generate-bracket"]')).not.toBeNull();
    expect(root.querySelector('.btc-bracket-rounds')).toBeNull();
  });

  it('generates the bracket and shows the seeded slots', async () => {
    const client = fakeClient(baseDb());
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="generate-bracket"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(root.textContent).toContain('Quarterfinals');
    expect(root.textContent).toContain('Alpha vs Beta');
    expect(client.rpcCalls).toEqual([
      ['generate_btc_bracket', { p_org_id: 'org1', p_event_id: 'ev1' }],
    ]);
  });

  it('shows a describeError message via toast when generation is rejected (e.g. an unresolved seeding tie)', async () => {
    const client = fakeClient(baseDb(), {
      generateError: { code: 'P0001', message: 'teams are tied for the 8th qualifying spot' },
    });
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="generate-bracket"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Something went wrong saving that — try again.');
    expect(root.querySelector('button[data-focus-key="generate-bracket"]')).not.toBeNull();
  });

  it('shows "Create match" for a fully-seeded slot with no match yet', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('button[data-focus-key="create-slot-s-qf1"]')).not.toBeNull();
  });

  it('shows "Waiting on an earlier round" for a slot with no teams yet', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-sf1',
        event_id: 'ev1',
        round: 'semifinal',
        slot_label: 'sf1',
        team1_id: null,
        team2_id: null,
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Waiting on an earlier round to finish');
    expect(root.querySelector('button[data-focus-key="create-slot-s-sf1"]')).toBeNull();
  });

  it('shows the match status instead of a create-match action once a match exists', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: 'm1',
      },
    ];
    db.btc_matches = [{ id: 'm1', status: 'pending' }];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Match scheduled — not yet scored');
    expect(root.querySelector('button[data-focus-key="create-slot-s-qf1"]')).toBeNull();
  });

  it('links a slot with a match to its own scoring route', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: 'm1',
      },
    ];
    db.btc_matches = [{ id: 'm1', status: 'pending' }];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    const scoreLink = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Score');
    expect(scoreLink.getAttribute('href')).toBe('#/events/ev1/btc/matches/m1/scoring');
  });

  it('shows "Confirmed" for a confirmed match', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: 'm1',
      },
    ];
    db.btc_matches = [{ id: 'm1', status: 'confirmed' }];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Confirmed');
  });

  it('distinguishes "Scoring in progress" from an untouched pending match', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: 'm1',
      },
    ];
    db.btc_matches = [{ id: 'm1', status: 'scoring' }];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Scoring in progress');
    expect(root.textContent).not.toContain('Match scheduled — not yet scored');
  });

  it('opens the create-match form and submits successfully', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="create-slot-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();

    expect(root.textContent).toContain('0 of 3 selected');
    for (const checkbox of root.querySelectorAll('.btc-judge-checkbox-label input')) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
    expect(root.textContent).toContain('3 of 3 selected');

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('match created.');
    expect(root.textContent).toContain('Match scheduled — not yet scored');
    expect(client.rpcCalls).toEqual([
      [
        'create_btc_bracket_match',
        { p_org_id: 'org1', p_slot_id: 's-qf1', p_judge_ids: ['j1', 'j2', 'j3'] },
      ],
    ]);
  });

  it('shows a running "X of 3 selected" count and rejects a 4th judge', async () => {
    const db = baseDb();
    db.btc_judges.push({ id: 'j4', event_id: 'ev1', name: 'Judge Four' });
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="create-slot-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();

    const checkboxes = [...root.querySelectorAll('.btc-judge-checkbox-label input')];
    expect(checkboxes).toHaveLength(4);
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change'));
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change'));
    checkboxes[2].checked = true;
    checkboxes[2].dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('3 of 3 selected');

    // The DOM is rebuilt fresh each render, so re-query rather than reuse the stale
    // `checkboxes` array (matchesScreen.test.js's own established note for this).
    const fourthCheckbox = root.querySelectorAll('.btc-judge-checkbox-label input')[3];
    fourthCheckbox.checked = true;
    fourthCheckbox.dispatchEvent(new Event('change'));

    expect(root.textContent).toContain('3 of 3 selected');
    expect(root.querySelectorAll('.btc-judge-checkbox-label input')[3].checked).toBe(false);
  });

  it('shows "Waiting on an earlier round" when only one of a slot\'s two teams is known', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-sf1',
        event_id: 'ev1',
        round: 'semifinal',
        slot_label: 'sf1',
        team1_id: 't1',
        team2_id: null,
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Waiting on an earlier round to finish');
    expect(root.querySelector('button[data-focus-key="create-slot-s-sf1"]')).toBeNull();
  });

  it('moves focus to the judges heading when the create-match form opens, and back to the create button when cancelled', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="create-slot-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(
      root.querySelector('[data-focus-key="create-form-heading-s-qf1"]'),
    );

    root
      .querySelector('button[data-focus-key="create-slot-cancel-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    expect(document.activeElement).toBe(
      root.querySelector('button[data-focus-key="create-slot-s-qf1"]'),
    );
  });

  it('shows a validation error and never calls the RPC when fewer than 3 judges are checked', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="create-slot-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(root.textContent).toContain('Exactly 3 distinct judges must be selected.');
    expect(client.rpcCalls).toHaveLength(0);
  });

  it('cancels the create-match form without calling the RPC', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="create-slot-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    root
      .querySelector('button[data-focus-key="create-slot-cancel-s-qf1"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();

    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('button[data-focus-key="create-slot-s-qf1"]')).not.toBeNull();
    expect(client.rpcCalls).toHaveLength(0);
  });

  it('moves focus to the heading once the initial load succeeds', async () => {
    const client = fakeClient(baseDb());
    await mountBracketScreen(root, { eventId: 'ev1', client });
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('moves focus to the toast after a successful bracket generation', async () => {
    const client = fakeClient(baseDb());
    await mountBracketScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[data-focus-key="generate-bracket"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await flush();

    expect(document.activeElement?.textContent).toBe('Bracket generated.');
  });

  it('sorts rounds into bracket display order (quarterfinal, semifinal, final, third_place)', async () => {
    const db = baseDb();
    db.btc_bracket_slots = [
      {
        id: 's-third',
        event_id: 'ev1',
        round: 'third_place',
        slot_label: 'third_place',
        team1_id: null,
        team2_id: null,
        match_id: null,
      },
      {
        id: 's-qf1',
        event_id: 'ev1',
        round: 'quarterfinal',
        slot_label: 'qf1',
        team1_id: 't1',
        team2_id: 't2',
        match_id: null,
      },
      {
        id: 's-final',
        event_id: 'ev1',
        round: 'final',
        slot_label: 'final',
        team1_id: null,
        team2_id: null,
        match_id: null,
      },
    ];
    const client = fakeClient(db);
    await mountBracketScreen(root, { eventId: 'ev1', client });

    const headings = [...root.querySelectorAll('.btc-bracket-round h2')].map((h) => h.textContent);
    expect(headings).toEqual(['Quarterfinals', 'Final', 'Third Place']);
  });

  it('shows the is-test banner for a test event', async () => {
    const client = fakeClient(baseDb());
    await mountBracketScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('shows a retry button and message when the initial load fails', async () => {
    const client = { from: () => ({ from: () => {} }) };
    await mountBracketScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('button')?.textContent).toBe('Retry');
    expect(document.activeElement).not.toBeNull();
  });
});
