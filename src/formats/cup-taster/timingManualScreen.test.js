import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseElapsedInput,
  renderManualEntryRows,
  mountManualTimingScreen,
} from './timingManualScreen.js';

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

describe('parseElapsedInput', () => {
  it('converts minutes and seconds to a total-seconds value', () => {
    expect(parseElapsedInput('2', '5')).toBe(125);
    expect(parseElapsedInput('0', '0')).toBe(0);
    expect(parseElapsedInput('8', '0')).toBe(480);
  });

  it('rejects an empty minutes field rather than treating it as 0', () => {
    expect(() => parseElapsedInput('', '5')).toThrow('Minutes must be a whole number');
  });

  it('rejects an empty seconds field rather than treating it as 0', () => {
    expect(() => parseElapsedInput('2', '')).toThrow('Seconds must be a whole number');
  });

  it('rejects a negative or non-integer minutes value', () => {
    expect(() => parseElapsedInput('-1', '5')).toThrow('Minutes must be a whole number');
    expect(() => parseElapsedInput('2.5', '5')).toThrow('Minutes must be a whole number');
  });

  it('rejects seconds outside 0–59', () => {
    expect(() => parseElapsedInput('2', '75')).toThrow(
      'Seconds must be a whole number from 0 to 59',
    );
    expect(() => parseElapsedInput('2', '-1')).toThrow(
      'Seconds must be a whole number from 0 to 59',
    );
  });

  it('accepts exactly 59 seconds and rejects exactly 60 — the boundary itself, not just values far past it', () => {
    expect(parseElapsedInput('2', '59')).toBe(179);
    expect(() => parseElapsedInput('2', '60')).toThrow(
      'Seconds must be a whole number from 0 to 59',
    );
  });
});

describe('renderManualEntryRows', () => {
  it('renders empty, unlabeled inputs and a Save button for an unrecorded entry', () => {
    const rows = renderManualEntryRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onSave: () => {} },
    );
    const inputs = rows.querySelectorAll('input');
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe('');
    expect(inputs[1].value).toBe('');
    expect(rows.querySelector('button').textContent).toBe('Save');
    expect(rows.querySelector('.timing-row-result')).toBeNull();
  });

  it('pre-fills inputs from the raw entered value, and labels the button Update', () => {
    const rows = renderManualEntryRows(
      [
        {
          entry_id: 'e1',
          displayName: 'Cupper One',
          elapsed_secs: 125,
          elapsed_secs_raw: 125,
          maxed: false,
        },
      ],
      { onSave: () => {} },
    );
    const inputs = rows.querySelectorAll('input');
    expect(inputs[0].value).toBe('2');
    expect(inputs[1].value).toBe('5');
    expect(rows.querySelector('button').textContent).toBe('Update');
    expect(rows.querySelector('.timing-row-result').textContent).toBe('Recorded: 2:05');
  });

  it('shows a distinct Max time status for a maxed entry, pre-filling from the true raw entered value, not the clamped one', () => {
    const rows = renderManualEntryRows(
      [
        {
          entry_id: 'e1',
          displayName: 'Cupper One',
          elapsed_secs: 480,
          elapsed_secs_raw: 483,
          maxed: true,
        },
      ],
      { onSave: () => {} },
    );
    const inputs = rows.querySelectorAll('input');
    // Pre-fill reflects what the judge actually typed (8:03), not what got
    // clamped to (8:00) — otherwise re-saving without changing anything
    // would silently "fix" a value the judge never asked to change.
    expect(inputs[0].value).toBe('8');
    expect(inputs[1].value).toBe('3');
    expect(rows.querySelector('.timing-row-result').textContent).toBe('Max time (8:00)');
    expect(rows.querySelector('.timing-row-result').dataset.maxed).toBe('true');
  });

  it('calls onSave with the entry id and the raw input values when Save is clicked', () => {
    const onSave = vi.fn();
    const rows = renderManualEntryRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: null }],
      { onSave },
    );
    const inputs = rows.querySelectorAll('input');
    inputs[0].value = '3';
    inputs[1].value = '15';
    rows.querySelector('button').click();
    expect(onSave).toHaveBeenCalledWith('e1', '3', '15');
  });

  it('shows a station badge when the entry has one', () => {
    const rows = renderManualEntryRows(
      [{ entry_id: 'e1', displayName: 'Cupper One', station: 'A', elapsed_secs: null }],
      { onSave: () => {} },
    );
    expect(rows.querySelector('.station-badge').textContent).toBe('A');
  });
});

const manualHeatPending = {
  id: 'h1',
  heat_number: 1,
  timing_mode: 'manual',
  status: 'pending',
  duration_secs: 480,
  started_at: null,
};

