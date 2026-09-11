import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderStandingsTable, mountStandingsScreen } from './standingsScreen.js';
import { _clearAllForTests } from '../../core/db.js';

// Same fakeClient shape as standings.test.js/scoringScreen.test.js — queues
// consumed strictly in call order per table. `rpc`, when passed, matches
// liveSession.test.js's own fakeClient shape — needed here now that commit()
// also calls publishLiveSession (the "declare champion"/"advance" resolution
// is now a third automatic-publish trigger, alongside heat start/confirm).
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

const event = { id: 'ev1', org_id: 'org1', is_test: false };
const roster = [
  { id: 'e1', display_name: 'Alex' },
  { id: 'e2', display_name: 'Jordan' },
  { id: 'e3', display_name: 'Sam' },
];
const stageEntries = [
  { id: 'se1', stage_id: 's1', entry_id: 'e1' },
  { id: 'se2', stage_id: 's1', entry_id: 'e2' },
  { id: 'se3', stage_id: 's1', entry_id: 'e3' },
];

describe('renderStandingsTable', () => {
  const ranked = [
    {
      item: {
        stageEntryId: 'se1',
        entry_id: 'e1',
        displayName: 'Alex',
        numCorrect: 5,
        total_elapsed_secs: 120,
      },
      position: 1,
    },
    {
      item: {
        stageEntryId: 'se2',
        entry_id: 'e2',
        displayName: 'Jordan',
        numCorrect: 3,
        total_elapsed_secs: null,
      },
      position: 2,
    },
  ];

  it('renders position, name, correct count, and time', () => {
    const table = renderStandingsTable(ranked);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.standings-position').textContent).toBe('1');
    expect(rows[0].querySelector('.standings-name').textContent).toBe('Alex');
    expect(rows[0].querySelector('.standings-correct').textContent).toBe('5');
    // The visible text is the cell's own first child node (a bare text
    // node) — its own screen-reader expansion (a nested .sr-only span,
    // asserted separately below) also contributes to a bare .textContent
    // read, so checking that node specifically, not the whole cell, is
    // what actually proves the VISIBLE format is M:SS.
    const timeCell = rows[0].querySelector('.standings-time');
    expect(timeCell.childNodes[0].textContent).toBe('2:00');
  });

  it('pairs the visible M:SS time with an unambiguous screen-reader expansion, not a bare colon-separated numeral', () => {
    const table = renderStandingsTable(ranked);
    const timeCell = table.querySelector('.standings-time');
    expect(timeCell.querySelector('.sr-only').textContent).toBe('2 minutes 0 seconds');
  });

  it('shows a plain em dash for a cupper with no recorded time, with no screen-reader expansion needed', () => {
    const noTimeRanked = [
      {
        item: {
          stageEntryId: 'se3',
          displayName: 'Sam',
          numCorrect: 0,
          total_elapsed_secs: null,
          finalPosition: null,
        },
        position: 3,
      },
    ];
    const table = renderStandingsTable(noTimeRanked);
    const timeCell = table.querySelector('.standings-time');
    expect(timeCell.textContent).toBe('—');
    expect(timeCell.querySelector('.sr-only')).toBeNull();
  });

  it('shows an em dash, not "nulls", for an entry with no recorded time yet', () => {
    const table = renderStandingsTable(ranked);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[1].querySelector('.standings-time').textContent).toBe('—');
  });

  it('marks an advancing row with data-status="advancing"', () => {
    const table = renderStandingsTable(ranked, { advancingIds: new Set(['se1']) });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].dataset.status).toBe('advancing');
    expect(rows[1].dataset.status).toBeUndefined();
  });

  it('marks a tied row with data-status="tied"', () => {
    const table = renderStandingsTable(ranked, { tiedBorderIds: new Set(['se2']) });
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[1].dataset.status).toBe('tied');
  });

  it('every column header uses scope="col" for table accessibility, matching the convention heatsScreen.js already established', () => {
    const table = renderStandingsTable(ranked);
    const headers = table.querySelectorAll('thead th');
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');
  });
});

