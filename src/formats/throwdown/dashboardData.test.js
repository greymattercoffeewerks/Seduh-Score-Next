import { describe, it, expect, vi, afterEach } from 'vitest';
import { countQueuedTdOperations, loadThrowdownDashboardData } from './dashboardData.js';
import { TD_OPERATIONS } from './data.js';

// A table-aware fake of the select/eq/order/range/maybeSingle/single chain the reads use.
function fakeClient({ failTable = null, tables = {} } = {}) {
  const rowsOf = (name) => tables[name] ?? [];
  return {
    from(name) {
      const run = () =>
        failTable === name
          ? { data: null, error: new Error(`${name} failed`) }
          : { data: rowsOf(name), error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => Promise.resolve(run()),
        maybeSingle: () => {
          const r = run();
          return Promise.resolve(r.error ? r : { data: r.data[0] ?? null, error: null });
        },
        single: () => {
          const r = run();
          return Promise.resolve(r.error ? r : { data: r.data[0], error: null });
        },
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
}

const tables = {
  events: [{ id: 'ev1', name: 'Throwdown Nov', is_test: false }],
  td_settings: [{ judge_count: 3, third_place: true, seeding_mode: 'random', modules: {} }],
  td_rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
  td_matches: [{ id: 'm1', round_id: 'r1', position: 1, result_kind: null }],
  td_slots: [
    { id: 's1', match_id: 'm1', position: 1, entry_id: 'e1' },
    { id: 's2', match_id: 'm1', position: 2, entry_id: 'e2' },
  ],
  event_entries: [
    { id: 'e1', display_name: 'Ana', withdrawn: false },
    { id: 'e2', display_name: 'Bo', withdrawn: false },
  ],
};

afterEach(() => vi.useRealTimers());

describe('countQueuedTdOperations', () => {
  it('counts only Throwdown operations', async () => {
    const queued = [
      { type: TD_OPERATIONS.vote },
      { type: TD_OPERATIONS.confirm },
      { type: 'confirm_btc_match' },
      { type: 'something_else' },
    ];
    expect(await countQueuedTdOperations(async () => queued)).toBe(2);
  });

  it('counts every Throwdown operation kind', async () => {
    const all = Object.values(TD_OPERATIONS).map((type) => ({ type }));
    expect(await countQueuedTdOperations(async () => all)).toBe(all.length);
  });
});

describe('loadThrowdownDashboardData', () => {
  it('returns the event, everything loadThrowdown reads and the queued count', async () => {
    const data = await loadThrowdownDashboardData('ev1', {
      client: fakeClient({ tables }),
      listQueued: async () => [{ type: TD_OPERATIONS.vote }, { type: 'confirm_btc_match' }],
    });
    expect(data.eventId).toBe('ev1');
    expect(data.event.name).toBe('Throwdown Nov');
    expect(data.settings.judge_count).toBe(3);
    expect(data.bracket.started).toBe(true);
    expect(data.bracket.rounds[0].matches[0].sides.map((s) => s.name)).toEqual(['Ana', 'Bo']);
    expect(data.queuedCount).toBe(1);
  });

  it.each([
    'events',
    'td_settings',
    'td_draws',
    'td_rounds',
    'td_matches',
    'td_slots',
    'td_votes',
    'event_entries',
    'td_match_reopens',
  ])('a failed %s read is required: the load rejects', async (failTable) => {
    await expect(
      loadThrowdownDashboardData('ev1', {
        client: fakeClient({ failTable, tables }),
        listQueued: async () => [],
      }),
    ).rejects.toThrow(`${failTable} failed`);
  });

  it('a failed required read is not held back by a hanging queue read', async () => {
    await expect(
      loadThrowdownDashboardData('ev1', {
        client: fakeClient({ failTable: 'events', tables }),
        listQueued: () => new Promise(() => {}),
      }),
    ).rejects.toThrow('events failed'); // real timers: resolves at once, not after 10 s
  });

  it('a failed queue read is advisory: null, and the rest still loads', async () => {
    const data = await loadThrowdownDashboardData('ev1', {
      client: fakeClient({ tables }),
      listQueued: async () => {
        throw new Error('indexeddb unavailable');
      },
    });
    expect(data.queuedCount).toBeNull();
    expect(data.bracket.started).toBe(true);
  });

  it('a synchronously throwing queue read is advisory too', async () => {
    const data = await loadThrowdownDashboardData('ev1', {
      client: fakeClient({ tables }),
      listQueued: () => {
        throw new Error('boom');
      },
    });
    expect(data.queuedCount).toBeNull();
  });

  it('a queue read that hangs times out to null instead of holding the page', async () => {
    vi.useFakeTimers();
    const pending = loadThrowdownDashboardData('ev1', {
      client: fakeClient({ tables }),
      listQueued: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(10_001);
    const data = await pending;
    expect(data.queuedCount).toBeNull();
    expect(data.event.id).toBe('ev1');
  });

  it('a required read that hangs rejects as timed out', async () => {
    vi.useFakeTimers();
    const hung = {
      from: () => {
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          range: () => new Promise(() => {}),
          maybeSingle: () => new Promise(() => {}),
          single: () => new Promise(() => {}),
        };
        return b;
      },
    };
    const pending = loadThrowdownDashboardData('ev1', { client: hung, listQueued: async () => [] });
    const assertion = expect(pending).rejects.toMatchObject({ timedOut: true });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });
});
