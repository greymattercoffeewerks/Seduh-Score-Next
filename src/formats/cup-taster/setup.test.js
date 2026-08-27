import { describe, it, expect } from 'vitest';
import {
  validateStagePlan,
  findStageByOrdinal,
  createStage,
  listSetPositions,
  listSetsForStage,
  ensureSetsForStage,
  createStagePlan,
  listStagesForEvent,
  stageHasHeats,
  saveStagePlan,
} from './setup.js';

// Matches core/registry.test.js's fake shape, extended with a `.then()` on
// the builder itself — setup.js's list/insert-many calls await the builder
// directly (no .single()/.maybeSingle()), the same way supabase-js's real
// query builder resolves to {data, error} when left unterminated. Queries are
// consumed strictly in call order per table (not filtered by the actual
// .eq() arguments), matching registry.test.js's existing fixture design —
// each test's queue is arranged to match the real sequence of calls the
// function under test makes.
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
        delete: () => {
          calls.push(['delete', table]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
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

const validTwoStage = [
  { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
  { kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
];

const validThreeStage = [
  { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 16 },
  { kind: 'semis', ordinal: 2, setCount: 5, durationSecs: 420, cutoff: 8 },
  { kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 360, cutoff: null },
];

describe('validateStagePlan', () => {
  it('accepts a valid two-stage plan (prelims + finals)', () => {
    expect(validateStagePlan(validTwoStage)).toHaveLength(2);
  });

  it('accepts a valid three-stage plan (prelims + semis + finals)', () => {
    expect(validateStagePlan(validThreeStage)).toHaveLength(3);
  });

  it('sorts by ordinal regardless of input order', () => {
    const reversed = [...validTwoStage].reverse();
    const sorted = validateStagePlan(reversed);
    expect(sorted.map((s) => s.kind)).toEqual(['prelims', 'finals']);
  });

  it('identifies the terminal stage by highest ordinal, not position in the input array', () => {
    // Passed out of order (finals first): a terminal check keyed on array
    // position rather than sorted-highest-ordinal would apply the
    // terminal-cutoff-null rule to the wrong stage here and throw.
    const reversed = [...validThreeStage].reverse();
    const sorted = validateStagePlan(reversed);
    expect(sorted[sorted.length - 1].kind).toBe('finals');
    expect(sorted[sorted.length - 1].cutoff).toBeNull();
  });

  it('does not mutate the input array', () => {
    const original = [...validTwoStage];
    const reversed = [...validTwoStage].reverse();
    const reversedCopy = [...reversed];
    validateStagePlan(reversed);
    expect(reversed).toEqual(reversedCopy);
    expect(validTwoStage).toEqual(original);
  });

  it('throws on an empty plan', () => {
    expect(() => validateStagePlan([])).toThrow('at least one stage');
  });

  it('throws when ordinals are not sequential from 1', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow('sequential starting at 1');
  });

  it('throws on an unrecognized stage kind', () => {
    const plan = [
      { kind: 'quarterfinals', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow('stage kind must be one of');
  });

  it('allows a duplicate stage kind, unlike the old fixed-sequence restriction', () => {
    // Two prelims heats-worth of stages feeding one finals — an arbitrary
    // chain, not one of the two formerly-hardcoded sequences.
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 16 },
      { kind: 'prelims', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const sorted = validateStagePlan(plan);
    expect(sorted.map((s) => s.kind)).toEqual(['prelims', 'prelims', 'finals']);
  });

  it('throws when setCount is not a positive integer', () => {
    const plan = [{ kind: 'finals', ordinal: 1, setCount: 0, durationSecs: 480, cutoff: null }];
    expect(() => validateStagePlan(plan)).toThrow('setCount must be a positive integer');
  });

  it('throws when durationSecs is not a positive integer', () => {
    const plan = [{ kind: 'finals', ordinal: 1, setCount: 5, durationSecs: 0, cutoff: null }];
    expect(() => validateStagePlan(plan)).toThrow('durationSecs must be a positive integer');
  });

  it('throws when the terminal stage carries a cutoff', () => {
    const plan = [{ kind: 'finals', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 }];
    // A single-stage "finals" plan also violates the canonical-sequence rule
    // below, but the cutoff check runs first and should be the one that fires.
    expect(() => validateStagePlan(plan)).toThrow('terminal stage — cutoff must be null');
  });

  it('throws when a non-terminal stage has no cutoff', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: null },
      { kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow(
      'non-terminal stages require a positive integer cutoff',
    );
  });

  it('throws when a non-terminal stage has a non-positive cutoff', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 0 },
      { kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow(
      'non-terminal stages require a positive integer cutoff',
    );
  });

  it("throws when a later stage's cutoff exceeds an earlier stage's cutoff", () => {
    // Semis (16) admitting more cuppers than prelims (8) sent forward —
    // core/advancement would silently treat this as "everyone advances"
    // rather than trimming the field, so it must be rejected here.
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'semis', ordinal: 2, setCount: 5, durationSecs: 420, cutoff: 16 },
      { kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 360, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow("cannot exceed the previous stage's cutoff");
  });

  it('accepts equal cutoffs across consecutive non-terminal stages', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'semis', ordinal: 2, setCount: 5, durationSecs: 420, cutoff: 8 },
      { kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 360, cutoff: null },
    ];
    expect(validateStagePlan(plan)).toHaveLength(3);
  });

  it('throws when finals runs before prelims, even though every per-stage check would pass individually', () => {
    const plan = [
      { kind: 'finals', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'prelims', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow('runs after a later-kind stage');
  });

  it('allows semis with no prelims feeding it — presence of a kind is not required, only order among the kinds present', () => {
    const plan = [
      { kind: 'semis', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const sorted = validateStagePlan(plan);
    expect(sorted.map((s) => s.kind)).toEqual(['semis', 'finals']);
  });

  it('throws when a later stage regresses to an earlier kind after semis, even skipping straight from prelims', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'semis', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: 4 },
      { kind: 'prelims', ordinal: 3, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    expect(() => validateStagePlan(plan)).toThrow('runs after a later-kind stage');
  });

  it('accepts a single-stage plan — an arbitrary chain no longer requires one of two fixed sequences', () => {
    const plan = [{ kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: null }];
    expect(validateStagePlan(plan)).toHaveLength(1);
  });

  it('accepts prelims straight to finals with no semis (one of the old fixed sequences, still valid under the general rule)', () => {
    const plan = [
      { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const sorted = validateStagePlan(plan);
    expect(sorted.map((s) => s.kind)).toEqual(['prelims', 'finals']);
  });
});

describe('findStageByOrdinal', () => {
  it('returns the matching stage', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1 };
    const client = fakeClient({ tables: { ct_stages: { data: stage, error: null } } });
    expect(await findStageByOrdinal('ev1', 1, client)).toEqual(stage);
  });

  it('returns null when no stage exists at that ordinal', async () => {
    const client = fakeClient({ tables: { ct_stages: { data: null, error: null } } });
    expect(await findStageByOrdinal('ev1', 1, client)).toBeNull();
  });
});

const prelimsConfig = { kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 };

describe('createStage', () => {
  it('creates a new stage when none exists at that ordinal, mapping camelCase input onto the row shape', async () => {
    const created = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const client = fakeClient({
      tables: {
        // findStageByOrdinal: no match; insert result
        ct_stages: [
          { data: null, error: null },
          { data: created, error: null },
        ],
      },
    });
    const result = await createStage('ev1', prelimsConfig, client);
    expect(result).toEqual(created);

    const insertCall = client.calls.find(([action]) => action === 'insert');
    expect(insertCall[2]).toEqual({
      event_id: 'ev1',
      kind: 'prelims',
      ordinal: 1,
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    });
  });

  it('returns the existing stage without inserting when one already exists with the same config', async () => {
    const existing = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const client = fakeClient({ tables: { ct_stages: { data: existing, error: null } } });
    const result = await createStage('ev1', prelimsConfig, client);
    expect(result).toEqual(existing);
    expect(client.calls.some(([action]) => action === 'insert')).toBe(false);
  });

  it('is idempotent across two real, sequential calls against a shared client', async () => {
    // A stronger proof than two independently-scripted branches: the second
    // call's "existing row" is literally the first call's own insert result.
    const created = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: null, error: null }, // call 1: findStageByOrdinal, no match
          { data: created, error: null }, // call 1: insert result
          { data: created, error: null }, // call 2: findStageByOrdinal, now matches
        ],
      },
    });
    const first = await createStage('ev1', prelimsConfig, client);
    const second = await createStage('ev1', prelimsConfig, client);
    expect(second).toEqual(first);
    expect(client.calls.filter(([action]) => action === 'insert')).toHaveLength(1);
  });

  it('throws when a stage already exists at that ordinal with a different configuration', async () => {
    const existing = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 6, // differs from prelimsConfig's cutoff: 8
    };
    const client = fakeClient({ tables: { ct_stages: { data: existing, error: null } } });
    await expect(createStage('ev1', prelimsConfig, client)).rejects.toThrow(
      'already exists with a different configuration',
    );
  });

  it('recovers from a concurrent-insert race by adopting the winning row when its config matches', async () => {
    const winner = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: null, error: null }, // initial findStageByOrdinal: no match yet
          { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert loses the race
          { data: winner, error: null }, // re-fetch after the race: the winner
        ],
      },
    });
    const result = await createStage('ev1', prelimsConfig, client);
    expect(result).toEqual(winner);
  });

  it('throws on a concurrent-insert race when the winning row has a different configuration', async () => {
    const winner = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 6, // a different organiser's config won the race
    };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: null, error: null },
          { data: null, error: { code: '23505', message: 'duplicate key' } },
          { data: winner, error: null },
        ],
      },
    });
    await expect(createStage('ev1', prelimsConfig, client)).rejects.toThrow(
      'already exists with a different configuration',
    );
  });

  it('throws the raw error on a non-unique-violation insert failure', async () => {
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: null, error: null },
          { data: null, error: { code: '55000', message: 'some other failure' } },
        ],
      },
    });
    await expect(createStage('ev1', prelimsConfig, client)).rejects.toMatchObject({
      message: 'some other failure',
    });
  });
});

