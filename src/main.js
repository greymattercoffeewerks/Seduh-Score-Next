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
import { mountEventsScreen } from './core/eventsScreen.js';
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

export function buildRoutes({ orgId, bareRoot }) {
  return [
    {
      pattern: '/events',
      mount: (outlet, { client }) =>
        mountEventsScreen(outlet, { orgId, client, defaultFormat: 'cup_taster' }),
    },
    {
      pattern: '/events/:eventId',
      mount: (outlet, { eventId, client }) =>
        mountEventDashboardScreen(outlet, { eventId, client }),
    },
    {
      pattern: '/events/:eventId/setup',
      mount: (outlet, { eventId, client }) => mountSetupScreen(outlet, { eventId, client }),
    },
    {
      pattern: '/events/:eventId/roster',
      mount: (outlet, { eventId, client }) => mountRosterScreen(outlet, { eventId, client }),
    },
    {
      pattern: '/events/:eventId/report',
      mount: (outlet, { eventId, client }) => mountReportScreen(outlet, { eventId, client }),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/heats',
      mount: (outlet, { eventId, stageId, client }) =>
        mountHeatGenerationScreen(outlet, { eventId, stageId, client }),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/standings',
      mount: (outlet, { eventId, stageId, client }) =>
        mountStandingsScreen(outlet, { eventId, stageId, client }),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/timing',
      mount: (outlet, { eventId, heatId, client }) =>
        mountTimingRouteScreen(outlet, { eventId, heatId, client }),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/scoring',
      mount: (outlet, { eventId, heatId, client }) =>
        mountScoringScreen(outlet, { eventId, heatId, client }),
    },
    {
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
  ];
}

export function mountApp(root, { client = getSupabase(), orgId = getDefaultOrgId() } = {}) {
  root.innerHTML = '';

  const shellRoot = el('div', { className: 'app-shell-root' });
  const bareRoot = el('div', { className: 'app-bare-root' });
  bareRoot.hidden = true;
  root.append(shellRoot, bareRoot);

  const shell = mountAppShell(shellRoot, { client });
  const routes = buildRoutes({ orgId, bareRoot });

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
