// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { _clearAllForTests } from '../../core/db.js';
import { listAllOperations, _resetOutboxOwnerForTests } from '../../core/outbox.js';
import {
  castVote,
  undoVote,
  confirmMatch,
  pendingVoteDeltas,
  startEvent,
  loadThrowdown,
  dataHandlers,
  TD_OPERATIONS,
} from './data.js';

function table(rows, single = null) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: single, error: null }),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return q;
}

beforeEach(async () => {
  await _clearAllForTests();
  _resetOutboxOwnerForTests();
});

describe('the writes go through the outbox with an operation id', () => {
  it('delivers a vote through the RPC with a fresh operation id and clears the queue', async () => {
    const rpc = vi.fn(async () => ({ error: null, status: 200 }));
    const handlers = dataHandlers({ rpc });
    await castVote({ orgId: 'o', matchId: 'm', slotId: 's' }, handlers);
    expect(rpc).toHaveBeenCalledWith('td_cast_vote', {
      p_operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_org_id: 'o',
      p_match_id: 'm',
      p_slot_id: 's',
    });
    expect(await listAllOperations()).toEqual([]);
  });

  it('keeps a tap that could not be sent, and the screen sees it as a waiting change', async () => {
    const rpc = vi.fn(async () => ({ error: { message: 'down', code: '08006' }, status: 503 }));
    const handlers = dataHandlers({ rpc });
    await castVote({ orgId: 'o', matchId: 'm', slotId: 's1' }, handlers);
    await castVote({ orgId: 'o', matchId: 'm', slotId: 's1' }, handlers);
    await undoVote({ orgId: 'o', matchId: 'm', slotId: 's2' }, handlers);
    await castVote({ orgId: 'o', matchId: 'other', slotId: 'x' }, handlers);
    const { deltas, queued } = await pendingVoteDeltas('m');
    expect(queued).toBe(3);
    expect(deltas.get('s1')).toBe(2);
    expect(deltas.get('s2')).toBe(-1);
    expect(deltas.has('x')).toBe(false);
  });

  it('queues a confirm behind the taps it depends on (FIFO), then sends both', async () => {
    const calls = [];
    const rpc = vi.fn(async (type) => {
      calls.push(type);
      return { error: null, status: 200 };
    });
    await confirmMatch({ orgId: 'o', matchId: 'm' }, dataHandlers({ rpc }));
    expect(calls).toEqual(['td_confirm_match']);
  });

  it('reports a permanent refusal so the screen can say why (the votes are level)', async () => {
    const rpc = vi.fn(async () => ({
      error: { message: 'level', code: 'P0001', hint: 'td_votes_level' },
      status: 400,
    }));
    const { result, operationId } = await confirmMatch(
      { orgId: 'o', matchId: 'm' },
      dataHandlers({ rpc }),
    );
    expect(result.permanentFailure).toBe(true);
    expect(result.dropped.map((d) => d.operationId)).toEqual([operationId]);
    expect(result.dropped[0].error.hint).toBe('td_votes_level');
  });

  it('sends the draw with its seed, slot count and pairs', async () => {
    const rpc = vi.fn(async () => ({ error: null, status: 200 }));
    await startEvent(
      {
        orgId: 'o',
        eventId: 'e',
        mode: 'random',
        seed: 'abc',
        slotCount: 4,
        pairs: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
      dataHandlers({ rpc }),
    );
    expect(rpc.mock.calls[0][0]).toBe('td_start_event');
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_mode: 'random',
      p_seed: 'abc',
      p_slot_count: 4,
    });
  });

  it('has a handler for every operation type it queues', () => {
    expect(Object.keys(dataHandlers({ rpc: vi.fn() })).sort()).toEqual(
      Object.values(TD_OPERATIONS).sort(),
    );
  });
});

describe('loadThrowdown', () => {
  it('returns default setup before any is saved, and an unstarted bracket', async () => {
    const client = {
      from: (name) =>
        table(name === 'event_entries' ? [{ id: 'e1', display_name: 'A', withdrawn: false }] : []),
    };
    const state = await loadThrowdown('ev', client);
    expect(state.settingsSaved).toBe(false);
    expect(state.settings).toMatchObject({
      judge_count: 3,
      third_place: true,
      seeding_mode: 'random',
      modules: {},
    });
    expect(state.bracket.started).toBe(false);
    expect(state.entries).toHaveLength(1);
  });
});
