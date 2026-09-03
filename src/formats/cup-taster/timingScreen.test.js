import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderRosterPreview, renderTimingRows, mountTimingScreen } from './timingScreen.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

// This suite fakes ONLY `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`
// below), never the full timer set — found while wiring outbox writes
// through this screen's tests: fake-indexeddb schedules its own callback
// via a REAL setImmediate obtained from an unsandboxed realm (see
// node_modules/fake-indexeddb/build/cjs/lib/scheduling.js's jsdom-detection
// branch, which deliberately escapes jsdom's sandboxing — the same root
// cause scoringScreen.test.js's own equivalent comment documents). Faking
// the full timer set (the original attempt here) doesn't just slow that
// callback down, it leaves the underlying IndexedDB transaction OPEN
// forever, which then hangs every LATER test's own indexedDB access too
// (observed directly: subsequent tests' beforeEach hooks timed out).
// Leaving setInterval/setTimeout/setImmediate genuinely real sidesteps the
// whole problem — a plain `await settle()` below is an ordinary, unfaked
// wait, and the countdown's own real `setInterval` fires on its own real
// 1-second cadence; `vi.setSystemTime()` (Date is still faked) is what
// makes that next real tick DISPLAY however many simulated seconds a test
// wants, without needing to wait that many real seconds for it.
function settle(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesFilters(row, filters) {
  return filters.every(([type, col, val]) => {
    if (type === 'eq') return row[col] === val;
    if (type === 'is') return row[col] === val;
    if (type === 'in') return val.includes(row[col]);
    return true;
  });
}

function makeTableBuilder(rows) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters.push(['eq', col, val]);
      return builder;
    },
    is: (col, val) => {
      filters.push(['is', col, val]);
      return builder;
    },
    in: (col, vals) => {
      filters.push(['in', col, vals]);
      return builder;
    },
    // A shallow COPY, not the live db row reference — a real Supabase read
    // returns freshly-deserialized JSON, not a live handle into server
    // memory. Found the hard way: without this, a test simulating "the
    // screen's already-rendered state is stale, the server has since moved
    // on" (mutating `client.db` directly, not through this screen) instead
    // mutated the SAME object the screen was already holding, since
    // `.then()`'s own list path already copies but this didn't — silently
    // defeating the very race the test existed to prove.
    single: () => {
      const matched = rows.filter((row) => matchesFilters(row, filters));
      return Promise.resolve({ data: matched[0] ? { ...matched[0] } : null, error: null });
    },
    maybeSingle: () => {
      const matched = rows.filter((row) => matchesFilters(row, filters));
      return Promise.resolve({ data: matched[0] ? { ...matched[0] } : null, error: null });
    },
    then: (onResolve, onReject) => {
      const matched = rows.filter((row) => matchesFilters(row, filters));
      return Promise.resolve({ data: matched.map((row) => ({ ...row })), error: null }).then(
        onResolve,
        onReject,
      );
    },
  };
  return builder;
}

