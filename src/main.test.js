import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Every screen main.js wires in is replaced with a spy that renders a
// distinguishable marker and records the params it was mounted with — this
// file proves ROUTING (right screen, right params, right chrome, unmount
// ordering), not each screen's own behavior (already covered by that
// screen's own *.test.js). End-to-end proof that the real, unmocked screens
// agree with this wiring is tests/e2e/organiser-flow.spec.js's job.
const mountEventsScreen = vi.fn();
const mountEventDashboardScreen = vi.fn();
const mountSetupScreen = vi.fn();
const mountRosterScreen = vi.fn();
const mountReportScreen = vi.fn();
const mountHeatGenerationScreen = vi.fn();
const mountStandingsScreen = vi.fn();
const mountTimingRouteScreen = vi.fn();
const mountScoringScreen = vi.fn();
const mountProjectorSurface = vi.fn();
const mountPhoneSummary = vi.fn();
const mountSplashScreen = vi.fn();
const mountLoginScreen = vi.fn();

vi.mock('./core/eventsScreen.js', () => ({
  mountEventsScreen: (...args) => mountEventsScreen(...args),
}));
vi.mock('./formats/cup-taster/eventDashboardScreen.js', () => ({
  mountEventDashboardScreen: (...args) => mountEventDashboardScreen(...args),
}));
vi.mock('./formats/cup-taster/setupScreen.js', () => ({
  mountSetupScreen: (...args) => mountSetupScreen(...args),
}));
vi.mock('./formats/cup-taster/rosterScreen.js', () => ({
  mountRosterScreen: (...args) => mountRosterScreen(...args),
}));
vi.mock('./formats/cup-taster/reportScreen.js', () => ({
  mountReportScreen: (...args) => mountReportScreen(...args),
}));
vi.mock('./formats/cup-taster/heatsScreen.js', () => ({
  mountHeatGenerationScreen: (...args) => mountHeatGenerationScreen(...args),
}));
vi.mock('./formats/cup-taster/standingsScreen.js', () => ({
  mountStandingsScreen: (...args) => mountStandingsScreen(...args),
}));
vi.mock('./formats/cup-taster/timingRouteScreen.js', () => ({
  mountTimingRouteScreen: (...args) => mountTimingRouteScreen(...args),
}));
vi.mock('./formats/cup-taster/scoringScreen.js', () => ({
  mountScoringScreen: (...args) => mountScoringScreen(...args),
}));
vi.mock('./formats/cup-taster/projectorSurface.js', () => ({
  mountProjectorSurface: (...args) => mountProjectorSurface(...args),
}));
vi.mock('./formats/cup-taster/phoneSummary.js', () => ({
  mountPhoneSummary: (...args) => mountPhoneSummary(...args),
}));
vi.mock('./core/splashScreen.js', () => ({
  mountSplashScreen: (...args) => mountSplashScreen(...args),
}));
vi.mock('./core/loginScreen.js', () => ({
  mountLoginScreen: (...args) => mountLoginScreen(...args),
}));

const { mountApp } = await import('./main.js');

function stubScreen(mockFn, marker) {
  mockFn.mockImplementation(async (root) => {
    root.textContent = marker;
    return { unmount: vi.fn() };
  });
}

// Session is mutable via .setSession() — requireAuth() (main.js) and
// appShell.js's own onAuthStateChange subscription both read
// client.auth.getSession()/getUser() fresh each time, so a test can flip
// from unauthenticated to authenticated mid-test to prove the sign-in
// transition, without needing a second mountApp() call. Authenticated by
// default (a real session object) so every routing test written before
// the auth gate existed keeps testing routing, not auth, unchanged.
function fakeClient({ session = { user: { email: 'organiser@test.com' } } } = {}) {
  let currentSession = session;
  return {
    setSession(next) {
      currentSession = next;
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: currentSession } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
  };
}

let activeApp = null;
async function startApp(overrides = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = mountApp(root, { client: fakeClient(), orgId: 'org1', ...overrides });
  await app.ready;
  activeApp = app;
  return { root, app };
}

