import { describe, it, expect } from 'vitest';
import {
  isEventComplete,
  computeSetDifficulty,
  computeScoreDistribution,
  computeStageReport,
  computeCupperSetGrid,
  computeEventSummary,
  computeAvgSecsPerSet,
} from './analytics.js';

// Same fakeClient shape used throughout this project's format tests — queues
// consumed strictly in call order per table.
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

describe('isEventComplete', () => {
  it('is false when the terminal stage has not been declared complete', async () => {
    const stages = [
      { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8, status: 'complete' },
      { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null, status: 'running' },
    ];
    const client = fakeClient({ tables: { ct_stages: { data: stages, error: null } } });
    expect(await isEventComplete('ev1', client)).toBe(false);
  });

  it('is true once the terminal stage (cutoff: null) is complete', async () => {
    const stages = [
      { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8, status: 'complete' },
      { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null, status: 'complete' },
    ];
    const client = fakeClient({ tables: { ct_stages: { data: stages, error: null } } });
    expect(await isEventComplete('ev1', client)).toBe(true);
  });

  it('is false when no stage plan exists yet at all', async () => {
    const client = fakeClient({ tables: { ct_stages: { data: [], error: null } } });
    expect(await isEventComplete('ev1', client)).toBe(false);
  });

  it('an early stage being complete does not make the event complete — only the terminal stage counts', async () => {
    const stages = [
      { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8, status: 'complete' },
      { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: 4, status: 'running' },
      { id: 's3', event_id: 'ev1', ordinal: 3, cutoff: null, status: 'pending' },
    ];
    const client = fakeClient({ tables: { ct_stages: { data: stages, error: null } } });
    expect(await isEventComplete('ev1', client)).toBe(false);
  });

  it('finds the terminal stage by cutoff === null, not by array/ordinal position — a plausible-but-wrong "check the last element" implementation would get this backwards', async () => {
    // Deliberately out of ordinal order: the complete, terminal stage is
    // FIRST in the array, and an incomplete, non-terminal stage is LAST.
    // Every other fixture in this describe block happens to have the
    // terminal stage last (matching listStagesForEvent's real ordinal-
    // ascending order), which would let a `stages.at(-1)` implementation
    // pass those tests for the wrong reason.
    const stages = [
      { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null, status: 'complete' },
      { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8, status: 'running' },
    ];
    const client = fakeClient({ tables: { ct_stages: { data: stages, error: null } } });
    expect(await isEventComplete('ev1', client)).toBe(true);
  });
});

