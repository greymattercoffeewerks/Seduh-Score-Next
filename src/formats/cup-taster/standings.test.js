import { describe, it, expect, beforeEach } from 'vitest';
import {
  rankStandingRows,
  fetchStandingsForStage,
  resolveAdvancement,
  createTiebreakHeatForTie,
  fetchTiebreakHeatOutcome,
  belowTheLine,
  buildResolveStagePayload,
  resolveStageHandlers,
  commitStageResolution,
  findNextStage,
} from './standings.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

// Same shape as heats.test.js's own fixture, extended with update() —
// commitStageResolution needs both insert and update.
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
        in: (...args) => {
          calls.push(['in', table, ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', table, ...args]);
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

const identityRandom = () => 0.999;

describe('rankStandingRows', () => {
  it('ranks by most correct first', () => {
    const rows = [
      { entry_id: 'e1', numCorrect: 3, total_elapsed_secs: 100 },
      { entry_id: 'e2', numCorrect: 5, total_elapsed_secs: 200 },
    ];
    const ranked = rankStandingRows(rows);
    expect(ranked[0].item.entry_id).toBe('e2');
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].item.entry_id).toBe('e1');
    expect(ranked[1].position).toBe(2);
  });

  it('breaks a tie on correctness by fastest time', () => {
    const rows = [
      { entry_id: 'slow', numCorrect: 4, total_elapsed_secs: 300 },
      { entry_id: 'fast', numCorrect: 4, total_elapsed_secs: 100 },
    ];
    const ranked = rankStandingRows(rows);
    expect(ranked[0].item.entry_id).toBe('fast');
    expect(ranked[1].item.entry_id).toBe('slow');
  });

  it('treats a null elapsed time as infinitely slow, not as a false tie-break win', () => {
    const rows = [
      { entry_id: 'no-time-yet', numCorrect: 4, total_elapsed_secs: null },
      { entry_id: 'has-time', numCorrect: 4, total_elapsed_secs: 500 },
    ];
    const ranked = rankStandingRows(rows);
    expect(ranked[0].item.entry_id).toBe('has-time');
    expect(ranked[1].item.entry_id).toBe('no-time-yet');
  });

  it('a genuine tie (same correct, same time) shares one position', () => {
    const rows = [
      { entry_id: 'a', numCorrect: 4, total_elapsed_secs: 100 },
      { entry_id: 'b', numCorrect: 4, total_elapsed_secs: 100 },
    ];
    const ranked = rankStandingRows(rows);
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].position).toBe(1);
  });

  // scoring-auditor, 2026-09-06 (reviewing the ct_standings fan-out fix):
  // `byFastestTime` used to compute `Infinity - Infinity` (NaN) whenever
  // two-or-more untimed rows tied on numCorrect — the everyday state of
  // every stage entry before its heat has run, not an exotic edge case.
  // NaN reads as "not a tie" to chainComparators/rank(), so these three
  // untimed cuppers got sequential positions 1/2/3 instead of sharing one.
  it('two or more untimed rows tied on correct count share one position, not NaN-sequential ones', () => {
    const rows = [
      { entry_id: 'a', numCorrect: 0, total_elapsed_secs: null },
      { entry_id: 'b', numCorrect: 0, total_elapsed_secs: null },
      { entry_id: 'c', numCorrect: 0, total_elapsed_secs: null },
    ];
    const ranked = rankStandingRows(rows);
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].position).toBe(1);
    expect(ranked[2].position).toBe(1);
  });
});

describe('fetchStandingsForStage', () => {
  it('merges stage entries with their standings row and roster name, ranked', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8 };
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 3, sets_scored: 6, total_elapsed_secs: 200 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 150 },
    ];
    const roster = [
      { id: 'e1', display_name: 'Alex' },
      { id: 'e2', display_name: 'Jordan' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
      },
    });

    const { stage: returnedStage, ranked } = await fetchStandingsForStage('s1', client);

    expect(returnedStage).toEqual(stage);
    expect(ranked[0].item.entry_id).toBe('e2');
    expect(ranked[0].item.displayName).toBe('Jordan');
    expect(ranked[0].item.stageEntryId).toBe('se2');
    expect(ranked[1].item.entry_id).toBe('e1');
  });

  it('a stage entry with no standings row yet (heat not scored) defaults to 0 correct, null time — ranked last, never omitted', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8 };
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: {
          data: [
            {
              entry_id: 'e1',
              stage_id: 's1',
              correct_count: 1,
              sets_scored: 6,
              total_elapsed_secs: 90,
            },
          ],
          error: null,
        },
        event_entries: {
          data: [
            { id: 'e1', display_name: 'Alex' },
            { id: 'e2', display_name: 'Jordan' },
          ],
          error: null,
        },
      },
    });

    const { ranked } = await fetchStandingsForStage('s1', client);
    expect(ranked).toHaveLength(2);
    const unscored = ranked.find((r) => r.item.entry_id === 'e2');
    expect(unscored.item.numCorrect).toBe(0);
    expect(unscored.item.total_elapsed_secs).toBeNull();
    expect(ranked[ranked.length - 1].item.entry_id).toBe('e2');
  });
});