describe('mountManualTimingScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an editable entry row for a pending manual heat', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: manualHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(root.querySelectorAll('input')).toHaveLength(2);
  });

  it('rejects mounting against an app-timing-mode heat with an explanatory message, no inputs', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: { ...manualHeatPending, timing_mode: 'app' }, error: null },
        ct_heat_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('app');
    expect(root.querySelector('input')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: true }, error: null },
        ct_heats: { data: manualHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Test Data');
  });

  it('does not render the is-test banner for a real event', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: manualHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('saving a valid entry records it, announces success, and moves focus to the feedback region', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const savedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 125,
      elapsed_secs_raw: 125,
      maxed: false,
    };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        // Note: this fixture is a single-entry heat, so saving that one
        // entry genuinely IS the last one needed — but the re-render's own
        // findHeatById response below is deliberately still 'pending'
        // (the fakeClient is a blind FIFO queue, not a real filtered DB, so
        // this doesn't have to reflect what a real advance would produce).
        // This test is about the base save/announce/focus behavior, not
        // the completion announcement — see the dedicated test below for
        // that.
        ct_heats: [
          { data: manualHeatPending, error: null }, // initial load
          { data: manualHeatPending, error: null }, // recordManualTime's own findHeatById
          { data: null, error: null }, // maybeAdvanceToScoring's update (unused by this fixture)
          { data: manualHeatPending, error: null }, // re-render's findHeatById — still 'pending'
        ],
        ct_heat_entries: [
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null }, // initial load
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null }, // findHeatEntry
          { data: savedEntry, error: null }, // update result
          { data: [savedEntry], error: null }, // maybeAdvanceToScoring's listHeatEntries
          { data: [savedEntry], error: null }, // re-render's listHeatEntries
        ],
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    expect(document.activeElement).toBe(feedback);
    expect(root.querySelector('.timing-row-result').textContent).toBe('Recorded: 2:05');
    // The completion suffix (see the dedicated test below) must NOT appear
    // here — this fixture's re-render still reports the heat as 'pending',
    // so a save that didn't complete the heat must announce only the
    // individual save, not "Timing complete" too.
    expect(feedback.textContent).not.toContain('Timing complete');
    expect(root.querySelector('input')).not.toBeNull();

    document.body.removeChild(root);
  });

  it('a save that completes the heat announces the transition, not just the individual save', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const savedEntry = {
      id: 'he1',
      entry_id: 'e1',
      elapsed_secs: 125,
      elapsed_secs_raw: 125,
      maxed: false,
    };
    const scoringHeat = { ...manualHeatPending, status: 'scoring' };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: [
          { data: manualHeatPending, error: null }, // initial load
          { data: manualHeatPending, error: null }, // recordManualTime's own findHeatById
          { data: scoringHeat, error: null }, // maybeAdvanceToScoring's update — this WAS the last one
          { data: scoringHeat, error: null }, // re-render's findHeatById — now 'scoring'
        ],
        ct_heat_entries: [
          { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
          { data: { id: 'he1', entry_id: 'e1', elapsed_secs: null }, error: null },
          { data: savedEntry, error: null },
          { data: [savedEntry], error: null },
          { data: [savedEntry], error: null },
        ],
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);

    // The screen has already switched to the read-only "Timing complete"
    // view by this point — the announcement is the only way a screen
    // reader user learns the whole screen just changed shape, since focus
    // landing on the feedback region alone doesn't convey that on its own.
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    expect(feedback.textContent).toContain('Timing complete');
    expect(root.textContent).toContain('Proceed to scoring');
    expect(root.querySelector('input')).toBeNull();

    document.body.removeChild(root);
  });

  it('an invalid entry shows a validation error and never calls recordManualTime', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: manualHeatPending, error: null },
        ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: null }], error: null },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '75'; // invalid — out of 0-59 range
    root.querySelector('button').click();
    await vi.advanceTimersByTimeAsync(0);

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('Seconds must be a whole number');
    // No update call was ever issued — the parse error is caught before
    // recordManualTime is even called.
    expect(client.calls.filter(([action]) => action === 'update')).toHaveLength(0);

    document.body.removeChild(root);
  });

  it('advances to the read-only complete view once every entry has a manual time, no longer editable', async () => {
    const root = document.createElement('div');
    const scoringHeat = { ...manualHeatPending, status: 'scoring' };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_heat_entries: {
          data: [{ id: 'he1', entry_id: 'e1', elapsed_secs: 200, maxed: false }],
          error: null,
        },
        event_entries: { data: [{ id: 'e1', display_name: 'Cupper One' }], error: null },
      },
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');
    expect(root.querySelector('input')).toBeNull();
    expect(root.textContent).toContain('3:20');
  });

  it('unmount() called while a render() is still in flight prevents that render from ever touching the DOM', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    // Same technique as timingScreen.test.js's gated-race tests: a small,
    // realistic in-memory client (state matched by filter) with the
    // `events` table specifically gate-controlled, since it's loadState's
    // first await and untouched by recordManualTime itself — gating it lets
    // the test control exactly when the re-render triggered by Save is
    // allowed to proceed past that point.
    const heat = { ...manualHeatPending };
    const entries = [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }];
    const roster = [{ id: 'e1', display_name: 'Cupper One' }];

    function matchesFilters(row, filters) {
      return filters.every(([type, col, val]) => {
        if (type === 'eq') return row[col] === val;
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
        in: (col, val) => {
          filters.push(['in', col, val]);
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

    let eventsCallCount = 0;
    let resolveGatedEvents;
    const client = {
      from(table) {
        if (table === 'events') {
          eventsCallCount += 1;
          if (eventsCallCount === 1) {
            return {
              select: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({ data: { id: 'ev1', is_test: false }, error: null }),
                }),
              }),
            };
          }
          const gated = new Promise((resolve) => {
            resolveGatedEvents = resolve;
          });
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  gated.then(() => ({ data: { id: 'ev1', is_test: false }, error: null })),
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

    const { unmount } = await mountManualTimingScreen(root, {
      eventId: 'ev1',
      heatId: 'h1',
      client,
    });
    const containerBeforeUnmount = root.querySelector('.screen-container');

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    // Let recordManualTime's write complete and its follow-up render()
    // reach (and block on) the gated events query.
    await vi.advanceTimersByTimeAsync(0);
    expect(eventsCallCount).toBe(2);

    unmount();
    resolveGatedEvents();
    await vi.advanceTimersByTimeAsync(0);

    // The blocked render's generation check now fails (unmount() bumped
    // the counter) — it must never reach root.innerHTML = '', so the
    // container from before unmount() is still the live node.
    expect(root.querySelector('.screen-container')).toBe(containerBeforeUnmount);

    document.body.removeChild(root);
  });
});
