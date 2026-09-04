import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildClampedUpdate,
  startHeat,
  recordTap,
  autoMaxRemainingEntries,
  describeTimingConflict,
  timingHandlers,
} from './timing.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

describe('buildClampedUpdate', () => {
  it('clamps via clampElapsed and stamps time_source/time_edited_at', () => {
    const nowMs = new Date('2026-08-22T10:02:00.000Z').getTime();
    expect(buildClampedUpdate(120, 480, 'tapped', nowMs)).toEqual({
      elapsed_secs: 120,
      elapsed_secs_raw: 120,
      maxed: false,
      time_source: 'tapped',
      time_edited_at: '2026-08-22T10:02:00.000Z',
    });
  });

  it('clamps an over-duration value to maxed, preserving the true raw value', () => {
    const result = buildClampedUpdate(500, 480, 'tapped', 0);
    expect(result.elapsed_secs).toBe(480);
    expect(result.elapsed_secs_raw).toBe(500);
    expect(result.maxed).toBe(true);
  });

  it('floors a negative raw value to 0, preserving it in raw for the audit trail', () => {
    const result = buildClampedUpdate(-2, 480, 'tapped', 0);
    expect(result.elapsed_secs).toBe(0);
    expect(result.elapsed_secs_raw).toBe(-2);
    expect(result.maxed).toBe(false);
  });
});

const appHeatTiming = {
  id: 'h1',
  status: 'timing',
  duration_secs: 480,
  started_at: '2026-08-22T10:00:00.000Z',
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

describe('startHeat', () => {
  it('enqueues then flushes start_heat, with started_at captured at call time — never re-derived at flush time', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const result = await startHeat('h1', 'org1', client, { now: fixedNow });

    expect(result.startedAtMs).toBe(fixedNow());
    expect(result.startedAtIso).toBe('2026-08-22T10:00:00.000Z');
    expect(result.flushResult.processed).toBe(1);
    expect(client.calls).toHaveLength(1);
    const [name, payload] = client.calls[0];
    expect(name).toBe('start_heat');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_heat_id).toBe('h1');
    expect(payload.p_started_at).toBe('2026-08-22T10:00:00.000Z');
    // A fresh idempotency key per call — not reused, not left undefined.
    expect(payload.p_operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('any error the RPC itself returns is treated as permanent — it will fail the same way on every retry', async () => {
    const client = fakeRpcClient(() =>
      // status: 400 — a genuine server-side rejection carries a real,
      // non-zero HTTP status (buildRpcHandler, core/outbox.js, is what
      // actually distinguishes this from a network-level failure, which
      // resolves with status: 0 instead).
      Promise.resolve({
        data: null,
        error: { message: 'start_heat: heat h1 not found' },
        status: 400,
      }),
    );
    const { flushResult } = await startHeat('h1', 'org1', client, { now: fixedNow });
    expect(flushResult.permanentFailure).toBe(true);
    expect(flushResult.error.message).toContain('not found');

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('a network-level failure (the call itself rejecting, not the RPC returning an error) stays retryable, not permanent', async () => {
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const { flushResult } = await startHeat('h1', 'org1', client, { now: fixedNow });
    expect(flushResult.permanentFailure).toBe(false);
    expect(flushResult.stopped).toBe(true);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(1);
  });
});

describe('recordTap', () => {
  it('enqueues then flushes record_heat_time with a reject conflict policy, using the CALLER-supplied heat/entry — no server read of its own', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const tapNow = () => new Date('2026-08-22T10:02:00.000Z').getTime();
    const result = await recordTap(appHeatTiming, heatEntry, 'org1', client, { now: tapNow });

    expect(result.expectedElapsedSecs).toBe(120);
    expect(result.flushResult.processed).toBe(1);
    const [name, payload] = client.calls[0];
    expect(name).toBe('record_heat_time');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_heat_entry_id).toBe('he1');
    expect(payload.p_expected_heat_status).toBe('timing');
    expect(payload.p_elapsed_secs).toBe(120);
    expect(payload.p_elapsed_secs_raw).toBe(120);
    expect(payload.p_maxed).toBe(false);
    expect(payload.p_time_source).toBe('tapped');
    expect(payload.p_conflict_policy).toBe('reject');
  });

  it('clamps a late tap to maxed, via clampElapsed — never a raw over-cap value', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const lateTapNow = () => new Date('2026-08-22T10:08:20.000Z').getTime(); // 500s, > 480s duration
    const result = await recordTap(appHeatTiming, heatEntry, 'org1', client, { now: lateTapNow });
    expect(result.expectedElapsedSecs).toBe(480);
    const [, payload] = client.calls[0];
    expect(payload.p_elapsed_secs).toBe(480);
    expect(payload.p_elapsed_secs_raw).toBe(500);
    expect(payload.p_maxed).toBe(true);
  });

  it('never writes a negative elapsed_secs even under small clock skew, but preserves the true raw value', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const skewedNow = () => new Date('2026-08-22T09:59:58.000Z').getTime(); // 2s before started_at
    const result = await recordTap(appHeatTiming, heatEntry, 'org1', client, { now: skewedNow });
    expect(result.expectedElapsedSecs).toBe(0);
    const [, payload] = client.calls[0];
    expect(payload.p_elapsed_secs).toBe(0);
    expect(payload.p_elapsed_secs_raw).toBe(-2);
  });

  it('rejects a tap whose clock skew is too large to be normal drift, without ever enqueueing anything', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const badSkewNow = () => new Date('2026-08-22T09:59:50.000Z').getTime(); // 10s before started_at
    await expect(
      recordTap(appHeatTiming, heatEntry, 'org1', client, { now: badSkewNow }),
    ).rejects.toThrow('looks like a clock problem');
    expect(client.calls).toHaveLength(0);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('accepts skew of exactly MAX_NEGATIVE_SKEW_SECS (-5s) — the boundary itself is still normal drift', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const boundaryNow = () => new Date('2026-08-22T09:59:55.000Z').getTime();
    const result = await recordTap(appHeatTiming, heatEntry, 'org1', client, { now: boundaryNow });
    expect(result.expectedElapsedSecs).toBe(0);
  });

  it('rejects skew of exactly one second past the boundary (-6s)', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const justOverNow = () => new Date('2026-08-22T09:59:54.000Z').getTime();
    await expect(
      recordTap(appHeatTiming, heatEntry, 'org1', client, { now: justOverNow }),
    ).rejects.toThrow('looks like a clock problem');
    expect(client.calls).toHaveLength(0);
  });

  it('a duplicate-tap conflict from the RPC (a race, or a genuine bug) is reported as a permanent failure, not silently retried forever', async () => {
    const client = fakeRpcClient(() =>
      Promise.resolve({
        data: null,
        error: { code: 'P0002', message: 'CONFLICT: heat entry he1 already has a recorded time' },
        status: 400,
      }),
    );
    const { flushResult } = await recordTap(appHeatTiming, heatEntry, 'org1', client, {
      now: fixedNow,
    });
    expect(flushResult.permanentFailure).toBe(true);
    expect(flushResult.error.code).toBe('P0002');

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });
});

