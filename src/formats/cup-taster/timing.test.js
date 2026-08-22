import { describe, it, expect, vi } from 'vitest';
import { startHeat, recordTap, autoMaxRemainingEntries, maybeAdvanceToScoring } from './timing.js';

// Same shape as heats.test.js's fixture, extended with `update` (new here)
// and `is` (new here).
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
        update: (payload) => {
          calls.push(['update', table, payload]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        is: (...args) => {
          calls.push(['is', table, ...args]);
          return builder;
        },
        in: (...args) => {
          calls.push(['in', table, ...args]);
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

const appHeatPending = {
  id: 'h1',
  stage_id: 's1',
  heat_number: 1,
  timing_mode: 'app',
  status: 'pending',
  duration_secs: 480,
  started_at: null,
};

const appHeatTiming = {
  ...appHeatPending,
  status: 'timing',
  started_at: '2026-08-22T10:00:00.000Z',
};

const fixedNow = () => new Date('2026-08-22T10:00:00.000Z').getTime();

describe('startHeat', () => {
  it('throws for a manual-timing-mode heat — this is the app-mode surface only', async () => {
    const client = fakeClient({
      tables: { ct_heats: { data: { ...appHeatPending, timing_mode: 'manual' }, error: null } },
    });
    await expect(startHeat('h1', client)).rejects.toThrow('not "app"');
  });

  it('transitions a pending heat to timing, stamping started_at', async () => {
    const startedHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatPending, error: null }, // findHeatById
          { data: startedHeat, error: null }, // update result
        ],
      },
    });
    const result = await startHeat('h1', client, { now: fixedNow });
    expect(result).toEqual(startedHeat);
    const updateCall = client.calls.find(([action]) => action === 'update');
    expect(updateCall[2]).toEqual({ status: 'timing', started_at: '2026-08-22T10:00:00.000Z' });
  });

  it('is idempotent — a heat already timing is returned unchanged, no update issued', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: appHeatTiming, error: null } } });
    const result = await startHeat('h1', client, { now: fixedNow });
    expect(result).toEqual(appHeatTiming);
    expect(client.calls.some(([action]) => action === 'update')).toBe(false);
  });

  it('re-fetches rather than trusting a stale read when a concurrent starter wins the race', async () => {
    const winner = { ...appHeatPending, status: 'timing', started_at: '2026-08-22T09:59:59.000Z' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatPending, error: null }, // findHeatById: still pending
          { data: null, error: null }, // update matched 0 rows — someone else won
          { data: winner, error: null }, // re-fetch
        ],
      },
    });
    const result = await startHeat('h1', client, { now: fixedNow });
    expect(result).toEqual(winner);
  });
});

describe('maybeAdvanceToScoring', () => {
  it('does nothing when at least one entry has no elapsed_secs yet', async () => {
    const client = fakeClient({
      tables: {
        ct_heat_entries: {
          data: [
            { id: 'he1', entry_id: 'e1', elapsed_secs: 100 },
            { id: 'he2', entry_id: 'e2', elapsed_secs: null },
          ],
          error: null,
        },
      },
    });
    const result = await maybeAdvanceToScoring('h1', client);
    expect(result).toBeNull();
    expect(client.calls.some(([action]) => action === 'update')).toBe(false);
  });

  it('does nothing for a heat with zero entries — never a vacuous "complete"', async () => {
    const client = fakeClient({ tables: { ct_heat_entries: { data: [], error: null } } });
    const result = await maybeAdvanceToScoring('h1', client);
    expect(result).toBeNull();
    expect(client.calls.some(([action]) => action === 'update')).toBe(false);
  });

  it('transitions to scoring once every entry has elapsed_secs set', async () => {
    const scoringHeat = { ...appHeatTiming, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heat_entries: {
          data: [
            { id: 'he1', entry_id: 'e1', elapsed_secs: 100 },
            { id: 'he2', entry_id: 'e2', elapsed_secs: 200 },
          ],
          error: null,
        },
        ct_heats: { data: scoringHeat, error: null },
      },
    });
    const result = await maybeAdvanceToScoring('h1', client);
    expect(result).toEqual(scoringHeat);
    const updateCall = client.calls.find(([action]) => action === 'update');
    expect(updateCall[2]).toEqual({ status: 'scoring' });
  });

  it("also transitions a still-'pending' heat to scoring — the manual-mode path, which skips 'timing' entirely (§7.1)", async () => {
    const scoringHeat = { ...appHeatPending, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heat_entries: {
          data: [
            { id: 'he1', entry_id: 'e1', elapsed_secs: 100 },
            { id: 'he2', entry_id: 'e2', elapsed_secs: 200 },
          ],
          error: null,
        },
        ct_heats: { data: scoringHeat, error: null },
      },
    });
    const result = await maybeAdvanceToScoring('h1', client);
    expect(result).toEqual(scoringHeat);
    expect(client.calls).toContainEqual(['in', 'ct_heats', 'status', ['pending', 'timing']]);
  });
});

