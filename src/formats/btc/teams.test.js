import { describe, it, expect } from 'vitest';
import { listTeams, findTeamByName, createTeam, removeTeam } from './teams.js';

// Matches cup-taster/setup.test.js's own fakeClient shape (queue-based,
// consumed strictly in call order per table) — same convention, reused
// unedited rather than hand-rolled a second way for this sibling module.
function fakeClient({ tables = {} } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  const calls = [];

  return {
    calls,
    from(table) {
      const queue = queues[table] ?? [{ data: null, error: null }];
      const resolve = () => (queue.length > 1 ? queue.shift() : queue[0]);
      const builder = {
        select: (...args) => {
          calls.push(['select', table, ...args]);
          return builder;
        },
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          return builder;
        },
        delete: () => {
          calls.push(['delete', table]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', table, ...args]);
          return builder;
        },
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
      };
      return builder;
    },
  };
}

describe('listTeams', () => {
  it('lists teams for an event, ordered by name', async () => {
    const teams = [
      { id: 't1', event_id: 'e1', name: 'Alpha' },
      { id: 't2', event_id: 'e1', name: 'Beta' },
    ];
    const client = fakeClient({ tables: { btc_teams: { data: teams, error: null } } });
    const result = await listTeams('e1', client);
    expect(result).toEqual(teams);
    expect(client.calls).toContainEqual(['order', 'btc_teams', 'name', { ascending: true }]);
  });

  it('throws the raw error on a failed read', async () => {
    const client = fakeClient({
      tables: { btc_teams: { data: null, error: new Error('read failed') } },
    });
    await expect(listTeams('e1', client)).rejects.toThrow('read failed');
  });
});

describe('findTeamByName', () => {
  it('returns null when no team matches', async () => {
    const client = fakeClient({ tables: { btc_teams: { data: null, error: null } } });
    expect(await findTeamByName('e1', 'Nobody', client)).toBeNull();
  });
});

describe('createTeam', () => {
  it('inserts a new team and returns it', async () => {
    const created = { id: 't1', event_id: 'e1', name: 'Alpha' };
    const client = fakeClient({ tables: { btc_teams: { data: created, error: null } } });
    const result = await createTeam('e1', 'Alpha', client);
    expect(result).toEqual(created);
    expect(client.calls).toContainEqual([
      'insert',
      'btc_teams',
      { event_id: 'e1', name: 'Alpha' },
    ]);
  });

  // A double-tap on "Add team," or a retry after a dropped response whose
  // write actually landed — both must resolve to the SAME existing row
  // rather than surfacing btc_teams' (event_id, name) unique-index
  // violation raw. Mirrors setup.js's createStage / registry.js's
  // registerPerson race-recovery shape exactly.
  it('recovers from a unique-violation by returning the existing row, not throwing', async () => {
    const existing = { id: 't1', event_id: 'e1', name: 'Alpha' };
    const client = fakeClient({
      tables: {
        btc_teams: [
          { data: null, error: { code: '23505', message: 'duplicate' } }, // insert
          { data: existing, error: null }, // findTeamByName recovery read
        ],
      },
    });
    const result = await createTeam('e1', 'Alpha', client);
    expect(result).toEqual(existing);
  });

  it('re-throws a unique-violation if the recovery read finds no matching row (a genuine race we lost visibility into, not a real duplicate)', async () => {
    const client = fakeClient({
      tables: {
        btc_teams: [
          { data: null, error: { code: '23505', message: 'duplicate' } },
          { data: null, error: null },
        ],
      },
    });
    await expect(createTeam('e1', 'Alpha', client)).rejects.toMatchObject({ code: '23505' });
  });

  it('throws a non-unique-violation error without attempting recovery', async () => {
    const client = fakeClient({
      tables: {
        btc_teams: { data: null, error: { code: '42501', message: 'permission denied' } },
      },
    });
    await expect(createTeam('e1', 'Alpha', client)).rejects.toMatchObject({ code: '42501' });
    // findTeamByName is the only path that ever calls .eq() (it filters by
    // event_id and name) — a plain insert().select().single() never does,
    // so its absence here proves recovery was never attempted for a
    // non-23505 error, distinguishing that from "attempted and also failed."
    expect(client.calls.filter(([op]) => op === 'eq')).toHaveLength(0);
  });
});

describe('removeTeam', () => {
  it('deletes the team by id', async () => {
    const client = fakeClient({ tables: { btc_teams: { data: null, error: null } } });
    await removeTeam('t1', client);
    expect(client.calls).toContainEqual(['delete', 'btc_teams']);
    expect(client.calls).toContainEqual(['eq', 'btc_teams', 'id', 't1']);
  });

  it('throws when the team is still referenced by a match (ON DELETE RESTRICT)', async () => {
    const client = fakeClient({
      tables: { btc_teams: { data: null, error: { code: '23503', message: 'FK violation' } } },
    });
    await expect(removeTeam('t1', client)).rejects.toMatchObject({ code: '23503' });
  });
});
