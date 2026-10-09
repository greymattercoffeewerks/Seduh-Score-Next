import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  publishIntentHandler,
  submitPublishIntent,
  enqueuePublishIntent,
} from './publishIntent.js';
import { listPendingOperations } from './outbox.js';
import { _clearAllForTests } from './db.js';

const intent = { orgId: 'org1', eventId: 'ev1', format: 'fmt', isTest: true, extra: 'x' };

function fakeClient(rpcResult = { data: null, error: null, status: 204 }) {
  const calls = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  };
}

beforeEach(async () => {
  await _clearAllForTests();
});

describe('publishIntentHandler', () => {
  it("sends the format's payload through publish_session with the intent's own identity and a snapshot clock taken BEFORE the reads", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-09T10:00:00.000Z'));
      const client = fakeClient();
      const handler = publishIntentHandler(client, async () => {
        vi.setSystemTime(new Date('2026-10-09T10:00:05.000Z')); // the reads take 5 s
        return { hello: 'world' };
      });
      await handler(intent);
      const [name, args] = client.calls[0];
      expect(name).toBe('publish_session');
      expect(args).toMatchObject({
        p_org_id: 'org1',
        p_event_id: 'ev1',
        p_format: 'fmt',
        p_is_test: true,
        p_payload: { hello: 'world' },
        p_snapshot_at: '2026-10-09T10:00:00.000Z',
      });
      expect(typeof args.p_operation_id).toBe('string');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the whole intent to buildPayload', async () => {
    const buildPayload = vi.fn(async () => ({}));
    await publishIntentHandler(fakeClient(), buildPayload)(intent);
    expect(buildPayload).toHaveBeenCalledWith(intent);
  });

  it('a null payload completes as a no-op: nothing is published and nothing throws', async () => {
    const client = fakeClient();
    await expect(publishIntentHandler(client, async () => null)(intent)).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(0);
  });

  describe('a failed read is classified so the queue neither blocks forever nor drops a good publish', () => {
    // A REAL event's intent: a missing row on a test event is a no-op (below), not a failure.
    const failWith = (error) =>
      publishIntentHandler(fakeClient(), async () => {
        throw error;
      })({ ...intent, isTest: false });

    it.each([
      ['a network drop (code "")', { code: '', message: 'Failed to fetch' }],
      ['a gateway body with no code', { message: 'Bad gateway' }],
      ['permission denied (an expired session reads as anonymous)', { code: '42501' }],
      ['a transient SQLSTATE', { code: '40001' }],
    ])('%s is retried (not permanent)', async (_label, error) => {
      await expect(failWith(error)).rejects.toMatchObject({ permanent: false });
    });

    it.each([
      ['a row that is not there', { code: 'PGRST116', message: 'no rows' }],
      ['a malformed id', { code: '22P02', message: 'invalid input syntax for type uuid' }],
      ['a plain Error from our own code (a bug)', new Error('our own bug')],
      [
        'an Error carrying an undefined code',
        Object.assign(new Error('rewrapped'), { code: undefined }),
      ],
    ])('%s is permanent, and keeps the original as the cause', async (_label, error) => {
      const failure = await failWith(error).catch((e) => e);
      expect(failure.permanent).toBe(true);
      expect(failure.cause).toBe(error);
    });

    it('keeps the code, details and message for the sync panel', async () => {
      await expect(
        failWith({ code: 'PGRST116', message: 'no rows', details: 'zero rows' }),
      ).rejects.toMatchObject({ code: 'PGRST116', message: 'no rows', details: 'zero rows' });
    });
  });

  it('uses a fresh operation id for every attempt, so publish_session never mistakes a retry for a replay', async () => {
    const client = fakeClient();
    const handler = publishIntentHandler(client, async () => ({}));
    await handler(intent);
    await handler(intent);
    const ids = client.calls.map(([, args]) => args.p_operation_id);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  describe('a test event that no longer exists', () => {
    const gone = { code: 'PGRST116', message: 'no rows' };

    it('completes as a no-op: nothing is published and nothing is reported as lost', async () => {
      const client = fakeClient();
      await expect(
        publishIntentHandler(client, async () => {
          throw gone;
        })({ ...intent, isTest: true }),
      ).resolves.toBeUndefined();
      expect(client.calls).toHaveLength(0);
    });

    it('is NOT skipped for a real event: it is permanent and reported', async () => {
      await expect(
        publishIntentHandler(fakeClient(), async () => {
          throw gone;
        })({ ...intent, isTest: false }),
      ).rejects.toMatchObject({ permanent: true, code: 'PGRST116' });
    });

    it('is only the row-not-found code: any other failure on a test event is still classified', async () => {
      await expect(
        publishIntentHandler(fakeClient(), async () => {
          throw new Error('our own bug');
        })({ ...intent, isTest: true }),
      ).rejects.toMatchObject({ permanent: true });
    });
  });

  describe('a refused publish_session call', () => {
    const refuse = (status, code) =>
      publishIntentHandler(
        fakeClient({ data: null, error: { message: 'no', code }, status }),
        async () => ({}),
      )(intent);

    it('is retried when the answer says the server or session is not ready (a 401, a timeout, a gateway 5xx)', async () => {
      await expect(refuse(401, 'PGRST301')).rejects.toMatchObject({ permanent: false });
      await expect(refuse(0, '')).rejects.toMatchObject({ permanent: false });
      await expect(refuse(503, '')).rejects.toMatchObject({ permanent: false });
    });

    it('is permanent when the server really rejects it', async () => {
      await expect(refuse(400, 'P0001')).rejects.toMatchObject({ permanent: true, code: 'P0001' });
    });
  });
});

describe('submitPublishIntent', () => {
  it('queues the intent, then flushes with the handlers it was given', async () => {
    const handler = vi.fn(async () => {});
    await submitPublishIntent('publish_x', intent, { publish_x: handler });
    expect(handler).toHaveBeenCalledWith(intent);
    expect(await listPendingOperations()).toEqual([]);
  });

  it('leaves the intent queued when the flush cannot complete (offline), for the next flush', async () => {
    const handler = vi.fn(async () => {
      throw Object.assign(new Error('offline'), { permanent: false });
    });
    await submitPublishIntent('publish_x', intent, { publish_x: handler });
    const pending = await listPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: 'publish_x', payload: intent });
  });

  it.each([undefined, null, 'true', 1])(
    'refuses an intent whose isTest is %s, and queues nothing (D9 must not be defeated by a forgotten key)',
    async (isTest) => {
      await expect(
        submitPublishIntent('publish_x', { ...intent, isTest }, { publish_x: async () => {} }),
      ).rejects.toThrow(TypeError);
      expect(await listPendingOperations()).toEqual([]);
    },
  );
});

describe('enqueuePublishIntent', () => {
  it('persists the intent without flushing it', async () => {
    const handler = vi.fn(async () => {});
    await enqueuePublishIntent('publish_x', intent);
    expect(handler).not.toHaveBeenCalled();
    const pending = await listPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: 'publish_x', payload: intent });
  });

  it.each([undefined, null, 'true'])('refuses an intent whose isTest is %s', async (isTest) => {
    await expect(enqueuePublishIntent('publish_x', { ...intent, isTest })).rejects.toThrow(
      TypeError,
    );
    expect(await listPendingOperations()).toEqual([]);
  });
});
