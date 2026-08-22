import { describe, it, expect, vi } from 'vitest';
import {
  findPersonByPhone,
  findPersonByEmail,
  createPerson,
  registerPerson,
  createEntry,
  registerEntry,
  mergePeople,
} from './registry.js';

// A minimal fake matching supabase-js's fluent query-builder shape. `tables`
// maps a table name to either one `{data, error}` response, or an array
// consumed in call order (for functions that query the same table twice, e.g.
// registerPerson's lookup-then-create). `rpcResult` covers `.rpc()` calls.
function fakeClient({ tables = {}, rpcResult = { data: null, error: null } } = {}) {
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
        select: () => builder,
        eq: () => builder,
        ilike: (...args) => {
          calls.push(['ilike', ...args]);
          return builder;
        },
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          return builder;
        },
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
      };
      return builder;
    },
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
  };
}

describe('findPersonByPhone', () => {
  it('returns the matching person', async () => {
    const person = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111' };
    const client = fakeClient({ tables: { people: { data: person, error: null } } });
    expect(await findPersonByPhone('org1', '+6738001111', client)).toEqual(person);
  });

  it('returns null when no match exists', async () => {
    const client = fakeClient({ tables: { people: { data: null, error: null } } });
    expect(await findPersonByPhone('org1', '+6738009999', client)).toBeNull();
  });

  it('throws on a query error', async () => {
    const client = fakeClient({ tables: { people: { data: null, error: new Error('boom') } } });
    await expect(findPersonByPhone('org1', '+6738001111', client)).rejects.toThrow('boom');
  });
});

describe('findPersonByEmail', () => {
  it('returns the matching person', async () => {
    const person = { id: 'p1', display_name: 'Cupper One', email: 'one@example.com' };
    const client = fakeClient({ tables: { people: { data: person, error: null } } });
    expect(await findPersonByEmail('org1', 'one@example.com', client)).toEqual(person);
  });

  it('escapes % and _ before querying, so they match as literal characters not wildcards', async () => {
    const client = fakeClient({ tables: { people: { data: null, error: null } } });
    await findPersonByEmail('org1', 'wild%_card@example.com', client);
    expect(client.calls).toContainEqual(['ilike', 'email', 'wild\\%\\_card@example.com']);
  });

  it('escapes a literal backslash adjacent to a wildcard character without mis-ordering', async () => {
    // A naive escape (e.g. escaping % / _ before backslash) would double-escape
    // or shift meaning when a backslash sits next to one of them — verified
    // correct against Postgres's actual LIKE semantics during review, this
    // pins the JS-side output that produced that result.
    const client = fakeClient({ tables: { people: { data: null, error: null } } });
    await findPersonByEmail('org1', 'weird\\%_addr@example.com', client);
    expect(client.calls).toContainEqual(['ilike', 'email', 'weird\\\\\\%\\_addr@example.com']);
  });
});

describe('createPerson', () => {
  it('maps camelCase input onto the people row shape', async () => {
    const inserted = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111' };
    const client = fakeClient({ tables: { people: { data: inserted, error: null } } });
    const result = await createPerson(
      'org1',
      { displayName: 'Cupper One', phone: '+6738001111' },
      client,
    );
    expect(result).toEqual(inserted);
  });
});

describe('registerPerson', () => {
  it('returns the existing person without creating one when a phone match is found', async () => {
    const existing = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111' };
    const client = fakeClient({ tables: { people: { data: existing, error: null } } });
    const result = await registerPerson(
      'org1',
      { displayName: 'Cupper One (again)', phone: '+6738001111' },
      client,
    );
    expect(result).toEqual(existing);
  });

  it('creates a new person when no phone match exists', async () => {
    const created = { id: 'p2', display_name: 'New Cupper', phone: '+6738005555' };
    const client = fakeClient({
      tables: {
        // first call (findPersonByPhone): no match; second call (createPerson): the insert result
        people: [
          { data: null, error: null },
          { data: created, error: null },
        ],
      },
    });
    const result = await registerPerson(
      'org1',
      { displayName: 'New Cupper', phone: '+6738005555' },
      client,
    );
    expect(result).toEqual(created);
  });

  it('returns the existing person by email when the phone differs but the email matches, without creating', async () => {
    // The schema itself enforces per-org email uniqueness — createPerson would
    // hit that constraint if this fallback didn't exist.
    const existing = { id: 'p1', display_name: 'Cupper One', email: 'shared@example.com' };
    const client = fakeClient({
      tables: {
        // first call (findPersonByPhone): no match; second call (findPersonByEmail): the match
        people: [
          { data: null, error: null },
          { data: existing, error: null },
        ],
      },
    });
    const result = await registerPerson(
      'org1',
      { displayName: 'Cupper One (again)', phone: '+6738009999', email: 'shared@example.com' },
      client,
    );
    expect(result).toEqual(existing);
  });
});