// jsdom queues its hashchange dispatch rather than firing it synchronously
// (per the HTML spec's own "queue a task to fire hashchange" wording) — a
// test with several navigations can leave more than one dispatch still
// pending after its own body finishes. core/router.test.js's own precedent
// resets location.hash in both beforeEach and afterEach for this same
// reason; this file goes one step further and settles the queue (two
// macrotask ticks — matches the documented jsdom double-fire-per-assignment
// quirk elsewhere in this codebase) BEFORE tearing the router down, not
// after — found the hard way: resetting the hash only in afterEach, after
// unmount() had already removed the listener, let a backlog of several
// tests' worth of stale dispatches accumulate and fire against whichever
// LATER test's router happened to be listening when jsdom finally got
// around to them, corrupting that later test's own state.
async function settleHashDispatch() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  location.hash = '';
  await settleHashDispatch();
});

afterEach(async () => {
  location.hash = '';
  await settleHashDispatch();
  await activeApp?.unmount();
  activeApp = null;
  vi.clearAllMocks();
});

describe('mountApp routing', () => {
  it('an empty hash routes to the events screen without writing a hash', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const { root } = await startApp();
    expect(root.textContent).toContain('EVENTS_SCREEN');
    expect(location.hash).toBe('');
    expect(mountEventsScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1', defaultFormat: 'cup_taster' }),
    );
  });

  it('threads a real AbortSignal into the mounted screen — the router-navigation-race guard depends on every screen actually receiving one', async () => {
    // main.js's own buildRoutes() reconstructs a NARROWER params object for
    // every screen call site, rather than forwarding router.js's params
    // wholesale — router.js passing a signal into route.mount() is useless
    // to a screen if this file drops it along the way. Regression coverage
    // for exactly that gap (found while wiring core/router.js's own signal
    // mechanism). See ROADMAP.md's "A real DOM-write race between the
    // router..." entry.
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    await startApp();
    expect(mountEventsScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('#/events/:eventId routes to the event dashboard with the right param', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('DASHBOARD_SCREEN');
    expect(mountEventDashboardScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
  });

  it.each([
    ['#/events/ev1/setup', mountSetupScreen, 'SETUP_SCREEN', { eventId: 'ev1' }],
    ['#/events/ev1/roster', mountRosterScreen, 'ROSTER_SCREEN', { eventId: 'ev1' }],
    ['#/events/ev1/report', mountReportScreen, 'REPORT_SCREEN', { eventId: 'ev1' }],
    [
      '#/events/ev1/stages/s1/heats',
      mountHeatGenerationScreen,
      'HEATS_SCREEN',
      { eventId: 'ev1', stageId: 's1' },
    ],
    [
      '#/events/ev1/stages/s1/standings',
      mountStandingsScreen,
      'STANDINGS_SCREEN',
      { eventId: 'ev1', stageId: 's1' },
    ],
    [
      '#/events/ev1/heats/h1/timing',
      mountTimingRouteScreen,
      'TIMING_SCREEN',
      { eventId: 'ev1', heatId: 'h1' },
    ],
    [
      '#/events/ev1/heats/h1/scoring',
      mountScoringScreen,
      'SCORING_SCREEN',
      { eventId: 'ev1', heatId: 'h1' },
    ],
  ])(
    '%s routes to the correct screen with the correct params',
    async (hash, mockFn, marker, params) => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mockFn, marker);
      const { root } = await startApp();
      location.hash = hash;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.textContent).toContain(marker);
      expect(mockFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(params));
    },
  );

  it('#/live/projector and #/live/phone route with orgId, not eventId', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
    stubScreen(mountPhoneSummary, 'PHONE_SCREEN');
    const { root } = await startApp();

    location.hash = '#/live/projector';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('PROJECTOR_SCREEN');
    expect(mountProjectorSurface).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1', signal: expect.any(AbortSignal) }),
    );

    location.hash = '#/live/phone';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('PHONE_SCREEN');
    expect(mountPhoneSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1', signal: expect.any(AbortSignal) }),
    );
  });

  it("resets a stale class/data-surface attribute on bareRoot BEFORE mounting the next of the three /live/* routes — regression coverage for the cross-screen residue bug (module-boundary-checker flagged the original per-screen cleanup as a real §6 violation: core/splashScreen.js hardcoding the format-specific 'projector-surface' class name; centralized here in main.js instead)", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    // Mirror what the REAL projectorSurface.js applies to its own root, so
    // this test proves the reset happens on the shared outlet itself, not
    // on some other node.
    mountProjectorSurface.mockImplementation(async (root) => {
      root.classList.add('projector-surface');
      root.setAttribute('data-surface', 'stage');
      root.textContent = 'PROJECTOR_SCREEN';
      return { unmount: vi.fn() };
    });
    let phoneSawAtMountTime = null;
    mountPhoneSummary.mockImplementation(async (root) => {
      phoneSawAtMountTime = {
        className: root.className,
        dataSurface: root.getAttribute('data-surface'),
      };
      root.textContent = 'PHONE_SCREEN';
      return { unmount: vi.fn() };
    });
    await startApp();

    location.hash = '#/live/projector';
    await new Promise((resolve) => setTimeout(resolve, 0));
    location.hash = '#/live/phone';
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The phone mount must have seen a clean outlet — no leftover
    // .projector-surface class, no leftover data-surface="stage" — even
    // though phoneSummary.js itself no longer does any cleanup of its own.
    expect(phoneSawAtMountTime.className).toBe('app-bare-root');
    expect(phoneSawAtMountTime.dataSurface).toBeNull();
  });

  it('#/live/splash routes with orgId, not eventId, same as the other two live routes', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountSplashScreen, 'SPLASH_SCREEN');
    const { root } = await startApp();

    location.hash = '#/live/splash';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('SPLASH_SCREEN');
    expect(mountSplashScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1' }),
    );
  });

  it("navigating from #/live/splash to a default-outlet route calls splash's own unmount() — regression coverage for the bareRoot DOM-leak bug (splashScreen.test.js proves what unmount() itself does; this proves the router actually calls it on this exact transition)", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const splashUnmount = vi.fn();
    mountSplashScreen.mockImplementation(async (root) => {
      root.textContent = 'SPLASH_SCREEN';
      return { unmount: splashUnmount };
    });
    location.hash = '#/live/splash';
    await startApp();

    location.hash = '#/events';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(splashUnmount).toHaveBeenCalledTimes(1);
  });

  it('an unknown hash shows an inline "Page not found" with a link back to #/events', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const { root } = await startApp();
    location.hash = '#/nonsense/route';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Page not found');
    const link = root.querySelector('a[href="#/events"]');
    expect(link).not.toBeNull();
  });

  it("navigating away calls the outgoing screen's unmount() before mounting the next one, and survives jsdom firing hashchange twice per assignment", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    // A fresh spy per mount call — never one shared spy — because jsdom
    // fires 'hashchange' twice per `location.hash` assignment (see
    // core/router.test.js's own identical precedent), so this screen may
    // legitimately mount more than once for a single navigation. Only the
    // LAST (truly current) instance's unmount is meaningful to assert on.
    const dashboardUnmounts = [];
    mountEventDashboardScreen.mockImplementation(async (root) => {
      root.textContent = 'DASHBOARD_SCREEN';
      const unmount = vi.fn();
      dashboardUnmounts.push(unmount);
      return { unmount };
    });
    await startApp();

    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const currentDashboardUnmount = dashboardUnmounts[dashboardUnmounts.length - 1];
    expect(currentDashboardUnmount).not.toHaveBeenCalled();

    location.hash = '#/events';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(currentDashboardUnmount).toHaveBeenCalledTimes(1);
  });

  it('shows organiser chrome for a normal route, hides it for the projector/phone live routes', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
    const { root } = await startApp();

    const shellRoot = root.querySelector('.app-shell-root');
    const bareRoot = root.querySelector('.app-bare-root');
    expect(shellRoot.hidden).toBe(false);
    expect(bareRoot.hidden).toBe(true);

    location.hash = '#/live/projector';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shellRoot.hidden).toBe(true);
    expect(bareRoot.hidden).toBe(false);
  });

  it("unmount() tears down the app shell itself, not just the currently-mounted screen — regression test for a real gap found in review (router.stop() alone left the shell's header/nav mounted forever)", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const { root, app } = await startApp();
    expect(root.querySelector('.app-shell-header')).not.toBeNull();

    await app.unmount();
    activeApp = null; // already unmounted directly — afterEach shouldn't unmount again

    expect(root.querySelector('.app-shell-header')).toBeNull();
  });
});

