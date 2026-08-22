import { describe, it, expect } from 'vitest';
import {
  listStageEntries,
  hydrateStageEntries,
  seedFirstStageEntries,
  buildHeatPlansFromSizes,
  buildHeatPlansFromAssignments,
  generateHeatsRandom,
  generateHeatsManual,
  listHeatsForStage,
} from './heats.js';

// Same shape as setup.test.js's fixture — queries consumed strictly in call
// order per table, extended with a `.then()` on the builder itself for
// calls left unterminated (no .single()/.maybeSingle()).
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

// Fisher-Yates (right-to-left) computes j = floor(random() * (i+1)) at each
// step i; returning a value just under 1 makes j === i for every i in these
// small fixtures (0.999 * (i+1) always floors back down to i here), so every
// swap is a no-op and the input order survives unshuffled — a real no-op,
// unlike random:()=>0 (verified: that reverses a 2-element array, since
// j=floor(0*(i+1))=0 swaps every element to the front).
const identityRandom = () => 0.999;

describe('listStageEntries', () => {
  it('returns every stage entry', async () => {
    const rows = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const client = fakeClient({ tables: { ct_stage_entries: { data: rows, error: null } } });
    expect(await listStageEntries('s1', client)).toEqual(rows);
  });
});

describe('hydrateStageEntries', () => {
  it('joins each stage entry to its roster row', () => {
    const stageEntries = [{ id: 'se1', entry_id: 'e1' }];
    const eventEntries = [{ id: 'e1', display_name: 'Cupper One', cafe: 'Grey Matter', bib: '7' }];
    const result = hydrateStageEntries(stageEntries, eventEntries);
    expect(result).toEqual([
      { id: 'se1', entry_id: 'e1', displayName: 'Cupper One', cafe: 'Grey Matter', bib: '7' },
    ]);
  });

  it('falls back to a placeholder rather than crashing when no roster row matches', () => {
    const stageEntries = [{ id: 'se1', entry_id: 'missing' }];
    const result = hydrateStageEntries(stageEntries, []);
    expect(result[0].displayName).toBe('(unknown cupper)');
    expect(result[0].cafe).toBeNull();
  });
});

describe('seedFirstStageEntries', () => {
  it('throws when no stage exists at ordinal 1', async () => {
    const client = fakeClient({ tables: { ct_stages: { data: null, error: null } } });
    await expect(seedFirstStageEntries('ev1', client)).rejects.toThrow('no stage at ordinal 1');
  });

  it('seeds one stage entry per non-withdrawn roster entry', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1 };
    const roster = [
      { id: 'e1', event_id: 'ev1', withdrawn: false },
      { id: 'e2', event_id: 'ev1', withdrawn: true },
      { id: 'e3', event_id: 'ev1', withdrawn: false },
    ];
    const inserted = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1', source: 'seed' },
      { id: 'se2', stage_id: 's1', entry_id: 'e3', source: 'seed' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: [
          { data: [], error: null }, // listStageEntries: nothing yet
          { data: inserted, error: null }, // insert result
        ],
        event_entries: { data: roster, error: null },
      },
    });
    const result = await seedFirstStageEntries('ev1', client);
    expect(result).toEqual(inserted);

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    expect(insertCall[2]).toEqual([
      { stage_id: 's1', entry_id: 'e1', source: 'seed' },
      { stage_id: 's1', entry_id: 'e3', source: 'seed' },
    ]);
  });

  it('is idempotent — does not reseed a stage that already has entries', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1 };
    const existing = [{ id: 'se1', stage_id: 's1', entry_id: 'e1', source: 'seed' }];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: existing, error: null },
      },
    });
    const result = await seedFirstStageEntries('ev1', client);
    expect(result).toEqual(existing);
    expect(client.calls.some(([action]) => action === 'insert')).toBe(false);
    // The roster must never be queried once we already know we won't seed.
    expect(client.calls.some(([, table]) => table === 'event_entries')).toBe(false);
  });
});

