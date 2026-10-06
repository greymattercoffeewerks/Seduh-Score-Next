import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CORRECTION_REASONS,
  CorrectionInputError,
  REASON_MAX_LENGTH,
  attemptCorrection,
  correctHeatTime,
  describeCorrectionError,
  describeQueuedCorrection,
  isStillQueued,
  loadPendingWork,
  MAX_RAW_SECS,
  resolveCorrection,
  validateReason,
} from './timeCorrection.js';
import { _clearAllForTests } from '../../core/db.js';
import { countPendingOperations, enqueueOperation } from '../../core/outbox.js';

beforeEach(async () => {
  await _clearAllForTests();
});

const heat = { id: 'h1', status: 'scoring', duration_secs: 480 };
const stoppedEntry = { id: 'he1', entry_id: 'e1', elapsed_secs: 200, time_source: 'tapped' };
const fixedNow = () => new Date('2026-10-06T09:00:00.000Z').getTime();

function fakeRpcClient(handler = () => Promise.resolve({ data: null, error: null })) {
  const calls = [];
  return {
    calls,
    rpc: (name, payload) => {
      calls.push([name, payload]);
      return handler(name, payload);
    },
  };
}

describe('validateReason', () => {
  it('returns the trimmed text', () => {
    expect(validateReason('  Missed the stop  ')).toBe('Missed the stop');
  });

  it('refuses a blank, missing or non-text reason — a correction always says why', () => {
    for (const bad of ['', '   ', null, undefined, 42]) {
      expect(() => validateReason(bad)).toThrow('Choose or type a reason');
    }
  });

  it('refuses with a CorrectionInputError that points at the reason field', () => {
    for (const bad of ['', '   ', 'x'.repeat(REASON_MAX_LENGTH + 1)]) {
      let caught;
      try {
        validateReason(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CorrectionInputError);
      expect(caught.field).toBe('reason');
    }
  });

  it('accepts exactly the limit and refuses one character past it', () => {
    expect(validateReason('x'.repeat(REASON_MAX_LENGTH))).toHaveLength(REASON_MAX_LENGTH);
    expect(() => validateReason('x'.repeat(REASON_MAX_LENGTH + 1))).toThrow(
      `${REASON_MAX_LENGTH} characters or fewer`,
    );
  });

  it('measures the limit after trimming, so padding cannot push a valid reason over it', () => {
    expect(validateReason(`  ${'x'.repeat(REASON_MAX_LENGTH)}  `)).toHaveLength(REASON_MAX_LENGTH);
  });

  it('every quick-pick reason is itself a valid reason', () => {
    for (const reason of CORRECTION_REASONS) expect(validateReason(reason)).toBe(reason);
  });
});

describe('correctHeatTime', () => {
  it('queues one correct_heat_time with the time the screen showed as the compare-and-set expectation', async () => {
    const client = fakeRpcClient();
    const result = await correctHeatTime(
      heat,
      stoppedEntry,
      192,
      '  Missed the stop ',
      'org1',
      client,
      { now: fixedNow },
    );

    expect(client.calls).toHaveLength(1);
    const [name, payload] = client.calls[0];
    expect(name).toBe('correct_heat_time');
    expect(payload).toMatchObject({
      p_org_id: 'org1',
      p_heat_entry_id: 'he1',
      p_expected_elapsed_secs: 200,
      p_elapsed_secs: 192,
      p_elapsed_secs_raw: 192,
      p_maxed: false,
      p_reason: 'Missed the stop',
      p_time_edited_at: '2026-10-06T09:00:00.000Z',
    });
    expect(typeof payload.p_operation_id).toBe('string');
    expect(result.expectedElapsedSecs).toBe(192);
    expect(result.flushResult.processed).toBe(1);
    expect(result.operationId).toBeTruthy();
  });

  it('goes through clampElapsed: a time past the heat duration is stored as the max, with the typed value kept as raw', async () => {
    const client = fakeRpcClient();
    const result = await correctHeatTime(heat, stoppedEntry, 720, 'Wrong cupper', 'org1', client, {
      now: fixedNow,
    });
    const payload = client.calls[0][1];
    expect(payload.p_elapsed_secs).toBe(480);
    expect(payload.p_elapsed_secs_raw).toBe(720);
    expect(payload.p_maxed).toBe(true);
    expect(result.expectedElapsedSecs).toBe(480);
  });

  it('expects the CURRENT shown time, not the cupper’s original tapped one — a second correction chains from the first', async () => {
    const client = fakeRpcClient();
    const corrected = { ...stoppedEntry, elapsed_secs: 192, time_source: 'manual' };
    await correctHeatTime(heat, corrected, 185, 'Missed the stop', 'org1', client, {
      now: fixedNow,
    });
    expect(client.calls[0][1].p_expected_elapsed_secs).toBe(192);
  });

  it('refuses a correction to the time already recorded — and queues nothing', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(heat, stoppedEntry, 200, 'Missed the stop', 'org1', client, {
        now: fixedNow,
      }),
    ).rejects.toThrow('already the recorded time (3:20)');
    expect(client.calls).toHaveLength(0);
    expect(await countPendingOperations()).toBe(0);
  });

  it('compares AFTER clamping: typing a longer time into an already-maxed row is the same time, not a change', async () => {
    const client = fakeRpcClient();
    const maxed = { ...stoppedEntry, elapsed_secs: 480, time_source: 'maxed' };
    await expect(
      correctHeatTime(heat, maxed, 900, 'Wrong cupper', 'org1', client, { now: fixedNow }),
    ).rejects.toThrow('already the recorded time');
    expect(await countPendingOperations()).toBe(0);
  });

  it('refuses a cupper with no recorded time — that is a first entry, not a correction', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(
        heat,
        { ...stoppedEntry, elapsed_secs: null },
        100,
        'Missed the stop',
        'org1',
        client,
      ),
    ).rejects.toThrow('no recorded time to correct');
    expect(await countPendingOperations()).toBe(0);
  });

  it('refuses a missing or blank reason before anything is queued', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(heat, stoppedEntry, 190, '   ', 'org1', client, { now: fixedNow }),
    ).rejects.toThrow('Choose or type a reason');
    await expect(
      correctHeatTime(heat, stoppedEntry, 190, undefined, 'org1', client, { now: fixedNow }),
    ).rejects.toThrow('Choose or type a reason');
    expect(client.calls).toHaveLength(0);
    expect(await countPendingOperations()).toBe(0);
  });

  it('refuses a negative or non-integer time before anything is queued', async () => {
    const client = fakeRpcClient();
    for (const bad of [-1, 12.5, NaN, '190']) {
      await expect(
        correctHeatTime(heat, stoppedEntry, bad, 'Missed the stop', 'org1', client),
      ).rejects.toThrow('non-negative whole number');
    }
    expect(await countPendingOperations()).toBe(0);
  });

  it('flushes with the caller’s composed handler map when one is passed, not only its own', async () => {
    const client = fakeRpcClient();
    const correct = vi.fn(() => Promise.resolve());
    await correctHeatTime(heat, stoppedEntry, 190, 'Missed the stop', 'org1', client, {
      now: fixedNow,
      handlers: { correct_heat_time: correct },
    });
    expect(correct).toHaveBeenCalledTimes(1);
    expect(client.calls).toHaveLength(0);
  });

  it('a server refusal is reported as THIS operation’s own dropped error', async () => {
    const client = fakeRpcClient(() =>
      Promise.resolve({
        data: null,
        error: { code: 'P0002', message: 'CONFLICT: heat is confirmed', details: '{}' },
        status: 500,
      }),
    );
    const { operationId, flushResult } = await correctHeatTime(
      heat,
      stoppedEntry,
      190,
      'Missed the stop',
      'org1',
      client,
      { now: fixedNow },
    );
    expect(flushResult.dropped.map((drop) => drop.operationId)).toEqual([operationId]);
  });
});

