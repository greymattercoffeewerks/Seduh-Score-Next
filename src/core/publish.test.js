import { describe, expect, it } from 'vitest';
import { findActiveLiveEventId } from './publish.js';

function liveSessionClient(result, calls) {
  const query = {
    select(columns) {
      calls.push(['select', columns]);
      return query;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return query;
    },
    maybeSingle() {
      calls.push(['maybeSingle']);
      return Promise.resolve(result);
    },
  };
  return {
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  };
}

describe('findActiveLiveEventId', () => {
  it('returns the active event for the requested org', async () => {
    const calls = [];
    const eventId = await findActiveLiveEventId(
      'org1',
      liveSessionClient({ data: { event_id: 'event1' }, error: null }, calls),
    );

    expect(eventId).toBe('event1');
    expect(calls).toEqual([
      ['from', 'live_sessions'],
      ['select', 'event_id'],
      ['eq', 'org_id', 'org1'],
      ['eq', 'active', true],
      ['maybeSingle'],
    ]);
  });

  it('returns null when the org has no active event', async () => {
    await expect(
      findActiveLiveEventId('org1', liveSessionClient({ data: null, error: null }, [])),
    ).resolves.toBeNull();
  });

  it('propagates a failed active-session lookup', async () => {
    const error = new Error('read failed');
    await expect(
      findActiveLiveEventId('org1', liveSessionClient({ data: null, error }, [])),
    ).rejects.toBe(error);
  });
});