describe('listSetPositions', () => {
  it('returns the positions of every existing set', async () => {
    const client = fakeClient({
      tables: { ct_sets: { data: [{ position: 1 }, { position: 3 }], error: null } },
    });
    expect(await listSetPositions('s1', client)).toEqual([1, 3]);
  });

  it('returns an empty array when no sets exist yet', async () => {
    const client = fakeClient({ tables: { ct_sets: { data: [], error: null } } });
    expect(await listSetPositions('s1', client)).toEqual([]);
  });
});

describe('listSetsForStage', () => {
  it('returns full set rows, keyed by id for scoring results', async () => {
    const client = fakeClient({
      tables: {
        ct_sets: {
          data: [
            { id: 'set1', stage_id: 's1', position: 1, label: null },
            { id: 'set2', stage_id: 's1', position: 2, label: null },
          ],
          error: null,
        },
      },
    });
    const result = await listSetsForStage('s1', client);
    expect(result).toEqual([
      { id: 'set1', stage_id: 's1', position: 1, label: null },
      { id: 'set2', stage_id: 's1', position: 2, label: null },
    ]);
  });

  // The fake client above resolves whatever `data` was fixtured verbatim —
  // it doesn't simulate `.order()` actually sorting anything, so no
  // value-based assertion against it can prove real sort behavior. This
  // is the one assertion that actually proves the function requests
  // ascending order from the real database, which is what would cause
  // real sorting server-side.
  it('requests ascending order by position from the database', async () => {
    const client = fakeClient({ tables: { ct_sets: { data: [], error: null } } });
    await listSetsForStage('s1', client);
    expect(client.calls).toContainEqual(['order', 'ct_sets', 'position', { ascending: true }]);
  });
});

