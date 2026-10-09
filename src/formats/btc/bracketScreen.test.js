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
function fakeClient(initialDb, { generateError, createError, tiebreakError, tiebreakGate } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;
  const rpcCalls = [];
  const fromCalls = [];

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
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      then(resolve, reject) {
        // Copies, like a real round trip: handing back the live rows would let a test change
        // what the screen sees without the screen ever re-reading anything.
        const rows = (db[table] ?? [])
          .filter((r) => matchesFilters(r, filters, inFilters))
          .map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from: (table) => {
      fromCalls.push(table);
      return makeBuilder(table);
    },
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
      if (name === 'record_btc_tiebreak') {
        return Promise.resolve(tiebreakGate).then(() => {
          if (tiebreakError) return { data: null, error: tiebreakError };
          const match = db.btc_matches.find((m) => m.id === args.p_match_id);
          Object.assign(match, {
            tiebreak_winner_team_id: args.p_winner_team_id,
            tiebreak_reason: args.p_reason,
          });
          return { data: null, error: null };
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    rpcCalls,
    fromCalls,
    db,
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

  describe('podium card', () => {
    function podiumDb({ finalScore, thirdScore } = {}) {
      const db = baseDb();
      db.btc_teams.push(
        { id: 't3', event_id: 'ev1', name: 'Gamma' },
        { id: 't4', event_id: 'ev1', name: 'Delta' },
      );
      db.btc_bracket_slots = [
        {
          id: 's-final',
          event_id: 'ev1',
          round: 'final',
          slot_label: 'final',
          team1_id: 't1',
          team2_id: 't2',
          match_id: 'm-final',
        },
        {
          id: 's-third',
          event_id: 'ev1',
          round: 'third_place',
          slot_label: 'third_place',
          team1_id: 't3',
          team2_id: 't4',
          match_id: 'm-third',
        },
      ];
      db.btc_matches = [
        { id: 'm-final', status: finalScore ? 'confirmed' : 'pending' },
        { id: 'm-third', status: thirdScore ? 'confirmed' : 'pending' },
      ];
      db.btc_match_scores = [
        finalScore && {
          match_id: 'm-final',
          status: 'confirmed',
          team1_id: 't1',
          team2_id: 't2',
          ...finalScore,
        },
        thirdScore && {
          match_id: 'm-third',
          status: 'confirmed',
          team1_id: 't3',
          team2_id: 't4',
          ...thirdScore,
        },
      ].filter(Boolean);
      return db;
    }
    const places = () =>
      [...root.querySelectorAll('.btc-podium-place')].map((li) => li.textContent);

    it('names Champion, runner-up and 3rd from the confirmed final and third-place matches', async () => {
      const client = fakeClient(
        podiumDb({
          finalScore: { team1_total: 40, team2_total: 55 },
          thirdScore: { team1_total: 61, team2_total: 30 },
        }),
      );
      await mountBracketScreen(root, { eventId: 'ev1', client });

      // team2 won the final, so the winner is read from the totals, not from slot order.
      expect(places()).toEqual(['ChampionBeta', '1st runner-upAlpha', '3rd placeGamma']);
    });

    it('says "Not decided yet" for every place before anything is confirmed', async () => {
      const client = fakeClient(podiumDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });

      expect(places()).toEqual([
        'ChampionNot decided yet',
        '1st runner-upNot decided yet',
        '3rd placeNot decided yet',
      ]);
    });

    it('says a tied final has no winner rather than naming one', async () => {
      const client = fakeClient(podiumDb({ finalScore: { team1_total: 50, team2_total: 50 } }));
      await mountBracketScreen(root, { eventId: 'ev1', client });

      expect(places().slice(0, 2)).toEqual([
        'ChampionTied — not decided',
        '1st runner-upTied — not decided',
      ]);
    });

    it('shows a tied third-place match as tied while the final is decided', async () => {
      const client = fakeClient(
        podiumDb({
          finalScore: { team1_total: 40, team2_total: 55 },
          thirdScore: { team1_total: 30, team2_total: 30 },
        }),
      );
      await mountBracketScreen(root, { eventId: 'ev1', client });

      expect(places()).toEqual([
        'ChampionBeta',
        '1st runner-upAlpha',
        '3rd placeTied — not decided',
      ]);
    });

    it('pairs each place name with its team as a term and description', async () => {
      const client = fakeClient(podiumDb({ finalScore: { team1_total: 40, team2_total: 55 } }));
      await mountBracketScreen(root, { eventId: 'ev1', client });

      const first = root.querySelector('.btc-podium-place');
      expect(first.querySelector('dt').textContent).toBe('Champion');
      expect(first.querySelector('dd').textContent).toBe('Beta');
      expect(first.dataset.state).toBe('decided');
    });

    it('is not shown before a bracket has been generated', async () => {
      const client = fakeClient(baseDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      expect(root.querySelector('.btc-podium')).toBeNull();
    });
  });

  describe('knockout tie-break', () => {
    // One quarterfinal, confirmed and level at 30 each, between Alpha (t1) and Beta (t2).
    function tieDb({ matchExtra = {}, totals = [30, 30], status = 'confirmed' } = {}) {
      const db = baseDb();
      db.btc_bracket_slots = [
        {
          id: 's-qf1',
          event_id: 'ev1',
          round: 'quarterfinal',
          slot_label: 'qf1',
          team1_id: 't1',
          team2_id: 't2',
          match_id: 'm-qf1',
        },
      ];
      db.btc_matches = [{ id: 'm-qf1', status, ...matchExtra }];
      db.btc_match_scores = [
        {
          match_id: 'm-qf1',
          status,
          team1_id: 't1',
          team2_id: 't2',
          team1_total: totals[0],
          team2_total: totals[1],
        },
      ];
      return db;
    }
    const openButton = () => root.querySelector('button[data-focus-key="tiebreak-open-s-qf1"]');
    const submit = () =>
      root
        .querySelector('.btc-tiebreak-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    function choose(teamId) {
      const radio = root.querySelector(`input[type="radio"][value="${teamId}"]`);
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function typeReason(text) {
      const input = root.querySelector('input[data-field="tiebreak-reason-s-qf1"]');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const note = () => root.querySelector('.btc-tiebreak-note')?.textContent;
    const click = (node) => node.dispatchEvent(new Event('click', { bubbles: true }));

    it('says a level match is tied, in plain words, and offers to record who goes through', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });

      expect(note()).toBe(
        'Tied at 30 each. Nobody advances until you record which team goes through.',
      );
      expect(openButton().textContent).toBe('Record tie-break');
      expect(root.querySelector('.btc-tiebreak-form')).toBeNull();
    });

    it('shows no tie-break block for a decisive result', async () => {
      await mountBracketScreen(root, {
        eventId: 'ev1',
        client: fakeClient(tieDb({ totals: [40, 30] })),
      });
      expect(root.querySelector('.btc-tiebreak')).toBeNull();
    });

    it('shows no tie-break block for an unconfirmed match (the view reads 0-0, which must not look tied)', async () => {
      await mountBracketScreen(root, {
        eventId: 'ev1',
        client: fakeClient(tieDb({ status: 'pending', totals: [0, 0] })),
      });
      expect(root.querySelector('.btc-tiebreak')).toBeNull();
    });

    it('shows no tie-break block when the match is unconfirmed even if a score row claims otherwise', async () => {
      const db = tieDb({ status: 'scoring' });
      db.btc_match_scores[0].status = 'confirmed';
      await mountBracketScreen(root, { eventId: 'ev1', client: fakeClient(db) });
      expect(root.querySelector('.btc-tiebreak')).toBeNull();
    });

    it('shows no tie-break block for a slot with no match yet', async () => {
      const db = tieDb();
      db.btc_bracket_slots[0].match_id = null;
      await mountBracketScreen(root, { eventId: 'ev1', client: fakeClient(db) });
      expect(root.querySelector('.btc-tiebreak')).toBeNull();
    });

    it('opens a form that names the match and says what is required, and moves focus to its heading', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());

      const legend = root.querySelector('.btc-tiebreak-form legend');
      expect(legend.textContent).toBe('Which team goes through — Alpha vs Beta? (required)');
      const labels = [...root.querySelectorAll('.btc-tiebreak-form label')].map(
        (l) => l.textContent,
      );
      expect(labels).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
      const reason = root.querySelector('input[data-field="tiebreak-reason-s-qf1"]');
      expect(reason.getAttribute('aria-label')).toBe('Reason for the tie-break (required)');
      expect(document.activeElement).toBe(legend);
    });

    it('keeps the tied result visible while the form is open', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      expect(note()).toBe(
        'Tied at 30 each. Nobody advances until you record which team goes through.',
      );
    });

    it('warns that the reason may be public, and ties that warning to the reason field', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());

      const reason = root.querySelector('input[data-field="tiebreak-reason-s-qf1"]');
      const hint = root.querySelector(`#${reason.getAttribute('aria-describedby').split(' ')[0]}`);
      expect(hint.textContent).toMatch(/shown on the public results page/i);
    });

    it('a missing winner is reported ABOVE the controls, tied to the choice of team, and sends nothing', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      submit();
      await flush();

      const alert = root.querySelector('[role="alert"]');
      expect(alert.textContent).toMatch(/which team goes through/i);
      expect(document.activeElement).toBe(alert);
      const fieldset = root.querySelector('.btc-tiebreak-form fieldset');
      expect(fieldset.getAttribute('aria-describedby')).toBe(alert.id);
      expect(fieldset.getAttribute('aria-invalid')).toBe('true');
      // above the fields in reading order
      expect(
        alert.compareDocumentPosition(fieldset) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(client.rpcCalls).toEqual([]);
    });

    it('a missing reason is reported against the reason field, which is marked invalid', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t2');
      submit();
      await flush();

      const alert = root.querySelector('[role="alert"]');
      expect(alert.textContent).toMatch(/reason/i);
      const reason = root.querySelector('input[data-field="tiebreak-reason-s-qf1"]');
      expect(reason.getAttribute('aria-describedby').split(' ')).toContain(alert.id);
      expect(reason.getAttribute('aria-invalid')).toBe('true');
      expect(root.querySelector('.btc-tiebreak-form fieldset').hasAttribute('aria-invalid')).toBe(
        false,
      );
      expect(client.rpcCalls).toEqual([]);
    });

    it('records the decision, reloads, shows it in plain words, and puts focus back on the button', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      const slotReadsBefore = client.fromCalls.filter((t) => t === 'btc_bracket_slots').length;
      const scoreReadsBefore = client.fromCalls.filter((t) => t === 'btc_match_scores').length;
      click(openButton());
      choose('t2');
      typeReason('  Casting vote  ');
      submit();
      await flush();
      // seats move server-side, so both the bracket and its scores are RE-READ, not patched locally
      expect(client.fromCalls.filter((t) => t === 'btc_bracket_slots').length).toBe(
        slotReadsBefore + 1,
      );
      expect(client.fromCalls.filter((t) => t === 'btc_match_scores').length).toBe(
        scoreReadsBefore + 1,
      );

      expect(client.rpcCalls).toEqual([
        [
          'record_btc_tiebreak',
          {
            p_org_id: 'org1',
            p_match_id: 'm-qf1',
            p_winner_team_id: 't2',
            p_reason: 'Casting vote',
          },
        ],
      ]);
      expect(root.querySelector('.btc-tiebreak-form')).toBeNull();
      expect(root.textContent).toContain('Beta goes through.');
      expect(note()).toBe('Level at 30 each. Tie-break: Beta goes through. Reason: Casting vote');
      expect(openButton().textContent).toBe('Change tie-break');
      // focus goes to the button; the live-region toast speaks, so it is not also focused
      expect(document.activeElement).toBe(openButton());
    });

    it('while the save is in flight Cancel, the radios and other buttons do nothing, and the toast names the team that was SENT', async () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const client = fakeClient(tieDb(), { tiebreakGate: gate });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t2');
      typeReason('Casting vote');
      submit();
      await flush();

      // mid-save: try to cancel and to flip the choice
      click(root.querySelector('button[data-focus-key="tiebreak-cancel-s-qf1"]'));
      choose('t1');
      expect(root.querySelector('.btc-tiebreak-form')).not.toBeNull();
      expect(root.querySelector('input[type="radio"][value="t2"]').checked).toBe(true);

      release();
      await flush();
      expect(root.textContent).toContain('Beta goes through.');
      expect(root.textContent).not.toContain('TBD goes through');
      expect(root.textContent).not.toContain('Alpha goes through.');
      expect(note()).toBe('Level at 30 each. Tie-break: Beta goes through. Reason: Casting vote');
    });

    it('a failed save mid-flight still shows its error even if Cancel was clicked meanwhile', async () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const client = fakeClient(tieDb(), {
        tiebreakGate: gate,
        tiebreakError: { code: 'P0001', hint: 'bracket_advanced', message: 'x' },
      });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t1');
      typeReason('Coin toss');
      submit();
      await flush();
      click(root.querySelector('button[data-focus-key="tiebreak-cancel-s-qf1"]'));

      release();
      await flush();
      expect(root.querySelector('[role="alert"]').textContent).toMatch(
        /next-round match has already been created/i,
      );
      expect(root.querySelector('.btc-tiebreak-form')).not.toBeNull();
    });

    it('keeps the form and what was typed, and explains a refusal that is about the bracket, when the database says no', async () => {
      const client = fakeClient(tieDb(), {
        tiebreakError: {
          code: 'P0001',
          hint: 'bracket_advanced',
          message: 'wording does not matter',
        },
      });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t1');
      typeReason('Coin toss');
      submit();
      await flush();

      const alert = root.querySelector('[role="alert"]');
      expect(alert.textContent).toMatch(/next-round match has already been created/i);
      expect(document.activeElement).toBe(alert);
      // a bracket-level refusal is not about either field: it hangs off the submit button
      expect(root.querySelector('button[type="submit"]').getAttribute('aria-describedby')).toBe(
        alert.id,
      );
      expect(root.querySelector('input[data-field="tiebreak-reason-s-qf1"]').value).toBe(
        'Coin toss',
      );
      expect(root.querySelector('input[type="radio"][value="t1"]').checked).toBe(true);
    });

    it('a refusal that means the screen is stale refreshes it, closes the form and says why in the toast', async () => {
      const db = tieDb();
      const client = fakeClient(db, {
        tiebreakError: { code: 'P0001', hint: 'tiebreak_not_tied', message: 'x' },
      });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t1');
      typeReason('Coin toss');
      // someone re-scored it meanwhile: no longer level
      client.db.btc_match_scores[0].team1_total = 41;
      submit();
      await flush();

      expect(root.querySelector('.btc-tiebreak-form')).toBeNull();
      expect(root.textContent).toMatch(/no longer tied/i);
      expect(root.querySelector('.btc-tiebreak')).toBeNull();
    });

    it('a stale-screen refusal still works, with its toast and a closed form, if the refresh itself fails', async () => {
      const client = fakeClient(tieDb(), {
        tiebreakError: { code: 'P0001', hint: 'tiebreak_not_tied', message: 'x' },
      });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t1');
      typeReason('Coin toss');
      const realFrom = client.from;
      const realRpc = client.rpc;
      let rpcDone = false;
      client.rpc = (...args) =>
        realRpc(...args).then((result) => {
          rpcDone = true;
          return result;
        });
      client.from = (table) => {
        if (rpcDone) throw new Error('network down');
        return realFrom(table);
      };
      submit();
      await flush();

      expect(root.textContent).toMatch(/no longer tied/i);
      expect(root.querySelector('.btc-tiebreak-form')).toBeNull();
      // and the screen is not left inert: the form can be opened again
      client.from = realFrom;
      expect(openButton().getAttribute('aria-disabled')).not.toBe('true');
    });

    it('after a refused save the form is usable again: Record can be pressed a second time', async () => {
      const client = fakeClient(tieDb(), {
        tiebreakError: { code: 'P0001', hint: 'bracket_advanced', message: 'x' },
      });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t1');
      typeReason('Coin toss');
      submit();
      await flush();
      expect(client.rpcCalls).toHaveLength(1);

      const submitButton = root.querySelector('button[type="submit"]');
      expect(submitButton.getAttribute('aria-disabled')).not.toBe('true');
      expect(submitButton.textContent).toBe('Record tie-break');
      submit();
      await flush();
      expect(client.rpcCalls).toHaveLength(2);
    });

    it('pressing Enter twice while saving sends ONE request, and the button says it is saving', async () => {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const client = fakeClient(tieDb(), { tiebreakGate: gate });
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t2');
      typeReason('Casting vote');
      submit();
      await flush();
      submit();
      await flush();

      expect(client.rpcCalls).toHaveLength(1);
      const submitButton = root.querySelector('button[type="submit"]');
      expect(submitButton.textContent).toBe('Saving…');
      expect(submitButton.getAttribute('aria-disabled')).toBe('true');
      release();
      await flush();
      expect(client.rpcCalls).toHaveLength(1);
    });

    it('limits the reason to the length the database accepts', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      expect(
        root.querySelector('input[data-field="tiebreak-reason-s-qf1"]').getAttribute('maxlength'),
      ).toBe('120');
    });

    describe('two tied matches', () => {
      function twoTieDb() {
        const db = tieDb();
        db.btc_teams.push(
          { id: 't3', event_id: 'ev1', name: 'Gamma' },
          { id: 't4', event_id: 'ev1', name: 'Delta' },
        );
        db.btc_bracket_slots.push({
          id: 's-qf2',
          event_id: 'ev1',
          round: 'quarterfinal',
          slot_label: 'qf2',
          team1_id: 't3',
          team2_id: 't4',
          match_id: 'm-qf2',
        });
        db.btc_matches.push({ id: 'm-qf2', status: 'confirmed' });
        db.btc_match_scores.push({
          match_id: 'm-qf2',
          status: 'confirmed',
          team1_id: 't3',
          team2_id: 't4',
          team1_total: 20,
          team2_total: 20,
        });
        return db;
      }

      it("keeps each slot's controls separate: its own radio group, one open form at a time, focus back on the right button", async () => {
        const client = fakeClient(twoTieDb());
        await mountBracketScreen(root, { eventId: 'ev1', client });
        click(root.querySelector('button[data-focus-key="tiebreak-open-s-qf1"]'));
        expect(root.querySelectorAll('.btc-tiebreak-form')).toHaveLength(1);
        const nameA = root.querySelector('.btc-tiebreak-form input[type="radio"]').name;

        click(root.querySelector('button[data-focus-key="tiebreak-open-s-qf2"]'));
        expect(root.querySelectorAll('.btc-tiebreak-form')).toHaveLength(1);
        const nameB = root.querySelector('.btc-tiebreak-form input[type="radio"]').name;
        expect(nameB).not.toBe(nameA);
        expect(root.querySelector('.btc-tiebreak-form legend').textContent).toContain(
          'Gamma vs Delta',
        );
        // the first slot is back to its button, with the other slot's note intact
        expect(root.querySelector('button[data-focus-key="tiebreak-open-s-qf1"]')).not.toBeNull();

        click(root.querySelector('button[data-focus-key="tiebreak-cancel-s-qf2"]'));
        expect(document.activeElement).toBe(
          root.querySelector('button[data-focus-key="tiebreak-open-s-qf2"]'),
        );
      });
    });

    it('opens a recorded decision pre-filled when changing it', async () => {
      const client = fakeClient(
        tieDb({
          matchExtra: { tiebreak_winner_team_id: 't1', tiebreak_reason: 'Sudden-death cup' },
        }),
      );
      await mountBracketScreen(root, { eventId: 'ev1', client });
      expect(note()).toBe(
        'Level at 30 each. Tie-break: Alpha goes through. Reason: Sudden-death cup',
      );
      click(openButton());

      expect(root.querySelector('input[type="radio"][value="t1"]').checked).toBe(true);
      expect(root.querySelector('input[data-field="tiebreak-reason-s-qf1"]').value).toBe(
        'Sudden-death cup',
      );
    });

    it('cancel closes the form without sending anything and returns focus to the button', async () => {
      const client = fakeClient(tieDb());
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      click(root.querySelector('button[data-focus-key="tiebreak-cancel-s-qf1"]'));

      expect(root.querySelector('.btc-tiebreak-form')).toBeNull();
      expect(client.rpcCalls).toEqual([]);
      expect(document.activeElement).toBe(openButton());
    });

    it('says the save worked, not that it failed, if the refresh after a successful save fails', async () => {
      const db = tieDb();
      const client = fakeClient(db);
      await mountBracketScreen(root, { eventId: 'ev1', client });
      click(openButton());
      choose('t2');
      typeReason('Casting vote');
      // make the post-save reload throw
      const realFrom = client.from;
      let rpcDone = false;
      const realRpc = client.rpc;
      client.rpc = (...args) =>
        realRpc(...args).then((r) => {
          rpcDone = true;
          return r;
        });
      client.from = (table) => {
        if (rpcDone) throw new Error('network down');
        return realFrom(table);
      };
      submit();
      await flush();

      expect(root.textContent).toMatch(/Beta goes through — saved, but the page could not refresh/);
      expect(root.querySelector('[role="alert"]')).toBeNull();
    });

    it('puts a champion decided by tie-break on the podium and says how it was decided', async () => {
      const db = baseDb();
      db.btc_bracket_slots = [
        {
          id: 's-final',
          event_id: 'ev1',
          round: 'final',
          slot_label: 'final',
          team1_id: 't1',
          team2_id: 't2',
          match_id: 'm-final',
        },
      ];
      db.btc_matches = [
        {
          id: 'm-final',
          status: 'confirmed',
          tiebreak_winner_team_id: 't2',
          tiebreak_reason: 'Casting vote',
        },
      ];
      db.btc_match_scores = [
        {
          match_id: 'm-final',
          status: 'confirmed',
          team1_id: 't1',
          team2_id: 't2',
          team1_total: 50,
          team2_total: 50,
        },
      ];
      await mountBracketScreen(root, { eventId: 'ev1', client: fakeClient(db) });

      const champion = root.querySelector('.btc-podium-place');
      expect(champion.querySelector('dd').textContent).toContain('Beta');
      expect(champion.querySelector('dd').textContent).toContain('Decided by tie-break');
    });
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
