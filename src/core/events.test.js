import { describe, it, expect } from 'vitest';
import {
  createEvent,
  findEvent,
  findEventOrgId,
  findLatestEventForOrg,
  listEventsForOrg,
  deleteTestEvent,
} from './events.js';

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    from(table) {
      const builder = {
        insert: (payload) => {
          calls.push(['insert', table, payload]);
          return builder;
        },
        select: (...args) => {
          calls.push(['select', table, ...args]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', ...args]);
          return builder;
        },
        limit: (...args) => {
          calls.push(['limit', ...args]);
          return builder;
        },
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
}

describe('createEvent', () => {
  it('creates a cup_taster event', async () => {
    const created = { id: 'ev1', format: 'cup_taster', name: 'October Cup' };
    const client = fakeClient({ data: created, error: null });
    const result = await createEvent('org1', { format: 'cup_taster', name: 'October Cup' }, client);
    expect(result).toEqual(created);
  });

  it('creates a guess_the_bean event with the same call shape — proving format-agnostic reuse', async () => {
    const created = { id: 'ev2', format: 'guess_the_bean', name: 'Coffee Con Booth' };
    const client = fakeClient({ data: created, error: null });
    const result = await createEvent(
      'org1',
      { format: 'guess_the_bean', name: 'Coffee Con Booth' },
      client,
    );
    expect(result).toEqual(created);
  });

  it('defaults isTest to false and config to an empty object', async () => {
    const client = fakeClient({ data: { id: 'ev3' }, error: null });
    await createEvent('org1', { format: 'cup_taster', name: 'Untested Event' }, client);
    const [, , payload] = client.calls[0];
    expect(payload.is_test).toBe(false);
    expect(payload.config).toEqual({});
  });

  it('passes eventDate/venue/city/isTest/config through when given', async () => {
    const client = fakeClient({ data: { id: 'ev4' }, error: null });
    await createEvent(
      'org1',
      {
        format: 'cup_taster',
        name: 'Test Run',
        eventDate: '2026-10-04',
        venue: 'Grey Matter HQ',
        city: 'Bandar Seri Begawan',
        isTest: true,
        config: { theme: 'dark' },
      },
      client,
    );
    const [, , payload] = client.calls[0];
    expect(payload.event_date).toBe('2026-10-04');
    expect(payload.venue).toBe('Grey Matter HQ');
    expect(payload.city).toBe('Bandar Seri Begawan');
    expect(payload.is_test).toBe(true);
    expect(payload.config).toEqual({ theme: 'dark' });
  });

  it('defaults city to null when not given', async () => {
    const client = fakeClient({ data: { id: 'ev5' }, error: null });
    await createEvent('org1', { format: 'cup_taster', name: 'No City Event' }, client);
    const [, , payload] = client.calls[0];
    expect(payload.city).toBeNull();
  });

  it('throws on an insert error rather than silently succeeding', async () => {
    const client = fakeClient({ data: null, error: new Error('insert failed') });
    await expect(
      createEvent('org1', { format: 'cup_taster', name: 'Broken' }, client),
    ).rejects.toThrow('insert failed');
  });
});

describe('findEvent', () => {
  it('returns the matching event', async () => {
    const event = { id: 'ev1', name: 'October Cup', is_test: false };
    const client = fakeClient({ data: event, error: null });
    expect(await findEvent('ev1', client)).toEqual(event);
    expect(client.calls).toContainEqual(['eq', 'id', 'ev1']);
  });

  it('throws on a query error', async () => {
    const client = fakeClient({ data: null, error: new Error('not found') });
    await expect(findEvent('missing', client)).rejects.toThrow('not found');
  });
});

describe('findEventOrgId (T-TEN.C7)', () => {
  it('returns the organisation the event belongs to, reading only that column', async () => {
    const client = fakeClient({ data: { org_id: 'org2' }, error: null });
    expect(await findEventOrgId('ev1', client)).toBe('org2');
    expect(client.calls).toContainEqual(['select', 'events', 'org_id']);
    expect(client.calls).toContainEqual(['eq', 'id', 'ev1']);
  });

  it('returns null, not an error, when there is no such event (or it cannot be seen)', async () => {
    const client = fakeClient({ data: null, error: null });
    expect(await findEventOrgId('ev1', client)).toBeNull();
  });

  it('throws on a failed read: that says nothing about whether the event exists', async () => {
    const client = fakeClient({ data: null, error: new Error('offline') });
    await expect(findEventOrgId('ev1', client)).rejects.toThrow('offline');
  });
});

describe('findLatestEventForOrg', () => {
  function rpcClient(response) {
    const calls = [];
    return {
      calls,
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve(response);
      },
      from: () => {
        throw new Error('findLatestEventForOrg must not read a table');
      },
    };
  }

  it('asks the narrow public_event_summary door for that organisation, and returns its one row', async () => {
    const event = { id: 'ev1', name: 'October Cup', event_date: '2026-10-01', is_test: false };
    const client = rpcClient({ data: [event], error: null });
    expect(await findLatestEventForOrg('org1', client)).toEqual(event);
    expect(client.calls).toEqual([['public_event_summary', { p_org_id: 'org1' }]]);
  });

  it('passes each organisation id through unchanged', async () => {
    const client = rpcClient({ data: [], error: null });
    await findLatestEventForOrg('org-a', client);
    await findLatestEventForOrg('org-b', client);
    expect(client.calls.map(([, args]) => args.p_org_id)).toEqual(['org-a', 'org-b']);
  });

  it('hands back the row as the function returned it: id, name, date and test flag only', async () => {
    const row = { id: 'ev1', name: 'October Cup', event_date: null, is_test: false };
    const result = await findLatestEventForOrg('org1', rpcClient({ data: [row], error: null }));
    expect(Object.keys(result).sort()).toEqual(['event_date', 'id', 'is_test', 'name']);
  });

  it('returns only the first row if more than one comes back', async () => {
    const client = rpcClient({ data: [{ id: 'new' }, { id: 'old' }], error: null });
    expect(await findLatestEventForOrg('org1', client)).toEqual({ id: 'new' });
  });

  it('returns null, not a thrown error, when the org has no events yet', async () => {
    expect(await findLatestEventForOrg('org1', rpcClient({ data: [], error: null }))).toBeNull();
  });

  it('throws for an answer that is not a list of rows: that is a failure to ask, never "no event"', async () => {
    for (const data of [null, undefined, {}, 'x']) {
      await expect(findLatestEventForOrg('org1', rpcClient({ data, error: null }))).rejects.toThrow(
        'unexpected response',
      );
    }
  });

  it('throws on a real error, so the caller can tell "could not ask" from "no event"', async () => {
    const client = rpcClient({ data: null, error: new Error('connection refused') });
    await expect(findLatestEventForOrg('org1', client)).rejects.toThrow('connection refused');
  });
});

describe('listEventsForOrg', () => {
  it('returns every event for the org, newest first per the query', async () => {
    const events = [
      { id: 'ev2', org_id: 'org1', name: 'Newer' },
      { id: 'ev1', org_id: 'org1', name: 'Older' },
    ];
    const client = fakeClient({ data: events, error: null });
    expect(await listEventsForOrg('org1', client)).toEqual(events);
    expect(client.calls).toContainEqual(['eq', 'org_id', 'org1']);
    expect(client.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    // Unlike findLatestEventForOrg, no .limit(1) — this is the "give me
    // everything" query, not the "give me just the most recent one" query.
    expect(client.calls.some(([action]) => action === 'limit')).toBe(false);
  });

  it('returns an empty array, not null, when the org has no events yet', async () => {
    const client = fakeClient({ data: [], error: null });
    expect(await listEventsForOrg('org1', client)).toEqual([]);
  });

  it('throws on a real query error', async () => {
    const client = fakeClient({ data: null, error: new Error('connection refused') });
    await expect(listEventsForOrg('org1', client)).rejects.toThrow('connection refused');
  });
});

describe('deleteTestEvent', () => {
  function fakeRpcClient(response) {
    const calls = [];
    return {
      calls,
      rpc: (name, payload) => {
        calls.push([name, payload]);
        return Promise.resolve(response);
      },
    };
  }

  it('calls the delete_test_event RPC with org and event id as p_org_id/p_event_id', async () => {
    const client = fakeRpcClient({ data: null, error: null });
    await deleteTestEvent('org1', 'ev1', client);
    expect(client.calls).toEqual([['delete_test_event', { p_org_id: 'org1', p_event_id: 'ev1' }]]);
  });

  it('throws on an RPC error rather than silently succeeding — e.g. the server-side refusal to delete a non-test event', async () => {
    const client = fakeRpcClient({
      data: null,
      error: new Error('delete_test_event: refusing to delete a non-test event (ev2)'),
    });
    await expect(deleteTestEvent('org1', 'ev2', client)).rejects.toThrow(
      'refusing to delete a non-test event',
    );
  });
});

describe('the organisation id is the one given, at the module layer (T-TEN.C5)', () => {
  it('createEvent inserts under the organisation it is given', async () => {
    const client = fakeClient({ data: { id: 'ev9' }, error: null });
    await createEvent('org-xyz', { format: 'cup_taster', name: 'Cup' }, client);
    const insert = client.calls.find(([kind]) => kind === 'insert');
    expect(insert[2].org_id).toBe('org-xyz');
  });

  it('listEventsForOrg filters on the organisation it is given', async () => {
    const client = fakeClient({ data: [], error: null });
    await listEventsForOrg('org-xyz', client);
    expect(client.calls).toContainEqual(['eq', 'org_id', 'org-xyz']);
  });

  it('deleteTestEvent sends the organisation it is given as p_org_id', async () => {
    const calls = [];
    const client = {
      rpc: (name, payload) => {
        calls.push([name, payload]);
        return Promise.resolve({ error: null });
      },
    };
    await deleteTestEvent('org-xyz', 'ev1', client);
    expect(calls).toEqual([['delete_test_event', { p_org_id: 'org-xyz', p_event_id: 'ev1' }]]);
  });
});