describe('ensureSetsForStage', () => {
  it('creates every position from 1..setCount when none exist yet', async () => {
    const client = fakeClient({
      tables: {
        ct_sets: [
          { data: [], error: null },
          { data: [{ position: 1 }, { position: 2 }, { position: 3 }], error: null },
        ],
      },
    });
    await ensureSetsForStage('s1', 3, client);
    const insertCall = client.calls.find(([action]) => action === 'insert');
    expect(insertCall[2]).toEqual([
      { stage_id: 's1', position: 1 },
      { stage_id: 's1', position: 2 },
      { stage_id: 's1', position: 3 },
    ]);
  });

  it('only creates the positions missing from what already exists — idempotent on retry', async () => {
    const client = fakeClient({
      tables: {
        // listSetPositions: positions 1 and 3 already exist, 2 is missing
        ct_sets: [
          { data: [{ position: 1 }, { position: 3 }], error: null },
          { data: [{ position: 2 }], error: null },
        ],
      },
    });
    await ensureSetsForStage('s1', 3, client);
    const insertCall = client.calls.find(([action]) => action === 'insert');
    expect(insertCall[2]).toEqual([{ stage_id: 's1', position: 2 }]);
  });

  it('does not call insert at all when every position already exists', async () => {
    const client = fakeClient({
      tables: { ct_sets: { data: [{ position: 1 }, { position: 2 }], error: null } },
    });
    await ensureSetsForStage('s1', 2, client);
    expect(client.calls.some(([action]) => action === 'insert')).toBe(false);
  });

  it('recovers from a concurrent-insert race by inserting only whatever is still missing', async () => {
    const client = fakeClient({
      tables: {
        ct_sets: [
          { data: [], error: null }, // initial listSetPositions: nothing yet
          { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert loses the race on position 1
          { data: [{ position: 1 }], error: null }, // re-check: a competitor already created position 1
          { data: [{ position: 2 }], error: null }, // retry insert: only position 2 was still missing
        ],
      },
    });
    const result = await ensureSetsForStage('s1', 2, client);
    expect(result).toEqual([{ position: 2 }]);
    const insertCalls = client.calls.filter(([action]) => action === 'insert');
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[1][2]).toEqual([{ stage_id: 's1', position: 2 }]);
  });

  it('gives up after a bounded number of attempts rather than retrying forever or leaking a raw constraint error', async () => {
    // A pathological/persistent conflict — every attempt collides. Proves
    // the retry is genuinely bounded (exactly 3 insert attempts, then a
    // clear thrown error), closing the gap where a single retry only
    // survives one level of racing and throws the raw Postgres error on a
    // second collision.
    const conflict = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const stillMissing = { data: [], error: null };
    const client = fakeClient({
      tables: {
        ct_sets: [
          stillMissing, // initial compute: nothing yet
          conflict, // attempt 1 insert
          stillMissing, // attempt 1 recompute: still missing
          conflict, // attempt 2 insert
          stillMissing, // attempt 2 recompute: still missing
          conflict, // attempt 3 insert
          stillMissing, // attempt 3 recompute: still missing
        ],
      },
    });
    await expect(ensureSetsForStage('s1', 1, client)).rejects.toThrow('gave up after 3 attempts');
    const insertCalls = client.calls.filter(([action]) => action === 'insert');
    expect(insertCalls).toHaveLength(3);
  });

  it('returns successfully, not "gave up", when the race resolves in our favor on the final attempt', async () => {
    // The 3rd insert collides, but the recompute immediately after it shows
    // every position now exists — a concurrent caller finished the job. The
    // bounded-retry loop's own top-of-iteration check never re-runs after
    // that last recompute, so without an explicit post-loop check this would
    // wrongly throw "gave up" despite the desired end state already existing.
    const conflict = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const stillMissing = { data: [], error: null };
    const resolved = { data: [{ position: 1 }], error: null };
    const client = fakeClient({
      tables: {
        ct_sets: [
          stillMissing, // initial compute: nothing yet
          conflict, // attempt 1 insert
          stillMissing, // attempt 1 recompute: still missing
          conflict, // attempt 2 insert
          stillMissing, // attempt 2 recompute: still missing
          conflict, // attempt 3 insert
          resolved, // attempt 3 recompute: a competitor finished it — nothing missing now
        ],
      },
    });
    await expect(ensureSetsForStage('s1', 1, client)).resolves.toEqual([]);
  });
});