describe('recordTap', () => {
  it('throws when the heat is not currently timing', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: appHeatPending, error: null } } });
    await expect(recordTap('h1', 'e1', client, { now: fixedNow })).rejects.toThrow(
      'not currently timing',
    );
  });

  it("throws when the cupper's time is already recorded", async () => {
    const client = fakeClient({
      tables: {
        ct_heats: { data: appHeatTiming, error: null },
        ct_heat_entries: { data: { id: 'he1', entry_id: 'e1', elapsed_secs: 100 }, error: null },
      },
    });
    await expect(recordTap('h1', 'e1', client, { now: fixedNow })).rejects.toThrow(
      'already recorded',
    );
  });

  it('records a tap partway through the heat, clamped via clampElapsed', async () => {
    // Heat started at 10:00:00, tap at 10:02:00 -> 120s elapsed, well under
    // the 480s duration, so not maxed.
    const tapNow = () => new Date('2026-08-22T10:02:00.000Z').getTime();
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 120,
      elapsed_secs_raw: 120,
      maxed: false,
      time_source: 'tapped',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null }, // recordTap's own findHeatById
          { data: null, error: null }, // maybeAdvanceToScoring: no update yet (guard below)
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // findHeatEntry
          { data: updatedEntry, error: null }, // update result
          // maybeAdvanceToScoring's own listHeatEntries — one entry still
          // unstopped, so it won't try to update ct_heats at all.
          {
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 120 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: null },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await recordTap('h1', 'e1', client, { now: tapNow });
    expect(result).toEqual(updatedEntry);

    const updateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    expect(updateCall[2]).toMatchObject({
      elapsed_secs: 120,
      elapsed_secs_raw: 120,
      maxed: false,
      time_source: 'tapped',
    });
    expect(updateCall[2].time_edited_at).toBe('2026-08-22T10:02:00.000Z');
  });

  it('clamps a tap at or beyond the duration to maxed, via clampElapsed — never a raw over-cap value', async () => {
    // Tap arrives late (clock drift, a delayed request) at 500s — beyond the
    // 480s duration.
    const lateTapNow = () => new Date('2026-08-22T10:08:20.000Z').getTime();
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 480,
      elapsed_secs_raw: 500,
      maxed: true,
      time_source: 'tapped',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: null, error: null },
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
          { data: updatedEntry, error: null },
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 480 }], error: null },
        ],
      },
    });
    const result = await recordTap('h1', 'e1', client, { now: lateTapNow });
    expect(result.elapsed_secs).toBe(480);
    expect(result.maxed).toBe(true);
    const updateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    expect(updateCall[2].elapsed_secs).toBe(480);
    expect(updateCall[2].elapsed_secs_raw).toBe(500);
  });

  it('never writes a negative elapsed_secs even under small clock skew, but preserves the true raw value for the audit trail', async () => {
    // Clock skew within tolerance: client's "now" reads 2s before the
    // server-recorded started_at.
    const skewedNow = () => new Date('2026-08-22T09:59:58.000Z').getTime();
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 0,
      elapsed_secs_raw: -2,
      maxed: false,
      time_source: 'tapped',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: null, error: null },
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
          { data: updatedEntry, error: null },
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 0 }], error: null },
        ],
      },
    });
    await recordTap('h1', 'e1', client, { now: skewedNow });
    const updateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    // elapsed_secs is floored (never negative — the DB rejects that), but
    // elapsed_secs_raw keeps the true skewed value rather than losing it —
    // the schema's own "raw preserves what was tapped before clamping"
    // promise (handoff §5.2) would otherwise be silently broken for exactly
    // the case it exists to cover.
    expect(updateCall[2].elapsed_secs).toBe(0);
    expect(updateCall[2].elapsed_secs_raw).toBe(-2);
  });

  it('rejects a tap whose clock skew is too large to be normal drift, rather than silently recording it as the fastest time', async () => {
    // 10s before started_at — well past MAX_NEGATIVE_SKEW_SECS (5s). This is
    // the fairness risk a broken client clock creates: without this
    // rejection, a stale/wrong clock could hand a cupper the best time in
    // the heat, undetected.
    const badSkewNow = () => new Date('2026-08-22T09:59:50.000Z').getTime();
    const client = fakeClient({
      tables: {
        ct_heats: { data: appHeatTiming, error: null },
        ct_heat_entries: { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
      },
    });
    await expect(recordTap('h1', 'e1', client, { now: badSkewNow })).rejects.toThrow(
      'looks like a clock problem',
    );
    expect(client.calls.some(([action]) => action === 'update')).toBe(false);
  });

  it('accepts skew of exactly MAX_NEGATIVE_SKEW_SECS (-5s) — the boundary itself is still normal drift', async () => {
    const boundaryNow = () => new Date('2026-08-22T09:59:55.000Z').getTime();
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 0,
      elapsed_secs_raw: -5,
      maxed: false,
      time_source: 'tapped',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: null, error: null },
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
          { data: updatedEntry, error: null },
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 0 }], error: null },
        ],
      },
    });
    const result = await recordTap('h1', 'e1', client, { now: boundaryNow });
    expect(result).toEqual(updatedEntry);
  });

  it('rejects skew of exactly one second past the boundary (-6s)', async () => {
    const justOverNow = () => new Date('2026-08-22T09:59:54.000Z').getTime();
    const client = fakeClient({
      tables: {
        ct_heats: { data: appHeatTiming, error: null },
        ct_heat_entries: { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
      },
    });
    await expect(recordTap('h1', 'e1', client, { now: justOverNow })).rejects.toThrow(
      'looks like a clock problem',
    );
    expect(client.calls.some(([action]) => action === 'update')).toBe(false);
  });

  it('throws when a concurrent request already recorded the time first (the DB-level guard)', async () => {
    const client = fakeClient({
      tables: {
        ct_heats: { data: appHeatTiming, error: null },
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // read: still null
          { data: null, error: null }, // update matched 0 rows — someone else won the race
          {
            data: { id: 'he1', entry_id: 'e1', elapsed_secs: 300, time_source: 'tapped' },
            error: null,
          }, // re-fetch after loss
        ],
      },
    });
    await expect(recordTap('h1', 'e1', client, { now: fixedNow })).rejects.toThrow(
      'recorded by another request first',
    );
    // The DB-level guard itself must actually be issued, not just relied on
    // in the code's reaction to losing the race — this is what closes the
    // gap between the read-check and the write for two concurrent taps.
    expect(client.calls).toContainEqual(['is', 'ct_heat_entries', 'elapsed_secs', null]);
  });

  it('gives a distinguishing error when the lost race was to the master clock expiring, not a duplicate tap', async () => {
    const client = fakeClient({
      tables: {
        ct_heats: { data: appHeatTiming, error: null },
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // read: still null
          { data: null, error: null }, // update matched 0 rows — auto-max won first
          {
            data: { id: 'he1', entry_id: 'e1', elapsed_secs: 480, time_source: 'maxed' },
            error: null,
          }, // re-fetch
        ],
      },
    });
    await expect(recordTap('h1', 'e1', client, { now: fixedNow })).rejects.toThrow(
      /clock had already expired \(maxed at 480s\)/,
    );
  });

  it('advances the heat to scoring when this tap was the last one needed', async () => {
    const scoringHeat = { ...appHeatTiming, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: scoringHeat, error: null }, // maybeAdvanceToScoring's update
        ],
        ct_heat_entries: [
          { data: { id: 'he2', entry_id: 'e2', elapsed_secs: null }, error: null },
          { data: { id: 'he2', entry_id: 'e2', elapsed_secs: 200 }, error: null },
          // maybeAdvanceToScoring's listHeatEntries — everyone stopped now
          {
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 100 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: 200 },
            ],
            error: null,
          },
        ],
      },
    });
    await recordTap('h1', 'e2', client, { now: fixedNow });
    const heatsUpdateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heats',
    );
    expect(heatsUpdateCall[2]).toEqual({ status: 'scoring' });
  });

  it('still resolves with the recorded tap even when the follow-up advance-to-scoring write fails', async () => {
    // The tap itself already succeeded by the time maybeAdvanceToScoring
    // runs — a failure in the status transition must not be reported to the
    // caller as if the tap failed. It's a retry-on-next-write concern, not
    // this call's problem.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recordedEntry = { id: 'he2', entry_id: 'e2', elapsed_secs: 200, time_source: 'tapped' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: null, error: { message: 'connection reset' } }, // maybeAdvanceToScoring's update fails
        ],
        ct_heat_entries: [
          { data: { id: 'he2', entry_id: 'e2', elapsed_secs: null }, error: null },
          { data: recordedEntry, error: null },
          {
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 100 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: 200 },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await recordTap('h1', 'e2', client, { now: fixedNow });
    expect(result).toEqual(recordedEntry);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe('autoMaxRemainingEntries', () => {
  it('returns an empty array for a heat that is not currently timing', async () => {
    const client = fakeClient({
      tables: { ct_heats: { data: { ...appHeatTiming, status: 'scoring' }, error: null } },
    });
    expect(await autoMaxRemainingEntries('h1', client, { now: fixedNow })).toEqual([]);
  });

  it('throws if called before the master clock has actually expired', async () => {
    const notYetExpired = () => new Date('2026-08-22T10:01:00.000Z').getTime(); // 60s < 480s
    const client = fakeClient({ tables: { ct_heats: { data: appHeatTiming, error: null } } });
    await expect(autoMaxRemainingEntries('h1', client, { now: notYetExpired })).rejects.toThrow(
      'has not expired yet',
    );
  });

  it('maxes every still-running entry once expired, leaving already-stopped entries untouched', async () => {
    const expiredNow = () => new Date('2026-08-22T10:08:00.000Z').getTime(); // 480s
    const maxedEntry2 = {
      id: 'he2',
      entry_id: 'e2',
      elapsed_secs: 480,
      elapsed_secs_raw: 480,
      maxed: true,
      time_source: 'maxed',
    };
    const scoringHeat = { ...appHeatTiming, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: scoringHeat, error: null }, // maybeAdvanceToScoring's update
        ],
        ct_heat_entries: [
          {
            // e1 already tapped, e2 still running
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 300 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: null },
            ],
            error: null,
          },
          { data: maxedEntry2, error: null }, // update result for e2
          // maybeAdvanceToScoring's own re-list — both now stopped
          {
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 300 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: 480 },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await autoMaxRemainingEntries('h1', client, { now: expiredNow });
    expect(result).toEqual([maxedEntry2]);

    const entryUpdateCalls = client.calls.filter(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    expect(entryUpdateCalls).toHaveLength(1);
    expect(entryUpdateCalls[0][2]).toMatchObject({
      elapsed_secs: 480,
      elapsed_secs_raw: 480,
      maxed: true,
      time_source: 'maxed',
    });
  });

  it('is a safe no-write no-op when everyone already has a final time', async () => {
    const expiredNow = () => new Date('2026-08-22T10:08:00.000Z').getTime();
    const scoringHeat = { ...appHeatTiming, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: appHeatTiming, error: null },
          { data: scoringHeat, error: null },
        ],
        ct_heat_entries: {
          data: [
            { id: 'he1', entry_id: 'e1', elapsed_secs: 300 },
            { id: 'he2', entry_id: 'e2', elapsed_secs: 480 },
          ],
          error: null,
        },
      },
    });
    const result = await autoMaxRemainingEntries('h1', client, { now: expiredNow });
    expect(result).toEqual([]);
    expect(
      client.calls.some(([action, table]) => action === 'update' && table === 'ct_heat_entries'),
    ).toBe(false);
  });
});
