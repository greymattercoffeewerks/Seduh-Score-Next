import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountStandingsScreen } from './standingsScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

let db;
let failTeams = false;
let hangEvents = false;

function fakeClient() {
  function makeBuilder(table) {
    const filters = [];
    const matches = (row) => filters.every(([c, v]) => row[c] === v);
    const builder = {
      select: () => builder,
      eq: (col, val) => {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      single: () => {
        if (hangEvents && table === 'events') return new Promise(() => {});
        const row = (db[table] ?? []).find(matches);
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      then: (resolve, reject) => {
        if (failTeams && table === 'btc_teams') {
          return Promise.resolve({ data: null, error: new Error('network down') }).then(
            resolve,
            reject,
          );
        }
        const rows = (db[table] ?? []).filter(matches);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { from: makeBuilder };
}

function baseDb() {
  return {
    events: [{ id: 'ev1', org_id: 'org1', is_test: true }],
    btc_teams: [
      { id: 't1', event_id: 'ev1', name: 'Alpha' },
      { id: 't2', event_id: 'ev1', name: 'Beta' },
    ],
    btc_standings: [
      { event_id: 'ev1', team_id: 't1', played: 2, wins: 2, total_points: 50 },
      { event_id: 'ev1', team_id: 't2', played: 2, wins: 0, total_points: 15 },
    ],
  };
}

describe('mountStandingsScreen', () => {
  let root;

  beforeEach(() => {
    db = baseDb();
    failTeams = false;
    hangEvents = false;
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const mount = (extra = {}) =>
    mountStandingsScreen(root, { eventId: 'ev1', client: fakeClient(), ...extra });
  const rows = () => [...root.querySelectorAll('.standings-row')];
  const cell = (row, label) => row.querySelector(`[data-label="${label}"]`).textContent;

  it('renders the ranked table with every team, is_test banner, and moves focus to the heading', async () => {
    await mount();
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(rows()).toHaveLength(2);
    expect(cell(rows()[0], 'Pos')).toBe('1');
    expect(cell(rows()[0], 'Team')).toBe('Alpha');
    expect(cell(rows()[0], 'Played')).toBe('2');
    expect(cell(rows()[0], 'Wins')).toBe('2');
    expect(cell(rows()[0], 'Points')).toBe('50');
    expect(cell(rows()[1], 'Team')).toBe('Beta');
  });

  it('shows a team with no confirmed matches as "Not yet played", not a fabricated zero row hidden from view', async () => {
    db.btc_teams.push({ id: 't3', event_id: 'ev1', name: 'Gamma' });
    await mount();
    const gammaRow = rows().find((r) => cell(r, 'Team') === 'Gamma');
    expect(cell(gammaRow, 'Played')).toBe('0');
    expect(cell(gammaRow, 'Status')).toBe('Not yet played');
    expect(gammaRow.dataset.status).toBe('pending');
  });

  it('a team that has played gets no status label', async () => {
    await mount();
    expect(cell(rows()[0], 'Status')).toBe('');
    expect(rows()[0].dataset.status).toBeUndefined();
  });

  it('shows an empty-state message when the event has no teams', async () => {
    db.btc_teams = [];
    db.btc_standings = [];
    await mount();
    expect(root.textContent).toContain('No teams registered yet');
    expect(root.querySelector('.standings-table')).toBeNull();
  });

  it('shows a load error with Retry, and Retry really reloads', async () => {
    failTeams = true;
    await mount();
    expect(root.textContent).toContain('network down');
    failTeams = false;
    root.querySelector('button').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('gives a slow load its own message, not the raw error', async () => {
    vi.useFakeTimers();
    hangEvents = true;
    const mounting = mount();
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
    await mounting;
    expect(root.textContent).toContain('taking longer than expected');
  });

  it('writes nothing once its signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await mount({ signal: controller.signal });
    expect(root.children).toHaveLength(0);
  });
});
