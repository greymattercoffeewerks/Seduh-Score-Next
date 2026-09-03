import { describe, it, expect, vi } from 'vitest';
import { renderStandingsTable, mountStandingsScreen } from './standingsScreen.js';

// Same fakeClient shape as standings.test.js/scoringScreen.test.js — queues
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
    expect(rows[0].querySelector('.standings-time').textContent).toBe('120s');
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
});

describe('mountStandingsScreen', () => {
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

  it('offers "Advance to next stage" when every heat is confirmed and there is no border tie', async () => {
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
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Advance to next stage');

    button.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    // Only cutoff (2) entries advance — e1 and e2, both clean, neither tied.
    expect(insertCall[2]).toEqual([
      { stage_id: 's2', entry_id: 'e1', source: 'advanced', position_note: null },
      { stage_id: 's2', entry_id: 'e2', source: 'advanced', position_note: null },
    ]);
    document.body.removeChild(root);
  });

  it('says "Declare champion" at the terminal stage (cutoff: null)', async () => {
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
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: twoEntries, error: null },
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
    const button = root.querySelector('.btn-primary');
    expect(button.textContent).toBe('Declare champion');

    button.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Champion declared.');
    });

    const championUpdate = client.calls.find(
      ([action, table, payload]) =>
        action === 'update' && table === 'ct_stage_entries' && payload.final_position === 1,
    );
    expect(championUpdate).toBeTruthy();
    // No next-stage insert ever attempted — there is no next stage.
    expect(
      client.calls.some(([action, table]) => action === 'insert' && table === 'ct_stage_entries'),
    ).toBe(false);
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
          { data: [], error: null }, // listHeatsForStage: h1's own entries
          { data: [], error: null }, // listHeatsForStage: tb1's own entries
          { data: tiebreakHeatEntries, error: null }, // fetchTiebreakHeatOutcome's own listHeatEntries
        ],
        ct_results: { data: tiebreakResults, error: null },
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

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    expect(insertCall[2]).toEqual([
      { stage_id: 's2', entry_id: 'e1', source: 'tiebreak_won', position_note: null },
    ]);

    const eliminatedUpdate = client.calls.find(
      ([action, table, payload]) =>
        action === 'update' && table === 'ct_stage_entries' && payload.final_position === 2,
    );
    expect(eliminatedUpdate).toBeTruthy();
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
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null }, // pass 1: findStageById
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null }, // pass 1: findNextStage
          { data: stage, error: null }, // pass 2 (post-commit render): findStageById
          { data: { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null }, error: null }, // pass 2: findNextStage
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
    });

    await mountStandingsScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('The tiebreak heat also drew');
    expect(root.textContent).toContain('exactly 1 winner');

    root.querySelector('.coin-toss-list input[type="checkbox"]').click();
    const noteInput = root.querySelector('#coin-toss-note');
    noteInput.value = 'coin toss, witnessed by organiser';
    noteInput.dispatchEvent(new Event('input'));

    root.querySelector('.btn-primary').click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain('Advanced to the next stage.');
    });

    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_stage_entries',
    );
    expect(insertCall[2]).toHaveLength(1);
    expect(insertCall[2][0].source).toBe('coin_toss');
    expect(insertCall[2][0].position_note).toBe('coin toss, witnessed by organiser');

    const loserUpdate = client.calls.find(
      ([action, table, payload]) =>
        action === 'update' && table === 'ct_stage_entries' && payload.final_position === 2,
    );
    expect(loserUpdate[2].position_note).toBe('coin toss, witnessed by organiser');
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
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: nextStage, error: null },
          { data: stage, error: null },
          { data: nextStage, error: null },
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

    // e5's row (se5) must have been updated with final_position — the exact
    // thing the pre-fix code silently never did. Located via the
    // surrounding eq('id', 'se5') call rather than assuming update/eq
    // pairing order.
    const se5EqIndex = client.calls.findIndex(
      ([action, table, col, val]) =>
        action === 'eq' && table === 'ct_stage_entries' && col === 'id' && val === 'se5',
    );
    expect(se5EqIndex).toBeGreaterThan(-1);
    const se5UpdateCall = client.calls[se5EqIndex - 1];
    expect(se5UpdateCall[0]).toBe('update');
    expect(se5UpdateCall[2]).toEqual({ final_position: 4, position_note: null });

    const se4EqIndex = client.calls.findIndex(
      ([action, table, col, val]) =>
        action === 'eq' && table === 'ct_stage_entries' && col === 'id' && val === 'se4',
    );
    const se4UpdateCall = client.calls[se4EqIndex - 1];
    expect(se4UpdateCall[2]).toEqual({
      final_position: 4,
      position_note: 'coin toss, witnessed by organiser',
    });

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
