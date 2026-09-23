import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountMatchesScreen } from './matchesScreen.js';

// Table-based fake client (setupScreen.test.js's own shape) extended with
// .rpc() for create_btc_match.
function fakeClient(initialDb, { rpcResult } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;
  const rpcCalls = [];

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order() {
        return builder;
      },
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      delete() {
        return {
          eq: (col, val) => {
            db[table] = (db[table] ?? []).filter((row) => row[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    from: (table) => makeBuilder(table),
    rpc: (name, args) => {
      rpcCalls.push([name, args]);
      if (rpcResult?.error) return Promise.resolve({ data: null, error: rpcResult.error });
      idCounter += 1;
      const created = {
        id: `m${idCounter}`,
        event_id: args.p_event_id,
        round: args.p_round,
        team1_id: args.p_team1_id,
        team2_id: args.p_team2_id,
      };
      db.btc_matches = [...(db.btc_matches ?? []), created];
      db.btc_match_judges = [
        ...(db.btc_match_judges ?? []),
        ...args.p_judge_ids.map((judge_id) => ({ match_id: created.id, judge_id })),
      ];
      return Promise.resolve({ data: created, error: null });
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
    btc_matches: [],
    btc_match_judges: [],
  };
}

describe('mountMatchesScreen', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it('shows guidance instead of the form when fewer than 2 teams exist', async () => {
    const db = baseDb();
    db.btc_teams = [{ id: 't1', event_id: 'ev1', name: 'Alpha' }];
    const client = fakeClient(db);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Add at least 2 teams in Setup');
    expect(root.querySelector('form')).toBeNull();
  });

  it('shows guidance instead of the form when fewer than 3 judges exist', async () => {
    const db = baseDb();
    db.btc_judges = db.btc_judges.slice(0, 2);
    const client = fakeClient(db);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Add at least 3 judges in Setup');
    expect(root.querySelector('form')).toBeNull();
  });

  it('renders the create form and existing matches when rosters are sufficient', async () => {
    const client = fakeClient(baseDb());
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('form')).not.toBeNull();
    expect(root.textContent).toContain('No preliminary matches created yet.');
    expect(root.querySelectorAll('.btc-judge-checkbox-label')).toHaveLength(3);
  });

  it('creates a match and shows it in the list with a confirmation toast', async () => {
    const client = fakeClient(baseDb());
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    root.querySelector('select[data-field="team1Id"]').value = 't1';
    root.querySelector('select[data-field="team1Id"]').dispatchEvent(new Event('change'));
    root.querySelector('select[data-field="team2Id"]').value = 't2';
    root.querySelector('select[data-field="team2Id"]').dispatchEvent(new Event('change'));
    for (const checkbox of root.querySelectorAll('.btc-judge-checkbox-label input')) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Alpha vs Beta');
    expect(root.textContent).toContain('Alpha vs Beta created.');
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0][1].p_judge_ids).toEqual(['j1', 'j2', 'j3']);
  });

  it('shows a validation error and never calls the RPC when fewer than 3 judges are checked', async () => {
    const client = fakeClient(baseDb());
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    root.querySelector('select[data-field="team1Id"]').value = 't1';
    root.querySelector('select[data-field="team1Id"]').dispatchEvent(new Event('change'));
    root.querySelector('select[data-field="team2Id"]').value = 't2';
    root.querySelector('select[data-field="team2Id"]').dispatchEvent(new Event('change'));

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(root.textContent).toContain('Exactly 3 distinct judges must be selected.');
    expect(client.rpcCalls).toHaveLength(0);
  });

  it('shows a describeError message when the RPC rejects the match', async () => {
    const client = fakeClient(baseDb(), {
      rpcResult: {
        error: { code: 'P0001', message: 'create_btc_match: a team cannot play itself' },
      },
    });
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    root.querySelector('select[data-field="team1Id"]').value = 't1';
    root.querySelector('select[data-field="team1Id"]').dispatchEvent(new Event('change'));
    root.querySelector('select[data-field="team2Id"]').value = 't2';
    root.querySelector('select[data-field="team2Id"]').dispatchEvent(new Event('change'));
    for (const checkbox of root.querySelectorAll('.btc-judge-checkbox-label input')) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Something went wrong saving that — try again.');
    expect(root.textContent).toContain('No preliminary matches created yet.');
  });

  it('moves focus to the heading once the initial load succeeds', async () => {
    const client = fakeClient(baseDb());
    await mountMatchesScreen(root, { eventId: 'ev1', client });
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('shows a running "X of 3 selected" count and rejects a 4th judge', async () => {
    const db = baseDb();
    db.btc_judges.push({ id: 'j4', event_id: 'ev1', name: 'Judge Four' });
    const client = fakeClient(db);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('0 of 3 selected');

    const checkboxes = [...root.querySelectorAll('.btc-judge-checkbox-label input')];
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change'));
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change'));
    checkboxes[2].checked = true;
    checkboxes[2].dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('3 of 3 selected');

    // A 4th checkbox check is rejected — the DOM is rebuilt fresh each
    // render, so re-query rather than reuse the stale `checkboxes` array.
    const fourthCheckbox = root.querySelectorAll('.btc-judge-checkbox-label input')[3];
    fourthCheckbox.checked = true;
    fourthCheckbox.dispatchEvent(new Event('change'));

    expect(root.textContent).toContain('3 of 3 selected');
    expect(root.querySelectorAll('.btc-judge-checkbox-label input')[3].checked).toBe(false);
  });

  it('moves focus to the toast confirmation after a match is successfully created', async () => {
    const client = fakeClient(baseDb());
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    root.querySelector('select[data-field="team1Id"]').value = 't1';
    root.querySelector('select[data-field="team1Id"]').dispatchEvent(new Event('change'));
    root.querySelector('select[data-field="team2Id"]').value = 't2';
    root.querySelector('select[data-field="team2Id"]').dispatchEvent(new Event('change'));
    for (const checkbox of root.querySelectorAll('.btc-judge-checkbox-label input')) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.activeElement?.textContent).toBe('Alpha vs Beta created.');
  });

  it('links each match to its own scoring route', async () => {
    const db = baseDb();
    db.btc_matches = [
      { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
    ];
    db.btc_match_judges = [
      { match_id: 'm1', judge_id: 'j1' },
      { match_id: 'm1', judge_id: 'j2' },
      { match_id: 'm1', judge_id: 'j3' },
    ];
    const client = fakeClient(db);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    const scoreLink = [...root.querySelectorAll('a')].find((a) => a.textContent === 'Score');
    expect(scoreLink.getAttribute('href')).toBe('#/events/ev1/btc/matches/m1/scoring');
  });

  it('removes a match after confirmation', async () => {
    const db = baseDb();
    db.btc_matches = [
      { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
    ];
    db.btc_match_judges = [
      { match_id: 'm1', judge_id: 'j1' },
      { match_id: 'm1', judge_id: 'j2' },
      { match_id: 'm1', judge_id: 'j3' },
    ];
    const client = fakeClient(db);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    expect(root.textContent).toContain('Alpha vs Beta');
    root
      .querySelector('button[aria-label="Remove Alpha vs Beta"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('button[aria-label="Remove Alpha vs Beta"]')).toBeNull();
    expect(root.textContent).toContain('Alpha vs Beta removed.');
  });

  it('does nothing when the confirmation dialog is declined', async () => {
    const db = baseDb();
    db.btc_matches = [
      { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
    ];
    db.btc_match_judges = [
      { match_id: 'm1', judge_id: 'j1' },
      { match_id: 'm1', judge_id: 'j2' },
      { match_id: 'm1', judge_id: 'j3' },
    ];
    const client = fakeClient(db);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mountMatchesScreen(root, { eventId: 'ev1', client });

    root
      .querySelector('button[aria-label="Remove Alpha vs Beta"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();

    expect(root.querySelector('button[aria-label="Remove Alpha vs Beta"]')).not.toBeNull();
  });
});
