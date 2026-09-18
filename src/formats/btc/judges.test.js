import { describe, it, expect } from 'vitest';
import { listJudges, findJudgeByName, createJudge, removeJudge } from './judges.js';

// Same fakeClient shape as teams.test.js / cup-taster/setup.test.js.
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

describe('listJudges', () => {
  it('lists judges for an event, ordered by name', async () => {
    const judges = [
      { id: 'j1', event_id: 'e1', name: 'Alex' },
      { id: 'j2', event_id: 'e1', name: 'Jordan' },
    ];
    const client = fakeClient({ tables: { btc_judges: { data: judges, error: null } } });
    const result = await listJudges('e1', client);
    expect(result).toEqual(judges);
    expect(client.calls).toContainEqual(['order', 'btc_judges', 'name', { ascending: true }]);
  });

  it('throws the raw error on a failed read', async () => {
    const client = fakeClient({
      tables: { btc_judges: { data: null, error: new Error('read failed') } },
    });
    await expect(listJudges('e1', client)).rejects.toThrow('read failed');
  });
});

describe('findJudgeByName', () => {
  it('returns null when no judge matches', async () => {
    const client = fakeClient({ tables: { btc_judges: { data: null, error: null } } });
    expect(await findJudgeByName('e1', 'Nobody', client)).toBeNull();
  });
});

describe('createJudge', () => {
  it('inserts a new judge and returns it', async () => {
    const created = { id: 'j1', event_id: 'e1', name: 'Alex' };
    const client = fakeClient({ tables: { btc_judges: { data: created, error: null } } });
    const result = await createJudge('e1', 'Alex', client);
    expect(result).toEqual(created);
    expect(client.calls).toContainEqual(['insert', 'btc_judges', { event_id: 'e1', name: 'Alex' }]);
  });

  it('recovers from a unique-violation by returning the existing row, not throwing', async () => {
    const existing = { id: 'j1', event_id: 'e1', name: 'Alex' };
    const client = fakeClient({
      tables: {
        btc_judges: [
          { data: null, error: { code: '23505', message: 'duplicate' } },
          { data: existing, error: null },
        ],
      },
    });
    const result = await createJudge('e1', 'Alex', client);
    expect(result).toEqual(existing);
  });

  it('re-throws a unique-violation if the recovery read finds no matching row', async () => {
    const client = fakeClient({
      tables: {
        btc_judges: [
          { data: null, error: { code: '23505', message: 'duplicate' } },
          { data: null, error: null },
        ],
      },
    });
    await expect(createJudge('e1', 'Alex', client)).rejects.toMatchObject({ code: '23505' });
  });

  it('throws a non-unique-violation error without attempting recovery', async () => {
    const client = fakeClient({
      tables: {
        btc_judges: { data: null, error: { code: '42501', message: 'permission denied' } },
      },
    });
    await expect(createJudge('e1', 'Alex', client)).rejects.toMatchObject({ code: '42501' });
    // findJudgeByName is the only path that ever calls .eq() — its absence
    // proves recovery was never attempted for a non-23505 error.
    expect(client.calls.filter(([op]) => op === 'eq')).toHaveLength(0);
  });
});

describe('removeJudge', () => {
  it('deletes the judge by id', async () => {
    const client = fakeClient({ tables: { btc_judges: { data: null, error: null } } });
    await removeJudge('j1', client);
    expect(client.calls).toContainEqual(['delete', 'btc_judges']);
    expect(client.calls).toContainEqual(['eq', 'btc_judges', 'id', 'j1']);
  });

  it('throws when the judge is still assigned to a match (ON DELETE RESTRICT)', async () => {
    const client = fakeClient({
      tables: { btc_judges: { data: null, error: { code: '23503', message: 'FK violation' } } },
    });
    await expect(removeJudge('j1', client)).rejects.toMatchObject({ code: '23503' });
  });
});
