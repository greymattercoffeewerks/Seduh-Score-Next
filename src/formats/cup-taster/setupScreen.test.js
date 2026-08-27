import { describe, it, expect } from 'vitest';
import {
  renderStageRow,
  normalizeTerminalCutoff,
  buildPlanFromDraft,
  mountSetupScreen,
} from './setupScreen.js';

// Table-based in-memory fake client (rather than setup.test.js's
// call-order queue) — saveStagePlan makes a variable, reconciliation-
// dependent NUMBER of sequential calls per save, which a hand-ordered
// queue can't express cleanly for a whole-screen integration test. Mirrors
// setupScreen.preview.html's own demo client, kept in the test file rather
// than imported from it since that file is a browser-only demo harness,
// not a module.
function fakeClient(initialDb) {
  const db = {};
  // Deep-clone, not a shallow spread: several tests seed from the SAME
  // shared `prelims`/`finals` fixture objects below, and `.update()`
  // mutates rows in place via Object.assign — a shallow copy would leave
  // every fakeClient() instance's rows pointing at those same shared
  // objects, so a write in one test would silently leak into the next.
  for (const [table, rows] of Object.entries(initialDb)) {
    db[table] = rows.map((row) => ({ ...row }));
  }
  let idCounter = 0;

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeBuilder(table) {
    const filters = [];
    let orderCol = null;

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order(col) {
        orderCol = col;
        return builder;
      },
      insert(payload) {
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row) => {
          idCounter += 1;
          return { id: `${table}-${idCounter}`, ...row };
        });
        db[table] = [...(db[table] ?? []), ...inserted];
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted[0], error: null }),
            then: (resolve) => Promise.resolve({ data: inserted, error: null }).then(resolve),
          }),
        };
      },
      update(patch) {
        return {
          eq(col, val) {
            for (const row of db[table] ?? []) {
              if (row[col] === val) Object.assign(row, patch);
            }
            return Promise.resolve({ error: null });
          },
        };
      },
      delete() {
        return {
          eq(col, val) {
            db[table] = (db[table] ?? []).filter((row) => row[col] !== val);
            return Promise.resolve({ error: null });
          },
        };
      },
      single() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      maybeSingle() {
        const rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) {
        let rows = (db[table] ?? []).filter((r) => matchesFilters(r, filters));
        if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { db, from: (table) => makeBuilder(table) };
}

// A findEvent/listStagesForEvent-throwing client, for the initial-load-
// failure test — deliberately not the table-based fakeClient above, since
// this needs to simulate a genuine query-level error rather than an empty
// table.
function throwingClient() {
  return {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        single: () => Promise.resolve({ data: null, error: new Error('network unreachable') }),
        maybeSingle: () => Promise.resolve({ data: null, error: new Error('network unreachable') }),
        then: (resolve, reject) =>
          Promise.resolve({ data: null, error: new Error('network unreachable') }).then(
            resolve,
            reject,
          ),
      };
      return builder;
    },
  };
}

const testEvent = { id: 'ev1', org_id: 'org1', name: 'October Cup', is_test: true };
const nonTestEvent = { ...testEvent, is_test: false };

const prelims = {
  id: 's1',
  event_id: 'ev1',
  kind: 'prelims',
  ordinal: 1,
  set_count: 5,
  duration_secs: 480,
  cutoff: 8,
};
const finals = {
  id: 's2',
  event_id: 'ev1',
  kind: 'finals',
  ordinal: 2,
  set_count: 5,
  duration_secs: 480,
  cutoff: null,
};

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('normalizeTerminalCutoff', () => {
  it('forces only the last row to null, leaving earlier rows untouched', () => {
    const rows = [{ cutoff: 8 }, { cutoff: 4 }, { cutoff: 99 }];
    normalizeTerminalCutoff(rows);
    expect(rows.map((r) => r.cutoff)).toEqual([8, 4, null]);
  });

  it('restores an editable cutoff once a row is no longer terminal', () => {
    const rows = [{ cutoff: null }, { cutoff: 4 }];
    normalizeTerminalCutoff(rows);
    expect(rows.map((r) => r.cutoff)).toEqual([null, null]);
    // Now a third row is appended (mutating the array) — row[1] is no
    // longer the terminal one, but its cutoff was already forced null by
    // the PRIOR normalization call. This module never tries to guess a
    // value back for the organiser; re-entering it is expected screen
    // behavior, not a bug in normalizeTerminalCutoff itself.
    rows.push({ cutoff: null });
    normalizeTerminalCutoff(rows);
    expect(rows.map((r) => r.cutoff)).toEqual([null, null, null]);
  });
});

