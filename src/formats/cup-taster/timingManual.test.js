import { describe, it, expect, beforeEach } from 'vitest';
import { recordManualTime } from './timingManual.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

const manualHeatPending = {
  id: 'h1',
  status: 'pending',
  duration_secs: 480,
};
const heatEntry = { id: 'he1', entry_id: 'e1' };
const fixedNow = () => new Date('2026-08-22T10:00:00.000Z').getTime();

function fakeRpcClient(handler) {
  const calls = [];
  return {
    calls,
    rpc: (name, payload) => {
      calls.push([name, payload]);
      return handler(name, payload);
    },
  };
}

describe('recordManualTime', () => {
  it('rejects a negative elapsed value outright — never reaches clampElapsed, never enqueues anything', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    await expect(
      recordManualTime(manualHeatPending, heatEntry, -5, 'org1', client, { now: fixedNow }),
    ).rejects.toThrow('non-negative whole number');
    expect(client.calls).toHaveLength(0);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('rejects a non-integer elapsed value', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    await expect(
      recordManualTime(manualHeatPending, heatEntry, 12.5, 'org1', client, { now: fixedNow }),
    ).rejects.toThrow('non-negative whole number');
    expect(client.calls).toHaveLength(0);
  });

  it('enqueues then flushes record_heat_time with an overwrite conflict policy, time_source "manual", using the CALLER-supplied heat/entry', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const result = await recordManualTime(manualHeatPending, heatEntry, 125, 'org1', client, {
      now: fixedNow,
    });

    expect(result.expectedElapsedSecs).toBe(125);
    expect(result.flushResult.processed).toBe(1);
    const [name, payload] = client.calls[0];
    expect(name).toBe('record_heat_time');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_heat_entry_id).toBe('he1');
    expect(payload.p_expected_heat_status).toBe('pending');
    expect(payload.p_elapsed_secs).toBe(125);
    expect(payload.p_elapsed_secs_raw).toBe(125);
    expect(payload.p_maxed).toBe(false);
    expect(payload.p_time_source).toBe('manual');
    // Unlike recordTap, a hand-entered correction is expected workflow, not
    // a race — 'overwrite', never 'reject'.
    expect(payload.p_conflict_policy).toBe('overwrite');
  });

  it('caps a time at or beyond duration to maxed, via clampElapsed — never the raw over-cap figure as the authoritative value', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    // A judge typed 8:03 on an 8:00 heat (§7.1, D22).
    const result = await recordManualTime(manualHeatPending, heatEntry, 483, 'org1', client, {
      now: fixedNow,
    });
    expect(result.expectedElapsedSecs).toBe(480);
    const [, payload] = client.calls[0];
    expect(payload.p_elapsed_secs).toBe(480);
    expect(payload.p_elapsed_secs_raw).toBe(483);
    expect(payload.p_maxed).toBe(true);
  });

  it('a conflict from the RPC (the heat has already moved past pending) surfaces as a permanent failure', async () => {
    const client = fakeRpcClient(() =>
      Promise.resolve({
        data: null,
        error: { code: 'P0002', message: 'CONFLICT: heat h1 is scoring now, expected pending' },
      }),
    );
    const { flushResult } = await recordManualTime(
      manualHeatPending,
      heatEntry,
      200,
      'org1',
      client,
      {
        now: fixedNow,
      },
    );
    expect(flushResult.permanentFailure).toBe(true);
    expect(flushResult.error.code).toBe('P0002');

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('a network-level failure stays retryable, not permanent — the correction remains queued', async () => {
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const { flushResult } = await recordManualTime(
      manualHeatPending,
      heatEntry,
      200,
      'org1',
      client,
      {
        now: fixedNow,
      },
    );
    expect(flushResult.permanentFailure).toBe(false);
    expect(flushResult.stopped).toBe(true);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(1);
  });
});