describe('buildHeatPlansFromSizes', () => {
  const entries = [
    { entry_id: 'e1' },
    { entry_id: 'e2' },
    { entry_id: 'e3' },
    { entry_id: 'e4' },
    { entry_id: 'e5' },
  ];

  it('splits entries into heats matching the given sizes, with lettered stations per heat', () => {
    const plans = buildHeatPlansFromSizes(entries, [3, 2], { random: identityRandom });
    expect(plans).toHaveLength(2);
    expect(plans[0].heatNumber).toBe(1);
    expect(plans[0].entries).toEqual([
      { entryId: 'e1', station: 'A' },
      { entryId: 'e2', station: 'B' },
      { entryId: 'e3', station: 'C' },
    ]);
    expect(plans[1].heatNumber).toBe(2);
    expect(plans[1].entries).toEqual([
      { entryId: 'e4', station: 'A' },
      { entryId: 'e5', station: 'B' },
    ]);
  });

  it('throws when sizes do not sum to the entry count', () => {
    expect(() => buildHeatPlansFromSizes(entries, [3, 3], { random: identityRandom })).toThrow(
      'sizes sum to 6 but 5 entries were given',
    );
  });

  it('does not mutate the input array', () => {
    const original = [...entries];
    buildHeatPlansFromSizes(entries, [3, 2], { random: () => 0.999 });
    expect(entries).toEqual(original);
  });

  it('every entry appears in exactly one heat, regardless of shuffle', () => {
    const plans = buildHeatPlansFromSizes(entries, [3, 2], { random: () => 0.5 });
    const allIds = plans.flatMap((plan) => plan.entries.map((e) => e.entryId)).sort();
    expect(allIds).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('actually reorders entries under a non-identity random function, not just preserves membership', () => {
    // A test asserting only sorted-set-equality would pass identically even
    // if shuffle() were a no-op — this proves real reordering happened.
    // Traced by hand (and verified by directly running the shuffle
    // function) that random:()=>0.5 through Fisher-Yates on
    // [e1,e2,e3,e4,e5] produces [e1,e4,e2,e5,e3], genuinely different from
    // the identity-random order used by every other test in this block.
    const plans = buildHeatPlansFromSizes(entries, [3, 2], { random: () => 0.5 });
    const orderedIds = plans.flatMap((plan) => plan.entries.map((e) => e.entryId));
    expect(orderedIds).toEqual(['e1', 'e4', 'e2', 'e5', 'e3']);
    expect(orderedIds).not.toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });
});

const stageEntries3 = [{ entry_id: 'e1' }, { entry_id: 'e2' }, { entry_id: 'e3' }];

describe('buildHeatPlansFromAssignments', () => {
  const validAssignments = [
    { entryId: 'e1', heatNumber: 1, station: 'A' },
    { entryId: 'e2', heatNumber: 1, station: 'B' },
    { entryId: 'e3', heatNumber: 2, station: 'A' },
  ];

  it('throws on an empty assignment', () => {
    expect(() => buildHeatPlansFromAssignments([], stageEntries3)).toThrow(
      'must contain at least one entry',
    );
  });

  it('throws when an entry does not belong to this stage', () => {
    const assignments = [{ entryId: 'not-in-stage', heatNumber: 1, station: 'A' }];
    expect(() => buildHeatPlansFromAssignments(assignments, stageEntries3)).toThrow(
      'not in this stage',
    );
  });

  it('throws when an entry is assigned to more than one heat', () => {
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e1', heatNumber: 2, station: 'A' },
    ];
    expect(() => buildHeatPlansFromAssignments(assignments, [{ entry_id: 'e1' }])).toThrow(
      'more than one heat',
    );
  });

  it('throws when a stage entry is missing from the assignment', () => {
    const incomplete = validAssignments.slice(0, 2); // e3 never assigned
    expect(() => buildHeatPlansFromAssignments(incomplete, stageEntries3)).toThrow(
      'missing 1 stage entry',
    );
  });

  it('throws when heat numbers are not sequential from 1', () => {
    const assignments = [
      { entryId: 'e1', heatNumber: 2, station: 'A' },
      { entryId: 'e2', heatNumber: 2, station: 'B' },
      { entryId: 'e3', heatNumber: 3, station: 'A' },
    ];
    expect(() => buildHeatPlansFromAssignments(assignments, stageEntries3)).toThrow(
      'sequential starting at 1',
    );
  });

  it('throws when a heat has fewer than the minimum cuppers', () => {
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 2, station: 'A' },
      { entryId: 'e3', heatNumber: 2, station: 'B' },
    ];
    expect(() => buildHeatPlansFromAssignments(assignments, stageEntries3)).toThrow(
      'below the minimum of 2',
    );
  });

  it('throws when the same station is used twice within a heat', () => {
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'A' },
      { entryId: 'e3', heatNumber: 1, station: 'A' },
    ];
    expect(() => buildHeatPlansFromAssignments(assignments, stageEntries3)).toThrow(
      'assigned to more than one cupper',
    );
  });

  it('accepts the same station reused across different heats', () => {
    const stageEntries4 = [
      { entry_id: 'e1' },
      { entry_id: 'e2' },
      { entry_id: 'e3' },
      { entry_id: 'e4' },
    ];
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
      { entryId: 'e3', heatNumber: 2, station: 'A' },
      { entryId: 'e4', heatNumber: 2, station: 'B' },
    ];
    const plans = buildHeatPlansFromAssignments(assignments, stageEntries4);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual({
      heatNumber: 1,
      entries: [
        { entryId: 'e1', station: 'A' },
        { entryId: 'e2', station: 'B' },
      ],
    });
    expect(plans[1]).toEqual({
      heatNumber: 2,
      entries: [
        { entryId: 'e3', station: 'A' },
        { entryId: 'e4', station: 'B' },
      ],
    });
  });
});