describe('autoMaxRemainingEntries', () => {
  it('enqueues then flushes auto_max_heat as ONE operation for the whole sweep — no duration_secs sent, the RPC reads it server-side', async () => {
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const flushResult = await autoMaxRemainingEntries('h1', 'org1', client, { now: fixedNow });
    expect(flushResult.processed).toBe(1);
    const [name, payload] = client.calls[0];
    expect(name).toBe('auto_max_heat');
    expect(payload.p_heat_id).toBe('h1');
    expect(payload.p_org_id).toBe('org1');
    expect(payload).not.toHaveProperty('p_duration_secs');
  });

  it('a genuine permanent failure surfaces, not silently retried forever', async () => {
    const client = fakeRpcClient(() =>
      Promise.resolve({
        data: null,
        error: { message: 'auto_max_heat: heat h1 not found' },
        status: 400,
      }),
    );
    const flushResult = await autoMaxRemainingEntries('h1', 'org1', client, { now: fixedNow });
    expect(flushResult.permanentFailure).toBe(true);
  });
});

describe('timingHandlers', () => {
  it('one flushOutbox() call using this shared map drains start_heat AND record_heat_time together, in FIFO order — not just whichever type triggered the flush', async () => {
    // The exact regression the module comment documents: a flush
    // registering only ITS OWN caller's operation type would stall on any
    // other timing operation queued ahead of it. Proven here by enqueueing
    // both types directly (bypassing startHeat/recordTap's own individual
    // flush calls) and flushing once with the shared handler map.
    const client = fakeRpcClient(() => Promise.resolve({ data: null, error: null }));
    const { enqueueOperation, flushOutbox } = await import('../../core/outbox.js');
    await enqueueOperation('start_heat', {
      p_operation_id: crypto.randomUUID(),
      p_org_id: 'org1',
      p_heat_id: 'h1',
      p_started_at: '2026-08-22T10:00:00.000Z',
    });
    await enqueueOperation('record_heat_time', {
      p_operation_id: crypto.randomUUID(),
      p_org_id: 'org1',
      p_heat_entry_id: 'he1',
      p_expected_heat_status: 'timing',
      p_elapsed_secs: 120,
      p_elapsed_secs_raw: 120,
      p_maxed: false,
      p_time_source: 'tapped',
      p_time_edited_at: '2026-08-22T10:02:00.000Z',
      p_conflict_policy: 'reject',
    });

    const result = await flushOutbox(timingHandlers(client));
    expect(result.processed).toBe(2);
    expect(client.calls.map(([name]) => name)).toEqual(['start_heat', 'record_heat_time']);
  });
});

describe('describeTimingConflict', () => {
  it('returns null for a non-P0002 error, so callers fall through to describeError()', () => {
    expect(describeTimingConflict(new Error('boom'))).toBeNull();
    expect(describeTimingConflict({ code: 'OTHER' })).toBeNull();
    expect(describeTimingConflict(null)).toBeNull();
  });

  it('describes an already-recorded-time conflict distinctly from a heat-status conflict', () => {
    const msg = describeTimingConflict({
      code: 'P0002',
      message: 'CONFLICT: heat entry he1 already has a recorded time',
    });
    expect(msg).toContain('already');
  });

  it('describes a heat-status-mismatch conflict as a generic "moved on" message', () => {
    const msg = describeTimingConflict({
      code: 'P0002',
      message: 'CONFLICT: heat h1 is scoring now, expected timing',
    });
    expect(msg).toContain('moved on');
  });
});
