import { describe, it, expect } from 'vitest';
import { fetchPreliminaryStandings } from './standings.js';

// Table-based fake client, same shape as matches.test.js's own.
function fakeClient({ tables = {}, errorOn } = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(tables)) {
    db[table] = rows.map((row) => ({ ...row }));
  }

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
      // A real sort, not a no-op — otherwise a test relying on "the fixture happened
      // to already be in the right order" could pass even if standings.js stopped
      // calling .order() at all. Only string columns are exercised here (name), so a
      // plain localeCompare is enough.
      order(column) {
        db[table] = [...(db[table] ?? [])].sort((a, b) =>
          String(a[column]).localeCompare(String(b[column])),
        );
        return builder;
      },
      then(resolve, reject) {
        if (errorOn === table) {
          return Promise.resolve({ data: null, error: { code: '42501' } }).then(resolve, reject);
        }
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from: (table) => makeBuilder(table) };
}

describe('fetchPreliminaryStandings', () => {
  it('merges every registered team with its standings row, ranked by points', async () => {
    const client = fakeClient({
      tables: {
        btc_teams: [
          { id: 't1', event_id: 'ev1', name: 'Beta' },
          { id: 't2', event_id: 'ev1', name: 'Alpha' },
        ],
        btc_standings: [
          { event_id: 'ev1', team_id: 't1', played: 2, wins: 2, total_points: 50 },
          { event_id: 'ev1', team_id: 't2', played: 2, wins: 0, total_points: 20 },
        ],
      },
    });
    const ranked = await fetchPreliminaryStandings('ev1', client);
    expect(ranked).toEqual([
      {
        item: { teamId: 't1', teamName: 'Beta', played: 2, wins: 2, totalPoints: 50 },
        position: 1,
      },
      {
        item: { teamId: 't2', teamName: 'Alpha', played: 2, wins: 0, totalPoints: 20 },
        position: 2,
      },
    ]);
  });

  it('gives a team with no standings row zeros, not an omission', async () => {
    const client = fakeClient({
      tables: {
        btc_teams: [{ id: 't1', event_id: 'ev1', name: 'Alpha' }],
        btc_standings: [],
      },
    });
    const ranked = await fetchPreliminaryStandings('ev1', client);
    expect(ranked).toEqual([
      {
        item: { teamId: 't1', teamName: 'Alpha', played: 0, wins: 0, totalPoints: 0 },
        position: 1,
      },
    ]);
  });

  it('breaks a points tie by wins, and a genuine remaining tie shares one position', async () => {
    // Deliberately fed OUT of alphabetical order: the fake client's own order() (above)
    // really sorts, so this only comes out alphabetical if fetchPreliminaryStandings
    // genuinely calls .order('name') on btc_teams — proving the module relies on the
    // query's own ordering, not a coincidence of fixture order. fetchPreliminaryStandings
    // must also not re-sort a genuine tie by name itself (that would eliminate the tie
    // instead of sharing a position for it).
    const client = fakeClient({
      tables: {
        btc_teams: [
          { id: 't1', event_id: 'ev1', name: 'Zed Team' },
          { id: 't3', event_id: 'ev1', name: 'Beta Team' },
          { id: 't2', event_id: 'ev1', name: 'Alpha Team' },
        ],
        btc_standings: [
          { event_id: 'ev1', team_id: 't1', played: 2, wins: 1, total_points: 30 },
          { event_id: 'ev1', team_id: 't2', played: 2, wins: 2, total_points: 30 },
          { event_id: 'ev1', team_id: 't3', played: 2, wins: 1, total_points: 30 },
        ],
      },
    });
    const ranked = await fetchPreliminaryStandings('ev1', client);
    expect(ranked.map(({ item }) => item.teamName)).toEqual([
      'Alpha Team',
      'Beta Team',
      'Zed Team',
    ]);
    // wins-tiebreak winner is alone at position 1; the two remaining ties share position 2
    expect(ranked.map(({ position }) => position)).toEqual([1, 2, 2]);
  });

  it('scopes both queries to the given event', async () => {
    const client = fakeClient({
      tables: {
        btc_teams: [
          { id: 't1', event_id: 'ev1', name: 'In event' },
          { id: 't2', event_id: 'ev2', name: 'Other event' },
        ],
        btc_standings: [
          { event_id: 'ev1', team_id: 't1', played: 1, wins: 1, total_points: 10 },
          { event_id: 'ev2', team_id: 't2', played: 1, wins: 1, total_points: 99 },
        ],
      },
    });
    const ranked = await fetchPreliminaryStandings('ev1', client);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].item.teamName).toBe('In event');
  });

  it('returns an empty ranking for an event with no teams', async () => {
    const client = fakeClient({ tables: { btc_teams: [], btc_standings: [] } });
    expect(await fetchPreliminaryStandings('ev1', client)).toEqual([]);
  });

  it('throws the raw error from either query rather than swallowing it', async () => {
    const client = fakeClient({
      tables: { btc_teams: [], btc_standings: [] },
      errorOn: 'btc_teams',
    });
    await expect(fetchPreliminaryStandings('ev1', client)).rejects.toMatchObject({
      code: '42501',
    });
  });
});
