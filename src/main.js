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
import { describeError } from './core/errors.js';
import { findEvent } from './core/events.js';
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
import { mountBtcEventDashboardScreen } from './formats/btc/eventDashboardScreen.js';
import { mountSetupScreen as mountBtcSetupScreen } from './formats/btc/setupScreen.js';
import { mountMatchesScreen as mountBtcMatchesScreen } from './formats/btc/matchesScreen.js';
import { mountStandingsScreen as mountBtcStandingsScreen } from './formats/btc/standingsScreen.js';
import { mountBracketScreen as mountBtcBracketScreen } from './formats/btc/bracketScreen.js';
import { mountScoringScreen as mountBtcScoringScreen } from './formats/btc/scoringScreen.js';
import { flushOutbox, listPendingOperations } from './core/outbox.js';
import { btcOutboxHandlers, btcOperationLabels } from './formats/btc/outboxHandlers.js';
import {
  cupTasterOutboxHandlers,
  cupTasterOperationLabels,
} from './formats/cup-taster/outboxHandlers.js';
import { trackInputModality } from './core/inputModality.js';

// Every configured format an organiser can create an event as — passed into
// core/eventsScreen.js as `formatOptions` so its create form can offer a real choice
// once more than one format exists (see that file's own comment: it never hardcodes a
// format itself, this is the one composition-root file allowed to know both).
const FORMAT_OPTIONS = [
  { value: 'cup_taster', label: 'Cup Taster' },
  { value: 'btc', label: 'BTC' },
];

// Same "unreliable venue wifi" holding-state pattern this project already
// established for setupScreen.js/rosterScreen.js/eventsScreen.js's own
// initial loads — found missing in review: getSession() is a real network
// call (a token refresh can round-trip), and without this, a hang left the
// ENTIRE app blank forever with no feedback, not just one screen. Shared by
// every main.js-level failure that needs a Retry action (the auth check
// below, and the event-format lookup further down) — found in review
// (code-reviewer) that this file had grown three near-identical copies of
// this exact shape; this is the one, with only the message and retry
// callback varying per caller.
function renderRetryableError(outlet, message, retry) {
  outlet.innerHTML = '';
  const container = el('section', { className: 'screen-container' });
  const feedback = el('div', {
    className: 'screen-feedback',
    text: message,
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

const TIMEOUT_MESSAGE =
  'This is taking longer than expected — check your connection and try Retry.';

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
      // A newer navigation may already have superseded this one while
      // getSession() was still in flight — router.js aborts `params.signal`
      // the instant that happens, well before this catch runs. Writing an
      // error screen here would clobber whatever's actually showing now.
      // See ROADMAP.md's "A real DOM-write race between the router..." entry.
      if (params.signal?.aborted) return undefined;
      return renderRetryableError(outlet, TIMEOUT_MESSAGE, resolveCurrentPath);
    }

    if (params.signal?.aborted) return undefined;
    if (session) return mount(outlet, params);
    return mountLoginScreen(outlet, {
      client: params.client,
      onSignedIn: resolveCurrentPath,
      signal: params.signal,
    });
  };
}