const stage = { id: 's1', event_id: 'ev1', ordinal: 1, duration_secs: 480 };

describe('generateHeatsRandom', () => {
  it('throws when the stage has no entries yet', async () => {
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: [], error: null },
      },
    });
    await expect(generateHeatsRandom('s1', {}, client)).rejects.toThrow('seed them first');
  });

  it("rejects a stage with fewer than the minimum heat size (core/partition's own guard, not reimplemented here)", async () => {
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: [{ entry_id: 'e1' }], error: null },
      },
    });
    await expect(generateHeatsRandom('s1', {}, client)).rejects.toThrow(
      'below the minimum heat size',
    );
  });

  it('creates one heat with the stage entries, snapshotting the stage duration', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const createdHeat = { id: 'h1', stage_id: 's1', heat_number: 1, duration_secs: 480 };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: [
          { data: null, error: null }, // findHeatByNumber: none yet
          { data: createdHeat, error: null }, // insert result
        ],
        ct_heat_entries: [
          { data: [], error: null }, // listHeatEntries before insert
          { data: [{ entry_id: 'e1' }, { entry_id: 'e2' }], error: null }, // insert result (ignored)
          { data: [{ entry_id: 'e1' }, { entry_id: 'e2' }], error: null }, // re-list after success
        ],
      },
    });
    const result = await generateHeatsRandom('s1', { random: identityRandom }, client);
    expect(result).toHaveLength(1);
    expect(result[0].heat).toEqual(createdHeat);

    const heatInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heats',
    );
    expect(heatInsert[2].duration_secs).toBe(480);
    expect(heatInsert[2].timing_mode).toBe('app');
  });

  it('accepts a timingMode override', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: [
          { data: null, error: null },
          { data: { id: 'h1' }, error: null },
        ],
        ct_heat_entries: { data: [], error: null },
      },
    });
    await generateHeatsRandom('s1', { random: identityRandom, timingMode: 'manual' }, client);
    const heatInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heats',
    );
    expect(heatInsert[2].timing_mode).toBe('manual');
  });
});

describe('generateHeatsManual', () => {
  it('creates heats from an explicit assignment', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: [
          { data: null, error: null },
          { data: { id: 'h1', duration_secs: 480 }, error: null },
        ],
        ct_heat_entries: { data: [], error: null },
      },
    });
    const result = await generateHeatsManual('s1', assignments, {}, client);
    expect(result).toHaveLength(1);

    const entryInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heat_entries',
    );
    expect(entryInsert[2]).toEqual([
      { heat_id: 'h1', entry_id: 'e1', station: 'A' },
      { heat_id: 'h1', entry_id: 'e2', station: 'B' },
    ]);
  });

  it('propagates validation errors from buildHeatPlansFromAssignments without touching ct_heats', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
      },
    });
    await expect(generateHeatsManual('s1', [], {}, client)).rejects.toThrow(
      'must contain at least one entry',
    );
    expect(client.calls.some(([, table]) => table === 'ct_heats')).toBe(false);
  });
});

describe('createHeat / createHeats idempotency (via generateHeatsRandom)', () => {
  it('returns the existing heat without inserting when one already exists with the same config', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const existingHeat = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      duration_secs: 480,
      timing_mode: 'app',
    };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: { data: existingHeat, error: null },
        ct_heat_entries: {
          data: [
            { entry_id: 'e1', station: 'A' },
            { entry_id: 'e2', station: 'B' },
          ],
          error: null,
        },
      },
    });
    const result = await generateHeatsRandom('s1', { random: identityRandom }, client);
    expect(result[0].heat).toEqual(existingHeat);
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_heats'),
    ).toBe(false);
  });

  it('throws when a heat already exists with a different configuration', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const existingHeat = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      duration_secs: 300, // differs from stage.duration_secs (480)
      timing_mode: 'app',
    };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: { data: existingHeat, error: null },
      },
    });
    await expect(generateHeatsRandom('s1', { random: identityRandom }, client)).rejects.toThrow(
      'already exists with a different configuration',
    );
  });

  it('recovers from a concurrent-insert race by adopting the winning heat when its config matches', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const winner = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      duration_secs: 480,
      timing_mode: 'app',
    };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: [
          { data: null, error: null }, // initial check: none yet
          { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert loses the race
          { data: winner, error: null }, // re-fetch: the winner
        ],
        ct_heat_entries: {
          data: [
            { entry_id: 'e1', station: 'A' },
            { entry_id: 'e2', station: 'B' },
          ],
          error: null,
        },
      },
    });
    const result = await generateHeatsRandom('s1', { random: identityRandom }, client);
    expect(result[0].heat).toEqual(winner);
  });
});

