import { describe, it, expect } from 'vitest';
import {
  renderRosterList,
  renderManualAssignmentForm,
  readManualAssignmentForm,
  renderHeatsList,
  mountHeatGenerationScreen,
} from './heatsScreen.js';

// Same shape as heats.test.js's fixture.
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

describe('renderRosterList', () => {
  it('renders one list item per entry with name and cafe as text, never markup', () => {
    const entries = [{ displayName: '<b>Cupper</b> One', cafe: 'Grey Matter' }];
    const list = renderRosterList(entries);
    expect(list.tagName).toBe('UL');
    expect(list.children).toHaveLength(1);
    // textContent, not innerHTML — a display name containing markup-looking
    // characters must render as literal text, not be parsed as an element.
    expect(list.children[0].textContent).toContain('<b>Cupper</b> One');
    expect(list.children[0].querySelector('b')).toBeNull();
  });
});

describe('renderManualAssignmentForm / readManualAssignmentForm', () => {
  const entries = [
    { entry_id: 'e1', displayName: 'Cupper One' },
    { entry_id: 'e2', displayName: 'Cupper Two' },
  ];

  it('renders one row per entry with a heat-number and a station input', () => {
    const form = renderManualAssignmentForm(entries);
    const rows = form.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(form.querySelectorAll('[data-field="heatNumber"]')).toHaveLength(2);
    expect(form.querySelectorAll('[data-field="station"]')).toHaveLength(2);
  });

  it('every input carries an accessible label naming both the cupper and the field', () => {
    const form = renderManualAssignmentForm(entries);
    const heatInput = form.querySelector('[data-entry-id="e1"][data-field="heatNumber"]');
    expect(heatInput.getAttribute('aria-label')).toBe('Cupper One: heat number');
  });

  it('column headers use scope="col" for table accessibility', () => {
    const form = renderManualAssignmentForm(entries);
    const headers = form.querySelectorAll('th');
    expect(headers).toHaveLength(3);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');
  });

  it('reads filled-in inputs back into an assignment array', () => {
    const form = renderManualAssignmentForm(entries);
    form.querySelector('[data-entry-id="e1"][data-field="heatNumber"]').value = '1';
    form.querySelector('[data-entry-id="e1"][data-field="station"]').value = 'A';
    form.querySelector('[data-entry-id="e2"][data-field="heatNumber"]').value = '1';
    form.querySelector('[data-entry-id="e2"][data-field="station"]').value = 'B';
    expect(readManualAssignmentForm(form)).toEqual([
      { entryId: 'e1', heatNumber: 1, station: 'A' },
      { entryId: 'e2', heatNumber: 1, station: 'B' },
    ]);
  });

  it('trims whitespace from a typed station', () => {
    const form = renderManualAssignmentForm(entries.slice(0, 1));
    form.querySelector('[data-field="station"]').value = '  A  ';
    expect(readManualAssignmentForm(form)[0].station).toBe('A');
  });

  it('reads an empty heat-number field as 0, not NaN — left to downstream validation to reject', () => {
    const form = renderManualAssignmentForm(entries.slice(0, 1));
    form.querySelector('[data-field="station"]').value = 'A';
    // heatNumber input left blank
    expect(readManualAssignmentForm(form)[0].heatNumber).toBe(0);
  });
});

