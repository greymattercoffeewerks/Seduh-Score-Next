import { describe, it, expect } from 'vitest';
import {
  rankStandingRows,
  fetchStandingsForStage,
  resolveAdvancement,
  createTiebreakHeatForTie,
  fetchTiebreakHeatOutcome,
  belowTheLine,
  commitStageResolution,
  findNextStage,
} from './standings.js';

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

describe('commitStageResolution', () => {
  it('at a cutoff stage, inserts advancing entries into the next stage and marks the current stage complete', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 1 };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2 };
    const client = fakeClient({ tables: {} });

    await commitStageResolution(
      {
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
      },
      client,
    );

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    expect(insertCall[2]).toEqual([
      { stage_id: 's2', entry_id: 'e1', source: 'advanced', position_note: null },
      { stage_id: 's2', entry_id: 'e2', source: 'tiebreak_won', position_note: null },
    ]);

    const updateCalls = client.calls.filter(
      ([action, table]) => action === 'update' && table === 'ct_stage_entries',
    );
    expect(updateCalls).toEqual([
      ['update', 'ct_stage_entries', { final_position: 3, position_note: null }],
      ['update', 'ct_stage_entries', { final_position: 4 }],
    ]);

    const stageUpdate = client.calls.find(
      ([action, table]) => action === 'update' && table === 'ct_stages',
    );
    expect(stageUpdate[2]).toEqual({ status: 'complete' });
  });

  it('at the terminal stage (nextStage: null), never inserts — sets final_position 1 on the champion instead', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 3, cutoff: null };
    const client = fakeClient({ tables: {} });

    await commitStageResolution(
      {
        stage,
        nextStage: null,
        advancingEntries: [{ entryId: 'champ', source: 'advanced' }],
        championStageEntryId: 'se-champ',
        eliminated: [],
        finalPosition: 2,
        belowCutoff: [],
        coinTossNote: null,
      },
      client,
    );

    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_stage_entries'),
    ).toBe(false);
    const championUpdate = client.calls.find(
      ([action, table, payload]) =>
        action === 'update' && table === 'ct_stage_entries' && payload.final_position === 1,
    );
    expect(championUpdate).toBeTruthy();
    expect(championUpdate[2]).toEqual({ final_position: 1, position_note: null });
    const eqCall = client.calls.find(
      ([action, , ...args]) => action === 'eq' && args[1] === 'se-champ',
    );
    expect(eqCall).toBeTruthy();
  });

  it('records the coin-toss note only on rows actually decided by the coin toss, never on the rest', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8 };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2 };
    const client = fakeClient({ tables: {} });

    await commitStageResolution(
      {
        stage,
        nextStage,
        advancingEntries: [
          { entryId: 'clean', source: 'advanced' },
          { entryId: 'coin-winner', source: 'coin_toss' },
        ],
        championStageEntryId: null,
        eliminated: [
          { stageEntryId: 'se-coin-loser', viaCoinToss: true },
          { stageEntryId: 'se-tiebreak-loser', viaCoinToss: false },
        ],
        finalPosition: 9,
        belowCutoff: [],
        coinTossNote: 'coin toss, witnessed by organiser',
        random: undefined,
      },
      client,
    );

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    expect(insertCall[2][0].position_note).toBeNull();
    expect(insertCall[2][1].position_note).toBe('coin toss, witnessed by organiser');

    const updateCalls = client.calls.filter(
      ([action, table]) => action === 'update' && table === 'ct_stage_entries',
    );
    expect(updateCalls[0][2].position_note).toBe('coin toss, witnessed by organiser');
    expect(updateCalls[1][2].position_note).toBeNull();
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
