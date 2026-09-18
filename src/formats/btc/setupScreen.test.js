import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSetupScreen, validateRosterName } from './setupScreen.js';

// Table-based in-memory fake client, mirroring rosterScreen.test.js's own
// (this screen composes findEvent + listTeams + listJudges + createTeam/
// createJudge + removeTeam/removeJudge, so a hand-ordered call queue can't
// express it cleanly for a whole-screen integration test). `errorOn` injects
// a write failure for one specific `table.method` combination.
function fakeClient(initialDb, { errorOn } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;

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

  return { from: (table) => makeBuilder(table) };
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
  });

  it('shows a validation error and does not call the client when the team name is blank', async () => {
    const client = fakeClient(baseDb());
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const teamInput = root.querySelector('input[aria-label="Team name"]');
    const form = teamInput.closest('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(root.textContent).toContain('Team name is required.');
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
    expect(root.querySelector('input[aria-label="Team name"]').getAttribute('aria-describedby')).toBe(
      errorNode.id,
    );
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
    teamInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.activeElement?.textContent).toBe('Gamma added.');
  });
});