describe('mountStandingsScreen', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  it('shows a "waiting" message, no action, when not every heat is confirmed yet', async () => {
    const root = document.createElement('div');
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'running',
    };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals', cutoff: null };
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: [], error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'timing' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Waiting on 1 more heat');
    expect(root.querySelector('.btn-primary')).toBeNull();
  });

  it('offers "Advance to next stage" when every heat is confirmed and there is no border tie, and publishes to live_sessions too — the third publish trigger fires on EVERY resolution, not just the terminal/champion one', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'running',
    };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals', cutoff: null };
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e3', stage_id: 's1', correct_count: 1, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const rpcCalls = [];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
          // commit()'s own ground-truth re-check, publishLiveSession's own
          // internal fetchStandingsForStage, and the post-commit render's
          // own loadState() all land here once the queue is down to its
          // last entry — all correctly see the stage as resolved.
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Advance to next stage');

    button.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    // Advancement is now committed atomically via the resolve_stage RPC
    // (migration 20260906060000), enqueued/flushed through the outbox —
    // never a direct client-side insert into ct_stage_entries.
    await vi.waitFor(() => {
      expect(rpcCalls.some(([name]) => name === 'resolve_stage')).toBe(true);
    });
    const [, resolveStagePayload] = rpcCalls.find(([name]) => name === 'resolve_stage');
    expect(resolveStagePayload.p_org_id).toBe('org1');
    expect(resolveStagePayload.p_stage_id).toBe('s1');
    expect(resolveStagePayload.p_next_stage_id).toBe('s2');
    // Only cutoff (2) entries advance — e1 and e2, both clean, neither tied.
    expect(resolveStagePayload.p_advancing_entries).toEqual([
      { entry_id: 'e1', source: 'advanced' },
      { entry_id: 'e2', source: 'advanced' },
    ]);

    await vi.waitFor(() => {
      expect(rpcCalls.some(([name]) => name === 'publish_session')).toBe(true);
    });
    const [, publishPayload] = rpcCalls.find(([name]) => name === 'publish_session');
    expect(publishPayload.p_event_id).toBe('ev1');
    document.body.removeChild(root);
  });

  it('disables "Advance to next stage" and relabels it the instant it is clicked, before the write settles — ROADMAP.md gap, closed 2026-09-11: this button stayed clickable for the whole commit round trip with no visible sign a write was in flight', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'running',
    };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals', cutoff: null };
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e3', stage_id: 's1', correct_count: 1, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');

    button.click();

    // No await in between — the mutation must happen synchronously, before
    // commit()'s own first `await`, or this proves nothing about the actual
    // in-flight window.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Advancing…');

    document.body.removeChild(root);
  });

  it('re-enables "Advance to next stage" and restores its original label if render() itself throws after the commit succeeds — otherwise it would stay stuck disabled forever with no on-screen retry path (code-reviewer, 2026-09-11 follow-up)', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'running',
    };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals', cutoff: null };
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e3', stage_id: 's1', correct_count: 1, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const client = fakeClient({
      tables: {
        // First response serves the initial mount's own loadState(); the
        // second — an error — serves the post-commit render()'s
        // loadState(), simulating a dropped connection right after the
        // commit already succeeded.
        events: [
          { data: event, error: null },
          { data: null, error: new Error('connection dropped') },
        ],
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');

    button.click();
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
    });

    expect(button.textContent).toBe('Advance to next stage');
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');

    document.body.removeChild(root);
  });

  it('says "Declare champion" at the terminal stage (cutoff: null), and publishes to live_sessions once resolved — the third automatic-publish trigger, alongside heat start/confirm', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 2,
      kind: 'finals',
      cutoff: null,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 3, sets_scored: 6, total_elapsed_secs: 90 },
    ];
    const rpcCalls = [];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        // Initial mount sees the stage still 'running' (findNextStage is
        // short-circuited regardless, since cutoff is null); the ledger
        // ground-truth check, publishLiveSession's own read, and the
        // post-commit render's own loadState() all then see it 'complete'
        // once the queue is down to its last entry.
        ct_stages: [
          { data: stage, error: null },
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Declare champion');

    button.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Champion declared.');
    });

    // Champion declaration is now committed atomically via the
    // resolve_stage RPC, not a direct client-side update.
    await vi.waitFor(() => {
      expect(rpcCalls.some(([name]) => name === 'resolve_stage')).toBe(true);
    });
    const [, resolveStagePayload] = rpcCalls.find(([name]) => name === 'resolve_stage');
    expect(resolveStagePayload.p_next_stage_id).toBeNull();
    expect(resolveStagePayload.p_champion_stage_entry_id).toBe('se1');

    // The publish is best-effort and asynchronous (enqueue-then-flush,
    // matching timingScreen.js/scoringScreen.js's own identical calls) — it
    // isn't awaited by commit() itself, so it may land just after the
    // success message does.
    await vi.waitFor(() => {
      expect(rpcCalls.some(([name]) => name === 'publish_session')).toBe(true);
    });
    const [, publishPayload] = rpcCalls.find(([name]) => name === 'publish_session');
    expect(publishPayload.p_org_id).toBe('org1');
    expect(publishPayload.p_event_id).toBe('ev1');
    expect(publishPayload.p_format).toBe('cup_taster');
    expect(publishPayload.p_is_test).toBe(false);
    document.body.removeChild(root);
  });

  it('surfaces a clear error, and commits nothing, when a cutoff stage has no next stage to advance into — a stage-plan gap, not evidence this is secretly terminal', async () => {
    // Found in live browser verification: a preview fixture that mistakenly
    // used `cutoff: 1` (a real cutoff, not `null`) with no ordinal-2 stage
    // seeded produced `nextStage === null` for a non-terminal stage. Before
    // this guard, buildCommitPlan used `nextStage === null` as its own
    // "is terminal" signal (redundantly, alongside a separately-correct
    // `data.stage.cutoff == null` check elsewhere) and would have silently
    // committed a champion instead of failing loudly.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 3, sets_scored: 6, total_elapsed_secs: 90 },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        // No ordinal-2 row at all — findNextStage's own findStageByOrdinal
        // resolves to null both times it's queried: once on initial mount,
        // once on the re-render after the failed commit attempt below (each
        // loadState() pass does findStageById then findNextStage, in order).
        ct_stages: [
          { data: stage, error: null },
          { data: null, error: null },
          { data: stage, error: null },
          { data: null, error: null },
        ],
        ct_stage_entries: { data: stageEntries.slice(0, 2), error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    root.querySelector('.btn-primary').click();

    await vi.waitFor(() => {
      expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    });
    expect(root.querySelector('.screen-feedback').textContent).toContain(
      'stage plan may be incomplete',
    );
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_stage_entries'),
    ).toBe(false);
    expect(
      client.calls.some(([action, table]) => action === 'update' && table === 'ct_stages'),
    ).toBe(false);
    document.body.removeChild(root);
  });

  it('offers "Create tiebreak heat" when a border tie exists and no tiebreak heat has been created yet', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('2 cuppers are tied at the border');
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Create tiebreak heat');
  });

  it('disables "Create tiebreak heat" and relabels it "Creating…" the instant it is clicked, before the write settles — ROADMAP.md gap, closed 2026-09-11', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');

    button.click();

    // No await in between — the mutation must happen synchronously.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Creating…');

    document.body.removeChild(root);
  });

  it("shows the tiebreak heat's status, no action, while it is not yet confirmed", async () => {
    const root = document.createElement('div');
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            { id: 'tb1', stage_id: 's1', kind: 'tiebreak', heat_number: 1, status: 'timing' },
          ],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Tiebreak heat 1 is "timing"');
    expect(root.querySelector('.btn-primary')).toBeNull();
  });

  it('disables the "tiebreak-resolved" commit button and relabels it the instant it is clicked, before the write settles — ROADMAP.md gap, closed 2026-09-11', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 5 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: false },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');

    button.click();

    // No await in between — the mutation must happen synchronously.
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Advancing…');

    document.body.removeChild(root);
  });

  it('offers "Advance to next stage" once the tiebreak heat resolves the tie cleanly', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 5 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: false },
    ];
    const rpcCalls = [];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
          // ground truth check + publishLiveSession's own read + the
          // post-commit render's own loadState() all land here once the
          // queue is down to its last entry.
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null }, // listHeatsForStage: h1's own entries
          { data: [], error: null }, // listHeatsForStage: tb1's own entries
          { data: tiebreakHeatEntries, error: null }, // fetchTiebreakHeatOutcome's own listHeatEntries
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('The tiebreak heat resolved the tie.');
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Advance to next stage');

    button.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    const [, resolveStagePayload] = rpcCalls.find(([name]) => name === 'resolve_stage');
    expect(resolveStagePayload.p_advancing_entries).toEqual([
      { entry_id: 'e1', source: 'tiebreak_won' },
    ]);
    expect(resolveStagePayload.p_eliminated).toEqual([
      { stage_entry_id: 'se2', via_coin_toss: false },
    ]);
    expect(resolveStagePayload.p_final_position).toBe(2);
    document.body.removeChild(root);
  });

  it('disables the coin-toss submit button and relabels it "Recording coin toss…" the instant a valid submission is clicked, before the write settles — ROADMAP.md gap, closed 2026-09-11', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 10 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: true },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    root.querySelector('.coin-toss-list input[type="checkbox"]').click();
    const noteInput = root.querySelector('#coin-toss-note');
    noteInput.value = 'coin toss, witnessed by organiser';
    noteInput.dispatchEvent(new Event('input'));
    const submitButton = root.querySelector('.btn-primary');

    submitButton.click();

    // No await in between — the mutation must happen synchronously, and
    // only because the selection/note validation above already passed (an
    // invalid submission must NOT disable this button — see the two early
    // `return`s in standingsScreen.js's own handler).
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe('Recording coin toss…');

    document.body.removeChild(root);
  });

  it('shows a coin-toss selector when the tiebreak heat also draws, and commits everything from one submit', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 10 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: true },
    ];
    // The checkbox/note fields never trigger a re-render on their own (see
    // their own handlers' comments in standingsScreen.js) — only two
    // loadState() passes happen in this whole flow: the initial mount, and
    // the one render after a successful commit. `ct_stages`/`ct_heat_entries`
    // both need two distinct values per pass (see their own comments below),
    // so each queue here is sized for exactly those two passes.
    const rpcCalls = [];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null }, // pass 1: findStageById
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null }, // pass 1: findNextStage
          // ground truth check + publishLiveSession's own read + the
          // post-commit render's own loadState() all land here once the
          // queue is down to its last entry (correctly 'complete' now,
          // so pass 2 never re-queries findNextStage at all).
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null }, // pass 1: listHeatsForStage's h1 entries
          { data: [], error: null }, // pass 1: listHeatsForStage's tb1 entries
          { data: tiebreakHeatEntries, error: null }, // pass 1: fetchTiebreakHeatOutcome
          { data: [], error: null }, // pass 2: listHeatsForStage's h1 entries
          { data: [], error: null }, // pass 2: listHeatsForStage's tb1 entries
          { data: tiebreakHeatEntries, error: null }, // pass 2: fetchTiebreakHeatOutcome
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('The tiebreak heat also drew');
    expect(root.textContent).toContain('exactly 1 winner');

    // The checkbox group is a real <fieldset>/<legend>, not a bare <ul>
    // below an unrelated paragraph — a screen reader landing directly on a
    // checkbox (Tab order, or a rotor/forms list) must hear the exactly-N
    // group instruction, not just the checkbox's own cupper-name label.
    const fieldset = root.querySelector('fieldset.coin-toss-fieldset');
    expect(fieldset).not.toBeNull();
    const legend = fieldset.querySelector('legend');
    expect(legend.textContent).toContain('exactly 1 winner');
    expect(fieldset.querySelector('.coin-toss-list')).not.toBeNull();

    root.querySelector('.coin-toss-list input[type="checkbox"]').click();
    const noteInput = root.querySelector('#coin-toss-note');
    noteInput.value = 'coin toss, witnessed by organiser';
    noteInput.dispatchEvent(new Event('input'));

    root.querySelector('.btn-primary').click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    const [, resolveStagePayload] = rpcCalls.find(([name]) => name === 'resolve_stage');
    expect(resolveStagePayload.p_advancing_entries).toHaveLength(1);
    expect(resolveStagePayload.p_advancing_entries[0].source).toBe('coin_toss');
    expect(resolveStagePayload.p_coin_toss_note).toBe('coin toss, witnessed by organiser');

    expect(resolveStagePayload.p_eliminated).toHaveLength(1);
    expect(resolveStagePayload.p_eliminated[0].via_coin_toss).toBe(true);
    document.body.removeChild(root);
  });

  it('requires exactly the right number of coin-toss winners selected before it will commit anything', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 10 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: true },
    ];
    // Two loadState() passes: initial mount, then the render after the
    // rejected (invalid-selection) submit attempt — an error render still
    // goes through renderOrShowError -> render() -> a fresh loadState().
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });

    // Nothing selected, no note — submitting must not commit anything.
    root.querySelector('.btn-primary').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.screen-feedback').textContent).toContain(
        'Select exactly 1 winner',
      );
    });
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_stage_entries'),
    ).toBe(false);
    expect(
      client.calls.some(([action, table]) => action === 'update' && table === 'ct_stages'),
    ).toBe(false);

    document.body.removeChild(root);
  });

  it('requires a note before it will commit anything, even with a valid winner selection', async () => {
    // Found in review (test-auditor): the sibling test above only ever
    // exercised the wrong-selection-count guard — the code has a SECOND,
    // independent guard for an empty note that nothing asserted on, so it
    // could have been deleted or its message changed with the suite still
    // green.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 1,
      status: 'running',
    };
    const twoEntries = stageEntries.slice(0, 2);
    const tiedStandings = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    const tiebreakHeatEntries = [
      { id: 'the1', heat_id: 'tb1', entry_id: 'e1', elapsed_secs: 10 },
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 10 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the1', set_id: 'set1', correct: true },
      { heat_entry_id: 'the2', set_id: 'set1', correct: true },
    ];
    // Two loadState() passes: initial mount, then the render after the
    // rejected (missing-note) submit attempt.
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
          { data: stage, error: null },
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null },
        ],
        ct_stage_entries: { data: twoEntries, error: null },
        ct_standings: { data: tiedStandings, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
          { data: [], error: null },
          { data: [], error: null },
          { data: tiebreakHeatEntries, error: null },
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });

    // Exactly the right number selected, but no note typed — must still
    // refuse to commit.
    root.querySelector('.coin-toss-list input[type="checkbox"]').click();
    root.querySelector('.btn-primary').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.screen-feedback').textContent).toContain('A note is required');
    });
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_stage_entries'),
    ).toBe(false);
    expect(
      client.calls.some(([action, table]) => action === 'update' && table === 'ct_stages'),
    ).toBe(false);

    document.body.removeChild(root);
  });

  it('a cupper ranked distinctly BELOW a coin-toss subgroup (never itself tied with anyone, at any level) still gets eliminated with a final_position — regression for a real bug found in review', async () => {
    // Reproduces the exact scenario scoring-auditor found live: a 4-way
    // border tie (e2/e3/e4/e5) for 2 remaining slots. The tiebreak heat
    // partially resolves it — e2 wins outright, e3/e4 stay tied (needing a
    // coin toss for the one slot left), and e5 ranks clearly LAST in the
    // tiebreak heat. e5 is never a member of ANY tiedAtBorder group at any
    // level (core/advancement's own break-without-visiting loop never even
    // forms a group for them) — before the fix, e5's ct_stage_entries row
    // would have been left with no final_position at all, forever, on a
    // stage the UI reports as closed.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 3,
      status: 'running',
    };
    const nextStage = { id: 's2', event_id: 'ev1', ordinal: 2, kind: 'finals', cutoff: null };
    const bigRoster = [
      { id: 'e1', display_name: 'One' },
      { id: 'e2', display_name: 'Two' },
      { id: 'e3', display_name: 'Three' },
      { id: 'e4', display_name: 'Four' },
      { id: 'e5', display_name: 'Five' },
      { id: 'e6', display_name: 'Six' },
    ];
    const bigStageEntries = bigRoster.map((r, i) => ({
      id: `se${i + 1}`,
      stage_id: 's1',
      entry_id: r.id,
    }));
    // e1 clear #1 (advances clean). e2/e3/e4/e5 tied at #2 (4-way, only 2
    // slots left after e1). e6 clear last (never in any tie, never even
    // reached by computeAdvancement's own loop).
    const standingsRows = [
      { entry_id: 'e1', stage_id: 's1', correct_count: 5, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e2', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e3', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e4', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e5', stage_id: 's1', correct_count: 4, sets_scored: 6, total_elapsed_secs: 100 },
      { entry_id: 'e6', stage_id: 's1', correct_count: 1, sets_scored: 6, total_elapsed_secs: 200 },
    ];
    const tiebreakHeat = {
      id: 'tb1',
      stage_id: 's1',
      kind: 'tiebreak',
      heat_number: 1,
      status: 'confirmed',
    };
    // e2 wins outright (fastest). e3/e4 tied. e5 clearly last — distinct
    // from, and never tied with, the e3/e4 subgroup.
    const tiebreakHeatEntries = [
      { id: 'the2', heat_id: 'tb1', entry_id: 'e2', elapsed_secs: 5 },
      { id: 'the3', heat_id: 'tb1', entry_id: 'e3', elapsed_secs: 10 },
      { id: 'the4', heat_id: 'tb1', entry_id: 'e4', elapsed_secs: 10 },
      { id: 'the5', heat_id: 'tb1', entry_id: 'e5', elapsed_secs: 15 },
    ];
    const tiebreakResults = [
      { heat_entry_id: 'the2', set_id: 'setX', correct: true },
      { heat_entry_id: 'the3', set_id: 'setX', correct: true },
      { heat_entry_id: 'the4', set_id: 'setX', correct: true },
      { heat_entry_id: 'the5', set_id: 'setX', correct: false },
    ];
    const rpcCalls = [];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
          // ground truth check + publishLiveSession's own read + the
          // post-commit render's own loadState() all land here once the
          // queue is down to its last entry.
          { data: { ...stage, status: 'complete' }, error: null },
        ],
        ct_stage_entries: { data: bigStageEntries, error: null },
        ct_standings: { data: standingsRows, error: null },
        event_entries: { data: bigRoster, error: null },
        ct_heats: {
          data: [
            { id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' },
            tiebreakHeat,
          ],
          error: null,
        },
        ct_heat_entries: [
          { data: [], error: null }, // pass 1: listHeatsForStage's h1 entries
          { data: [], error: null }, // pass 1: listHeatsForStage's tb1 entries
          { data: tiebreakHeatEntries, error: null }, // pass 1: fetchTiebreakHeatOutcome
          { data: [], error: null }, // pass 2
          { data: [], error: null }, // pass 2
          { data: tiebreakHeatEntries, error: null }, // pass 2
        ],
        ct_results: { data: tiebreakResults, error: null },
      },
      rpc: (name, payload) => {
        rpcCalls.push([name, payload]);
        return Promise.resolve({ data: null, error: null });
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('The tiebreak heat also drew');
    // Only 1 slot left after e1 (clean) and e2 (tiebreak_won) — exactly the
    // scenario's own arithmetic, exercising the subtraction with a nonzero
    // stageLevel.advancing.length too (not just a cutoff:1 all-tied case).
    expect(root.textContent).toContain('exactly 1 winner');

    // e3 wins the coin toss; e4 loses it; e5 is never even offered a
    // checkbox (it was never in tiedAtBorder at the tiebreak level).
    const checkboxes = [...root.querySelectorAll('.coin-toss-list input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2); // only e3 and e4 — e5 correctly excluded from the picker
    checkboxes[0].click();
    const noteInput = root.querySelector('#coin-toss-note');
    noteInput.value = 'coin toss, witnessed by organiser';
    noteInput.dispatchEvent(new Event('input'));
    root.querySelector('.btn-primary').click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    // e5's row (se5) must be in p_eliminated with a final_position — the
    // exact thing the pre-fix code silently never did. e4's row (se4) is
    // also eliminated, but via the coin toss, so it carries the note.
    const [, resolveStagePayload] = rpcCalls.find(([name]) => name === 'resolve_stage');
    expect(resolveStagePayload.p_final_position).toBe(4);

    const se5Row = resolveStagePayload.p_eliminated.find((row) => row.stage_entry_id === 'se5');
    expect(se5Row).toEqual({ stage_entry_id: 'se5', via_coin_toss: false });

    const se4Row = resolveStagePayload.p_eliminated.find((row) => row.stage_entry_id === 'se4');
    expect(se4Row).toEqual({ stage_entry_id: 'se4', via_coin_toss: true });
    expect(resolveStagePayload.p_coin_toss_note).toBe('coin toss, witnessed by organiser');

    document.body.removeChild(root);
  });

  it('shows a closed message and no action once the stage is already complete', async () => {
    const root = document.createElement('div');
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'complete',
    };
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: [], error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Advanced. This stage is closed.');
    expect(root.querySelector('.btn-primary')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'complete',
    };
    const client = fakeClient({
      tables: {
        events: { data: { ...event, is_test: true }, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        ct_standings: { data: [], error: null },
        event_entries: { data: roster, error: null },
        ct_heats: {
          data: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'confirmed' }],
          error: null,
        },
        ct_heat_entries: { data: [], error: null },
      },
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own INITIAL load is still in flight when
    // the router (in production) decides a newer navigation has superseded
    // it and aborts this mount's signal — well before render()'s own
    // loadState() promise gets a chance to resolve. Distinct from the
    // renderGeneration/actionInFlight guards this screen already has, which
    // protect against races WITHIN one already-mounted screen instance.
    let resolveEvent;
    const stage = {
      id: 's1',
      event_id: 'ev1',
      ordinal: 1,
      kind: 'prelims',
      cutoff: 2,
      status: 'running',
    };
    const otherTables = {
      ct_stages: [stage],
      ct_stage_entries: stageEntries,
      ct_standings: [],
      event_entries: roster,
      ct_heats: [{ id: 'h1', stage_id: 's1', kind: 'normal', heat_number: 1, status: 'timing' }],
      ct_heat_entries: [],
    };
    const client = {
      from(table) {
        if (table !== 'events') {
          const queue = [...(otherTables[table] ?? [])];
          const builder = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            order: () => builder,
            single: () => Promise.resolve({ data: queue[0] ?? null, error: null }),
            maybeSingle: () => Promise.resolve({ data: queue[0] ?? null, error: null }),
            then: (resolve) => Promise.resolve({ data: queue, error: null }).then(resolve),
          };
          return builder;
        }
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                new Promise((resolve) => {
                  resolveEvent = () => resolve({ data: event, error: null });
                }),
            }),
          }),
        };
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountStandingsScreen(root, {
      eventId: 'ev1',
      stageId: 's1',
      client,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveEvent).toBeDefined());

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveEvent();
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own standings table.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Waiting on');
  });
});