describe('ensureHeatEntries idempotency (via generateHeatsManual)', () => {
  it('only inserts entries missing from what already exists', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: { data: { id: 'h1', duration_secs: 480, timing_mode: 'app' }, error: null },
        ct_heat_entries: [
          { data: [{ heat_id: 'h1', entry_id: 'e1', station: 'A' }], error: null }, // e1 already there
          { data: [{ heat_id: 'h1', entry_id: 'e2', station: 'B' }], error: null }, // insert result
          { data: [{ entry_id: 'e1' }, { entry_id: 'e2' }], error: null }, // re-list
        ],
      },
    });
    await generateHeatsManual('s1', assignments, {}, client);
    const entryInsert = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heat_entries',
    );
    expect(entryInsert[2]).toEqual([{ heat_id: 'h1', entry_id: 'e2', station: 'B' }]);
  });

  it('throws when an existing heat entry has a different station than requested', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: { data: { id: 'h1', duration_secs: 480, timing_mode: 'app' }, error: null },
        ct_heat_entries: {
          data: [{ heat_id: 'h1', entry_id: 'e1', station: 'C' }], // requested 'A', stored 'C'
          error: null,
        },
      },
    });
    await expect(generateHeatsManual('s1', assignments, {}, client)).rejects.toThrow(
      'already exists with a different station',
    );
  });

  it('gives up after a bounded number of attempts rather than retrying forever', async () => {
    const stageEntries = [{ entry_id: 'e1' }, { entry_id: 'e2' }];
    const assignments = [
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
    ];
    const conflict = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const stillMissing = { data: [], error: null };
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_heats: { data: { id: 'h1', duration_secs: 480, timing_mode: 'app' }, error: null },
        ct_heat_entries: [
          stillMissing, // initial listHeatEntries
          conflict, // attempt 1 insert
          stillMissing, // attempt 1 re-list
          conflict, // attempt 2 insert
          stillMissing, // attempt 2 re-list
          conflict, // attempt 3 insert
          stillMissing, // attempt 3 re-list
        ],
      },
    });
    await expect(generateHeatsManual('s1', assignments, {}, client)).rejects.toThrow(
      'gave up after 3 attempts',
    );
    // The message text alone doesn't prove the loop actually ran 3 times —
    // MAX_INSERT_ATTEMPTS is baked into the message regardless of how many
    // iterations really executed, so an off-by-one bound (e.g. running only
    // 2 attempts) would still produce this exact string. Count the real
    // insert calls to prove the bound itself, not just its wording.
    const insertCalls = client.calls.filter(
      ([action, table]) => action === 'insert' && table === 'ct_heat_entries',
    );
    expect(insertCalls).toHaveLength(3);
  });
});

describe('listHeatsForStage', () => {
  it('returns every heat for the stage, in heat-number order, each with its entries', async () => {
    const heats = [
      { id: 'h1', stage_id: 's1', heat_number: 1 },
      { id: 'h2', stage_id: 's1', heat_number: 2 },
    ];
    const client = fakeClient({
      tables: {
        ct_heats: { data: heats, error: null },
        ct_heat_entries: [
          { data: [{ heat_id: 'h1', entry_id: 'e1' }], error: null },
          { data: [{ heat_id: 'h2', entry_id: 'e2' }], error: null },
        ],
      },
    });
    const result = await listHeatsForStage('s1', client);
    expect(result).toHaveLength(2);
    expect(result[0].heat).toEqual(heats[0]);
    expect(result[0].entries).toEqual([{ heat_id: 'h1', entry_id: 'e1' }]);
    expect(result[1].heat).toEqual(heats[1]);
  });

  it('orders by heat_number ascending', async () => {
    const client = fakeClient({ tables: { ct_heats: { data: [], error: null } } });
    await listHeatsForStage('s1', client);
    const orderCall = client.calls.find(([action]) => action === 'order');
    expect(orderCall).toEqual(['order', 'ct_heats', 'heat_number', { ascending: true }]);
  });
});