describe('createStagePlan', () => {
  it('validates first — an invalid plan never reaches the database', async () => {
    const client = fakeClient();
    await expect(createStagePlan('ev1', [], client)).rejects.toThrow('at least one stage');
    expect(client.calls).toHaveLength(0);
  });

  it('creates stages in ordinal order even when passed out of order', async () => {
    const stage1 = { id: 's1', event_id: 'ev1', ordinal: 1, kind: 'prelims' };
    const stage2 = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals' };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: null, error: null }, // findStageByOrdinal(1): none
          { data: stage1, error: null }, // insert stage1
          { data: null, error: null }, // findStageByOrdinal(2): none
          { data: stage2, error: null }, // insert stage2
        ],
        ct_sets: [
          { data: [], error: null },
          { data: [{ position: 1 }], error: null },
          { data: [], error: null },
          { data: [{ position: 1 }], error: null },
        ],
      },
    });
    // Passed reversed — proves the composition sorts before creating, rather
    // than trusting caller order or (worse) processing finals first.
    const result = await createStagePlan(
      'ev1',
      [
        { kind: 'finals', ordinal: 2, setCount: 1, durationSecs: 480, cutoff: null },
        { kind: 'prelims', ordinal: 1, setCount: 1, durationSecs: 480, cutoff: 8 },
      ],
      client,
    );

    expect(result[0].stage).toEqual(stage1);
    expect(result[1].stage).toEqual(stage2);

    // The actual proof of order: the first ct_stages insert payload must be
    // prelims (ordinal 1), not whichever the caller listed first.
    const stageInserts = client.calls.filter(
      ([action, table]) => action === 'insert' && table === 'ct_stages',
    );
    expect(stageInserts[0][2].kind).toBe('prelims');
    expect(stageInserts[1][2].kind).toBe('finals');
  });
});