describe('buildPlanFromDraft', () => {
  it('assigns sequential ordinals from array order and forces the terminal cutoff to null', () => {
    const draft = [
      { id: 's1', kind: 'prelims', setCount: 5, durationSecs: 480, cutoff: 8 },
      { id: null, kind: 'finals', setCount: 5, durationSecs: 480, cutoff: 999 },
    ];
    const plan = buildPlanFromDraft(draft);
    expect(plan).toEqual([
      { id: 's1', kind: 'prelims', ordinal: 1, setCount: 5, durationSecs: 480, cutoff: 8 },
      { id: undefined, kind: 'finals', ordinal: 2, setCount: 5, durationSecs: 480, cutoff: null },
    ]);
  });
});

describe('renderStageRow', () => {
  it('renders a locked stage read-only, with no editable inputs or move/remove buttons', () => {
    const row = {
      key: 's1',
      id: 's1',
      kind: 'prelims',
      setCount: 5,
      durationSecs: 480,
      cutoff: 8,
      locked: true,
    };
    const el = renderStageRow(row, 0, 2, {});
    expect(el.dataset.locked).toBe('true');
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('button')).toBeNull();
    expect(el.textContent).toContain('locked, heats already generated');
  });

  it('renders an unlocked stage with a labeled kind/setCount/durationSecs/cutoff field each', () => {
    const row = {
      key: 's1',
      id: 's1',
      kind: 'prelims',
      setCount: 5,
      durationSecs: 480,
      cutoff: 8,
      locked: false,
    };
    const el = renderStageRow(row, 0, 2, { onMoveUp() {}, onMoveDown() {}, onRemove() {} });
    expect(el.querySelector('select[aria-label="Stage 1: kind"]').value).toBe('prelims');
    expect(el.querySelector('input[aria-label="Stage 1: set count"]').value).toBe('5');
    expect(el.querySelector('input[aria-label="Stage 1: duration in seconds"]').value).toBe('480');
    expect(el.querySelector('input[aria-label="Stage 1: cutoff"]').value).toBe('8');
  });

  it('disables the cutoff field on the terminal row, and Move up on the first row / Move down on the last', () => {
    const row = {
      key: 's2',
      id: 's2',
      kind: 'finals',
      setCount: 5,
      durationSecs: 480,
      cutoff: null,
      locked: false,
    };
    const el = renderStageRow(row, 1, 2, { onMoveUp() {}, onMoveDown() {}, onRemove() {} });
    expect(el.querySelector('input[aria-label="Stage 2: cutoff"]').disabled).toBe(true);
    expect(el.querySelector('[aria-label="Move Stage 2 up"]').disabled).toBe(false);
    expect(el.querySelector('[aria-label="Move Stage 2 down"]').disabled).toBe(true);
  });

  it('routes a field edit to the row object directly, synchronously — before any rebuild', () => {
    const row = {
      key: 's1',
      id: 's1',
      kind: 'prelims',
      setCount: 5,
      durationSecs: 480,
      cutoff: 8,
      locked: false,
    };
    const el = renderStageRow(row, 0, 2, { onMoveUp() {}, onMoveDown() {}, onRemove() {} });
    const setCountInput = el.querySelector('input[aria-label="Stage 1: set count"]');
    setCountInput.value = '7';
    setCountInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(row.setCount).toBe(7);
  });
});

