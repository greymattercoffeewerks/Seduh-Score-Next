import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderRosterPreview, renderTimingRows, mountTimingScreen } from './timingScreen.js';

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
        update: (payload) => {
          calls.push(['update', table, payload]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        is: (...args) => {
          calls.push(['is', table, ...args]);
          return builder;
        },
        in: (...args) => {
          calls.push(['in', table, ...args]);
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the roster and a start button for a pending heat', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: appHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(root.querySelector('button').textContent).toBe('Start heat');
  });

  it('rejects mounting against a manual-timing-mode heat with an explanatory message, no start button', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: { ...appHeatPending, timing_mode: 'manual' }, error: null },
        ct_heat_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('manual');
    expect(root.querySelector('button')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: true }, error: null },
        ct_heats: { data: appHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Test Data');
  });

  it('does not render the is-test banner for a real event', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: appHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('starting the heat shows a live countdown that ticks down', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const startedHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: appHeatPending, error: null }, // initial load
          { data: startedHeat, error: null }, // startHeat's update
          { data: startedHeat, error: null }, // re-render's findHeatById
        ],
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0); // let the click handler's awaits settle

    // Focus moved to the new, stable heading — a separate element from the
    // ticking display itself (the ticking div is never the focus target, so
    // per-second textContent mutation can never steal focus mid-tick).
    expect(document.activeElement.id).toBe('countdown-heading');

    const countdown = root.querySelector('.countdown-display');
    expect(countdown.textContent).toBe('8:00');

    await vi.advanceTimersByTimeAsync(3000);
    expect(countdown.textContent).toBe('7:57');

    document.body.removeChild(root);
  });

  it('announces once, via the live region, when the countdown first crosses the urgent threshold', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const startedHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: appHeatPending, error: null },
          { data: startedHeat, error: null },
          { data: startedHeat, error: null },
        ],
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    root.querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toBe('');

    // 471s in: 9s remaining, just inside the urgent window.
    await vi.advanceTimersByTimeAsync(471_000);
    expect(feedback.dataset.tone).toBe('urgent');
    expect(feedback.textContent).toContain('10 seconds');

    // Clear it manually to prove the NEXT tick doesn't re-announce (a real
    // render would replace this node; simulating the one-time behavior
    // directly on the live tick loop here).
    feedback.textContent = '';
    delete feedback.dataset.tone;
    await vi.advanceTimersByTimeAsync(1000);
    expect(feedback.textContent).toBe('');

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
    const stoppedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 120,
      elapsed_secs_raw: 120,
      maxed: false,
    };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: timingHeat, error: null }, // initial load
          { data: timingHeat, error: null }, // recordTap's own findHeatById
          { data: null, error: null }, // maybeAdvanceToScoring: not everyone done — no ct_heats update
          { data: timingHeat, error: null }, // re-render's findHeatById
        ],
        ct_heat_entries: [
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null }, // initial load
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // findHeatEntry
          { data: stoppedEntry, error: null }, // update result
          { data: [stoppedEntry], error: null }, // maybeAdvanceToScoring's listHeatEntries
          { data: [stoppedEntry], error: null }, // re-render's listHeatEntries
        ],
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    // 2 minutes into the heat when the tap happens
    vi.setSystemTime(new Date('2026-08-22T10:02:00.000Z'));

    root.querySelector('.btn-stop').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(root.querySelector('.btn-stop')).toBeNull();
    expect(root.textContent).toContain('2:00');

    // No explicit focus target is set for a stop tap — the fallback is the
    // feedback region, which also carries the "recorded" announcement (both
    // the refocus fix and the success-announcement fix land on the same
    // element by design).
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    expect(document.activeElement).toBe(feedback);

    document.body.removeChild(root);
  });

  it('auto-maxes everyone still running once the countdown expires, and stops ticking', async () => {
    const root = document.createElement('div');
    const timingHeat = {
      ...appHeatPending,
      status: 'timing',
      started_at: '2026-08-22T10:00:00.000Z',
    };
    const scoringHeat = { ...timingHeat, status: 'scoring' };
    const maxedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 480,
      elapsed_secs_raw: 480,
      maxed: true,
    };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: timingHeat, error: null }, // initial load
          { data: timingHeat, error: null }, // autoMaxRemainingEntries's own findHeatById
          { data: scoringHeat, error: null }, // maybeAdvanceToScoring's update
          { data: scoringHeat, error: null }, // re-render's findHeatById
        ],
        ct_heat_entries: [
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null }, // initial load
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null }, // autoMax's listHeatEntries
          { data: maxedEntry, error: null }, // update result for e1
          { data: [maxedEntry], error: null }, // maybeAdvanceToScoring's listHeatEntries
          { data: [maxedEntry], error: null }, // re-render's listHeatEntries
        ],
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // Advance past the full 480s duration.
    await vi.advanceTimersByTimeAsync(480_000);

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

    // The interval was actually torn down (not merely idempotency-guarded
    // against redundant writes) — proven directly against the timer API,
    // not inferred from an absence of further DB calls.
    expect(clearIntervalSpy).toHaveBeenCalled();

    // No leaked interval still running against a torn-down countdown.
    const insertCallsAfter = client.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.calls.length).toBe(insertCallsAfter);

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
    const entryE1 = { id: 'he1', entry_id: 'e1', elapsed_secs: null };
    const entryE2 = { id: 'he2', entry_id: 'e2', elapsed_secs: null };
    const stoppedE1 = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 60,
      elapsed_secs_raw: 60,
      maxed: false,
    };

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: timingHeat, error: null }, // initial load
          { data: timingHeat, error: null }, // recordTap's findHeatById
          // maybeAdvanceToScoring never touches ct_heats at all here — e2 is
          // still unstopped, so it returns early after its own
          // ct_heat_entries check, below.
          { data: timingHeat, error: null }, // re-render's findHeatById
        ],
        ct_heat_entries: [
          { data: [entryE1, entryE2], error: null }, // initial load
          { data: entryE1, error: null }, // findHeatEntry
          { data: stoppedE1, error: null }, // update result
          { data: [stoppedE1, entryE2], error: null }, // maybeAdvanceToScoring's listHeatEntries
          { data: [stoppedE1, entryE2], error: null }, // re-render's listHeatEntries
        ],
        event_entries: {
          data: [
            { id: 'e1', display_name: 'Cupper One' },
            { id: 'e2', display_name: 'Cupper Two' },
          ],
          error: null,
        },
      },
    });
    await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const visibilityAddsBefore = addSpy.mock.calls.filter(
      ([type]) => type === 'visibilitychange',
    ).length;
    expect(visibilityAddsBefore).toBe(1);

    root.querySelector('.btn-stop').click();
    await vi.advanceTimersByTimeAsync(0);

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
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: timingHeat, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    const { unmount } = await mountTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const callsBeforeUnmount = client.calls.length;
    unmount();

    // Advance well past the heat's duration — if the interval were still
    // live, it would detect expiry and call autoMaxRemainingEntries.
    await vi.advanceTimersByTimeAsync(480_000);
    expect(client.calls.length).toBe(callsBeforeUnmount);
  });

  // The next two tests build a small, realistic in-memory client (state
  // matched by filter, not a strict call-order queue) rather than reusing
  // the FIFO `fakeClient` above — deliberately: both tests drive two
  // concurrent async chains (two taps racing, or a tap racing unmount())
  // whose internal query interleaving isn't something a test can pin down
  // by pre-staging a fixed response order. Only the `events` table is
  // gate-controlled (a manually-resolved promise) — it's loadState()'s
  // first await, never touched by recordTap itself, so gating it lets the
  // test control exactly when a given render() is allowed to proceed past
  // that point, without needing to guess the order two independent
  // recordTap chains interleave in.
  function buildGatedRaceClient({ heat, entries, roster }) {
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
      let pendingUpdate = null;
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
        update: (payload) => {
          pendingUpdate = payload;
          return builder;
        },
        single: () => {
          const matched = rows.filter((row) => matchesFilters(row, filters));
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        maybeSingle: () => {
          const matched = rows.filter((row) => matchesFilters(row, filters));
          if (pendingUpdate) {
            if (matched.length === 0) return Promise.resolve({ data: null, error: null });
            Object.assign(matched[0], pendingUpdate);
            return Promise.resolve({ data: { ...matched[0] }, error: null });
          }
          return Promise.resolve({ data: matched[0] ?? null, error: null });
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

    const eventsGates = [];
    let eventsCallCount = 0;

    return {
      eventsGates,
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
                    Promise.resolve({ data: { id: 'ev1', is_test: false }, error: null }),
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
                  promise.then(() => ({ data: { id: 'ev1', is_test: false }, error: null })),
              }),
            }),
          };
        }
        if (table === 'ct_heats') return makeTableBuilder([heat]);
        if (table === 'ct_heat_entries') return makeTableBuilder(entries);
        if (table === 'event_entries') return makeTableBuilder(roster);
        return makeTableBuilder([]);
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

    // Let both recordTap chains (and both writes) fully resolve — neither
    // touches the gated `events` table, so both reach their own render()'s
    // loadState() and block there.
    await vi.advanceTimersByTimeAsync(0);
    expect(client.eventsGates).toHaveLength(2);

    const containerBefore = root.querySelector('.screen-container');

    // Resolve the LATER-arriving render's gate first — it "wins," writing
    // the final DOM. Both taps already landed in the DB by this point, so
    // whichever render wins shows the completed state.
    client.eventsGates[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain('Timing complete');
    const containerAfterWinner = root.querySelector('.screen-container');
    expect(containerAfterWinner).not.toBe(containerBefore);

    // Now resolve the OLDER, superseded render's gate. If the generation
    // guard didn't exist, this would call root.innerHTML = '' and rebuild
    // a second time — replacing containerAfterWinner with a new node even
    // though nothing about the visible state should change.
    client.eventsGates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
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
    await vi.advanceTimersByTimeAsync(0);
    expect(client.eventsGates).toHaveLength(1); // the tap's own render is now blocked

    const containerBeforeUnmount = root.querySelector('.screen-container');
    unmount();

    // Let the blocked render finally resolve past its gate — without the
    // fix, it would proceed to rebuild the DOM and register a fresh
    // interval that nothing would ever clear again.
    client.eventsGates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(root.querySelector('.screen-container')).toBe(containerBeforeUnmount);
    expect(setIntervalSpy.mock.calls.length).toBe(intervalCallsAfterMount);

    setIntervalSpy.mockRestore();
  });
});