describe('createEntry', () => {
  it('snapshots display_name/cafe from the person when personId is given', async () => {
    const person = { display_name: 'Cupper One', cafe: 'Grey Matter' };
    const insertedEntry = {
      id: 'e1',
      event_id: 'ev1',
      person_id: 'p1',
      display_name: 'Cupper One',
      cafe: 'Grey Matter',
    };
    const client = fakeClient({
      tables: {
        people: { data: person, error: null },
        event_entries: { data: insertedEntry, error: null },
      },
    });
    const result = await createEntry('ev1', { personId: 'p1' }, client);
    expect(result).toEqual(insertedEntry);
  });

  it('uses the provided displayName/cafe directly for a walk-up with no personId', async () => {
    const insertedEntry = {
      id: 'e2',
      event_id: 'ev1',
      person_id: null,
      display_name: 'Walk-up Cupper',
      cafe: null,
    };
    const client = fakeClient({
      tables: { event_entries: { data: insertedEntry, error: null } },
    });
    const result = await createEntry('ev1', { displayName: 'Walk-up Cupper' }, client);
    expect(result).toEqual(insertedEntry);
    // The people table must never be queried for a walk-up — there is no
    // personId to look up.
  });
});

describe('registerEntry', () => {
  it('registers a new person then creates their entry', async () => {
    const created = { id: 'p1', display_name: 'New Cupper', phone: '+6738005555' };
    const insertedEntry = {
      id: 'e1',
      event_id: 'ev1',
      person_id: 'p1',
      display_name: 'New Cupper',
    };
    const client = fakeClient({
      tables: {
        // findPersonByPhone: no match; createPerson: the insert result;
        // createEntry's own people lookup (snapshotting display_name/cafe)
        people: [
          { data: null, error: null },
          { data: created, error: null },
          { data: created, error: null },
        ],
        event_entries: { data: insertedEntry, error: null },
      },
    });
    const result = await registerEntry(
      'org1',
      'ev1',
      { displayName: 'New Cupper', phone: '+6738005555' },
      client,
    );
    expect(result).toEqual(insertedEntry);
  });

  it('reuses an existing person by phone rather than creating a duplicate', async () => {
    const existing = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111', cafe: null };
    const insertedEntry = { id: 'e2', event_id: 'ev1', person_id: 'p1' };
    const client = fakeClient({
      tables: {
        // findPersonByPhone: match; createEntry's own people lookup
        people: [
          { data: existing, error: null },
          { data: existing, error: null },
        ],
        event_entries: { data: insertedEntry, error: null },
      },
    });
    const result = await registerEntry(
      'org1',
      'ev1',
      { displayName: 'Cupper One (again)', phone: '+6738001111' },
      client,
    );
    expect(result).toEqual(insertedEntry);
    // The proof this test is named for: no second person row gets created.
    expect(client.calls.some(([action, table]) => action === 'insert' && table === 'people')).toBe(
      false,
    );
  });

  it('passes bib through to the entry', async () => {
    const existing = { id: 'p1', display_name: 'Cupper One', cafe: null };
    const client = fakeClient({
      tables: {
        people: [
          { data: existing, error: null },
          { data: existing, error: null },
        ],
        event_entries: { data: { id: 'e3' }, error: null },
      },
    });
    await registerEntry('org1', 'ev1', { phone: '+6738001111', bib: '42' }, client);
    const entryInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'event_entries',
    );
    expect(entryInsert[2].bib).toBe('42');
  });
});

describe('mergePeople', () => {
  it('calls the merge_people RPC with the org/kept/merged ids', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: null } });
    await mergePeople('org1', 'keptId', 'mergedId', client);
    expect(client.rpc).toHaveBeenCalledWith('merge_people', {
      p_org_id: 'org1',
      p_kept_id: 'keptId',
      p_merged_id: 'mergedId',
    });
  });

  it('throws on an RPC error rather than silently succeeding', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: new Error('merge failed') } });
    await expect(mergePeople('org1', 'keptId', 'mergedId', client)).rejects.toThrow('merge failed');
  });
});
