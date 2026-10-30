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
const mountSetPasswordScreen = vi.fn();
const mountTeamScreen = vi.fn();
const canManageTeam = vi.fn(() => Promise.resolve(false));

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
// The two audience routes mount through liveSurfaces.js (it picks the live format's body); the stubs keep
// their original names so every assertion below still reads as "the projector / phone screen was mounted".
vi.mock('./liveSurfaces.js', () => ({
  mountProjector: (...args) => mountProjectorSurface(...args),
  mountPhone: (...args) => mountPhoneSummary(...args),
  // The splash is branded from liveSurfaces.js too (BR-E1); the stub keeps its original name.
  mountSplash: (...args) => mountSplashScreen(...args),
}));
vi.mock('./core/setPasswordScreen.js', () => ({
  mountSetPasswordScreen: (...args) => mountSetPasswordScreen(...args),
}));
vi.mock('./core/teamScreen.js', () => ({
  mountTeamScreen: (...args) => mountTeamScreen(...args),
}));
vi.mock('./core/team.js', () => ({
  canManageTeam: (...args) => canManageTeam(...args),
}));
vi.mock('./core/loginScreen.js', () => ({
  mountLoginScreen: (...args) => mountLoginScreen(...args),
}));
const mountBtcEventDashboardScreen = vi.fn();
vi.mock('./formats/btc/eventDashboardScreen.js', () => ({
  mountBtcEventDashboardScreen: (...args) => mountBtcEventDashboardScreen(...args),
}));
const mountBtcSetupScreen = vi.fn();
vi.mock('./formats/btc/setupScreen.js', () => ({
  mountSetupScreen: (...args) => mountBtcSetupScreen(...args),
}));
const mountBtcMatchesScreen = vi.fn();
vi.mock('./formats/btc/matchesScreen.js', () => ({
  mountMatchesScreen: (...args) => mountBtcMatchesScreen(...args),
}));
const mountBtcStandingsScreen = vi.fn();
vi.mock('./formats/btc/standingsScreen.js', () => ({
  mountStandingsScreen: (...args) => mountBtcStandingsScreen(...args),
}));
const mountBtcBracketScreen = vi.fn();
vi.mock('./formats/btc/bracketScreen.js', () => ({
  mountBracketScreen: (...args) => mountBtcBracketScreen(...args),
}));
const mountBtcScoringScreen = vi.fn();
vi.mock('./formats/btc/scoringScreen.js', () => ({
  mountScoringScreen: (...args) => mountBtcScoringScreen(...args),
}));
// Defaults every event lookup to a Cup Taster event, so every test written before
// the format-dispatch existed keeps testing exactly what it did before, unmodified —
// only the new tests specifically about dispatch override this per-call.
const findEvent = vi.fn(() => Promise.resolve({ id: 'ev1', format: 'cup_taster' }));
// Which organiser a slug in an audience link means (T-TEN.D1): a test says which.
const resolveOrgBySlug = vi.fn(() => Promise.resolve({ status: 'not_found' }));
vi.mock('./core/orgResolver.js', () => ({
  resolveOrgBySlug: (...args) => resolveOrgBySlug(...args),
}));
const findMatchEventId = vi.fn(() => Promise.resolve(null));
vi.mock('./formats/btc/matches.js', () => ({
  findMatchEventId: (...args) => findMatchEventId(...args),
}));
// What the device remembers about which organisation an event belongs to (T-TEN.C7): nothing, unless a test
// says so. Mocked: the real one is IndexedDB, which these tests do not otherwise touch.
const cacheGet = vi.fn(() => Promise.resolve(null));
const cacheSet = vi.fn(() => Promise.resolve());
vi.mock('./core/db.js', () => ({
  cacheGet: (...args) => cacheGet(...args),
  cacheSet: (...args) => cacheSet(...args),
}));
// Which organisation an event belongs to (T-TEN.C7): the first organisation unless a test says otherwise.
const findEventOrgId = vi.fn(() => Promise.resolve('org1'));
vi.mock('./core/events.js', () => ({
  findEvent: (...args) => findEvent(...args),
  findEventOrgId: (...args) => findEventOrgId(...args),
}));

// Mocked at the module level, same as every screen above — appShell.js
// (mounted for real in every test here, unlike the routed screens) ALSO
// imports listPendingOperations from this exact module, so the mock must
// cover both call sites; returning [] keeps its own sync panel a harmless
// no-op ("off") across every test that isn't specifically about it.
const flushOutbox = vi.fn(() =>
  Promise.resolve({ processed: 0, stopped: false, permanentFailure: false }),
);
const listPendingOperations = vi.fn(() => Promise.resolve([]));
// Who the outbox replays for (T-TEN.C6): main.js sets it, the real outbox filters by it. The sync panel
// also asks for what is waiting for somebody else, and for what signing out would leave behind.
const setOutboxOwner = vi.fn();
const listOtherOperations = vi.fn(() => Promise.resolve({ otherOrg: [], otherAccount: [] }));
const listAccountOperations = vi.fn(() => Promise.resolve([]));
// The real appShell.js subscribes here for dropped operations; a test
// simulating a drop calls every live listener, exactly as the real
// outbox's runFlush does, and an unmounted shell must have removed its own.
const dropListeners = new Set();
function announceDrop(error) {
  for (const listener of dropListeners) listener({ operation: { type: 'fake_type' }, error });
}
vi.mock('./core/outbox.js', () => ({
  flushOutbox: (...args) => flushOutbox(...args),
  listPendingOperations: (...args) => listPendingOperations(...args),
  setOutboxOwner: (...args) => setOutboxOwner(...args),
  listOtherOperations: (...args) => listOtherOperations(...args),
  listAccountOperations: (...args) => listAccountOperations(...args),
  // The panel reads the queue in one partitioned read: the tests' own queue is "mine".
  partitionOperations: async () => ({
    own: await listPendingOperations(),
    otherOrg: [],
    otherAccount: [],
  }),
  getOutboxOwner: () => undefined,
  isFlushInProgress: () => false,
  onOperationDropped: (listener) => {
    dropListeners.add(listener);
    return () => dropListeners.delete(listener);
  },
}));
const cupTasterOutboxHandlers = vi.fn(() => ({ fake: 'handlers' }));
const cupTasterOperationLabels = { fake_type: 'doing a fake thing' };
vi.mock('./formats/cup-taster/outboxHandlers.js', () => ({
  cupTasterOutboxHandlers: (...args) => cupTasterOutboxHandlers(...args),
  cupTasterOperationLabels,
}));
const btcOutboxHandlers = vi.fn(() => ({ fake_btc: 'btc-handlers' }));
const btcOperationLabels = { fake_btc_type: 'doing a fake btc thing' };
vi.mock('./formats/btc/outboxHandlers.js', () => ({
  btcOutboxHandlers: (...args) => btcOutboxHandlers(...args),
  btcOperationLabels,
}));
const stopTrackingInputModality = vi.fn();
const trackInputModality = vi.fn(() => stopTrackingInputModality);
vi.mock('./core/inputModality.js', () => ({
  trackInputModality: (...args) => trackInputModality(...args),
}));

const { mountApp, audienceHash, audienceLinksFor } = await import('./main.js');
const { DEFAULT_LOAD_TIMEOUT_MS } = await import('./core/timeout.js');

