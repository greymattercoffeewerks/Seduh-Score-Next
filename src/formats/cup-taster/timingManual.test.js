import { describe, it, expect, vi } from 'vitest';
import { recordManualTime } from './timingManual.js';

// Same shape as timing.test.js's fixture.
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

const manualHeatPending = {
  id: 'h1',
  heat_number: 1,
  timing_mode: 'manual',
  status: 'pending',
  duration_secs: 480,
  started_at: null,
};

const fixedNow = () => new Date('2026-08-22T10:00:00.000Z').getTime();

describe('recordManualTime', () => {
  it('throws for an app-timing-mode heat — this is the manual-mode surface only', async () => {
    const client = fakeClient({
      tables: { ct_heats: { data: { ...manualHeatPending, timing_mode: 'app' }, error: null } },
    });
    await expect(recordManualTime('h1', 'e1', 120, client, { now: fixedNow })).rejects.toThrow(
      'not "manual"',
    );
  });

  it('throws when the heat is not currently accepting manual times (already past pending)', async () => {
    const client = fakeClient({
      tables: { ct_heats: { data: { ...manualHeatPending, status: 'scoring' }, error: null } },
    });
    await expect(recordManualTime('h1', 'e1', 120, client, { now: fixedNow })).rejects.toThrow(
      'not accepting manual times',
    );
  });

  it('rejects a negative elapsed value outright — never reaches clampElapsed at all', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: manualHeatPending, error: null } } });
    await expect(recordManualTime('h1', 'e1', -5, client, { now: fixedNow })).rejects.toThrow(
      'non-negative whole number',
    );
    expect(client.calls).toHaveLength(0);
  });

  it('rejects a non-integer elapsed value', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: manualHeatPending, error: null } } });
    await expect(recordManualTime('h1', 'e1', 12.5, client, { now: fixedNow })).rejects.toThrow(
      'non-negative whole number',
    );
    expect(client.calls).toHaveLength(0);
  });

  it('records a hand-entered time within the duration, clamped via clampElapsed, time_source "manual"', async () => {
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 125,
      elapsed_secs_raw: 125,
      maxed: false,
      time_source: 'manual',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: manualHeatPending, error: null },
          { data: null, error: null }, // maybeAdvanceToScoring: no update yet (guard below)
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // findHeatEntry
          { data: updatedEntry, error: null }, // update result
          {
            data: [
              { id: 'he1', entry_id: 'e1', elapsed_secs: 125 },
              { id: 'he2', entry_id: 'e2', elapsed_secs: null },
            ],
            error: null,
          },
        ],
      },
    });
    const result = await recordManualTime('h1', 'e1', 125, client, { now: fixedNow });
    expect(result).toEqual(updatedEntry);

    const updateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    expect(updateCall[2]).toMatchObject({
      elapsed_secs: 125,
      elapsed_secs_raw: 125,
      maxed: false,
      time_source: 'manual',
    });
    // Unlike recordTap, a hand-entered correction is expected workflow, not
    // a race — no .is('elapsed_secs', null) guard should gate this write.
    expect(client.calls).not.toContainEqual(['is', 'ct_heat_entries', 'elapsed_secs', null]);
  });

  it('caps a time at or beyond duration to maxed, displayed distinctly, never the raw over-cap figure as the authoritative value', async () => {
    const updatedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 480,
      elapsed_secs_raw: 483,
      maxed: true,
      time_source: 'manual',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: manualHeatPending, error: null },
          { data: null, error: null },
        ],
        ct_heat_entries: [
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
          { data: updatedEntry, error: null },
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 480 }], error: null },
        ],
      },
    });
    // A judge typed 8:03 on an 8:00 heat (§7.1, D22).
    const result = await recordManualTime('h1', 'e1', 483, client, { now: fixedNow });
    expect(result.elapsed_secs).toBe(480);
    expect(result.maxed).toBe(true);
    const updateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heat_entries',
    );
    expect(updateCall[2].elapsed_secs).toBe(480);
    expect(updateCall[2].elapsed_secs_raw).toBe(483);
  });

  it('allows correcting an already-recorded entry by re-saving, unlike a real tap', async () => {
    const correctedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 200,
      elapsed_secs_raw: 200,
      maxed: false,
      time_source: 'manual',
    };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: manualHeatPending, error: null },
          { data: null, error: null },
        ],
        ct_heat_entries: [
          // findHeatEntry: already has a (mistaken) recorded time.
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: 150 }, error: null },
          { data: correctedEntry, error: null }, // update result — overwritten
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 200 }], error: null },
        ],
      },
    });
    const result = await recordManualTime('h1', 'e1', 200, client, { now: fixedNow });
    expect(result).toEqual(correctedEntry);
  });

  it('advances the heat straight from pending to scoring once every entry has a manual time — no "timing" status in between', async () => {
    const scoringHeat = { ...manualHeatPending, status: 'scoring' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: manualHeatPending, error: null },
          { data: scoringHeat, error: null }, // maybeAdvanceToScoring's update
        ],
        ct_heat_entries: [
          { data: { id: 'he2', entry_id: 'e2', elapsed_secs: null }, error: null },
          { data: { id: 'he2', entry_id: 'e2', elapsed_secs: 200 }, error: null },
          // maybeAdvanceToScoring's listHeatEntries — everyone has a time now.
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
    await recordManualTime('h1', 'e2', 200, client, { now: fixedNow });
    const heatsUpdateCall = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_heats',
    );
    expect(heatsUpdateCall[2]).toEqual({ status: 'scoring' });
    expect(client.calls).toContainEqual(['in', 'ct_heats', 'status', ['pending', 'timing']]);
  });

  it('still resolves with the recorded time even when the follow-up advance-to-scoring write fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recordedEntry = { id: 'he2', entry_id: 'e2', elapsed_secs: 200, time_source: 'manual' };
    const client = fakeClient({
      tables: {
        ct_heats: [
          { data: manualHeatPending, error: null },
          { data: null, error: { message: 'connection reset' } },
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
    const result = await recordManualTime('h1', 'e2', 200, client, { now: fixedNow });
    expect(result).toEqual(recordedEntry);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
