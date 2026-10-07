import { describe, it, expect, vi } from 'vitest';
import {
  findPersonByPhone,
  findPersonByEmail,
  createPerson,
  registerPerson,
  createEntry,
  findEntryForPerson,
  registerEntry,
  setEntryWithdrawn,
  listEntries,
  listEntriesByIds,
  listPeopleByIds,
  updateRosterEntry,
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
        in: (...args) => {
          calls.push(['in', ...args]);
          return builder;
        },
        ilike: (...args) => {
          calls.push(['ilike', ...args]);
          return builder;
        },
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          return builder;
        },
        update: (payload) => {
          calls.push(['update', table, payload]);
          return builder;
        },
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
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

describe('findEntryForPerson', () => {
  it('returns the matching entry', async () => {
    const entry = { id: 'e1', event_id: 'ev1', person_id: 'p1' };
    const client = fakeClient({ tables: { event_entries: { data: entry, error: null } } });
    expect(await findEntryForPerson('ev1', 'p1', client)).toEqual(entry);
  });

  it('returns null when no match exists', async () => {
    const client = fakeClient({ tables: { event_entries: { data: null, error: null } } });
    expect(await findEntryForPerson('ev1', 'p1', client)).toBeNull();
  });

  it('throws on a query error', async () => {
    const client = fakeClient({
      tables: { event_entries: { data: null, error: new Error('boom') } },
    });
    await expect(findEntryForPerson('ev1', 'p1', client)).rejects.toThrow('boom');
  });
});

describe('setEntryWithdrawn', () => {
  it('updates the entry withdrawn flag and returns the updated row', async () => {
    const updated = { id: 'e1', event_id: 'ev1', withdrawn: true };
    const client = fakeClient({ tables: { event_entries: { data: updated, error: null } } });
    expect(await setEntryWithdrawn('e1', true, client)).toEqual(updated);
  });

  it('throws on a query error', async () => {
    const client = fakeClient({
      tables: { event_entries: { data: null, error: new Error('boom') } },
    });
    await expect(setEntryWithdrawn('e1', true, client)).rejects.toThrow('boom');
  });
});

describe('listEntries', () => {
  it('returns every entry for the event', async () => {
    const entries = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: true },
    ];
    const client = fakeClient({ tables: { event_entries: { data: entries, error: null } } });
    expect(await listEntries('ev1', client)).toEqual(entries);
  });

  it('returns an empty array when the event has no entries', async () => {
    const client = fakeClient({ tables: { event_entries: { data: [], error: null } } });
    expect(await listEntries('ev1', client)).toEqual([]);
  });

  it('throws on a query error', async () => {
    const client = fakeClient({
      tables: { event_entries: { data: null, error: new Error('boom') } },
    });
    await expect(listEntries('ev1', client)).rejects.toThrow('boom');
  });
});

