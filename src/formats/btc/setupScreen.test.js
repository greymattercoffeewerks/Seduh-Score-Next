import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSetupScreen, validateRosterName } from './setupScreen.js';
import { publishBtcLive } from './liveSession.js';

vi.mock('./liveSession.js', () => ({ publishBtcLive: vi.fn(async () => {}) }));

// Table-based in-memory fake client, mirroring rosterScreen.test.js's own
// (this screen composes findEvent + listTeams + listJudges + createTeam/
// createJudge + removeTeam/removeJudge, so a hand-ordered call queue can't
// express it cleanly for a whole-screen integration test). `errorOn` injects
// a write failure for one specific `table.method` combination.
function fakeClient(initialDb, { errorOn, demoError, demoGate, demoReply } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;
  const rpcCalls = [];

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function fails(table, method) {
    return errorOn === `${table}.${method}`;
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
      insert(payload) {
        if (fails(table, 'insert')) {
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }),
            }),
          };
        }
        idCounter += 1;
        const inserted = { id: `${table}-${idCounter}`, ...payload };
        db[table] = [...(db[table] ?? []), inserted];
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted, error: null }),
          }),
        };
      },
      // update(patch).eq(col, val).select().single(): the edit form's write (teams.js updateTeam).
      update(patch) {
        const target = [];
        const chain = {
          eq(col, val) {
            target.push([col, val]);
            return chain;
          },
          select: () => chain,
          single() {
            if (fails(table, 'update')) {
              return Promise.resolve({ data: null, error: { code: '23514', message: 'check' } });
            }
            const row = (db[table] ?? []).find((r) => matchesFilters(r, target));
            if (!row)
              return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'none' } });
            Object.assign(row, patch);
            return Promise.resolve({ data: { ...row }, error: null });
          },
        };
        return chain;
      },
      delete() {
        if (fails(table, 'delete')) {
          return {
            eq: () => Promise.resolve({ data: null, error: { code: '23503', message: 'FK' } }),
          };
        }
        return {
          eq: (col, val) => {
            db[table] = (db[table] ?? []).filter((row) => row[col] !== val);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      maybeSingle() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  // load_btc_demo: replaces the event's roster (and reports what it loaded), like the real one.
  function rpc(name, args) {
    rpcCalls.push([name, args]);
    if (name !== 'load_btc_demo') return Promise.resolve({ data: null, error: null });
    return Promise.resolve(demoGate).then(() => {
      if (demoError) return { data: null, error: demoError };
      db.btc_teams = db.btc_teams.filter((t) => t.event_id !== args.p_event_id);
      db.btc_judges = db.btc_judges.filter((j) => j.event_id !== args.p_event_id);
      for (const name of ['Bean Scene', 'Pour Decisions', 'Crema Crew']) {
        db.btc_teams.push({ id: `demo-${name}`, event_id: args.p_event_id, name });
      }
      db.btc_judges.push({ id: 'demo-j1', event_id: args.p_event_id, name: 'Judge 1' });
      return {
        data: demoReply ?? { teams: 8, judges: 5, matches: args.p_scored ? 28 : 0 },
        error: null,
      };
    });
  }

  return { from: (table) => makeBuilder(table), rpc, rpcCalls, db };
}

function baseDb() {
  return {
    events: [{ id: 'ev1', org_id: 'org1', name: 'BTC Test Event', is_test: true }],
    btc_teams: [
      { id: 't1', event_id: 'ev1', name: 'Alpha' },
      { id: 't2', event_id: 'ev1', name: 'Beta' },
    ],
    btc_judges: [{ id: 'j1', event_id: 'ev1', name: 'Jordan' }],
  };
}

describe('validateRosterName', () => {
  it('requires a non-blank name', () => {
    expect(validateRosterName('', 'Team')).toBe('Team name is required.');
    expect(validateRosterName('   ', 'Judge')).toBe('Judge name is required.');
  });

  it('accepts a real name', () => {
    expect(validateRosterName('Alpha', 'Team')).toBeNull();
  });
});

describe('mountSetupScreen', () => {
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

  it('renders the is_test banner, teams, and judges after loading', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).toContain('Beta');
    expect(root.textContent).toContain('Jordan');
  });

  describe('demo data', () => {
    const loadButton = () => root.querySelector('button[data-focus-key="demo-load"]');
    const rosterOnlyButton = () => root.querySelector('button[data-focus-key="demo-roster-only"]');
    const click = (node) => node.dispatchEvent(new Event('click', { bubbles: true }));
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const status = () => root.querySelector('.btc-demo-status')?.textContent;
    const alert = () => root.querySelector('.btc-demo-card [role="alert"]')?.textContent;
    const describedBy = (button) =>
      button
        .getAttribute('aria-describedby')
        .split(' ')
        .map((id) => root.querySelector(`#${id}`)?.textContent ?? '(missing)')
        .join(' ');

    it('offers the demo on a test event, with both modes, under the test banner', async () => {
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      const card = root.querySelector('.btc-demo-card');
      expect(card.querySelector('h2').textContent).toBe('Demo data');
      expect(card.getAttribute('aria-labelledby')).toBe(card.querySelector('h2').id);
      expect(loadButton().textContent).toBe('Load demo');
      expect(rosterOnlyButton().textContent).toBe('Load roster only');
      expect(card.textContent).toContain('also gives 28 matches');
      expect(card.textContent).toContain('8 teams and 5 judges');
      // the test banner comes first in reading order
      const banner = root.querySelector('.is-test-banner');
      expect(banner.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('says in words, tied to BOTH buttons, that either one replaces everything on the event', async () => {
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      for (const button of [loadButton(), rosterOnlyButton()]) {
        const description = describedBy(button);
        expect(description).toContain('Either option erases this test event');
        expect(description).toContain('matches, scores and bracket');
        // and what each mode gives is described too
        expect(description).toContain('"Load roster only" gives none');
      }
    });

    it('does not offer it on a real (non-test) event', async () => {
      const db = baseDb();
      db.events[0].is_test = false;
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(db) });
      expect(root.querySelector('.btc-demo-card')).toBeNull();
      expect(loadButton()).toBeNull();
    });

    it('asks before replacing a roster, naming the mode, and does nothing if the person says no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      click(rosterOnlyButton());
      await flush();

      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm.mock.calls[0][0]).toMatch(/full demo.*28 scored matches.*erased/i);
      expect(confirm.mock.calls[1][0]).toMatch(/demo roster.*no matches.*erased/i);
      expect(client.rpcCalls).toEqual([]);
      expect(root.textContent).toContain('Alpha');
    });

    it('loads the scored demo and replaces the roster on screen', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb());
      const handlers = { composed: true };
      await mountSetupScreen(root, { eventId: 'ev1', client, handlers });
      click(loadButton());
      await flush();

      expect(client.rpcCalls).toEqual([
        ['load_btc_demo', { p_org_id: 'org1', p_event_id: 'ev1', p_scored: true }],
      ]);
      // the roster was RE-READ: the typed names are gone, the demo's are shown
      expect(root.textContent).toContain('Bean Scene');
      expect(root.textContent).not.toContain('Alpha');
      // judges too, not only teams
      // (scoped to the judges list: "Jordan" is also a country in the country selects)
      expect(root.querySelector('ul[aria-label="Judges roster"]').textContent).not.toContain(
        'Jordan',
      );
      expect(root.textContent).toContain('Judge 1');
      // Loading wipes and rebuilds the event, so the audience display is refreshed, and a rehearsal on the
      // projector takes it over (as a test heat does for Cup Taster).
      expect(publishBtcLive).toHaveBeenCalledTimes(1);
      expect(publishBtcLive).toHaveBeenCalledWith(
        {
          event: expect.objectContaining({ id: 'ev1', org_id: 'org1', is_test: true }),
          takeOver: true,
        },
        handlers,
      );
    });

    it("prints the SERVER's numbers, not a hard-coded message", async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb(), { demoReply: { teams: 3, judges: 2, matches: 1 } });
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();
      expect(status()).toBe(
        'Demo loaded: 3 teams, 2 judges and 1 scored matches. Lock the top 8 in Standings when you are ready.',
      );
    });

    it('shows the result INSIDE the card, and it stays (the 1.5 s toast is not used)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      click(loadButton());
      await flush();

      const expected =
        'Demo loaded: 8 teams, 5 judges and 28 scored matches. Lock the top 8 in Standings when you are ready.';
      expect(status()).toBe(expected);
      expect(root.querySelector('.btc-demo-card .btc-demo-status')).not.toBeNull();
      expect(root.querySelector('.btc-demo-status').getAttribute('role')).toBe('status');
      // not a toast, so nothing removes it after 1.5 s
      expect(root.querySelector('.screen-feedback')).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1700));
      expect(status()).toBe(expected);
    });

    it('keeps focus on the button that was pressed instead of moving it down the page', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      loadButton().focus();
      click(loadButton());
      await flush();
      expect(document.activeElement).toBe(loadButton());
    });

    it('loads the roster only when asked, and says so', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(rosterOnlyButton());
      await flush();

      expect(client.rpcCalls[0][1].p_scored).toBe(false);
      expect(status()).toBe('Demo roster loaded: 8 teams and 5 judges, no matches.');
    });

    it('asks when only teams exist, and when only judges exist (either is data to lose)', async () => {
      for (const keep of ['btc_teams', 'btc_judges']) {
        root.innerHTML = '';
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const db = baseDb();
        db.btc_teams = keep === 'btc_teams' ? db.btc_teams : [];
        db.btc_judges = keep === 'btc_judges' ? db.btc_judges : [];
        await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(db) });
        click(loadButton());
        await flush();
        expect(confirm).toHaveBeenCalledTimes(1);
        confirm.mockRestore();
      }
    });

    it('does not ask when there is nothing to lose (an empty roster)', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const db = baseDb();
      db.btc_teams = [];
      db.btc_judges = [];
      const client = fakeClient(db);
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();

      expect(confirm).not.toHaveBeenCalled();
      expect(client.rpcCalls).toHaveLength(1);
    });

    it('never waits on the publish: the demo result still shows if it never settles', async () => {
      publishBtcLive.mockImplementationOnce(() => new Promise(() => {}));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();
      expect(status()).toMatch(/demo/i);
      expect(root.textContent).toContain('Bean Scene');
    });

    it('a refused publish is logged, not thrown: the demo still loads', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      publishBtcLive.mockRejectedValueOnce(new TypeError('no handler map'));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();
      expect(root.textContent).toContain('Bean Scene');
      expect(error).toHaveBeenCalledWith(
        'btc: live-view publish was refused',
        expect.any(TypeError),
      );
    });

    it('explains a refusal in an alert inside the card and leaves the roster alone', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb(), {
        demoError: { code: 'P0001', hint: 'demo_not_test', message: 'wording does not matter' },
      });
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();

      expect(alert()).toBe(
        'Demo data loads only into a test event. Open a test event and try again.',
      );
      expect(root.textContent).toContain('Alpha');
      // and the screen is usable again
      expect(loadButton().getAttribute('aria-disabled')).not.toBe('true');
      // Nothing was loaded, so nothing is published.
      expect(publishBtcLive).not.toHaveBeenCalled();
    });

    it('shows a visible, announced "Loading demo…" while it works, and says which button is busy', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const client = fakeClient(baseDb(), { demoGate: gate });
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(rosterOnlyButton());
      await flush();

      expect(status()).toBe('Loading demo…');
      expect(rosterOnlyButton().textContent).toBe('Loading…');
      expect(loadButton().textContent).toBe('Load demo');
      // both are inert while it works, whichever was pressed
      expect(loadButton().getAttribute('aria-disabled')).toBe('true');
      expect(rosterOnlyButton().getAttribute('aria-disabled')).toBe('true');
      release();
      await flush();
      expect(status()).toMatch(/Demo roster loaded/);
      expect(rosterOnlyButton().textContent).toBe('Load roster only');
    });

    it('sends ONE request however many times the buttons are pressed while it is loading', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const client = fakeClient(baseDb(), { demoGate: gate });
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(loadButton());
      await flush();
      click(loadButton());
      click(rosterOnlyButton());
      await flush();

      expect(client.rpcCalls).toHaveLength(1);
      expect(client.rpcCalls[0][1].p_scored).toBe(true);
      expect(loadButton().getAttribute('aria-disabled')).toBe('true');
      expect(loadButton().textContent).toBe('Loading…');
      expect(rosterOnlyButton().textContent).toBe('Load roster only');
      release();
      await flush();
      expect(client.rpcCalls).toHaveLength(1);
      expect(status()).toMatch(/28 scored matches/);
    });

    it('does not wait forever: after the timeout it says the demo may or may not have loaded, and unlocks the screen', async () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const client = fakeClient(baseDb(), { demoGate: new Promise(() => {}) });
        await mountSetupScreen(root, { eventId: 'ev1', client });
        click(loadButton());
        // still waiting at 19 s: the limit is 20 s, not the 10 s a plain read gets
        await vi.advanceTimersByTimeAsync(19000);
        expect(status()).toBe('Loading demo…');
        expect(loadButton().getAttribute('aria-disabled')).toBe('true');
        await vi.advanceTimersByTimeAsync(1001);

        expect(alert()).toBe(
          'This is taking longer than expected. The demo may or may not have loaded. Reload the page to check.',
        );
        expect(loadButton().getAttribute('aria-disabled')).not.toBe('true');
        expect(status()).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    it('if re-reading the roster fails after a successful load, drops the old roster for the retry view that says the demo loaded', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      const realFrom = client.from;
      const realRpc = client.rpc;
      let loaded = false;
      client.rpc = (...args) =>
        realRpc(...args).then((result) => {
          loaded = true;
          return result;
        });
      client.from = (table) => {
        if (loaded) throw new Error('network down');
        return realFrom(table);
      };
      click(loadButton());
      await flush();

      expect(root.textContent).toContain(
        'The demo loaded, but this page could not refresh. Retry to see it.',
      );
      // The demo IS loaded, so the display is refreshed even though this page could not re-read it.
      expect(publishBtcLive).toHaveBeenCalledTimes(1);
      // the old rows no longer exist on the server and must not stay on screen with Remove buttons
      expect(root.textContent).not.toContain('Alpha');
      const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      expect(retry).toBeDefined();
      // Retry recovers: the demo roster shows
      client.from = realFrom;
      click(retry);
      await flush();
      expect(root.textContent).toContain('Bean Scene');
      // and nothing is left locked or stuck on "Loading demo…": the demo can be loaded again
      expect(status()).toBe('');
      expect(loadButton().getAttribute('aria-disabled')).not.toBe('true');
      expect(rosterOnlyButton().getAttribute('aria-disabled')).not.toBe('true');
      click(loadButton());
      await flush();
      expect(client.rpcCalls).toHaveLength(2);
    });

    it('a roster re-read that HANGS after a successful load does not lock the screen: the retry view appears', async () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const client = fakeClient(baseDb());
        await mountSetupScreen(root, { eventId: 'ev1', client });
        const realFrom = client.from;
        const realRpc = client.rpc;
        let loaded = false;
        // a chain that never settles, once the load itself has succeeded
        const hang = {};
        for (const method of ['select', 'eq', 'order']) hang[method] = () => hang;
        hang.single = () => new Promise(() => {});
        hang.maybeSingle = () => new Promise(() => {});
        hang.then = () => {};
        client.rpc = (...args) =>
          realRpc(...args).then((result) => {
            loaded = true;
            return result;
          });
        client.from = (table) => (loaded ? hang : realFrom(table));
        click(loadButton());
        await vi.advanceTimersByTimeAsync(10001);

        expect(root.textContent).toContain(
          'The demo loaded, but this page could not refresh. Retry to see it.',
        );
        expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(
          true,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears an old demo result once the roster is changed by hand (it would no longer be true)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      click(loadButton());
      await flush();
      expect(status()).toMatch(/Demo loaded/);

      const input = root.querySelector('input[data-field="team"]');
      input.value = 'Delta';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
      expect(status()).toBe('');
    });
  });

  it('adds a team and shows it in the list', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    teamInput.value = 'Gamma';
    teamInput.dispatchEvent(new Event('input'));
    const form = teamInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Two microtask/render cycles: the submit handler's own await, then the
    // toast's render() call.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Gamma');
    expect(root.textContent).toContain('Gamma added.');

    // Standings list every registered team: a roster change is a schedule edit for the room.
    expect(publishBtcLive).toHaveBeenCalledTimes(1);
    expect(publishBtcLive.mock.calls[0][0].takeOver).toBe(false);
  });

  it('shows a validation error and does not call the client when the team name is blank', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    const form = teamInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(root.textContent).toContain('Team name is required.');

    expect(publishBtcLive).not.toHaveBeenCalled();
  });

  it('removes a team', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const removeButton = root.querySelector('button[aria-label="Remove Alpha"]');
    removeButton.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('button[aria-label="Remove Alpha"]')).toBeNull();
    expect(root.textContent).toContain('Alpha removed.');

    expect(publishBtcLive).toHaveBeenCalledTimes(1);
    expect(publishBtcLive.mock.calls[0][0].takeOver).toBe(false);
  });

  it('shows a describeError message, not a raw one, when removing a team fails (still referenced by a match)', async () => {
    const client = fakeClient(baseDb(), { errorOn: 'btc_teams.delete' });
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const removeButton = root.querySelector('button[aria-label="Remove Alpha"]');
    removeButton.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Alpha is still shown — the delete failed, so the client-side list must
    // not have optimistically dropped it.
    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).toContain('Something went wrong saving that — try again.');

    expect(publishBtcLive).not.toHaveBeenCalled();
  });

  it('adds a judge and shows it in the list', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const judgeInput = root.querySelector('input[aria-label="Judge name"]');
    judgeInput.value = 'Casey';
    judgeInput.dispatchEvent(new Event('input'));
    const form = judgeInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Casey');
  });

  it('shows a load error with a Retry button on a failed initial load, and recovers on retry', async () => {
    let attempt = 0;
    const client = {
      from(table) {
        attempt += 1;
        const shouldFail = attempt <= 3; // events + btc_teams + btc_judges, first pass
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          single: () =>
            shouldFail
              ? Promise.resolve({ data: null, error: new Error('network down') })
              : Promise.resolve({
                  data: table === 'events' ? { id: 'ev1', is_test: false } : null,
                  error: null,
                }),
          then: (resolve) =>
            shouldFail
              ? Promise.resolve({ data: null, error: new Error('network down') }).then(resolve)
              : Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      },
    };

    await mountSetupScreen(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('network down');

    const retryButton = root.querySelector('button');
    expect(retryButton.textContent).toBe('Retry');
    retryButton.dispatchEvent(new Event('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('BTC Setup');
    expect(root.textContent).not.toContain('network down');
  });

  it('aborts silently and writes nothing once its signal is aborted before the load resolves', async () => {
    const controller = new AbortController();
    // Resolves on the very next microtask (not synchronously) — the abort
    // below fires before any of these settle, so render() always observes
    // signal.aborted === true by the time attemptLoad's own await returns.
    const client = fakeClient(baseDb());

    controller.abort();
    await mountSetupScreen(root, { eventId: 'ev1', client, signal: controller.signal });

    expect(root.querySelector('.btc-setup-screen')).toBeNull();
    expect(root.children).toHaveLength(0);
  });

  // Regression coverage for the ui-accessibility-reviewer findings on this
  // screen's first draft: nothing carried a focus-key, load success never
  // moved focus anywhere, and validation errors had no accessible
  // association to their field.
  it('moves focus to the heading once the initial load succeeds', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('keeps focus on the team input across the re-render a validation error triggers', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    teamInput.focus();
    expect(document.activeElement).toBe(teamInput);

    const form = teamInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    // A brand-new <input> node (root.innerHTML was cleared and rebuilt) —
    // this only passes if withFocusPreservation actually found it again via
    // its own data-field="team" attribute, not because the old node
    // survived.
    const rebuiltInput = root.querySelector('input[aria-label="Team name"]');
    expect(rebuiltInput).not.toBe(teamInput);
    expect(document.activeElement).toBe(rebuiltInput);
  });

  it('associates a validation error with its field via aria-describedby, and announces it via role="alert"', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    const form = teamInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    const errorNode = root.querySelector('.btc-field-error');
    expect(errorNode.getAttribute('role')).toBe('alert');
    expect(errorNode.id).toBeTruthy();
    // the error AND the name hint both describe the field
    expect(
      root
        .querySelector('input[aria-label="Team name"]')
        .getAttribute('aria-describedby')
        .split(' '),
    ).toEqual(['btc-team-name-hint', errorNode.id]);
    expect(root.querySelector('input[aria-label="Team name"]').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('moves focus to the toast confirmation after a team is successfully added', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    teamInput.value = 'Gamma';
    teamInput.dispatchEvent(new Event('input'));
    teamInput
      .closest('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.activeElement?.textContent).toBe('Gamma added.');
  });
  describe('country', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const click = (node) => node.dispatchEvent(new Event('click', { bubbles: true }));
    const submit = (form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const type = (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const choose = (select, value) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
    };
    const teamForm = () => root.querySelector('input[aria-label="Team name"]').closest('form');
    const judgeForm = () => root.querySelector('input[aria-label="Judge name"]').closest('form');
    const editButton = (name) => root.querySelector(`button[aria-label="Edit ${name}"]`);
    const rowText = (listLabel, name) =>
      [...root.querySelectorAll(`ul[aria-label="${listLabel}"] li`)].find((li) =>
        li.textContent.includes(name),
      )?.textContent;
    const editForm = () => root.querySelector('.btc-roster-edit-form');

    it('adds a team with its country and represents label, and shows "Country · Name"', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      const form = teamForm();
      type(form.querySelector('input[aria-label="Team name"]'), 'Gamma');
      choose(form.querySelector('select[aria-label="Team country"]'), 'BN');
      type(form.querySelector('input[aria-label="Represents (optional)"]'), '  Borneo ');
      submit(form);
      await flush();

      expect(client.db.btc_teams.find((t) => t.name === 'Gamma')).toMatchObject({
        country_code: 'BN',
        represents: 'Borneo',
      });
      expect(rowText('Teams roster', 'Gamma')).toContain('Brunei · Gamma');
      expect(rowText('Teams roster', 'Gamma')).toContain('Represents: Borneo');
      // the next team starts blank: a country is never carried over silently
      expect(teamForm().querySelector('select[aria-label="Team country"]').value).toBe('');
    });

    it('adds a team with no country and sends neither field', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      type(root.querySelector('input[aria-label="Team name"]'), 'Gamma');
      submit(teamForm());
      await flush();
      const gamma = client.db.btc_teams.find((t) => t.name === 'Gamma');
      expect(gamma).not.toHaveProperty('country_code');
      expect(gamma).not.toHaveProperty('represents');
      expect(rowText('Teams roster', 'Gamma')).toBe('GammaEditRemove');
    });

    it('says what the team name is for, tied to the field', async () => {
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      const hint = root.querySelector('#btc-team-name-hint');
      expect(hint.textContent).toBe('A team or country name, not a person’s name');
      expect(
        root.querySelector('input[aria-label="Team name"]').getAttribute('aria-describedby'),
      ).toBe('btc-team-name-hint');
    });

    it('adds a judge with a country', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      const form = judgeForm();
      type(form.querySelector('input[aria-label="Judge name"]'), 'Siti');
      choose(form.querySelector('select[aria-label="Judge country"]'), 'BN');
      submit(form);
      await flush();
      expect(client.db.btc_judges.find((j) => j.name === 'Siti')).toMatchObject({
        country_code: 'BN',
      });
      expect(rowText('Judges roster', 'Siti')).toContain('Brunei · Siti');
    });

    it('refuses a represents label over 60 characters, at the field, without writing', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      const form = teamForm();
      type(form.querySelector('input[aria-label="Team name"]'), 'Gamma');
      type(form.querySelector('input[aria-label="Represents (optional)"]'), 'x'.repeat(61));
      submit(form);
      await flush();
      const alert = root.querySelector('.btc-roster-card [role="alert"]');
      expect(alert.textContent).toBe('Represents must be 60 characters or fewer.');
      const represents = root.querySelector('input[aria-label="Represents (optional)"]');
      expect(represents.getAttribute('aria-describedby')).toBe(alert.id);
      expect(represents.getAttribute('aria-invalid')).toBe('true');
      expect(client.db.btc_teams.some((t) => t.name === 'Gamma')).toBe(false);
    });

    it('edits a team in place, saves it, announces it and returns focus to its Edit button', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Alpha'));
      // focus moves to the first field of the opened form
      expect(document.activeElement).toBe(
        editForm().querySelector('select[aria-label="Team country"]'),
      );
      choose(editForm().querySelector('select'), 'SG');
      type(editForm().querySelector('input[aria-label="Represents (optional)"]'), 'Lion City');
      submit(editForm());
      await flush();

      expect(client.db.btc_teams.find((t) => t.id === 't1')).toMatchObject({
        country_code: 'SG',
        represents: 'Lion City',
      });
      expect(editForm()).toBeNull();
      expect(rowText('Teams roster', 'Alpha')).toContain('Singapore · Alpha');
      expect(root.textContent).toContain('Alpha updated.');
      expect(document.activeElement).toBe(editButton('Alpha'));
      expect(publishBtcLive).toHaveBeenCalledWith(
        expect.objectContaining({ takeOver: false }),
        undefined,
      );
    });

    it('clears a country and a represents label with "No country" and an empty field', async () => {
      const db = baseDb();
      db.btc_teams[0].country_code = 'BN';
      db.btc_teams[0].represents = 'Borneo';
      const client = fakeClient(db);
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Alpha'));
      // the form opens on what is stored
      expect(editForm().querySelector('select').value).toBe('BN');
      expect(editForm().querySelector('input').value).toBe('Borneo');
      choose(editForm().querySelector('select'), '');
      type(editForm().querySelector('input'), '   ');
      submit(editForm());
      await flush();
      expect(client.db.btc_teams.find((t) => t.id === 't1')).toMatchObject({
        country_code: null,
        represents: null,
      });
      expect(rowText('Teams roster', 'Alpha')).toBe('AlphaEditRemove');
    });

    it('Cancel changes nothing, publishes nothing and returns focus to the Edit button', async () => {
      const db = baseDb();
      db.btc_teams[0].country_code = 'BN';
      const client = fakeClient(db);
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Alpha'));
      choose(editForm().querySelector('select'), 'SG');
      click(editForm().querySelector('button[data-focus-key="edit-cancel"]'));
      expect(editForm()).toBeNull();
      expect(client.db.btc_teams.find((t) => t.id === 't1').country_code).toBe('BN');
      expect(document.activeElement).toBe(editButton('Alpha'));
      expect(publishBtcLive).not.toHaveBeenCalled();
    });

    it('edits one row at a time', async () => {
      await mountSetupScreen(root, { eventId: 'ev1', client: fakeClient(baseDb()) });
      click(editButton('Alpha'));
      click(editButton('Beta'));
      expect(root.querySelectorAll('.btc-roster-edit-form')).toHaveLength(1);
      expect(editForm().getAttribute('aria-label')).toBe('Edit Beta');
      click(editButton('Jordan'));
      expect(root.querySelectorAll('.btc-roster-edit-form')).toHaveLength(1);
      expect(editForm().getAttribute('aria-label')).toBe('Edit Jordan');
    });

    it('keeps the edit open and says why when represents is too long', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Alpha'));
      type(editForm().querySelector('input'), 'x'.repeat(61));
      submit(editForm());
      await flush();
      const alert = editForm().querySelector('[role="alert"]');
      expect(alert.textContent).toBe('Represents must be 60 characters or fewer.');
      expect(editForm().querySelector('input').getAttribute('aria-describedby')).toBe(alert.id);
      expect(client.db.btc_teams.find((t) => t.id === 't1')).not.toHaveProperty('represents');
    });

    it('keeps the edit open with the database error when the save fails', async () => {
      const client = fakeClient(baseDb(), { errorOn: 'btc_teams.update' });
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Alpha'));
      choose(editForm().querySelector('select'), 'SG');
      submit(editForm());
      await flush();
      expect(editForm().querySelector('[role="alert"]')).not.toBeNull();
      expect(editForm().querySelector('select').value).toBe('SG');
      expect(publishBtcLive).not.toHaveBeenCalled();
    });

    it('edits a judge country and does not republish (judge country is organiser-only)', async () => {
      const client = fakeClient(baseDb());
      await mountSetupScreen(root, { eventId: 'ev1', client });
      click(editButton('Jordan'));
      expect(editForm().querySelector('input')).toBeNull(); // judges have no represents label
      choose(editForm().querySelector('select'), 'MY');
      submit(editForm());
      await flush();
      expect(client.db.btc_judges.find((j) => j.id === 'j1').country_code).toBe('MY');
      expect(rowText('Judges roster', 'Jordan')).toContain('Malaysia · Jordan');
      expect(document.activeElement).toBe(editButton('Jordan'));
      expect(publishBtcLive).not.toHaveBeenCalled();
    });
  });
});