// The shared fakeClient above never actually filters by the arguments
// passed to .eq()/.in() — it just returns whatever's queued for a table
// name, so it can't prove exclusion happened at the data level, only that
// the filter call was MADE (see the test below that needs this). This
// small client actually applies filters against real in-memory rows, so a
// tiebreak heat's data can be present in the fixture and genuinely
// excluded by the query the code under test issues, not by test-author
// fiat.
function filteringClient(db) {
  return {
    from(table) {
      const filters = [];
      const builder = {
        select: () => builder,
        eq(col, val) {
          filters.push({ col, val, type: 'eq' });
          return builder;
        },
        in(col, vals) {
          filters.push({ col, val: vals, type: 'in' });
          return builder;
        },
        order(col, { ascending } = {}) {
          const rows = db[table]
            .filter((row) =>
              filters.every(({ col: c, val, type }) =>
                type === 'in' ? val.includes(row[c]) : row[c] === val,
              ),
            )
            .sort((a, b) => (ascending ? a[col] - b[col] : b[col] - a[col]));
          return Promise.resolve({ data: rows, error: null });
        },
        then(resolve, reject) {
          const rows = db[table].filter((row) =>
            filters.every(({ col, val, type }) =>
              type === 'in' ? val.includes(row[col]) : row[col] === val,
            ),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

describe('computeSetDifficulty', () => {
  it("genuinely excludes a tiebreak heat's own results from the average — not merely calling .eq('kind', 'normal'), the exclusion actually happens against real, present tiebreak-heat data", async () => {
    const db = {
      ct_sets: [{ id: 'set1', stage_id: 's1', position: 1, label: null }],
      ct_heats: [
        { id: 'h1', stage_id: 's1', kind: 'normal' },
        { id: 'h2', stage_id: 's1', kind: 'tiebreak' },
      ],
      ct_heat_entries: [
        { id: 'he1', heat_id: 'h1' },
        { id: 'he2', heat_id: 'h2' },
      ],
      ct_results: [
        { heat_entry_id: 'he1', set_id: 'set1', correct: true },
        // The tiebreak heat's own result on the same set — if this leaked
        // in, avgCorrect would come out 0.5 (1 of 2), not 1 (1 of 1).
        { heat_entry_id: 'he2', set_id: 'set1', correct: false },
      ],
    };

    const difficulty = await computeSetDifficulty('s1', filteringClient(db));

    expect(difficulty).toEqual([
      { setId: 'set1', position: 1, label: null, sampleSize: 1, avgCorrect: 1 },
    ]);
  });

  it('computes avg(correct) per set, restricted to normal heats', async () => {
    const sets = [
      { id: 'set1', stage_id: 's1', position: 1, label: null },
      { id: 'set2', stage_id: 's1', position: 2, label: null },
    ];
    const normalHeats = [{ id: 'h1' }];
    const heatEntries = [{ id: 'he1' }, { id: 'he2' }];
    const results = [
      { set_id: 'set1', correct: true },
      { set_id: 'set1', correct: false },
      { set_id: 'set2', correct: true },
      { set_id: 'set2', correct: true },
    ];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: normalHeats, error: null },
        ct_heat_entries: { data: heatEntries, error: null },
        ct_results: { data: results, error: null },
      },
    });

    const difficulty = await computeSetDifficulty('s1', client);

    expect(difficulty).toEqual([
      { setId: 'set1', position: 1, label: null, sampleSize: 2, avgCorrect: 0.5 },
      { setId: 'set2', position: 2, label: null, sampleSize: 2, avgCorrect: 1 },
    ]);

    const heatsEq = client.calls.find(
      ([action, table, col, val]) =>
        action === 'eq' && table === 'ct_heats' && col === 'kind' && val === 'normal',
    );
    expect(heatsEq).toBeTruthy();
  });

  it('reports null, not 0, for a set with no results yet — honest "no data" rather than a misleading 0%', async () => {
    const sets = [{ id: 'set1', stage_id: 's1', position: 1, label: null }];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [{ id: 'h1' }], error: null },
        ct_heat_entries: { data: [{ id: 'he1' }], error: null },
        ct_results: { data: [], error: null },
      },
    });

    const difficulty = await computeSetDifficulty('s1', client);
    expect(difficulty[0].avgCorrect).toBeNull();
    expect(difficulty[0].sampleSize).toBe(0);
  });

  it('never queries ct_heat_entries or ct_results when the stage has no normal heats', async () => {
    const sets = [{ id: 'set1', stage_id: 's1', position: 1, label: null }];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [], error: null },
      },
    });

    await computeSetDifficulty('s1', client);
    expect(client.calls.some(([, table]) => table === 'ct_heat_entries')).toBe(false);
    expect(client.calls.some(([, table]) => table === 'ct_results')).toBe(false);
  });
});

describe('computeScoreDistribution', () => {
  it('buckets ranked entries by correct count, every bucket from 0 to setCount present', () => {
    const ranked = [
      { item: { numCorrect: 3 }, position: 1 },
      { item: { numCorrect: 3 }, position: 1 },
      { item: { numCorrect: 1 }, position: 3 },
    ];
    const distribution = computeScoreDistribution(ranked, 3);
    expect(distribution).toEqual([
      { correctCount: 0, numCuppers: 0 },
      { correctCount: 1, numCuppers: 1 },
      { correctCount: 2, numCuppers: 0 },
      { correctCount: 3, numCuppers: 2 },
    ]);
  });

  it('returns a full zero histogram for an empty field, not an empty array', () => {
    expect(computeScoreDistribution([], 2)).toEqual([
      { correctCount: 0, numCuppers: 0 },
      { correctCount: 1, numCuppers: 0 },
      { correctCount: 2, numCuppers: 0 },
    ]);
  });
});

