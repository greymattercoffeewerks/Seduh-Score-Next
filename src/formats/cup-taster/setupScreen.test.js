import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderStageRow,
  normalizeTerminalCutoff,
  buildPlanFromDraft,
  hasDuplicateKind,
  mountSetupScreen,
} from './setupScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';

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

describe('hasDuplicateKind', () => {
  it("is false when no other row shares this row's kind", () => {
    const draft = [
      { key: 's1', kind: 'prelims' },
      { key: 's2', kind: 'finals' },
    ];
    expect(hasDuplicateKind(draft, 0)).toBe(false);
    expect(hasDuplicateKind(draft, 1)).toBe(false);
  });

  it('is true for every row sharing a kind, symmetrically, and never self-matches', () => {
    const draft = [
      { key: 's1', kind: 'prelims' },
      { key: 's2', kind: 'finals' },
      { key: 's3', kind: 'prelims' },
    ];
    expect(hasDuplicateKind(draft, 0)).toBe(true);
    expect(hasDuplicateKind(draft, 1)).toBe(false);
    expect(hasDuplicateKind(draft, 2)).toBe(true);
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

  it('gives the terminal cutoff field a real, visible explanation wired via aria-describedby, not placeholder text alone', () => {
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
    const cutoffInput = el.querySelector('input[aria-label="Stage 2: cutoff"]');
    const describedBy = cutoffInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = el.querySelector(`#${describedBy}`);
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('terminal stage');
  });

  it('renders no kind hint when no other row shares this kind', () => {
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
    const kindSelect = el.querySelector('select[aria-label="Stage 1: kind"]');
    expect(kindSelect.getAttribute('aria-describedby')).toBeNull();
    expect(el.textContent).not.toContain('already exists in this plan');
  });

  it('gives the kind field a real, visible same-kind-round advisory wired via aria-describedby when duplicateKind is true', () => {
    const row = {
      key: 's1',
      id: 's1',
      kind: 'prelims',
      setCount: 5,
      durationSecs: 480,
      cutoff: 8,
      locked: false,
    };
    const el = renderStageRow(row, 0, 2, {
      onMoveUp() {},
      onMoveDown() {},
      onRemove() {},
      duplicateKind: true,
    });
    const kindSelect = el.querySelector('select[aria-label="Stage 1: kind"]');
    const describedBy = kindSelect.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = el.querySelector(`#${describedBy}`);
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('Another prelims stage already exists in this plan');
    expect(hint.textContent).toContain('separate, sequential rounds');
  });

  it('disables Move up/down when the swap target is a locked row, and Remove when an earlier stage sits before a locked one', () => {
    const rows = [
      {
        key: 's1',
        id: 's1',
        kind: 'prelims',
        setCount: 5,
        durationSecs: 480,
        cutoff: 8,
        locked: true,
      },
      {
        key: 's2',
        id: 's2',
        kind: 'semis',
        setCount: 5,
        durationSecs: 480,
        cutoff: 4,
        locked: false,
      },
      {
        key: 's3',
        id: 's3',
        kind: 'finals',
        setCount: 5,
        durationSecs: 480,
        cutoff: null,
        locked: false,
      },
    ];
    // Stage 2 (index 1): moving up would swap into the locked Stage 1's
    // slot; it also sits before no locked row itself, but IS after one —
    // removing it would leave Stage 1 exactly where it is, so Remove stays
    // safe. Moving up must not.
    const stage2 = renderStageRow(rows[1], 1, 3, {
      onMoveUp() {},
      onMoveDown() {},
      onRemove() {},
      moveUpUnsafe: true,
      removeUnsafe: false,
    });
    expect(stage2.querySelector('[aria-label="Move Stage 2 up"]').disabled).toBe(true);
    expect(stage2.querySelector('[aria-label="Remove Stage 2"]').disabled).toBe(false);
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

  it('surfaces the same-kind-round advisory on both rows once Add stage creates a second prelims row, and not on the unrelated finals row', async () => {
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
    // defaultDraftRow's own default kind is 'prelims' — the new Stage 3
    // collides with the existing Stage 1 by default, with no extra setup.
    addButton.click();

    const rows = root.querySelectorAll('.stage-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Another prelims stage already exists in this plan');
    expect(rows[1].textContent).not.toContain('already exists in this plan');
    expect(rows[2].textContent).toContain('Another prelims stage already exists in this plan');
  });

  it('updates the same-kind-round advisory immediately when a kind is changed via the select, with no Add/Remove/Move in between', async () => {
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

    // Distinct kinds to start — no advisory on either row yet.
    let rows = root.querySelectorAll('.stage-row');
    expect(rows[0].textContent).not.toContain('already exists in this plan');
    expect(rows[1].textContent).not.toContain('already exists in this plan');

    // Change Stage 2 (finals) to 'prelims' via its own select — no Add
    // stage/Remove/Move button click anywhere in this test, proving the
    // kind select's own change handler is what triggers the re-render.
    const stage2Kind = root.querySelector('select[aria-label="Stage 2: kind"]');
    stage2Kind.value = 'prelims';
    stage2Kind.dispatchEvent(new Event('change', { bubbles: true }));

    rows = root.querySelectorAll('.stage-row');
    expect(rows[0].textContent).toContain('Another prelims stage already exists in this plan');
    expect(rows[1].textContent).toContain('Another prelims stage already exists in this plan');

    // Change it back to 'finals' — the now-stale advisory on BOTH rows must
    // clear, not merely fail to update further (the bug this closes: a
    // stale hint keeps asserting a duplicate that no longer exists).
    stage2Kind.value = 'finals';
    stage2Kind.dispatchEvent(new Event('change', { bubbles: true }));

    rows = root.querySelectorAll('.stage-row');
    expect(rows[0].textContent).not.toContain('already exists in this plan');
    expect(rows[1].textContent).not.toContain('already exists in this plan');
  });

  it('never surfaces the advisory on a locked row, even when it would otherwise qualify as a duplicate kind', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, finals],
        ct_heats: [{ id: 'h1', stage_id: 's1' }], // locks prelims (Stage 1)
        ct_sets: [],
      }),
    });

    const addButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Add stage',
    );
    // defaultDraftRow's own default kind is 'prelims' — Stage 3 collides
    // with the now-LOCKED Stage 1, not an unlocked one.
    addButton.click();

    const rows = root.querySelectorAll('.stage-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].dataset.locked).toBe('true');
    expect(rows[0].textContent).toContain('locked, heats already generated');
    // The locked row's own read-only summary never gets the advisory or an
    // aria-describedby, regardless of duplicateKind — renderStageRow's
    // locked branch returns before the hint logic ever runs.
    expect(rows[0].textContent).not.toContain('already exists in this plan');
    expect(rows[0].querySelector('[aria-describedby]')).toBeNull();
    // The unlocked duplicate (Stage 3) still gets the advisory normally.
    expect(rows[2].textContent).toContain('Another prelims stage already exists in this plan');
  });

  it('removes an unlocked stage and renumbers the rest, but offers no remove control on a locked stage', async () => {
    const semis = {
      id: 's2b',
      event_id: 'ev1',
      kind: 'semis',
      ordinal: 2,
      set_count: 5,
      duration_secs: 480,
      cutoff: 4,
    };
    const finalsAt3 = { ...finals, id: 's3', ordinal: 3 };
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, semis, finalsAt3],
        ct_heats: [{ id: 'h1', stage_id: 's1' }], // prelims locked
        ct_sets: [],
      }),
    });

    // The locked row (prelims) has no buttons at all — nothing to remove it with.
    const lockedRow = root.querySelector('.stage-row[data-locked="true"]');
    expect(lockedRow.querySelector('button')).toBeNull();

    // Remove the middle (non-terminal, unlocked) stage — the real proof of
    // "renumbers the rest": with only 2 stages, removing one always leaves
    // the other at "Stage 1" regardless of whether renumbering actually
    // happened. With 3, the former "Stage 3" must become "Stage 2".
    const removeButton = root.querySelector('[aria-label="Remove Stage 2"]');
    removeButton.click();

    expect(root.querySelectorAll('.stage-row')).toHaveLength(2);
    expect(root.textContent).toContain('2 stages planned');
    expect(root.querySelector('[aria-label="Remove Stage 3"]')).toBeNull();
    expect(root.querySelector('[aria-label="Remove Stage 2"]')).not.toBeNull();
    expect(root.querySelector('select[aria-label="Stage 2: kind"]').value).toBe('finals');
    expect(document.activeElement.id).toBe('stage-plan-heading');
  });

  it('disables Remove on an unlocked stage sitting before a locked one, since removing it would renumber the locked stage', async () => {
    const semis = {
      id: 's2b',
      event_id: 'ev1',
      kind: 'semis',
      ordinal: 2,
      set_count: 5,
      duration_secs: 480,
      cutoff: 4,
    };
    const finalsAt3 = { ...finals, id: 's3', ordinal: 3 };
    const root = document.createElement('div');
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, semis, finalsAt3],
        ct_heats: [{ id: 'h1', stage_id: 's3' }], // finals (the LAST stage) is locked
        ct_sets: [],
      }),
    });

    // Stage 1 and Stage 2 both sit before the locked Stage 3 — removing
    // either would shift Stage 3's ordinal, which saveStagePlan always
    // refuses. Both Remove controls must be disabled up front.
    expect(root.querySelector('[aria-label="Remove Stage 1"]').disabled).toBe(true);
    expect(root.querySelector('[aria-label="Remove Stage 2"]').disabled).toBe(true);
  });

  it('disables Move up/down on an unlocked stage when the swap target is a locked neighbor', async () => {
    const root = document.createElement('div');
    await mountSetupScreen(root, {
      eventId: 'ev1',
      client: fakeClient({
        events: [nonTestEvent],
        ct_stages: [prelims, finals],
        ct_heats: [{ id: 'h1', stage_id: 's1' }], // prelims locked
        ct_sets: [],
      }),
    });

    // Stage 2 (finals, unlocked) sits directly after the locked Stage 1 —
    // Move up would swap into that locked slot.
    const moveUp = root.querySelector('[aria-label="Move Stage 2 up"]');
    expect(moveUp.disabled).toBe(true);

    // Clicking it anyway (e.g. a stale reference) must still be a no-op —
    // the runtime guard in moveStage() stays as defense in depth even
    // though the button is now disabled up front.
    moveUp.click();
    const kinds = [...root.querySelectorAll('select[data-field="kind"]')].map((s) => s.value);
    expect(kinds).toEqual(['finals']); // only the unlocked row has a select; order unchanged
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
    document.body.appendChild(root); // .focus() is a no-op on a detached element
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
    // Focus lands back on the moved row's own container, not <body> — a
    // plain, non-focusable <div> would silently drop it there (found in
    // review; the row now carries tabindex="-1" as a valid target).
    expect(document.activeElement).toBe(root.querySelector('#stage-row-s3'));
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

  it('shows a defined loading state while the initial load is still in flight, not a blank screen', async () => {
    // A real, awaited delay on the underlying query rather than a
    // synchronously-resolved fake — the whole point is to observe the
    // screen DURING loadPersisted(), not just before/after it.
    let resolveEvents;
    const eventsGate = new Promise((resolve) => {
      resolveEvents = resolve;
    });
    const slowClient = fakeClient({
      events: [nonTestEvent],
      ct_stages: [],
      ct_heats: [],
      ct_sets: [],
    });
    const realFrom = slowClient.from.bind(slowClient);
    slowClient.from = (table) => {
      const builder = realFrom(table);
      if (table !== 'events') return builder;
      const originalSingle = builder.single.bind(builder);
      return { ...builder, single: () => eventsGate.then(originalSingle) };
    };

    const root = document.createElement('div');
    const mountPromise = mountSetupScreen(root, { eventId: 'ev1', client: slowClient });

    // mountSetupScreen has started but findEvent's own query is gated —
    // the loading state must already be showing.
    expect(root.textContent).toContain('Loading stage plan');
    expect(root.querySelector('button')).toBeNull();

    resolveEvents();
    await mountPromise;

    expect(root.textContent).not.toContain('Loading stage plan');
    expect(root.querySelector('h1').textContent).toBe('Stage plan');
  });

  it('renders a dedicated error screen, with no add/save actions but a working Retry, when the initial load itself fails', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root); // .focus() is a no-op on a detached element
    await mountSetupScreen(root, { eventId: 'ev1', client: throwingClient() });

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    // No stage-plan actions (add/save) leaked into the error screen — the
    // ONLY button present is the Retry affordance itself.
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Retry');
    expect(document.activeElement).toBe(feedback);
  });

  it('Retry re-attempts the load and shows real content once it succeeds, closing the "no retry affordance" gap', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // Deterministic, not call-count-based (loadPersisted's own findEvent
    // and listStagesForEvent dispatch two concurrent `.from()` calls per
    // attempt, so counting calls to decide pass/fail would be racy) — the
    // test itself flips this the moment Retry is clicked, matching exactly
    // "the connection came back" rather than an arbitrary call number.
    let shouldFail = true;
    // Seeded with one real stage specifically so this test can prove the
    // reload actually happened — found in review (test-auditor): asserting
    // only "h1 says Stage plan, no error tone" would still pass against a
    // broken Retry that just cleared the error state without reloading,
    // since both screens render that same shell on zero-stage state too.
    const succeeding = fakeClient({
      events: [testEvent],
      ct_stages: [prelims],
      ct_heats: [],
      ct_sets: [],
    });
    const client = {
      from(table) {
        return shouldFail ? throwingClient().from(table) : succeeding.from(table);
      },
    };
    await mountSetupScreen(root, { eventId: 'ev1', client });

    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');

    shouldFail = false;
    root.querySelector('button').click();
    await flush();

    expect(root.querySelector('h1').textContent).toBe('Stage plan');
    expect(root.querySelector('.screen-feedback[data-tone="error"]')).toBeNull();
    expect(root.textContent).toContain('1 stage planned');
    // Found in review (ui-accessibility-reviewer): a successful Retry used
    // to silently drop focus to <body> — renderLoading() destroys the
    // focused Retry button, and nothing took its place until this fix.
    expect(document.activeElement.id).toBe('stage-plan-heading');
  });

  describe('a genuinely hung load (neither resolves nor rejects)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out rather than leaving the screen on "Loading…" forever, and shows a distinct message with a working Retry', async () => {
      // The exact failure mode this task closes: no error, no success —
      // just a request that never settles, the real shape of a captive
      // portal or a dropped connection mid-request on this project's own
      // "unreliable venue wifi" design target.
      function hungBuilder() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          single: () => new Promise(() => {}),
          maybeSingle: () => new Promise(() => {}),
          then: () => new Promise(() => {}), // never settles — the exact failure mode under test
        };
        return builder;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mountPromise = mountSetupScreen(root, { eventId: 'ev1', client: hungClient });

      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Loading stage plan');

      // Pins the actual shared constant, not just "a timeout eventually
      // fires" — found in review (test-auditor): without this check, a
      // regression hardcoding some other, shorter ms value directly in
      // attemptLoad() (forking away from DEFAULT_LOAD_TIMEOUT_MS) would
      // still pass, since the shorter timeout would already have fired by
      // the time the full constant's worth of time has elapsed.
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
      expect(root.textContent).toContain('Loading stage plan');

      await vi.advanceTimersByTimeAsync(1);
      await mountPromise;

      const feedback = root.querySelector('.screen-feedback');
      expect(feedback.dataset.tone).toBe('error');
      // Distinct from a real failure's message (describeError's generic
      // text) — an organiser staring at this should understand it's a
      // connectivity problem, not a rejected request.
      expect(feedback.textContent).toMatch(/taking longer than expected/i);
      const retryButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Retry',
      );
      expect(retryButton).toBeTruthy();
    });
  });
});