describe('resolveAdvancement', () => {
  it('is a thin pass-through to core/advancement.computeAdvancement', () => {
    const ranked = [
      { item: { entry_id: 'e1' }, position: 1 },
      { item: { entry_id: 'e2' }, position: 2 },
    ];
    const result = resolveAdvancement(ranked, 1);
    expect(result.advancing).toEqual([ranked[0]]);
    expect(result.tiedAtBorder).toEqual([]);
    expect(result.tiebreakNeeded).toBe(false);
  });

  it('flags a border tie exactly like core/advancement does directly', () => {
    const ranked = [
      { item: { entry_id: 'a' }, position: 1 },
      { item: { entry_id: 'b' }, position: 1 },
    ];
    const result = resolveAdvancement(ranked, 1);
    expect(result.tiebreakNeeded).toBe(true);
    expect(result.tiedAtBorder).toHaveLength(2);
  });
});

describe('createTiebreakHeatForTie', () => {
  it('unwraps the { item, position } ranking envelope and creates the tiebreak heat', async () => {
    const tiedAtBorder = [
      { item: { entry_id: 'e1', stageEntryId: 'se1' }, position: 8 },
      { item: { entry_id: 'e2', stageEntryId: 'se2' }, position: 8 },
    ];
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, duration_secs: 480 };
    const createdHeat = { id: 'tb1', stage_id: 's1', heat_number: 1, kind: 'tiebreak' };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_heats: [
          { data: [], error: null },
          { data: null, error: null },
          { data: createdHeat, error: null },
        ],
        ct_heat_entries: [
          { data: [], error: null },
          { data: [{ entry_id: 'e1' }, { entry_id: 'e2' }], error: null },
          { data: [{ entry_id: 'e1' }, { entry_id: 'e2' }], error: null },
        ],
      },
    });

    const result = await createTiebreakHeatForTie(
      's1',
      tiedAtBorder,
      { random: identityRandom },
      client,
    );
    expect(result.heat).toEqual(createdHeat);
    const heatInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heats',
    );
    expect(heatInsert[2].kind).toBe('tiebreak');
  });
});

