import { describe, it, expect, vi } from 'vitest';
import {
  defaultHasContent,
  renderHoldingState,
  renderChrome,
  mountViewerShell,
} from './viewer-shell.js';

// A minimal fake covering both the table-query shape (from/select/eq/
// maybeSingle) and the realtime shape (channel/on/subscribe/removeChannel).
// Test helpers (`_triggerChange`/`_triggerStatus`) let a test simulate a
// postgres_changes event or a channel status change directly, without a
// real websocket. `_triggerChange` accepts an optional (deliberately
// unused-by-the-real-handler) payload arg so a test can prove the shell
// truly ignores it and re-reads, rather than trusting it.
//
// `events` defaults to ONE row for org1 — so every pre-existing test here
// (written before the events lookup existed, none of them about the
// noEvent/notStarted distinction) keeps seeing 'notStarted' exactly as
// before. Tests that DO care about the distinction pass `events: []`
// explicitly.
function fakeClient(
  initialRows = [],
  { failNextRead = false, readDelayMs = 0, events = [{ id: 'ev1', org_id: 'org1' }] } = {},
) {
  const db = { live_sessions: [...initialRows], events: [...events] };
  let changeHandler = null;
  let statusHandler = null;
  let removedChannel = null;
  const channelObj = {};
  let shouldFail = failNextRead;
  let delay = readDelayMs;
  let shouldFailEvents = false;
  let eventsDelay = 0;

  function matchesFilters(row, filters) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function makeBuilder(table) {
    const filters = [];
    const builder = {
      select: () => builder,
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle() {
        if (table === 'events') {
          const rows = db.events.filter((r) => matchesFilters(r, filters));
          const snapshot = rows[0] ? { ...rows[0] } : null;
          const willFail = shouldFailEvents;
          if (shouldFailEvents) shouldFailEvents = false;
          const resolveResult = () =>
            willFail
              ? { data: null, error: new Error('events read failed') }
              : { data: snapshot, error: null };
          if (eventsDelay > 0) {
            return new Promise((resolve) =>
              setTimeout(() => resolve(resolveResult()), eventsDelay),
            );
          }
          return Promise.resolve(resolveResult());
        }
        // Snapshot the matching row AND the fail flag synchronously, at
        // CALL time — not after the delay, at resolution time. A real
        // query reflects the database as of when it was issued, not
        // whenever it happens to finish. Resolving from a snapshot taken
        // at resolution time instead (found in round-2 review, verified
        // empirically by disabling viewer-shell.js's own sequence guard
        // and watching every test still pass) meant a "slow" call and a
        // later "fast" call — even issued against genuinely different
        // data — would both end up reading whatever the db looked like at
        // THEIR OWN resolution time, silently defeating any test trying
        // to prove a slow-issued-first/fast-issued-second race.
        // A shallow COPY, not a reference into db.live_sessions — `rows[0]`
        // is the live object; without copying it here, a later in-place
        // mutation (`db.live_sessions[0].payload = ...`, the exact pattern
        // several tests use) would retroactively change what this already-
        // captured "snapshot" sees too, defeating the whole point of
        // snapshotting at call time rather than resolution time (this was
        // the actual reason the round-2-flagged race test kept passing
        // even with viewer-shell.js's own sequence guard disabled —
        // confirmed by adding temporary diagnostic logging and watching a
        // "captured at call time" snapshot's payload change after the
        // mutating line ran, before the delayed promise ever resolved).
        const rows = db.live_sessions.filter((r) => matchesFilters(r, filters));
        const snapshot = rows[0] ? { ...rows[0] } : null;
        const willFail = shouldFail;
        if (shouldFail) shouldFail = false;
        const resolveResult = () =>
          willFail
            ? { data: null, error: new Error('network unreachable') }
            : { data: snapshot, error: null };
        if (delay > 0) {
          return new Promise((resolve) => setTimeout(() => resolve(resolveResult()), delay));
        }
        return Promise.resolve(resolveResult());
      },
    };
    return builder;
  }

  Object.assign(channelObj, {
    on(_event, _filter, handler) {
      changeHandler = handler;
      return channelObj;
    },
    subscribe(cb) {
      statusHandler = cb;
      Promise.resolve().then(() => cb('SUBSCRIBED'));
      return channelObj;
    },
  });

  return {
    db,
    from: (table) => makeBuilder(table),
    channel: () => channelObj,
    removeChannel: (ch) => {
      removedChannel = ch;
    },
    _channelObj: channelObj,
    _triggerChange: (fakePayload) => changeHandler?.(fakePayload),
    _triggerStatus: (status) => statusHandler?.(status),
    _wasRemoved: () => removedChannel === channelObj,
    _failNextRead: () => {
      shouldFail = true;
    },
    _setReadDelay: (ms) => {
      delay = ms;
    },
    _failNextEventsRead: () => {
      shouldFailEvents = true;
    },
    _setEventsReadDelay: (ms) => {
      eventsDelay = ms;
    },
    _isSubscribed: () => statusHandler != null,
  };
}

