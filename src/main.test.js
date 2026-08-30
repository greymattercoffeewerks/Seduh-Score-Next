import { describe, it, expect, vi, afterEach } from 'vitest';

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

const { mountApp } = await import('./main.js');

function stubScreen(mockFn, marker) {
  mockFn.mockImplementation(async (root) => {
    root.textContent = marker;
    return { unmount: vi.fn() };
  });
}

let activeApp = null;
async function startApp(overrides = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = mountApp(root, { client: {}, orgId: 'org1', ...overrides });
  await app.ready;
  activeApp = app;
  return { root, app };
}

afterEach(async () => {
  await activeApp?.unmount();
  activeApp = null;
  location.hash = '';
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
      expect.objectContaining({ orgId: 'org1' }),
    );

    location.hash = '#/live/phone';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('PHONE_SCREEN');
    expect(mountPhoneSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1' }),
    );
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