describe('mountSetupScreen', () => {
  it('renders the is_test banner when the event is test data, and omits it otherwise', async () => {
    const testRoot = document.createElement('div');
    await mountSetupScreen(testRoot, {
      eventId: 'ev1',
      client: fakeClient({ events: [testEvent], ct_stages: [], ct_heats: [], ct_sets: [] }),
    });
    expect(testRoot.querySelector('.is-test-banner')).not.toBeNull();

    const liveRoot = document.createElement('div');
    await mountSetupScreen(liveRoot, {
      eventId: 'ev1',
      client: fakeClient({ events: [nonTestEvent], ct_stages: [], ct_heats: [], ct_sets: [] }),
    });
    expect(liveRoot.querySelector('.is-test-banner')).toBeNull();
  });

  it('renders each persisted stage locked or editable based on whether it already has a heat', async () => {
    const root = document.createElement('div');
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, finals],
        ct_heats: [{ id: 'h1', stage_id: 's1' }], // only prelims has a heat
        ct_sets: [],
      }),
    });
    const rows = root.querySelectorAll('.stage-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.locked).toBe('true');
    expect(rows[1].dataset.locked).toBeUndefined();
    expect(root.textContent).toContain('2 stages planned');
  });

  it('adds a new draft stage at the end, re-enabling the previously-terminal row and moving focus to the new row', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, finals],
        ct_heats: [],
        ct_sets: [],
      }),
    });

    const addButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add stage',
    );
    addButton.click();

    const rows = root.querySelectorAll('.stage-row');
    expect(rows).toHaveLength(3);
    // finals (now Stage 2, no longer terminal) has its cutoff re-enabled;
    // the new Stage 3 is terminal and disabled.
    expect(root.querySelector('input[aria-label="Stage 2: cutoff"]').disabled).toBe(false);
    expect(root.querySelector('input[aria-label="Stage 3: cutoff"]').disabled).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('select[aria-label="Stage 3: kind"]'));
  });

  it('removes an unlocked stage and renumbers the rest, but offers no remove control on a locked stage', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, finals],
        ct_heats: [{ id: 'h1', stage_id: 's1' }], // prelims locked
        ct_sets: [],
      }),
    });

    // The locked row (prelims) has no buttons at all — nothing to remove it with.
    const lockedRow = root.querySelector('.stage-row[data-locked="true"]');
    expect(lockedRow.querySelector('button')).toBeNull();

    const removeButton = root.querySelector('[aria-label="Remove Stage 2"]');
    removeButton.click();

    expect(root.querySelectorAll('.stage-row')).toHaveLength(1);
    expect(root.textContent).toContain('1 stage planned');
    expect(document.activeElement.id).toBe('stage-plan-heading');
  });

  it('reorders two unlocked stages via Move up, and normalizes cutoffs afterward', async () => {
    const semis = {
      id: 's2b',
      event_id: 'ev1',
      kind: 'semis',
      ordinal: 2,
      set_count: 3,
      duration_secs: 420,
      cutoff: 4,
    };
    // A distinct fixture, not the shared `finals` constant (which is
    // ordinal 2 — reusing it here would collide with semis' own ordinal 2
    // and make the fixture itself invalid, the actual bug the first draft
    // of this test tripped over).
    const finalsAt3 = {
      id: 's3',
      event_id: 'ev1',
      kind: 'finals',
      ordinal: 3,
      set_count: 5,
      duration_secs: 480,
      cutoff: null,
    };
    const root = document.createElement('div');
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, semis, finalsAt3],
        ct_heats: [],
        ct_sets: [],
      }),
    });

    // Move the terminal "finals" row up, ahead of "semis".
    const moveUp = root.querySelector('[aria-label="Move Stage 3 up"]');
    moveUp.click();

    const kinds = [...root.querySelectorAll('select[data-field="kind"]')].map((s) => s.value);
    expect(kinds).toEqual(['prelims', 'finals', 'semis']);
    // finals is no longer terminal — its cutoff must be editable again
    // (normalizeTerminalCutoff re-ran as part of the move).
    expect(root.querySelector('input[aria-label="Stage 2: cutoff"]').disabled).toBe(false);
  });

  it('saves a valid plan, disabling the Save button while in flight and showing success afterward', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [nonTestEvent],
      ct_stages: [prelims, finals],
      ct_heats: [],
      ct_sets: [],
    });
    await mountSetupScreen(root, { eventId: 'ev1', client });

    const durationInput = root.querySelector('input[aria-label="Stage 1: duration in seconds"]');
    durationInput.value = '300';
    durationInput.dispatchEvent(new Event('input', { bubbles: true }));

    const saveButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save stage plan' || b.textContent === 'Saving…',
    );
    saveButton.click();
    // Synchronously after click (before the async save resolves), the
    // button must already read as disabled — the double-click guard fires
    // before any await, matching this project's established
    // synchronous-mutation-first race discipline (see scoringScreen.js).
    const savingButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Saving…',
    );
    expect(savingButton?.disabled).toBe(true);

    await flush();

    expect(client.db.ct_stages.find((s) => s.id === 's1').duration_secs).toBe(300);
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toBe('Stage plan saved.');
    expect(feedback.dataset.tone).toBe('success');
  });

  it('surfaces the database-level lock check on save, not just the screen’s own possibly-stale locked flag', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      events: [nonTestEvent],
      ct_stages: [prelims, finals],
      ct_heats: [], // no heats at MOUNT time — prelims renders editable
      ct_sets: [],
    });
    await mountSetupScreen(root, { eventId: 'ev1', client });

    // A heat gets created out-of-band between load and save (another
    // organiser action, or this same one racing a second tab) — the
    // screen's own `locked` flag is now stale, but saveStagePlan's own
    // fresh stageHasHeats check must still catch it.
    client.db.ct_heats.push({ id: 'h1', stage_id: 's1' });

    const durationInput = root.querySelector('input[aria-label="Stage 1: duration in seconds"]');
    durationInput.value = '300';
    durationInput.dispatchEvent(new Event('input', { bubbles: true }));

    const saveButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save stage plan',
    );
    saveButton.click();
    await flush();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('already has heats generated');
    // Never silently applied — the DB itself was not actually changed.
    expect(client.db.ct_stages.find((s) => s.id === 's1').duration_secs).toBe(480);
  });

  it('renders a dedicated error screen, with no add/save actions, when the initial load itself fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, { eventId: 'ev1', client: throwingClient() });

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(root.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(feedback);
  });
});
