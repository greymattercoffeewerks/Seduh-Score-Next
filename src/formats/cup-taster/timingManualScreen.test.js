import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseElapsedInput,
  renderManualEntryRows,
  mountManualTimingScreen,
} from './timingManualScreen.js';
import { _clearAllForTests } from '../../core/db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

// This suite fakes ONLY `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`
// below), never the full timer set — see timingScreen.test.js's own module
// comment for the full root-cause account (fake-indexeddb needs a genuine
// real macrotask turn to complete a transaction; faking the full timer set
// leaves that transaction open forever, hanging every LATER test's own
// indexedDB access too). `settle()` is a plain, unfaked wait.
function settle(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesFilters(row, filters) {
  return filters.every(([type, col, val]) => {
    if (type === 'eq') return row[col] === val;
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
    in: (col, vals) => {
      filters.push(['in', col, vals]);
      return builder;
    },
    // A shallow COPY, not the live db row reference — see
    // timingScreen.test.js's own comment on why this matters (a real
    // Supabase read returns freshly-deserialized JSON, not a live handle
    // into server memory; without copying, a test simulating a stale local
    // read vs. a concurrent server write would silently mutate the same
    // object as both).
    single: () => {
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

// Mutates the shared `db` in place, mirroring record_heat_time's own real
// server-side behavior (migration 20260828150000) closely enough to
// exercise the whole outbox-wired round trip end to end. This screen only
// ever calls it with p_conflict_policy: 'overwrite'.
function makeRpc(db, calls) {
  return (name, payload) => {
    calls.push([name, payload]);
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
      entry.elapsed_secs = payload.p_elapsed_secs;
      entry.elapsed_secs_raw = payload.p_elapsed_secs_raw;
      entry.maxed = payload.p_maxed;
      entry.time_source = payload.p_time_source;
      entry.time_edited_at = payload.p_time_edited_at;
      const heatEntries = db.ct_heat_entries.filter((e) => e.heat_id === heat.id);
      if (heatEntries.every((e) => e.elapsed_secs != null)) heat.status = 'scoring';
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
}

function buildFakeClient({ event, heat, entries, roster }) {
  // Shallow-cloned, not the caller's own object references — several tests
  // share module-level fixtures like `manualHeatPending`, and makeRpc()'s
  // handlers mutate `heat`/entries in place; without cloning here, one
  // test's save would permanently mutate the shared fixture object for
  // every later test that reuses it (found the hard way in
  // timingScreen.test.js's own equivalent bug).
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-22T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an editable entry row for a pending manual heat', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(root.querySelectorAll('input')).toHaveLength(2);
  });

  it('rejects mounting against an app-timing-mode heat with an explanatory message, no inputs', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: { ...manualHeatPending, timing_mode: 'app' },
      entries: [],
      roster: [],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('app');
    expect(root.querySelector('input')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: true },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('Test Data');
  });

  it('does not render the is-test banner for a real event', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('saving a valid entry records it, announces success, and moves focus to the feedback region', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // Two entries — the save below only completes ONE of them, so the heat
    // must stay 'pending' (see the dedicated completion test below for the
    // single-entry, heat-completing case).
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [
        { id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null },
        { id: 'he2', heat_id: 'h1', entry_id: 'e2', elapsed_secs: null },
      ],
      roster: [
        { id: 'e1', display_name: 'Cupper One' },
        { id: 'e2', display_name: 'Cupper Two' },
      ],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('success');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    expect(document.activeElement).toBe(feedback);
    expect(root.querySelector('.timing-row-result').textContent).toBe('Recorded: 2:05');
    // The completion suffix (see the dedicated test below) must NOT appear
    // here — e2 is still unrecorded, so a save that didn't complete the
    // heat must announce only the individual save, not "Timing complete" too.
    expect(feedback.textContent).not.toContain('Timing complete');
    expect(root.querySelector('input')).not.toBeNull();

    document.body.removeChild(root);
  });

  it('a save that completes the heat announces the transition, not just the individual save', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    await settle();

    // The screen has already switched to the read-only "Timing complete"
    // view by this point — the aria-live announcement is what tells a
    // screen reader user the whole screen just changed shape; DOM focus
    // itself now moves to the new heading (not the feedback region, found
    // in ui-accessibility-reviewer's own pass — see the render() branch's
    // own comment), so Tab from there reaches the new "Score this heat"
    // link rather than skipping past it.
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toContain("Cupper One's time recorded");
    expect(feedback.textContent).toContain('Timing complete');
    expect(root.textContent).toContain('Score this heat');
    expect(root.querySelector('input')).toBeNull();
    expect(document.activeElement.id).toBe('timing-complete-heading');

    document.body.removeChild(root);
  });

  it('an invalid entry shows a validation error and never calls recordManualTime', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '75'; // invalid — out of 0-59 range
    root.querySelector('button').click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('Seconds must be a whole number');
    // No RPC call was ever issued — the parse error is caught before
    // recordManualTime is even called.
    expect(client.calls).toHaveLength(0);

    document.body.removeChild(root);
  });

  it('a correction attempted after the heat has already advanced past pending is rejected, not silently accepted', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: 150 }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // The heat advances behind this screen's back — mutating the shared db
    // directly (not through this screen) simulates a genuinely concurrent
    // write, the same technique timingScreen.test.js's own equivalent test
    // uses.
    client.db.ct_heats[0].status = 'scoring';

    // A genuinely DIFFERENT value from the fixture's existing 150s — not
    // just any correction. If it coincidentally matched, the ground-truth
    // check (comparing the reloaded value against what THIS save attempted
    // to write) couldn't tell "rejected, unchanged" apart from "succeeded,
    // coincidentally the same number" — exactly the gap an earlier version
    // of this test had, caught only by actually running it.
    const inputs = root.querySelectorAll('input');
    inputs[0].value = '3';
    inputs[1].value = '0';
    root.querySelector('button').click();
    await settle();

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('moved on');
    // The entry itself was never actually overwritten — ground truth (the
    // reload) still shows the original value.
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBe(150);

    document.body.removeChild(root);
  });

  it('advances to the read-only complete view once every entry has a manual time, no longer editable', async () => {
    const root = document.createElement('div');
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: { ...manualHeatPending, status: 'scoring' },
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: 200, maxed: false }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Timing complete');
    expect(root.querySelector('input')).toBeNull();
    expect(root.textContent).toContain('3:20');
    // Live-found gap: the complete view used to have no forward link at
    // all, forcing a detour back through Overview -> Heats to reach
    // scoring — this is the direct link added to close it.
    const scoreLink = [...root.querySelectorAll('a')].find(
      (a) => a.textContent === 'Score this heat',
    );
    expect(scoreLink.getAttribute('href')).toBe('#/events/ev1/heats/h1/scoring');
    // A plain navigation straight to an already-complete heat — no
    // save/tap just happened, so no success tone is set — must NOT steal
    // focus to the heading; that redirect is only for the live completing
    // transition (found in review: the guard's own condition must stay
    // false here, not just true on the positive case).
    expect(document.activeElement).toBe(document.body);
  });

  it('a rejected concurrent save leaves focus on the feedback region, not the complete heading, so the rejection is reachable by keyboard', async () => {
    // The heat completing (someone ELSE's save won the race, changing its
    // status out from under this screen's own loaded snapshot) and THIS
    // save being rejected happen in the same render — found in a second
    // review pass: the completing-transition focus redirect above must
    // not fire on an error tone, or a keyboard-only user would have no
    // way to reach this rejection text at all (`feedback` is
    // tabindex="-1", out of tab order).
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = buildFakeClient({
      event: { id: 'ev1', org_id: 'org1', is_test: false },
      heat: manualHeatPending,
      entries: [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }],
      roster: [{ id: 'e1', display_name: 'Cupper One' }],
    });
    await mountManualTimingScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // Simulates a concurrent write that already moved the heat on while
    // this screen was still showing the (now-stale) 'pending' form — the
    // real production shape record_heat_time's own optimistic-concurrency
    // check (p_expected_heat_status) guards against, mirrored by this
    // fake client's makeRpc() above.
    client.db.ct_heats[0].status = 'scoring';

    const inputs = root.querySelectorAll('input');
    inputs[0].value = '2';
    inputs[1].value = '5';
    root.querySelector('button').click();
    await settle();

    // The rejection, not a clean save — this entry's elapsed_secs was
    // never actually written.
    expect(client.db.ct_heat_entries[0].elapsed_secs).toBeNull();
    // Reached the "Timing complete" branch anyway (the DB's real status
    // already moved on), which is exactly the case the guard must handle.
    expect(root.textContent).toContain('Timing complete');
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback);

    document.body.removeChild(root);
  });

  // Same technique as timingScreen.test.js's own gated-race tests: the
  // `events` table is gate-controlled (it's loadState's first await,
  // untouched by recordManualTime itself), letting the test control exactly
  // when the re-render triggered by Save is allowed to proceed past that
  // point.
  it('unmount() called while a render() is still in flight prevents that render from ever touching the DOM', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const heat = { ...manualHeatPending };
    const entries = [{ id: 'he1', heat_id: 'h1', entry_id: 'e1', elapsed_secs: null }];
    const roster = [{ id: 'e1', display_name: 'Cupper One' }];
    const db = { ct_heats: [heat], ct_heat_entries: entries, event_entries: roster };

    let eventsCallCount = 0;
    let resolveGatedEvents;
    const client = {
      rpc: makeRpc(db, []),
      from(table) {
        if (table === 'events') {
          eventsCallCount += 1;
          if (eventsCallCount === 1) {
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
          const gated = new Promise((resolve) => {
            resolveGatedEvents = resolve;
          });
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  gated.then(() => ({
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
    // Let recordManualTime's write (enqueue + flush, real IndexedDB) fully
    // complete, and its follow-up render() reach (and block on) the gated
    // events query.
    await settle();
    expect(eventsCallCount).toBe(2);

    unmount();
    resolveGatedEvents();
    await settle(0);

    // The blocked render's generation check now fails (unmount() bumped
    // the counter) — it must never reach root.innerHTML = '', so the
    // container from before unmount() is still the live node.
    expect(root.querySelector('.screen-container')).toBe(containerBeforeUnmount);

    document.body.removeChild(root);
  });
});