// Mutates the shared `db` in place, mirroring start_heat/record_heat_time/
// auto_max_heat's own real server-side behavior (migration 20260828150000)
// closely enough to exercise the whole outbox-wired round trip end to end:
// an enqueue, a flush, and this screen's own NEXT render() (a plain read)
// actually observing the mutation.
function makeRpc(db, calls) {
  return (name, payload) => {
    calls.push([name, payload]);
    if (name === 'start_heat') {
      const heat = db.ct_heats.find((h) => h.id === payload.p_heat_id);
      if (heat?.status === 'pending') {
        heat.status = 'timing';
        heat.started_at = payload.p_started_at;
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (name === 'record_heat_time') {
      const entry = db.ct_heat_entries.find((e) => e.id === payload.p_heat_entry_id);
      if (!entry) {
        return Promise.resolve({
          data: null,
          error: { code: 'P0002', message: 'record_heat_time: heat entry not found' },
        });
      }
      const heat = db.ct_heats.find((h) => h.id === entry.heat_id);
      if (heat.status !== payload.p_expected_heat_status) {
        return Promise.resolve({
          data: null,
          error: { code: 'P0002', message: `CONFLICT: heat is ${heat.status} now` },
        });
      }
      if (payload.p_conflict_policy === 'reject' && entry.elapsed_secs != null) {
        return Promise.resolve({
          data: null,
          error: { code: 'P0002', message: 'CONFLICT: heat entry already has a recorded time' },
        });
      }
      entry.elapsed_secs = payload.p_elapsed_secs;
      entry.elapsed_secs_raw = payload.p_elapsed_secs_raw;
      entry.maxed = payload.p_maxed;
      entry.time_source = payload.p_time_source;
      entry.time_edited_at = payload.p_time_edited_at;
      const heatEntries = db.ct_heat_entries.filter((e) => e.heat_id === heat.id);
      if (heatEntries.every((e) => e.elapsed_secs != null)) heat.status = 'scoring';
      return Promise.resolve({ data: null, error: null });
    }
    if (name === 'auto_max_heat') {
      const heat = db.ct_heats.find((h) => h.id === payload.p_heat_id);
      if (heat?.status === 'timing') {
        for (const entry of db.ct_heat_entries.filter((e) => e.heat_id === heat.id)) {
          if (entry.elapsed_secs == null) {
            entry.elapsed_secs = heat.duration_secs;
            entry.elapsed_secs_raw = heat.duration_secs;
            entry.maxed = true;
            entry.time_source = 'maxed';
            entry.time_edited_at = payload.p_time_edited_at;
          }
        }
        heat.status = 'scoring';
      }
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
}

function buildFakeClient({ event, heat, entries, roster }) {
  // Shallow-cloned, not the caller's own object references — found the hard
  // way: several tests share module-level fixtures like `appHeatPending`,
  // and makeRpc()'s handlers mutate `heat`/entries in place (mirroring the
  // real RPCs' own server-side writes). Without cloning here, one test's
  // start_heat call would permanently flip the SHARED fixture object to
  // 'timing', silently corrupting every later test that reused the same
  // fixture — a real bug this exact bite proved, not a hypothetical one.
  const db = {
    events: [{ ...event }],
    ct_heats: [{ ...heat }],
    ct_heat_entries: entries.map((entry) => ({ ...entry })),
    event_entries: roster.map((person) => ({ ...person })),
  };
  const calls = [];
  return {
    db,
    calls,
    from(table) {
      return makeTableBuilder(db[table] ?? []);
    },
    rpc: makeRpc(db, calls),
  };
}

describe('renderRosterPreview', () => {
  it('renders one item per entry, name as text', () => {
    const list = renderRosterPreview([
      { displayName: 'Cupper One' },
      { displayName: 'Cupper Two' },
    ]);
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toContain('Cupper One');
  });
});

describe('renderTimingRows', () => {
  it('shows a Stop button for an entry with no elapsed_secs yet', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      {
        onStop: () => {},
      },
    );
    const button = rows.querySelector('button');
    expect(button.textContent).toBe('Stop');
    expect(button.getAttribute('aria-label')).toBe("Stop Cupper One's clock");
  });

  it('shows the formatted time for an entry that already has one, no button', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: 125, maxed: false }],
      { onStop: () => {} },
    );
    expect(rows.querySelector('button')).toBeNull();
    expect(rows.textContent).toContain('2:05');
    expect(rows.querySelector('.timing-row-result').dataset.maxed).toBe('false');
  });

  it('labels a maxed entry distinctly from a real tapped time', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: 480, maxed: true }],
      { onStop: () => {} },
    );
    expect(rows.textContent).toContain('Max time');
    expect(rows.querySelector('.timing-row-result').dataset.maxed).toBe('true');
  });

  it('shows a station badge when the entry has one', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', station: 'A', elapsed_secs: null }],
      { onStop: () => {} },
    );
    expect(rows.querySelector('.station-badge').textContent).toBe('A');
  });

  it('calls onStop with the entry id when its button is clicked', () => {
    const onStop = vi.fn();
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      {
        onStop,
      },
    );
    rows.querySelector('button').click();
    expect(onStop).toHaveBeenCalledWith('e1');
  });

  it('offers a manual-entry fallback alongside Stop for an unstopped entry, hidden by default', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onStop: () => {}, onSaveManual: () => {} },
    );
    const toggle = rows.querySelector('.btn-manual-toggle');
    expect(toggle.textContent).toBe('Enter time manually');
    expect(toggle.getAttribute('aria-label')).toBe("Enter Cupper One's time manually");
    expect(rows.querySelector('.manual-time-fields').hidden).toBe(true);
  });

  it('clicking "Enter time manually" swaps Stop/toggle for the manual input fields, purely locally — no onStop/onSaveManual call', () => {
    const onStop = vi.fn();
    const onSaveManual = vi.fn();
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onStop, onSaveManual },
    );
    const stopButton = rows.querySelector('.btn-stop');
    const toggle = rows.querySelector('.btn-manual-toggle');
    const fields = rows.querySelector('.manual-time-fields');

    toggle.click();

    expect(stopButton.hidden).toBe(true);
    expect(toggle.hidden).toBe(true);
    expect(fields.hidden).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
    expect(onSaveManual).not.toHaveBeenCalled();
  });

  it('Cancel reverts back to Stop/toggle without calling onSaveManual', () => {
    const onSaveManual = vi.fn();
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onStop: () => {}, onSaveManual },
    );
    const stopButton = rows.querySelector('.btn-stop');
    const toggle = rows.querySelector('.btn-manual-toggle');
    const fields = rows.querySelector('.manual-time-fields');
    toggle.click();

    const cancelButton = [...fields.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    cancelButton.click();

    expect(fields.hidden).toBe(true);
    expect(stopButton.hidden).toBe(false);
    expect(toggle.hidden).toBe(false);
    expect(onSaveManual).not.toHaveBeenCalled();
  });

  it('Save inside the manual fields validates locally and calls onSaveManual with the entry id and the already-parsed total seconds', () => {
    const onSaveManual = vi.fn();
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onStop: () => {}, onSaveManual },
    );
    const toggle = rows.querySelector('.btn-manual-toggle');
    toggle.click();

    const fields = rows.querySelector('.manual-time-fields');
    const [minutesInput, secondsInput] = fields.querySelectorAll('input');
    minutesInput.value = '2';
    secondsInput.value = '30';
    const saveButton = [...fields.querySelectorAll('button')].find((b) => b.textContent === 'Save');
    saveButton.click();

    // Parsed here, in renderTimingRows' own onSave wrapper, not passed
    // through to the caller as raw strings — onSaveManual (the caller's
    // own handler) only ever sees an already-valid integer, so it never
    // needs its own parseElapsedInput try/catch.
    expect(onSaveManual).toHaveBeenCalledWith('e1', 150);
  });

  it('an invalid manual time never calls onSaveManual at all, and shows a local error instead — no render(), no network call reachable', () => {
    const onSaveManual = vi.fn();
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onStop: () => {}, onSaveManual },
    );
    const toggle = rows.querySelector('.btn-manual-toggle');
    toggle.click();

    const fields = rows.querySelector('.manual-time-fields');
    const [minutesInput, secondsInput] = fields.querySelectorAll('input');
    minutesInput.value = '2';
    secondsInput.value = ''; // untouched — the Number('') === 0 trap
    const saveButton = [...fields.querySelectorAll('button')].find((b) => b.textContent === 'Save');
    saveButton.click();

    expect(onSaveManual).not.toHaveBeenCalled();
    expect(rows.querySelector('.manual-time-local-error').textContent).toContain(
      'Seconds must be a whole number',
    );
    // The toggle stays open — nothing was rebuilt, so the correctly-typed
    // minutes value the organiser already entered is still sitting there,
    // not silently discarded.
    expect(fields.hidden).toBe(false);
    expect(minutesInput.value).toBe('2');
  });

  it('does NOT offer the manual-entry fallback for an entry that already has a recorded time', () => {
    const rows = renderTimingRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: 125, maxed: false }],
      { onStop: () => {}, onSaveManual: () => {} },
    );
    expect(rows.querySelector('.btn-manual-toggle')).toBeNull();
    expect(rows.querySelector('.manual-time-fields')).toBeNull();
  });
});

