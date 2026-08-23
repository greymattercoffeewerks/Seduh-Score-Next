import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderScoringRows, mountScoringScreen } from './scoringScreen.js';
import { _clearAllForTests } from '../../core/db.js';

function fakeClient({ tables = {}, rpc } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  const calls = [];

  return {
    calls,
    rpc: (name, payload) => {
      calls.push(['rpc', name, payload]);
      return rpc ? rpc(name, payload) : Promise.resolve({ data: null, error: null });
    },
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

describe('renderScoringRows', () => {
  const setIds = ['s1', 's2'];
  const entries = [{ entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: 100 }];

  it('renders one unscored toggle button per set, tally 0/N', () => {
    const rows = renderScoringRows(
      entries,
      setIds,
      {},
      { onToggle: () => {}, onMarkWrong: () => {} },
    );
    const buttons = rows.querySelectorAll('.scoring-toggle');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].dataset.tone).toBe('unscored');
    expect(rows.querySelector('.scoring-tally').textContent).toBe('0/2');
  });

  it('a correct set shows a distinct tone from a wrong one, not just a different label', () => {
    const draft = { e1: { s1: true, s2: false } };
    const rows = renderScoringRows(entries, setIds, draft, {
      onToggle: () => {},
      onMarkWrong: () => {},
    });
    const buttons = rows.querySelectorAll('.scoring-toggle');
    expect(buttons[0].dataset.tone).toBe('correct');
    expect(buttons[1].dataset.tone).toBe('wrong');
    expect(rows.querySelector('.scoring-tally').textContent).toBe('1/2');
  });

  it('calls onToggle with the entry and set id when a toggle is clicked', () => {
    const onToggle = vi.fn();
    const rows = renderScoringRows(entries, setIds, {}, { onToggle, onMarkWrong: () => {} });
    rows.querySelector('.scoring-toggle').click();
    expect(onToggle).toHaveBeenCalledWith('e1', 's1');
  });

  it('shows a mark-remaining-wrong button while the entry is incomplete', () => {
    const rows = renderScoringRows(
      entries,
      setIds,
      {},
      { onToggle: () => {}, onMarkWrong: () => {} },
    );
    expect(rows.querySelector('.scoring-mark-wrong')).not.toBeNull();
  });

  it('hides the mark-remaining-wrong button once every set is scored — nothing left to mark', () => {
    const draft = { e1: { s1: true, s2: false } };
    const rows = renderScoringRows(entries, setIds, draft, {
      onToggle: () => {},
      onMarkWrong: () => {},
    });
    expect(rows.querySelector('.scoring-mark-wrong')).toBeNull();
  });

  it('marks the tally region data-complete once every set is scored', () => {
    const draft = { e1: { s1: true, s2: false } };
    const rows = renderScoringRows(entries, setIds, draft, {
      onToggle: () => {},
      onMarkWrong: () => {},
    });
    expect(rows.querySelector('.scoring-tally').dataset.complete).toBe('true');
  });

  it('interactive: false disables every toggle and omits the mark-wrong button — the read-only confirmed view', () => {
    const draft = { e1: { s1: true } };
    const onToggle = vi.fn();
    const rows = renderScoringRows(entries, setIds, draft, { onToggle, interactive: false });
    const buttons = rows.querySelectorAll('.scoring-toggle');
    expect([...buttons].every((button) => button.disabled)).toBe(true);
    buttons[0].click();
    expect(onToggle).not.toHaveBeenCalled();
    expect(rows.querySelector('.scoring-mark-wrong')).toBeNull();
  });

  it('locked disables every toggle and the mark-wrong button without marking them read-only — a temporarily-unavailable state during an in-flight confirm, not the permanently read-only confirmed view', () => {
    const onToggle = vi.fn();
    const onMarkWrong = vi.fn();
    const rows = renderScoringRows(
      entries,
      setIds,
      {},
      { onToggle, onMarkWrong, interactive: true, locked: true },
    );
    const buttons = rows.querySelectorAll('.scoring-toggle');
    expect([...buttons].every((button) => button.disabled)).toBe(true);
    // Unlike interactive: false, none of these carry data-readonly — CSS
    // (scoringScreen.css) uses that attribute specifically to distinguish
    // "closed, nothing to do" (full opacity, this is data) from "briefly
    // unavailable" (the normal dimmed .btn:disabled treatment).
    expect([...buttons].every((button) => button.dataset.readonly === undefined)).toBe(true);
    const markWrong = rows.querySelector('.scoring-mark-wrong');
    expect(markWrong.disabled).toBe(true);
    buttons[0].click();
    expect(onToggle).not.toHaveBeenCalled();
    markWrong.click();
    expect(onMarkWrong).not.toHaveBeenCalled();
  });
});

