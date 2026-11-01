import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  archiveStagingHandler,
  enqueueArchiveStaging,
  submitArchiveStaging,
  STAGE_ARCHIVE_OPERATION,
} from './archiveStaging.js';
import { listAllOperations } from './outbox.js';
import { _clearAllForTests } from './db.js';

const intent = { orgId: 'org1', eventId: 'ev1', operationId: 'op-1' };
const podium = { podium: [{ name: 'A' }] };

function fakeClient(result = { data: { staged: true }, error: null, status: 200 }) {
  const calls = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve(result);
    },
  };
}

beforeEach(async () => {
  await _clearAllForTests();
});

describe('archiveStagingHandler', () => {
  it("sends the built snapshot with the intent's own operation id and a clock taken BEFORE the reads", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
      const client = fakeClient();
      const handler = archiveStagingHandler(client, async () => {
        vi.setSystemTime(new Date('2026-11-01T10:00:09.000Z'));
        return podium;
      });
      await handler(intent);
      expect(client.calls).toEqual([
        [
          'stage_archive_payload',
          {
            p_operation_id: 'op-1',
            p_org_id: 'org1',
            p_event_id: 'ev1',
            p_payload: podium,
            p_built_at: '2026-11-01T10:00:00.000Z',
          },
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the SAME operation id on a replay (the idempotency key does not change per attempt)', async () => {
    const client = fakeClient();
    const handler = archiveStagingHandler(client, async () => podium);
    await handler(intent);
    await handler(intent);
    expect(client.calls.map(([, args]) => args.p_operation_id)).toEqual(['op-1', 'op-1']);
  });

  it('a null snapshot completes as a no-op: no RPC, no throw', async () => {
    const client = fakeClient();
    await archiveStagingHandler(client, async () => null)(intent);
    expect(client.calls).toEqual([]);
  });

  it('a network failure while reading stays retryable; a bug in building is permanent', async () => {
    await expect(
      archiveStagingHandler(fakeClient(), async () => {
        throw { code: '', message: 'Failed to fetch' };
      })(intent),
    ).rejects.toMatchObject({ permanent: false });
    await expect(
      archiveStagingHandler(fakeClient(), async () => {
        throw new TypeError('bug');
      })(intent),
    ).rejects.toMatchObject({ permanent: true });
  });

  it('a server refusal is permanent (dropped, not wedged at the head of the queue); a dropped connection is not', async () => {
    const build = async () => podium;
    await expect(
      archiveStagingHandler(
        fakeClient({ data: null, error: { code: '42501', message: 'no' }, status: 400 }),
        build,
      )(intent),
    ).rejects.toMatchObject({ permanent: true });
    await expect(
      archiveStagingHandler(
        fakeClient({ data: null, error: { code: '', message: 'x' }, status: 0 }),
        build,
      )(intent),
    ).rejects.toMatchObject({ permanent: false });
  });

  it('benign server answers (dark, duplicate, ...) are not errors: the operation completes', async () => {
    const client = fakeClient({
      data: { staged: false, reason: 'dark' },
      error: null,
      status: 200,
    });
    await expect(
      archiveStagingHandler(client, async () => podium)(intent),
    ).resolves.toBeUndefined();
  });
});

describe('enqueueArchiveStaging', () => {
  it('queues one operation carrying a fresh operation id and the organisation', async () => {
    expect(await enqueueArchiveStaging({ orgId: 'org1', eventId: 'ev1', isTest: false })).toBe(
      true,
    );
    const ops = await listAllOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(STAGE_ARCHIVE_OPERATION);
    expect(ops[0].orgId).toBe('org1');
    expect(ops[0].payload).toMatchObject({ orgId: 'org1', eventId: 'ev1' });
    expect(ops[0].payload.operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never queues for a test event, and insists isTest is explicit', async () => {
    expect(await enqueueArchiveStaging({ orgId: 'o', eventId: 'e', isTest: true })).toBe(false);
    expect(await listAllOperations()).toHaveLength(0);
    await expect(enqueueArchiveStaging({ orgId: 'o', eventId: 'e' })).rejects.toThrow(TypeError);
  });
});

describe('submitArchiveStaging', () => {
  it('enqueues first, then flushes through the handler map', async () => {
    const client = fakeClient();
    const handlers = {
      [STAGE_ARCHIVE_OPERATION]: archiveStagingHandler(client, async () => podium),
    };
    await submitArchiveStaging({ orgId: 'o', eventId: 'e', isTest: false }, handlers);
    expect(client.calls).toHaveLength(1);
    expect(await listAllOperations()).toHaveLength(0);
  });

  it('does nothing for a test event', async () => {
    expect(await submitArchiveStaging({ orgId: 'o', eventId: 'e', isTest: true }, {})).toBeNull();
    expect(await listAllOperations()).toHaveLength(0);
  });
});