const appHeatPending = {
  id: 'h1',
  heat_number: 1,
  timing_mode: 'app',
  status: 'pending',
  duration_secs: 480,
  started_at: null,
};

describe('mountTimingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the roster and a start button for a pending heat', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: appHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(root.querySelector('button').textContent).toBe('Start heat');
  });

  it('rejects mounting against a manual-timing-mode heat with an explanatory message, no start button', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: { ...appHeatPending, timing_mode: 'manual' },
      entries: [],
      roster: [],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('manual');
    expect(root.querySelector('button')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: true },
      heat: appHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Test Data');
  });

  it('does not render the is-test banner for a real event', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: appHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('starting the heat shows a live countdown that ticks down', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: appHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('button').click();
    await settle(); // let the click handler's awaits (enqueue + flush + re-render) settle

    // Focus moved to the new, stable heading — a separate element from the
    // ticking display itself (the ticking div is never the focus target, so
    // per-second textContent mutation can never steal focus mid-tick).
    expect(document.activeElement.id).toBe('countdown-heading');

    const countdown = root.querySelector('.countdown-display');
    expect(countdown.textContent).toBe('8:00');

    // The countdown's own setInterval is a genuinely real one (only `Date`
    // is faked in this suite — see the module comment above) — jumping the
    // fake clock forward, then waiting for ONE real tick to actually fire,
    // gets the same "3 simulated seconds passed" result the display reads
    // without needing to wait 3 real seconds for it.
    vi.setSystemTime(new Date('2026-08-22T10:00:03.000Z'));
    await settle(1100);
    expect(countdown.textContent).toBe('7:57');

    // Since this interval is genuinely real (see the module comment above),
    // an un-unmounted heat left mid-'timing' would keep ticking in the real
    // background across every LATER test in this file — including calling
    // handleExpiry()'s own outbox write against a shared, real IndexedDB
    // queue once enough real time (or a later test's own vi.setSystemTime()
    // jump, since Date is a shared global) makes it look expired. unmount()
    // here is load-bearing, not just tidy cleanup.
    unmount();
    document.body.removeChild(root);
  });

  it('announces once, via the live region, when the countdown first crosses the urgent threshold', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: appHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    root.querySelector('button').click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toBe('');

    // 471s in: 9s remaining, just inside the urgent window. Jump the (only
    // faked) clock, then wait for one real tick to actually observe it —
    // same technique as the "ticks down" test above.
    vi.setSystemTime(new Date('2026-08-22T10:07:51.000Z'));
    await settle(1100);
    expect(feedback.dataset.tone).toBe('urgent');
    expect(feedback.textContent).toContain('10 seconds');

    // Clear it manually to prove the NEXT tick doesn't re-announce (a real
    // render would replace this node; simulating the one-time behavior
    // directly on the live tick loop here).
    feedback.textContent = '';
    delete feedback.dataset.tone;
    vi.setSystemTime(new Date('2026-08-22T10:07:52.000Z'));
    await settle(1100);
    expect(feedback.textContent).toBe('');

    // Load-bearing, not just tidy cleanup — see the "ticks down" test's own
    // comment on this same real-interval-leak risk above.
    unmount();
    document.body.removeChild(root);
  });

  it('stopping a cupper records their tap and shows their time instead of a button', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    // 2 minutes into the heat when the tap happens
    vi.setSystemTime(new Date('2026-08-22T10:02:00.000Z'));

    root.querySelector('.btn-stop').click();
    await settle();

    expect(root.querySelector('.btn-stop')).toBeNull();
    // .toContain on root.textContent alone is a substring match against
    // "Max time (2:00)" too — found in review (test-auditor, via
    // mutation-testing a forced-maxed bug that this weaker assertion let
    // through undetected). Pinning the exact result span's own text and
    // its data-maxed flag proves this landed as a genuine tapped time, not
    // a mislabeled max.
    const resultNode = root.querySelector('.timing-row-result');
    expect(resultNode.textContent).toBe('2:00');
    expect(resultNode.dataset.maxed).toBe('false');

    const [rpcName, rpcPayload] = client.calls.find(([name]) => name === 'record_heat_time');
    expect(rpcName).toBe('record_heat_time');
    expect(rpcPayload.p_elapsed_secs).toBe(120);
    expect(rpcPayload.p_conflict_policy).toBe('reject');

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    // This heat has only one entry, so this one tap also completes it —
    // focus goes to the "Timing complete" heading, not the feedback
    // region, so a keyboard/screen-reader user lands somewhere that Tabs
    // forward into the new "Score this heat" link rather than past it
    // (found in ui-accessibility-reviewer's own pass on that link).
    expect(document.activeElement.id).toBe('timing-complete-heading');

    document.body.removeChild(root);
  });

  it('entering a time manually records it via record_heat_time with an "overwrite" conflict policy and time_source "manual", same success messaging as a tap', async () => {
    // The mid-heat device-failure fallback (handoff §7.1) — closes
    // ROADMAP.md's own "T4.3's app-mode timing screen has no manual-entry
    // fallback" entry.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.btn-manual-toggle').click();
    const [minutesInput, secondsInput] = root
      .querySelector('.manual-time-fields')
      .querySelectorAll('input');
    minutesInput.value = '2';
    secondsInput.value = '30';
    [...root.querySelectorAll('.manual-time-fields button')]
      .find((b) => b.textContent === 'Save')
      .click();
    await settle();

    expect(root.querySelector('.btn-stop')).toBeNull();
    expect(root.querySelector('.manual-time-fields')).toBeNull();
    // Same tighter assertion as the tap test above, same reason (a bare
    // substring match on root.textContent can't distinguish a real
    // 2:30 from a mislabeled "Max time (2:30)").
    const resultNode = root.querySelector('.timing-row-result');
    expect(resultNode.textContent).toBe('2:30');
    expect(resultNode.dataset.maxed).toBe('false');

    const [rpcName, rpcPayload] = client.calls.find(([name]) => name === 'record_heat_time');
    expect(rpcName).toBe('record_heat_time');
    expect(rpcPayload.p_elapsed_secs).toBe(150);
    expect(rpcPayload.p_time_source).toBe('manual');
    expect(rpcPayload.p_conflict_policy).toBe('overwrite');

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain("Cupper One's time recorded");

    document.body.removeChild(root);
  });

  it('a manually-entered time at or beyond duration_secs is clamped and displayed as Max time, not the entered figure — handoff §7.1', async () => {
    // Found missing in review (scoring-auditor): the maxed/"Max time"
    // display was already correct BY CONSTRUCTION (renderTimingRows'
    // maxed branch reads entry.maxed regardless of time_source, and
    // buildClampedUpdate/clampElapsed are the same unmodified single
    // writer for both paths) — but nothing exercised a manually-entered
    // value specifically through this exact assertion before.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending, // duration_secs: 480
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.btn-manual-toggle').click();
    const [minutesInput, secondsInput] = root
      .querySelector('.manual-time-fields')
      .querySelectorAll('input');
    minutesInput.value = '8';
    secondsInput.value = '30'; // 510s — past the 480s duration
    [...root.querySelectorAll('.manual-time-fields button')]
      .find((b) => b.textContent === 'Save')
      .click();
    await settle();

    const resultNode = root.querySelector('.timing-row-result');
    expect(resultNode.dataset.maxed).toBe('true');
    expect(resultNode.textContent).toBe('Max time (8:00)');

    const [, rpcPayload] = client.calls.find(([name]) => name === 'record_heat_time');
    expect(rpcPayload.p_elapsed_secs).toBe(480); // clamped to duration_secs
    expect(rpcPayload.p_elapsed_secs_raw).toBe(510); // the real entered figure preserved
    expect(rpcPayload.p_maxed).toBe(true);

    document.body.removeChild(root);
  });

  it('a heat can mix a tapped entry and a manually-entered entry — the exact scenario the spec names', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [
        { id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null },
        { id: 'he2', heat_id: 'h1', entry_id: 'e2', elapsed_secs: null },
      ],
      roster: [
        { id: 'e1', display_name: 'Cupper One' },
        { id: 'e2', display_name: 'Cupper Two' },
      ],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    vi.setSystemTime(new Date('2026-08-22T10:01:00.000Z'));

    // Cupper One's clock is tapped normally.
    const rows = () => [...root.querySelectorAll('.timing-row')];
    const rowFor = (name) => rows().find((row) => row.textContent.includes(name));
    rowFor('Cupper One').querySelector('.btn-stop').click();
    await settle();

    // Cupper Two's device failed — hand-entered instead, while Cupper
    // One's own row is already showing its real tapped result.
    rowFor('Cupper Two').querySelector('.btn-manual-toggle').click();
    const [minutesInput, secondsInput] =
      rowFor('Cupper Two').querySelectorAll('.manual-time-input');
    minutesInput.value = '3';
    secondsInput.value = '15';
    [...rowFor('Cupper Two').querySelectorAll('button')]
      .find((b) => b.textContent === 'Save')
      .click();
    await settle();

    const oneEntry = client.db.ct_heat_entries.find((e) => e.entry_id === 'e1');
    const twoEntry = client.db.ct_heat_entries.find((e) => e.entry_id === 'e2');
    expect(oneEntry.time_source).toBe('tapped');
    expect(oneEntry.elapsed_secs).toBe(60);
    expect(twoEntry.time_source).toBe('manual');
    expect(twoEntry.elapsed_secs).toBe(195);
    // Both entries now recorded — the heat (single-heat-worth of entries)
    // advances past 'timing', same as an all-tapped completion would.
    expect(client.db.ct_heats[0].status).toBe('scoring');

    // Found in review (test-auditor): the backing-store assertions above
    // alone can't catch a purely-rendering regression (wrong row, wrong
    // label, a stale manual-fields panel left open) — since the heat
    // completed, this is now the read-only "Timing complete" view, so both
    // rows render via renderTimingRows' OTHER branch entirely.
    expect(rowFor('Cupper One').querySelector('.timing-row-result').textContent).toBe('1:00');
    expect(rowFor('Cupper Two').querySelector('.timing-row-result').textContent).toBe('3:15');
    expect(root.querySelector('.manual-time-fields')).toBeNull();
    expect(root.querySelector('.btn-stop')).toBeNull();

    document.body.removeChild(root);
  });

  it('an invalid manual time (e.g. an empty field) shows a local error and never reaches record_heat_time, end to end through the real mounted screen', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.btn-manual-toggle').click();
    const [minutesInput, secondsInput] = root
      .querySelector('.manual-time-fields')
      .querySelectorAll('input');
    minutesInput.value = '2';
    secondsInput.value = ''; // untouched — the Number('') === 0 trap
    [...root.querySelectorAll('.manual-time-fields button')]
      .find((b) => b.textContent === 'Save')
      .click();
    await settle();

    expect(client.calls.some(([name]) => name === 'record_heat_time')).toBe(false);
    // No render() happened at all — the GLOBAL feedback region stays
    // untouched; the error lives locally, inside this row's own fields.
    expect(root.querySelector('.screen-feedback').dataset.tone).toBeUndefined();
    expect(root.querySelector('.manual-time-local-error').textContent).toContain(
      'Seconds must be a whole number',
    );
    // The toggle stays open (no full rebuild to revert it), and the
    // correctly-typed minutes value the organiser already entered is
    // still there, not silently discarded.
    expect(root.querySelector('.manual-time-fields').hidden).toBe(false);
    expect(minutesInput.value).toBe('2');
    expect(root.querySelector('.btn-stop').hidden).toBe(true);

    document.body.removeChild(root);
  });

  it('a manual entry that lands after the heat has already advanced surfaces the real conflict, not a false "recorded" — mirrors the tap-path test below', async () => {
    // Same race as the tap-path test immediately below, through the OTHER
    // write path — new to this feature (two write paths can now race
    // against the same single-heat completion, which neither T4.3's nor
    // T4.4's own original suites, each single-input-method, ever
    // exercised). Found missing in review (test-auditor).
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.btn-manual-toggle').click();
    const [minutesInput, secondsInput] = root
      .querySelector('.manual-time-fields')
      .querySelectorAll('input');
    minutesInput.value = '3';
    secondsInput.value = '15';

    // The heat advances behind this screen's back, same as the tap-path
    // test — a genuinely concurrent write from elsewhere.
    client.db.ct_heats[0].status = 'scoring';

    [...root.querySelectorAll('.manual-time-fields button')]
      .find((b) => b.textContent === 'Save')
      .click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('moved on');
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBeNull();

    document.body.removeChild(root);
  });

  it('a tap that lands after the heat has already advanced surfaces the real conflict, not a false "recorded"', async () => {
    // Models a real race: the organiser's tap is enqueued while THIS
    // render's own `data.heat.status` still reads 'timing' (captured
    // before the click), but by the time the RPC actually runs, the heat
    // has already moved on (e.g. auto_max_heat won first). The screen has
    // no way to synchronously prevent the click here — record_heat_time's
    // own p_expected_heat_status check is what catches it, which this test
    // proves reaches the organiser as a real message, not a silent
    // "recorded" success.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // The heat advances behind this screen's back — the RPC's own
    // p_expected_heat_status check is server-side, so mutating the shared
    // db directly (not through this screen) is exactly what simulates a
    // genuinely concurrent write from elsewhere.
    client.db.ct_heats[0].status = 'scoring';

    root.querySelector('.btn-stop').click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('moved on');
    // The entry itself was never actually written — ground truth (the
    // reload) shows it still null, which is exactly why the conflict
    // message won out over an optimistic "recorded" one.
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBeNull();
    // The heat's real status already advanced past 'timing' (see above),
    // so this render also lands on the "Timing complete" card — found in
    // review: the completing-transition focus redirect there must NOT
    // fire on this error tone, or a keyboard-only user would have no way
    // to reach this rejection text at all (`feedback` is tabindex="-1",
    // out of tab order).
    expect(document.activeElement).toBe(feedback);

    document.body.removeChild(root);
  });

  it('a plain navigation straight to an already-complete heat leaves focus untouched', async () => {
    // No tap/save/auto-max just happened here (no pendingHeatCheck/
    // pendingEntryCheck, no success/error tone) — the completing-transition
    // focus redirect must stay inert in this case, same as before that fix
    // existed (found in review as the negative case its own guard needs
    // covering).
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: { ...appHeatPending, status: 'scoring' },
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: 90, maxed: false }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    expect(root.textContent).toContain('Timing complete');
    expect(document.activeElement).toBe(document.body);

    document.body.removeChild(root);
  });

  it('auto-maxes everyone still running once the countdown expires, and stops ticking', async () => {
    const root = document.createElement('div');
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // Jump the (only faked) clock past the full 480s duration, then wait
    // for one real tick to actually fire — it detects expiry and calls
    // handleExpiry()'s own async chain (a real outbox write), which now
    // resolves normally since nothing else in this suite is faked.
    vi.setSystemTime(new Date('2026-08-22T10:08:00.000Z'));
    await settle(1200);

    expect(root.textContent).toContain('Timing complete');
    // Exact text, not just a substring — a maxed row's label must show its
    // own time, not merely mention "Max time" somewhere on the page.
    expect(root.querySelector('.timing-row-result').textContent).toBe('Max time (8:00)');
    expect(root.querySelector('.countdown-display')).toBeNull();
    // The auto-max is a real state change (a cupper's clock hit zero without
    // them tapping) — it goes through the same success announcement a
    // manual stop does, not silently reflected in the row list alone.
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain('automatically maxed');

    // Live-found gap: the complete view used to have no forward link at
    // all, forcing a detour back through Overview -> Heats to reach
    // scoring — this is the direct link added to close it.
    const scoreLink = [...root.querySelectorAll('a')].find(
      (a) => a.textContent === 'Score this heat',
    );
    expect(scoreLink.getAttribute('href')).toBe('#/events/ev1/heats/h1/scoring');

    expect(client.calls.some(([name]) => name === 'auto_max_heat')).toBe(true);

    // The interval was actually torn down (not merely idempotency-guarded
    // against redundant writes) — proven directly against the timer API,
    // not inferred from an absence of further RPC calls.
    expect(clearIntervalSpy).toHaveBeenCalled();

    // No leaked interval still running against a torn-down countdown — a
    // real, unbounded wait covering several would-be tick periods, since
    // this interval is genuinely real in this suite (see the module
    // comment above).
    const callsAfter = client.calls.length;
    await settle(2500);
    expect(client.calls.length).toBe(callsAfter);

    clearIntervalSpy.mockRestore();
  });

  it('does not leak a visibilitychange listener across multiple renders while still timing', async () => {
    const root = document.createElement('div');
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    // Two cuppers, so the first stop's re-render lands back in the
    // 'timing' branch (not everyone's done) — exactly the case that would
    // add a second listener without the fix.
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [
        { id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null },
        { id: 'he2', heat_id: 'h1', entry_id: 'e2', elapsed_secs: null },
      ],
      roster: [
        { id: 'e1', display_name: 'Cupper One' },
        { id: 'e2', display_name: 'Cupper Two' },
      ],
    });

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const visibilityAddsBefore = addSpy.mock.calls.filter(
      ([type]) => type === 'visibilitychange',
    ).length;
    expect(visibilityAddsBefore).toBe(1);

    root.querySelector('.btn-stop').click();
    await settle();

    const visibilityAddsAfter = addSpy.mock.calls.filter(
      ([type]) => type === 'visibilitychange',
    ).length;
    const visibilityRemovesAfter = removeSpy.mock.calls.filter(
      ([type]) => type === 'visibilitychange',
    ).length;
    // A second listener was added for the new render, but the first one was
    // removed — never more than one net-active at a time.
    expect(visibilityAddsAfter).toBe(2);
    expect(visibilityRemovesAfter).toBe(1);

    // Load-bearing, not just tidy cleanup — this heat is still 'timing'
    // (only e1 was stopped), so its interval is genuinely real and would
    // otherwise keep ticking in the background across every LATER test in
    // this file (see the "ticks down" test's own comment on this).
    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('unmount() stops the live countdown so it never ticks (or writes) after the screen is torn down', async () => {
    const root = document.createElement('div');
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: timingHeat,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const callsBeforeUnmount = client.calls.length;
    unmount();

    // Jump well past the heat's duration and wait a real tick period — if
    // the interval were still live, it would detect expiry and call
    // autoMaxRemainingEntries.
    vi.setSystemTime(new Date('2026-08-22T10:08:00.000Z'));
    await settle(1200);
    expect(client.calls.length).toBe(callsBeforeUnmount);
  });

  // The next two tests drive two concurrent async chains (two taps racing,
  // or a tap racing unmount()) whose internal query interleaving isn't
  // something a test can pin down by pre-staging a fixed response order.
  // Only the `events` table is gate-controlled (a manually-resolved
  // promise) — it's loadState()'s first await, the one every render() must
  // pass through, so gating it lets the test control exactly when a given
  // render() is allowed to proceed, without needing to guess how two
  // independent action chains interleave before that point. recordTap
  // itself has no server read of its own to race (unlike the old
  // direct-write version) — it enqueues and flushes purely from the
  // caller-supplied local state — so the only real race left to prove is
  // at the render() layer, which is exactly what these tests target.
  function buildGatedRaceClient({ heat, entries, roster }) {
    const db = { ct_heats: [heat], ct_heat_entries: entries, event_entries: roster };
    const eventsGates = [];
    let eventsCallCount = 0;

    return {
      eventsGates,
      rpc: makeRpc(db, []),
      from(table) {
        if (table === 'events') {
          eventsCallCount += 1;
          if (eventsCallCount === 1) {
            // The mount's own initial render — resolves immediately so
            // mounting itself isn't part of the race under test.
            return {
              select: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: 'ev1', org_id: 'org1', is_test: false },
                      error: null,
                    }),
                }),
              }),
            };
          }
          let resolve;
          const promise = new Promise((r) => {
            resolve = r;
          });
          eventsGates.push({ resolve });
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  promise.then(() => ({
                    data: { id: 'ev1', org_id: 'org1', is_test: false },
                    error: null,
                  })),
              }),
            }),
          };
        }
        return makeTableBuilder(db[table] ?? []);
      },
    };
  }

  it('a slower, superseded render never touches the DOM once a faster, later render has already completed', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const heat = {
      id: 'h1',
      heat_number: 1,
      timing_mode: 'app',
      status: 'timing',
      duration_secs: 480,
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const entries = [
      { id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null, maxed: false },
      { id: 'he2', heat_id: 'h1', entry_id: 'e2', elapsed_secs: null, maxed: false },
    ];
    const roster = [
      { id: 'e1', display_name: 'Cupper One' },
      { id: 'e2', display_name: 'Cupper Two' },
    ];
    const client = buildGatedRaceClient({ heat, entries, roster });

    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const buttons = root.querySelectorAll('.btn-stop');
    expect(buttons).toHaveLength(2);
    // Both taps fire in the same synchronous tick, before either chain has
    // a chance to complete — exactly the shape of input a real organiser
    // stopping two cuppers in quick succession produces.
    buttons[0].click();
    buttons[1].click();

    // Let both recordTap chains (enqueue + flush, neither gated) fully
    // resolve — both reach their own render()'s loadState() and block on
    // the gated `events` table.
    await settle();
    expect(client.eventsGates).toHaveLength(2);

    const containerBefore = root.querySelector('.screen-container');

    // Resolve the LATER-arriving render's gate first — it "wins," writing
    // the final DOM. Both taps already landed by this point, so whichever
    // render wins shows the completed state.
    client.eventsGates[1].resolve();
    await settle(0);
    expect(root.textContent).toContain('Timing complete');
    const containerAfterWinner = root.querySelector('.screen-container');
    expect(containerAfterWinner).not.toBe(containerBefore);

    // Now resolve the OLDER, superseded render's gate. If the generation
    // guard didn't exist, this would call root.innerHTML = '' and rebuild
    // a second time — replacing containerAfterWinner with a new node even
    // though nothing about the visible state should change.
    client.eventsGates[0].resolve();
    await settle(0);
    expect(root.querySelector('.screen-container')).toBe(containerAfterWinner);
  });

  it('unmount() called while a render() is still in flight prevents that render from ever touching the DOM or leaving a live interval', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const heat = {
      id: 'h1',
      heat_number: 1,
      timing_mode: 'app',
      status: 'timing',
      duration_secs: 480,
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const entries = [
      { id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null, maxed: false },
    ];
    const roster = [{ id: 'e1', display_name: 'Cupper One' }];
    const client = buildGatedRaceClient({ heat, entries, roster });

    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const intervalCallsAfterMount = setIntervalSpy.mock.calls.length;

    root.querySelector('.btn-stop').click();
    await settle();
    expect(client.eventsGates).toHaveLength(1); // the tap's own render is now blocked

    const containerBeforeUnmount = root.querySelector('.screen-container');
    unmount();

    // Let the blocked render finally resolve past its gate — without the
    // fix, it would proceed to rebuild the DOM and register a fresh
    // interval that nothing would ever clear again.
    client.eventsGates[0].resolve();
    await settle(0);

    expect(root.querySelector('.screen-container')).toBe(containerBeforeUnmount);
    expect(setIntervalSpy.mock.calls.length).toBe(intervalCallsAfterMount);

    setIntervalSpy.mockRestore();
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own INITIAL load is still in flight when
    // the router (in production) decides a newer navigation has superseded
    // it and aborts this mount's signal — well before render()'s own
    // loadState() promise gets a chance to resolve. Distinct from the
    // renderGeneration/unmount() tests above, which guard against races
    // WITHIN one already-mounted screen instance, not this one.
    let resolveEvent;
    const otherTables = {
      ct_heats: [appHeatPending],
      ct_heat_entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      event_entries: [{ id: 'e1', display_name: 'Cupper One' }],
    };
    const client = {
      from(table) {
        if (table !== 'events') return makeTableBuilder(otherTables[table] ?? []);
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                new Promise((resolve) => {
                  resolveEvent = () =>
                    resolve({ data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null });
                }),
            }),
          }),
        };
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountTimingScreen(root, {
      eventId: 'ev1',
      heatId: 'h1',
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
    // screen's content, untouched, not this screen's own roster/timing UI.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Start heat');
  });
});