describe('describeCorrectionError', () => {
  it('returns null for anything that is not the RPC’s conflict, so the caller can fall through', () => {
    expect(describeCorrectionError(null)).toBeNull();
    expect(describeCorrectionError(new Error('boom'))).toBeNull();
    expect(describeCorrectionError({ code: '23505', message: 'dup' })).toBeNull();
  });

  it('says a confirmed heat is locked, from the conflict detail', () => {
    const message = describeCorrectionError({
      code: 'P0002',
      message: 'CONFLICT: heat h1 is confirmed, its times can no longer be corrected',
      details: JSON.stringify({ heat_id: 'h1', current_status: 'confirmed' }),
    });
    expect(message).toBe('This heat has already been confirmed, so its times are locked.');
  });

  it('still says locked when the detail is missing, from the message alone', () => {
    const message = describeCorrectionError({
      code: 'P0002',
      message: 'CONFLICT: heat h1 is confirmed, its times can no longer be corrected',
    });
    expect(message).toBe('This heat has already been confirmed, so its times are locked.');
  });

  it('does NOT say locked for a heat in some other state', () => {
    const message = describeCorrectionError({
      code: 'P0002',
      message: 'CONFLICT: heat h1 is pending, its times can no longer be corrected',
      details: JSON.stringify({ heat_id: 'h1', current_status: 'pending' }),
    });
    expect(message).toContain('moved on');
    expect(message).not.toContain('locked');
  });

  it('names the time that is there now when the screen was stale', () => {
    const message = describeCorrectionError({
      code: 'P0002',
      message: 'CONFLICT: heat entry he1 time is now 192 seconds, expected 200 seconds',
      details: JSON.stringify({
        heat_entry_id: 'he1',
        current_elapsed_secs: 192,
        expected_elapsed_secs: 200,
      }),
    });
    expect(message).toContain('changed elsewhere');
    expect(message).toContain('3:12');
  });

  it('falls back to the generic moved-on message for a malformed detail', () => {
    const message = describeCorrectionError({
      code: 'P0002',
      message: 'CONFLICT: something',
      details: '{not json',
    });
    expect(message).toContain('moved on');
  });
});