describe('listStagesForEvent', () => {
  it('returns every stage for the event, ordered by ordinal ascending', async () => {
    const stages = [
      { id: 's1', event_id: 'ev1', ordinal: 1, kind: 'prelims' },
      { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals' },
    ];
    const client = fakeClient({ tables: { ct_stages: { data: stages, error: null } } });
    expect(await listStagesForEvent('ev1', client)).toEqual(stages);
    const orderCall = client.calls.find(([action]) => action === 'order');
    expect(orderCall).toEqual(['order', 'ct_stages', 'ordinal', { ascending: true }]);
  });
});

describe('stageHasHeats', () => {
  it('returns true when at least one heat exists for the stage', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: [{ id: 'h1' }], error: null } } });
    expect(await stageHasHeats('s1', client)).toBe(true);
  });

  it('returns false when no heat exists for the stage', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: [], error: null } } });
    expect(await stageHasHeats('s1', client)).toBe(false);
  });
});

describe('saveStagePlan', () => {
  it('creates a brand-new stage when the event has no existing plan', async () => {
    const created = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 1,
      duration_secs: 480,
      cutoff: null,
    };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: [], error: null }, // initial listStagesForEvent: nothing yet
          { data: null, error: null }, // createStage's findStageByOrdinal(1): no match
          { data: created, error: null }, // createStage's insert
          { data: [created], error: null }, // final listStagesForEvent
        ],
        ct_sets: [
          { data: [], error: null }, // ensureSetsForStage: nothing yet
          { data: [{ position: 1 }], error: null }, // ensureSetsForStage's insert
        ],
      },
    });
    const plan = [{ kind: 'prelims', ordinal: 1, setCount: 1, durationSecs: 480, cutoff: null }];
    const result = await saveStagePlan('ev1', plan, client);
    expect(result).toEqual([created]);
    expect(client.calls.some(([action]) => action === 'update' || action === 'delete')).toBe(false);
  });

  it('edits an existing stage in place when it has no heats yet', async () => {
    const s1 = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s2 = {
      id: 's2',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'finals',
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const s1Updated = { ...s1, cutoff: 4 };
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: [s1, s2], error: null }, // initial listStagesForEvent
          { error: null }, // temp-ordinal move for s1
          { error: null }, // final config update for s1
          { data: [s1Updated, s2], error: null }, // final listStagesForEvent
        ],
        ct_heats: [{ data: [], error: null }], // s1 has no heats — safe to edit
        ct_sets: [
          {
            data: [1, 2, 3, 4, 5].map((position) => ({ position })),
            error: null,
          }, // s1's sets already all exist — no insert needed
        ],
      },
    });
    const plan = [
      { id: 's1', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 4 },
      { id: 's2', kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const result = await saveStagePlan('ev1', plan, client);
    expect(result).toEqual([s1Updated, s2]);

    const updateCalls = client.calls.filter(
      ([action, table]) => action === 'update' && table === 'ct_stages',
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][2]).toEqual({ ordinal: -1 }); // temp move first
    expect(updateCalls[1][2]).toMatchObject({ cutoff: 4, ordinal: 1 }); // then the real config
  });

  it('refuses to edit a stage that already has heats, naming it in a clear message rather than a raw DB error', async () => {
    const s1 = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s2 = {
      id: 's2',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'finals',
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const client = fakeClient({
      tables: {
        ct_stages: [{ data: [s1, s2], error: null }],
        ct_heats: [{ data: [{ id: 'h1' }], error: null }], // s1 already has a heat
      },
    });
    const plan = [
      { id: 's1', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 4 },
      { id: 's2', kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    await expect(saveStagePlan('ev1', plan, client)).rejects.toThrow('already has heats generated');
    expect(client.calls.some(([action]) => action === 'update' || action === 'delete')).toBe(false);
  });

  it('removes a stage with no heats, renumbering the plan around it', async () => {
    const s1 = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s2 = {
      id: 's2',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'finals',
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const s1Updated = { ...s1, cutoff: null }; // now the sole (terminal) stage
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: [s1, s2], error: null }, // initial listStagesForEvent
          { error: null }, // temp-ordinal move for s1
          { error: null }, // delete s2
          { error: null }, // final config update for s1
          { data: [s1Updated], error: null }, // final listStagesForEvent
        ],
        ct_heats: [
          { data: [], error: null }, // s2 (removed): no heats — safe
          { data: [], error: null }, // s1 (changed): no heats — safe
        ],
        ct_sets: [{ data: [1, 2, 3, 4, 5].map((position) => ({ position })), error: null }],
      },
    });
    const plan = [
      { id: 's1', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const result = await saveStagePlan('ev1', plan, client);
    expect(result).toEqual([s1Updated]);
    expect(client.calls).toContainEqual(['delete', 'ct_stages']);
  });

  it('refuses to remove a stage that already has heats', async () => {
    const s1 = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s2 = {
      id: 's2',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'finals',
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const client = fakeClient({
      tables: {
        ct_stages: [{ data: [s1, s2], error: null }],
        ct_heats: [{ data: [{ id: 'h1' }], error: null }], // s2 (the removed one) already has a heat
      },
    });
    const plan = [
      { id: 's1', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    await expect(saveStagePlan('ev1', plan, client)).rejects.toThrow('already has heats generated');
    expect(client.calls.some(([action]) => action === 'delete')).toBe(false);
  });

  it('reorders two existing stages via a two-phase ordinal move, avoiding a collision on the shared unique index', async () => {
    const s1 = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s2 = {
      id: 's2',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'prelims',
      set_count: 5,
      duration_secs: 480,
      cutoff: 8,
    };
    const s3 = {
      id: 's3',
      event_id: 'ev1',
      ordinal: 3,
      kind: 'finals',
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const finalStages = [{ ...s2, ordinal: 1 }, { ...s1, ordinal: 2 }, s3];
    const client = fakeClient({
      tables: {
        ct_stages: [
          { data: [s1, s2, s3], error: null }, // initial listStagesForEvent
          { error: null }, // temp move s2
          { error: null }, // temp move s1
          { error: null }, // final update s2 -> ordinal 1
          { error: null }, // final update s1 -> ordinal 2
          { data: finalStages, error: null }, // final listStagesForEvent
        ],
        ct_heats: [
          { data: [], error: null }, // s2: no heats
          { data: [], error: null }, // s1: no heats
        ],
        ct_sets: [
          { data: [1, 2, 3, 4, 5].map((position) => ({ position })), error: null },
          { data: [1, 2, 3, 4, 5].map((position) => ({ position })), error: null },
        ],
      },
    });
    // Passed already in the swapped order — proves the reordering itself,
    // not just that a caller-supplied ordinal is echoed back.
    const plan = [
      { id: 's2', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { id: 's1', kind: 'prelims', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: 8 },
      { id: 's3', kind: 'finals', ordinal: 3, setCount: 5, durationSecs: 480, cutoff: null },
    ];
    const result = await saveStagePlan('ev1', plan, client);
    expect(result).toEqual(finalStages);

    const updateCalls = client.calls.filter(
      ([action, table]) => action === 'update' && table === 'ct_stages',
    );
    // The two temp moves land on DISTINCT negative ordinals — the actual
    // proof this avoids the (event_id, ordinal) unique index, not just that
    // some update happened.
    expect(updateCalls[0][2]).toEqual({ ordinal: -1 });
    expect(updateCalls[1][2]).toEqual({ ordinal: -2 });
    expect(updateCalls[2][2]).toMatchObject({ ordinal: 1 });
    expect(updateCalls[3][2]).toMatchObject({ ordinal: 2 });
  });

  it('throws an invalid plan before ever reading existing stages', async () => {
    const client = fakeClient();
    await expect(saveStagePlan('ev1', [], client)).rejects.toThrow('at least one stage');
    expect(client.calls).toHaveLength(0);
  });
});