describe('renderHeatsList', () => {
  it('renders one card per heat, with a station badge and the cupper name per entry', () => {
    const heatsWithEntries = [
      {
        heat: { id: 'h1', heat_number: 1 },
        entries: [{ entry_id: 'e1', station: 'A' }],
      },
    ];
    const hydratedById = new Map([['e1', { displayName: 'Cupper One' }]]);
    const list = renderHeatsList(heatsWithEntries, hydratedById);
    expect(list.querySelector('h3').textContent).toBe('Heat 1');
    expect(list.querySelector('.station-badge').textContent).toBe('A');
    expect(list.querySelector('.heat-entries-list li').textContent).toContain('Cupper One');
  });

  it('falls back to the raw entry id when no hydrated name is found', () => {
    const heatsWithEntries = [
      { heat: { id: 'h1', heat_number: 1 }, entries: [{ entry_id: 'e9', station: 'A' }] },
    ];
    const list = renderHeatsList(heatsWithEntries, new Map());
    expect(list.querySelector('.heat-entries-list li').textContent).toContain('e9');
  });

  it('the "Generated heats" heading is a focus target (tabindex -1), for post-generation refocus', () => {
    const list = renderHeatsList([], new Map());
    const heading = list.querySelector('#heats-heading');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('renders no action link at all when eventId is omitted — the pre-router, read-only-summary usage', () => {
    const heatsWithEntries = [
      { heat: { id: 'h1', heat_number: 1, status: 'pending' }, entries: [] },
    ];
    const list = renderHeatsList(heatsWithEntries, new Map());
    expect(list.querySelector('a')).toBeNull();
    expect(list.querySelector('.heat-status-done')).toBeNull();
  });

  it('links a pending or timing heat to its Timing screen, a scoring heat to its Scoring screen, and marks a confirmed heat done with no link', () => {
    const heatsWithEntries = [
      { heat: { id: 'h1', heat_number: 1, status: 'pending' }, entries: [] },
      { heat: { id: 'h2', heat_number: 2, status: 'timing' }, entries: [] },
      { heat: { id: 'h3', heat_number: 3, status: 'scoring' }, entries: [] },
      { heat: { id: 'h4', heat_number: 4, status: 'confirmed' }, entries: [] },
    ];
    const list = renderHeatsList(heatsWithEntries, new Map(), 'ev1');
    const cards = [...list.querySelectorAll('.heat-card')];

    expect(cards[0].querySelector('a').getAttribute('href')).toBe('#/events/ev1/heats/h1/timing');
    expect(cards[0].querySelector('a').textContent).toBe('Time this heat');
    expect(cards[1].querySelector('a').getAttribute('href')).toBe('#/events/ev1/heats/h2/timing');
    expect(cards[2].querySelector('a').getAttribute('href')).toBe('#/events/ev1/heats/h3/scoring');
    expect(cards[2].querySelector('a').textContent).toBe('Score this heat');
    expect(cards[3].querySelector('a')).toBeNull();
    expect(cards[3].querySelector('.heat-status-done').textContent).toBe('Confirmed');
  });
});

const nonTestEvent = { id: 'ev1', is_test: false };
const stage = { id: 's1', event_id: 'ev1', ordinal: 1, kind: 'prelims', duration_secs: 480 };

describe('mountHeatGenerationScreen', () => {
  it('shows a seed prompt when the stage has no entries yet, with no is_test banner for a non-test event', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('No cuppers are entered into this stage yet');
    expect(root.querySelector('button').textContent).toBe('Seed roster into this stage');
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('renders the is-test banner when the event is a test event', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: true }, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toBe('Test Data — Not a Live Event');
  });

  it('clicking "seed" seeds the stage then re-renders showing the roster, refocusing the roster heading', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: [
          { data: [], error: null }, // initial render: no stage entries
          { data: [], error: null }, // seedFirstStageEntries' own idempotency check
          { data: [{ id: 'se1', stage_id: 's1', entry_id: 'e1', source: 'seed' }], error: null }, // seed insert result
          { data: [{ id: 'se1', stage_id: 's1', entry_id: 'e1', source: 'seed' }], error: null }, // re-render: listStageEntries
        ],
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    root.querySelector('button').click();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the click handler's awaits settle

    expect(root.textContent).toContain('Cupper One');
    expect(document.activeElement.id).toBe('roster-heading');
    document.body.removeChild(root);
  });

  it('shows generate actions when the stage has entries but no heats yet', async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Generate heats (random)');
    expect(root.querySelector('form.manual-assignment-form')).not.toBeNull();
  });

  it('shows the generated heats, grouped by heat, once every stage entry has been placed', async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const heats = [{ id: 'h1', stage_id: 's1', heat_number: 1 }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: heats, error: null },
        ct_heat_entries: { data: [{ heat_id: 'h1', entry_id: 'e1', station: 'A' }], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Generated heats');
    expect(root.textContent).toContain('Heat 1');
    expect(root.textContent).toContain('Cupper One');
    // Once heats exist and are complete, generation actions must not still be offered.
    expect(root.textContent).not.toContain('Generate heats (random)');
    expect(root.textContent).not.toContain('incomplete');
  });

  it('shows an "incomplete" state, not a false "done", when only some stage entries have a heat', async () => {
    // Simulates the aftermath of a partial-failure: 2 stage entries, but
    // only 1 was ever placed into a heat before generation stopped.
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const heats = [{ id: 'h1', stage_id: 's1', heat_number: 1 }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: heats, error: null },
        // Only e1 ever got a heat entry — e2 is stranded.
        ct_heat_entries: { data: [{ heat_id: 'h1', entry_id: 'e1', station: 'A' }], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Heat generation incomplete');
    expect(root.textContent).toContain('1 of 2 cupper(s)');
    // The partial result is still shown, not hidden — the organiser needs to
    // see what already exists.
    expect(root.textContent).toContain('Heat 1');
    expect(root.textContent).toContain('Cupper One');
    // Generation actions must not be offered once heats already exist —
    // regenerating isn't safe (a new random shuffle could conflict with
    // what's already saved).
    expect(root.textContent).not.toContain('Generate heats (random)');
  });

  it('detects incompleteness by which entries were placed, not just a matching total count', async () => {
    // A count-based stand-in for the completeness check (comparing
    // placed-entries-count against stage-entries-count) would pass here:
    // both are 2. Only an identity/membership check catches it — e2's
    // entry_id is duplicated across two heat-entry rows for e1, while e2
    // itself was never placed at all.
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const heats = [{ id: 'h1', stage_id: 's1', heat_number: 1 }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: heats, error: null },
        // Two rows, both for e1 — count matches stageEntries.length (2), but
        // e2 was never placed.
        ct_heat_entries: {
          data: [
            { heat_id: 'h1', entry_id: 'e1', station: 'A' },
            { heat_id: 'h1', entry_id: 'e1', station: 'B' },
          ],
          error: null,
        },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    expect(root.textContent).toContain('Heat generation incomplete');
    expect(root.textContent).toContain('1 of 2 cupper(s)');
  });

  it('keeps the is-test banner visible through the "generating" and "incomplete" states, not only the empty-roster state', async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const generatingClient = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: true }, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, {
      eventId: 'ev1',
      stageId: 's1',
      client: generatingClient,
    });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();

    const incompleteRoot = document.createElement('div');
    const twoStageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const twoRoster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const incompleteClient = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: true }, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: twoStageEntries, error: null },
        event_entries: { data: twoRoster, error: null },
        ct_heats: { data: [{ id: 'h1', stage_id: 's1', heat_number: 1 }], error: null },
        ct_heat_entries: { data: [{ heat_id: 'h1', entry_id: 'e1', station: 'A' }], error: null },
      },
    });
    await mountHeatGenerationScreen(incompleteRoot, {
      eventId: 'ev1',
      stageId: 's1',
      client: incompleteClient,
    });
    expect(incompleteRoot.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('re-renders into the incomplete state — with no random-generate button, but a working manual-resume form — immediately after a same-session generation failure that left a partial heat committed', async () => {
    // The specific risk this closes: createHeats has no batch-level
    // atomicity. If a heat row gets created but its entries fail
    // (ensureHeatEntries gives up after exhausting its bounded retry), the
    // click handler must re-render from real DB state rather than leaving
    // the "Generate heats (random)" button live — a second click on a stale
    // view would reshuffle the whole roster again, and ensureHeatEntries
    // only checks for a conflict within the SAME heat, not across heats.
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const createdHeat = { id: 'h1', stage_id: 's1', heat_number: 1, duration_secs: 480 };
    const conflict = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const stillMissing = { data: [], error: null };
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        // Same stage lookup succeeds every time it's called (mount,
        // generateHeatsRandom, and the post-failure re-render) — a single
        // non-array response repeats automatically.
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: [
          { data: [], error: null }, // mount's listHeatsForStage: no heats yet
          { data: null, error: null }, // createHeat's findHeatByNumber: none yet
          { data: createdHeat, error: null }, // createHeat's insert: the heat shell lands
          { data: [createdHeat], error: null }, // post-failure re-render's listHeatsForStage: heat1 now exists
        ],
        ct_heat_entries: [
          stillMissing, // ensureHeatEntries' initial listHeatEntries
          conflict, // attempt 1 insert
          stillMissing, // attempt 1 recompute
          conflict, // attempt 2 insert
          stillMissing, // attempt 2 recompute
          conflict, // attempt 3 insert
          stillMissing, // attempt 3 recompute — gives up, heat1 ends up with 0 entries
          stillMissing, // post-failure re-render's listHeatEntries for heat1: still empty
        ],
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    const randomButton = [...root.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Generate heats (random)',
    );
    randomButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('Heat generation incomplete');
    expect(root.textContent).toContain('0 of 2 cupper(s)');
    expect(root.textContent).not.toContain('Generate heats (random)');
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');

    // The manual-resume form IS present (2026-08-29 follow-up) — heat1's
    // shell exists but has zero entries in this fixture, so neither cupper
    // is "already placed" yet and both render as genuinely editable rows,
    // not read-only text.
    const manualForm = root.querySelector('form.manual-assignment-form');
    expect(manualForm).not.toBeNull();
    expect(manualForm.querySelectorAll('input[data-field="heatNumber"]')).toHaveLength(2);
    expect(root.textContent).not.toContain('already placed');
  });

  it('the manual-resume form only asks for the cuppers still missing a heat — an already-placed one shows as fixed text, not an editable field', async () => {
    // Same shape as the previous test, but heat1's entries DID land for one
    // cupper before generation stopped for the other — the realistic
    // partial-failure shape this fix exists for (see heats.js's own
    // createHeats: "no batch-level atomicity" applies per-heat-entry too,
    // not just per-heat).
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const createdHeat = { id: 'h1', stage_id: 's1', heat_number: 1, duration_secs: 480 };
    const placedEntry = { id: 'he1', heat_id: 'h1', entry_id: 'e1', station: 'A' };
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [createdHeat], error: null },
        ct_heat_entries: { data: [placedEntry], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    expect(root.textContent).toContain('1 of 2 cupper(s)');

    const manualForm = root.querySelector('form.manual-assignment-form');
    expect(manualForm).not.toBeNull();
    // Scoped to Cupper One's own row specifically, not a bare
    // root.textContent/manualForm.textContent substring check — found in
    // review (test-auditor): with only one already-placed cupper in this
    // fixture, a substring check can't tell "correct row, correct content"
    // apart from "content present but attached to the wrong cupper's row".
    // Scoping to the row containing "Cupper One" makes a future swap bug
    // (a second already-placed cupper added to this fixture later) still
    // catchable.
    const cupperOneRow = [...manualForm.querySelectorAll('tr')].find((row) =>
      row.textContent.includes('Cupper One'),
    );
    expect(cupperOneRow.textContent).toContain('Heat 1 · Station A (already placed)');
    // Only Cupper Two (the still-missing one) gets an editable row.
    expect(manualForm.querySelectorAll('input[data-field="heatNumber"]')).toHaveLength(1);
    expect(manualForm.querySelector('input[aria-label="Cupper Two: heat number"]')).not.toBeNull();
    expect(manualForm.querySelector('input[aria-label="Cupper One: heat number"]')).toBeNull();
  });

  it('submitting the manual-resume form completes generation without disturbing the already-placed cupper', async () => {
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const createdHeat = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      duration_secs: 480,
      timing_mode: 'app',
    };
    const placedEntry = { id: 'he1', heat_id: 'h1', entry_id: 'e1', station: 'A' };
    const bothPlaced = [placedEntry, { id: 'he2', heat_id: 'h1', entry_id: 'e2', station: 'B' }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: [
          { data: [createdHeat], error: null }, // mount's listHeatsForStage
          { data: createdHeat, error: null }, // generateHeatsManual's createHeat findHeatByNumber (heat1 already exists, config matches)
          { data: [createdHeat], error: null }, // post-submit re-render's listHeatsForStage
        ],
        ct_heat_entries: [
          { data: [placedEntry], error: null }, // mount's listHeatEntries for heat1
          { data: [placedEntry], error: null }, // ensureHeatEntries' initial listHeatEntries (Cupper One already there, Cupper Two missing)
          { data: [bothPlaced[1]], error: null }, // insert().select() result for the missing entry
          { data: bothPlaced, error: null }, // ensureHeatEntries' listHeatEntries after the successful insert
          { data: bothPlaced, error: null }, // post-submit re-render's listHeatEntries for heat1
        ],
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    const heatInput = root.querySelector('input[aria-label="Cupper Two: heat number"]');
    const stationInput = root.querySelector('input[aria-label="Cupper Two: station"]');
    heatInput.value = '1';
    stationInput.value = 'B';
    heatInput.dispatchEvent(new Event('input', { bubbles: true }));
    stationInput.dispatchEvent(new Event('input', { bubbles: true }));

    const manualForm = root.querySelector('form.manual-assignment-form');
    manualForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).not.toContain('Heat generation incomplete');
    // `.heats-list` alone is non-diagnostic — found in review (test-auditor):
    // it's rendered in BOTH the incomplete and complete branches, so its
    // mere presence proves nothing about whether the submission actually
    // succeeded. The real proof is below: reading Cupper One's assignment
    // back out of the final rendered state, plus the exact insert payload
    // that was actually sent — either would fail if the merge in
    // buildManualForm silently dropped or altered Cupper One's already-
    // placed row instead of re-attaching it unchanged.
    const cupperOneItem = [...root.querySelectorAll('.heat-entries-list li')].find((li) =>
      li.textContent.includes('Cupper One'),
    );
    expect(cupperOneItem.querySelector('.station-badge').textContent).toBe('A');
    const insertCall = client.calls.find(
      ([action, table]) => action === 'insert' && table === 'ct_heat_entries',
    );
    expect(insertCall[2]).toEqual([{ heat_id: 'h1', entry_id: 'e2', station: 'B' }]);
  });

  it('a missing cupper submitting a station that collides with an already-placed cupper fails safely, without corrupting either assignment', async () => {
    // A genuinely new path this fix opens: before, the incomplete branch had
    // no form at all, so this collision could never be attempted through
    // the UI. buildHeatPlansFromAssignments' own per-heat station-uniqueness
    // check (heats.js) is what actually rejects it — this proves that
    // check is reachable and fails safely through the new UI, not just that
    // it exists in heats.js.
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const createdHeat = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      duration_secs: 480,
      timing_mode: 'app',
    };
    const placedEntry = { id: 'he1', heat_id: 'h1', entry_id: 'e1', station: 'A' };
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [createdHeat], error: null },
        ct_heat_entries: { data: [placedEntry], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    const heatInput = root.querySelector('input[aria-label="Cupper Two: heat number"]');
    const stationInput = root.querySelector('input[aria-label="Cupper Two: station"]');
    heatInput.value = '1';
    stationInput.value = 'A'; // collides with Cupper One's real, already-placed station
    heatInput.dispatchEvent(new Event('input', { bubbles: true }));
    stationInput.dispatchEvent(new Event('input', { bubbles: true }));

    const manualForm = root.querySelector('form.manual-assignment-form');
    manualForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Rejected before ever reaching the client — buildHeatPlansFromAssignments
    // throws synchronously, so no insert was attempted at all.
    expect(client.calls.some(([action]) => action === 'insert')).toBe(false);
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toMatch(/station/i);
  });

  it("surfaces a thrown error in the feedback region using this module's own message", async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: [
          { data: stage, error: null }, // initial mount: loadState's findStageById
          { data: null, error: new Error('stage lookup failed') }, // generateHeatsRandom's own findStageById
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const randomButton = [...root.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Generate heats (random)',
    );
    randomButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.screen-feedback');
    // A plain Error with no .code is this module's own kind of throw —
    // describeError passes it through verbatim.
    expect(feedback.textContent).toBe('stage lookup failed');
    expect(feedback.dataset.tone).toBe('error');
  });

  it('surfaces a generic message, not a raw DB error, when the failure carries a Postgrest-shaped .code', async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const rawDbError = { code: '55000', message: 'lock_not_available' };
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: [
          { data: stage, error: null },
          { data: null, error: rawDbError },
        ],
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });
    const randomButton = [...root.querySelectorAll('button')].find(
      (btn) => btn.textContent === 'Generate heats (random)',
    );
    randomButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toBe('Something went wrong saving that — try again.');
    expect(feedback.dataset.tone).toBe('error');
  });

  it('surfaces a manual-assignment validation error in the feedback region when a row is left blank', async () => {
    const root = document.createElement('div');
    const stageEntries = [
      { id: 'se1', stage_id: 's1', entry_id: 'e1' },
      { id: 'se2', stage_id: 's1', entry_id: 'e2' },
    ];
    const roster = [
      { id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false },
      { id: 'e2', event_id: 'ev1', display_name: 'Cupper Two', withdrawn: false },
    ];
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    // Every stage entry always has a row in this form (readManualAssignmentForm
    // reads all of them, not just filled-in ones), so leaving Cupper Two's
    // fields blank doesn't produce a "missing" entry — it produces an
    // invalid one (heatNumber reads as 0 from an empty input), which is the
    // real shape an incomplete submission takes through this UI.
    const form = root.querySelector('form.manual-assignment-form');
    form.querySelector('[data-entry-id="e1"][data-field="heatNumber"]').value = '1';
    form.querySelector('[data-entry-id="e1"][data-field="station"]').value = 'A';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toContain('heat number must be a positive integer');
    expect(feedback.dataset.tone).toBe('error');
    // The failed submission must not silently jump to a "no heats" or
    // "generated" state — the form should still be there to fix and retry.
    expect(root.querySelector('form.manual-assignment-form')).not.toBeNull();
  });

  it('resolves to an object with a callable unmount() — regression test for a real gap found wiring the app router', async () => {
    // Every other mount*Screen in this project returns { unmount() {...} };
    // this one implicitly returned undefined until this fix. A router that
    // uniformly calls `.unmount()` after every navigation needs this to
    // hold for every screen it can mount, not just most of them.
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
        ct_heats: { data: [], error: null },
      },
    });
    const handle = await mountHeatGenerationScreen(root, {
      eventId: 'ev1',
      stageId: 's1',
      client,
    });
    expect(handle).not.toBeUndefined();
    expect(typeof handle.unmount).toBe('function');
    expect(() => handle.unmount()).not.toThrow();
  });

  it('the fully-generated heats list links each heat into its own Timing/Scoring screen', async () => {
    const root = document.createElement('div');
    const stageEntries = [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }];
    const roster = [{ id: 'e1', event_id: 'ev1', display_name: 'Cupper One', withdrawn: false }];
    const heat = {
      id: 'h1',
      stage_id: 's1',
      heat_number: 1,
      status: 'pending',
      duration_secs: 480,
      timing_mode: 'app',
    };
    const placedEntry = { id: 'he1', heat_id: 'h1', entry_id: 'e1', station: 'A' };
    const client = fakeClient({
      tables: {
        events: { data: nonTestEvent, error: null },
        ct_stages: { data: stage, error: null },
        ct_stage_entries: { data: stageEntries, error: null },
        event_entries: { data: roster, error: null },
        ct_heats: { data: [heat], error: null },
        ct_heat_entries: { data: [placedEntry], error: null },
      },
    });
    await mountHeatGenerationScreen(root, { eventId: 'ev1', stageId: 's1', client });

    const link = root.querySelector('.heats-list a');
    expect(link.getAttribute('href')).toBe('#/events/ev1/heats/h1/timing');
  });
});
