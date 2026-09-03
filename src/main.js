// Composition root (2026-08-29 app-wiring pass). The one file allowed to
// know both "this app is Cup Taster" (the `defaultFormat: 'cup_taster'`
// passed into core/eventsScreen.js) and the full route table connecting
// every already-built, already-reviewed screen. Everything downstream stays
// format-agnostic (core/router.js has zero opinion about screens or chrome)
// or is itself the format module being wired (formats/cup-taster/*).
import { createRouter } from './core/router.js';
import { mountAppShell } from './core/appShell.js';
import { getDefaultOrgId } from './core/config.js';
import { getSupabase } from './core/supabaseClient.js';
import { el } from './core/dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './core/timeout.js';
import { mountEventsScreen } from './core/eventsScreen.js';
import { mountLoginScreen } from './core/loginScreen.js';
import { mountSplashScreen } from './core/splashScreen.js';
import { mountEventDashboardScreen } from './formats/cup-taster/eventDashboardScreen.js';
import { mountSetupScreen } from './formats/cup-taster/setupScreen.js';
import { mountRosterScreen } from './formats/cup-taster/rosterScreen.js';
import { mountReportScreen } from './formats/cup-taster/reportScreen.js';
import { mountHeatGenerationScreen } from './formats/cup-taster/heatsScreen.js';
import { mountStandingsScreen } from './formats/cup-taster/standingsScreen.js';
import { mountTimingRouteScreen } from './formats/cup-taster/timingRouteScreen.js';
import { mountScoringScreen } from './formats/cup-taster/scoringScreen.js';
import { mountProjectorSurface } from './formats/cup-taster/projectorSurface.js';
import { mountPhoneSummary } from './formats/cup-taster/phoneSummary.js';

// Same "unreliable venue wifi" holding-state pattern this project already
// established for setupScreen.js/rosterScreen.js/eventsScreen.js's own
// initial loads — found missing in review: getSession() is a real network
// call (a token refresh can round-trip), and without this, a hang left the
// ENTIRE app blank forever with no feedback, not just one screen.
function renderAuthCheckError(outlet, retry) {
  outlet.innerHTML = '';
  const container = el('section', { className: 'screen-container' });
  const feedback = el('div', {
    className: 'screen-feedback',
    text: 'This is taking longer than expected — check your connection and try Retry.',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  feedback.dataset.tone = 'error';
  container.appendChild(feedback);
  const retryButton = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Retry',
    attrs: { type: 'button' },
  });
  retryButton.addEventListener('click', retry);
  container.appendChild(retryButton);
  outlet.appendChild(container);
  feedback.scrollIntoView?.({ block: 'nearest' });
  feedback.focus();
  return { unmount() {} };
}

