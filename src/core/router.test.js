import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchRoute, createRouter } from './router.js';

describe('matchRoute', () => {
  const routes = [
    { pattern: '/events', name: 'events' },
    { pattern: '/events/:eventId', name: 'dashboard' },
    { pattern: '/events/:eventId/stages/:stageId/heats', name: 'heats' },
  ];

  it('matches a static route with no params', () => {
    const result = matchRoute(routes, '/events');
    expect(result.route.name).toBe('events');
    expect(result.params).toEqual({});
  });

  it('captures a single :param segment', () => {
    const result = matchRoute(routes, '/events/ev1');
    expect(result.route.name).toBe('dashboard');
    expect(result.params).toEqual({ eventId: 'ev1' });
  });

  it('captures multiple :param segments in one pattern', () => {
    const result = matchRoute(routes, '/events/ev1/stages/s1/heats');
    expect(result.route.name).toBe('heats');
    expect(result.params).toEqual({ eventId: 'ev1', stageId: 's1' });
  });

  it('decodes a URI-encoded param segment', () => {
    const result = matchRoute(routes, '/events/ev%201');
    expect(result.params).toEqual({ eventId: 'ev 1' });
  });

  it('returns null when segment count differs, even with a matching prefix', () => {
    expect(matchRoute(routes, '/events/ev1/stages')).toBeNull();
  });

  it('returns null when no pattern matches at all', () => {
    expect(matchRoute(routes, '/nope')).toBeNull();
  });

  it('returns null for the empty path against a non-empty route table', () => {
    expect(matchRoute(routes, '')).toBeNull();
  });

  it('the first matching route wins when a path could satisfy two patterns positionally', () => {
    // '/events/ev1' matches BOTH '/events/:eventId' and, hypothetically, a
    // same-shape static route earlier in the array — proves ordering, not
    // just "a" match.
    const ambiguous = [
      { pattern: '/events/:eventId', name: 'first' },
      { pattern: '/events/:eventId', name: 'second' },
    ];
    expect(matchRoute(ambiguous, '/events/ev1').route.name).toBe('first');
  });
});