// What the database says the signed-in person belongs to (my_orgs()). One org by default, so every test
// written before the organisation came from the database keeps meaning what it did.
const ORG_ONE = { org_id: 'org1', name: 'Org One', slug: 'org-one', role: 'owner' };
const ORG_TWO = { org_id: 'org2', name: 'Org Two', slug: 'org-two', role: 'organiser' };
const myOrgs = vi.fn(() => Promise.resolve({ data: [ORG_ONE], error: null }));
// The event's plan window (my_entitlements); an error by default, which the console treats as "no window" (fail-open).
const myEntitlements = vi.fn(() =>
  Promise.resolve({ data: null, error: { code: 'unexpected rpc' } }),
);
function fakeRpc(name, args) {
  if (name === 'my_orgs') return myOrgs();
  if (name === 'my_entitlements') return myEntitlements(args);
  return Promise.resolve({ data: null, error: { code: 'unexpected rpc: ' + name } });
}

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
function fakeClient({ session = { user: { id: 'user-1', email: 'organiser@test.com' } } } = {}) {
  let currentSession = session;
  return {
    setSession(next) {
      currentSession = next;
    },
    rpc: fakeRpc,
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
  const app = mountApp(root, {
    client: fakeClient(),
    legacyAudienceOrgId: 'org1',
    legacyAudienceOrgSlug: null,
    ...overrides,
  });
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
  // The real appShell keeps its lost-write notice in sessionStorage.
  sessionStorage.clear();
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

  it('#/events/:eventId routes to the BTC dashboard (not Cup Taster\'s) for an event whose format is "btc"', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcEventDashboardScreen, 'BTC_DASHBOARD_SCREEN');
    // TWO queued values, not one — appShell.js's own breadcrumb fetch (setNav ->
    // findEvent, deliberately NOT gated by requireAuth per its own CLAUDE.md note)
    // also calls this same mocked findEvent for this event, alongside this
    // dispatcher's own call. `mockResolvedValueOnce` (not a persistent
    // `mockResolvedValue`) so this test's override can't leak into a LATER test —
    // `vi.clearAllMocks()` in afterEach clears call history, not a configured
    // return value, so a persistent override here would silently break every
    // subsequent test's own default cup_taster dispatch (found exactly this way).
    const btcEvent = { id: 'ev1', format: 'btc', name: 'Regional Bracket' };
    findEvent.mockResolvedValueOnce(btcEvent).mockResolvedValueOnce(btcEvent);
    const { root } = await startApp();
    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('BTC_DASHBOARD_SCREEN');
    expect(mountBtcEventDashboardScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
    expect(mountEventDashboardScreen).not.toHaveBeenCalled();
    // Documents the assumption the two queued mockResolvedValueOnce values above
    // depend on: exactly two independent callers (this dispatcher + appShell's own
    // breadcrumb fetch) read findEvent for this one navigation. If that count ever
    // drifts — a third caller added, or the breadcrumb stops re-fetching — this
    // assertion fails here, at the line that explains why, instead of silently
    // leaking a stale queued value into a later, unrelated test.
    expect(findEvent).toHaveBeenCalledTimes(2);
  });

  it('passes both configured formats to the events screen as formatOptions', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    await startApp();
    expect(mountEventsScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        formatOptions: [
          { value: 'cup_taster', label: 'Cup Taster' },
          { value: 'btc', label: 'BTC' },
        ],
      }),
    );
  });

  it('#/events/:eventId/btc/setup routes to the BTC setup screen with the right param', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcSetupScreen, 'BTC_SETUP_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1/btc/setup';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('BTC_SETUP_SCREEN');
    expect(mountBtcSetupScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
    // These screens publish to the live display (liveSession.js), so they flush with every format's
    // handlers, never BTC's alone: a queued Cup Taster operation ahead of the publish must not stop it.
    expect(mountBtcSetupScreen.mock.calls[0][1].handlers).toEqual({
      ...cupTasterOutboxHandlers(),
      ...btcOutboxHandlers(),
    });
  });

  it('#/events/:eventId/btc/matches routes to the BTC matches screen with the right param', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcMatchesScreen, 'BTC_MATCHES_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1/btc/matches';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('BTC_MATCHES_SCREEN');
    expect(mountBtcMatchesScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
    // These screens publish to the live display (liveSession.js), so they flush with every format's
    // handlers, never BTC's alone: a queued Cup Taster operation ahead of the publish must not stop it.
    expect(mountBtcMatchesScreen.mock.calls[0][1].handlers).toEqual({
      ...cupTasterOutboxHandlers(),
      ...btcOutboxHandlers(),
    });
  });

  it('#/events/:eventId/btc/standings routes to the BTC standings screen with the right param', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcStandingsScreen, 'BTC_STANDINGS_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1/btc/standings';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('BTC_STANDINGS_SCREEN');
    expect(mountBtcStandingsScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
  });

  it('#/events/:eventId/btc/bracket routes to the BTC bracket screen with the right param', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcBracketScreen, 'BTC_BRACKET_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1/btc/bracket';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('BTC_BRACKET_SCREEN');
    expect(mountBtcBracketScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: 'ev1' }),
    );
    // These screens publish to the live display (liveSession.js), so they flush with every format's
    // handlers, never BTC's alone: a queued Cup Taster operation ahead of the publish must not stop it.
    expect(mountBtcBracketScreen.mock.calls[0][1].handlers).toEqual({
      ...cupTasterOutboxHandlers(),
      ...btcOutboxHandlers(),
    });
  });

  it('#/events/:eventId/btc/matches/:matchId/scoring routes to the BTC scoring screen with the right param and allOutboxHandlers, not the BTC-only handler map', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
    // (even for a person with one organisation, the match's event is looked up: is it theirs?)
    findMatchEventId.mockResolvedValue('ev1');
    const { root } = await startApp();
    location.hash = '#/events/ev1/btc/matches/m1/scoring';
    await vi.waitFor(() => expect(root.textContent).toContain('BTC_SCORING_SCREEN'));
    findMatchEventId.mockResolvedValue(null);
    expect(mountBtcScoringScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matchId: 'm1' }),
    );
    // Not just btcOutboxHandlers(client) alone — the whole point of this route
    // passing `handlers` at all is to cover every format's queued operations, not
    // just BTC's own (closing the head-of-line-blocking gap CLAUDE.md flagged).
    const call = mountBtcScoringScreen.mock.calls[0][1];
    expect(call.handlers).toEqual({ ...cupTasterOutboxHandlers(), ...btcOutboxHandlers() });
  });

  it("#/events/:eventId/heats/:heatId/scoring passes allOutboxHandlers to Cup Taster's own scoring screen too, not just Cup-Taster-only handlers — now that BTC operations genuinely exist in the shared outbox queue, a Cup Taster confirm flush can no longer assume nothing else is ever ahead of it", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountScoringScreen, 'CT_SCORING_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1/heats/h1/scoring';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('CT_SCORING_SCREEN');
    const call = mountScoringScreen.mock.calls[0][1];
    expect(call).toEqual(
      expect.objectContaining({ eventId: 'ev1', heatId: 'h1', signal: expect.any(AbortSignal) }),
    );
    expect(call.handlers).toEqual({ ...cupTasterOutboxHandlers(), ...btcOutboxHandlers() });
  });

  it("always shows the three /live/* audience links (org-scoped, not event-scoped) alongside the event's own nav, each opening in a new tab", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
    const { root } = await startApp();
    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const links = [...root.querySelectorAll('.app-shell-link')];
    const byLabel = (label) => links.find((link) => link.textContent.startsWith(label));

    // "Event home" — renamed from "Overview" (found ambiguous in
    // production feedback); only appears once an eventId is in scope.
    expect(byLabel('Event home')).not.toBeUndefined();

    // The three /live/* links are present on an EVENT-scoped screen too,
    // not just the org-wide Events list — they're org-scoped ("whatever's
    // currently live for this org"), matching "Events" itself, not tied to
    // whichever event happens to be open.
    for (const [label, href] of [
      ['Splash screen', '#/live/org-one/splash'],
      ['Projector view', '#/live/org-one/projector'],
      ['Phone view', '#/live/org-one/phone'],
    ]) {
      const link = byLabel(label);
      expect(link, `expected a nav link labeled "${label}"`).not.toBeUndefined();
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      // Never the "current section" — these are separate-tab/device links,
      // not part of this app's own in-tab navigation.
      expect(link.getAttribute('aria-current')).toBeNull();
    }
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

  describe('audience links that name the organiser (T-TEN.D1)', () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const ALPHA = { status: 'found', org: { id: 'org-alpha', name: 'Alpha', slug: 'alpha' } };
    const BRAVO = { status: 'found', org: { id: 'org-bravo', name: 'Bravo', slug: 'bravo' } };

    beforeEach(() => {
      // Start from no link: a previous test's hash must not start this one's app on an audience route.
      location.hash = '';
      // No jitter unless a test asks for it: the retry beat is exactly the schedule.
      vi.spyOn(Math, 'random').mockReturnValue(0);
      resolveOrgBySlug.mockReset();
      resolveOrgBySlug.mockImplementation(async (slug) => {
        if (slug === 'alpha') return ALPHA;
        if (slug === 'bravo') return BRAVO;
        return { status: 'not_found' };
      });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
      stubScreen(mountPhoneSummary, 'PHONE_SCREEN');
      stubScreen(mountSplashScreen, 'SPLASH_SCREEN');
    });

    afterEach(() => {
      vi.mocked(Math.random).mockRestore();
    });

    it('each of the three surfaces mounts for the organiser the slug names, with the abort signal', async () => {
      const { root } = await startApp();
      for (const [name, screen, marker] of [
        ['projector', mountProjectorSurface, 'PROJECTOR_SCREEN'],
        ['phone', mountPhoneSummary, 'PHONE_SCREEN'],
        ['splash', mountSplashScreen, 'SPLASH_SCREEN'],
      ]) {
        location.hash = `#/live/bravo/${name}`;
        await vi.waitFor(() => expect(root.textContent).toContain(marker));
        expect(screen).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ orgId: 'org-bravo', signal: expect.any(AbortSignal) }),
        );
      }
    });

    it('two organisers each get their own organisation', async () => {
      const { root } = await startApp();
      location.hash = '#/live/alpha/projector';
      await vi.waitFor(() => expect(mountProjectorSurface).toHaveBeenCalled());
      expect(mountProjectorSurface.mock.calls.at(-1)[1].orgId).toBe('org-alpha');
      location.hash = '#/live/bravo/projector';
      await vi.waitFor(() =>
        expect(mountProjectorSurface.mock.calls.at(-1)[1].orgId).toBe('org-bravo'),
      );
      void root;
    });

    it('asks the resolver with the slug from the link, and mounts nothing from the legacy organisation', async () => {
      await startApp({ legacyAudienceOrgId: 'org-legacy' });
      location.hash = '#/live/alpha/phone';
      await vi.waitFor(() => expect(mountPhoneSummary).toHaveBeenCalled());
      expect(resolveOrgBySlug).toHaveBeenCalledWith('alpha', expect.anything());
      expect(mountPhoneSummary.mock.calls.every((call) => call[1].orgId !== 'org-legacy')).toBe(
        true,
      );
    });

    it('a slug with no organiser says so, and mounts no surface (never "no event tonight")', async () => {
      const { root } = await startApp();
      location.hash = '#/live/nobody/projector';
      await vi.waitFor(() => expect(root.textContent).toContain('We couldn’t find that organiser'));
      expect(root.textContent).toContain('Check the link');
      expect(root.textContent).not.toContain('PROJECTOR_SCREEN');
      expect(root.textContent).not.toContain('Waiting for the organiser');
      expect(mountProjectorSurface).not.toHaveBeenCalled();
    });

    it('the not-found card uses the stage look for the projector and splash, and the paper look for the phone', async () => {
      const { root } = await startApp();
      const bare = () => root.querySelector('.app-bare-root');
      location.hash = '#/live/nobody/projector';
      await vi.waitFor(() => expect(root.textContent).toContain('couldn’t find'));
      expect(bare().getAttribute('data-surface')).toBe('stage');
      location.hash = '#/live/nobody/phone';
      await vi.waitFor(() => expect(bare().getAttribute('data-surface')).toBeNull());
      expect(root.textContent).toContain('couldn’t find');
      location.hash = '#/live/nobody/splash';
      await vi.waitFor(() => expect(bare().getAttribute('data-surface')).toBe('stage'));
    });

    it('a failed lookup says it is trying again, keeps trying, and mounts the surface once it works (nobody reloads)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let calls = 0;
        resolveOrgBySlug.mockImplementation(async () => {
          calls += 1;
          return calls < 3 ? { status: 'error', error: new Error('offline') } : ALPHA;
        });
        const { root } = await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        expect(root.textContent).toContain('We can’t reach Seduh right now');
        expect(root.textContent).toContain('This page will update by itself');
        expect(root.textContent).not.toContain('couldn’t find that organiser');
        // announced politely: it will be replaced by the surface without anyone touching the screen
        const trying = [...root.querySelectorAll('[role="status"]')].find((node) =>
          node.textContent.includes('This page will update by itself'),
        );
        expect(trying?.getAttribute('aria-live')).toBe('polite');
        expect(mountProjectorSurface).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3000);
        expect(calls).toBeGreaterThanOrEqual(2);
        expect(mountProjectorSurface).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(6000);
        expect(root.textContent).toContain('PROJECTOR_SCREEN');
        expect(root.textContent).not.toContain('This page will update by itself');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failed lookup becomes "not found" when the answer is that there is no such organiser', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const answers = [{ status: 'error', error: new Error('x') }, { status: 'not_found' }];
        resolveOrgBySlug.mockImplementation(async () => answers.shift() ?? { status: 'not_found' });
        const { root } = await startApp();
        location.hash = '#/live/alpha/phone';
        await vi.advanceTimersByTimeAsync(10);
        expect(root.textContent).toContain('We can’t reach Seduh right now');
        await vi.advanceTimersByTimeAsync(3100);
        expect(root.textContent).toContain('We couldn’t find that organiser');
        // and it has stopped asking
        const asked = resolveOrgBySlug.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60000);
        expect(resolveOrgBySlug.mock.calls.length).toBe(asked);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moving to another screen stops the retrying', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        const { root } = await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        location.hash = '#/events';
        // (the router mounts the next screen before it takes the old one down, so wait for the next one)
        for (let i = 0; i < 30 && !root.textContent.includes('EVENTS_SCREEN'); i += 1) {
          await vi.advanceTimersByTimeAsync(100);
        }
        expect(root.textContent).toContain('EVENTS_SCREEN');
        // ...and for the router to have taken the old one down, which it does just after (the next screen's
        // own waits run on the same fake clock)
        await vi.advanceTimersByTimeAsync(40000);
        const asked = resolveOrgBySlug.mock.calls.length;
        await vi.advanceTimersByTimeAsync(120000);
        expect(resolveOrgBySlug.mock.calls.length).toBe(asked);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a surface that was still starting when the person moved on is taken down again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let calls = 0;
        resolveOrgBySlug.mockImplementation(async () => {
          calls += 1;
          return calls < 2 ? { status: 'error', error: new Error('offline') } : ALPHA;
        });
        const surfaceHandle = { unmount: vi.fn() };
        let finishStarting;
        mountProjectorSurface.mockImplementation(
          () => new Promise((resolve) => (finishStarting = () => resolve(surfaceHandle))),
        );
        const { root } = await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(3100); // the retry finds the organiser and starts the surface
        expect(finishStarting).toBeTypeOf('function');
        location.hash = '#/events';
        for (let i = 0; i < 40 && !root.textContent.includes('EVENTS_SCREEN'); i += 1) {
          await vi.advanceTimersByTimeAsync(100);
        }
        await vi.advanceTimersByTimeAsync(40000);
        finishStarting();
        await vi.advanceTimersByTimeAsync(10);
        expect(surfaceHandle.unmount).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('an answer that arrives after the person moved on mounts nothing', async () => {
      let answerLate;
      resolveOrgBySlug.mockImplementation(() => new Promise((resolve) => (answerLate = resolve)));
      const { root } = await startApp();
      location.hash = '#/live/alpha/projector';
      await vi.waitFor(() => expect(answerLate).toBeTypeOf('function'));
      location.hash = '#/live/phone';
      await tick();
      resolveOrgBySlug.mockImplementation(async () => ALPHA);
      answerLate(ALPHA);
      await tick();
      await tick();
      expect(mountProjectorSurface).not.toHaveBeenCalled();
      expect(root.textContent).not.toContain('PROJECTOR_SCREEN');
    });

    it('the old slug-less links keep working through the legacy slug when one is configured', async () => {
      const { root } = await startApp({
        legacyAudienceOrgSlug: 'bravo',
        legacyAudienceOrgId: 'org-legacy',
      });
      location.hash = '#/live/projector';
      await vi.waitFor(() => expect(root.textContent).toContain('PROJECTOR_SCREEN'));
      expect(resolveOrgBySlug).toHaveBeenCalledWith('bravo', expect.anything());
      expect(mountProjectorSurface.mock.calls.at(-1)[1].orgId).toBe('org-bravo');
    });

    it('with no legacy slug yet, the old links use the configured org id, with no lookup at all', async () => {
      const { root } = await startApp({ legacyAudienceOrgId: 'org-legacy' });
      location.hash = '#/live/phone';
      await vi.waitFor(() => expect(root.textContent).toContain('PHONE_SCREEN'));
      expect(mountPhoneSummary.mock.calls.at(-1)[1].orgId).toBe('org-legacy');
      expect(resolveOrgBySlug).not.toHaveBeenCalled();
    });

    it('with neither configured, the old links show the "out of date" card, never a crash', async () => {
      const { root } = await startApp({ legacyAudienceOrgId: null, legacyAudienceOrgSlug: null });
      for (const name of ['projector', 'phone', 'splash']) {
        location.hash = `#/live/${name}`;
        await vi.waitFor(() => expect(root.textContent).toContain('This link is out of date'));
      }
      expect(resolveOrgBySlug).not.toHaveBeenCalled();
    });

    it('shows a card from the first moment, never a blank page, while the first lookup is on its way', async () => {
      resolveOrgBySlug.mockImplementation(() => new Promise(() => {}));
      const root = document.createElement('div');
      document.body.appendChild(root);
      location.hash = '#/live/alpha/projector';
      activeApp = mountApp(root, {
        client: fakeClient(),
        legacyAudienceOrgId: 'org1',
        legacyAudienceOrgSlug: null,
      });
      await vi.waitFor(() => expect(root.textContent).toContain('Opening this link…'));
      const bare = root.querySelector('.app-bare-root');
      expect(bare.getAttribute('data-surface')).toBe('stage');
      expect(bare.querySelector('.viewer-holding-body').getAttribute('role')).toBe('status');
    });

    it('retries on exactly the schedule 3, 6, 12, 20 and then every 30 seconds', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let now = 0;
        const stamps = new Set();
        resolveOrgBySlug.mockImplementation(async () => {
          stamps.add(now);
          return { status: 'error', error: new Error('offline') };
        });
        await startApp();
        location.hash = '#/live/alpha/phone';
        // a virtual clock in 100 ms steps; a superseded start (jsdom may begin the route twice) retries nothing
        for (let step = 0; step < 1100; step += 1) {
          await vi.advanceTimersByTimeAsync(100);
          now += 100;
        }
        const times = [...stamps].sort((a, b) => a - b);
        const gaps = times.slice(1).map((time, index) => time - times[index]);
        // (the first gap is measured from when the first attempt was recorded, to within one 100 ms step)
        expect(gaps[0]).toBeGreaterThanOrEqual(2900);
        expect(gaps[0]).toBeLessThanOrEqual(3000);
        expect(gaps.slice(1, 6)).toEqual([6000, 12000, 20000, 30000, 30000]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('spreads the retries (up to a quarter later), so a room of phones does not retry together', async () => {
      vi.mocked(Math.random).mockReturnValue(0.999);
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        await startApp();
        location.hash = '#/live/alpha/phone';
        await vi.advanceTimersByTimeAsync(5);
        const base = resolveOrgBySlug.mock.calls.length;
        await vi.advanceTimersByTimeAsync(3500);
        expect(resolveOrgBySlug.mock.calls.length).toBe(base);
        await vi.advanceTimersByTimeAsync(400);
        expect(resolveOrgBySlug.mock.calls.length).toBeGreaterThan(base);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a card that keeps failing keeps the same words in the same live region: nothing is re-announced', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        const { root } = await startApp();
        location.hash = '#/live/alpha/phone';
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(3100);
        const body = root.querySelector('.app-bare-root .viewer-holding-body');
        expect(body.textContent).toContain('Check the internet connection');
        let changes = 0;
        const observer = new MutationObserver((records) => {
          changes += records.length;
        });
        observer.observe(body, { childList: true, characterData: true, subtree: true });
        await vi.advanceTimersByTimeAsync(7000); // the next retry fails the same way
        await Promise.resolve();
        changes += observer.takeRecords().length;
        expect(root.querySelector('.app-bare-root .viewer-holding-body')).toBe(body);
        expect(changes).toBe(0);
        observer.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a phone offers "Try again now", a projector does not; and the card looks like its surface', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        const { root } = await startApp();
        const bare = () => root.querySelector('.app-bare-root');
        const tryNow = () =>
          [...bare().querySelectorAll('button')].find((b) => b.textContent === 'Try again now');
        location.hash = '#/live/alpha/phone';
        await vi.advanceTimersByTimeAsync(10);
        expect(tryNow()).toBeTruthy();
        expect(tryNow().hidden).toBe(false);
        expect(bare().getAttribute('data-surface')).toBeNull();
        resolveOrgBySlug.mockResolvedValue(ALPHA);
        tryNow().click();
        await vi.advanceTimersByTimeAsync(10);
        expect(root.textContent).toContain('PHONE_SCREEN');

        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        expect(bare().getAttribute('data-surface')).toBe('stage');
        expect(tryNow()?.hidden ?? true).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('coming back online, or back to the tab, tries at once instead of waiting out the backoff', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        resolveOrgBySlug.mockResolvedValue({ status: 'error', error: new Error('offline') });
        await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        const before = resolveOrgBySlug.mock.calls.length;
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(5);
        expect(resolveOrgBySlug.mock.calls.length).toBeGreaterThan(before);
        const mid = resolveOrgBySlug.mock.calls.length;
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(5);
        expect(resolveOrgBySlug.mock.calls.length).toBeGreaterThan(mid);
      } finally {
        vi.useRealTimers();
      }
    });

    it('after the surface appeared, going online again asks nothing more', async () => {
      const { root } = await startApp();
      location.hash = '#/live/alpha/projector';
      await vi.waitFor(() => expect(root.textContent).toContain('PROJECTOR_SCREEN'));
      const asked = resolveOrgBySlug.mock.calls.length;
      window.dispatchEvent(new Event('online'));
      await tick();
      expect(resolveOrgBySlug.mock.calls.length).toBe(asked);
    });

    it('the surface replacing a retry card gets focus on its heading', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let calls = 0;
        resolveOrgBySlug.mockImplementation(async () => {
          calls += 1;
          return calls < 3 ? { status: 'error', error: new Error('offline') } : ALPHA;
        });
        mountProjectorSurface.mockImplementation(async (outlet) => {
          outlet.innerHTML = '<h1>Projector</h1>';
          return { unmount: vi.fn() };
        });
        const { root } = await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(20000);
        expect(root.textContent).toContain('Projector');
        expect(document.activeElement).toBe(root.querySelector('.app-bare-root h1'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('a surface that fails to start on a retry leaves a card that keeps trying, never a dead one', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        let calls = 0;
        resolveOrgBySlug.mockImplementation(async () => {
          calls += 1;
          return calls < 2 ? { status: 'error', error: new Error('offline') } : ALPHA;
        });
        let starts = 0;
        mountProjectorSurface.mockImplementation(async (outlet) => {
          starts += 1;
          if (starts < 2) {
            outlet.innerHTML = '<p>half-built surface</p>'; // it got as far as clearing the card
            throw new Error('bad response');
          }
          outlet.textContent = 'PROJECTOR_SCREEN';
          return { unmount: vi.fn() };
        });
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { root } = await startApp();
        location.hash = '#/live/alpha/projector';
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(3100);
        expect(root.textContent).not.toContain('PROJECTOR_SCREEN');
        // the half-built surface is gone and the card says what is happening
        expect(root.textContent).not.toContain('half-built surface');
        expect(root.textContent).toContain('Check the internet connection');
        await vi.advanceTimersByTimeAsync(7000);
        expect(root.textContent).toContain('PROJECTOR_SCREEN');
        logged.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    for (const [label, late] of [
      ['an error', { status: 'error', error: new Error('late') }],
      ['not found', { status: 'not_found' }],
      ['an organiser', ALPHA],
    ]) {
      it(`${label} arriving after the person moved on paints nothing and arms no retry`, async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
          const pending = [];
          resolveOrgBySlug.mockImplementation(
            (slug) => new Promise((resolve) => pending.push([slug, resolve])),
          );
          const { root } = await startApp();
          location.hash = '#/live/alpha/projector';
          await vi.advanceTimersByTimeAsync(10);
          resolveOrgBySlug.mockImplementation(async () => BRAVO);
          location.hash = '#/live/bravo/phone';
          await vi.advanceTimersByTimeAsync(10);
          expect(root.textContent).toContain('PHONE_SCREEN');
          const asked = resolveOrgBySlug.mock.calls.length;
          for (const [slug, resolve] of pending) if (slug === 'alpha') resolve(late);
          await vi.advanceTimersByTimeAsync(60000);
          expect(root.textContent).toContain('PHONE_SCREEN');
          expect(root.textContent).not.toContain('Check the internet connection');
          expect(root.textContent).not.toContain('couldn’t find');
          expect(mountProjectorSurface).not.toHaveBeenCalled();
          expect(resolveOrgBySlug.mock.calls.length).toBe(asked);
        } finally {
          vi.useRealTimers();
        }
      });
    }

    it('a percent-encoded slug reaches the resolver decoded, and a capital letter as typed', async () => {
      await startApp();
      location.hash = '#/live/alpha%20coffee/phone';
      await vi.waitFor(() =>
        expect(resolveOrgBySlug).toHaveBeenCalledWith('alpha coffee', expect.anything()),
      );
      location.hash = '#/live/Alpha/phone';
      await vi.waitFor(() =>
        expect(resolveOrgBySlug).toHaveBeenCalledWith('Alpha', expect.anything()),
      );
    });

    it('a link with a broken percent-escape is "Page not found", not a blank page', async () => {
      const { root } = await startApp();
      location.hash = '#/live/%E0%A4%A/phone';
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      expect(resolveOrgBySlug).not.toHaveBeenCalled();
    });

    it('a legacy slug that does not exist shows "not found" on every old link, and the org id is not used instead', async () => {
      const { root } = await startApp({
        legacyAudienceOrgSlug: 'ghost',
        legacyAudienceOrgId: 'org-legacy',
      });
      for (const [name, screen] of [
        ['projector', mountProjectorSurface],
        ['phone', mountPhoneSummary],
        ['splash', mountSplashScreen],
      ]) {
        location.hash = `#/live/${name}`;
        await vi.waitFor(() => expect(root.textContent).toContain('couldn’t find that organiser'));
        expect(screen).not.toHaveBeenCalled();
      }
    });

    it('the "out of date" card is in the stage look for the projector and splash, the paper look for the phone, and asks nothing', async () => {
      const { root } = await startApp({ legacyAudienceOrgId: null, legacyAudienceOrgSlug: null });
      const bare = () => root.querySelector('.app-bare-root');
      for (const [name, look] of [
        ['projector', 'stage'],
        ['phone', null],
        ['splash', 'stage'],
      ]) {
        location.hash = `#/live/${name}`;
        await vi.waitFor(() => expect(bare().getAttribute('data-surface')).toBe(look));
        expect(root.textContent).toContain('This link is out of date');
      }
      expect(resolveOrgBySlug).not.toHaveBeenCalled();
    });

    it('a slug that looks like a surface name is still an organiser (the three-part form is never mistaken for an old link)', async () => {
      resolveOrgBySlug.mockResolvedValue(ALPHA);
      const { root } = await startApp();
      location.hash = '#/live/projector/phone';
      await vi.waitFor(() => expect(root.textContent).toContain('PHONE_SCREEN'));
      expect(resolveOrgBySlug).toHaveBeenCalledWith('projector', expect.anything());
    });
  });

  it("resets a stale class/data-surface attribute on bareRoot BEFORE mounting the next of the three /live/* routes — regression coverage for the cross-screen residue bug (module-boundary-checker flagged the original per-screen cleanup as a real §6 violation: core/splashScreen.js hardcoding the format-specific 'projector-surface' class name; centralized here in main.js instead)", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    // Mirror the residue a real projector mount leaves on its root (the stage
    // surface's data-surface plus a format class), so this test proves the
    // reset happens on the shared outlet itself, not on some other node.
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

  it('navigating away unmounts the outgoing screen only AFTER the next one has mounted (router.js mounts the new screen first), and survives jsdom firing hashchange twice per assignment', async () => {
    // Recording order, not just call counts: the audience routes share one
    // outlet, and an outgoing unmount() that clears it runs AFTER the new
    // screen has painted into it — the order is what made that a bug.
    const order = [];
    mountEventsScreen.mockImplementation(async (root) => {
      order.push('mount:events');
      root.textContent = 'EVENTS_SCREEN';
      return { unmount: vi.fn(() => order.push('unmount:events')) };
    });
    // A fresh spy per mount call — never one shared spy — because jsdom
    // fires 'hashchange' twice per `location.hash` assignment (see
    // core/router.test.js's own identical precedent), so this screen may
    // legitimately mount more than once for a single navigation. Only the
    // LAST (truly current) instance's unmount is meaningful to assert on.
    const dashboardUnmounts = [];
    mountEventDashboardScreen.mockImplementation(async (root) => {
      order.push('mount:dashboard');
      root.textContent = 'DASHBOARD_SCREEN';
      const unmount = vi.fn(() => order.push('unmount:dashboard'));
      dashboardUnmounts.push(unmount);
      return { unmount };
    });
    await startApp();

    location.hash = '#/events/ev1';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const currentDashboardUnmount = dashboardUnmounts[dashboardUnmounts.length - 1];
    expect(currentDashboardUnmount).not.toHaveBeenCalled();

    order.length = 0;
    location.hash = '#/events';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(currentDashboardUnmount).toHaveBeenCalledTimes(1);
    // The outgoing dashboard's first unmount comes after the first mount of the
    // screen that replaces it (jsdom's double hashchange can run two complete
    // resolves back to back, so a later mount may follow the unmount).
    expect(order).toContain('mount:events');
    expect(order).toContain('unmount:dashboard');
    expect(order.indexOf('unmount:dashboard')).toBeGreaterThan(order.indexOf('mount:events'));
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

describe('the Per-event window on an event route (requireAuth)', () => {
  afterEach(() => {
    myEntitlements.mockReset();
    myEntitlements.mockImplementation(() =>
      Promise.resolve({ data: null, error: { code: 'unexpected rpc' } }),
    );
  });
  const windowSnapshot = (win) => ({ tier: 'community', keys: {}, window: win });
  const open = async (eventId) => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
    const { root } = await startApp();
    location.hash = `#/events/${eventId}`;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return root;
  };

  it('a locked event shows the locked screen instead of the event screen', async () => {
    myEntitlements.mockResolvedValue({
      data: windowSnapshot({
        ends_at: new Date(Date.now() - 3600 * 1000).toISOString(),
        locked: true,
        enforced: true,
      }),
      error: null,
    });
    const root = await open('ev-win-locked');
    expect(root.textContent).toContain("This event's Per-event plan has ended");
    expect(mountEventDashboardScreen).not.toHaveBeenCalled();
    expect(myEntitlements).toHaveBeenCalledWith({ p_org: 'org1', p_event: 'ev-win-locked' });
  });

  it('an event whose window ends within two days opens normally and says so in the notice', async () => {
    myEntitlements.mockResolvedValue({
      data: windowSnapshot({
        ends_at: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
        locked: false,
        enforced: true,
      }),
      error: null,
    });
    const root = await open('ev-win-ending');
    expect(root.textContent).toContain('DASHBOARD_SCREEN');
    expect(root.querySelector('#app-shell-org-notice').textContent).toContain(
      'Per-event plan ends at',
    );
  });

  it('a window that ends later, or a key that is switched off, says nothing', async () => {
    myEntitlements.mockResolvedValue({
      data: windowSnapshot({
        ends_at: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
        locked: false,
        enforced: false,
      }),
      error: null,
    });
    const root = await open('ev-win-dark');
    expect(root.textContent).toContain('DASHBOARD_SCREEN');
    expect(root.querySelector('#app-shell-org-notice').textContent).not.toContain('Per-event plan');
  });

  it('fails open: when the window cannot be read the event screen mounts as it always did', async () => {
    myEntitlements.mockRejectedValue(new Error('offline'));
    const root = await open('ev-win-offline');
    expect(root.textContent).toContain('DASHBOARD_SCREEN');
    expect(root.textContent).not.toContain('Per-event plan has ended');
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
      return Promise.resolve({
        data: { session: { user: { id: 'user-1', email: 'organiser@test.com' } } },
      });
    };
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');

    // Not startApp()/app.ready — the FIRST resolve()'s own getSession()
    // deliberately never settles in this test, so awaiting `.ready` here
    // would hang forever. Tracked as activeApp anyway so afterEach's own
    // cleanup still tears it down.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = mountApp(root, { client, legacyAudienceOrgId: 'org1' });
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

    client.setSession({ user: { id: 'user-1', email: 'organiser@test.com' } });
    capturedOnSignedIn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.textContent).toContain('EVENTS_SCREEN');
  });
});

// D4: "local-first with sync-on-reconnect." Regression coverage for the
// Phase 6 offline-soak finding that no call site ever actually triggered a
// flush except the same write call that had just enqueued the operation —
// nothing retried a queue left behind by a dropped connection.
describe('sync-on-reconnect', () => {
  // Unlike the shared fakeClient() above, onAuthStateChange here actually
  // invokes every subscriber — both appShell.js's own subscription and
  // main.js's new one need to observe the same session. Fires an initial
  // callback asynchronously per subscriber, mirroring real Supabase-js's
  // own INITIAL_SESSION event (never synchronously — a subscriber must
  // never assume the current session is already known the instant it
  // subscribes).
  function fakeReactiveClient({ session = null } = {}) {
    let listeners = [];
    let currentSession = session;
    return {
      setSession(next) {
        currentSession = next;
        for (const cb of listeners) cb('SIGNED_IN', next);
      },
      rpc: fakeRpc,
      auth: {
        getSession: () => Promise.resolve({ data: { session: currentSession } }),
        onAuthStateChange: (cb) => {
          listeners.push(cb);
          Promise.resolve().then(() => cb('INITIAL_SESSION', currentSession));
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  listeners = listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        signOut: vi.fn(),
      },
    };
  }

  it('attempts a flush once it learns a session already exists at mount — a tab reopened after being offline, not just a live reconnect', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the async INITIAL_SESSION callback fire

    // Both formats' handlers must be in the ONE reconnect flush: a queued operation type
    // with no handler stops the whole FIFO queue, blocking everything behind it.
    expect(flushOutbox).toHaveBeenCalledWith({ fake: 'handlers', fake_btc: 'btc-handlers' });
    expect(cupTasterOutboxHandlers).toHaveBeenCalledWith(client);
    expect(btcOutboxHandlers).toHaveBeenCalledWith(client);
  });

  it('does NOT attempt a flush before a session is known — an unauthenticated RPC error would be misclassified as permanent by buildRpcHandler and silently discard real pending writes', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({ session: null });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(flushOutbox).not.toHaveBeenCalled();
  });

  // Found in review (test-auditor, 2026-09-26): the load-time flush has two
  // possible triggers depending on which lands first — the auth callback or
  // the first route. These pin each ordering to exactly one flush.
  it('flushes exactly once at load when the session is known before the first route resolves', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    // Fire INITIAL_SESSION synchronously, so hasSession is already true
    // while onConsoleRoute is still false — updateChrome() must flush.
    const subscribe = client.auth.onAuthStateChange;
    client.auth.onAuthStateChange = (cb) => {
      cb('INITIAL_SESSION', { user: { id: 'user-1', email: 'organiser@test.com' } });
      return subscribe(() => {});
    };
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('does not flush again when moving between console screens, but does when an audience tab navigates into the console', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
    stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
    location.hash = '#/live/projector';
    await settleHashDispatch();
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flushOutbox).not.toHaveBeenCalled();

    location.hash = '#/events';
    await settleHashDispatch();
    expect(flushOutbox).toHaveBeenCalledTimes(1);

    location.hash = '#/events/ev1';
    await settleHashDispatch();
    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("attempts a flush when the browser fires 'online', given a known session", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushOutbox.mockClear();

    window.dispatchEvent(new Event('online'));

    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("does NOT attempt a flush on 'online' while no session is known yet", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({ session: null });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.dispatchEvent(new Event('online'));

    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it('a sign-in transition after mount (no session yet, then one arrives) triggers its own flush attempt', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({ session: null });
    await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flushOutbox).not.toHaveBeenCalled();

    client.setSession({ user: { id: 'user-1', email: 'organiser@test.com' } });

    // Once the organisation is answered (the outbox only replays an operation in the organisation it was
    // made in), and once: the sign-in itself does not flush before that.
    await vi.waitFor(() => expect(flushOutbox).toHaveBeenCalledTimes(1));
    // ...and only once: neither the auth event nor the organisation's arrival may add a second flush.
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("stops listening for 'online' after unmount", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    const { app } = await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await app.unmount();
    activeApp = null; // already torn down — afterEach must not double-unmount it
    flushOutbox.mockClear();

    window.dispatchEvent(new Event('online'));

    expect(flushOutbox).not.toHaveBeenCalled();
  });

  // Pre-event hardening (2026-09-26): a transient server failure leaves its
  // write queued, but the device never went offline, so no 'online' event
  // will ever retry it. Only setInterval is faked — the INITIAL_SESSION
  // callback and the flush chain still run on real microtasks/timeouts.
  describe('periodic retry while writes are queued', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      vi.useRealTimers();
      // clearAllMocks() in the top-level afterEach clears call history only,
      // not a configured implementation — without this, the queued operation
      // below leaks into every later test's sync panel.
      listPendingOperations.mockImplementation(() => Promise.resolve([]));
    });

    async function settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('retries a flush every 15s while the queue still holds an operation', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      await startApp({ client });
      await settle();
      flushOutbox.mockClear();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);

      vi.advanceTimersByTime(14999);
      await settle();
      expect(flushOutbox).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await settle();
      expect(flushOutbox).toHaveBeenCalledTimes(1);
      expect(flushOutbox).toHaveBeenCalledWith({ fake: 'handlers', fake_btc: 'btc-handlers' });

      // Keeps going, not a one-shot.
      vi.advanceTimersByTime(15000);
      await settle();
      expect(flushOutbox).toHaveBeenCalledTimes(2);
    });

    it('asks for the organisation again every 15s while the device is online and it is unknown, and flushes once it is answered', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      myOrgs.mockResolvedValue({ data: null, error: { code: '503' } });
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      try {
        await startApp({ client });
        await settle();
        flushOutbox.mockClear();
        const asked = myOrgs.mock.calls.length;
        myOrgs.mockResolvedValue({ data: [ORG_ONE], error: null });

        vi.advanceTimersByTime(15000);
        for (let i = 0; i < 6; i += 1) await settle();
        expect(myOrgs.mock.calls.length).toBeGreaterThan(asked);
        expect(flushOutbox).toHaveBeenCalled();
      } finally {
        myOrgs.mockResolvedValue({ data: [ORG_ONE], error: null });
      }
    });

    it('makes no flush request while the queue is empty', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      await startApp({ client });
      await settle();
      flushOutbox.mockClear();

      vi.advanceTimersByTime(60000);
      await settle();

      expect(flushOutbox).not.toHaveBeenCalled();
    });

    it('does not retry before a session is known', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({ session: null });
      await startApp({ client });
      await settle();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);

      vi.advanceTimersByTime(15000);
      await settle();

      expect(flushOutbox).not.toHaveBeenCalled();
    });

    it('starts retrying once the organiser signs in after mount — the session is read at each tick, not captured at mount', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({ session: null });
      await startApp({ client });
      await settle();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);

      client.setSession({ user: { id: 'user-1', email: 'organiser@test.com' } });
      await settle();
      flushOutbox.mockClear(); // the sign-in itself flushes once — not what this test is about

      vi.advanceTimersByTime(15000);
      await settle();

      expect(flushOutbox).toHaveBeenCalledTimes(1);
    });

    it('logs and skips the tick when the queue itself cannot be read, without flushing', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      await startApp({ client });
      await settle();
      flushOutbox.mockClear();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      listPendingOperations.mockRejectedValue(new Error('idb unavailable'));

      try {
        vi.advanceTimersByTime(15000);
        await settle();

        expect(flushOutbox).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalledWith(
          'main: pending-operation check failed',
          expect.objectContaining({ message: 'idb unavailable' }),
        );
      } finally {
        // Reset before the shell's own 3s poll reads it again — a lingering
        // rejection there is not what this test is about.
        listPendingOperations.mockImplementation(() => Promise.resolve([]));
        consoleError.mockRestore();
      }
    });

    it('skips the tick while the device is offline — the online listener covers coming back', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      await startApp({ client });
      await settle();
      flushOutbox.mockClear();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      try {
        vi.advanceTimersByTime(15000);
        await settle();

        expect(flushOutbox).not.toHaveBeenCalled();
      } finally {
        onLine.mockRestore();
      }
    });

    // Found in review (offline-sync-auditor, 2026-09-26): the projector/
    // phone/splash links open this same SPA in another tab, sharing the
    // session and the IndexedDB outbox. A conflict that tab's flush found
    // would be removed from the shared queue and reported to a hidden
    // panel, leaving the organiser's own tab showing "Synced".
    it('never drains the shared queue from an audience tab (chrome: false) — not at load, not on online, not on the timer', async () => {
      stubScreen(mountProjectorSurface, 'PROJECTOR_SCREEN');
      location.hash = '#/live/projector';
      await settleHashDispatch();
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      await startApp({ client });
      await settle();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);

      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(15000);
      await settle();

      expect(flushOutbox).not.toHaveBeenCalled();
    });

    it('stops retrying after unmount', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeReactiveClient({
        session: { user: { id: 'user-1', email: 'organiser@test.com' } },
      });
      const { app } = await startApp({ client });
      await settle();
      await app.unmount();
      activeApp = null; // already torn down — afterEach must not double-unmount it
      flushOutbox.mockClear();
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 1 }]);

      vi.advanceTimersByTime(15000);
      await settle();

      expect(flushOutbox).not.toHaveBeenCalled();
    });
  });

  // Focus-ring fix (2026-09-05, user-reported): a visible focus outline
  // appearing after a mouse-driven navigation, closed by tracking real-time
  // input modality (core/inputModality.js) so base.css can suppress the ring
  // specifically while the tracked modality is 'pointer'. mountApp() is the
  // one call site responsible for starting/stopping that tracker — these two
  // mirror the existing 'online'-listener lifecycle tests immediately above,
  // proving the wiring itself (not the module's own behavior, already fully
  // covered by inputModality.test.js).
  it('starts tracking input modality on mount', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    await startApp();

    expect(trackInputModality).toHaveBeenCalledTimes(1);
  });

  it("stops tracking input modality on unmount, via the tracker's own returned cleanup", async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const { app } = await startApp();
    await app.unmount();
    activeApp = null; // already torn down — afterEach must not double-unmount it

    expect(stopTrackingInputModality).toHaveBeenCalledTimes(1);
  });

  // Found in review (offline-sync-auditor): the background reconnect flush
  // has no screen reading its result, and a dropped operation left the real
  // sync panel on a false "Synced". Since 2026-09-27 the drop reaches the
  // panel through the outbox's own drop announcement (onOperationDropped),
  // not through main.js forwarding the result — coverage stays against the
  // REAL (unmocked) appShell.js, since the bug is about what the panel shows.
  it('surfaces an operation dropped during the reconnect flush on the real sync panel, not a false "Synced"', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    flushOutbox.mockImplementationOnce(async () => {
      announceDrop(new Error('stale conflict'));
      return {
        processed: 0,
        stopped: false,
        permanentFailure: true,
        error: new Error('stale conflict'),
        permanentError: new Error('stale conflict'),
      };
    });
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    const { root } = await startApp({ client });

    expect(flushOutbox).toHaveBeenCalled();
    // The shell announces a pass's drops once its flush ends (checked every
    // DROP_CHECK_MS, 250ms).
    await vi.waitFor(
      () =>
        expect(root.querySelector('.app-shell-sync').textContent).toBe(
          '1 write lost — not saved and not retried',
        ),
      { timeout: 3000 },
    );
  });

  // main.js must not ALSO report the result it gets back: the shell already
  // heard about the drop from the outbox, and a second report would count
  // one lost write as two.
  it('counts a dropped operation once, not once from the outbox and again from the flush result', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    flushOutbox.mockImplementationOnce(async () => {
      announceDrop(new Error('stale conflict'));
      return {
        processed: 0,
        stopped: false,
        permanentFailure: true,
        error: new Error('stale conflict'),
        permanentError: new Error('stale conflict'),
      };
    });
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    const { root } = await startApp({ client });
    await vi.waitFor(
      () => expect(root.querySelector('.app-shell-sync').textContent).toContain('lost'),
      { timeout: 3000 },
    );
    // Past the shell's drop check (DROP_CHECK_MS, 250ms — the mocked outbox
    // reports no flush in progress), so a second (duplicate) report would
    // already have been counted. Keep this wait above DROP_CHECK_MS.
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      '1 write lost — not saved and not retried',
    );
  });

  // Found in review (code-reviewer, 2026-09-26): once the periodic retry
  // existed, a conflict dropped alongside a transient failure was wiped by
  // the next clean flush 15s later — the panel flipped to "Synced" and
  // nobody learned the write was lost. A dropped write never comes back, so
  // its report must outlive later, unrelated successes.
  it('keeps a dropped write reported after a later, clean flush — a later success does not bring it back', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    flushOutbox.mockImplementationOnce(async () => {
      announceDrop(new Error('stale conflict'));
      return {
        processed: 0,
        stopped: true,
        error: new Error('upstream 503'),
        permanentFailure: true,
        permanentError: new Error('stale conflict'),
      };
    });
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    const { root } = await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await vi.waitFor(
      () => expect(root.querySelector('.app-shell-sync').textContent).toContain('lost'),
      { timeout: 3000 },
    );
    window.dispatchEvent(new Event('online')); // default mock: a clean flush
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(flushOutbox).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      '1 write lost — not saved and not retried',
    );
  });

  it('stops listening for dropped operations once the app unmounts', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const { app } = await startApp();
    expect(dropListeners.size).toBe(1);
    await app.unmount();
    activeApp = null; // already torn down — afterEach must not double-unmount it

    expect(dropListeners.size).toBe(0);
  });

  it('a clean (non-permanent-failure) reconnect flush leaves the sync panel reporting normally, not stuck on a stale error', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeReactiveClient({
      session: { user: { id: 'user-1', email: 'organiser@test.com' } },
    });
    const { root } = await startApp({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.app-shell-sync').textContent).not.toContain('failed to save');
  });
});