// Temporary auth gate (2026-08-30) — deliberately confined to this file,
// not core/router.js, since router.js is meant to be reused unedited by a
// future format and this concept (an unauthenticated screen swap-in) is
// explicitly scoped as temporary, ahead of D14's real entitlements-based
// gating. `routerRef` is a mutable box read lazily inside onSignedIn/retry —
// it's still null at buildRoutes() call time (createRouter() needs the
// routes this function returns), but by the time either can actually fire,
// mountApp has already set it.
function requireAuth(mount, routerRef) {
  return async (outlet, params) => {
    // '/events' fallback matches router.start()'s own fallbackPath below —
    // found in testing: an empty hash (the common case for reaching the
    // app at all, per router.js's own "no history entry written for the
    // fallback case" design) has no route match on its own, so
    // re-resolving the bare empty string landed on the not-found screen
    // instead of Events.
    function resolveCurrentPath() {
      routerRef.current.resolve(location.hash.replace(/^#/, '') || '/events');
    }

    let session;
    try {
      const result = await raceTimeout(params.client.auth.getSession(), DEFAULT_LOAD_TIMEOUT_MS);
      session = result.data.session;
    } catch {
      return renderAuthCheckError(outlet, resolveCurrentPath);
    }

    if (session) return mount(outlet, params);
    return mountLoginScreen(outlet, { client: params.client, onSignedIn: resolveCurrentPath });
  };
}

function mountNotFoundScreen(root) {
  root.innerHTML = '';
  root.appendChild(
    el('section', { className: 'screen-container' }, [
      el('h1', { text: 'Page not found' }),
      el('a', {
        className: 'btn btn-primary tap-target',
        text: 'Back to events',
        attrs: { href: '#/events' },
      }),
    ]),
  );
  return { unmount() {} };
}

export function buildRoutes({ orgId, bareRoot, routerRef }) {
  return [
    {
      pattern: '/events',
      mount: requireAuth(
        (outlet, { client }) =>
          mountEventsScreen(outlet, { orgId, client, defaultFormat: 'cup_taster' }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId',
      mount: requireAuth(
        (outlet, { eventId, client }) => mountEventDashboardScreen(outlet, { eventId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/setup',
      mount: requireAuth(
        (outlet, { eventId, client }) => mountSetupScreen(outlet, { eventId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/roster',
      mount: requireAuth(
        (outlet, { eventId, client }) => mountRosterScreen(outlet, { eventId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/report',
      mount: requireAuth(
        (outlet, { eventId, client }) => mountReportScreen(outlet, { eventId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/heats',
      mount: requireAuth(
        (outlet, { eventId, stageId, client }) =>
          mountHeatGenerationScreen(outlet, { eventId, stageId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/standings',
      mount: requireAuth(
        (outlet, { eventId, stageId, client }) =>
          mountStandingsScreen(outlet, { eventId, stageId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/timing',
      mount: requireAuth(
        (outlet, { eventId, heatId, client }) =>
          mountTimingRouteScreen(outlet, { eventId, heatId, client }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/scoring',
      mount: requireAuth(
        (outlet, { eventId, heatId, client }) =>
          mountScoringScreen(outlet, { eventId, heatId, client }),
        routerRef,
      ),
    },
    {
      // Deliberately NOT wrapped in requireAuth — the audience never
      // authenticates, by design (live_sessions is anon-readable; see
      // 20260821240000_grants.sql).
      pattern: '/live/projector',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client }) => mountProjectorSurface(outlet, { orgId, client }),
    },
    {
      pattern: '/live/phone',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client }) => mountPhoneSummary(outlet, { orgId, client }),
    },
    {
      // Deliberately NOT wrapped in requireAuth — same reasoning as the two
      // routes above: meant to be pulled up on the projector (or any
      // screen) on demand, and the audience never authenticates.
      pattern: '/live/splash',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client }) => mountSplashScreen(outlet, { orgId, client }),
    },
  ];
}

export function mountApp(root, { client = getSupabase(), orgId = getDefaultOrgId() } = {}) {
  root.innerHTML = '';

  const shellRoot = el('div', { className: 'app-shell-root' });
  const bareRoot = el('div', { className: 'app-bare-root' });
  bareRoot.hidden = true;
  root.append(shellRoot, bareRoot);

  const shell = mountAppShell(shellRoot, { client });
  // Still null here — createRouter() below needs `routes` already built,
  // but requireAuth()'s onSignedIn only reads routerRef.current lazily,
  // once a real sign-in actually happens, by which point it's set.
  const routerRef = { current: null };
  const routes = buildRoutes({ orgId, bareRoot, routerRef });

  function updateChrome(route, params) {
    const showChrome = route.chrome !== false;
    shellRoot.hidden = !showChrome;
    bareRoot.hidden = showChrome;
    if (!showChrome) return;
    const links = [{ label: 'Events', href: '#/events', active: !params.eventId }];
    if (params.eventId) {
      links.push({ label: 'Overview', href: `#/events/${params.eventId}` });
    }
    shell.setNav({ eventId: params.eventId ?? null, links });
  }

  const router = createRouter({
    routes,
    client,
    notFoundMount: mountNotFoundScreen,
    onNavigate: updateChrome,
  });
  routerRef.current = router;

  const started = router.start(shell.outlet, { fallbackPath: '/events' });

  return {
    ready: started,
    async unmount() {
      // router.stop() first — the currently-mounted SCREEN's own
      // unmount() may need to do more than DOM cleanup (e.g. clear a
      // ticking interval), which removing DOM nodes alone never does.
      // shell.unmount() after — found missing in review: this function
      // used to leave the app shell itself (header, nav, cached
      // breadcrumb closure) mounted forever, the one thing in this file
      // holding real DOM state, breaking the same
      // "every mount has a real unmount" contract this same PR closed a
      // gap in for heatsScreen.js.
      await router.stop();
      shell.unmount();
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  mountApp(document.getElementById('app'));
}