describe('resolveCorrection', () => {
  const check = {
    heatEntryId: 'he1',
    displayName: 'Cupper One',
    expectedElapsedSecs: 192,
    operationId: 'op1',
    flushResult: { processed: 1 },
  };
  const landed = { id: 'he1', entry_id: 'e1', elapsed_secs: 192, time_source: 'manual' };

  it('reports success when a fresh reload shows the corrected time as a manual one', () => {
    expect(resolveCorrection(check, [landed])).toEqual({
      tone: 'success',
      message: "Cupper One's time corrected to 3:12.",
      entryId: 'e1',
    });
  });

  it('says so when the corrected time is the heat maximum — the typed figure is not what is stored', () => {
    const result = resolveCorrection({ ...check, expectedElapsedSecs: 480 }, [
      { ...landed, elapsed_secs: 480, maxed: true },
    ]);
    expect(result.message).toBe(
      "Cupper One's time corrected to 8:00. That is the heat's maximum time — anything longer is recorded as the max.",
    );
    expect(resolveCorrection(check, [landed]).message).not.toContain('maximum');
  });

  it('is not fooled by the right number under the wrong source — a tapped 3:12 is not this correction', () => {
    const result = resolveCorrection(check, [{ ...landed, time_source: 'tapped' }]);
    expect(result.tone).toBe('error');
    expect(result.message).not.toContain('corrected to');
  });

  it('is not fooled by the old time still sitting there', () => {
    const result = resolveCorrection(check, [{ ...landed, elapsed_secs: 200 }]);
    expect(result.tone).toBe('error');
  });

  it('explains a miss with THIS operation’s own dropped error', () => {
    const result = resolveCorrection(
      {
        ...check,
        flushResult: {
          dropped: [
            {
              operationId: 'op1',
              error: {
                code: 'P0002',
                message: 'CONFLICT: heat h1 is confirmed, its times can no longer be corrected',
                details: JSON.stringify({ current_status: 'confirmed' }),
              },
            },
          ],
        },
      },
      [{ ...landed, elapsed_secs: 200, time_source: 'tapped' }],
    );
    expect(result).toEqual({
      tone: 'error',
      message: 'This heat has already been confirmed, so its times are locked.',
    });
  });

  it('never blames another operation’s drop for a correction that is merely still queued', () => {
    const result = resolveCorrection(
      {
        ...check,
        flushResult: {
          dropped: [
            { operationId: 'someone-else', error: { code: 'P0002', message: 'CONFLICT: other' } },
          ],
        },
      },
      [{ ...landed, elapsed_secs: 200, time_source: 'tapped' }],
    );
    expect(result.tone).toBe('error');
    expect(result.message).toContain("Couldn't confirm Cupper One's correction");
    expect(result.message).not.toContain('other');
  });

  it('does not promise a sync when nothing is dropped and the time did not change — it may have been changed since, or dropped by another tab', () => {
    const result = resolveCorrection(check, [
      { ...landed, elapsed_secs: 200, time_source: 'tapped' },
    ]);
    expect(result.tone).toBe('error');
    expect(result.message).toBe(
      "Couldn't confirm Cupper One's correction — reload the page and check the time.",
    );
    expect(result.message).not.toContain('sync');
  });

  it('copes with the entry missing from the reload, and with no name', () => {
    expect(resolveCorrection(check, []).tone).toBe('error');
    expect(resolveCorrection({ ...check, displayName: undefined }, [landed]).message).toBe(
      "Cupper's time corrected to 3:12.",
    );
  });
});