// Format-aware dispatch for the per-event hub: an event's own `format` decides which
// format's dashboard mounts — Cup Taster's (stage cards) and BTC's (setup/matches/
// standings/bracket links) show completely different content for what is otherwise the
// same route pattern (`/events/:eventId`). Lives here, not in either format's own
// dashboard file — this is the one file already allowed to know about every format
// that exists (see this file's own header comment), and neither dashboard screen should
// have to know the other exists.
//
// This does mean the Cup Taster path reads the event row TWICE (once here for the
// dispatch decision, once inside mountEventDashboardScreen's own loadState()) — a small,
// accepted redundant read rather than restructuring that already-shipped, already-
// reviewed screen to accept a pre-fetched event; same tradeoff requireAuth() below
// already makes with its own extra getSession() hop.
function mountEventHomeScreen(outlet, { eventId, orgId, client, signal }) {
  async function attempt() {
    let event;
    try {
      event = await raceTimeout(findEvent(eventId, client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch (err) {
      if (signal?.aborted) return undefined;
      const message = err.timedOut ? TIMEOUT_MESSAGE : describeError(err);
      return renderRetryableError(outlet, message, attempt);
    }
    if (signal?.aborted) return undefined;
    if (event.format === 'btc') {
      return mountBtcEventDashboardScreen(outlet, { eventId, client, signal });
    }
    return mountEventDashboardScreen(outlet, { eventId, orgId, client, signal });
  }
  return attempt();
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

// The three /live/* routes below all share one root (bareRoot) for the app's
// whole lifetime, and each applies its own surface-identifying class/
// data-surface attribute. None of them clears a PRIOR route's residue itself
// any more (module-boundary-checker flagged the original per-screen cleanup —
// core/splashScreen.js hardcoding the Cup-Taster-specific 'projector-surface'
// class name — as a real §6 violation: a core module has no business knowing
// a format's class names). Centralized here instead, since main.js is
// already the one file allowed to know both sides of that line.
function resetBareSurface(outlet) {
  outlet.className = 'app-bare-root';
  outlet.removeAttribute('data-surface');
}

export function buildRoutes({ orgId, bareRoot, routerRef }) {
  return [
    {
      pattern: '/events',
      mount: requireAuth(
        (outlet, { client, signal }) =>
          mountEventsScreen(outlet, {
            orgId,
            client,
            defaultFormat: 'cup_taster',
            formatOptions: FORMAT_OPTIONS,
            signal,
          }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountEventHomeScreen(outlet, { eventId, orgId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/setup',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountSetupScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/roster',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountRosterScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/report',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountReportScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/heats',
      mount: requireAuth(
        (outlet, { eventId, stageId, client, signal }) =>
          mountHeatGenerationScreen(outlet, { eventId, stageId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/standings',
      mount: requireAuth(
        (outlet, { eventId, stageId, client, signal }) =>
          mountStandingsScreen(outlet, { eventId, stageId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/timing',
      mount: requireAuth(
        (outlet, { eventId, heatId, client, signal }) =>
          mountTimingRouteScreen(outlet, { eventId, heatId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/scoring',
      // Passes allOutboxHandlers(client), same reasoning as the BTC scoring route
      // below — now that BTC operations genuinely exist in the shared outbox queue,
      // a confirm flush triggered from THIS screen using only Cup-Taster handlers
      // could throw "no handler" on a queued BTC operation ahead of it and stop the
      // whole flush, silently blocking the organiser's own confirm. Closes the
      // asymmetry this file used to defer (found by offline-sync-auditor review,
      // 2026-09-23 BTC app-wiring pass: real once BTC screens were actually routed,
      // not hypothetical).
      mount: requireAuth(
        (outlet, { eventId, heatId, client, signal }) =>
          mountScoringScreen(outlet, {
            eventId,
            heatId,
            client,
            signal,
            handlers: allOutboxHandlers(client),
          }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/btc/setup',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcSetupScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/btc/matches',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcMatchesScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/btc/standings',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcStandingsScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/btc/bracket',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcBracketScreen(outlet, { eventId, client, signal }),
        routerRef,
      ),
    },
    {
      pattern: '/events/:eventId/btc/matches/:matchId/scoring',
      // Passes allOutboxHandlers(client), not btcOutboxHandlers(client) alone — a
      // confirm queued from this screen must be able to flush ANY format's pending
      // operations ahead of it in the shared FIFO outbox, not just BTC's own (see
      // core/outbox.js's own "no handler" comment on allOutboxHandlers below: a
      // queued operation whose type is missing from the map throws "no handler" and
      // stops the whole queue behind it). This closes the exact gap
      // src/formats/btc/CLAUDE.md already flagged: "main.js must pass
      // allOutboxHandlers ... to prevent cross-format head-of-line blocking." The
      // Cup Taster scoring route above gets the identical treatment for the same
      // reason — BTC operations now genuinely exist in the shared queue for the
      // first time once this route exists, so a Cup Taster confirm can no longer
      // assume nothing else is ever ahead of it.
      mount: requireAuth(
        (outlet, { matchId, client, signal }) =>
          mountBtcScoringScreen(outlet, {
            matchId,
            client,
            signal,
            handlers: allOutboxHandlers(client),
          }),
        routerRef,
      ),
    },
    {
      // Deliberately NOT wrapped in requireAuth — the audience never
      // authenticates, by design (live_sessions is anon-readable; see
      // 20260821240000_grants.sql). `signal` IS threaded through here —
      // this shares `bareRoot` with `/live/splash` (below), which already
      // gets it; leaving this route unprotected would have left an
      // asymmetric gap on the same shared outlet (found in review,
      // correcting an earlier claim that viewer-shell.js's own `mounted`
      // flag already covered this — it doesn't: `mounted` is set true
      // BEFORE the initial refresh()'s own network await, so it only
      // catches a callback firing after a legitimate unmount(), not the
      // still-in-flight FIRST load this whole fix is about).
      pattern: '/live/projector',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client, signal }) => {
        resetBareSurface(outlet);
        return mountProjectorSurface(outlet, { orgId, client, signal });
      },
    },
    {
      pattern: '/live/phone',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client, signal }) => {
        resetBareSurface(outlet);
        return mountPhoneSummary(outlet, { orgId, client, signal });
      },
    },
    {
      // Deliberately NOT wrapped in requireAuth — same reasoning as the two
      // routes above: meant to be pulled up on the projector (or any
      // screen) on demand, and the audience never authenticates.
      pattern: '/live/splash',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client, signal }) => {
        resetBareSurface(outlet);
        return mountSplashScreen(outlet, { orgId, client, signal });
      },
    },
  ];
}

// Every format's operation types in ONE map: a flush registers handlers per call, so a
// queued operation whose type is missing here throws "no handler" and stops the whole
// FIFO queue behind it, including other formats' operations.
function allOutboxHandlers(client) {
  return { ...cupTasterOutboxHandlers(client), ...btcOutboxHandlers(client) };
}

// Sync-on-reconnect (D4: "local-first with sync-on-reconnect") — found
// missing in review (Phase 6 offline soak): every real write already
// enqueues-then-flushes in the SAME call (timing.js/scoring.js/publish.js),
// but nothing retried a queue left behind by a dropped connection until the
// organiser's NEXT write happened to trigger another flush attempt. A heat
// finished right as the wifi dropped could sit unsynced indefinitely if
// nothing else was recorded afterward. `core/outbox.js`'s own flushOutbox()
// already owns everything about HOW a flush behaves (ordering, permanent-
// failure handling); this only decides WHEN one starts.
//
// `shell.reportFlushError(...)` — found in review (offline-sync-auditor):
// every PRE-EXISTING flush call site reads its own flushResult off the same
// await that triggered the write and surfaces a real conflict to whichever
// screen the organiser is looking at (timingScreen.js's own
// pendingHeatCheck, etc.). This trigger has no screen watching it at all —
// without this, a genuine conflict (flushResult.permanentFailure) got
// silently discarded from the outbox with nobody told, and the very next
// sync-panel poll saw an empty queue and reported "Synced" — a false
// all-clear for a write that never actually landed, exactly the "conflict
// silently resolved" failure mode §9 exists to prevent.
//
// Sticky, not cleared by a later clean flush (2026-09-26, found in review:
// code-reviewer). A dropped write never comes back, so a later, unrelated
// success must not hide it — and once the periodic retry below existed, a
// conflict dropped alongside a transient failure was cleared within 15s.
// Reports `permanentError` (the dropped operation's own error), not
// `error`, which is whatever failure stopped the pass.
function attemptReconnectFlush(client, shell) {
  flushOutbox(allOutboxHandlers(client))
    .then((result) => {
      // `?? result.error`: reportFlushError(undefined) would CLEAR the
      // report (its default is null) — never let a missing field turn a
      // dropped write into a false "Synced".
      if (result.permanentFailure) {
        shell.reportFlushError(result.permanentError ?? result.error);
      }
    })
    .catch((err) => {
      console.error('main: reconnect flush failed', err);
    });
}

const PENDING_RETRY_MS = 15000;

export function mountApp(root, { client = getSupabase(), orgId = getDefaultOrgId() } = {}) {
  root.innerHTML = '';

  const stopTrackingInputModality = trackInputModality();

  const shellRoot = el('div', { className: 'app-shell-root' });
  const bareRoot = el('div', { className: 'app-bare-root' });
  bareRoot.hidden = true;
  root.append(shellRoot, bareRoot);

  // operationLabels: this file is the one place allowed to know both
  // "core" and "this app is Cup Taster" (see this function's own comment
  // below) — appShell.js itself stays format-agnostic, per its own top
  // comment.
  const shell = mountAppShell(shellRoot, {
    client,
    operationLabels: { ...cupTasterOperationLabels, ...btcOperationLabels },
  });

  // Tracked reactively via onAuthStateChange, NOT a fresh client.auth.
  // getSession() call here — found while wiring this: a separate
  // getSession() call at mount would race/collide with requireAuth()'s own
  // per-navigation getSession() check below (broke a staleness-protection
  // test whose fake client counts calls to control which one resolves
  // first — that test relies on being able to predict exactly which call is
  // requireAuth's). onAuthStateChange fires its own INITIAL_SESSION event
  // with the current session shortly after subscribing, then again on every
  // sign-in/out/token-refresh — reused here for both "attempt once we learn
  // we're signed in" (covers a tab reopened after being offline, and a
  // fresh sign-in transition, for free) and "attempt on reconnect" below.
  //
  // Guarded on a real session, not attempted unconditionally: buildRpcHandler()
  // (core/outbox.js) originally marked EVERY client.rpc() error `permanent:
  // true` (since narrowed — 401 and transient failures now stay queued, see
  // its isTransientFailure), on the reasoning that a response which reached
  // the server and came back rejected means retrying the identical payload
  // fails the identical way forever. That reasoning holds for a
  // stale-conflict rejection, but an unauthenticated
  // call also resolves with an error object rather than throwing — firing
  // before sign-in could misclassify a purely transient "not signed in yet"
  // state as permanent and silently discard real pending writes. Every
  // EXISTING flush call site avoided this by construction (each only ever
  // runs from inside an already-`requireAuth()`-gated screen's own write
  // handler); this is the first call site that can fire before that gate.
  //
  // `onConsoleRoute` (2026-09-26, found in review: offline-sync-auditor):
  // the projector/phone/splash links open this same SPA in another tab,
  // sharing this session and this IndexedDB outbox. That tab has no
  // visible shell (chrome: false), so a conflict its flush discovers would
  // be removed from the shared queue and reported to a hidden panel — the
  // organiser's own tab would then show "Synced". Only a tab showing the
  // organiser console drains the queue. Starts false and is set by
  // updateChrome() below, which also attempts the first flush if the
  // session was already known before the first route resolved.
  let hasSession = false;
  let onConsoleRoute = false;
  function flushIfOwner() {
    if (hasSession && onConsoleRoute) attemptReconnectFlush(client, shell);
  }
  const {
    data: { subscription: reconnectAuthSubscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    hasSession = Boolean(session);
    flushIfOwner();
  });

  function onOnline() {
    flushIfOwner();
  }
  window.addEventListener('online', onOnline);

  // A transient server failure (a gateway 5xx, a rate limit, a statement
  // timeout — see core/outbox.js's isTransientFailure) leaves its write
  // queued, but the browser never fires 'online' for it: the device was
  // online the whole time. Without this, that write sat unsynced until the
  // organiser's next action happened to flush again. Only fires while
  // something is actually queued, so an idle console makes no requests —
  // and not while the device is offline, where every attempt would only
  // bump `attempts` and make an ordinary offline queue look stuck (the
  // 'online' listener above already covers coming back).
  const retryIntervalId = setInterval(() => {
    if (!hasSession || !onConsoleRoute || !navigator.onLine) return;
    listPendingOperations()
      .then((operations) => {
        if (operations.length > 0) attemptReconnectFlush(client, shell);
      })
      .catch((err) => {
        console.error('main: pending-operation check failed', err);
      });
  }, PENDING_RETRY_MS);
  // Still null here — createRouter() below needs `routes` already built,
  // but requireAuth()'s onSignedIn only reads routerRef.current lazily,
  // once a real sign-in actually happens, by which point it's set.
  const routerRef = { current: null };
  const routes = buildRoutes({ orgId, bareRoot, routerRef });

  function updateChrome(route, params) {
    const showChrome = route.chrome !== false;
    shellRoot.hidden = !showChrome;
    bareRoot.hidden = showChrome;
    const wasOnConsoleRoute = onConsoleRoute;
    onConsoleRoute = showChrome;
    if (!wasOnConsoleRoute) flushIfOwner();
    if (!showChrome) return;
    const links = [{ label: 'Events', href: '#/events', active: !params.eventId }];
    if (params.eventId) {
      // "Overview" — found ambiguous in production feedback (organisers
      // couldn't tell at a glance what it led back to). "Event home" names
      // the actual destination: this event's own per-event hub
      // (eventDashboardScreen.js), the same relationship "Events" already
      // has to the org-wide list.
      links.push({ label: 'Event home', href: `#/events/${params.eventId}` });
    }
    // The three /live/* surfaces — found completely undiscoverable in
    // production feedback: nothing in the organiser UI ever linked to any
    // of them, so an organiser had no way to find the splash screen or
    // hand out an audience link short of knowing the URL by heart. Always
    // shown, not just inside a specific event's own nav — all three are
    // ORG-scoped (whatever's currently live for this org), not event-
    // scoped, matching "Events" itself. openInNewTab (appShell.js) since
    // these are meant to be pulled up on a SEPARATE device/tab (a
    // projector, a phone) while the organiser keeps working in this one.
    // Renamed from "Audience — projector"/"Audience — phone" (production
    // UI/UX feedback, 2026-09-05): those read as developer-facing
    // labels describing the ROUTE, not user-facing ones describing what an
    // organiser gets when they click. "Projector view"/"Phone view" name
    // the destination the same way "Splash screen" already does.
    links.push(
      { label: 'Splash screen', href: '#/live/splash', openInNewTab: true },
      { label: 'Projector view', href: '#/live/projector', openInNewTab: true },
      { label: 'Phone view', href: '#/live/phone', openInNewTab: true },
    );
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
      window.removeEventListener('online', onOnline);
      clearInterval(retryIntervalId);
      reconnectAuthSubscription.unsubscribe();
      stopTrackingInputModality();
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  mountApp(document.getElementById('app'));
}