describe('computeStageReport', () => {
  it('composes standings, difficulty, distribution, and the per-cupper set grid for one stage', async () => {
    const stage = { id: 's1', event_id: 'ev1', ordinal: 1, set_count: 1, cutoff: null };
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 1, sets_scored: 1, total_elapsed_secs: 50 },
    ];
    const roster = [{ id: 'e1', display_name: 'Alex' }];
    const sets = [{ id: 'set1', stage_id: 's1', position: 1, label: null }];
    const client = fakeClient({
      tables: {
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [{ id: 'h1' }], error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1' }], error: null },
        ct_results: {
          data: [{ heat_entry_id: 'he1', set_id: 'set1', correct: true }],
          error: null,
        },
      },
    });

    const report = await computeStageReport('s1', client);

    expect(report.stage).toEqual(stage);
    expect(report.ranked[0].item.displayName).toBe('Alex');
    expect(report.difficulty).toEqual([
      { setId: 'set1', position: 1, label: null, sampleSize: 1, avgCorrect: 1 },
    ]);
    expect(report.distribution).toEqual([
      { correctCount: 0, numCuppers: 0 },
      { correctCount: 1, numCuppers: 1 },
    ]);
    expect(report.setGrid.get('e1')).toEqual([{ setId: 'set1', position: 1, correct: true }]);
  });
});

describe('computeCupperSetGrid', () => {
  it('builds a per-cupper, per-set correct/wrong matrix, ordered by set position', async () => {
    const sets = [
      { id: 'set1', stage_id: 's1', position: 1, label: null },
      { id: 'set2', stage_id: 's1', position: 2, label: null },
    ];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [{ id: 'h1' }], error: null },
        ct_heat_entries: {
          data: [
            { id: 'he1', entry_id: 'e1' },
            { id: 'he2', entry_id: 'e2' },
          ],
          error: null,
        },
        ct_results: {
          data: [
            { heat_entry_id: 'he1', set_id: 'set1', correct: true },
            { heat_entry_id: 'he1', set_id: 'set2', correct: false },
            { heat_entry_id: 'he2', set_id: 'set1', correct: false },
            { heat_entry_id: 'he2', set_id: 'set2', correct: true },
          ],
          error: null,
        },
      },
    });

    const grid = await computeCupperSetGrid('s1', client);

    expect(grid.get('e1')).toEqual([
      { setId: 'set1', position: 1, correct: true },
      { setId: 'set2', position: 2, correct: false },
    ]);
    expect(grid.get('e2')).toEqual([
      { setId: 'set1', position: 1, correct: false },
      { setId: 'set2', position: 2, correct: true },
    ]);
  });

  it('reports null, not false, for a set no result row exists for — honest "not scored" rather than a misleading "wrong"', async () => {
    const sets = [
      { id: 'set1', stage_id: 's1', position: 1, label: null },
      { id: 'set2', stage_id: 's1', position: 2, label: null },
    ];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [{ id: 'h1' }], error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1' }], error: null },
        // Only set1 has a result row for e1 — set2 was never scored (e.g. a
        // heat that ended early).
        ct_results: {
          data: [{ heat_entry_id: 'he1', set_id: 'set1', correct: true }],
          error: null,
        },
      },
    });

    const grid = await computeCupperSetGrid('s1', client);

    expect(grid.get('e1')).toEqual([
      { setId: 'set1', position: 1, correct: true },
      { setId: 'set2', position: 2, correct: null },
    ]);
  });

  it("genuinely excludes a tiebreak heat's own results — not merely calling .eq('kind', 'normal'), the exclusion actually happens against real, present tiebreak-heat data", async () => {
    const db = {
      ct_sets: [{ id: 'set1', stage_id: 's1', position: 1, label: null }],
      ct_heats: [
        { id: 'h1', stage_id: 's1', kind: 'normal' },
        { id: 'h2', stage_id: 's1', kind: 'tiebreak' },
      ],
      ct_heat_entries: [
        { id: 'he1', heat_id: 'h1', entry_id: 'e1' },
        // Same cupper (e1), but via the TIEBREAK heat's own separate
        // heat_entry row — if this leaked in, e1's set1 cell would flip
        // from true to false (whichever result happened to be read last),
        // silently blending two heats' worth of results into one grid cell.
        { id: 'he2', heat_id: 'h2', entry_id: 'e1' },
      ],
      ct_results: [
        { heat_entry_id: 'he1', set_id: 'set1', correct: true },
        { heat_entry_id: 'he2', set_id: 'set1', correct: false },
      ],
    };

    const grid = await computeCupperSetGrid('s1', filteringClient(db));

    expect(grid.get('e1')).toEqual([{ setId: 'set1', position: 1, correct: true }]);
  });

  it('never queries ct_heat_entries or ct_results when the stage has no normal heats', async () => {
    const sets = [{ id: 'set1', stage_id: 's1', position: 1, label: null }];
    const client = fakeClient({
      tables: {
        ct_sets: { data: sets, error: null },
        ct_heats: { data: [], error: null },
      },
    });

    await computeCupperSetGrid('s1', client);
    expect(client.calls.some(([, table]) => table === 'ct_heat_entries')).toBe(false);
    expect(client.calls.some(([, table]) => table === 'ct_results')).toBe(false);
  });
});