function session(overrides = {}) {
  return {
    id: 's1',
    org_id: 'org1',
    event_id: 'ev1',
    format: 'cup_taster',
    active: true,
    is_test: false,
    payload: { standings: [1] },
    ...overrides,
  };
}

describe('defaultHasContent', () => {
  it('is false for null/undefined', () => {
    expect(defaultHasContent(null)).toBe(false);
    expect(defaultHasContent(undefined)).toBe(false);
  });

  it('is false for an empty object', () => {
    expect(defaultHasContent({})).toBe(false);
  });

  it('is true for a non-empty object', () => {
    expect(defaultHasContent({ standings: [] })).toBe(true);
  });
});

describe('renderHoldingState', () => {
  it.each([
    ['connecting', 'Connecting…'],
    ['noEvent', 'No event scheduled'],
    ['notStarted', 'Waiting for the organiser'],
    ['pending', 'Event not published yet'],
    ['lost', 'Connection lost'],
  ])('renders the phase-specific title for "%s"', (phase, expectedTitle) => {
    const node = renderHoldingState(phase);
    expect(node.className).toBe('viewer-holding-card');
    // Pinned to the exact expected copy per phase, not just "some text" —
    // a bug that swapped two phases' cards would otherwise still pass.
    expect(node.querySelector('.viewer-holding-title').textContent).toBe(expectedTitle);
    expect(node.querySelector('.viewer-holding-body').textContent.length).toBeGreaterThan(0);
  });

  it('throws on an unknown phase', () => {
    expect(() => renderHoldingState('bogus')).toThrow('unknown phase');
  });
});

describe('renderChrome', () => {
  it('shows a Live badge with the pulse dot when the session is active', () => {
    const node = renderChrome(session({ active: true }));
    expect(node.querySelector('.viewer-badge-live')).not.toBeNull();
    expect(node.querySelector('.status-live-dot')).not.toBeNull();
    expect(node.textContent).toContain('Live');
  });

  it('shows a Not live badge when the session is inactive', () => {
    const node = renderChrome(session({ active: false }));
    expect(node.querySelector('.viewer-badge-done')).not.toBeNull();
    expect(node.textContent).toContain('Not live');
  });

  it('shows a neutral Reconnecting badge when connectionLost, overriding an otherwise-active session', () => {
    // Not "Live" — the event may still be live even though THIS viewer's
    // own connection dropped; showing stale "Live" next to a
    // "Connection lost" body would read as contradictory (found in review).
    const node = renderChrome(session({ active: true }), true);
    expect(node.querySelector('.viewer-badge-live')).toBeNull();
    expect(node.querySelector('.viewer-badge-lost')).not.toBeNull();
    expect(node.textContent).toContain('Reconnecting');
  });

  it('always shows the generic app name, never the raw format slug', () => {
    // live_sessions has no denormalized human-readable event name — only
    // `format` (e.g. "cup_taster") and event_id. Showing the raw slug as
    // if it were a title would be a permanent placeholder masquerading as
    // finished UI (found in review).
    const node = renderChrome(session({ format: 'cup_taster' }));
    expect(node.querySelector('.viewer-chrome-name').textContent).toBe('Seduh Score');
  });

  it('shows the generic name with no session at all too', () => {
    const node = renderChrome(null);
    expect(node.querySelector('.viewer-chrome-name').textContent).toBe('Seduh Score');
  });
});