const scoringHeat = {
  id: 'h1',
  stage_id: 'st1',
  heat_number: 1,
  status: 'scoring',
  updated_at: '2026-08-23T00:00:00.000Z',
};

const oneSet = [{ id: 's1', stage_id: 'st1', position: 1, label: null }];
const oneEntry = [
  {
    id: 'he1',
    heat_id: 'h1',
    entry_id: 'e1',
    elapsed_secs: 120,
    elapsed_secs_raw: 120,
    maxed: false,
    time_source: 'tapped',
  },
];
const oneRosterEntry = [{ id: 'e1', display_name: 'Cupper One' }];

describe('mountScoringScreen', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  it('shows an unscored grid for a heat in scoring status, Confirm disabled', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('Cupper One');
    expect(root.querySelector('.btn-primary').disabled).toBe(true);
  });

  it('rejects a heat not yet in scoring status with an explanatory message, no grid', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: { ...scoringHeat, status: 'timing' }, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: [], error: null },
        event_entries: { data: [], error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.textContent).toContain('timing');
    expect(root.querySelector('.scoring-toggle')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: true }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('a toggle tap records the score, persists the draft, and refocuses the same cell', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct');
    });

    expect(document.activeElement.id).toBe('score-e1-s1');
    expect(root.querySelector('.btn-primary').disabled).toBe(false);

    document.body.removeChild(root);
  });

  it('marking remaining wrong fills every unscored set for that cupper, and enables Confirm once complete', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const twoSets = [
      { id: 's1', stage_id: 'st1', position: 1, label: null },
      { id: 's2', stage_id: 'st1', position: 2, label: null },
    ];
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: twoSets, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-mark-wrong').click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.scoring-toggle')[0].dataset.tone).toBe('wrong');
    });

    const buttons = root.querySelectorAll('.scoring-toggle');
    expect(buttons[0].dataset.tone).toBe('wrong');
    expect(buttons[1].dataset.tone).toBe('wrong');
    expect(root.querySelector('.btn-primary').disabled).toBe(false);

    document.body.removeChild(root);
  });

  it('confirming a complete heat calls confirm_heat with the built entries, clears the draft, and shows the confirmed view', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const scoredHeatEntries = [{ ...oneEntry[0] }];
    const confirmedHeat = { ...scoringHeat, status: 'confirmed' };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: [
          { data: scoringHeat, error: null }, // initial load
          { data: scoringHeat, error: null }, // re-render after the toggle tap — still 'scoring'
          { data: confirmedHeat, error: null }, // confirm handler's own ground-truth re-fetch
          { data: confirmedHeat, error: null }, // re-render's own loadState findHeatById
        ],
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: scoredHeatEntries, error: null },
        event_entries: { data: oneRosterEntry, error: null },
        // The confirmed re-render's loadState() switches from the local
        // draft to a real ct_results read (see loadConfirmedResults) —
        // without this, a just-confirmed heat would render as if nothing
        // had ever been scored.
        ct_results: { data: [{ heat_entry_id: 'he1', set_id: 's1', correct: true }], error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    // Score the one set before confirming.
    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    root.querySelector('.btn-primary').click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Heat confirmed');
    });

    const rpcCall = client.calls.find(([action]) => action === 'rpc');
    expect(rpcCall[1]).toBe('confirm_heat');
    expect(rpcCall[2].p_org_id).toBe('org1');
    expect(rpcCall[2].p_heat_id).toBe('h1');
    expect(rpcCall[2].p_entries[0].results).toEqual([{ set_id: 's1', correct: true }]);

    // The confirmed view must show the actual final score, not a blank
    // grid — this is exactly the bug live-verification caught: clearing
    // the local draft on success previously left the confirmed render with
    // nothing to display.
    expect(root.querySelector('.scoring-tally').textContent).toBe('1/1');
    expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('correct');

    document.body.removeChild(root);
  });

  it('a confirm_heat conflict (P0002) shows the distinguishing conflict message, not a generic error', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
      rpc: () =>
        Promise.resolve({
          data: null,
          error: {
            code: 'P0002',
            details: JSON.stringify({ current_updated_at: '2026-08-23T00:10:00.000Z' }),
          },
        }),
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    root.querySelector('.btn-primary').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    });

    expect(root.querySelector('.screen-feedback').textContent).toContain('changed elsewhere');

    document.body.removeChild(root);
  });

  it('two rapid taps on different sets both survive — regression test for a real lost-update race found in review', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const twoSets = [
      { id: 's1', stage_id: 'st1', position: 1, label: null },
      { id: 's2', stage_id: 'st1', position: 2, label: null },
    ];
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: twoSets, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    const buttons = root.querySelectorAll('.scoring-toggle');
    // Both taps fire against the SAME still-live old DOM, before the
    // first tap's own render() (a full loadState() round trip) has had
    // any chance to land — exactly the window where the bug lived: both
    // handlers used to read the same stale draft snapshot, and whichever
    // one's save landed last silently discarded the other's change.
    buttons[0].click();
    buttons[1].click();

    await vi.waitFor(() => {
      const finalButtons = root.querySelectorAll('.scoring-toggle');
      expect(finalButtons[0].dataset.tone).toBe('correct');
      expect(finalButtons[1].dataset.tone).toBe('correct');
    });

    const { loadDraft } = await import('./scoring.js');
    expect(await loadDraft('h1')).toEqual({ e1: { s1: true, s2: true } });

    document.body.removeChild(root);
  });

  it('a rapid double-click on Confirm submits only one operation, not two', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const confirmedHeat = { ...scoringHeat, status: 'confirmed' };
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        ct_heats: [
          { data: scoringHeat, error: null }, // initial load
          { data: scoringHeat, error: null }, // re-render after the toggle tap
          { data: confirmedHeat, error: null }, // confirm handler's own ground-truth re-fetch
          { data: confirmedHeat, error: null }, // re-render's own loadState findHeatById
        ],
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
        ct_results: { data: [{ heat_entry_id: 'he1', set_id: 's1', correct: true }], error: null },
      },
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    const confirmButton = root.querySelector('.btn-primary');
    confirmButton.click();
    // A second click on the same, still-live button, before the first
    // click's synchronous disable would matter if it weren't synchronous —
    // this proves it actually is: jsdom (like a real browser) never
    // dispatches a click on an already-disabled button.
    confirmButton.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Heat confirmed');
    });

    expect(client.calls.filter(([action]) => action === 'rpc')).toHaveLength(1);

    document.body.removeChild(root);
  });

  it('unmount() called while a render() is still in flight prevents that render from ever touching the DOM', async () => {
    // Deliberately real timers, not vi.useFakeTimers() + advanceTimersByTimeAsync(0)
    // (T4.3/T4.4's own technique for this exact race, and tried here
    // first): this screen's actions round-trip through REAL IndexedDB
    // (scoring.js's loadDraft/saveDraft, via fake-indexeddb), and that
    // combination reproducibly hung this test past its timeout. Root cause,
    // confirmed by reading fake-indexeddb's own source
    // (node_modules/fake-indexeddb/build/cjs/lib/scheduling.js, the
    // jsdom-detection branch ~lines 17-24): when it detects a jsdom
    // navigator.userAgent, it deliberately fetches `setImmediate` from the
    // OUTER, unsandboxed realm (`new Node.constructor("return
    // setImmediate")()`) specifically to escape jsdom's sandboxing — which
    // means it's structurally unreachable by whatever vitest's fake clock
    // monkey-patches onto the test-visible global. No fake-timer technique
    // closes this (tried vi.runOnlyPendingTimersAsync() and extra
    // Promise.resolve() flushes too). A real, bounded wall-clock wait is a
    // strictly weaker proof in principle (see sibling files' equivalent
    // tests, which never touch IndexedDB), but is the one that's actually
    // correct here rather than a flaky hang.
    const root = document.createElement('div');
    document.body.appendChild(root);

    let eventsCallCount = 0;
    let resolveGatedEvents;
    const client = {
      rpc: () => Promise.resolve({ data: null, error: null }),
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
        const rowsFor =
          {
            ct_heats: [scoringHeat],
            ct_sets: oneSet,
            ct_heat_entries: oneEntry,
            event_entries: oneRosterEntry,
          }[table] ?? [];
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          single: () => Promise.resolve({ data: rowsFor[0] ?? null, error: null }),
          then: (resolve) => resolve({ data: rowsFor, error: null }),
        };
        return builder;
      },
    };

    const { unmount } = await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });
    const containerBeforeUnmount = root.querySelector('.screen-container');

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => expect(eventsCallCount).toBe(2));

    unmount();
    resolveGatedEvents();
    // A bounded real delay, not vi.waitFor — there's no eventual truthy
    // condition to wait for here (the whole point is that nothing should
    // change), just enough time for a broken generation guard to have
    // wrongly let the blocked render proceed, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(root.querySelector('.screen-container')).toBe(containerBeforeUnmount);

    document.body.removeChild(root);
  });

  it('a toggle tap while a confirm is in flight renders the grid locked, closing the narrow silent-tap-loss window found in review', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let resolveRpc;
    const rpcGate = new Promise((resolve) => {
      resolveRpc = resolve;
    });
    const client = fakeClient({
      tables: {
        events: { data: { id: 'ev1', org_id: 'org1', is_test: false }, error: null },
        // Stays 'scoring' for the whole test — the confirm is deliberately
        // never let through, only its in-flight window matters here.
        ct_heats: { data: scoringHeat, error: null },
        ct_sets: { data: oneSet, error: null },
        ct_heat_entries: { data: oneEntry, error: null },
        event_entries: { data: oneRosterEntry, error: null },
      },
      rpc: () => rpcGate.then(() => ({ data: null, error: null })),
    });
    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    root.querySelector('.btn-primary').click();
    // The confirm button's own disabling is synchronous (see its own
    // handler comment) — this doesn't yet prove the toggle grid is locked,
    // only that the click landed and confirmInFlight is now true.
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(true);
    });

    // The toggle grid itself hasn't re-rendered yet at this point (the
    // confirm handler only renders once, at the very end) — a tap landing
    // here still registers (onToggle runs synchronously, unconditionally),
    // but the render IT triggers must come back locked, since the confirm
    // is still in flight when that render happens.
    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.scoring-toggle').disabled).toBe(true);
    });
    expect(root.querySelector('.scoring-toggle').dataset.readonly).toBeUndefined();

    resolveRpc();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    // The in-flight tap wasn't just rendered locked — it actually mutated
    // the draft (onToggle runs synchronously before any lock check exists).
    // The first tap (before Confirm) cycled s1 null -> true; this second
    // tap, taken during the locked window, cycled it true -> false. Without
    // this assertion, a broken `onToggle` that silently no-opped while
    // locked would still pass every assertion above it.
    expect(root.querySelector('.scoring-toggle').dataset.tone).toBe('wrong');

    document.body.removeChild(root);
  });

  it('shows a hedged "could not confirm" message, not a definite failure, when the post-confirm ground-truth re-fetch itself fails', async () => {
    // Found in review (offline-sync-auditor, round 2): a connection drop
    // between the RPC ack and this specific re-fetch must not be reported
    // to the organiser as a definite failure — submitConfirmHeat may have
    // already succeeded server-side, and the very next render's own
    // loadState() re-fetch will self-correct to "Heat confirmed" on its
    // own if it did.
    const root = document.createElement('div');
    document.body.appendChild(root);

    let heatCallCount = 0;
    const client = {
      rpc: () => Promise.resolve({ data: null, error: null }),
      from(table) {
        if (table === 'ct_heats') {
          heatCallCount += 1;
          // Calls 1 and 2 are the initial load and the re-render after the
          // scoring tap — both must succeed normally. Call 3 is the confirm
          // handler's own ground-truth re-fetch — that's the one that fails.
          const failThisCall = heatCallCount === 3;
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve(
                    failThisCall
                      ? { data: null, error: new Error('connection dropped') }
                      : { data: scoringHeat, error: null },
                  ),
              }),
            }),
          };
        }
        const rowsFor =
          {
            events: [{ id: 'ev1', org_id: 'org1', is_test: false }],
            ct_sets: oneSet,
            ct_heat_entries: oneEntry,
            event_entries: oneRosterEntry,
          }[table] ?? [];
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          order: () => builder,
          single: () => Promise.resolve({ data: rowsFor[0] ?? null, error: null }),
          then: (resolve) => resolve({ data: rowsFor, error: null }),
        };
        return builder;
      },
    };

    await mountScoringScreen(root, { eventId: 'ev1', heatId: 'h1', client });

    root.querySelector('.scoring-toggle').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.btn-primary').disabled).toBe(false);
    });

    root.querySelector('.btn-primary').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
    });

    expect(root.querySelector('.screen-feedback').textContent).toContain(
      'Could not confirm whether this went through',
    );
    // Deliberately NOT the P0002 conflict message or a generic error —
    // this is a distinct, hedged outcome from either of those.
    expect(root.querySelector('.screen-feedback').textContent).not.toContain('changed elsewhere');

    document.body.removeChild(root);
  });
});
