import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountMatchesScreen } from './matchesScreen.js';
import { publishBtcLive } from './liveSession.js';
import { _clearAllForTests } from '../../core/db.js';

vi.mock('./liveSession.js', () => ({ publishBtcLive: vi.fn(async () => {}) }));

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
    publishBtcLive.mockClear();
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
    const handlers = { composed: true };
    await mountMatchesScreen(root, { eventId: 'ev1', client, handlers });

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
    // A schedule edit (it changes "up next"): refreshes the display only if this event is already live,
    // flushing with the caller's composed outbox map.
    expect(publishBtcLive).toHaveBeenCalledTimes(1);
    expect(publishBtcLive).toHaveBeenCalledWith(
      {
        event: expect.objectContaining({ id: 'ev1', org_id: 'org1', is_test: true }),
        takeOver: false,
      },
      handlers,
    );
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
    expect(publishBtcLive).not.toHaveBeenCalled();
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
    expect(publishBtcLive).toHaveBeenCalledTimes(1);
    expect(publishBtcLive.mock.calls[0][0]).toEqual({
      event: expect.objectContaining({ id: 'ev1', org_id: 'org1', is_test: true }),
      takeOver: false,
    });
  });

  it('never waits on the publish: creating or removing a match finishes even if it never settles', async () => {
    publishBtcLive.mockImplementationOnce(() => new Promise(() => {}));
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
    expect(root.textContent).toContain('Alpha vs Beta created.');
  });

  it('a refused publish is logged, not thrown: the match is still removed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    publishBtcLive.mockRejectedValueOnce(new TypeError('no handler map'));
    const db = baseDb();
    db.btc_matches = [
      { id: 'm1', event_id: 'ev1', round: 'preliminary', team1_id: 't1', team2_id: 't2' },
    ];
    db.btc_match_judges = [
      { match_id: 'm1', judge_id: 'j1' },
      { match_id: 'm1', judge_id: 'j2' },
      { match_id: 'm1', judge_id: 'j3' },
    ];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(db) });
    root
      .querySelector('button[aria-label="Remove Alpha vs Beta"]')
      .dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.textContent).toContain('Alpha vs Beta removed.');
    expect(error).toHaveBeenCalledWith('btc: live-view publish was refused', expect.any(TypeError));
  });

  it("hands a real event's flag to the real publish: a schedule edit queues a conditional intent for this event", async () => {
    const actual = await vi.importActual('./liveSession.js');
    publishBtcLive.mockImplementationOnce(actual.publishBtcLive);
    await _clearAllForTests();
    const db = baseDb();
    db.events[0].is_test = false;
    const intents = [];
    const handlers = { publish_btc_live_session: async (intent) => void intents.push(intent) };
    const client = fakeClient(db);
    await mountMatchesScreen(root, { eventId: 'ev1', client, handlers });
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
    await vi.waitFor(() => expect(intents).toHaveLength(1));
    expect(intents[0]).toEqual({
      orgId: 'org1',
      eventId: 'ev1',
      format: 'btc',
      isTest: false,
      onlyIfLive: true,
    });
    await _clearAllForTests();
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

  expect(publishBtcLive).not.toHaveBeenCalled();
  describe('country', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const choose = (field, value) => {
      const select = root.querySelector(`select[data-field="${field}"]`);
      select.value = value;
      select.dispatchEvent(new Event('change'));
    };
    const tick = (judgeId, checked) => {
      const box = root.querySelector(`input[data-field="judge-${judgeId}"]`);
      box.checked = checked;
      box.dispatchEvent(new Event('change'));
    };
    const warnings = () =>
      [...root.querySelectorAll('.btc-country-warnings p')].map((p) => p.textContent);
    const countryDb = () => {
      const db = baseDb();
      db.btc_teams = [
        { id: 't1', event_id: 'ev1', name: 'Team Kopi', country_code: 'BN' },
        { id: 't2', event_id: 'ev1', name: 'Team Teh', country_code: 'BN' },
        { id: 't3', event_id: 'ev1', name: 'Team Satay', country_code: 'SG' },
        { id: 't4', event_id: 'ev1', name: 'Team Plain', country_code: null },
      ];
      db.btc_judges = [
        { id: 'j1', event_id: 'ev1', name: 'Siti', country_code: 'BN' },
        { id: 'j2', event_id: 'ev1', name: 'Ahmad', country_code: 'MY' },
        { id: 'j3', event_id: 'ev1', name: 'Lee', country_code: null },
      ];
      return db;
    };

    it('shows "Country · Name" in the team selects and beside each judge', async () => {
      await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(countryDb()) });
      const options = [...root.querySelectorAll('select[data-field="team1Id"] option')].map(
        (o) => o.textContent,
      );
      expect(options).toEqual([
        'Select a team…',
        'Brunei · Team Kopi',
        'Brunei · Team Teh',
        'Singapore · Team Satay',
        'Team Plain',
      ]);
      const judges = [...root.querySelectorAll('.btc-judge-checkbox-label')].map(
        (l) => l.textContent,
      );
      expect(judges).toEqual(['Brunei · Siti', 'Malaysia · Ahmad', 'Lee']);
    });

    it('warns, in words and per judge, when a ticked judge shares a team country', async () => {
      await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(countryDb()) });
      expect(warnings()).toEqual([]);
      choose('team1Id', 't1');
      choose('team2Id', 't3');
      tick('j1', true);
      expect(warnings()).toEqual(['Judge Siti is from Brunei, the same country as Team Kopi.']);
      // the warning is a polite status tied to the judge fieldset
      const region = root.querySelector('.btc-country-warnings');
      expect(region.getAttribute('role')).toBe('status');
      expect(root.querySelector('.btc-judge-fieldset').getAttribute('aria-describedby')).toBe(
        region.id,
      );
    });

    it('lists one line for each team of the judge country', async () => {
      await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(countryDb()) });
      choose('team1Id', 't1');
      choose('team2Id', 't2');
      tick('j1', true);
      expect(warnings()).toEqual([
        'Judge Siti is from Brunei, the same country as Team Kopi.',
        'Judge Siti is from Brunei, the same country as Team Teh.',
      ]);
    });

    it('clears the warning when the judge is unticked or the team changes, and ignores no-country sides', async () => {
      await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(countryDb()) });
      choose('team1Id', 't1');
      choose('team2Id', 't3');
      tick('j1', true);
      expect(warnings()).toHaveLength(1);
      tick('j1', false);
      expect(warnings()).toEqual([]);
      expect(root.querySelector('fieldset').hasAttribute('aria-describedby')).toBe(false);
      tick('j1', true);
      expect(warnings()).toHaveLength(1);
      choose('team1Id', 't4'); // a team with no country
      expect(warnings()).toEqual([]);
      tick('j3', true); // a judge with no country
      choose('team1Id', 't1');
      expect(warnings()).toEqual(['Judge Siti is from Brunei, the same country as Team Kopi.']);
    });

    it('never disables Create match, and still creates the match with the warning showing', async () => {
      const client = fakeClient(countryDb());
      await mountMatchesScreen(root, { eventId: 'ev1', client });
      choose('team1Id', 't1');
      choose('team2Id', 't3');
      tick('j1', true);
      tick('j2', true);
      tick('j3', true);
      expect(warnings()).toHaveLength(1);
      const submit = root.querySelector('button[data-focus-key="match-submit"]');
      expect(submit.disabled).toBe(false);
      expect(submit.getAttribute('aria-disabled')).toBeNull();
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
      expect(client.rpcCalls).toHaveLength(1);
      expect(client.rpcCalls[0][0]).toBe('create_btc_match');
      // the new match is listed with the country labels
      expect(root.querySelector('.btc-match-teams').textContent).toBe(
        'Brunei · Team Kopi vs Singapore · Team Satay',
      );
    });

    it('keeps focus on the team select that was changed', async () => {
      await mountMatchesScreen(root, { eventId: 'ev1', client: fakeClient(countryDb()) });
      const select = root.querySelector('select[data-field="team1Id"]');
      select.focus();
      choose('team1Id', 't1');
      expect(document.activeElement).toBe(root.querySelector('select[data-field="team1Id"]'));
    });
  });
});
