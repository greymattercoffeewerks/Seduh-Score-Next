import { describe, expect, it, vi } from 'vitest';
import {
  findActiveLiveEventId,
  findLiveElsewhere,
  LIVE_CHECK_TIMEOUT_MS,
  takeOverWarning,
} from './publish.js';

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

// A client whose live_sessions read and events read answer from the given rows.
function tenancyClient({ live, events = {}, failEvents = false, failLive = false }) {
  return {
    from(table) {
      const state = { table, filters: {} };
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          state.filters[column] = value;
          return query;
        },
        maybeSingle() {
          if (failLive)
            return Promise.resolve({ data: null, error: new Error('live read failed') });
          return Promise.resolve({ data: live ? { event_id: live } : null, error: null });
        },
        single() {
          if (failEvents)
            return Promise.resolve({ data: null, error: new Error('events read failed') });
          const row = events[state.filters.id];
          return Promise.resolve(
            row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } },
          );
        },
      };
      return query;
    },
  };
}

describe('findLiveElsewhere', () => {
  const events = { live1: { id: 'live1', name: 'Real Night', is_test: false } };

  it('names the other event when it is the live one', async () => {
    await expect(
      findLiveElsewhere('org1', 'mine', tenancyClient({ live: 'live1', events })),
    ).resolves.toEqual({
      eventId: 'live1',
      name: 'Real Night',
      isTest: false,
    });
  });

  it('says whether the live event is a test event', async () => {
    const client = tenancyClient({
      live: 'live1',
      events: { live1: { name: 'Practice', is_test: true } },
    });
    expect((await findLiveElsewhere('org1', 'mine', client)).isTest).toBe(true);
  });

  it('has nothing to warn about when this event is already the live one', async () => {
    await expect(
      findLiveElsewhere('org1', 'live1', tenancyClient({ live: 'live1', events })),
    ).resolves.toBeNull();
  });

  it('has nothing to warn about when nothing is live', async () => {
    await expect(
      findLiveElsewhere('org1', 'mine', tenancyClient({ live: null, events })),
    ).resolves.toBeNull();
  });

  it('fails open, so an unreachable database never blocks a start', async () => {
    await expect(
      findLiveElsewhere('org1', 'mine', tenancyClient({ failLive: true })),
    ).resolves.toBeNull();
    await expect(
      findLiveElsewhere('org1', 'mine', tenancyClient({ live: 'live1', events, failEvents: true })),
    ).resolves.toBeNull();
  });

  it('gives up after a couple of seconds on a request that never answers, rather than holding up a start', async () => {
    vi.useFakeTimers();
    try {
      const hung = {
        from() {
          const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: () => new Promise(() => {}),
          };
          return query;
        },
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const answer = findLiveElsewhere('org1', 'mine', hung);
      await vi.advanceTimersByTimeAsync(LIVE_CHECK_TIMEOUT_MS + 10);
      await expect(answer).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks about the organisation it was given', async () => {
    const calls = [];
    const client = liveSessionClient({ data: null, error: null }, calls);
    await findLiveElsewhere('orgX', 'mine', client);
    expect(calls).toContainEqual(['eq', 'org_id', 'orgX']);
  });
});

describe('takeOverWarning', () => {
  it('says plainly that a test event is about to replace a real one', () => {
    expect(
      takeOverWarning({ name: 'Practice', isTest: true }, { name: 'Real Night', isTest: false }),
    ).toBe(
      'This is a test event, and “Real Night” is on the venue screens. Continuing will replace it with this test event.',
    );
  });

  it('otherwise names the event that will be replaced', () => {
    expect(takeOverWarning({ name: 'B', isTest: false }, { name: 'A', isTest: false })).toBe(
      '“A” is on the venue screens. Continuing will put this event there instead.',
    );
    expect(takeOverWarning({ name: 'B', isTest: true }, { name: 'A', isTest: true })).toBe(
      '“A” is on the venue screens. Continuing will put this event there instead.',
    );
  });

  it('still reads sensibly when the other event has no name', () => {
    expect(takeOverWarning({ name: 'B', isTest: false }, { name: '', isTest: false })).toBe(
      'Another event is on the venue screens. Continuing will put this event there instead.',
    );
  });
});