describe('fetchTiebreakHeatOutcome', () => {
  const stageRanked = [
    { item: { entry_id: 'e1', stageEntryId: 'se1', displayName: 'Alex' }, position: 8 },
    { item: { entry_id: 'e2', stageEntryId: 'se2', displayName: 'Jordan' }, position: 8 },
  ];

  it("counts each entry's own correct results and pairs them with their elapsed time, ranked", async () => {
    const heat = { id: 'tb1', stage_id: 's1' };
    const heatEntries = [
      { id: 'he1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 40 },
      { id: 'he2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 30 },
    ];
    const results = [
      { heat_entry_id: 'he1', set_id: 'set1', correct: true },
      { heat_entry_id: 'he2', set_id: 'set1', correct: true },
    ];
    const client = fakeClient({
      tables: {
        ct_heat_entries: { data: heatEntries, error: null },
        ct_results: { data: results, error: null },
      },
    });

    const ranked = await fetchTiebreakHeatOutcome(heat, stageRanked, client);
    // Both correct once — fastest time (e2) wins.
    expect(ranked[0].item.entry_id).toBe('e2');
    expect(ranked[1].item.entry_id).toBe('e1');
  });

  it("carries the stage-level stageEntryId and displayName through onto each row — needed to target the right ct_stage_entries row when a tiebreak result is committed, and to render the coin-toss picker (found in live browser verification: the picker's checkboxes rendered with no visible name at all until this was added)", async () => {
    const heat = { id: 'tb1', stage_id: 's1' };
    const heatEntries = [{ id: 'he1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 40 }];
    const client = fakeClient({
      tables: {
        ct_heat_entries: { data: heatEntries, error: null },
        ct_results: { data: [], error: null },
      },
    });

    const ranked = await fetchTiebreakHeatOutcome(heat, stageRanked, client);
    expect(ranked[0].item.stageEntryId).toBe('se1');
    expect(ranked[0].item.displayName).toBe('Alex');
  });

  it('an entry with zero correct results still appears, at 0 correct — never silently dropped', async () => {
    const heat = { id: 'tb1', stage_id: 's1' };
    const heatEntries = [
      { id: 'he1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 40 },
      { id: 'he2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 30 },
    ];
    const results = [{ heat_entry_id: 'he1', set_id: 'set1', correct: true }];
    const client = fakeClient({
      tables: {
        ct_heat_entries: { data: heatEntries, error: null },
        ct_results: { data: results, error: null },
      },
    });

    const ranked = await fetchTiebreakHeatOutcome(heat, stageRanked, client);
    expect(ranked).toHaveLength(2);
    const zeroScorer = ranked.find((r) => r.item.entry_id === 'e2');
    expect(zeroScorer.item.numCorrect).toBe(0);
  });

  it('never queries ct_results when the heat has no entries yet', async () => {
    const heat = { id: 'tb1', stage_id: 's1' };
    const client = fakeClient({
      tables: { ct_heat_entries: { data: [], error: null } },
    });
    await fetchTiebreakHeatOutcome(heat, stageRanked, client);
    expect(client.calls.some(([, table]) => table === 'ct_results')).toBe(false);
  });
});

describe('belowTheLine', () => {
  it('excludes every entry in advancing or tiedAtBorder, keeping the rest with their original position', () => {
    const ranked = [
      { item: { stageEntryId: 'se1' }, position: 1 },
      { item: { stageEntryId: 'se2' }, position: 2 },
      { item: { stageEntryId: 'se3' }, position: 2 },
      { item: { stageEntryId: 'se4' }, position: 4 },
    ];
    const advancing = [ranked[0]];
    const tiedAtBorder = [ranked[1], ranked[2]];
    const result = belowTheLine(ranked, advancing, tiedAtBorder);
    expect(result).toEqual([ranked[3]]);
  });
});

// Real commitStageResolution ("insert advancing entries, loop-update
// eliminated/below-cutoff rows, flip stage status") is now the RESPONSIBILITY
// of the resolve_stage RPC (migration 20260906060000) — proven atomically,
// under real RLS, in supabase/tests/009_resolve_stage.sql. This module's own
// job, since the 2026-09-06 outbox-wiring follow-up, is narrower: reshape a
// resolved plan into that RPC's exact payload (buildResolveStagePayload),
// enqueue it, and flush it through the outbox exactly like every other
// write in this app (confirm_heat, start_heat/record_heat_time/
// auto_max_heat, publish_session) — so these tests mirror scoring.test.js's
// own submitConfirmHeat suite, not the old direct-write assertions.
describe('buildResolveStagePayload', () => {
  const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
  const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2 };

  it("reshapes a cutoff-stage plan into the RPC's own snake_case param names", () => {
    const plan = {
      stage,
      nextStage,
      advancingEntries: [
        { entryId: 'e1', source: 'advanced' },
        { entryId: 'e2', source: 'tiebreak_won' },
      ],
      championStageEntryId: null,
      eliminated: [{ stageEntryId: 'se3', viaCoinToss: false }],
      finalPosition: 3,
      belowCutoff: [{ stageEntryId: 'se4', position: 4 }],
      coinTossNote: null,
    };
    const payload = buildResolveStagePayload(plan, 'org1');

    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_stage_id).toBe('s1');
    expect(payload.p_next_stage_id).toBe('s2');
    expect(payload.p_advancing_entries).toEqual([
      { entry_id: 'e1', source: 'advanced' },
      { entry_id: 'e2', source: 'tiebreak_won' },
    ]);
    expect(payload.p_champion_stage_entry_id).toBeNull();
    expect(payload.p_eliminated).toEqual([{ stage_entry_id: 'se3', via_coin_toss: false }]);
    expect(payload.p_final_position).toBe(3);
    expect(payload.p_below_cutoff).toEqual([{ stage_entry_id: 'se4', position: 4 }]);
    expect(payload.p_coin_toss_note).toBeNull();
    // A fresh idempotency key per call — submitConfirmHeat's own established
    // shape (scoring.test.js).
    expect(payload.p_operation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('at the terminal stage, p_next_stage_id is null and p_champion_stage_entry_id is threaded through', () => {
    const terminalStage = { id: 's3', event_id: 'ev1', ordinal: 3, cutoff: null };
    const plan = {
      stage: terminalStage,
      nextStage: null,
      advancingEntries: [{ entryId: 'champ', source: 'advanced' }],
      championStageEntryId: 'se-champ',
      eliminated: [],
      finalPosition: 2,
      belowCutoff: [],
      coinTossNote: null,
    };
    const payload = buildResolveStagePayload(plan, 'org1');
    expect(payload.p_next_stage_id).toBeNull();
    expect(payload.p_champion_stage_entry_id).toBe('se-champ');
  });

  it('carries the coin-toss note through unchanged', () => {
    const plan = {
      stage,
      nextStage,
      advancingEntries: [],
      championStageEntryId: null,
      eliminated: [],
      finalPosition: 9,
      belowCutoff: [],
      coinTossNote: 'coin toss, witnessed by organiser',
    };
    const payload = buildResolveStagePayload(plan, 'org1');
    expect(payload.p_coin_toss_note).toBe('coin toss, witnessed by organiser');
  });
});

describe('resolveStageHandlers', () => {
  it('maps resolve_stage to a real, callable RPC-wrapping handler', () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: null }) };
    const handlers = resolveStageHandlers(client);
    expect(Object.keys(handlers)).toEqual(['resolve_stage']);
    expect(typeof handlers.resolve_stage).toBe('function');
  });
});

describe('commitStageResolution', () => {
  it('enqueues then flushes, calling resolve_stage with the exact expected payload shape', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2 };
    const plan = {
      stage,
      nextStage,
      advancingEntries: [
        { entryId: 'e1', source: 'advanced' },
        { entryId: 'e2', source: 'tiebreak_won' },
      ],
      championStageEntryId: null,
      eliminated: [{ stageEntryId: 'se3', viaCoinToss: false }],
      finalPosition: 3,
      belowCutoff: [{ stageEntryId: 'se4', position: 4 }],
      coinTossNote: null,
    };

    const result = await commitStageResolution(plan, 'org1', client);

    expect(result.processed).toBe(1);
    expect(result.stopped).toBe(false);
    expect(rpcCalls).toHaveLength(1);
    const [name, payload] = rpcCalls[0];
    expect(name).toBe('resolve_stage');
    expect(payload.p_org_id).toBe('org1');
    expect(payload.p_stage_id).toBe('s1');
    expect(payload.p_next_stage_id).toBe('s2');
    expect(payload.p_advancing_entries).toEqual([
      { entry_id: 'e1', source: 'advanced' },
      { entry_id: 'e2', source: 'tiebreak_won' },
    ]);
    expect(payload.p_eliminated).toEqual([{ stage_entry_id: 'se3', via_coin_toss: false }]);
    expect(payload.p_below_cutoff).toEqual([{ stage_entry_id: 'se4', position: 4 }]);
  });

  it('at the terminal stage, sends p_next_stage_id: null and the champion stage entry id — never an insert', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const stage = { id: 's1', event_id: 'ev1', ordinal: 3, cutoff: null };
    const plan = {
      stage,
      nextStage: null,
      advancingEntries: [{ entryId: 'champ', source: 'advanced' }],
      championStageEntryId: 'se-champ',
      eliminated: [],
      finalPosition: 2,
      belowCutoff: [],
      coinTossNote: null,
    };

    await commitStageResolution(plan, 'org1', client);

    const [, payload] = rpcCalls[0];
    expect(payload.p_next_stage_id).toBeNull();
    expect(payload.p_champion_stage_entry_id).toBe('se-champ');
  });

  it('persists the operation before the network call resolves', async () => {
    // A controlled, later-resolved promise rather than one that never
    // resolves at all — flushOutbox() tracks its in-flight state in a
    // module-level variable shared across every test in this file, so a
    // permanently-hanging flush here would silently block every later
    // test's own flushOutbox() call, not just this one (scoring.test.js's
    // own identical submitConfirmHeat test carries the same caveat).
    let resolveRpc;
    const rpcPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    const client = { rpc: () => rpcPromise };
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
    const plan = {
      stage,
      nextStage: null,
      advancingEntries: [],
      championStageEntryId: null,
      eliminated: [],
      finalPosition: 1,
      belowCutoff: [],
      coinTossNote: null,
    };
    const commitPromise = commitStageResolution(plan, 'org1', client);
    await Promise.resolve();
    await Promise.resolve();
    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBeGreaterThanOrEqual(1);
    resolveRpc({ data: null, error: null });
    await commitPromise;
  });

  it('any error resolve_stage itself returns is treated as permanent — never left stuck retrying the exact same rejected payload', async () => {
    const client = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: 'resolve_stage: entry e9 is not a member of stage s1' },
          // A genuine server-side rejection carries a real, non-zero HTTP
          // status — buildRpcHandler (core/outbox.js) is what actually
          // distinguishes this from a network-level failure.
          status: 400,
        }),
    };
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
    const plan = {
      stage,
      nextStage: null,
      advancingEntries: [],
      championStageEntryId: null,
      eliminated: [],
      finalPosition: 1,
      belowCutoff: [],
      coinTossNote: null,
    };
    const result = await commitStageResolution(plan, 'org1', client);
    expect(result.permanentFailure).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.error.message).toContain('not a member of stage');

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(0);
  });

  it('a network-level failure (the RPC call itself rejecting, not resolve_stage returning an error) stays retryable, not permanent', async () => {
    const client = { rpc: () => Promise.reject(new Error('fetch failed')) };
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
    const plan = {
      stage,
      nextStage: null,
      advancingEntries: [],
      championStageEntryId: null,
      eliminated: [],
      finalPosition: 1,
      belowCutoff: [],
      coinTossNote: null,
    };
    const result = await commitStageResolution(plan, 'org1', client);
    expect(result.permanentFailure).toBe(false);
    expect(result.stopped).toBe(true);

    const { countPendingOperations } = await import('../../core/outbox.js');
    expect(await countPendingOperations()).toBe(1);
  });

  // The authoritative idempotency proof — replaying the exact same
  // operation_id is a safe no-op via processed_operations' own early
  // return — is a server-side guarantee, proven against a real Postgres
  // instance under real RLS in supabase/tests/009_resolve_stage.sql (mirrors
  // 005_confirm_heat.sql's/007_timing_outbox_rpcs.sql's own established
  // idempotency-proof pattern: a fake JS client can only ever assert what it
  // was told to return, never a real ledger's dedup behavior). This test
  // only proves the JS layer itself adds no client-side de-dup of its own
  // that would mask or interfere with that server behavior — replaying an
  // identical payload (same p_operation_id included) is passed straight
  // through to the RPC twice, exactly as a real client-side retry would.
  it('replaying an identical payload (same operation id) is passed straight through — no client-side de-dup masks the server-side idempotency guarantee', async () => {
    const rpcCalls = [];
    const client = {
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    };
    const fixedOperationId = '11111111-1111-1111-1111-111111111111';
    const payload = {
      p_operation_id: fixedOperationId,
      p_org_id: 'org1',
      p_stage_id: 's1',
      p_next_stage_id: 's2',
      p_advancing_entries: [{ entry_id: 'e1', source: 'advanced' }],
      p_champion_stage_entry_id: null,
      p_eliminated: [],
      p_final_position: 2,
      p_below_cutoff: [],
      p_coin_toss_note: null,
    };
    const handlers = resolveStageHandlers(client);
    await handlers.resolve_stage(payload);
    await handlers.resolve_stage(payload);

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0][1].p_operation_id).toBe(fixedOperationId);
    expect(rpcCalls[1][1].p_operation_id).toBe(fixedOperationId);
  });
});

describe('findNextStage', () => {
  it('returns null at the terminal stage without querying', async () => {
    const client = fakeClient({ tables: {} });
    const result = await findNextStage({ event_id: 'ev1', ordinal: 3, cutoff: null }, client);
    expect(result).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it('looks up ordinal + 1 for a cutoff stage', async () => {
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2 };
    const client = fakeClient({ tables: { ct_stages: { data: nextStage, error: null } } });
    const result = await findNextStage({ event_id: 'ev1', ordinal: 1, cutoff: 8 }, client);
    expect(result).toEqual(nextStage);
    const ordinalCall = client.calls.find(
      ([action, , col]) => action === 'eq' && col === 'ordinal',
    );
    expect(ordinalCall[3]).toBe(2);
  });
});
