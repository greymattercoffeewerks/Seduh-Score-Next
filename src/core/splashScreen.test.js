import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSplashScreen } from './splashScreen.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

// Table-based fake client, mirroring eventDashboardScreen.test.js's own
// minimal shape — `.limit()` added since findLatestEventForOrg's own query
// chains through it (`events.js`'s `.order(...).limit(1).maybeSingle()`),
// which that file's own fake never needed.
function fakeClient({ tables = {} } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  return {
    from(table) {
      const queue = queues[table] ?? [{ data: null, error: null }];
      const resolve = () => (queue.length > 1 ? queue.shift() : queue[0]);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
      };
      return builder;
    },
  };
}

// Awaits one microtask turn so the fire-and-forget event-load promise chain
// in mountSplashScreen (never awaited by the caller — the branded shell
// renders synchronously and the event line fills in later) has a chance to
// settle before assertions run.
async function settle() {
  // A macrotask tick, not a fixed count of microtask hops — the fire-and-
  // forget event-load chain (loadEvent -> raceTimeout -> findLatestEventForOrg
  // -> the fake client's own builder) is several promises deep, and a
  // setTimeout callback only runs once the entire current microtask queue
  // has drained, so this settles reliably regardless of exactly how many
  // hops are in between. Same technique as main.test.js's own
  // settleHashDispatch.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mountSplashScreen', () => {
  it('renders the branded shell immediately, with the generic badge and no event line, when there is no event yet', async () => {
    const root = document.createElement('div');
    const client = fakeClient({ tables: { events: { data: null, error: null } } });

    mountSplashScreen(root, { orgId: 'org1', client });

    expect(root.querySelector('.splash-wordmark').textContent).toBe('Seduh Score');
    expect(root.querySelector('.splash-eventline').textContent).toBe('');
    expect(root.querySelector('.splash-badge-generic')).not.toBeNull();
    expect(root.querySelector('.splash-badge-live')).toBeNull();
    expect(root.querySelector('.is-test-banner')).toBeNull();

    await settle();

    // Still the generic state — "no event yet" resolves cleanly, it isn't
    // a pending/loading state that later needs to change.
    expect(root.querySelector('.splash-badge-generic')).not.toBeNull();
    expect(root.querySelector('.splash-eventline').textContent).toBe('');
  });

  it('fills in the event name and date, and swaps to the live badge, once a real non-test event resolves', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: {
          data: { id: 'ev1', name: 'Jakarta Cupping Championship', event_date: '2026-03-14', is_test: false },
          error: null,
        },
      },
    });

    mountSplashScreen(root, { orgId: 'org1', client });
    await settle();

    expect(root.querySelector('.splash-eventline').textContent).toBe('Jakarta Cupping Championship');
    expect(root.querySelector('.splash-subline').textContent).toBe('2026-03-14');
    expect(root.querySelector('.splash-badge-live')).not.toBeNull();
    expect(root.querySelector('.splash-badge-generic')).toBeNull();
    expect(root.querySelector('.is-test-banner')).toBeNull();
  });

  it('renders the real shared is-test-banner, not a bespoke one, and hides the badge host, when the event is test data', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: {
        events: {
          data: { id: 'ev1', name: 'Dry Run', event_date: null, is_test: true },
          error: null,
        },
      },
    });

    mountSplashScreen(root, { orgId: 'org1', client });
    await settle();

    const banner = root.querySelector('.is-test-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toBe('Test Data — Not a Live Event');
    // Hidden, not removed — the badge's persistent inner nodes stay in the
    // DOM (mutated in place on a real live transition, never torn down and
    // replaced; see the accessibility fix in splashScreen.js), so the test
    // for the is_test state checks visibility, not absence.
    expect(root.querySelector('.splash-badge-host').hidden).toBe(true);
    expect(root.querySelector('.splash-badge-live')).toBeNull();
    // event_date was null — the subline stays empty, not "null" as text.
    expect(root.querySelector('.splash-subline').textContent).toBe('');
  });

  describe('a genuinely hung event load (neither resolves nor rejects)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('times out and stays on the brand-only state rather than hanging or throwing', async () => {
      function hungBuilder() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => new Promise(() => {}), // never settles
        };
        return builder;
      }
      const hungClient = { from: () => hungBuilder() };
      const root = document.createElement('div');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mountSplashScreen(root, { orgId: 'org1', client: hungClient });

      // Nothing to show yet, but the branded shell is already up — this
      // surface never blocks on the network the way a data-entry screen's
      // "Loading…" state does.
      expect(root.querySelector('.splash-badge-generic')).not.toBeNull();

      // Fake timers are active in this block, so the real-setTimeout-based
      // settle() above would never fire on its own — advancing fake time
      // (even by 0 once the real timeout has already fired) is what flushes
      // the rest of the promise chain here instead.
      await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(0);

      expect(root.querySelector('.splash-badge-generic')).not.toBeNull();
      expect(root.querySelector('.splash-eventline').textContent).toBe('');
      // Tied to the actual raceTimeout rejection shape (core/timeout.js's
      // own `err.timedOut = true`), not just "some console.error fired for
      // any reason" — found in review (test-auditor).
      expect(errorSpy).toHaveBeenCalledWith(
        'splashScreen: failed to load the current event',
        expect.objectContaining({ timedOut: true }),
      );

      errorSpy.mockRestore();
    });
  });

  it('a genuinely rejected event load (a real query error, not a hang) also stays on the brand-only state', async () => {
    const root = document.createElement('div');
    const client = fakeClient({
      tables: { events: { data: null, error: { message: 'connection refused' } } },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mountSplashScreen(root, { orgId: 'org1', client });
    await settle();

    // Distinct from the timeout test above (a hang) — this exercises
    // events.js's own `if (error) throw error` path reaching
    // mountSplashScreen's .catch via a genuine rejection, not
    // raceTimeout's own synthetic timeout — found missing in review
    // (test-auditor): the timeout test happens to hit the same .catch
    // block, but doesn't prove a real query-error path also reaches it.
    expect(root.querySelector('.splash-badge-generic')).not.toBeNull();
    expect(root.querySelector('.splash-eventline').textContent).toBe('');
    expect(errorSpy).toHaveBeenCalledWith(
      'splashScreen: failed to load the current event',
      expect.objectContaining({ message: 'connection refused' }),
    );

    errorSpy.mockRestore();
  });

  it('unmount() clears the DOM it mounted, since this route uses a SHARED outlet (bareRoot) other routes reuse', async () => {
    // Regression test for a real bug found in review (code-reviewer):
    // router.js documents an explicit contract for any route using an
    // `outlet` override (this one uses the same shared bareRoot
    // #/live/projector and #/live/phone use) — its unmount() must actually
    // clear the outlet, or navigating away to a DEFAULT-outlet route (which
    // never touches bareRoot again) leaves this screen's DOM orphaned there
    // for the rest of the session. A bare "never throws" assertion would
    // not have caught the original bug (the no-op unmount() didn't throw
    // either) — this checks the actual cleanup happened.
    const root = document.createElement('div');
    const client = fakeClient({ tables: { events: { data: null, error: null } } });

    const { unmount } = mountSplashScreen(root, { orgId: 'org1', client });
    await settle();
    expect(root.children.length).toBeGreaterThan(0);

    expect(() => unmount()).not.toThrow();
    expect(root.innerHTML).toBe('');
  });

  it('anchors the glow at a randomized position within the documented range, off the exact edges and off dead-center', () => {
    const root = document.createElement('div');
    const client = fakeClient({ tables: { events: { data: null, error: null } } });
    const randomSpy = vi.spyOn(Math, 'random');

    // Deterministic ends of the 0..1 range Math.random() can return, so the
    // resulting anchor is checked against the exact documented bounds
    // (mountSplashScreen's own comment: 22-78% / 26-68%) rather than just
    // "some value was set."
    randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0);
    mountSplashScreen(root, { orgId: 'org1', client });
    let drift = root.querySelector('.splash-glow-drift');
    expect(drift.style.left).toBe('22%');
    expect(drift.style.top).toBe('26%');

    randomSpy.mockReturnValueOnce(1).mockReturnValueOnce(1);
    mountSplashScreen(root, { orgId: 'org1', client });
    drift = root.querySelector('.splash-glow-drift');
    expect(drift.style.left).toBe('78%');
    expect(drift.style.top).toBe('68%');

    randomSpy.mockRestore();
  });
});
