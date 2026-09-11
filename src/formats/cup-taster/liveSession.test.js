import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildLiveSessionPayload,
  publishLiveSession,
  publishLiveSessionHandlers,
} from './liveSession.js';
import { flushOutbox, listPendingOperations } from '../../core/outbox.js';
import { _clearAllForTests } from '../../core/db.js';

// Same queue-per-table fake as standings.test.js/heats.test.js — a table
// with only one queued response repeats it for every call (order-agnostic);
// a table needing different responses per call (ct_heat_entries here, once
// per heat) gets an array queued in call order.
function fakeClient({ tables = {}, rpc } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  const calls = [];

  return {
    calls,
    rpc: rpc ?? (() => Promise.resolve({ data: null, error: null })),
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

const stage = {
  id: 's1',
  event_id: 'ev1',
  ordinal: 1,
  kind: 'prelims',
  set_count: 8,
  duration_secs: 480,
  cutoff: 4,
};

const stageEntries = [
  { id: 'se-a', stage_id: 's1', entry_id: 'a' },
  { id: 'se-b', stage_id: 's1', entry_id: 'b' },
];

const standingsRows = [
  { entry_id: 'a', stage_id: 's1', correct_count: 6, sets_scored: 8, total_elapsed_secs: 200 },
  { entry_id: 'b', stage_id: 's1', correct_count: 0, sets_scored: 0, total_elapsed_secs: null },
];

const roster = [
  { id: 'a', display_name: 'Alex' },
  { id: 'b', display_name: 'Bailey' },
];

const heats = [
  {
    id: 'h1',
    stage_id: 's1',
    heat_number: 1,
    kind: 'normal',
    status: 'confirmed',
    timing_mode: 'app',
    started_at: '2026-09-04T10:00:00.000Z',
    duration_secs: 480,
  },
  {
    id: 'h2',
    stage_id: 's1',
    heat_number: 2,
    kind: 'normal',
    status: 'timing',
    timing_mode: 'app',
    started_at: '2026-09-04T10:05:00.000Z',
    duration_secs: 480,
  },
];

const heat1Entries = [
  { id: 'he-a', heat_id: 'h1', entry_id: 'a', station: 'A', elapsed_secs: 200, maxed: false },
];
const heat2Entries = [
  { id: 'he-b', heat_id: 'h2', entry_id: 'b', station: 'B', elapsed_secs: null, maxed: false },
];

const heat1Results = [
  { heat_entry_id: 'he-a', set_id: 'set1', correct: true },
  { heat_entry_id: 'he-a', set_id: 'set2', correct: true },
  { heat_entry_id: 'he-a', set_id: 'set3', correct: false },
];

function baseTables() {
  return {
    ct_stages: { data: stage, error: null },
    ct_stage_entries: { data: stageEntries, error: null },
    ct_standings: { data: standingsRows, error: null },
    event_entries: { data: roster, error: null },
    ct_heats: { data: heats, error: null },
    ct_heat_entries: [
      { data: heat1Entries, error: null },
      { data: heat2Entries, error: null },
    ],
    ct_results: { data: heat1Results, error: null },
  };
}

describe('buildLiveSessionPayload', () => {
  it("assembles stage, ranked standings, the running heat, and confirmed heats — matching viewerBody.js's documented payload contract", async () => {
    const client = fakeClient({ tables: baseTables() });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.stage).toEqual({ kind: 'prelims', ordinal: 1, setCount: 8 });

    // stage.cutoff is 4 and there are only 2 stage entries, so both fit
    // within the cutoff with no group straddling the border — both are
    // 'advancing', not 'tied'. See the two tests below for a genuine
    // tiedAtBorder case and the stage.status === 'complete' suppression.
    expect(payload.standings).toEqual([
      {
        position: 1,
        displayName: 'Alex',
        numCorrect: 6,
        totalElapsedSecs: 200,
        tieStatus: 'advancing',
      },
      {
        position: 2,
        displayName: 'Bailey',
        numCorrect: 0,
        totalElapsedSecs: null,
        tieStatus: 'advancing',
      },
    ]);

    expect(payload.activeHeat).toEqual({
      heatNumber: 2,
      stageKind: 'prelims',
      status: 'timing',
      timingMode: 'app',
      startedAt: '2026-09-04T10:05:00.000Z',
      durationSecs: 480,
      cuppers: [{ displayName: 'Bailey', station: 'B', totalElapsedSecs: null, maxed: false }],
    });

    expect(payload.recentHeats).toEqual([
      {
        heatNumber: 1,
        stageKind: 'prelims',
        results: [{ displayName: 'Alex', numCorrect: 2, totalElapsedSecs: 200 }],
      },
    ]);
  });

  it('marks a genuine border tie as "tied", not "advancing" — mirroring standingsScreen.js\'s own resolveAdvancement grouping', async () => {
    const tieStage = { ...stage, cutoff: 2 };
    const tieStageEntries = [
      { id: 'se-a', stage_id: 's1', entry_id: 'a' },
      { id: 'se-b', stage_id: 's1', entry_id: 'b' },
      { id: 'se-c', stage_id: 's1', entry_id: 'c' },
    ];
    // Alex clears the cutoff-of-2 alone (rank 1, 1 slot remaining); Bailey
    // and Casey then tie for rank 2 with identical correct/time — that
    // whole 2-person group straddles the single remaining slot, so both are
    // 'tied', neither 'advancing' (computeAdvancement returns the group
    // whole rather than picking one, since neither can be resolved without
    // a tiebreak).
    const tieStandingsRows = [
      { entry_id: 'a', stage_id: 's1', correct_count: 6, sets_scored: 8, total_elapsed_secs: 200 },
      { entry_id: 'b', stage_id: 's1', correct_count: 3, sets_scored: 8, total_elapsed_secs: 300 },
      { entry_id: 'c', stage_id: 's1', correct_count: 3, sets_scored: 8, total_elapsed_secs: 300 },
    ];
    const tieRoster = [
      { id: 'a', display_name: 'Alex' },
      { id: 'b', display_name: 'Bailey' },
      { id: 'c', display_name: 'Casey' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: tieStage, error: null },
        ct_stage_entries: { data: tieStageEntries, error: null },
        ct_standings: { data: tieStandingsRows, error: null },
        event_entries: { data: tieRoster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.standings.map((row) => [row.displayName, row.tieStatus])).toEqual([
      ['Alex', 'advancing'],
      ['Bailey', 'tied'],
      ['Casey', 'tied'],
    ]);
  });

  it("suppresses tieStatus entirely once the stage is complete — matching standingsScreen.js's own commit-clears-the-tie-label convention, since ct_standings never reflects a tiebreak/coin-toss result", async () => {
    const tieStage = { ...stage, cutoff: 1, status: 'complete' };
    const tieStageEntries = [
      { id: 'se-a', stage_id: 's1', entry_id: 'a' },
      { id: 'se-b', stage_id: 's1', entry_id: 'b' },
    ];
    // Still tied per ct_standings alone (a tiebreak/coin-toss never updates
    // it) — but the stage is complete, so this must NOT report 'tied'.
    const tieStandingsRows = [
      { entry_id: 'a', stage_id: 's1', correct_count: 3, sets_scored: 8, total_elapsed_secs: 300 },
      { entry_id: 'b', stage_id: 's1', correct_count: 3, sets_scored: 8, total_elapsed_secs: 300 },
    ];
    const tieRoster = [
      { id: 'a', display_name: 'Alex' },
      { id: 'b', display_name: 'Bailey' },
    ];
    const client = fakeClient({
      tables: {
        ct_stages: { data: tieStage, error: null },
        ct_stage_entries: { data: tieStageEntries, error: null },
        ct_standings: { data: tieStandingsRows, error: null },
        event_entries: { data: tieRoster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.standings.every((row) => row.tieStatus === null)).toBe(true);
  });

  it('features the lowest-numbered running heat when more than one is timing/scoring at once — not whichever the DB happens to return first', async () => {
    // Deliberately out of heat_number order in the fixture and mixing
    // 'scoring' with 'timing' — a bug that sorted descending, or that
    // dropped the 'scoring' branch of the status filter, would both change
    // which heat wins here.
    const concurrentHeats = [
      {
        id: 'h3',
        stage_id: 's1',
        heat_number: 3,
        kind: 'normal',
        status: 'timing',
        timing_mode: 'app',
        started_at: '2026-09-04T10:10:00.000Z',
        duration_secs: 480,
      },
      {
        id: 'h1',
        stage_id: 's1',
        heat_number: 1,
        kind: 'normal',
        status: 'scoring',
        timing_mode: 'app',
        started_at: '2026-09-04T10:00:00.000Z',
        duration_secs: 480,
      },
    ];
    const heat3EntriesForTieBreak = [
      { id: 'he-c', heat_id: 'h3', entry_id: 'b', station: 'B', elapsed_secs: null, maxed: false },
    ];
    const heat1EntriesForTieBreak = [
      { id: 'he-d', heat_id: 'h1', entry_id: 'a', station: 'A', elapsed_secs: null, maxed: false },
    ];
    const client = fakeClient({
      tables: {
        ...baseTables(),
        ct_heats: { data: concurrentHeats, error: null },
        // listHeatsForStage iterates in array order — h3 first, so its
        // entries must be queued first too.
        ct_heat_entries: [
          { data: heat3EntriesForTieBreak, error: null },
          { data: heat1EntriesForTieBreak, error: null },
        ],
      },
    });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.activeHeat.heatNumber).toBe(1);
    expect(payload.activeHeat.status).toBe('scoring');
  });

  it('keeps only the RECENT_HEATS_LIMIT (3) most recent confirmed heats, newest first', async () => {
    function confirmedHeat(n) {
      return {
        id: `h${n}`,
        stage_id: 's1',
        heat_number: n,
        kind: 'normal',
        status: 'confirmed',
        timing_mode: 'app',
        started_at: `2026-09-04T10:0${n}:00.000Z`,
        duration_secs: 480,
      };
    }
    function entriesFor(n) {
      return [
        {
          id: `he-${n}`,
          heat_id: `h${n}`,
          entry_id: 'a',
          station: 'A',
          elapsed_secs: 100,
          maxed: false,
        },
      ];
    }
    function resultsFor(n, correctCount) {
      return Array.from({ length: correctCount }, (_, i) => ({
        heat_entry_id: `he-${n}`,
        set_id: `set${i}`,
        correct: true,
      }));
    }

    const fourHeats = [1, 2, 3, 4].map(confirmedHeat);
    const client = fakeClient({
      tables: {
        ...baseTables(),
        ct_heats: { data: fourHeats, error: null },
        // listHeatsForStage's own DB-side order is ascending by heat_number
        // (its own .order() call) — entries queued to match, 1 through 4.
        ct_heat_entries: [1, 2, 3, 4].map((n) => ({ data: entriesFor(n), error: null })),
        // Only the 3 SURFACED heats (4, 3, 2 — the slice/limit result) ever
        // get a results query; heat 1 is excluded by the cap and must never
        // be queried at all. Queued in the exact order buildLiveSessionPayload's
        // own descending-sorted loop visits them.
        ct_results: [4, 3, 2].map((n) => ({ data: resultsFor(n, n), error: null })),
      },
    });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.recentHeats.map((h) => h.heatNumber)).toEqual([4, 3, 2]);
    expect(payload.recentHeats[0].results[0].numCorrect).toBe(4);
    expect(payload.recentHeats[1].results[0].numCorrect).toBe(3);
    expect(payload.recentHeats[2].results[0].numCorrect).toBe(2);
  });

  it('has no activeHeat and an empty recentHeats when nothing has started or confirmed yet', async () => {
    const pendingHeats = [
      {
        id: 'h1',
        stage_id: 's1',
        heat_number: 1,
        kind: 'normal',
        status: 'pending',
        timing_mode: 'app',
        started_at: null,
        duration_secs: 480,
      },
    ];
    const client = fakeClient({
      tables: {
        ...baseTables(),
        ct_heats: { data: pendingHeats, error: null },
        ct_heat_entries: { data: heat1Entries, error: null },
      },
    });
    const payload = await buildLiveSessionPayload('s1', client);

    expect(payload.activeHeat).toBeNull();
    expect(payload.recentHeats).toEqual([]);
    // Standings still publish — a stage with heats generated but nothing
    // timed yet should still show the roster, ranked (everyone tied last).
    expect(payload.standings).toHaveLength(2);
  });

  // `champion` (2026-09-06, user request) — the whole tournament's own
  // winner, not a per-stage one. Only ever non-null once the TERMINAL stage
  // (cutoff: null) has been resolved (status: 'complete') — see
  // standingsScreen.js's own commitStageResolution, which sets that status
  // only once a single advancing entry exists at the terminal stage.
  describe('champion', () => {
    // Entry 'a' is the one commitStageResolution actually crowned —
    // final_position: 1 on its ct_stage_entries row, the real DB-persisted
    // signal (standings.js's own merge exposes this as ranked[].item.
    // finalPosition). Deliberately NOT derived from rank()'s own `position`
    // (ct_standings' correct_count/total_elapsed_secs alone) — see the next
    // test for exactly why that distinction is load-bearing, not pedantic.
    const stageEntriesWithChampion = [
      { id: 'se-a', stage_id: 's1', entry_id: 'a', final_position: 1 },
      { id: 'se-b', stage_id: 's1', entry_id: 'b', final_position: null },
    ];

    it('is the entry commitStageResolution actually crowned (final_position: 1) once the terminal stage is complete', async () => {
      const client = fakeClient({
        tables: {
          ...baseTables(),
          ct_stage_entries: { data: stageEntriesWithChampion, error: null },
          ct_stages: { data: { ...stage, cutoff: null, status: 'complete' }, error: null },
        },
      });
      const payload = await buildLiveSessionPayload('s1', client);
      expect(payload.champion).toBe('Alex');
    });

    // The regression this guards (found in review, scoring-auditor,
    // 2026-09-06): a border tie broken by a tiebreak heat or coin toss
    // leaves BOTH tied cuppers' ct_standings rows identical (a tiebreak
    // heat's own results are deliberately excluded from ct_standings — see
    // standings.js's own comment) — so rank()'s `position` alone gives both
    // entries `position: 1`, and picking "whichever tied row sorts first"
    // has no relationship to who actually won. Bailey (entry 'b') is the
    // real winner here (final_position: 1), Alex (entry 'a') is the one who
    // lost the tiebreak — an implementation keyed on `position` would wrongly
    // crown Alex, since untouched `standings.js` fixture ordering/rank()
    // ties always resolve to whichever row the DB happens to return first.
    it('picks the actual tiebreak/coin-toss winner, not whichever tied entry happens to sort first — the exact case a contested finals produces', async () => {
      const tiedStandingsRows = [
        {
          entry_id: 'a',
          stage_id: 's1',
          correct_count: 6,
          sets_scored: 8,
          total_elapsed_secs: 200,
        },
        {
          entry_id: 'b',
          stage_id: 's1',
          correct_count: 6,
          sets_scored: 8,
          total_elapsed_secs: 200,
        },
      ];
      const stageEntriesTiebreakWinnerIsB = [
        { id: 'se-a', stage_id: 's1', entry_id: 'a', final_position: null },
        { id: 'se-b', stage_id: 's1', entry_id: 'b', final_position: 1 },
      ];
      const client = fakeClient({
        tables: {
          ...baseTables(),
          ct_standings: { data: tiedStandingsRows, error: null },
          ct_stage_entries: { data: stageEntriesTiebreakWinnerIsB, error: null },
          ct_stages: { data: { ...stage, cutoff: null, status: 'complete' }, error: null },
        },
      });
      const payload = await buildLiveSessionPayload('s1', client);
      // Both rows would report position 1 from rank() alone (a genuine
      // tie on the primary tally) — proving the payload's OWN standings
      // still reflect that shared position, so this isn't testing an
      // impossible fixture.
      expect(payload.standings.filter((row) => row.position === 1)).toHaveLength(2);
      expect(payload.champion).toBe('Bailey');
    });

    it('stays null for a non-terminal stage even once it is complete — advancing to the next stage never crowns a whole-tournament champion', async () => {
      const client = fakeClient({
        tables: {
          ...baseTables(),
          ct_stage_entries: { data: stageEntriesWithChampion, error: null },
          ct_stages: { data: { ...stage, cutoff: 4, status: 'complete' }, error: null },
        },
      });
      const payload = await buildLiveSessionPayload('s1', client);
      expect(payload.champion).toBeNull();
    });

    it('stays null for the terminal stage before it has been resolved', async () => {
      const client = fakeClient({
        tables: {
          ...baseTables(),
          ct_stage_entries: { data: stageEntriesWithChampion, error: null },
          ct_stages: { data: { ...stage, cutoff: null, status: 'running' }, error: null },
        },
      });
      const payload = await buildLiveSessionPayload('s1', client);
      expect(payload.champion).toBeNull();
    });
  });
});

describe('publishLiveSession', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  it('builds the payload and enqueues+flushes it as a publish_session RPC, with isTest threaded through unchanged', async () => {
    const rpcCalls = [];
    const client = fakeClient({
      tables: baseTables(),
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    const result = await publishLiveSession(
      { orgId: 'org1', eventId: 'ev1', stageId: 's1', isTest: true },
      client,
    );

    expect(result.processed).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    const [name, rpcPayload] = rpcCalls[0];
    expect(name).toBe('publish_session');
    expect(rpcPayload.p_org_id).toBe('org1');
    expect(rpcPayload.p_event_id).toBe('ev1');
    expect(rpcPayload.p_format).toBe('cup_taster');
    expect(rpcPayload.p_is_test).toBe(true);
    expect(rpcPayload.p_payload.stage).toEqual({ kind: 'prelims', ordinal: 1, setCount: 8 });
    expect(rpcPayload.p_payload.activeHeat.heatNumber).toBe(2);
    expect(rpcPayload.p_payload.recentHeats).toHaveLength(1);
    // The ordering-guard key publish_session's own snapshot_at column
    // compares against (ROADMAP.md's "No ordering guard on live_sessions's
    // upsert" gap, closed 2026-09-12) — a real ISO timestamp captured
    // before the read chain above, not the RPC's own server-side default.
    expect(rpcPayload.p_snapshot_at).toEqual(expect.any(String));
    expect(new Date(rpcPayload.p_snapshot_at).toISOString()).toBe(rpcPayload.p_snapshot_at);
  });

  it('captures p_snapshot_at BEFORE buildLiveSessionPayload\'s own read chain, not after — so a slower read still reports the earlier, causally-correct moment', async () => {
    // A bare before/after Date.now() bracket around the whole call wouldn't
    // actually distinguish "captured before the read" from "captured
    // after" — fakeClient's reads all resolve synchronously, so both
    // capture points would fall inside the same microtask-wide window and
    // the assertion would pass either way (found in review, code-reviewer,
    // 2026-09-12). An artificial delay on the FIRST real read
    // (ct_stages, via findStageById) makes the two capture points
    // genuinely distinguishable: captured before, the snapshot lands near
    // `before`; captured after, it would land near `before + delayMs`.
    const delayMs = 50;
    const rpcCalls = [];
    let ctStagesCallCount = 0;
    const client = fakeClient({ tables: baseTables(), rpc: (name, payload) => {
      rpcCalls.push([name, payload]);
      return Promise.resolve({ data: null, error: null });
    } });
    // Patched IN PLACE, not wrapped-and-returned-as-a-copy — this fake's own
    // `select()`/`eq()` chain methods all close over and return the SAME
    // `builder` object `.from()` constructs, so a copy with an overridden
    // `single` would be silently bypassed the moment `.select()` is called
    // on it (it returns the ORIGINAL object, not the copy) — found by
    // actually mutation-testing this assertion (moving the real capture
    // point after the read and confirming THIS version of the test fails,
    // which the first version did not).
    const realFrom = client.from.bind(client);
    client.from = (table) => {
      const builder = realFrom(table);
      if (table === 'ct_stages') {
        ctStagesCallCount += 1;
        const realSingle = builder.single.bind(builder);
        builder.single = () => {
          const result = realSingle();
          return new Promise((resolve) => setTimeout(() => resolve(result), delayMs));
        };
      }
      return builder;
    };

    const before = Date.now();
    await publishLiveSession({ orgId: 'org1', eventId: 'ev1', stageId: 's1', isTest: true }, client);

    expect(ctStagesCallCount).toBeGreaterThan(0); // the delay actually applied to a real read
    const [, rpcPayload] = rpcCalls[0];
    const snapshotMs = new Date(rpcPayload.p_snapshot_at).getTime();
    // Captured before the delay: well under `before + delayMs`. A capture
    // taken AFTER the read chain would land at or past that threshold.
    expect(snapshotMs).toBeGreaterThanOrEqual(before);
    expect(snapshotMs).toBeLessThan(before + delayMs);
  });

  it('threads an explicit isTest: false through unchanged — not coerced to true by a falsy-defaulting bug', async () => {
    const rpcCalls = [];
    const client = fakeClient({
      tables: baseTables(),
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await publishLiveSession(
      { orgId: 'org1', eventId: 'ev1', stageId: 's1', isTest: false },
      client,
    );

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0][1].p_is_test).toBe(false);
  });

  it('throws if isTest is not an explicit boolean', async () => {
    const client = fakeClient({ tables: baseTables() });
    await expect(
      publishLiveSession({ orgId: 'org1', eventId: 'ev1', stageId: 's1' }, client),
    ).rejects.toThrow(/isTest must be explicitly true or false/);
  });

  it('does not mark a 401 (auth/JWT problem) as permanent — this handler hand-rolls its own error-to-permanent mapping since it cannot reuse core/outbox.js\'s buildRpcHandler, so it needs the identical carve-out separately (found in review, code-reviewer, 2026-09-12: the first version of this fix updated buildRpcHandler but missed this second mapping entirely)', async () => {
    const client = fakeClient({
      tables: baseTables(),
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: 'JWT expired', code: 'PGRST303' },
          status: 401,
        }),
    });
    const handlers = publishLiveSessionHandlers(client);
    await expect(
      handlers.publish_live_session({
        orgId: 'org1',
        eventId: 'ev1',
        stageId: 's1',
        format: 'cup_taster',
        isTest: false,
      }),
    ).rejects.toMatchObject({ message: 'JWT expired', permanent: false });
  });

  it('still marks a genuine server-side rejection as permanent — the 401 carve-out does not weaken this for real rejections', async () => {
    const client = fakeClient({
      tables: baseTables(),
      rpc: () =>
        Promise.resolve({
          data: null,
          error: { message: 'event not found', code: 'P0001' },
          status: 400,
        }),
    });
    const handlers = publishLiveSessionHandlers(client);
    await expect(
      handlers.publish_live_session({
        orgId: 'org1',
        eventId: 'ev1',
        stageId: 's1',
        format: 'cup_taster',
        isTest: false,
      }),
    ).rejects.toMatchObject({ message: 'event not found', permanent: true });
  });

  it('enqueues the publish intent even when the device is offline — a read-chain failure must not drop it (found in review: offline-sync-auditor)', async () => {
    // Every read fails exactly like a real dropped connection resolving
    // with an error rather than rejecting (core/outbox.js's own documented
    // supabase-js behavior) — a plain Error with no `.permanent` flag, so
    // it's retryable, not a genuine server rejection.
    const networkError = new Error('network unreachable');
    const offlineBuilder = {
      select: () => offlineBuilder,
      eq: () => offlineBuilder,
      in: () => offlineBuilder,
      order: () => offlineBuilder,
      single: () => Promise.resolve({ data: null, error: networkError }),
      maybeSingle: () => Promise.resolve({ data: null, error: networkError }),
      then: (onResolve) => Promise.resolve({ data: null, error: networkError }).then(onResolve),
    };
    const offlineClient = {
      from: () => offlineBuilder,
      rpc: () => Promise.resolve({ data: null, error: networkError }),
    };

    // Must not throw — flushOutbox catches the handler's own read-chain
    // failure internally, same as any other outbox write's flush attempt.
    const result = await publishLiveSession(
      { orgId: 'org1', eventId: 'ev1', stageId: 's1', isTest: false },
      offlineClient,
    );
    expect(result.stopped).toBe(true);
    expect(result.permanentFailure).toBe(false);

    // The core of the fix: the intent survived in the outbox, not lost —
    // this is what the original (pre-fix) version of this module could
    // never produce, since its read-chain failure happened BEFORE
    // enqueueOperation was ever reached.
    const pending = await listPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].type).toBe('publish_live_session');
    expect(pending[0].payload).toEqual({
      orgId: 'org1',
      eventId: 'ev1',
      stageId: 's1',
      format: 'cup_taster',
      isTest: false,
    });

    // Reconnect: a later flush (main.js's reconnect-triggered flush, or the
    // next screen action, both pass a real client) drains the queued intent
    // and publishes fresh state built at THAT time, not stale data from the
    // original failed attempt.
    const rpcCalls = [];
    const onlineClient = fakeClient({
      tables: baseTables(),
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });
    const flushResult = await flushOutbox(publishLiveSessionHandlers(onlineClient));

    expect(flushResult.processed).toBe(1);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0][1].p_is_test).toBe(false);
    expect(rpcCalls[0][1].p_payload.activeHeat.heatNumber).toBe(2);
  });
});