describe('listEntriesByIds', () => {
  it('returns the matching entries', async () => {
    const entries = [{ id: 'e1', display_name: 'Cupper One' }];
    const client = fakeClient({ tables: { event_entries: { data: entries, error: null } } });
    expect(await listEntriesByIds(['e1'], client)).toEqual(entries);
    expect(client.calls).toContainEqual(['in', 'id', ['e1']]);
  });

  it('returns an empty array without querying at all when given no ids', async () => {
    const client = fakeClient({ tables: { event_entries: { data: [], error: null } } });
    expect(await listEntriesByIds([], client)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it('throws on a query error', async () => {
    const client = fakeClient({
      tables: { event_entries: { data: null, error: new Error('boom') } },
    });
    await expect(listEntriesByIds(['e1'], client)).rejects.toThrow('boom');
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
        // findEntryForPerson: no existing entry; createEntry: the insert result
        event_entries: [
          { data: null, error: null },
          { data: insertedEntry, error: null },
        ],
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
        // findEntryForPerson: no existing entry; createEntry: the insert result
        event_entries: [
          { data: null, error: null },
          { data: insertedEntry, error: null },
        ],
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

  it('returns the existing entry without creating a duplicate when the person is already registered for this event', async () => {
    // A double-tap of a registration button, or a re-submit after a dropped
    // response the write actually reached — event_entries has a real unique
    // index on (event_id, person_id), so without this check the second call
    // would surface that constraint as a raw error instead of the existing row.
    const existing = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111', cafe: null };
    const existingEntry = { id: 'e2', event_id: 'ev1', person_id: 'p1' };
    const client = fakeClient({
      tables: {
        people: { data: existing, error: null },
        event_entries: { data: existingEntry, error: null },
      },
    });
    const result = await registerEntry(
      'org1',
      'ev1',
      { displayName: 'Cupper One (again)', phone: '+6738001111' },
      client,
    );
    expect(result).toEqual(existingEntry);
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'event_entries'),
    ).toBe(false);
  });

  it('adopts the winner rather than surfacing a raw error when a concurrent caller wins the race to register the same person for this event', async () => {
    // Two devices registering the same phone number at once: both pass the
    // pre-check (findEntryForPerson returns null for both), then one's
    // insert wins and the other's hits the real unique index on
    // (event_id, person_id) as a 23505. Same recovery shape as setup.js's
    // createStage — the loser adopts the winner's row instead of surfacing
    // the raw constraint violation.
    const existing = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111', cafe: null };
    const racedEntry = { id: 'e1', event_id: 'ev1', person_id: 'p1' };
    const client = fakeClient({
      tables: {
        // findPersonByPhone: match; createEntry's own people lookup
        people: [
          { data: existing, error: null },
          { data: existing, error: null },
        ],
        event_entries: [
          // findEntryForPerson (pre-check): no match yet
          { data: null, error: null },
          // createEntry's insert: lost the race
          { data: null, error: { code: '23505', message: 'duplicate key' } },
          // findEntryForPerson (post-race retry): the winner's row
          { data: racedEntry, error: null },
        ],
      },
    });
    const result = await registerEntry(
      'org1',
      'ev1',
      { displayName: 'Cupper One (again)', phone: '+6738001111' },
      client,
    );
    expect(result).toEqual(racedEntry);
  });

  it('rethrows a non-unique-violation error from the insert rather than masking it as a race', async () => {
    const existing = { id: 'p1', display_name: 'Cupper One', phone: '+6738001111', cafe: null };
    const client = fakeClient({
      tables: {
        people: [
          { data: existing, error: null },
          { data: existing, error: null },
        ],
        event_entries: [
          { data: null, error: null },
          { data: null, error: new Error('network unreachable') },
        ],
      },
    });
    await expect(
      registerEntry('org1', 'ev1', { displayName: 'Cupper One', phone: '+6738001111' }, client),
    ).rejects.toThrow('network unreachable');
  });

  it('passes bib through to the entry', async () => {
    const existing = { id: 'p1', display_name: 'Cupper One', cafe: null };
    const client = fakeClient({
      tables: {
        people: [
          { data: existing, error: null },
          { data: existing, error: null },
        ],
        event_entries: [
          { data: null, error: null },
          { data: { id: 'e3' }, error: null },
        ],
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

describe('listPeopleByIds', () => {
  it('returns the matching people', async () => {
    const people = [{ id: 'p1', display_name: 'Alice', phone: '+6737000001' }];
    const client = fakeClient({ tables: { people: { data: people, error: null } } });
    expect(await listPeopleByIds(['p1'], client)).toEqual(people);
    expect(client.calls).toContainEqual(['in', 'id', ['p1']]);
  });

  it('returns an empty array without querying at all when given no ids', async () => {
    const client = fakeClient({ tables: { people: { data: [], error: null } } });
    expect(await listPeopleByIds([], client)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it('throws on a query error', async () => {
    const client = fakeClient({ tables: { people: { data: null, error: new Error('boom') } } });
    await expect(listPeopleByIds(['p1'], client)).rejects.toThrow('boom');
  });

  it('asks in chunks of 100 ids, so a large roster never overflows the request URL, and joins the pages', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const client = fakeClient({
      tables: {
        people: [
          { data: [{ id: 'p0' }], error: null },
          { data: [{ id: 'p100' }], error: null },
          { data: [{ id: 'p200' }], error: null },
        ],
      },
    });
    expect(await listPeopleByIds(ids, client)).toEqual([
      { id: 'p0' },
      { id: 'p100' },
      { id: 'p200' },
    ]);
    const asked = client.calls.filter((c) => c[0] === 'in').map((c) => c[2]);
    expect(asked.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(asked.flat()).toEqual(ids); // every id asked for exactly once, in order
  });
});

describe('updateRosterEntry', () => {
  const fields = {
    displayName: 'Alicia Tan',
    phone: '+6737000009',
    email: 'alicia@example.com',
    cafe: 'New Cafe',
    bib: '7',
  };

  it('calls the update_roster_entry RPC once, with every field under its parameter name', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: null } });
    await updateRosterEntry('org1', 'entry1', fields, client);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('update_roster_entry', {
      p_org_id: 'org1',
      p_entry_id: 'entry1',
      p_display_name: 'Alicia Tan',
      p_phone: '+6737000009',
      p_email: 'alicia@example.com',
      p_cafe: 'New Cafe',
      p_bib: '7',
    });
  });

  it('sends null, not undefined, for a field that is left out — a walk-up entry has no phone or email', async () => {
    const client = fakeClient({ rpcResult: { data: null, error: null } });
    await updateRosterEntry('org1', 'entry1', { displayName: 'Walk Up' }, client);
    expect(client.rpc.mock.calls[0][1]).toEqual({
      p_org_id: 'org1',
      p_entry_id: 'entry1',
      p_display_name: 'Walk Up',
      p_phone: null,
      p_email: null,
      p_cafe: null,
      p_bib: null,
    });
  });

  it('throws the RPC error itself, so a caller can read its code and details', async () => {
    const error = Object.assign(new Error('CONFLICT'), {
      code: 'P0002',
      details: '{"field":"phone"}',
    });
    const client = fakeClient({ rpcResult: { data: null, error } });
    await expect(updateRosterEntry('org1', 'entry1', fields, client)).rejects.toBe(error);
  });
});