describe('correctHeatTime — what reaches the server', () => {
  it('sends the org it was given and a fresh operation id every time', async () => {
    const client = fakeRpcClient();
    await correctHeatTime(heat, stoppedEntry, 190, 'Missed the stop', 'org-A', client, {
      now: fixedNow,
    });
    await correctHeatTime(heat, stoppedEntry, 180, 'Missed the stop', 'org-A', client, {
      now: fixedNow,
    });
    const [first, second] = client.calls.map(([, payload]) => payload);
    expect(first.p_org_id).toBe('org-A');
    expect(second.p_org_id).toBe('org-A');
    // The RPC treats a repeated id as "already done" — two real corrections must
    // never share one.
    expect(first.p_operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.p_operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.p_operation_id).not.toBe(second.p_operation_id);
  });

  it('refuses "same time" and "no reason" with a CorrectionInputError naming the field', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(heat, stoppedEntry, 200, 'Missed the stop', 'org1', client),
    ).rejects.toMatchObject({ name: 'CorrectionInputError', field: 'time' });
    await expect(
      correctHeatTime(heat, stoppedEntry, 190, '', 'org1', client),
    ).rejects.toMatchObject({ name: 'CorrectionInputError', field: 'reason' });
  });

  it('accepts 0 seconds: the lowest time is a time, not an empty field', async () => {
    const client = fakeRpcClient();
    await correctHeatTime(heat, stoppedEntry, 0, 'Wrong cupper', 'org1', client, {
      now: fixedNow,
    });
    expect(client.calls[0][1]).toMatchObject({
      p_elapsed_secs: 0,
      p_elapsed_secs_raw: 0,
      p_maxed: false,
    });
  });
});

describe('attemptCorrection', () => {
  const entryWithName = { ...stoppedEntry, displayName: 'Cupper One' };

  it('returns a check describing the queued operation', async () => {
    const client = fakeRpcClient();
    const outcome = await attemptCorrection(
      heat,
      entryWithName,
      192,
      'Missed the stop',
      'org1',
      client,
      { now: fixedNow },
    );
    expect(outcome.inputError).toBeUndefined();
    expect(outcome.error).toBeUndefined();
    expect(outcome.check).toMatchObject({
      heatEntryId: 'he1',
      displayName: 'Cupper One',
      expectedElapsedSecs: 192,
    });
    expect(outcome.check.operationId).toBeTruthy();
    expect(outcome.check.flushResult.processed).toBe(1);
  });

  it('turns unusable input into { inputError } and queues nothing', async () => {
    const client = fakeRpcClient();
    const outcome = await attemptCorrection(
      heat,
      entryWithName,
      200,
      'Missed the stop',
      'org1',
      client,
    );
    expect(outcome.inputError).toBeInstanceOf(CorrectionInputError);
    expect(outcome.check).toBeUndefined();
    expect(await countPendingOperations()).toBe(0);
  });

  it('turns any other failure into { error }, not a thrown exception', async () => {
    const client = fakeRpcClient();
    const outcome = await attemptCorrection(
      heat,
      entryWithName,
      -5,
      'Missed the stop',
      'org1',
      client,
    );
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error).not.toBeInstanceOf(CorrectionInputError);
  });
});