// ---- team accounts (owner-managed logins) ----
describe('team accounts wiring', () => {
  beforeEach(() => {
    canManageTeam.mockReset();
    canManageTeam.mockResolvedValue(false);
  });

  const signedIn = (extra = {}) => ({
    user: { id: 'user-1', email: 'organiser@test.com', ...extra },
  });

  // Like the reconnect tests' client: onAuthStateChange really calls its subscribers, so the Team
  // link's ownership check runs, and setSession() plays a sign-in/out.
  function reactiveClient(session) {
    let listeners = [];
    let current = session;
    return {
      setSession(next) {
        current = next;
        for (const cb of listeners) cb('SIGNED_IN', next);
      },
      rpc: fakeRpc,
      auth: {
        getSession: () => Promise.resolve({ data: { session: current } }),
        onAuthStateChange: (cb) => {
          listeners.push(cb);
          Promise.resolve().then(() => cb('INITIAL_SESSION', current));
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  listeners = listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        signOut: vi.fn(),
      },
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const teamLink = (root) => root.querySelector('.app-shell-link[href="#/team"]');

  it('someone who signed in with a one-time password sees the choose-a-password screen, not the page they asked for', async () => {
    stubScreen(mountSetPasswordScreen, 'SET_PASSWORD_SCREEN');
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    const client = fakeClient({
      session: signedIn({ user_metadata: { must_change_password: true } }),
    });
    const { root } = await startApp({ client });
    expect(root.textContent).toContain('SET_PASSWORD_SCREEN');
    expect(mountEventsScreen).not.toHaveBeenCalled();
    expect(mountSetPasswordScreen.mock.calls[0][1].client).toBe(client);
    expect(mountSetPasswordScreen.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('the same gate holds on every console route, not just the first one', async () => {
    stubScreen(mountSetPasswordScreen, 'SET_PASSWORD_SCREEN');
    stubScreen(mountRosterScreen, 'ROSTER_SCREEN');
    location.hash = '#/events/ev1/roster';
    const client = fakeClient({
      session: signedIn({ user_metadata: { must_change_password: true } }),
    });
    const { root } = await startApp({ client });
    expect(root.textContent).toContain('SET_PASSWORD_SCREEN');
    expect(mountRosterScreen).not.toHaveBeenCalled();
  });

  it('only an exact true triggers it: a cleared or missing flag goes straight through', async () => {
    for (const metadata of [
      { must_change_password: false },
      {},
      { must_change_password: 'true' },
      undefined,
    ]) {
      vi.clearAllMocks();
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = fakeClient({ session: signedIn({ user_metadata: metadata }) });
      const { root, app } = await startApp({ client });
      expect(root.textContent).toContain('EVENTS_SCREEN');
      expect(mountSetPasswordScreen).not.toHaveBeenCalled();
      await app.unmount();
      activeApp = null;
    }
  });

  it('once the password is chosen, onDone takes them to the screen they originally asked for', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    let finish;
    mountSetPasswordScreen.mockImplementation(async (root, { onDone }) => {
      root.textContent = 'SET_PASSWORD_SCREEN';
      finish = onDone;
      return { unmount: vi.fn() };
    });
    const client = fakeClient({
      session: signedIn({ user_metadata: { must_change_password: true } }),
    });
    const { root } = await startApp({ client });
    expect(root.textContent).toContain('SET_PASSWORD_SCREEN');

    client.setSession(signedIn({ user_metadata: { must_change_password: false } }));
    finish();
    await settle();
    await settle();
    expect(root.textContent).toContain('EVENTS_SCREEN');
  });

  it('#/team mounts the team screen with the org, the client and a real signal', async () => {
    stubScreen(mountTeamScreen, 'TEAM_SCREEN');
    location.hash = '#/team';
    const client = fakeClient();
    const { root } = await startApp({ client });
    expect(root.textContent).toContain('TEAM_SCREEN');
    const args = mountTeamScreen.mock.calls[0][1];
    expect(args.orgId).toBe('org1');
    expect(args.client).toBe(client);
    expect(args.signal).toBeInstanceOf(AbortSignal);
  });

  it('#/team is behind the sign-in gate like every other console route', async () => {
    stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
    stubScreen(mountTeamScreen, 'TEAM_SCREEN');
    location.hash = '#/team';
    const { root } = await startApp({ client: fakeClient({ session: null }) });
    expect(root.textContent).toContain('LOGIN_SCREEN');
    expect(mountTeamScreen).not.toHaveBeenCalled();
  });

  it('shows a Team link to an owner, once the database says so', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const client = reactiveClient(signedIn());
    const { root } = await startApp({ client });
    await settle();
    await settle();
    expect(teamLink(root)).not.toBeNull();
    expect(teamLink(root).textContent).toBe('Team');
    expect(canManageTeam).toHaveBeenCalledWith('org1', client);
  });

  it('puts the Team link before the audience links, which open in new tabs', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const { root } = await startApp({ client: reactiveClient(signedIn()) });
    await settle();
    await settle();
    const labels = [...root.querySelectorAll('.app-shell-link')].map((a) => a.textContent);
    const team = labels.indexOf('Team');
    const splash = labels.findIndex((text) => text.startsWith('Splash screen'));
    expect(team).toBeGreaterThan(-1);
    expect(splash).toBeGreaterThan(-1);
    expect(team).toBeLessThan(splash);
  });

  it('shows no Team link to anyone else — not an organiser, not when the check fails', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(false);
    const first = await startApp({ client: reactiveClient(signedIn()) });
    await settle();
    await settle();
    expect(teamLink(first.root)).toBeNull();
    await first.app.unmount();
    activeApp = null;

    canManageTeam.mockRejectedValue(new Error('network'));
    const second = await startApp({ client: reactiveClient(signedIn()) });
    await settle();
    await settle();
    expect(teamLink(second.root)).toBeNull();
  });

  it('does not even ask while a one-time password is still to be replaced, and shows no link', async () => {
    stubScreen(mountSetPasswordScreen, 'SET_PASSWORD_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const client = reactiveClient(signedIn({ user_metadata: { must_change_password: true } }));
    const { root } = await startApp({ client });
    await settle();
    await settle();
    expect(canManageTeam).not.toHaveBeenCalled();
    expect(teamLink(root)).toBeNull();
  });

  it('keeps the Team link when a later check fails (a dropped connection at a token refresh), but drops it when the answer is a clear no', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const client = reactiveClient(signedIn());
    const { root } = await startApp({ client });
    await settle();
    await settle();
    expect(teamLink(root)).not.toBeNull();

    canManageTeam.mockResolvedValue(null); // the check itself failed
    client.setSession(signedIn());
    await settle();
    await settle();
    expect(teamLink(root)).not.toBeNull();

    canManageTeam.mockRejectedValue(new Error('network')); // threw outright
    client.setSession(signedIn());
    await settle();
    await settle();
    expect(teamLink(root)).not.toBeNull();

    canManageTeam.mockResolvedValue(false); // a clear no
    client.setSession(signedIn());
    await settle();
    await settle();
    expect(teamLink(root)).toBeNull();
  });

  it('takes the link away at once on sign-out', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const client = reactiveClient(signedIn());
    const { root } = await startApp({ client });
    await settle();
    await settle();
    expect(teamLink(root)).not.toBeNull();

    client.setSession(null);
    await settle();
    expect(teamLink(root)).toBeNull();
  });

  it('a slow answer to an earlier check cannot overrule a later one', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    let resolveFirst;
    canManageTeam
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(false);
    const client = reactiveClient(signedIn());
    const { root } = await startApp({ client });
    await settle(); // first check (INITIAL_SESSION) is now waiting
    client.setSession(signedIn()); // a second auth event: answer false
    await settle();
    await settle();
    resolveFirst(true); // the stale answer arrives last
    await settle();
    await settle();
    expect(teamLink(root)).toBeNull();
  });
});

