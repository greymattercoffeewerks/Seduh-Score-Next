import { describe, it, expect } from 'vitest';
import {
  listPublishedResults,
  findLatestPublishedResult,
  publishedOrgName,
  findPublishedResultForEvent,
  publishEventResults,
  unpublishEventResults,
} from './publicResults.js';

function fakeQueryClient(response) {
  const calls = [];
  return {
    calls,
    from(table) {
      const builder = {
        select: (...args) => {
          calls.push(['select', table, ...args]);
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
        limit: (...args) => {
          calls.push(['limit', table, ...args]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(response),
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
}

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

describe('listPublishedResults', () => {
  it('selects event_id/payload/published_at from public_results, ordered newest first', async () => {
    const rows = [{ event_id: 'ev1', payload: {}, published_at: '2026-09-14' }];
    const client = fakeQueryClient({ data: rows, error: null });
    const result = await listPublishedResults(client);
    expect(result).toEqual(rows);
    expect(client.calls).toEqual([
      ['select', 'public_results', 'event_id, payload, published_at'],
      ['order', 'public_results', 'published_at', { ascending: false }],
    ]);
  });

  it('throws on a query error rather than silently returning nothing', async () => {
    const client = fakeQueryClient({ data: null, error: new Error('network error') });
    await expect(listPublishedResults(client)).rejects.toThrow('network error');
  });
});

describe('findLatestPublishedResult', () => {
  it('asks for only the newest row, with only the three public columns', async () => {
    const row = { event_id: 'ev1', payload: {}, published_at: '2026-10-05' };
    const client = fakeQueryClient({ data: row, error: null });
    expect(await findLatestPublishedResult(client)).toEqual(row);
    expect(client.calls).toEqual([
      ['select', 'public_results', 'event_id, payload, published_at'],
      ['order', 'public_results', 'published_at', { ascending: false }],
      ['limit', 'public_results', 1],
    ]);
  });

  it('returns null for an empty archive and throws on an error', async () => {
    expect(
      await findLatestPublishedResult(fakeQueryClient({ data: null, error: null })),
    ).toBeNull();
    await expect(
      findLatestPublishedResult(fakeQueryClient({ data: null, error: new Error('down') })),
    ).rejects.toThrow('down');
  });
});

describe('findPublishedResultForEvent', () => {
  it('returns the row for a published event', async () => {
    const row = {
      event_id: 'ev1',
      payload: { eventName: 'October Cup' },
      published_at: '2026-09-14',
    };
    const client = fakeQueryClient({ data: row, error: null });
    const result = await findPublishedResultForEvent('ev1', client);
    expect(result).toEqual(row);
    expect(client.calls).toContainEqual(['eq', 'public_results', 'event_id', 'ev1']);
  });

  it('returns null (not an error) when the event has never been published — the normal case', async () => {
    const client = fakeQueryClient({ data: null, error: null });
    const result = await findPublishedResultForEvent('ev1', client);
    expect(result).toBeNull();
  });
});

describe('publishEventResults', () => {
  it('calls publish_event_results with org/event id and the payload as p_payload', async () => {
    const client = fakeRpcClient({ data: null, error: null });
    const payload = { eventName: 'October Cup', podium: [] };
    await publishEventResults('org1', 'ev1', payload, client);
    expect(client.calls).toEqual([
      ['publish_event_results', { p_org_id: 'org1', p_event_id: 'ev1', p_payload: payload }],
    ]);
  });

  it('throws on an RPC error rather than silently succeeding — e.g. the server-side refusal to publish a test event', async () => {
    const client = fakeRpcClient({
      data: null,
      error: new Error('publish_event_results: refusing to publish a test event (ev1)'),
    });
    await expect(publishEventResults('org1', 'ev1', {}, client)).rejects.toThrow(
      'refusing to publish a test event',
    );
  });
});

describe('unpublishEventResults', () => {
  it('calls unpublish_event_results with org/event id', async () => {
    const client = fakeRpcClient({ data: null, error: null });
    await unpublishEventResults('org1', 'ev1', client);
    expect(client.calls).toEqual([
      ['unpublish_event_results', { p_org_id: 'org1', p_event_id: 'ev1' }],
    ]);
  });

  it('throws on an RPC error rather than silently succeeding', async () => {
    const client = fakeRpcClient({ data: null, error: new Error('network error') });
    await expect(unpublishEventResults('org1', 'ev1', client)).rejects.toThrow('network error');
  });
});

describe('publishedOrgName (T-TEN.D3)', () => {
  it('returns the organiser name the database stamped into the payload', () => {
    expect(publishedOrgName({ org_name: 'Grey Matter Coffee Werks' })).toBe(
      'Grey Matter Coffee Werks',
    );
  });

  it('trims it, and treats a name of only spaces as no name', () => {
    expect(publishedOrgName({ org_name: '  Alpha Coffee \n' })).toBe('Alpha Coffee');
    expect(publishedOrgName({ org_name: '   ' })).toBeNull();
  });

  it('removes invisible text-direction controls (an unclosed override would reverse what follows)', () => {
    expect(publishedOrgName({ org_name: '\u202EAlpha\u200F Coffee\u2069' })).toBe('Alpha Coffee');
    expect(publishedOrgName({ org_name: '\u202E\u200F' })).toBeNull();
  });

  it('is null for a row published before the name was stamped, or anything that is not text', () => {
    for (const payload of [
      {},
      null,
      undefined,
      { org_name: null },
      { org_name: 7 },
      { org_name: {} },
    ]) {
      expect(publishedOrgName(payload)).toBeNull();
    }
  });

  it('does not touch the letters of the name (the archive shows it as typed)', () => {
    expect(publishedOrgName({ org_name: 'Kopi <b>Seduh</b> & Co' })).toBe('Kopi <b>Seduh</b> & Co');
  });
});