describe('mountViewerShell', () => {
  it('throws if showChrome is omitted', async () => {
    const root = document.createElement('div');
    await expect(
      mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), client: fakeClient([]) }),
    ).rejects.toThrow('showChrome must be explicitly true or false');
  });

  it('throws if showChrome is a non-boolean truthy value, not just when omitted', async () => {
    const root = document.createElement('div');
    await expect(
      mountViewerShell(root, {
        orgId: 'org1',
        renderBody: vi.fn(),
        showChrome: 'true',
        client: fakeClient([]),
      }),
    ).rejects.toThrow('showChrome must be explicitly true or false');
  });

  it('renders the "waiting for the organiser" holding state when no session is active', async () => {
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([]),
    });
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('renders "no event scheduled" instead, when the org has no event at all yet', async () => {
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([], { events: [] }),
    });
    expect(root.textContent).toContain('No event scheduled');
    expect(root.textContent).not.toContain('Waiting for the organiser');
  });

  it('checks for an existing event only ONCE it needs to know, and re-uses that answer afterward', async () => {
    const root = document.createElement('div');
    const client = fakeClient([], { events: [] });
    const eventsBuilderCalls = [];
    const realFrom = client.from;
    client.from = (table) => {
      if (table === 'events') eventsBuilderCalls.push(1);
      return realFrom(table);
    };
    await mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), showChrome: false, client });
    expect(eventsBuilderCalls).toHaveLength(1);

    // Still no session, still no event — a later refresh checks again,
    // since the answer isn't known to be "yes" yet.
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventsBuilderCalls).toHaveLength(2);

    // Once an event exists, hasEvent latches true and is never re-checked.
    client.db.events.push({ id: 'ev1', org_id: 'org1' });
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Waiting for the organiser');

    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventsBuilderCalls).toHaveLength(3); // the one that found the event, not a 4th
  });

  it('a live_sessions row latches hasEvent via the session branch alone (no events query), and the latch survives the session disappearing again', async () => {
    const root = document.createElement('div');
    const client = fakeClient([], { events: [] });
    const eventsBuilderCalls = [];
    const realFrom = client.from;
    client.from = (table) => {
      if (table === 'events') eventsBuilderCalls.push(1);
      return realFrom(table);
    };
    await mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), showChrome: false, client });
    expect(root.textContent).toContain('No event scheduled');
    expect(eventsBuilderCalls).toHaveLength(1);

    // A live_sessions row appears — hasEvent latches via the `if (session)`
    // branch, never touching the events table.
    client.db.live_sessions.push(session({ payload: {} }));
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(eventsBuilderCalls).toHaveLength(1); // unchanged

    // The session disappears again (organiser un-published) — hasEvent
    // stays latched true, so this reverts to 'notStarted', NOT back to
    // 'noEvent', and still without an events query.
    client.db.live_sessions.length = 0;
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Waiting for the organiser');
    expect(root.textContent).not.toContain('No event scheduled');
    expect(eventsBuilderCalls).toHaveLength(1);
  });

  it('a transient failure checking for an event tries again next refresh, rather than caching a false negative forever', async () => {
    const root = document.createElement('div');
    const client = fakeClient([], { events: [{ id: 'ev1', org_id: 'org1' }] });
    client._failNextEventsRead();
    await mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), showChrome: false, client });
    // The failed check leaves hasEvent at its starting value (false) —
    // shows the more generic card rather than throwing or getting stuck.
    expect(root.textContent).toContain('No event scheduled');

    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Waiting for the organiser');
  });

  it('times out a hung event-existence check at its own SHORTER bound, not the primary 10s one', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      const client = {
        from: (table) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    table === 'events'
                      ? new Promise(() => {})
                      : Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        channel: () => ({
          on: () => ({ subscribe: () => {} }),
          subscribe() {
            return this;
          },
        }),
        removeChannel: () => {},
      };
      const mountPromise = mountViewerShell(root, {
        orgId: 'org1',
        renderBody: vi.fn(),
        showChrome: false,
        client,
      });
      // 4000ms, not 10000 — the events check's own shorter timeout. If this
      // were still racing against the primary 10s bound, the viewer would
      // still be on 'Connecting…' at this point.
      await vi.advanceTimersByTimeAsync(4000);
      await mountPromise;
      // Fails toward the more generic card, not stuck forever on 'Connecting…'.
      expect(root.textContent).toContain('No event scheduled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the combined worst-case wait (slow live_sessions read, then a hung events check) stays well under double the primary bound', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      const client = {
        from: (table) => ({
          select: () => ({
            eq: () => ({
              // live_sessions itself resolves, but only after 9s — close to
              // its own 10s bound without tripping it.
              eq: () => ({
                maybeSingle: () =>
                  new Promise((resolve) =>
                    setTimeout(() => resolve({ data: null, error: null }), 9000),
                  ),
              }),
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    table === 'events'
                      ? new Promise(() => {})
                      : Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        channel: () => ({
          on: () => ({ subscribe: () => {} }),
          subscribe() {
            return this;
          },
        }),
        removeChannel: () => {},
      };
      const mountPromise = mountViewerShell(root, {
        orgId: 'org1',
        renderBody: vi.fn(),
        showChrome: false,
        client,
      });
      // 9s (live_sessions resolves) + 4s (events check's own shorter
      // timeout) = 13s total — comfortably under a NAIVE double-10s (20s)
      // worst case, proving EVENT_CHECK_TIMEOUT_MS actually bounds the
      // compounded wait rather than silently doubling it.
      await vi.advanceTimersByTimeAsync(13000);
      await mountPromise;
      expect(root.textContent).toContain('No event scheduled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the "not published yet" holding state for an active session with no content', async () => {
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([session({ payload: {} })]),
    });
    expect(root.textContent).toContain('Event not published yet');
  });

  it('mounts the format body with the payload once real content exists', async () => {
    const renderBody = vi.fn();
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody,
      showChrome: false,
      client: fakeClient([session({ payload: { standings: [{ name: 'A' }] } })]),
    });
    expect(renderBody).toHaveBeenCalledTimes(1);
    const [container, payload, meta] = renderBody.mock.calls[0];
    expect(container.className).toBe('viewer-shell-body');
    expect(payload).toEqual({ standings: [{ name: 'A' }] });
    expect(meta).toEqual({ isTest: false });
  });

  it('renders the is_test banner (as role="alert") once a session with is_test=true is loaded', async () => {
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([session({ is_test: true, payload: { a: 1 } })]),
    });
    const banner = root.querySelector('.is-test-banner');
    expect(banner?.textContent).toBe('Test Data — Not a Live Event');
    expect(banner?.getAttribute('role')).toBe('alert');
  });

  it('omits the is_test banner when there is no active session yet', async () => {
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([]),
    });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('omits the is_test banner for a real, loaded, non-test session', async () => {
    // The positive case (is_test: true shows it) and the no-session case
    // (nothing to show yet) don't by themselves prove the ordinary "real
    // live content, is_test: false" case correctly shows nothing either.
    const root = document.createElement('div');
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([session({ is_test: false, payload: { a: 1 } })]),
    });
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('renders chrome only when showChrome is true', async () => {
    const rootWith = document.createElement('div');
    await mountViewerShell(rootWith, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: true,
      client: fakeClient([session()]),
    });
    expect(rootWith.querySelector('.viewer-chrome')).not.toBeNull();

    const rootWithout = document.createElement('div');
    await mountViewerShell(rootWithout, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: fakeClient([session()]),
    });
    expect(rootWithout.querySelector('.viewer-chrome')).toBeNull();
  });

  it('the status region is a persistent node mutated in place, not recreated, across renders', async () => {
    // The whole point of the persistent-node restructure (found in review:
    // a full innerHTML rebuild defeats aria-live change detection for
    // screen readers) — proves the SAME element reference carries
    // role="status" before and after a state transition, rather than a
    // fresh node with the same attributes.
    const root = document.createElement('div');
    const client = fakeClient([]);
    await mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), showChrome: false, client });
    const statusNodeBefore = root.querySelector('[role="status"]');
    expect(statusNodeBefore).not.toBeNull();

    client.db.live_sessions.push(session({ payload: { a: 1 } }));
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusNodeAfter = root.querySelector('[role="status"]');
    expect(statusNodeAfter).toBe(statusNodeBefore);
  });

  it('does not recreate the is_test banner on an unrelated re-render, so it is not re-announced for no reason', async () => {
    // role="alert" announces on INSERTION — recreating the same banner on
    // every unrelated refresh (a standings update, a republish with the
    // same is_test value) would re-announce it repeatedly, which is
    // verbose/disorienting for a screen-reader user watching a long
    // is_test event (found in round-2 review).
    const root = document.createElement('div');
    const client = fakeClient([session({ is_test: true, payload: { a: 1 } })]);
    await mountViewerShell(root, { orgId: 'org1', renderBody: vi.fn(), showChrome: false, client });
    const bannerBefore = root.querySelector('.is-test-banner');
    expect(bannerBefore).not.toBeNull();

    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bannerAfter = root.querySelector('.is-test-banner');
    expect(bannerAfter).toBe(bannerBefore);
  });

  it("re-fetches and re-renders using the CURRENT database state, not the change event's own payload", async () => {
    const renderBody = vi.fn();
    const root = document.createElement('div');
    const client = fakeClient([]);
    await mountViewerShell(root, { orgId: 'org1', renderBody, showChrome: false, client });

    expect(root.textContent).toContain('Waiting for the organiser');

    client.db.live_sessions.push(session({ payload: { standings: [1] } }));
    // Deliberately wrong payload attached to the event itself — proves the
    // shell truly ignores it and re-reads, rather than trusting the delta
    // (the real handler takes no argument at all; this fake accepts one
    // anyway so the test can make that guarantee explicit).
    client._triggerChange({ new: { payload: { standings: ['WRONG'] } } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(renderBody).toHaveBeenCalledTimes(1);
    expect(renderBody.mock.calls[0][1]).toEqual({ standings: [1] });
  });

  it('subscribes before the initial read completes, so a change during that window is not missed', async () => {
    // The exact race found in review: subscribing only AFTER awaiting the
    // first read leaves a real gap (a full request/response round trip)
    // during which a change could land and never be observed. Simulated
    // here with an artificially slow initial read, with a change arriving
    // WHILE it's still in flight.
    const renderBody = vi.fn();
    const root = document.createElement('div');
    const client = fakeClient([], { readDelayMs: 20 });
    const mountPromise = mountViewerShell(root, {
      orgId: 'org1',
      renderBody,
      showChrome: false,
      client,
    });

    // The channel must already be subscribed before the slow initial read
    // resolves — prove the subscription exists mid-flight.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(client._isSubscribed()).toBe(true);

    client.db.live_sessions.push(session({ payload: { standings: [1] } }));
    client._triggerChange();

    await mountPromise;
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(renderBody).toHaveBeenCalled();
    expect(renderBody.mock.calls.at(-1)[1]).toEqual({ standings: [1] });
  });

  it('discards a slower-resolving earlier refresh in favor of a faster-resolving later one', async () => {
    // Two refreshes in flight at once, resolving out of order — the
    // monotonic sequence guard must keep whichever was ISSUED last, not
    // whichever RESOLVED last by accident of timing. Fake timers, not real
    // 0ms/30ms setTimeout delays — found in round-2 review: real timers at
    // that granularity are too imprecise in a test environment to
    // reliably reproduce the out-of-order resolution this test depends
    // on, which let it pass even with the guard fully disabled.
    vi.useFakeTimers();
    try {
      const renderBody = vi.fn();
      const root = document.createElement('div');
      const client = fakeClient([session({ payload: { a: 'first' } })]);
      const mountPromise = mountViewerShell(root, {
        orgId: 'org1',
        renderBody,
        showChrome: false,
        client,
      });
      await vi.advanceTimersByTimeAsync(0);
      await mountPromise;

      client._setReadDelay(30);
      client._triggerChange(); // issues refresh #1 (slow), for {a: 'first'}

      client.db.live_sessions[0].payload = { a: 'second' };
      client._setReadDelay(0);
      client._triggerChange(); // issues refresh #2 (fast), for {a: 'second'}

      // The fast (0ms) call resolves first — real content, correctly.
      await vi.advanceTimersByTimeAsync(0);
      expect(renderBody.mock.calls.at(-1)[1]).toEqual({ a: 'second' });

      // The slow (30ms) call resolves after — must NOT override it with
      // its own stale snapshot.
      await vi.advanceTimersByTimeAsync(30);
      expect(renderBody.mock.calls.at(-1)[1]).toEqual({ a: 'second' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the connection-lost state on a channel error, replacing real content that was showing', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (container) => {
        container.textContent = 'STANDINGS HERE';
      },
      showChrome: false,
      client,
    });
    expect(root.textContent).toContain('STANDINGS HERE');
    expect(root.textContent).not.toContain('Connection lost');

    client._triggerStatus('CHANNEL_ERROR');
    expect(root.textContent).toContain('Connection lost');
    expect(root.textContent).not.toContain('STANDINGS HERE');
  });

  it('clears the connection-lost state and re-reads fresh data once the channel reconnects', async () => {
    const renderBody = vi.fn();
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    await mountViewerShell(root, { orgId: 'org1', renderBody, showChrome: false, client });

    client._triggerStatus('CHANNEL_ERROR');
    expect(root.textContent).toContain('Connection lost');

    // Data changes while disconnected — a synchronous "just clear the flag
    // and repaint from cached state" implementation could not reflect
    // this; only a genuine new read can.
    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerStatus('SUBSCRIBED');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).not.toContain('Connection lost');
    expect(renderBody).toHaveBeenCalledTimes(2);
    expect(renderBody.mock.calls[1][1]).toEqual({ a: 2 });
  });

  it('treats a read failure the same as a lost connection, not a distinct error UI', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client,
    });

    client._failNextRead();
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('Connection lost');
  });

  it('recovers from a read-failure-triggered lost state on the NEXT successful read, without needing a channel reconnect', async () => {
    // A real bug from an earlier fix pass, caught in round-2 review:
    // connectionLost was only ever cleared by the channel's own SUBSCRIBED
    // handler. A lost state entered via a query error/timeout (not a
    // channel drop) would then never clear if the channel itself stayed
    // subscribed throughout — every later successful refresh() would keep
    // updating `session` in memory while the UI stayed stuck on
    // "Connection lost" forever. This proves recovery via a PLAIN
    // successful refresh, with no SUBSCRIBED event anywhere in the
    // sequence.
    const renderBody = vi.fn();
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    await mountViewerShell(root, { orgId: 'org1', renderBody, showChrome: false, client });

    client._failNextRead();
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Connection lost');

    // No _triggerStatus('SUBSCRIBED') anywhere here — recovery must come
    // from the read itself succeeding.
    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).not.toContain('Connection lost');
    expect(renderBody.mock.calls.at(-1)[1]).toEqual({ a: 2 });
  });

  it('times out a hung read rather than leaving the viewer on "Connecting…" forever', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      // Never resolves on its own — only the internal timeout race settles it.
      const client = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => new Promise(() => {}),
              }),
            }),
          }),
        }),
        channel: () => ({
          on: () => ({ subscribe: () => {} }),
          subscribe() {
            return this;
          },
        }),
        removeChannel: () => {},
      };
      const mountPromise = mountViewerShell(root, {
        orgId: 'org1',
        renderBody: vi.fn(),
        showChrome: false,
        client,
      });
      await vi.advanceTimersByTimeAsync(10000);
      await mountPromise;
      expect(root.textContent).toContain('Connection lost');
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls a renderBody-returned cleanup before the next re-render', async () => {
    const root = document.createElement('div');
    const cleanup = vi.fn();
    const renderBody = vi.fn(() => cleanup);
    const client = fakeClient([session({ payload: { a: 1 } })]);
    await mountViewerShell(root, { orgId: 'org1', renderBody, showChrome: false, client });
    expect(renderBody).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();

    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(renderBody).toHaveBeenCalledTimes(2);
  });

  it('calls the cleanup BEFORE the body is wiped for the next render, not after', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    // The cleanup closes over `container` (the same node renderBody itself
    // received) and records its own child count at the moment it runs — the
    // only way to observe from outside whether the old content was still
    // there when cleanup fired, or already gone.
    const observedChildCounts = [];
    const renderBody = vi.fn((container) => {
      container.appendChild(document.createElement('span'));
      return () => observedChildCounts.push(container.childNodes.length);
    });
    await mountViewerShell(root, { orgId: 'org1', renderBody, showChrome: false, client });

    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1, not 0 — the old <span> was still there when cleanup ran, proving
    // cleanup fires before body.replaceChildren() wipes it, not after.
    expect(observedChildCounts).toEqual([1]);
  });

  it('calls a renderBody-returned cleanup on unmount', async () => {
    const root = document.createElement('div');
    const cleanup = vi.fn();
    const { unmount } = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: () => cleanup,
      showChrome: false,
      client: fakeClient([session({ payload: { a: 1 } })]),
    });
    expect(cleanup).not.toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('calls the cleanup BEFORE the root is wiped on unmount, not after', async () => {
    const root = document.createElement('div');
    let rootHtmlAtCleanupTime = null;
    const { unmount } = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (container) => {
        container.appendChild(document.createElement('span'));
        return () => {
          rootHtmlAtCleanupTime = root.innerHTML;
        };
      },
      showChrome: false,
      client: fakeClient([session({ payload: { a: 1 } })]),
    });
    unmount();
    // Non-empty — the full mounted tree was still there when cleanup ran,
    // proving cleanup fires before root.innerHTML = '' wipes it, not after.
    expect(rootHtmlAtCleanupTime).not.toBe('');
    expect(rootHtmlAtCleanupTime).toContain('<span>');
  });

  it('tolerates a renderBody that returns nothing (no cleanup needed)', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    const { unmount } = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client,
    });
    client.db.live_sessions[0].payload = { a: 2 };
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => unmount()).not.toThrow();
  });

  it('unmount removes the realtime channel and clears the root', async () => {
    const root = document.createElement('div');
    const client = fakeClient([session({ payload: { a: 1 } })]);
    const { unmount } = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (container) => {
        container.textContent = 'STANDINGS HERE';
      },
      showChrome: false,
      client,
    });
    expect(root.textContent.length).toBeGreaterThan(0);
    unmount();
    expect(client._wasRemoved()).toBe(true);
    expect(root.innerHTML).toBe('');
  });

  it('a change event that arrives after unmount does not throw or repaint a stale root', async () => {
    const root = document.createElement('div');
    const client = fakeClient([]);
    const { unmount } = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client,
    });
    unmount();
    root.textContent = 'untouched';
    client._triggerChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toBe('untouched');
  });
});