describe('team accounts wiring — edges the first pass missed', () => {
  beforeEach(() => {
    canManageTeam.mockReset();
    canManageTeam.mockResolvedValue(false);
  });

  const signedIn = (extra = {}) => ({
    user: { id: 'user-1', email: 'organiser@test.com', ...extra },
  });
  function reactiveClient(session) {
    let listeners = [];
    let current = session;
    return {
      setSession(next) {
        current = next;
        for (const cb of listeners) cb('SIGNED_IN', next);
      },
      rpc: fakeRpc,
      auth: {
        getSession: () => Promise.resolve({ data: { session: current } }),
        onAuthStateChange: (cb) => {
          listeners.push(cb);
          Promise.resolve().then(() => cb('INITIAL_SESSION', current));
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  listeners = listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        signOut: vi.fn(),
      },
    };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('a flag that is the string "true" is not the one-time-password state for the Team check', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const { root } = await startApp({
      client: reactiveClient(signedIn({ user_metadata: { must_change_password: 'true' } })),
    });
    await settle();
    await settle();
    expect(canManageTeam).toHaveBeenCalled();
    expect(root.querySelector('.app-shell-link[href="#/team"]')).not.toBeNull();
  });

  it('the ownership check is not started from inside the auth callback (supabase-js holds its lock there)', async () => {
    stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
    canManageTeam.mockResolvedValue(true);
    const client = reactiveClient(signedIn());
    await startApp({ client });
    await settle();
    await settle();
    canManageTeam.mockClear();
    client.setSession(signedIn());
    expect(canManageTeam).not.toHaveBeenCalled(); // still inside the (synchronous) callback
    await settle();
    expect(canManageTeam).toHaveBeenCalledTimes(1);
  });

  it('the Team link is marked as the current page on #/team', async () => {
    stubScreen(mountTeamScreen, 'TEAM_SCREEN');
    canManageTeam.mockResolvedValue(true);
    location.hash = '#/team';
    const { root } = await startApp({ client: reactiveClient(signedIn()) });
    await settle();
    await settle();
    expect(root.querySelector('.app-shell-link[href="#/team"]').getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('marks only Team as the current page on #/team, not Events as well', async () => {
    stubScreen(mountTeamScreen, 'TEAM_SCREEN');
    canManageTeam.mockResolvedValue(true);
    location.hash = '#/team';
    const { root } = await startApp({ client: reactiveClient(signedIn()) });
    await settle();
    await settle();
    const current = [...root.querySelectorAll('.app-shell-link[aria-current="page"]')].map(
      (a) => a.textContent,
    );
    expect(current).toEqual(['Team']);
  });
});

// ---------------------------------------------------------------------------------------------
// T-TEN.C2: the console's organisation comes from the signed-in person's memberships, not from a
// build-time variable. Everything above passes with ONE org (the default); these are the 0 / 2-org
// cases, the switch, and the guarantee that the app boots with the old variable unset.
// ---------------------------------------------------------------------------------------------
describe('organisation context wiring (T-TEN.C2)', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const NO_ORG_HEADING = "This account isn't part of an organisation";
  const signedIn = (id = 'user-1', extra = {}) => ({
    user: { id, email: `${id}@test.com`, ...extra },
  });
  const teamLink = (root) => root.querySelector('.app-shell-link[href="#/team"]');

  // onAuthStateChange really calls its subscribers (an INITIAL_SESSION a tick after subscribing, like
  // supabase-js), and setSession() plays a sign-in / sign-out. signOut() clears the session the way
  // supabase-js does. `autoFire: false` leaves the events to the test (client.fire(event, session)).
  function orgClient(session = signedIn(), { autoFire = true } = {}) {
    let listeners = [];
    let current = session;
    const fire = (event, next) => {
      for (const cb of listeners) cb(event, next);
    };
    return {
      fire,
      // The session ends somewhere else (another tab, an expired refresh token).
      signOutElsewhere() {
        current = null;
        fire('SIGNED_OUT', null);
      },
      setSession(next) {
        current = next;
        fire('SIGNED_IN', next);
      },
      rpc: fakeRpc,
      auth: {
        getSession: () => Promise.resolve({ data: { session: current } }),
        onAuthStateChange: (cb) => {
          listeners.push(cb);
          if (autoFire) Promise.resolve().then(() => cb('INITIAL_SESSION', current));
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  listeners = listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
        signOut: vi.fn(async () => {
          current = null;
          fire('SIGNED_OUT', null);
          return { error: null };
        }),
      },
    };
  }
  const answer = (...orgs) => ({ data: orgs, error: null });
  const eventsOrgIds = () => mountEventsScreen.mock.calls.map((call) => call[1].orgId);

  beforeEach(() => {
    localStorage.clear();
    myOrgs.mockReset();
    myOrgs.mockResolvedValue(answer(ORG_ONE));
    canManageTeam.mockReset();
    canManageTeam.mockResolvedValue(false);
    listPendingOperations.mockReset();
    listPendingOperations.mockResolvedValue([]);
    findEventOrgId.mockReset();
    findEventOrgId.mockResolvedValue('org1');
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    // Mock implementations survive vi.clearAllMocks(): no test here may inherit another's screen.
    mountEventsScreen.mockReset();
  });

  describe('which screen a signed-in person gets', () => {
    it('with one org: the console, in that org, after asking the database once', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('EVENTS_SCREEN');
      expect(eventsOrgIds()).toEqual(['org1']);
      expect(myOrgs).toHaveBeenCalledTimes(1);
    });

    it('with two orgs and nothing remembered: the first by name', async () => {
      myOrgs.mockResolvedValue(answer(ORG_TWO, ORG_ONE));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it('with two orgs: the one this user used last', async () => {
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      expect(eventsOrgIds()).toEqual(['org2']);
    });

    it('with no orgs: the "not part of an organisation" screen, never the events screen', async () => {
      myOrgs.mockResolvedValue(answer());
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain(NO_ORG_HEADING);
      // The screen itself names the account (the shell header prints it too, so look inside the outlet).
      expect(root.querySelector('section.screen-container').textContent).toContain(
        'user-1@test.com',
      );
      expect(mountEventsScreen).not.toHaveBeenCalled();
    });

    it('with no orgs, a deep link to an event shows the same screen, not the event', async () => {
      myOrgs.mockResolvedValue(answer());
      stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
      location.hash = '#/events/ev1';
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain(NO_ORG_HEADING);
      expect(mountEventDashboardScreen).not.toHaveBeenCalled();
    });

    it('the no-organisation screen signs out and returns to the sign-in screen', async () => {
      myOrgs.mockResolvedValue(answer());
      stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      root.querySelector('section.screen-container button').click();
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalled());
      await vi.waitFor(() => expect(root.textContent).toContain('LOGIN_SCREEN'));
    });

    it('a failed first load shows a Retry card, and Retry recovers without a reload', async () => {
      myOrgs.mockResolvedValueOnce({ data: null, error: { code: '503', message: 'down' } });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('Could not load your organisation');
      expect(mountEventsScreen).not.toHaveBeenCalled();

      const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      retry.click();
      await vi.waitFor(() => expect(root.textContent).toContain('EVENTS_SCREEN'));
      expect(eventsOrgIds()).toEqual(['org1']);
      expect(myOrgs).toHaveBeenCalledTimes(2);
    });

    it('a console route waits for an answer still on its way, and then mounts once', async () => {
      let answerNow;
      myOrgs.mockReturnValue(new Promise((resolve) => (answerNow = resolve)));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await settle();
      await settle();
      expect(mountEventsScreen).not.toHaveBeenCalled();
      answerNow(answer(ORG_ONE));
      await app.ready;
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it('a person who must choose a password is not asked about organisations at all', async () => {
      stubScreen(mountSetPasswordScreen, 'SET_PASSWORD_SCREEN');
      const client = orgClient(
        signedIn('user-1', { user_metadata: { must_change_password: true } }),
      );
      const { root } = await startApp({ client });
      expect(root.textContent).toContain('SET_PASSWORD_SCREEN');
      expect(myOrgs).not.toHaveBeenCalled();
    });

    it('passes the active org to the Team screen, and none to the event hub (an event knows its own organisation)', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      findEventOrgId.mockResolvedValue('org2');
      await startApp({ client: orgClient() });
      location.hash = '#/events/ev1';
      await settle();
      location.hash = '#/team';
      await settle();
      await settle();
      expect(mountEventDashboardScreen.mock.calls[0][1].orgId).toBeUndefined();
      expect(mountEventDashboardScreen.mock.calls[0][1].eventId).toBe('ev1');
      expect(mountTeamScreen.mock.calls[0][1].orgId).toBe('org2');
    });
  });

  describe('booting without the old build-time organisation', () => {
    it('mounts with VITE_DEFAULT_ORG_ID unset: the console works, nothing throws', async () => {
      vi.stubEnv('VITE_DEFAULT_ORG_ID', '');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const root = document.createElement('div');
      document.body.appendChild(root);
      // No legacyAudienceOrgId option: the default is read from the (empty) environment.
      const app = mountApp(root, { client: orgClient() });
      activeApp = app;
      await app.ready;
      expect(root.textContent).toContain('EVENTS_SCREEN');
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it('the three audience routes then show an "out-of-date link" card instead of crashing', async () => {
      for (const route of ['projector', 'phone', 'splash']) {
        location.hash = `#/live/${route}`;
        const { root } = await startApp({ client: orgClient(), legacyAudienceOrgId: null });
        expect(root.textContent).toContain('This link is out of date');
        await activeApp.unmount();
        activeApp = null;
        root.remove();
      }
      expect(mountProjectorSurface).not.toHaveBeenCalled();
      expect(mountPhoneSummary).not.toHaveBeenCalled();
      expect(mountSplashScreen).not.toHaveBeenCalled();
    });

    it("the audience routes use the legacy organisation, never the signed-in person's active one", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      const routes = [
        ['projector', mountProjectorSurface],
        ['phone', mountPhoneSummary],
        ['splash', mountSplashScreen],
      ];
      for (const [route, screen] of routes) {
        stubScreen(screen, route.toUpperCase());
        location.hash = `#/live/${route}`;
        await startApp({ client: orgClient(), legacyAudienceOrgId: 'legacy-org' });
        expect(screen.mock.calls[0][1].orgId).toBe('legacy-org');
        await activeApp.unmount();
        activeApp = null;
      }
    });

    it('the out-of-date card uses the stage look on the projector and splash, the paper look on a phone', async () => {
      const expectations = [
        ['projector', 'stage'],
        ['splash', 'stage'],
        ['phone', null],
      ];
      for (const [route, surface] of expectations) {
        location.hash = `#/live/${route}`;
        const { root } = await startApp({ client: orgClient(), legacyAudienceOrgId: null });
        const bare = root.querySelector('.app-bare-root');
        expect(bare.getAttribute('data-surface')).toBe(surface);
        expect(
          bare.querySelector('.out-of-date-link .viewer-holding-card h1.viewer-holding-title'),
        ).not.toBeNull();
        await activeApp.unmount();
        activeApp = null;
      }
    });

    it("the organiser's own nav leaves out the three audience links while the organisation has no slug to name", async () => {
      myOrgs.mockResolvedValue(answer({ ...ORG_ONE, slug: '' }));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const labels = (root) =>
        [...root.querySelectorAll('.app-shell-link')].map((link) =>
          link.textContent.replace(/\s*\(.*\)$/, ''),
        );
      const { root } = await startApp({ client: orgClient() });
      expect(labels(root)).toEqual(['Events', 'People']);
    });

    it('the audience links no longer depend on the legacy settings: any organisation has them, whatever the old links are set to', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const labels = (root) =>
        [...root.querySelectorAll('.app-shell-link')].map((link) =>
          link.textContent.replace(/\s*\(.*\)$/, ''),
        );
      for (const legacy of [
        { legacyAudienceOrgId: null, legacyAudienceOrgSlug: null },
        { legacyAudienceOrgId: 'some-other-org', legacyAudienceOrgSlug: 'someone-else' },
      ]) {
        const { root } = await startApp({ client: orgClient(), ...legacy });
        expect(labels(root)).toEqual([
          'Events',
          'People',
          'Splash screen',
          'Projector view',
          'Phone view',
        ]);
        await activeApp.unmount();
        activeApp = null;
      }
    });
  });

  describe('switching organisation', () => {
    async function startTwoOrgs() {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      return startApp({ client: orgClient() });
    }

    it('shows the other org on the events screen', async () => {
      const { app } = await startTwoOrgs();
      expect(eventsOrgIds()).toEqual(['org1']);
      expect(await app.switchOrg('org2')).toEqual({ ok: true });
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
      // Everything mounted from the switch on is the new org's (jsdom may resolve a hash change twice).
      expect(new Set(eventsOrgIds().slice(1))).toEqual(new Set(['org2']));
      expect(localStorage.getItem('seduh.activeOrg.user-1')).toBe('org2');
    });

    it('from deep inside an event, goes back to the events list of the new org', async () => {
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const { app, root } = await startTwoOrgs();
      expect(root.textContent).toContain('SETUP_SCREEN');
      await app.switchOrg('org2');
      await vi.waitFor(() => expect(location.hash).toBe('#/events'));
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
      expect(new Set(eventsOrgIds())).toEqual(new Set(['org2']));
    });

    it('a screen still loading for the old org is aborted, and nothing it fetched lands in the new org', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      let finishOldLoad;
      mountEventsScreen.mockImplementation(async (outlet, { orgId, signal }) => {
        if (orgId === 'org1') await new Promise((resolve) => (finishOldLoad = resolve));
        // The same guard every real screen has: a navigation that started after this one wins.
        if (signal.aborted) return undefined;
        outlet.textContent = `EVENTS_OF_${orgId}`;
        return { unmount: vi.fn() };
      });
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() => expect(mountEventsScreen).toHaveBeenCalledTimes(1));

      expect(await app.switchOrg('org2')).toEqual({ ok: true });
      await vi.waitFor(() => expect(root.textContent).toContain('EVENTS_OF_org2'));
      expect(mountEventsScreen.mock.calls[0][1].signal.aborted).toBe(true);

      finishOldLoad();
      await settle();
      await settle();
      expect(root.textContent).toContain('EVENTS_OF_org2');
      expect(root.textContent).not.toContain('EVENTS_OF_org1');
    });

    it('is refused while changes made on this device have not synced, with a message to show', async () => {
      const { app } = await startTwoOrgs();
      listPendingOperations.mockResolvedValue([{ id: 'op1' }]);
      const result = await app.switchOrg('org2');
      expect(result).toEqual({
        ok: false,
        reason: 'unsynced',
        count: 1,
        message:
          '1 change on this device has not synced yet. Wait for it to sync before switching organisation.',
      });
      expect(app.orgContext.getActiveOrgId()).toBe('org1');
      await settle();
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it('says "changes … have" for several', async () => {
      const { app } = await startTwoOrgs();
      listPendingOperations.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      const result = await app.switchOrg('org2');
      expect(result.count).toBe(3);
      expect(result.message).toBe(
        '3 changes on this device have not synced yet. Wait for them to sync before switching organisation.',
      );
    });

    it('is refused when it cannot tell whether anything is unsynced', async () => {
      const { app } = await startTwoOrgs();
      listPendingOperations.mockRejectedValue(new Error('IndexedDB blocked'));
      const result = await app.switchOrg('org2');
      expect(result).toMatchObject({ ok: false, reason: 'unknown' });
      expect(app.orgContext.getActiveOrgId()).toBe('org1');
    });

    it('is refused for an org this account does not belong to', async () => {
      const { app } = await startTwoOrgs();
      const result = await app.switchOrg('org-not-mine');
      expect(result).toMatchObject({ ok: false, reason: 'unknown_org' });
      expect(app.orgContext.getActiveOrgId()).toBe('org1');
    });

    it('switching to the org already active does nothing, and does not even look at the outbox', async () => {
      const { app } = await startTwoOrgs();
      listPendingOperations.mockClear();
      expect(await app.switchOrg('org1')).toEqual({ ok: true });
      expect(listPendingOperations).not.toHaveBeenCalled();
      await settle();
      expect(eventsOrgIds()).toEqual(['org1']);
    });
  });

  describe('an organisation that changes underneath the console', () => {
    it('a membership that disappears at a later refresh moves the console to the other org', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      await startApp({ client });
      expect(eventsOrgIds()).toEqual(['org2']);

      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn());
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org1'));
      expect(new Set(eventsOrgIds())).toEqual(new Set(['org2', 'org1']));
    });

    it('losing the last membership replaces the console with the "not part of an organisation" screen', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      expect(root.textContent).toContain('EVENTS_SCREEN');

      myOrgs.mockResolvedValue(answer());
      client.setSession(signedIn());
      await vi.waitFor(() => expect(root.textContent).toContain(NO_ORG_HEADING));
    });

    it('a role change inside the same org does not move anyone', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      await startApp({ client });
      myOrgs.mockResolvedValue(answer({ ...ORG_ONE, role: 'organiser' }));
      client.setSession(signedIn());
      await settle();
      await settle();
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it("a different person signing in never sees the previous person's org", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient(signedIn('user-1'));
      const { app } = await startApp({ client });
      await app.switchOrg('org2');
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));

      // user-2 belongs only to org1
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn('user-2'));
      await vi.waitFor(() => expect(app.orgContext.getState().userId).toBe('user-2'));
      await vi.waitFor(() => expect(app.orgContext.getState().status).toBe('ready'));
      expect(app.orgContext.getActiveOrgId()).toBe('org1');
      // And the screen follows: the console built for user-1 in org2 is replaced, not left standing.
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org1'));
    });
  });

  describe('the Team link follows the active org', () => {
    it('is offered only while the org the person owns is the active one', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      canManageTeam.mockImplementation((orgId) => Promise.resolve(orgId === 'org1'));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(teamLink(root)).not.toBeNull());
      expect(canManageTeam).toHaveBeenCalledWith('org1', expect.anything());

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(teamLink(root)).toBeNull());
      expect(canManageTeam).toHaveBeenCalledWith('org2', expect.anything());

      await app.switchOrg('org1');
      await vi.waitFor(() => expect(teamLink(root)).not.toBeNull());
    });

    it('the link of the previous org is gone at once on a switch, before the new answer arrives', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      let answerOrg2;
      canManageTeam.mockImplementation((orgId) =>
        orgId === 'org1' ? Promise.resolve(true) : new Promise((resolve) => (answerOrg2 = resolve)),
      );
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(teamLink(root)).not.toBeNull());

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(teamLink(root)).toBeNull());
      answerOrg2(true);
      await vi.waitFor(() => expect(teamLink(root)).not.toBeNull());
    });

    it("a check that fails after a switch leaves the link out, never the other org's answer", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      canManageTeam.mockImplementation((orgId) =>
        orgId === 'org1' ? Promise.resolve(true) : Promise.resolve(null),
      );
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(teamLink(root)).not.toBeNull());
      await app.switchOrg('org2');
      await settle();
      await settle();
      expect(teamLink(root)).toBeNull();
    });

    it('is not offered to an account in no organisation', async () => {
      myOrgs.mockResolvedValue(answer());
      canManageTeam.mockResolvedValue(true);
      const { root } = await startApp({ client: orgClient() });
      await settle();
      expect(canManageTeam).not.toHaveBeenCalled();
      expect(teamLink(root)).toBeNull();
    });
  });

  describe('the org context a mounted app owns', () => {
    it('an app that made its own context ends it on unmount: nothing is asked or announced afterwards', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      const context = app.orgContext;
      const listener = vi.fn();
      context.subscribe(listener);
      await app.unmount();
      activeApp = null;
      myOrgs.mockClear();
      await context.refresh(signedIn());
      expect(myOrgs).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it('a context handed in belongs to the caller: unmount leaves it working', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { createOrgContext } = await import('./core/orgContext.js');
      const client = orgClient();
      const orgContext = createOrgContext({ client, storage: null });
      const { app } = await startApp({ client, orgContext });
      expect(app.orgContext).toBe(orgContext);
      await app.unmount();
      activeApp = null;
      myOrgs.mockClear();
      await orgContext.refresh(signedIn());
      expect(myOrgs).toHaveBeenCalledTimes(1);
      orgContext.destroy();
    });
  });

  describe('the console follows who and which org is in force (a second tab, an expired session)', () => {
    it('another account signing in on this browser replaces the console, not just the context', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient(signedIn('user-1'));
      await startApp({ client });
      expect(eventsOrgIds()).toEqual(['org2']);

      client.setSession(signedIn('user-2'));
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org1'));
    });

    it('another account with no organisation gets the "not part of an organisation" screen', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient(signedIn('user-1'));
      const { root } = await startApp({ client });
      myOrgs.mockResolvedValue(answer());
      client.setSession(signedIn('user-2'));
      await vi.waitFor(() => expect(root.textContent).toContain(NO_ORG_HEADING));
    });

    it('a sign-out the router never saw (another tab, an expired session) shows the sign-in screen', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      expect(root.textContent).toContain('EVENTS_SCREEN');
      client.signOutElsewhere();
      await vi.waitFor(() => expect(root.textContent).toContain('LOGIN_SCREEN'));
    });

    it('a change that nobody chose does not add a history entry (Back must not return to the old org)', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      findEventOrgId.mockResolvedValue('org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const client = orgClient();
      await startApp({ client });
      await settle();
      const before = history.length;
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn());
      await vi.waitFor(() => expect(location.hash).toBe('#/events'));
      expect(history.length).toBe(before);
    });

    it('never moves anyone off an audience route, even after they were using the console', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSplashScreen, 'SPLASH');
      const { app } = await startApp({ client: orgClient(), legacyAudienceOrgId: 'org1' });
      location.hash = '#/live/splash';
      await settle();
      await settle();
      expect(location.hash).toBe('#/live/splash');
      app.orgContext.setActiveOrg('org2');
      await settle();
      await settle();
      expect(location.hash).toBe('#/live/splash');
    });

    it('does nothing at all once the app is unmounted, even for a context it was handed', async () => {
      const { createOrgContext } = await import('./core/orgContext.js');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const orgContext = createOrgContext({ client, storage: null });
      const { app } = await startApp({ client, orgContext });
      await app.unmount();
      activeApp = null;
      location.hash = '#/events/ev1/setup';
      await settle();
      canManageTeam.mockClear();
      orgContext.setActiveOrg('org2');
      await settle();
      await settle();
      expect(location.hash).toBe('#/events/ev1/setup');
      expect(canManageTeam).not.toHaveBeenCalled();
      orgContext.destroy();
    });

    it('a Retry clicked after the app was unmounted mounts nothing', async () => {
      const { createOrgContext } = await import('./core/orgContext.js');
      myOrgs.mockResolvedValue({ data: null, error: { code: '503' } });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      // A context the app does not own, so it is still alive and able to answer after the unmount.
      const orgContext = createOrgContext({ client, storage: null });
      const { root, app } = await startApp({ client, orgContext });
      const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      await app.unmount();
      activeApp = null;
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      retry.click();
      await settle();
      await settle();
      expect(mountEventsScreen).not.toHaveBeenCalled();
      orgContext.destroy();
    });
  });

  describe('waiting for the organisation question', () => {
    it('shows a status message instead of a blank page while the answer is on its way', async () => {
      let answerNow;
      myOrgs.mockReturnValue(new Promise((resolve) => (answerNow = resolve)));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() =>
        expect(root.querySelector('section.screen-container [role="status"]')?.textContent).toBe(
          'Loading your organisation…',
        ),
      );
      answerNow(answer(ORG_ONE));
      await app.ready;
      expect(root.textContent).toContain('EVENTS_SCREEN');
      expect(root.textContent).not.toContain('Loading your organisation');
    });

    it('a navigation that finds a newer question in flight waits for that one, not the first', async () => {
      const client = orgClient(signedIn(), { autoFire: false });
      let failFirst;
      let answerSecond;
      myOrgs
        .mockReturnValueOnce(new Promise((_resolve, reject) => (failFirst = reject)))
        .mockReturnValueOnce(new Promise((resolve) => (answerSecond = resolve)));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client, legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() => expect(myOrgs).toHaveBeenCalledTimes(1));

      client.fire('TOKEN_REFRESHED', signedIn()); // a newer question starts
      await vi.waitFor(() => expect(myOrgs).toHaveBeenCalledTimes(2));
      failFirst(new Error('network'));
      await settle();
      await settle();
      expect(root.textContent).not.toContain('Could not load your organisation');

      answerSecond(answer(ORG_ONE));
      await app.ready;
      expect(root.textContent).toContain('EVENTS_SCREEN');
    });

    it('a navigation superseded while the question is open paints nothing', async () => {
      let answerNow;
      myOrgs.mockReturnValue(new Promise((resolve) => (answerNow = resolve)));
      stubScreen(mountSplashScreen, 'SPLASH');
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() => expect(myOrgs).toHaveBeenCalledTimes(1));
      location.hash = '#/live/splash';
      await settle();
      await settle();

      answerNow(answer()); // no organisation: would paint the "not part of an organisation" screen
      await settle();
      await settle();
      expect(root.querySelector('.app-shell-root').textContent).not.toContain(NO_ORG_HEADING);
    });

    it('a sign-out that lands while waiting leads to the sign-in screen, not an organisation error', async () => {
      let answerNow;
      myOrgs.mockReturnValue(new Promise((resolve) => (answerNow = resolve)));
      stubLogin();
      const client = orgClient();
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client, legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() => expect(myOrgs).toHaveBeenCalledTimes(1));
      client.signOutElsewhere();
      answerNow(answer(ORG_ONE));
      await vi.waitFor(() => expect(root.textContent).toContain('LOGIN_SCREEN'));
      expect(root.textContent).not.toContain('Could not load your organisation');
    });

    function stubLogin() {
      stubScreen(mountLoginScreen, 'LOGIN_SCREEN');
    }

    it('plain navigation after a failed first load asks again (not only the Retry button)', async () => {
      myOrgs.mockResolvedValueOnce({ data: null, error: { code: '503' } });
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('Could not load your organisation');
      location.hash = '#/team';
      await vi.waitFor(() => expect(root.textContent).toContain('TEAM_SCREEN'));
      expect(myOrgs).toHaveBeenCalledTimes(2);
    });

    it('once settled as "no organisation", further navigation asks nothing more', async () => {
      myOrgs.mockResolvedValue(answer());
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
      await startApp({ client: orgClient() });
      location.hash = '#/team';
      await settle();
      location.hash = '#/events/ev1';
      await settle();
      await settle();
      expect(myOrgs).toHaveBeenCalledTimes(1);
    });

    it('the Retry button shows it is working and ignores a second click', async () => {
      myOrgs.mockResolvedValueOnce({ data: null, error: { code: '503' } });
      let answerNow;
      myOrgs.mockReturnValueOnce(new Promise((resolve) => (answerNow = resolve)));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const getSession = vi.spyOn(client.auth, 'getSession');
      const { root } = await startApp({ client });
      const sessionChecksBefore = getSession.mock.calls.length;
      const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      retry.click();
      retry.click();
      expect(retry.textContent).toBe('Retrying…');
      expect(retry.getAttribute('aria-disabled')).toBe('true');
      await settle();
      expect(myOrgs).toHaveBeenCalledTimes(2);
      // One click, one re-resolve of the route (each re-resolve checks the session once).
      expect(getSession.mock.calls.length - sessionChecksBefore).toBe(1);
      answerNow(answer(ORG_ONE));
      await vi.waitFor(() => expect(root.textContent).toContain('EVENTS_SCREEN'));
      expect(myOrgs).toHaveBeenCalledTimes(2);
    });
  });

  describe('a flaky connection', () => {
    const rememberOrgOne = () =>
      localStorage.setItem('seduh.orgs.user-1', JSON.stringify([ORG_ONE]));

    it('a reload with no answer for the organisation question boots from the remembered list', async () => {
      rememberOrgOne();
      myOrgs.mockResolvedValue({ data: null, error: { code: '503' } });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('EVENTS_SCREEN');
      expect(eventsOrgIds()).toEqual(['org1']);
      expect(app.orgContext.getState().stale).toBe(true);
    });

    it('coming back online re-asks, and replaces the stand-in with the real answer', async () => {
      rememberOrgOne();
      myOrgs.mockResolvedValueOnce({ data: null, error: { code: '503' } });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      expect(app.orgContext.getState().stale).toBe(true);
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(app.orgContext.getState().stale).toBe(false));
      expect(myOrgs).toHaveBeenCalledTimes(2);
    });

    it('coming back online replaces the "could not load" card with the console', async () => {
      myOrgs.mockResolvedValueOnce({ data: null, error: { code: '503' } });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('Could not load your organisation');
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(root.textContent).toContain('EVENTS_SCREEN'));
    });

    it('coming back online with nothing wrong does not ask again', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(myOrgs).toHaveBeenCalledTimes(1);
    });
  });

  describe('operations queued on this device', () => {
    it('are not replayed under the login of someone who belongs to no organisation', async () => {
      myOrgs.mockResolvedValue(answer());
      await startApp({ client: orgClient() });
      await settle();
      flushOutbox.mockClear();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(flushOutbox).not.toHaveBeenCalled();
    });

    it('are still replayed for someone who does (and the flush is what the same event triggers)', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      await settle();
      flushOutbox.mockClear();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(flushOutbox).toHaveBeenCalled();
    });

    it('wait while the organisation answer is missing or an error, and are replayed when it arrives', async () => {
      // An operation is only replayed in the organisation it was made in (T-TEN.C6), so with no answer
      // there is nothing a flush could run; the answer, when it comes, starts one.
      myOrgs.mockResolvedValue({ data: null, error: { code: '503' } });
      await startApp({ client: orgClient() });
      await settle();
      flushOutbox.mockClear();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(flushOutbox).not.toHaveBeenCalled();

      myOrgs.mockResolvedValue(answer(ORG_ONE));
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(flushOutbox).toHaveBeenCalled());
    });
  });

  describe('the outbox is told whose work it is (T-TEN.C6)', () => {
    const owners = () => setOutboxOwner.mock.calls.map((call) => call[0]);
    const lastOwner = () => setOutboxOwner.mock.calls.at(-1)[0];

    beforeEach(() => {
      setOutboxOwner.mockClear();
      flushOutbox.mockClear();
    });

    it('starts with nobody, then names the signed-in account and its organisation once that is answered', async () => {
      await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      expect(owners()[0]).toBeNull();
    });

    it('never names an organisation it has not been told about: before the answer the owner has none', async () => {
      let release;
      myOrgs.mockReturnValue(new Promise((resolve) => (release = resolve)));
      const started = startApp({ client: orgClient() });
      await settle();
      expect(lastOwner()).toEqual({ userId: 'user-1', orgId: null });
      expect(flushOutbox).not.toHaveBeenCalled();
      release(answer(ORG_ONE));
      await started;
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
    });

    it('follows a switch to the other organisation, and flushes for it', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      const { app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      flushOutbox.mockClear();

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org2' }));
      await vi.waitFor(() => expect(flushOutbox).toHaveBeenCalled());
    });

    it('is told BEFORE the flush that the change allows: the flush never runs for the old owner', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      const { app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      flushOutbox.mockClear();
      const seenByFlush = [];
      flushOutbox.mockImplementation(() => {
        seenByFlush.push(lastOwner());
        return Promise.resolve({ processed: 0, stopped: false, permanentFailure: false });
      });

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(seenByFlush.length).toBeGreaterThan(0));
      expect(seenByFlush[0]).toEqual({ userId: 'user-1', orgId: 'org2' });
      flushOutbox.mockImplementation(() =>
        Promise.resolve({ processed: 0, stopped: false, permanentFailure: false }),
      );
    });

    it('goes back to nobody when the account signs out, and names the next account that signs in', async () => {
      const client = orgClient();
      await startApp({ client });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));

      client.signOutElsewhere();
      expect(lastOwner()).toBeNull();

      myOrgs.mockResolvedValue(answer({ ...ORG_ONE }));
      client.setSession(signedIn('user-2'));
      expect(lastOwner()).toEqual({ userId: 'user-2', orgId: null });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-2', orgId: 'org1' }));
    });

    it("never pairs the previous account with the next one's organisation", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      const client = orgClient();
      await startApp({ client });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org2' }));

      // another account signs in on the same device: the first account's organisation must not follow
      setOutboxOwner.mockClear();
      client.setSession(signedIn('user-2'));
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-2', orgId: 'org1' }));
      const seenForUserTwo = owners().filter((owner) => owner?.userId === 'user-2');
      expect(seenForUserTwo.length).toBeGreaterThan(0);
      for (const owner of seenForUserTwo) expect(owner.orgId).not.toBe('org2');
    });

    it('names the same account again when it signs out and back in, and flushes once its organisation is answered', async () => {
      const client = orgClient();
      await startApp({ client });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      client.signOutElsewhere();
      expect(lastOwner()).toBeNull();
      flushOutbox.mockClear();
      client.setSession(signedIn('user-1'));
      expect(lastOwner()).toEqual({ userId: 'user-1', orgId: null });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      await vi.waitFor(() => expect(flushOutbox).toHaveBeenCalled());
    });

    it('names nobody once the app is unmounted', async () => {
      const { app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(lastOwner()).toEqual({ userId: 'user-1', orgId: 'org1' }));
      await app.unmount();
      activeApp = null;
      expect(lastOwner()).toBeNull();
    });

    it('does not flush for an account that is in no organisation', async () => {
      myOrgs.mockResolvedValue(answer());
      await startApp({ client: orgClient() });
      await settle();
      window.dispatchEvent(new Event('online'));
      await settle();
      expect(flushOutbox).not.toHaveBeenCalled();
      expect(lastOwner()).toEqual({ userId: 'user-1', orgId: null });
    });
  });

  describe('a link into an event of another organisation (T-TEN.C7)', () => {
    const notice = (root) => root.querySelector('.app-shell-org-notice');
    const noticeOpen = (root) => notice(root).classList.contains('app-shell-org-notice-open');
    const activeOrgOf = (app) => app.orgContext.getState().activeOrgId;

    async function startTwoOrgsAt(hash, eventOrg) {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockResolvedValue(eventOrg);
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      stubScreen(mountEventDashboardScreen, 'DASHBOARD_SCREEN');
      stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
      location.hash = hash;
      return startApp({ client: orgClient() });
    }

    beforeEach(() => {
      findEventOrgId.mockReset();
      findEventOrgId.mockResolvedValue('org1');
      findMatchEventId.mockReset();
      cacheGet.mockReset();
      cacheGet.mockResolvedValue(null);
      cacheSet.mockClear();
    });

    it('an event in the active organisation just opens: nothing switches, no notice', async () => {
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      expect(root.textContent).toContain('SETUP_SCREEN');
      expect(activeOrgOf(app)).toBe('org1');
      expect(noticeOpen(root)).toBe(false);
      expect(findEventOrgId).toHaveBeenCalledWith('ev1', expect.anything());
    });

    it('an event in the other organisation of the person switches to it, says so, and opens the event there', async () => {
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
      // still on the event: the switch did not send them to the Events list
      expect(location.hash).toBe('#/events/ev1/setup');
      expect(noticeOpen(root)).toBe(true);
      expect(notice(root).textContent).toBe(
        'Now working in Org Two, the organisation this event belongs to.',
      );
      expect(notice(root).dataset.tone).toBe('info');
      expect(root.querySelector('.app-shell-org select').value).toBe('org2');
      // the Events list, opened next, is the new organisation's
      location.hash = '#/events';
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
    });

    it('never mounts the event before the switch has happened', async () => {
      const seen = [];
      mountSetupScreen.mockImplementation(async (outlet) => {
        seen.push(setActiveOrgSeen());
        outlet.textContent = 'SETUP_SCREEN';
        return { unmount: vi.fn() };
      });
      let setActiveOrgSeen = () => null;
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockResolvedValue('org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      location.hash = '#/events/ev1/setup';
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      setActiveOrgSeen = () => app.orgContext.getState().activeOrgId;
      await app.ready;
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(seen).toEqual(['org2']);
    });

    it('reads a BTC match through its event: the match decides, not the event id in the URL', async () => {
      findMatchEventId.mockResolvedValue('ev9');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockImplementation(async (eventId) => (eventId === 'ev9' ? 'org2' : 'org1'));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
      location.hash = '#/events/ev1/btc/matches/m1/scoring';
      const { app, root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('BTC_SCORING_SCREEN'));
      expect(findMatchEventId).toHaveBeenCalledWith('m1', expect.anything());
      expect(findEventOrgId).toHaveBeenCalledWith('ev9', expect.anything());
      expect(activeOrgOf(app)).toBe('org2');
    });

    it('an event in an organisation the person is not in is "not found", and nothing switches', async () => {
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org9');
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      expect(root.textContent).not.toContain('SETUP_SCREEN');
      expect(activeOrgOf(app)).toBe('org1');
      expect(mountSetupScreen).not.toHaveBeenCalled();
    });

    it('an event that is not there, or cannot be seen, is "not found" too', async () => {
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', null);
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      expect(mountSetupScreen).not.toHaveBeenCalled();
    });

    it('a malformed event id is "not found", not a Retry that can never work', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockRejectedValue(
        Object.assign(new Error('invalid input'), { code: '22P02' }),
      );
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      location.hash = '#/events/not-a-uuid/setup';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
    });

    it('a match that is not there is "not found"', async () => {
      findMatchEventId.mockResolvedValue(null);
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      location.hash = '#/events/ev1/btc/matches/m1/scoring';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      expect(mountBtcScoringScreen).not.toHaveBeenCalled();
    });

    it("while this account's changes in the current organisation have not synced, says the event is in the other one and why it cannot open yet", async () => {
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 0 }]);
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('This event is in Org Two'));
      const heading = root.querySelector('.screen-container h1');
      expect(document.activeElement).toBe(heading);
      const reason = root.querySelector('#other-org-reason');
      expect(heading.getAttribute('aria-describedby')).toBe('other-org-reason');
      expect(reason.textContent).toBe(
        'You are working in Org One. 1 change on this device has not synced yet, so this event cannot be opened yet. Wait for it to sync, then try again.',
      );
      expect(root.querySelector('.screen-container a[href="#/events"]').textContent).toBe(
        'Back to Org One events',
      );
      expect(activeOrgOf(app)).toBe('org1');
      expect(mountSetupScreen).not.toHaveBeenCalled();
      // the header names no event while a card that is not one is on show
      expect(root.querySelector('.app-shell-context').textContent).not.toContain('October');
    });

    it('the notice does not follow the person to the next screen', async () => {
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      location.hash = '#/events';
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(false));
    });

    it('a card is not an event: the header stops naming the event while it is up', async () => {
      findEvent.mockResolvedValue({ id: 'ev1', name: 'October Cup', format: 'cup_taster' });
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 0 }]);
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('This event is in Org Two'));
      await settle();
      await settle();
      expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
      findEvent.mockResolvedValue({ id: 'ev1', format: 'cup_taster' });
    });

    it('says it in the plural', async () => {
      listPendingOperations.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const first = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() =>
        expect(first.root.querySelector('#other-org-reason')?.textContent).toContain(
          '2 changes on this device have not synced yet, so this event cannot be opened yet. Wait for them to sync',
        ),
      );
    });

    it("Try again opens the event once everything has synced, in the event's organisation", async () => {
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 0 }]);
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('This event is in Org Two'));
      // let every navigation the browser started for this link finish first: only Try again may open it now
      for (let i = 0; i < 4; i += 1) await settle();
      expect(mountSetupScreen).not.toHaveBeenCalled();
      listPendingOperations.mockResolvedValue([]);
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click();
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
    });

    it('a blocked card is tracked like any screen: choosing an organisation in the header takes the person to its Events list', async () => {
      listPendingOperations.mockResolvedValue([{ id: 'op-1', attempts: 0 }]);
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('This event is in Org Two'));
      listPendingOperations.mockResolvedValue([]);
      await app.switchOrg('org2');
      await vi.waitFor(() => expect(location.hash).toBe('#/events'));
    });

    it('two organisations with the same name are told apart by slug in the notice', async () => {
      const twin = { org_id: 'org2', name: 'Org One', slug: 'org-one-nz', role: 'owner' };
      myOrgs.mockResolvedValue(answer(ORG_ONE, twin));
      findEventOrgId.mockResolvedValue('org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      expect(notice(root).textContent).toBe(
        'Now working in Org One (org-one-nz), the organisation this event belongs to.',
      );
    });

    describe('a person with ONE organisation (never switched, never held up)', () => {
      async function startOneOrgAt(hash) {
        myOrgs.mockResolvedValue(answer(ORG_ONE));
        stubScreen(mountSetupScreen, 'SETUP_SCREEN');
        stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        mountSetupScreen.mockClear();
        mountBtcScoringScreen.mockClear();
        location.hash = hash;
        return startApp({ client: orgClient() });
      }

      it('an event of their organisation opens, after one question about whose it is', async () => {
        findEventOrgId.mockResolvedValue('org1');
        const { app, root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
        expect(findEventOrgId).toHaveBeenCalledWith('ev1', expect.anything());
        expect(activeOrgOf(app)).toBe('org1');
        expect(noticeOpen(root)).toBe(false);
      });

      it('remembers the answer on the device: what is remembered decides, with no read at all', async () => {
        // a remembered answer for an event of an organisation that is NOT theirs: "not found", and nothing was asked
        cacheGet.mockImplementation(async (key) =>
          key === 'eventOrg:ev1' ? 'org-someone-else' : null,
        );
        const { root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
        expect(cacheGet).toHaveBeenCalledWith('eventOrg:ev1');
        expect(findEventOrgId).not.toHaveBeenCalled();
        expect(mountSetupScreen).not.toHaveBeenCalled();
      });

      it('...and one remembered as theirs opens straight away, with no read', async () => {
        cacheGet.mockImplementation(async (key) => (key === 'eventOrg:ev1' ? 'org1' : null));
        const { root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
        expect(findEventOrgId).not.toHaveBeenCalled();
      });

      it('writes what it finds to the device, so the next visit to that event asks nothing', async () => {
        findEventOrgId.mockResolvedValue('org1');
        const { root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
        expect(cacheSet).toHaveBeenCalledWith('eventOrg:ev1', 'org1');
      });

      it('an event the database hides from them (or that is not there) is "Page not found", and its screen is never mounted', async () => {
        findEventOrgId.mockResolvedValue(null);
        const { root } = await startOneOrgAt('#/events/ev-elsewhere/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
        expect(mountSetupScreen).not.toHaveBeenCalled();
        expect(noticeOpen(root)).toBe(false);
      });

      it('an event that is in an organisation that is not theirs is "Page not found" too, and they are not moved', async () => {
        findEventOrgId.mockResolvedValue('org-someone-else');
        const { app, root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
        expect(mountSetupScreen).not.toHaveBeenCalled();
        expect(activeOrgOf(app)).toBe('org1');
      });

      it('a malformed event id is "not found", not a Retry that can never work', async () => {
        findEventOrgId.mockRejectedValue(
          Object.assign(new Error('invalid input'), { code: '22P02' }),
        );
        const { root } = await startOneOrgAt('#/events/not-a-uuid/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      });

      it('FAILS OPEN: when the question cannot be answered (offline, an error), the event screen opens exactly as it did before', async () => {
        // what a real fetch throws when there is no network
        findEventOrgId.mockRejectedValue(new TypeError('Failed to fetch'));
        const { root } = await startOneOrgAt('#/events/ev1/setup');
        await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
        // it WAS asked, and could not be answered
        expect(findEventOrgId).toHaveBeenCalledWith('ev1', expect.anything());
        expect(root.textContent).not.toContain('Page not found');
        // and no Retry card stands in front of it (a person with several organisations gets one: they need the answer)
        expect(root.textContent).not.toMatch(/try again/i);
      });

      describe('a question that takes too long is given up on (fake clock: the whole question has ONE 2.5s budget)', () => {
        async function opensAfter(hash, hang) {
          vi.useFakeTimers({ toFake: ['setTimeout'] });
          try {
            myOrgs.mockResolvedValue(answer(ORG_ONE));
            stubScreen(mountSetupScreen, 'SETUP_SCREEN');
            mountBtcScoringScreen.mockImplementation(async (outlet) => {
              outlet.textContent = 'SETUP_SCREEN';
              return { unmount: vi.fn() };
            });
            stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
            // the console is up first, then the person follows the link (as the other fake-clock tests do)
            location.hash = '#/events';
            const { root } = await startApp({ client: orgClient() });
            hang();
            location.hash = hash;
            await vi.advanceTimersByTimeAsync(2400);
            expect(root.textContent).not.toContain('SETUP_SCREEN');
            expect(root.textContent).not.toContain('Page not found');
            await vi.advanceTimersByTimeAsync(300);
            expect(root.textContent).toContain('SETUP_SCREEN');
            expect(root.textContent).not.toContain('Page not found');
          } finally {
            vi.useRealTimers();
          }
        }

        it('an event whose organisation never answers', async () => {
          await opensAfter('#/events/ev1/setup', () => {
            findEventOrgId.mockReturnValue(new Promise(() => {}));
          });
          expect(findEventOrgId).toHaveBeenCalled();
        });

        it("a BTC match whose event never answers, then the event's organisation as well: still one budget, not one per read", async () => {
          await opensAfter('#/events/ev1/btc/matches/m1/scoring', () => {
            findMatchEventId.mockReturnValue(new Promise(() => {}));
            findEventOrgId.mockReturnValue(new Promise(() => {}));
          });
          findMatchEventId.mockResolvedValue(null);
        });

        it('a device memory that never answers', async () => {
          await opensAfter('#/events/ev1/setup', () => {
            cacheGet.mockReturnValue(new Promise(() => {}));
            findEventOrgId.mockReturnValue(new Promise(() => {}));
          });
        });
      });

      it('a BTC match is resolved through its event: its own event opens, a match that is not there is "not found"', async () => {
        findMatchEventId.mockResolvedValue('ev9');
        findEventOrgId.mockImplementation(async (eventId) => (eventId === 'ev9' ? 'org1' : null));
        const first = await startOneOrgAt('#/events/ev1/btc/matches/m1/scoring');
        await vi.waitFor(() => expect(first.root.textContent).toContain('BTC_SCORING_SCREEN'));
        expect(findMatchEventId).toHaveBeenCalledWith('m1', expect.anything());
        expect(findEventOrgId).toHaveBeenCalledWith('ev9', expect.anything());
        await first.app.unmount();

        findMatchEventId.mockResolvedValue(null);
        mountBtcScoringScreen.mockClear();
        const second = await startOneOrgAt('#/events/ev1/btc/matches/m2/scoring');
        await vi.waitFor(() => expect(second.root.textContent).toContain('Page not found'));
        expect(mountBtcScoringScreen).not.toHaveBeenCalled();
      });

      it('a BTC match whose event is remembered on the device is opened without asking the network at all', async () => {
        cacheGet.mockImplementation(async (key) =>
          key === 'matchEvent:m1' ? 'ev9' : key === 'eventOrg:ev9' ? 'org1' : null,
        );
        const { root } = await startOneOrgAt('#/events/ev1/btc/matches/m1/scoring');
        await vi.waitFor(() => expect(root.textContent).toContain('BTC_SCORING_SCREEN'));
        expect(findMatchEventId).not.toHaveBeenCalled();
        expect(findEventOrgId).not.toHaveBeenCalled();
      });

      it('while the list of organisations is only the remembered stand-in, "not in my list" proves nothing: the screen opens', async () => {
        // The real list could not be fetched, so the one remembered on this device stands in (marked stale). The
        // event is answered as belonging to an organisation that is not in that list (the person was added to it
        // since): their own event must not be called "not found".
        localStorage.setItem(
          'seduh.orgs.user-1',
          JSON.stringify([{ org_id: 'org1', name: 'Org One', slug: 'org-one', role: 'owner' }]),
        );
        try {
          myOrgs.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
          findEventOrgId.mockResolvedValue('org-added-since');
          stubScreen(mountSetupScreen, 'SETUP_SCREEN');
          mountSetupScreen.mockClear();
          location.hash = '#/events/ev1/setup';
          const { app, root } = await startApp({ client: orgClient() });
          await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
          // the premise: the list really is the stand-in, and the event really was looked up
          expect(app.orgContext.getState().stale).toBe(true);
          expect(findEventOrgId).toHaveBeenCalledWith('ev1', expect.anything());
          expect(root.textContent).not.toContain('Page not found');
        } finally {
          localStorage.removeItem('seduh.orgs.user-1');
        }
      });

      it('routes that are not about an event never ask', async () => {
        await startOneOrgAt('#/events');
        await settle();
        expect(findEventOrgId).not.toHaveBeenCalled();
        expect(findMatchEventId).not.toHaveBeenCalled();
      });
    });

    it('routes that are not about an event never ask', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      location.hash = '#/events';
      await startApp({ client: orgClient() });
      location.hash = '#/team';
      await settle();
      await settle();
      expect(findEventOrgId).not.toHaveBeenCalled();
    });

    it('remembers which organisation an event is in, and never remembers "there is none"', async () => {
      await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      expect(cacheSet).toHaveBeenCalledWith('eventOrg:ev1', 'org1');
      cacheSet.mockClear();
      findEventOrgId.mockResolvedValue(null);
      location.hash = '#/events/ev2/setup';
      await vi.waitFor(() => expect(findEventOrgId).toHaveBeenCalledWith('ev2', expect.anything()));
      await settle();
      expect(cacheSet).not.toHaveBeenCalled();
    });

    it('uses what it remembered at once, without asking the network (an event never changes organisation)', async () => {
      cacheGet.mockImplementation(async (key) => (key === 'eventOrg:ev1' ? 'org2' : null));
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
      expect(findEventOrgId).not.toHaveBeenCalled();
    });

    it('a remembered answer for an organisation the person is no longer in is "not found"', async () => {
      cacheGet.mockImplementation(async (key) => (key === 'eventOrg:ev1' ? 'org9' : null));
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
    });

    it('a device memory that never answers does not hang the navigation', async () => {
      cacheGet.mockImplementation(() => new Promise(() => {}));
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'), {
        timeout: 4000,
      });
    });

    it('a device memory that fails to read or to write still lets the event open', async () => {
      cacheGet.mockRejectedValue(new Error('idb'));
      cacheSet.mockRejectedValue(new Error('idb'));
      const { root } = await startTwoOrgsAt('#/events/ev1/setup', 'org1');
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
    });

    it('a match read that fails falls back to the remembered event of that match; a read that works is remembered', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      cacheGet.mockImplementation(async (key) => (key === 'matchEvent:m1' ? 'ev9' : null));
      findMatchEventId.mockRejectedValue(new TypeError('Failed to fetch'));
      findEventOrgId.mockResolvedValue('org1');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
      location.hash = '#/events/ev1/btc/matches/m1/scoring';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('BTC_SCORING_SCREEN'));
      expect(findEventOrgId).toHaveBeenCalledWith('ev9', expect.anything());

      findMatchEventId.mockReset();
      findMatchEventId.mockResolvedValue('ev9');
      location.hash = '#/events/ev1/btc/matches/m2/scoring';
      await vi.waitFor(() => expect(cacheSet).toHaveBeenCalledWith('matchEvent:m2', 'ev9'));
    });

    it('a malformed match id is "not found"', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findMatchEventId.mockRejectedValue(Object.assign(new Error('invalid'), { code: '22P02' }));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      location.hash = '#/events/ev1/btc/matches/nope/scoring';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
    });

    it('a match whose event is in the active organisation opens there, whatever organisation the URL event is in', async () => {
      findMatchEventId.mockResolvedValue('ev-mine');
      findEventOrgId.mockImplementation(async (id) => (id === 'ev-mine' ? 'org1' : 'org2'));
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountBtcScoringScreen, 'BTC_SCORING_SCREEN');
      location.hash = '#/events/ev-other/btc/matches/m1/scoring';
      const { app, root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('BTC_SCORING_SCREEN'));
      expect(activeOrgOf(app)).toBe('org1');
      expect(noticeOpen(root)).toBe(false);
    });

    it('a match whose event is in an organisation the person is not in is "not found"', async () => {
      findMatchEventId.mockResolvedValue('ev9');
      findEventOrgId.mockResolvedValue('org9');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      location.hash = '#/events/ev1/btc/matches/m1/scoring';
      const { root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('Page not found'));
      expect(mountBtcScoringScreen).not.toHaveBeenCalled();
    });

    it('a lookup that never answers gives the timeout Retry, not a guess, and Retry asks again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
        findEventOrgId.mockImplementation(() => new Promise(() => {}));
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        stubScreen(mountSetupScreen, 'SETUP_SCREEN');
        location.hash = '#/events/ev1/setup';
        const root = document.createElement('div');
        document.body.appendChild(root);
        const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
        activeApp = app;
        await vi.advanceTimersByTimeAsync(11000);
        await vi.advanceTimersByTimeAsync(0);
        expect(root.textContent).toContain('taking longer than expected');
        expect(mountSetupScreen).not.toHaveBeenCalled();
        findEventOrgId.mockResolvedValue('org1');
        [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click();
        await vi.advanceTimersByTimeAsync(50);
        expect(root.textContent).toContain('SETUP_SCREEN');
      } finally {
        vi.useRealTimers();
      }
    });

    it('with no connection, uses what it remembered (and switches to it)', async () => {
      cacheGet.mockImplementation(async (key) => (key === 'eventOrg:ev1' ? 'org2' : null));
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockRejectedValue(new TypeError('Failed to fetch'));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const { app, root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
    });

    it('with no connection and nothing remembered, shows a Retry, never a guess, and Retry works', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      findEventOrgId.mockResolvedValue('org1');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const { root } = await startApp({ client: orgClient() });
      expect(root.textContent).not.toContain('SETUP_SCREEN');
      expect(mountSetupScreen).not.toHaveBeenCalled();
      const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
      expect(retry).toBeTruthy();
      const asked = findEventOrgId.mock.calls.length;
      retry.click();
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(findEventOrgId.mock.calls.length).toBeGreaterThan(asked);
    });

    it('the notice goes when the person taps elsewhere, and the organisation stays switched', async () => {
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(noticeOpen(root)).toBe(false);
      expect(activeOrgOf(app)).toBe('org2');
    });

    it('from a screen already on show, the link switches without sending the person back to the Events list', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events';
      const { app, root } = await startApp({ client: orgClient() });
      expect(root.textContent).toContain('EVENTS_SCREEN');
      findEventOrgId.mockResolvedValue('org2');
      location.hash = '#/events/ev1/setup';
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
      await settle();
      await settle();
      expect(location.hash).toBe('#/events/ev1/setup');
      // The screen was built for the new organisation, so a later move back is a real change: the person
      // is taken to the Events list of the organisation they are now in.
      await app.switchOrg('org1');
      await vi.waitFor(() => expect(location.hash).toBe('#/events'));
    });

    it('the screen is built for the NEW organisation: a later change of organisation is judged against it', async () => {
      const { app, root } = await startTwoOrgsAt('#/events/ev1/setup', 'org2');
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      // Nothing changes while the person is on the event: the console must not take them away from it.
      await app.orgContext.refresh(signedIn());
      await settle();
      await settle();
      expect(location.hash).toBe('#/events/ev1/setup');
      expect(root.textContent).toContain('SETUP_SCREEN');
      // ...but a real change of organisation still sends them to the Events list of the new one.
      await app.switchOrg('org1');
      await vi.waitFor(() => expect(location.hash).toBe('#/events'));
    });

    it("if the organisation is not the event's once the switch is over, it starts again rather than mounting under the wrong one", async () => {
      const { createOrgContext } = await import('./core/orgContext.js');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockResolvedValue('org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      const client = orgClient();
      const orgContext = createOrgContext({ client, storage: null });
      const realSet = orgContext.setActiveOrg;
      // Something else moves the organisation straight back, as the switch reports success.
      orgContext.setActiveOrg = (orgId) => {
        const ok = realSet(orgId);
        if (orgId === 'org2') realSet('org1');
        return ok;
      };
      location.hash = '#/events/ev1/setup';
      const { root } = await startApp({ client, orgContext });
      await vi.waitFor(() =>
        expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Retry')).toBe(
          true,
        ),
      );
      expect(mountSetupScreen).not.toHaveBeenCalled();
    });

    it('an organisation chosen in the header while the lookup is on its way starts the link again under it', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      const lateAnswers = [];
      findEventOrgId.mockImplementation(() => new Promise((resolve) => lateAnswers.push(resolve)));
      location.hash = '#/events/ev1/setup';
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client: orgClient(), legacyAudienceOrgId: 'org1' });
      activeApp = app;
      await vi.waitFor(() => expect(lateAnswers.length).toBeGreaterThan(0));
      // the person picks the other organisation in the header while it is still being looked up
      app.orgContext.setActiveOrg('org2');
      findEventOrgId.mockResolvedValue('org1');
      for (const answerLate of lateAnswers) answerLate('org1');
      // ...the stale navigation is not mounted under the old label: it starts again, and ends in the
      // event's own organisation
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org1');
    });

    it('a Team screen holding a one-time password does not stop a link from opening (the link is replacing it anyway)', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      findEventOrgId.mockResolvedValue('org2');
      let teamOptions;
      mountTeamScreen.mockImplementation(async (outlet, options) => {
        teamOptions = options;
        outlet.textContent = 'TEAM_SCREEN';
        return { unmount: vi.fn() };
      });
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/team';
      const { app, root } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(root.textContent).toContain('TEAM_SCREEN'));
      teamOptions.onLeaveGuard(true);
      location.hash = '#/events/ev1/setup';
      await vi.waitFor(() => expect(root.textContent).toContain('SETUP_SCREEN'));
      expect(activeOrgOf(app)).toBe('org2');
      // and the header's select works afterwards: the flag did not stay set
      const back = await app.switchOrg('org1');
      expect(back.ok).toBe(true);
    });

    it('a link abandoned while the outbox is being checked opens nothing and says nothing', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events';
      const { root } = await startApp({ client: orgClient() });
      findEventOrgId.mockResolvedValue('org2');
      let finishCheck;
      listPendingOperations.mockImplementation(
        () => new Promise((resolve) => (finishCheck = resolve)),
      );
      location.hash = '#/events/ev1/setup';
      await vi.waitFor(() => expect(finishCheck).toBeTypeOf('function'));
      location.hash = '#/events';
      await settle();
      finishCheck([]);
      await settle();
      await settle();
      expect(mountSetupScreen).not.toHaveBeenCalled();
      expect(noticeOpen(root)).toBe(false);
    });

    it('every event-keyed console route is checked for a person in two organisations', async () => {
      const paths = [
        '',
        '/setup',
        '/roster',
        '/report',
        '/stages/s1/heats',
        '/stages/s1/standings',
        '/heats/h1/timing',
        '/heats/h1/scoring',
        '/btc/setup',
        '/btc/matches',
        '/btc/standings',
        '/btc/bracket',
      ];
      for (const path of paths) {
        findEventOrgId.mockClear();
        location.hash = `#/events/ev1${path}`;
        const { app } = await startTwoOrgsAt(`#/events/ev1${path}`, 'org1');
        expect(findEventOrgId, path).toHaveBeenCalledWith('ev1', expect.anything());
        await app.unmount();
        activeApp = null;
      }
    });

    it('a navigation that moves on while the lookup is in flight opens only the newer screen', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      const lateAnswers = [];
      findEventOrgId.mockImplementation(() => new Promise((resolve) => lateAnswers.push(resolve)));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSetupScreen, 'SETUP_SCREEN');
      location.hash = '#/events/ev1/setup';
      const { app, root } = await startTwoOrgsLate();
      async function startTwoOrgsLate() {
        const root2 = document.createElement('div');
        document.body.appendChild(root2);
        const app2 = mountApp(root2, { client: orgClient(), legacyAudienceOrgId: 'org1' });
        activeApp = app2;
        await settle();
        await settle();
        return { app: app2, root: root2 };
      }
      location.hash = '#/events';
      await settle();
      expect(lateAnswers.length).toBeGreaterThan(0);
      for (const answerOld of lateAnswers) answerOld('org2'); // the old lookups answer late
      await settle();
      await settle();
      expect(mountSetupScreen).not.toHaveBeenCalled();
      expect(app.orgContext.getState().activeOrgId).toBe('org1');
      expect(root.textContent).toContain('EVENTS_SCREEN');
    });
  });

  describe('the audience links are built for the active organisation (T-TEN.D4)', () => {
    it('names the organiser in the hash, trimmed and encoded, and has nothing to name for a blank slug', () => {
      expect(audienceHash('  alpha-coffee ', 'phone')).toBe('#/live/alpha-coffee/phone');
      expect(audienceHash('a b/c', 'splash')).toBe('#/live/a%20b%2Fc/splash');
      for (const none of ['', '   ', null, undefined, 7])
        expect(audienceHash(none, 'phone')).toBeNull();
    });

    it('builds absolute links from where the page is served, and none for a blank slug', () => {
      const where = { origin: 'https://seduh.example', pathname: '/app/' };
      expect(audienceLinksFor(' alpha ', where)).toEqual({
        phone: 'https://seduh.example/app/#/live/alpha/phone',
        projector: 'https://seduh.example/app/#/live/alpha/projector',
        splash: 'https://seduh.example/app/#/live/alpha/splash',
      });
      expect(audienceLinksFor('  ', where)).toBeNull();
    });

    it("tells the Events screen the active organisation's three slug-qualified links, absolute, for the page it is served from", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      const page = `${location.origin}${location.pathname}`;
      expect(mountEventsScreen.mock.calls[0][1].audienceLinks).toEqual({
        phone: `${page}#/live/org-one/phone`,
        projector: `${page}#/live/org-one/projector`,
        splash: `${page}#/live/org-one/splash`,
      });
      const before = mountEventsScreen.mock.calls.length;
      await app.switchOrg('org2');
      await vi.waitFor(() => expect(mountEventsScreen.mock.calls.length).toBeGreaterThan(before));
      expect(mountEventsScreen.mock.calls.at(-1)[1].audienceLinks.phone).toBe(
        `${page}#/live/org-two/phone`,
      );
    });

    it('gives the Events screen no links for an organisation with no slug', async () => {
      myOrgs.mockResolvedValue(answer({ ...ORG_ONE, slug: '  ' }));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      expect(mountEventsScreen.mock.calls[0][1].audienceLinks).toBeNull();
    });
  });

  describe('the Events screen is told whose events these are (T-TEN.C5)', () => {
    it("passes the active organisation's id and name, and follows a switch", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      expect(mountEventsScreen.mock.calls[0][1]).toMatchObject({
        orgId: 'org1',
        orgName: 'Org One',
      });
      const before = mountEventsScreen.mock.calls.length;

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(mountEventsScreen.mock.calls.length).toBeGreaterThan(before));
      expect(mountEventsScreen.mock.calls.at(-1)[1]).toMatchObject({
        orgId: 'org2',
        orgName: 'Org Two',
      });
    });

    it("offers each organisation's own audience links: the active organisation's slug is in every link", async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const hrefs = (root) =>
        [...root.querySelectorAll('.app-shell-link[target="_blank"]')].map((link) =>
          link.getAttribute('href'),
        );
      const { root, app } = await startApp({ client: orgClient() });
      expect(hrefs(root)).toEqual([
        '#/live/org-one/splash',
        '#/live/org-one/projector',
        '#/live/org-one/phone',
      ]);

      await app.switchOrg('org2');
      await vi.waitFor(() =>
        expect(hrefs(root)).toEqual([
          '#/live/org-two/splash',
          '#/live/org-two/projector',
          '#/live/org-two/phone',
        ]),
      );
    });

    it('tells same-named organisations apart by slug', async () => {
      const twin = { org_id: 'org2', name: 'Org One', slug: 'org-one-nz', role: 'owner' };
      myOrgs.mockResolvedValue(answer(ORG_ONE, twin));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      await startApp({ client: orgClient() });
      expect(mountEventsScreen.mock.calls[0][1]).toMatchObject({
        orgId: 'org2',
        orgName: 'Org One (org-one-nz)',
      });
    });
  });

  describe('the Team screen is told whose team it is (T-TEN.C4)', () => {
    it("passes the active organisation's name to the Team route", async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      location.hash = '#/team';
      await startApp({ client: orgClient() });
      expect(mountTeamScreen.mock.calls[0][1]).toMatchObject({ orgId: 'org1', orgName: 'Org One' });
    });

    it('follows a switch: the next Team screen is for the new organisation', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      await app.switchOrg('org2');
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
      location.hash = '#/team';
      await vi.waitFor(() => expect(mountTeamScreen).toHaveBeenCalled());
      expect(mountTeamScreen.mock.calls.at(-1)[1]).toMatchObject({
        orgId: 'org2',
        orgName: 'Org Two',
      });
    });

    it('Team in one organisation, switch, Team in the other: each is told its own name', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      location.hash = '#/team';
      const { app } = await startApp({ client: orgClient() });
      expect(mountTeamScreen.mock.calls.at(-1)[1]).toMatchObject({
        orgId: 'org1',
        orgName: 'Org One',
      });
      const mountsBefore = mountTeamScreen.mock.calls.length;

      await app.switchOrg('org2');
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
      location.hash = '#/team';
      await vi.waitFor(() =>
        expect(mountTeamScreen.mock.calls.length).toBeGreaterThan(mountsBefore),
      );
      expect(mountTeamScreen.mock.calls.at(-1)[1]).toMatchObject({
        orgId: 'org2',
        orgName: 'Org Two',
      });

      await app.switchOrg('org1');
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org1'));
      const mountsMid = mountTeamScreen.mock.calls.length;
      location.hash = '#/team';
      await vi.waitFor(() => expect(mountTeamScreen.mock.calls.length).toBeGreaterThan(mountsMid));
      expect(mountTeamScreen.mock.calls.at(-1)[1]).toMatchObject({
        orgId: 'org1',
        orgName: 'Org One',
      });
    });

    it('names the organisation from the same snapshot the id came from, never from live state a moment later', async () => {
      const { createOrgContext } = await import('./core/orgContext.js');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      const client = orgClient();
      const orgContext = createOrgContext({ client, storage: null });
      // Live state that disagrees with the snapshot: the wrong organisation.
      orgContext.getActiveOrg = () => ({ id: 'org2', name: 'Org Two', slug: 'org-two', role: '' });
      location.hash = '#/team';
      try {
        await startApp({ client, orgContext });
        expect(mountTeamScreen.mock.calls[0][1]).toMatchObject({
          orgId: 'org1',
          orgName: 'Org One',
        });
      } finally {
        orgContext.destroy();
      }
    });

    describe('leaving the Team screen with a one-time password on show', () => {
      // A Team screen that reports a risk when the test says so, like the real one does.
      let guard;
      const stubTeamWithGuard = () =>
        mountTeamScreen.mockImplementation(async (root, params) => {
          root.textContent = 'TEAM_SCREEN';
          guard = params.onLeaveGuard;
          return { unmount: vi.fn() };
        });

      it('refuses a switch, saying why, until the person has finished there', async () => {
        myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        stubTeamWithGuard();
        location.hash = '#/team';
        const { app } = await startApp({ client: orgClient() });
        guard(true);
        const refused = await app.switchOrg('org2');
        expect(refused).toMatchObject({ ok: false, reason: 'team_open' });
        expect(refused.message).toBe(
          'The Team screen has a one-time password showing, or a change still being saved. Finish that first (press Done), then switch organisation.',
        );
        expect(app.orgContext.getActiveOrgId()).toBe('org1');

        guard(false);
        expect(await app.switchOrg('org2')).toEqual({ ok: true });
      });

      it('shows the refusal under the header when the person uses the select', async () => {
        myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        stubTeamWithGuard();
        location.hash = '#/team';
        const { root } = await startApp({ client: orgClient() });
        guard(true);
        const select = root.querySelector('.app-shell-org-select');
        select.value = 'org2';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() =>
          expect(root.querySelector('#app-shell-org-notice').textContent).toContain(
            'one-time password showing',
          ),
        );
        expect(root.querySelector('.app-shell-org-notice-open')).not.toBeNull();
        expect(select.value).toBe('org1');
      });

      it('no longer applies once the person has gone to another screen', async () => {
        myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        stubTeamWithGuard();
        location.hash = '#/team';
        const { app } = await startApp({ client: orgClient() });
        guard(true);
        location.hash = '#/events';
        await vi.waitFor(() => expect(mountEventsScreen).toHaveBeenCalled());
        expect(await app.switchOrg('org2')).toEqual({ ok: true });
      });

      it("does not apply to a different screen's switch before the Team screen was ever opened", async () => {
        myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
        stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
        const { app } = await startApp({ client: orgClient() });
        expect(await app.switchOrg('org2')).toEqual({ ok: true });
      });
    });

    it('tells two organisations with the same name apart by slug', async () => {
      const twin = { org_id: 'org2', name: 'Org One', slug: 'org-one-nz', role: 'owner' };
      myOrgs.mockResolvedValue(answer(ORG_ONE, twin));
      stubScreen(mountTeamScreen, 'TEAM_SCREEN');
      location.hash = '#/team';
      await startApp({ client: orgClient() });
      expect(mountTeamScreen.mock.calls[0][1].orgName).toBe('Org One (org-one)');
    });
  });

  describe('the Team link across a switch', () => {
    it('an answer for the previous org that arrives late is ignored', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      let answerOrg1;
      canManageTeam.mockImplementation((orgId) =>
        orgId === 'org1'
          ? new Promise((resolve) => (answerOrg1 = resolve))
          : Promise.resolve(false),
      );
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      await vi.waitFor(() => expect(answerOrg1).toBeDefined());
      await app.switchOrg('org2');
      await settle();
      await settle();
      answerOrg1(true);
      await settle();
      await settle();
      expect(teamLink(root)).toBeNull();
    });
  });

  describe('the organisation in the header (T-TEN.C3)', () => {
    const slotOf = (root) => root.querySelector('.app-shell-org');
    const selectOf = (root) => root.querySelector('.app-shell-org-select');
    const noticeOf = (root) => root.querySelector('#app-shell-org-notice');
    const choose = (root, orgId) => {
      const select = selectOf(root);
      select.focus();
      select.value = orgId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    it('names the organisation the person is working in, as a plain label when there is one', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect(slotOf(root).hidden).toBe(false);
      expect(slotOf(root).textContent).toBe('Organisation: Org One');
      expect(selectOf(root)).toBeNull();
    });

    it('offers a choice when there are several, on the active one', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      expect([...selectOf(root).options].map((o) => o.value)).toEqual(['org1', 'org2']);
      expect(selectOf(root).value).toBe('org2');
    });

    it('shows nothing for an account in no organisation', async () => {
      myOrgs.mockResolvedValue(answer());
      const { root } = await startApp({ client: orgClient() });
      expect(slotOf(root).hidden).toBe(true);
    });

    it('says nothing on a plain first load', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      await settle();
      expect(noticeOf(root).textContent).toBe('');
    });

    it('choosing another organisation switches and announces it', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      choose(root, 'org2');
      await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.'),
      );
      expect(selectOf(root).value).toBe('org2');
      // (Where focus goes after a switch is the new screen's own rule; tests/e2e covers it with real screens.)
      // The announcement is heard, not shown as a panel.
      expect(noticeOf(root).classList.contains('app-shell-org-notice-open')).toBe(false);
    });

    it('a refused switch puts the control back and shows why, without moving anything', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root, app } = await startApp({ client: orgClient() });
      listPendingOperations.mockResolvedValue([{ id: 'op1' }, { id: 'op2' }]);
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          '2 changes on this device have not synced yet. Wait for them to sync before switching organisation.',
        ),
      );
      expect(noticeOf(root).classList.contains('app-shell-org-notice-open')).toBe(true);
      expect(selectOf(root).value).toBe('org1');
      expect(app.orgContext.getActiveOrgId()).toBe('org1');
      expect(document.activeElement).toBe(selectOf(root));
      await settle();
      expect(eventsOrgIds()).toEqual(['org1']);
    });

    it('a switch that works after an earlier refusal clears the refusal and announces the switch', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      listPendingOperations.mockResolvedValue([{ id: 'op1' }]);
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).classList.contains('app-shell-org-notice-open')).toBe(true),
      );
      listPendingOperations.mockResolvedValue([]);
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.'),
      );
      expect(noticeOf(root).classList.contains('app-shell-org-notice-open')).toBe(false);
    });

    it('a change nobody asked for is announced as such', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      localStorage.setItem('seduh.activeOrg.user-1', 'org2');
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn());
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your organisation changed. Now working in Org One. Showing Events.',
        ),
      );
    });

    it('a change nobody asked for is not mistaken for an earlier deliberate choice', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.'),
      );
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn());
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your organisation changed. Now working in Org One. Showing Events.',
        ),
      );
    });

    it('losing every organisation announces nothing here (the screen that replaces the console takes focus)', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      myOrgs.mockResolvedValue(answer());
      client.setSession(signedIn());
      await vi.waitFor(() => expect(root.textContent).toContain(NO_ORG_HEADING));
      expect(noticeOf(root).textContent).toBe('');
      expect(slotOf(root).hidden).toBe(true);
    });

    it('is filled at mount when the organisations are already known (a context handed in ready)', async () => {
      const { createOrgContext } = await import('./core/orgContext.js');
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const orgContext = createOrgContext({ client, storage: null });
      await orgContext.refresh(signedIn());
      const root = document.createElement('div');
      document.body.appendChild(root);
      const app = mountApp(root, { client, orgContext, legacyAudienceOrgId: 'org1' });
      activeApp = app;
      try {
        // Before any change has been announced to the app, the control is already there.
        expect(selectOf(root)?.value).toBe('org1');
        await app.ready;
      } finally {
        orgContext.destroy();
      }
    });

    it('an earlier deliberate choice is not mistaken for a later change nobody asked for', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.'),
      );
      // Org Two goes away, then comes back as the only one: the move back to it is nobody's choice.
      myOrgs.mockResolvedValue(answer(ORG_ONE));
      client.setSession(signedIn());
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your organisation changed. Now working in Org One. Showing Events.',
        ),
      );
      myOrgs.mockResolvedValue(answer(ORG_TWO));
      client.setSession(signedIn());
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your organisation changed. Now working in Org Two. Showing Events.',
        ),
      );
    });

    it('a choice that was refused is not remembered as one', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root, app } = await startApp({ client });
      expect(await app.switchOrg('org9')).toMatchObject({ ok: false, reason: 'unknown_org' });
      // Both organisations go away and org9 arrives: nobody chose that.
      myOrgs.mockResolvedValue(
        answer({ org_id: 'org9', name: 'Org Nine', slug: 'org-nine', role: 'owner' }),
      );
      client.setSession(signedIn());
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your organisation changed. Now working in Org Nine. Showing Events.',
        ),
      );
    });

    it('a header that fails to render never stops the screen swap (the old organisation must not stay on show)', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { root, app } = await startApp({ client: orgClient() });
      expect(eventsOrgIds()).toEqual(['org1']);
      // From now on, drawing the organisation slot throws (it sets the select's tooltip every time).
      const replaceSpy = vi
        .spyOn(HTMLElement.prototype, 'title', 'set')
        .mockImplementation(function () {
          if (this.classList?.contains('app-shell-org-select'))
            throw new Error('slot render failed');
        });
      try {
        app.orgContext.setActiveOrg('org2');
        await vi.waitFor(() => expect(eventsOrgIds().at(-1)).toBe('org2'));
        expect(errorSpy).toHaveBeenCalledWith(
          'main: the organisation slot failed to render',
          expect.any(Error),
        );
        expect(root.textContent).toContain('EVENTS_SCREEN');
      } finally {
        replaceSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });

    it('a role change inside the same organisation is silent', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      myOrgs.mockResolvedValue(answer({ ...ORG_ONE, role: 'organiser' }));
      client.setSession(signedIn());
      // The refresh really happened (and the role really changed) before nothing was announced.
      await vi.waitFor(() => expect(myOrgs).toHaveBeenCalledTimes(2));
      await settle();
      await settle();
      expect(noticeOf(root).textContent).toBe('');
    });

    it('a new organisation appearing at a refresh shows up in the list, without announcing anything', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient();
      const { root } = await startApp({ client });
      myOrgs.mockResolvedValue(
        answer(ORG_ONE, ORG_TWO, {
          org_id: 'org3',
          name: 'Org Three',
          slug: 'org-three',
          role: 'owner',
        }),
      );
      client.setSession(signedIn());
      await vi.waitFor(() => expect(selectOf(root).options).toHaveLength(3));
      expect(selectOf(root).value).toBe('org1');
      expect(noticeOf(root).textContent).toBe('');
    });

    it('never announces anything while the person is on an audience route', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      stubScreen(mountSplashScreen, 'SPLASH');
      const { root, app } = await startApp({ client: orgClient(), legacyAudienceOrgId: 'org1' });
      location.hash = '#/live/splash';
      await settle();
      await settle();
      expect(app.orgContext.setActiveOrg('org2')).toBe(true);
      await settle();
      await settle();
      expect(app.orgContext.getActiveOrgId()).toBe('org2');
      expect(noticeOf(root).textContent).toBe('');
    });

    it('the announcement survives the new screen taking focus (the select blurs moments after it is written)', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      // A screen like the real ones: its loading state focuses its own status region on mount.
      mountEventsScreen.mockImplementation(async (outlet) => {
        outlet.innerHTML = '';
        const status = document.createElement('div');
        status.setAttribute('tabindex', '-1');
        status.textContent = 'Loading…';
        outlet.appendChild(status);
        status.focus();
        return { unmount: vi.fn() };
      });
      const { root } = await startApp({ client: orgClient() });
      await settle();
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.'),
      );
      // The select lost focus to the new screen; the announcement is still there afterwards.
      await vi.waitFor(() => expect(document.activeElement).not.toBe(selectOf(root)));
      await settle();
      await settle();
      expect(noticeOf(root).textContent).toBe('Now working in Org Two. Showing Events.');
    });

    it('names a deliberate switch by the same label the list uses, so same-named organisations sound different', async () => {
      const twin = { org_id: 'org2', name: 'Org One', slug: 'org-one-nz', role: 'owner' };
      myOrgs.mockResolvedValue(answer(ORG_ONE, twin));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { root } = await startApp({ client: orgClient() });
      choose(root, 'org2');
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Now working in Org One (org-one-nz). Showing Events.',
        ),
      );
    });

    it('says "account or organisation" when it was a different person who arrived', async () => {
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const client = orgClient(signedIn('user-1'));
      const { root } = await startApp({ client });
      client.setSession(signedIn('user-2'));
      await vi.waitFor(() =>
        expect(noticeOf(root).textContent).toBe(
          'Your account or organisation changed. Now working in Org One. Showing Events.',
        ),
      );
    });

    it('a switch whose outbox check never answers is refused after the shared timeout, not left hanging', async () => {
      myOrgs.mockResolvedValue(answer(ORG_ONE, ORG_TWO));
      stubScreen(mountEventsScreen, 'EVENTS_SCREEN');
      const { app } = await startApp({ client: orgClient() });
      vi.useFakeTimers();
      try {
        listPendingOperations.mockReturnValue(new Promise(() => {}));
        const pending = app.switchOrg('org2');
        await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
        expect(await pending).toMatchObject({ ok: false, reason: 'unknown' });
        expect(app.orgContext.getActiveOrgId()).toBe('org1');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
