import { describe, it, expect, vi } from 'vitest';
import { invokeEdgeFunction } from './edgeFunction.js';

const responseOf = (status, body, { json } = {}) => ({
  status,
  json: json ?? (async () => body),
});
const clientWith = (invoke) => ({ functions: { invoke: vi.fn(invoke) } });

describe('invokeEdgeFunction', () => {
  it('sends the body to the named function and returns its data untouched', async () => {
    const client = clientWith(async () => ({ data: { password: 'pw' }, error: null }));
    const result = await invokeEdgeFunction(client, 'some-function', { action: 'add' });
    expect(client.functions.invoke).toHaveBeenCalledWith('some-function', {
      body: { action: 'add' },
    });
    expect(result).toEqual({ data: { password: 'pw' }, error: null });
  });

  it('an answer with no data is null data, not undefined', async () => {
    const result = await invokeEdgeFunction(
      clientWith(async () => ({ data: undefined, error: null })),
      'f',
      {},
    );
    expect(result).toEqual({ data: null, error: null });
  });

  it('a refusal reports the status, the stable hint and the parsed body', async () => {
    const body = { error: 'Words for the owner.', hint: 'member_exists' };
    const result = await invokeEdgeFunction(
      clientWith(async () => ({
        data: null,
        error: { message: 'non-2xx', context: responseOf(409, body) },
      })),
      'f',
      {},
    );
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 409, hint: 'member_exists', payload: body });
  });

  it('keeps a hint only when it has the shape the functions send', async () => {
    for (const hint of ['<script>', 'Has Capitals', 'a'.repeat(41), '', 7, null]) {
      const result = await invokeEdgeFunction(
        clientWith(async () => ({ data: null, error: { context: responseOf(400, { hint }) } })),
        'f',
        {},
      );
      expect(result.error.hint, String(hint)).toBeUndefined();
      expect(result.error.status).toBe(400);
    }
  });

  it('an answer that is not JSON still reports its status, with no body', async () => {
    const result = await invokeEdgeFunction(
      clientWith(async () => ({
        data: null,
        error: {
          context: responseOf(502, null, {
            json: async () => {
              throw new SyntaxError('Unexpected token <');
            },
          }),
        },
      })),
      'f',
      {},
    );
    expect(result.error).toEqual({ status: 502, hint: undefined, payload: null });
  });

  it('an error with no response at all is "offline": the request got no answer', async () => {
    const result = await invokeEdgeFunction(
      clientWith(async () => ({ data: null, error: { message: 'Failed to send a request' } })),
      'f',
      {},
    );
    expect(result.error).toEqual({ offline: true });
  });

  it('a call that throws is offline, and never rejects', async () => {
    const result = await invokeEdgeFunction(
      clientWith(() => Promise.reject(new TypeError('Failed to fetch'))),
      'f',
      {},
    );
    expect(result.error).toEqual({ timedOut: false, offline: true });
  });

  it('waits for ever when no timeout is given, and gives up on the one it is given', async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise(() => {});
      let unlimitedSettled = false;
      invokeEdgeFunction(clientWith(never), 'f', {}).then(() => {
        unlimitedSettled = true;
      });
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(unlimitedSettled).toBe(false);

      let result;
      invokeEdgeFunction(clientWith(never), 'f', {}, { timeoutMs: 5000 }).then((value) => {
        result = value;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual({ data: null, error: { timedOut: true, offline: false } });
    } finally {
      vi.useRealTimers();
    }
  });
});