// Moved here from reportScreen.test.js (2026-09-11, review: code-reviewer) —
// this function lives in analytics.js now, not reportScreen.js, so
// computeEventSummary below can reuse it directly instead of keeping a
// byte-identical duplicate; its own tests moved with it.
describe('computeAvgSecsPerSet', () => {
  it('rounds to the nearest whole second', () => {
    expect(computeAvgSecsPerSet(100, 3)).toBe(33);
  });

  it('returns null for zero scored sets or a null total', () => {
    expect(computeAvgSecsPerSet(100, 0)).toBeNull();
    expect(computeAvgSecsPerSet(null, 3)).toBeNull();
  });
});

describe('computeEventSummary', () => {
  // Two stages: prelims (ordinal 1) -> finals (ordinal 2, terminal).
  // Alex reaches finals and wins (champion, final_position 1). Sam also
  // reaches finals, finishes 2nd. Jo is eliminated in prelims (never
  // appears in finals' own ranked list at all).
  function twoStageReports() {
    const prelims = {
      stage: { id: 's1', kind: 'prelims', ordinal: 1, cutoff: 2 },
      ranked: [
        {
          item: {
            entry_id: 'alex',
            displayName: 'Alex',
            numCorrect: 3,
            sets_scored: 3,
            total_elapsed_secs: 90,
            finalPosition: null, // advanced — null per this project's own convention
          },
          position: 1,
        },
        {
          item: {
            entry_id: 'sam',
            displayName: 'Sam',
            numCorrect: 2,
            sets_scored: 3,
            total_elapsed_secs: 100,
            finalPosition: null,
          },
          position: 2,
        },
        {
          item: {
            entry_id: 'jo',
            displayName: 'Jo',
            numCorrect: 1,
            sets_scored: 3,
            total_elapsed_secs: 150,
            finalPosition: 3, // eliminated here — this IS Jo's last round
          },
          position: 3,
        },
      ],
    };
    const finals = {
      stage: { id: 's2', kind: 'finals', ordinal: 2, cutoff: null },
      ranked: [
        {
          item: {
            entry_id: 'alex',
            displayName: 'Alex',
            numCorrect: 3,
            sets_scored: 3,
            total_elapsed_secs: 70,
            finalPosition: 1, // champion
          },
          position: 1,
        },
        {
          item: {
            entry_id: 'sam',
            displayName: 'Sam',
            numCorrect: 2,
            sets_scored: 3,
            total_elapsed_secs: 85,
            finalPosition: 2,
          },
          position: 2,
        },
      ],
    };
    return [prelims, finals];
  }

  it("sums a cupper's score, sets scored, and elapsed time across every stage they appeared in", () => {
    const summaries = computeEventSummary(twoStageReports());
    const alex = summaries.find((s) => s.entryId === 'alex');
    expect(alex.totalScore).toBe(6); // 3 + 3
    expect(alex.totalSetsScored).toBe(6); // 3 + 3
    expect(alex.totalElapsedSecs).toBe(160); // 90 + 70
    expect(alex.avgSecsPerSet).toBe(27); // round(160 / 6) = 26.67 -> 27
    expect(alex.rounds).toHaveLength(2);
  });

  it("orders by each cupper's REAL final placement (most-advanced stage, then finalPosition within it) — not by a fresh ranking of these totals, which would misrepresent the real bracket outcome", () => {
    // Found in review (test-auditor, via mutation testing): an earlier
    // version of this fixture only made Jo FASTER than Sam, but Jo's own
    // totalScore (1) still stayed far below Sam's (2+2=4) either way —
    // meaning a naive `sort by totalScore desc` mis-implementation would
    // have produced the SAME (accidentally correct) order this test
    // asserts, without actually being caught. Jo's own numCorrect/
    // sets_scored are bumped here so Jo's OWN totalScore (5) genuinely
    // EXCEEDS Sam's summed total across two real rounds (4) — a naive
    // re-rank-by-total-score implementation would now place Jo ahead of
    // Sam, and only the real "most-advanced-stage-first" rule keeps Sam
    // (who reached finals) correctly ordered ahead of Jo (eliminated in
    // prelims) despite Jo's higher raw total.
    const reports = twoStageReports();
    reports[0].ranked[2].item.numCorrect = 5;
    reports[0].ranked[2].item.sets_scored = 5;
    reports[0].ranked[2].item.total_elapsed_secs = 10; // also faster, for good measure
    const summaries = computeEventSummary(reports);
    const jo = summaries.find((s) => s.entryId === 'jo');
    expect(jo.totalScore).toBe(5); // genuinely exceeds Sam's own 4
    const order = summaries.map((s) => s.entryId);
    expect(order).toEqual(['alex', 'sam', 'jo']);
  });

  it('gives a cupper eliminated early exactly one round, not a padded/undefined entry for stages they never reached', () => {
    const summaries = computeEventSummary(twoStageReports());
    const jo = summaries.find((s) => s.entryId === 'jo');
    expect(jo.rounds).toHaveLength(1);
    expect(jo.rounds[0].stageKind).toBe('prelims');
    expect(jo.totalScore).toBe(1);
  });

  it('returns null, not 0 or NaN, for avgSecsPerSet when a cupper has no timed rounds at all (both zero-sets-scored AND zero-time cases)', () => {
    const reports = twoStageReports();
    reports[0].ranked[2].item.total_elapsed_secs = null;
    reports[0].ranked[2].item.sets_scored = 0;
    reports[0].ranked[2].item.numCorrect = 0;
    const summaries = computeEventSummary(reports);
    const jo = summaries.find((s) => s.entryId === 'jo');
    expect(jo.totalElapsedSecs).toBeNull();
    expect(jo.avgSecsPerSet).toBeNull();
  });

  it('also returns null, not NaN, for the realistic "scored sets but never got timed" case specifically — found in review (test-auditor, via mutation testing): the guard is an OR of two independent conditions (zero sets scored, OR a null total time), and the previous test above only ever exercised BOTH at once, leaving this half of the OR unproven', () => {
    const reports = twoStageReports();
    // sets_scored stays REAL (3, matching Jo's own base fixture) — only
    // the TIME is null, e.g. a stopwatch failure with no manual-entry
    // fallback ever completed. A `Math.round(null / 3)` (if the null-check
    // were ever dropped) would produce NaN, not a crash — exactly the
    // silent-wrong-value failure mode this test exists to catch.
    reports[0].ranked[2].item.total_elapsed_secs = null;
    const summaries = computeEventSummary(reports);
    const jo = summaries.find((s) => s.entryId === 'jo');
    expect(jo.totalScore).toBe(1); // sets_scored/numCorrect still real
    expect(jo.totalElapsedSecs).toBeNull();
    expect(jo.avgSecsPerSet).toBeNull();
  });

  it('each round entry carries its own stage-level position and finalPosition, not just the aggregate totals — needed for a per-round placement column', () => {
    const summaries = computeEventSummary(twoStageReports());
    const alex = summaries.find((s) => s.entryId === 'alex');
    expect(alex.rounds[0]).toMatchObject({
      stageKind: 'prelims',
      position: 1,
      finalPosition: null,
    });
    expect(alex.rounds[1]).toMatchObject({ stageKind: 'finals', position: 1, finalPosition: 1 });
  });
});