describe('createRouter', () => {
  // Every test's router MUST be stopped — `start()` registers a real
  // `hashchange` listener on the shared jsdom `window`; leaving it
  // registered across tests lets an earlier test's stale closure fire on a
  // LATER test's own location.hash changes (see router.js's own `stop()`
  // comment for exactly this bug, caught while writing these tests).
  let activeRouter = null;

  function trackedRouter(opts) {
    activeRouter = createRouter(opts);
    return activeRouter;
  }

  beforeEach(() => {
    location.hash = '';
  });

  afterEach(async () => {
    await activeRouter?.stop?.();
    activeRouter = null;
    location.hash = '';
  });

  function makeScreen(name, calls) {
    return async (outlet, props) => {
      calls.push({ name, outlet, props });
      return { unmount: vi.fn() };
    };
  }

  it('mounts the matched route with params + the router-level client merged in', async () => {
    const calls = [];
    const client = { fake: true };
    const routes = [{ pattern: '/events/:eventId', mount: makeScreen('dashboard', calls) }];
    const router = trackedRouter({ routes, client });
    const outlet = document.createElement('div');

    location.hash = '#/events/ev1';
    await router.start(outlet);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('dashboard');
    expect(calls[0].outlet).toBe(outlet);
    expect(calls[0].props).toEqual({ eventId: 'ev1', client });
  });

  it('an empty hash on start resolves to fallbackPath without writing to location.hash', async () => {
    const calls = [];
    const routes = [{ pattern: '/events', mount: makeScreen('events', calls) }];
    const router = trackedRouter({ routes, client: {} });
    const outlet = document.createElement('div');

    await router.start(outlet, { fallbackPath: '/events' });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('events');
    expect(location.hash).toBe('');
  });

  it("navigating away calls the outgoing screen's unmount() before mounting the next one, and survives jsdom firing hashchange twice per assignment", async () => {
    // jsdom genuinely dispatches 'hashchange' TWICE for one `location.hash =
    // ...` assignment (confirmed via SessionHistory._fireEvents while
    // debugging this exact test — both dispatches are real, independent
    // listener invocations, not a bug in this file). A fresh unmount spy
    // PER mount() call (not one shared mock) is what lets this test tell
    // "the redundant, discarded resolve's own mount got cleaned up" apart
    // from "the real current screen got wrongly unmounted" — the actual
    // invariant this test cares about — since a single shared mock can't
    // distinguish which of two same-route mounts it was called for.
    const unmountA = vi.fn();
    const bUnmounts = [];
    const routes = [
      { pattern: '/a', mount: async () => ({ unmount: unmountA }) },
      {
        pattern: '/b',
        mount: async () => {
          const unmount = vi.fn();
          bUnmounts.push(unmount);
          return { unmount };
        },
      },
    ];
    const router = trackedRouter({ routes, client: {} });
    const outlet = document.createElement('div');

    // fallbackPath, not a pre-set location.hash — setting the hash before
    // start() attaches its listener risks a queued hashchange event firing
    // just after attachment (jsdom-specific timing), which start()'s own
    // fallback mechanism avoids entirely (matches the "empty hash on
    // start" test above).
    await router.start(outlet, { fallbackPath: '/a' });
    expect(unmountA).not.toHaveBeenCalled();

    router.navigate('/b');
    // hashchange fires asynchronously in jsdom's own event loop — resolve()
    // is triggered by the listener, not awaited directly by navigate().
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unmountA).toHaveBeenCalledTimes(1);
    // '/b' may have been mounted more than once (the jsdom double-fire
    // above) — the real invariant is that the LAST one mounted (the one
    // actually current) was never unmounted; any EARLIER ones are the
    // resolver's own discarded, stale results, which it's correct (and
    // required) for the router to have cleaned up.
    expect(bUnmounts.length).toBeGreaterThanOrEqual(1);
    const currentBUnmount = bUnmounts[bUnmounts.length - 1];
    expect(currentBUnmount).not.toHaveBeenCalled();
  });

  it('a screen that returns no unmount handle (still undefined) does not block the next navigation from mounting', async () => {
    const bCalls = [];
    const routes = [
      { pattern: '/a', mount: async () => undefined },
      { pattern: '/b', mount: makeScreen('b', bCalls) },
    ];
    const router = trackedRouter({ routes, client: {} });
    const outlet = document.createElement('div');

    await router.start(outlet, { fallbackPath: '/a' });
    // resolve() directly, not navigate()+an arbitrary setTimeout(0) — a
    // real assertion on the outcome, not just "nothing threw by the time
    // an unrelated timer fired" (that version passed even with a route
    // whose mount() never runs at all, per test-auditor's review).
    await router.resolve('/b');

    expect(bCalls).toHaveLength(1);
  });

  it("a slower-resolving navigation's mount does not clobber a faster, later one — the resolveSeq staleness guard's own reason to exist", async () => {
    // Genuinely different completion timing, not just different call
    // order — found in review: the original version of this test used two
    // mounts that both resolved synchronously, so the assertions held
    // identically whether or not core/router.js's `resolveSeq` staleness
    // guard existed at all (confirmed: deleting the guard left this file
    // fully green). Modeled on appShell.test.js's own
    // "a slower-resolving setNav call... does not clobber a faster, later
    // one" test, which proves the equivalent invariant for setNav()
    // correctly via a controllable delay.
    let resolveSlow;
    const slowUnmount = vi.fn();
    const fastUnmount = vi.fn();
    const routes = [
      {
        pattern: '/slow',
        mount: async () => {
          await new Promise((resolve) => {
            resolveSlow = resolve;
          });
          return { unmount: slowUnmount };
        },
      },
      { pattern: '/fast', mount: async () => ({ unmount: fastUnmount }) },
    ];
    const router = trackedRouter({ routes, client: {} });

    // Start navigating to /slow but don't await it — its own mount() is
    // deliberately stuck until resolveSlow() is called below.
    const slowResolved = router.resolve('/slow');
    // Before /slow's mount finishes, a second, faster navigation starts
    // and completes first — this is now the real current screen.
    await router.resolve('/fast');
    expect(fastUnmount).not.toHaveBeenCalled();

    // NOW let the stale /slow mount finally finish. Without the guard,
    // its resolve() would unmount the screen that's actually showing
    // (/fast) and overwrite `current` with its own, superseded result.
    resolveSlow();
    await slowResolved;

    expect(fastUnmount).not.toHaveBeenCalled();
    // The stale mount's OWN result is still correctly torn down — the
    // guard discards it, it doesn't leak it.
    expect(slowUnmount).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the new screen's own heading after navigation, since the outgoing screen's removal resets focus to <body> with no other signal", async () => {
    document.body.innerHTML = '';
    const routes = [
      {
        pattern: '/a',
        mount: async (outlet) => {
          outlet.innerHTML = '<h1>Screen A</h1>';
          return { unmount: vi.fn() };
        },
      },
      {
        pattern: '/b',
        mount: async (outlet) => {
          outlet.innerHTML = '<h1>Screen B</h1>';
          return { unmount: vi.fn() };
        },
      },
    ];
    const router = trackedRouter({ routes, client: {} });
    const outlet = document.createElement('div');
    document.body.appendChild(outlet);

    await router.start(outlet, { fallbackPath: '/a' });
    expect(document.activeElement).toBe(outlet.querySelector('h1'));
    expect(document.activeElement.textContent).toBe('Screen A');

    await router.resolve('/b');
    expect(document.activeElement.textContent).toBe('Screen B');
  });

  it('does not steal focus from a screen that already focused something itself (e.g. an error message)', async () => {
    document.body.innerHTML = '';
    const routes = [
      {
        pattern: '/a',
        mount: async (outlet) => {
          outlet.innerHTML = '<h1>Screen A</h1><div class="error" tabindex="-1">Failed</div>';
          outlet.querySelector('.error').focus();
          return { unmount: vi.fn() };
        },
      },
    ];
    const router = trackedRouter({ routes, client: {} });
    const outlet = document.createElement('div');
    document.body.appendChild(outlet);

    await router.start(outlet, { fallbackPath: '/a' });

    expect(document.activeElement.className).toBe('error');
  });

  it('an unmatched path falls through to notFoundMount', async () => {
    const notFound = vi.fn(async () => ({ unmount: vi.fn() }));
    const router = trackedRouter({ routes: [], client: {}, notFoundMount: notFound });
    const outlet = document.createElement('div');

    location.hash = '#/nowhere';
    await router.start(outlet);

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('onNavigate is called with the resolved route and params BEFORE the screen mounts', async () => {
    const order = [];
    const routes = [
      {
        pattern: '/events/:eventId',
        mount: async () => {
          order.push('mount');
          return { unmount: vi.fn() };
        },
        chrome: true,
      },
    ];
    const onNavigate = vi.fn((route, params) => {
      order.push('onNavigate');
      expect(route.chrome).toBe(true);
      expect(params).toEqual({ eventId: 'ev1' });
    });
    const router = trackedRouter({ routes, client: {}, onNavigate });
    const outlet = document.createElement('div');

    location.hash = '#/events/ev1';
    await router.start(outlet);

    expect(order).toEqual(['onNavigate', 'mount']);
  });

  it('a route with its own outlet override mounts there instead of the default outlet', async () => {
    const calls = [];
    const overrideOutlet = document.createElement('div');
    const routes = [
      { pattern: '/live/projector', mount: makeScreen('projector', calls), outlet: overrideOutlet },
    ];
    const router = trackedRouter({ routes, client: {} });
    const defaultOutlet = document.createElement('div');

    location.hash = '#/live/projector';
    await router.start(defaultOutlet);

    expect(calls[0].outlet).toBe(overrideOutlet);
    expect(calls[0].outlet).not.toBe(defaultOutlet);
  });
});
