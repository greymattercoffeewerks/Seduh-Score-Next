import { describe, it, expect } from 'vitest';
import {
  createEvent,
  findEvent,
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
        select: () => builder,
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

  it('passes eventDate/venue/isTest/config through when given', async () => {
    const client = fakeClient({ data: { id: 'ev4' }, error: null });
    await createEvent(
      'org1',
      {
        format: 'cup_taster',
        name: 'Test Run',
        eventDate: '2026-10-04',
        venue: 'Grey Matter HQ',
        isTest: true,
        config: { theme: 'dark' },
      },
      client,
    );
    const [, , payload] = client.calls[0];
    expect(payload.event_date).toBe('2026-10-04');
    expect(payload.venue).toBe('Grey Matter HQ');
    expect(payload.is_test).toBe(true);
    expect(payload.config).toEqual({ theme: 'dark' });
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

describe('findLatestEventForOrg', () => {
  it('returns the matching event', async () => {
    const event = { id: 'ev1', org_id: 'org1', name: 'October Cup' };
    const client = fakeClient({ data: event, error: null });
    expect(await findLatestEventForOrg('org1', client)).toEqual(event);
    expect(client.calls).toContainEqual(['eq', 'org_id', 'org1']);
    expect(client.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(client.calls).toContainEqual(['limit', 1]);
  });

  it('returns null, not a thrown error, when the org has no events yet', async () => {
    const client = fakeClient({ data: null, error: null });
    expect(await findLatestEventForOrg('org1', client)).toBeNull();
  });

  it('throws on a real query error', async () => {
    const client = fakeClient({ data: null, error: new Error('connection refused') });
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