describe('the temporary auth gate (requireAuth)', () => {
  it('an unauthenticated session on a normal route mounts the login screen, not the real screen', async () => {
    stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
    const { root } = await startApp({ client: fakeClient({ session: null }) });
    expect(root.textContent).toContain('LOGIN_SCREEN');
    expect(mountEventsScreen).not.toHaveBeenCalled();
  });

  it('an authenticated session mounts the real screen, and actually checked the session rather than skipping the gate', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeClient();
    const getSessionSpy = vi.spyOn(client.auth, 'getSession');
    const { root } = await startApp({ client });
    expect(root.textContent).toContain('EVENTS_SCREEN');
    expect(mountLoginScreen).not.toHaveBeenCalled();
    expect(getSessionSpy).toHaveBeenCalled();
  });

  it('#/live/projector mounts its real screen regardless of session state, even on initial load — the audience never authenticates', async () => {
    stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
    location.hash = '#/live/projector';
    const { root } = await startApp({ client: fakeClient({ session: null }) });
    expect(root.textContent).toContain('PROJECTOR_SCREEN');
    expect(mountLoginScreen).not.toHaveBeenCalled();
  });

  it('#/live/phone mounts its real screen regardless of session state, even on initial load', async () => {
    stubScreen(mountPhoneSummary, 'PHONE_SCREEN');
    location.hash = '#/live/phone';
    const { root } = await startApp({ client: fakeClient({ session: null }) });
    expect(root.textContent).toContain('PHONE_SCREEN');
    expect(mountLoginScreen).not.toHaveBeenCalled();
  });

  it('#/live/splash mounts its real screen regardless of session state, even on initial load', async () => {
    stubScreen(mountSplashScreen, 'SPLASH_SCREEN');
    location.hash = '#/live/splash';
    const { root } = await startApp({ client: fakeClient({ session: null }) });
    expect(root.textContent).toContain('SPLASH_SCREEN');
    expect(mountLoginScreen).not.toHaveBeenCalled();
  });

  it('a still-in-flight session check that gets superseded by a newer navigation mounts neither the login screen nor the real one for the stale attempt', async () => {
    // requireAuth()'s own getSession() call is a real network round trip —
    // if a newer navigation starts (and router.js aborts this resolve's
    // signal) before it settles, neither branch it could take (render the
    // login screen, or mount the real one) should still happen once it
    // finally does. Models the same class of race core/router.test.js's
    // own "aborts a still-in-flight mount's own signal" test proves at the
    // router level, but through requireAuth()'s own extra async hop.
    // Only the FIRST getSession() call (for the stale '/events' navigation)
    // stays pending — the SECOND (for '/events/ev1', the one that's
    // supposed to win) resolves immediately with a real session, exactly
    // as it would in production where only the SUPERSEDED navigation's own
    // network call happens to be the slow one.
    let resolveGetSession;
    let getSessionCalls = 0;
    const client = fakeClient();
    client.auth.getSession = () => {
      getSessionCalls += 1;
      if (getSessionCalls === 1) {
        return new Promise((resolve) => {
          resolveGetSession = () => resolve({ data: { session: null } });
        });
      }
      return Promise.resolve({ data: { session: { user: { email: 'organiser@test.com' } } } });
    };
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');

    // Not startApp()/app.ready — the FIRST resolve()'s own getSession()
    // deliberately never settles in this test, so awaiting `.ready` here
    // would hang forever. Tracked as activeApp anyway so afterEach's own
    // cleanup still tears it down.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = mountApp(root, { client, orgId: 'org1' });
    activeApp = app;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveGetSession).toBeDefined();

    // A second, faster navigation supersedes the still-pending first one.
    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('DASHBOARD_SCREEN');

    // NOW let the stale getSession() finally resolve (session: null, which
    // would normally mount the login screen).
    resolveGetSession();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mountLoginScreen).not.toHaveBeenCalled();
    expect(mountEventsScreen).not.toHaveBeenCalled();
    expect(root.textContent).toContain('DASHBOARD_SCREEN');
  });

  it('a successful sign-in transitions straight into the screen the user originally tried to reach', async () => {
    const client = fakeClient({ session: null });
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    let capturedOnSignedIn;
    mountLoginScreen.mockImplementation(async (root, { onSignedIn }) => {
      capturedOnSignedIn = onSignedIn;
      root.textContent = 'LOGIN_SCREEN';
      return { unmount: vi.fn() };
    });

    const { root } = await startApp({ client });
    expect(root.textContent).toContain('LOGIN_SCREEN');

    client.setSession({ user: { email: 'organiser@test.com' } });
    capturedOnSignedIn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('EVENTS_SCREEN');
  });
});