describe('isStillQueued', () => {
  const offline = () =>
    fakeRpcClient(() =>
      Promise.resolve({ data: null, error: { message: 'Failed to fetch' }, status: 0 }),
    );

  it('is true while the correction is in the outbox — saved, not lost', async () => {
    const outcome = await attemptCorrection(
      heat,
      stoppedEntry,
      190,
      'Missed the stop',
      'org1',
      offline(),
      {
        now: fixedNow,
      },
    );
    expect(outcome.check.flushResult.stopped).toBe(true);
    expect(await isStillQueued(outcome.check)).toBe(true);
    expect(await countPendingOperations()).toBe(1);
  });

  it('is false once the correction has been applied', async () => {
    const outcome = await attemptCorrection(
      heat,
      stoppedEntry,
      190,
      'Missed the stop',
      'org1',
      fakeRpcClient(),
      {
        now: fixedNow,
      },
    );
    expect(await isStillQueued(outcome.check)).toBe(false);
  });

  it('is false when the server refused THIS correction — that is a drop, not a wait', async () => {
    const refusing = fakeRpcClient(() =>
      Promise.resolve({
        data: null,
        error: { code: 'P0002', message: 'CONFLICT: heat is confirmed', details: '{}' },
        status: 500,
      }),
    );
    const outcome = await attemptCorrection(
      heat,
      stoppedEntry,
      190,
      'Missed the stop',
      'org1',
      refusing,
      {
        now: fixedNow,
      },
    );
    expect(await isStillQueued(outcome.check)).toBe(false);
  });

  it('reads the outbox, not the flush result: a "stopped" flush for a write that already landed is not queued', async () => {
    // Ours applied; a LATER operation is what stopped the flush.
    const check = { operationId: 'gone', flushResult: { processed: 1, stopped: true } };
    expect(await isStillQueued(check)).toBe(false);
  });

  it('…and a clean-looking flush for a write that is still in the outbox is queued', async () => {
    const { id } = await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    const check = { operationId: id, flushResult: { processed: 3, stopped: false } };
    expect(await isStillQueued(check)).toBe(true);
  });

  it('says the time stays the old one and not to edit it again', () => {
    expect(describeQueuedCorrection('Cupper One')).toBe(
      "Cupper One's correction is saved on this device and will sync when the connection is back. The time shown stays the old one until then, so don't edit it again.",
    );
    expect(describeQueuedCorrection(undefined)).toContain("Cupper's correction");
  });
});

describe('describeCorrectionError — details', () => {
  it('reads the conflict detail from either field name the client library uses', () => {
    const detail = JSON.stringify({ current_elapsed_secs: 0, expected_elapsed_secs: 200 });
    for (const field of ['details', 'detail']) {
      const message = describeCorrectionError({
        code: 'P0002',
        message: 'CONFLICT',
        [field]: detail,
      });
      expect(message).toContain('changed elsewhere');
      // A current time of 0:00 is a time, not "missing" — it must be named.
      expect(message).toContain('0:00');
    }
  });
});

describe('loadPendingWork', () => {
  it('lists the entries with a queued correction and whether THIS heat has a queued confirm', async () => {
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he1' });
    await enqueueOperation('correct_heat_time', { p_heat_entry_id: 'he2' });
    await enqueueOperation('confirm_heat', { p_heat_id: 'h1' });
    await enqueueOperation('confirm_heat', { p_heat_id: 'h9' });
    await enqueueOperation('record_heat_time', { p_heat_entry_id: 'he3' });

    const forH1 = await loadPendingWork('h1');
    expect([...forH1.queuedEntryIds].sort()).toEqual(['he1', 'he2']);
    expect(forH1.confirmQueued).toBe(true);

    const forH2 = await loadPendingWork('h2');
    expect(forH2.confirmQueued).toBe(false);
  });

  it('is empty when nothing is queued, and never throws', async () => {
    const work = await loadPendingWork('h1');
    expect(work.queuedEntryIds.size).toBe(0);
    expect(work.confirmQueued).toBe(false);
  });
});

describe('correctHeatTime — an absurd time', () => {
  it('accepts a day and refuses a second more, locally, before anything is queued', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(heat, stoppedEntry, MAX_RAW_SECS + 1, 'Wrong cupper', 'org1', client),
    ).rejects.toMatchObject({ name: 'CorrectionInputError', field: 'time' });
    expect(await countPendingOperations()).toBe(0);
    await correctHeatTime(heat, stoppedEntry, MAX_RAW_SECS, 'Wrong cupper', 'org1', client, {
      now: fixedNow,
    });
    expect(client.calls[0][1].p_elapsed_secs).toBe(480);
    expect(client.calls[0][1].p_elapsed_secs_raw).toBe(MAX_RAW_SECS);
  });
});

describe('correctHeatTime — an absurd figure is the person\u2019s input, not a crash', () => {
  it('Infinity (a runaway minutes field) is refused as a CorrectionInputError, not a technical Error', async () => {
    const client = fakeRpcClient();
    await expect(
      correctHeatTime(heat, stoppedEntry, Infinity, 'Wrong cupper', 'org1', client),
    ).rejects.toMatchObject({ name: 'CorrectionInputError', field: 'time' });
    expect(await countPendingOperations()).toBe(0);
  });
});
