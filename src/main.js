// Composition root (2026-08-29 app-wiring pass). The one file allowed to
// know both "this app is Cup Taster" (the `defaultFormat: 'cup_taster'`
// passed into core/eventsScreen.js) and the full route table connecting
// every already-built, already-reviewed screen. Everything downstream stays
// format-agnostic (core/router.js has zero opinion about screens or chrome)
// or is itself the format module being wired (formats/cup-taster/*).
import { createRouter } from './core/router.js';
import { mountAppShell } from './core/appShell.js';
import { getLegacyAudienceOrgId } from './core/config.js';
import { createOrgContext, ORG_STATUS } from './core/orgContext.js';
import { mustChangePassword } from './core/sessionGate.js';
import { goToHash, replaceHash } from './core/navigation.js';
import { orgLabel } from './core/orgLabel.js';
import { getSupabase } from './core/supabaseClient.js';
import { el, setBusyDisabled } from './core/dom.js';
import { describeError } from './core/errors.js';
import { findEvent } from './core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './core/timeout.js';
import { mountEventsScreen } from './core/eventsScreen.js';
import { mountLoginScreen } from './core/loginScreen.js';
import { mountSetPasswordScreen } from './core/setPasswordScreen.js';
import { mountTeamScreen } from './core/teamScreen.js';
import { mountNoOrgScreen } from './core/noOrgScreen.js';
import { canManageTeam } from './core/team.js';
import { mountSplashScreen } from './core/splashScreen.js';
import { mountEventDashboardScreen } from './formats/cup-taster/eventDashboardScreen.js';
import { mountSetupScreen } from './formats/cup-taster/setupScreen.js';
import { mountRosterScreen } from './formats/cup-taster/rosterScreen.js';
import { mountReportScreen } from './formats/cup-taster/reportScreen.js';
import { mountHeatGenerationScreen } from './formats/cup-taster/heatsScreen.js';
import { mountStandingsScreen } from './formats/cup-taster/standingsScreen.js';
import { mountTimingRouteScreen } from './formats/cup-taster/timingRouteScreen.js';
import { mountScoringScreen } from './formats/cup-taster/scoringScreen.js';
import { mountProjector, mountPhone } from './liveSurfaces.js';
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
  retryButton.addEventListener('click', () => {
    // A retry can take as long as the load timeout; say so, and ignore a second click meanwhile.
    if (retryButton.getAttribute('aria-disabled') === 'true') return;
    setBusyDisabled(retryButton, true);
    retryButton.textContent = 'Retrying…';
    retry();
  });
  container.appendChild(retryButton);
  outlet.appendChild(container);
  feedback.scrollIntoView?.({ block: 'nearest' });
  feedback.focus();
  return { unmount() {} };
}

const TIMEOUT_MESSAGE =
  'This is taking longer than expected — check your connection and try Retry.';
const ORG_LOAD_ERROR_MESSAGE =
  'Could not load your organisation — check your connection and try again.';
const ORG_LOADING_MESSAGE = 'Loading your organisation…';

// The holding state for a wait with no screen to show yet (the same role=status pattern as the retry
// card, without the error tone): a cold load on slow wifi would otherwise be a blank page for up to the
// load timeout.
function renderLoadingStatus(outlet, message) {
  outlet.innerHTML = '';
  const container = el('section', { className: 'screen-container' });
  const status = el('div', {
    className: 'screen-feedback',
    text: message,
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  container.appendChild(status);
  outlet.appendChild(container);
  status.focus();
}

const settledFor = (state, userId) =>
  state.userId === userId &&
  (state.status === ORG_STATUS.READY || state.status === ORG_STATUS.NO_ORG);
const loadingFor = (state, userId) =>
  state.userId === userId && state.status === ORG_STATUS.LOADING;

// The organisation question, answered for this session's user: waits for a question already in flight,
// asks one if none has been asked for this user (or the last one failed), and otherwise answers at once
// from what is already known, so ordinary navigation costs no request. Always resolves with the state:
// the caller decides what an unfinished answer (an error, or one still loading) looks like. A navigation
// that was superseded while waiting (`signal` aborted) starts no new question.
async function resolveOrg(orgContext, session, signal) {
  const userId = session.user?.id;
  const known = orgContext.getState();
  if (settledFor(known, userId)) return known;
  if (loadingFor(known, userId)) await orgContext.whenSettled();
  else if (!signal?.aborted) await orgContext.refresh(session);
  // An auth event may have started a newer question while this one was in flight: wait for that too.
  if (loadingFor(orgContext.getState(), userId)) await orgContext.whenSettled();
  return orgContext.getState();
}

// Temporary auth gate (2026-08-30) — deliberately confined to this file,
// not core/router.js, since router.js is meant to be reused unedited by a
// future format and this concept (an unauthenticated screen swap-in) is
// explicitly scoped as temporary, ahead of D14's real entitlements-based
// gating. `routerRef` is a mutable box read lazily inside onSignedIn/retry —
// it's still null at buildRoutes() call time (createRouter() needs the
// routes this function returns), but by the time either can actually fire,
// mountApp has already set it.
function requireAuth(mount, { routerRef, orgContext, onConsoleMounted }) {
  return async (outlet, params) => {
    // '/events' fallback matches router.start()'s own fallbackPath below —
    // found in testing: an empty hash (the common case for reaching the
    // app at all, per router.js's own "no history entry written for the
    // fallback case" design) has no route match on its own, so
    // re-resolving the bare empty string landed on the not-found screen
    // instead of Events.
    function resolveCurrentPath() {
      // null once the app is unmounted: a late Retry or sign-in must not mount into a dead outlet.
      routerRef.current?.resolve(location.hash.replace(/^#/, '') || '/events');
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
    // Signed in with a one-time password (an owner just created or reset this account): nothing else
    // is reachable until they have chosen their own.
    if (mustChangePassword(session)) {
      return mountSetPasswordScreen(outlet, {
        client: params.client,
        onDone: resolveCurrentPath,
        signal: params.signal,
      });
    }
    if (!session) {
      return mountLoginScreen(outlet, {
        client: params.client,
        onSignedIn: resolveCurrentPath,
        signal: params.signal,
      });
    }

    // Signed in: which organisation is this person working in? Every console route is organisation-
    // scoped, so none mounts until that is known (see core/orgContext.js).
    if (!settledFor(orgContext.getState(), session.user?.id)) {
      renderLoadingStatus(outlet, ORG_LOADING_MESSAGE);
    }
    const org = await resolveOrg(orgContext, session, params.signal);
    if (params.signal?.aborted) return undefined;
    if (org.status === ORG_STATUS.IDLE) {
      // A sign-out landed while we waited (another tab, or an expired refresh token). Ask the auth
      // client again rather than reporting an organisation error to someone who is now signed out.
      let latest = null;
      try {
        latest = (await raceTimeout(params.client.auth.getSession(), DEFAULT_LOAD_TIMEOUT_MS)).data
          .session;
      } catch {
        // Treated as still signed in: the retry card below is the honest answer.
      }
      if (params.signal?.aborted) return undefined;
      if (!latest) {
        return mountLoginScreen(outlet, {
          client: params.client,
          onSignedIn: resolveCurrentPath,
          signal: params.signal,
        });
      }
    }
    if (org.status === ORG_STATUS.NO_ORG) {
      // Not an error: an account in no organisation (made for a different product, or someone removed
      // from theirs). Never an empty Events list.
      return mountNoOrgScreen(outlet, {
        client: params.client,
        email: session.user?.email ?? null,
        onSignedOut: () => goToHash('#/events'),
        signal: params.signal,
      });
    }
    if (org.status !== ORG_STATUS.READY) {
      // resolveOrg asks again from an error, so Retry is just "resolve this route again".
      return renderRetryableError(outlet, ORG_LOAD_ERROR_MESSAGE, resolveCurrentPath);
    }
    // The organisation the console works in is handed to the screen at mount, from the person's own
    // memberships; a change of person or organisation re-mounts the console (mountApp) rather than
    // mutating a screen in place. Remember who and which org this screen was built for.
    onConsoleMounted(`${org.userId}:${org.activeOrgId}`);
    // The name comes from the very snapshot the id came from (never from live state a moment later), so a
    // screen can never show one organisation's name over another's data.
    const activeOrg = org.orgs.find((candidate) => candidate.id === org.activeOrgId);
    return mount(outlet, {
      ...params,
      orgId: org.activeOrgId,
      // What to call it (the slug is added when two of the person's organisations share a name).
      orgName: activeOrg ? orgLabel(activeOrg, org.orgs) : null,
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

// The audience routes (/live/*) still show one organisation, named at build time (T-TEN.D1 replaces that
// with slug-qualified links). When it is not configured, say so plainly instead of failing: an unset
// build variable must never take the whole app down. Shown with the audience surfaces' own holding-card
// look (viewer-shell.css): large, centred, dark stage tokens on a projector or the splash screen, the
// ordinary paper look on a phone. Its unmount does nothing, like the not-found screen's: the router
// mounts the next screen first, and the three routes share one root.
function mountOutOfDateLinkScreen(root, { stage }) {
  root.innerHTML = '';
  if (stage) root.setAttribute('data-surface', 'stage');
  root.appendChild(
    el('div', { className: 'out-of-date-link' }, [
      el('div', { className: 'viewer-holding-card' }, [
        el('h1', { className: 'viewer-holding-title', text: 'This link is out of date' }),
        el('p', {
          className: 'viewer-holding-body',
          text: 'Ask whoever shared it with you for a new one.',
        }),
      ]),
    ]),
  );
  return { unmount() {} };
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

export function buildRoutes({
  legacyAudienceOrgId,
  orgContext,
  bareRoot,
  routerRef,
  onConsoleMounted,
  setTeamHoldsSecret = () => {},
}) {
  const auth = { routerRef, orgContext, onConsoleMounted };
  return [
    {
      pattern: '/events',
      mount: requireAuth(
        (outlet, { client, signal, orgId }) =>
          mountEventsScreen(outlet, {
            orgId,
            client,
            defaultFormat: 'cup_taster',
            formatOptions: FORMAT_OPTIONS,
            signal,
          }),
        auth,
      ),
    },
    {
      pattern: '/team',
      mount: requireAuth(
        (outlet, { client, signal, orgId, orgName }) =>
          mountTeamScreen(outlet, {
            orgId,
            orgName,
            client,
            signal,
            onLeaveGuard: (active) => setTeamHoldsSecret(active),
          }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId',
      mount: requireAuth(
        (outlet, { eventId, client, signal, orgId }) =>
          mountEventHomeScreen(outlet, { eventId, orgId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/setup',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountSetupScreen(outlet, { eventId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/roster',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountRosterScreen(outlet, { eventId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/report',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountReportScreen(outlet, { eventId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/heats',
      mount: requireAuth(
        (outlet, { eventId, stageId, client, signal }) =>
          mountHeatGenerationScreen(outlet, { eventId, stageId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/stages/:stageId/standings',
      mount: requireAuth(
        (outlet, { eventId, stageId, client, signal }) =>
          mountStandingsScreen(outlet, { eventId, stageId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/heats/:heatId/timing',
      mount: requireAuth(
        (outlet, { eventId, heatId, client, signal }) =>
          mountTimingRouteScreen(outlet, { eventId, heatId, client, signal }),
        auth,
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
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/btc/setup',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcSetupScreen(outlet, {
            eventId,
            client,
            signal,
            handlers: allOutboxHandlers(client),
          }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/btc/matches',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcMatchesScreen(outlet, {
            eventId,
            client,
            signal,
            handlers: allOutboxHandlers(client),
          }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/btc/standings',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcStandingsScreen(outlet, { eventId, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId/btc/bracket',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountBtcBracketScreen(outlet, {
            eventId,
            client,
            signal,
            handlers: allOutboxHandlers(client),
          }),
        auth,
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
        auth,
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
        if (!legacyAudienceOrgId) return mountOutOfDateLinkScreen(outlet, { stage: true });
        return mountProjector(outlet, { orgId: legacyAudienceOrgId, client, signal });
      },
    },
    {
      pattern: '/live/phone',
      chrome: false,
      outlet: bareRoot,
      mount: (outlet, { client, signal }) => {
        resetBareSurface(outlet);
        if (!legacyAudienceOrgId) return mountOutOfDateLinkScreen(outlet, { stage: false });
        return mountPhone(outlet, { orgId: legacyAudienceOrgId, client, signal });
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
        if (!legacyAudienceOrgId) return mountOutOfDateLinkScreen(outlet, { stage: true });
        return mountSplashScreen(outlet, { orgId: legacyAudienceOrgId, client, signal });
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
// Not reported from here: a permanently-dropped operation reaches the sync
// panel through core/outbox.js's onOperationDropped, which appShell.js
// subscribes to — the same path for this background trigger and for every
// screen-triggered flush (2026-09-27, offline-sync-auditor: forwarding the
// result from here alone left every screen's flush silently dropping writes
// behind a green "Synced").
function attemptReconnectFlush(client) {
  flushOutbox(allOutboxHandlers(client)).catch((err) => {
    console.error('main: reconnect flush failed', err);
  });
}

const PENDING_RETRY_MS = 15000;

function unsyncedSwitchMessage(count) {
  const noun = count === 1 ? 'change on this device has' : 'changes on this device have';
  return `${count} ${noun} not synced yet. Wait for ${count === 1 ? 'it' : 'them'} to sync before switching organisation.`;
}
const SWITCH_CHECK_FAILED_MESSAGE =
  'Could not check whether everything on this device has synced, so the organisation was not switched. Try again.';
const SWITCH_UNKNOWN_ORG_MESSAGE = 'That organisation is not available to this account.';
// The Team screen is replaced when the organisation changes, and a one-time password on it "is shown once
// and cannot be looked up again" (nor can one whose request is still being sent).
const SWITCH_TEAM_OPEN_MESSAGE =
  'The Team screen has a one-time password showing, or a change still being saved. Finish that first (press Done), then switch organisation.';

// `orgContext` is created here unless a caller (a test, a future second shell) passes its own.
// `legacyAudienceOrgId` is the one organisation the anonymous audience routes still show until T-TEN.D1.
export function mountApp(
  root,
  {
    client = getSupabase(),
    orgContext: injectedOrgContext,
    legacyAudienceOrgId = getLegacyAudienceOrgId(),
  } = {},
) {
  root.innerHTML = '';
  const orgContext = injectedOrgContext ?? createOrgContext({ client });

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
  // `onConsoleRoute` (2026-09-26, found in review: offline-sync-auditor): the
  // projector/phone/splash links open this same SPA in another tab, sharing
  // this session and this IndexedDB outbox. That tab has no visible shell
  // (chrome: false), so a conflict its flush discovers would be removed from
  // the shared queue and announced in a tab with no sync panel listening — the
  // organiser's own tab would then show "Synced". Only a tab showing the
  // organiser console drains the queue. Starts false and is set by
  // updateChrome() below, which also attempts the first flush if the session
  // was already known before the first route resolved.
  let hasSession = false;
  let onConsoleRoute = false;
  function flushIfOwner() {
    if (!hasSession || !onConsoleRoute) return;
    // Someone in no organisation cannot have written anything here, so whatever is queued on this
    // device was left by somebody else (the org state is always the signed-in person's own: it is
    // refreshed on every auth event): replaying it under this person's login would be refused by the
    // database as a permanent failure, and the outbox would drop it. Keep it for its owner (until
    // T-TEN.C6 tags operations, this is the only definite "not yours" signal there is).
    const orgState = orgContext.getState();
    if (orgState.status === ORG_STATUS.NO_ORG) return;
    attemptReconnectFlush(client);
  }

  // Whether to offer the Team link: asked of the database (an owner of the ACTIVE org), re-asked on
  // every auth event and every change of organisation, and never assumed — a failed check just leaves
  // the link out. This only decides what is SHOWN; the database refuses a non-owner whatever the nav
  // says. `lastNav` lets the link appear (or go) the moment the answer arrives, without waiting for
  // the next navigation.
  let isTeamOwner = false;
  // The org the current answer is about: an answer about one org must never linger under another.
  let teamOwnerOrgId = null;
  let ownerCheckSeq = 0;
  let lastNav = null;
  let currentSession = null;
  function setTeamOwner(value) {
    if (value === isTeamOwner) return;
    isTeamOwner = value;
    if (lastNav) renderNav(lastNav.route, lastNav.params);
  }
  function refreshTeamOwnership(session) {
    ownerCheckSeq += 1;
    const seq = ownerCheckSeq;
    // A person who still has to choose a password sees nothing but that screen.
    if (!session || mustChangePassword(session)) {
      setTeamOwner(false);
      return;
    }
    // No organisation to ask about yet (still loading, or in none): nothing to offer. The next change
    // of the org context asks again.
    const activeOrgId = orgContext.getActiveOrgIdFor(session.user?.id);
    if (!activeOrgId) {
      setTeamOwner(false);
      return;
    }
    if (teamOwnerOrgId !== activeOrgId) setTeamOwner(false);
    // Deliberately NOT awaited here: this runs inside onAuthStateChange, where supabase-js holds
    // its auth lock, and an RPC that needs the session would deadlock behind it. A failed check
    // (null / a rejection) changes nothing — a dropped connection at a token refresh must not make
    // the Team link vanish — and `seq` drops an answer that a newer auth event has overtaken.
    Promise.resolve()
      .then(() => canManageTeam(activeOrgId, client))
      .catch(() => null)
      .then((owner) => {
        if (seq !== ownerCheckSeq || owner === null) return;
        teamOwnerOrgId = activeOrgId;
        setTeamOwner(owner);
      });
  }

  const {
    data: { subscription: reconnectAuthSubscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    hasSession = Boolean(session);
    currentSession = session;
    // Not awaited, and it reads the database only a tick later (see orgContext.js): safe here.
    orgContext.refresh(session);
    flushIfOwner();
    refreshTeamOwnership(session);
  });

  function onOnline() {
    flushIfOwner();
    // Coming back online after a failed or stand-in organisation answer: ask again, and if the console
    // was showing the error card, show the real screen.
    const orgState = orgContext.getState();
    if (!currentSession || (orgState.status !== ORG_STATUS.ERROR && !orgState.stale)) return;
    orgContext.retry().then(() => {
      if (orgState.status === ORG_STATUS.ERROR) routerRef.current?.resolve(currentRoutePath());
    });
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
        if (operations.length > 0) attemptReconnectFlush(client);
      })
      .catch((err) => {
        console.error('main: pending-operation check failed', err);
      });
  }, PENDING_RETRY_MS);
  // Still null here — createRouter() below needs `routes` already built,
  // but requireAuth()'s onSignedIn only reads routerRef.current lazily,
  // once a real sign-in actually happens, by which point it's set.
  const routerRef = { current: null };
  const currentRoutePath = () => location.hash.replace(/^#/, '') || '/events';
  // Who and which org the console screen on show was built for (null: none yet, or already replaced).
  let mountedKey = null;
  // Set by the Team screen while leaving it would lose a one-time password; cleared whenever any console
  // screen is mounted (the Team screen reports it again if it needs to).
  let teamHoldsSecret = false;
  const routes = buildRoutes({
    legacyAudienceOrgId,
    orgContext,
    bareRoot,
    routerRef,
    onConsoleMounted: (key) => {
      mountedKey = key;
      teamHoldsSecret = false;
    },
    setTeamHoldsSecret: (active) => {
      teamHoldsSecret = active;
    },
  });

  // When the person or the organisation the console was built for is no longer the one in force (a
  // switch, a membership that fell away, another account signing in or out in a second tab), the screen
  // on show must go: show the front door again, replacing the history entry so Back cannot return to a
  // URL that belongs to the old state. The router aborts the screen's in-flight loads through its own
  // signal, so nothing from the old organisation lands in the new one's list. Compared against the key
  // the screen was MOUNTED with, so it fires once, whatever path the context took to get there. The
  // Team link is re-asked at the same moment.
  //
  // The header's organisation slot is kept in step here too (the name, or the list to choose from), and
  // a move to another organisation is announced to a screen reader, saying whether the person chose it
  // or it happened to them.
  let chosenOrgId = null;
  const showOrganisation = (state) =>
    shell.setOrganisation({
      // Only a ready state has organisations to show: every other state has none.
      orgs: state.orgs,
      activeOrgId: state.activeOrgId,
      onSelect: (orgId) => switchOrg(orgId),
    });
  showOrganisation(orgContext.getState());
  const unsubscribeOrgContext = orgContext.subscribe((state) => {
    // Read and clear at once: a choice is only ever "the one that caused THIS change".
    const chosen = chosenOrgId;
    chosenOrgId = null;
    // The header must never be able to stop the screen swap below (an old organisation's console left
    // up under the new one is the invariant this subscriber exists for).
    try {
      showOrganisation(state);
    } catch (err) {
      console.error('main: the organisation slot failed to render', err);
    }
    refreshTeamOwnership(currentSession);
    if (!onConsoleRoute || mountedKey === null) return;
    const key = state.status === ORG_STATUS.READY ? `${state.userId}:${state.activeOrgId}` : null;
    const gone =
      key === null
        ? state.status === ORG_STATUS.IDLE || state.status === ORG_STATUS.NO_ORG
        : key !== mountedKey;
    if (!gone) return;
    // Who the screen was built for, before it is forgotten: the same person in another organisation, or
    // a different person altogether (another account signed in elsewhere).
    const sameUser = mountedKey.startsWith(`${state.userId}:`);
    mountedKey = null;
    replaceHash('#/events');
    if (key !== null) {
      const active = state.orgs.find((org) => org.id === state.activeOrgId);
      const arrival = `Now working in ${active ? orgLabel(active, state.orgs) : 'your organisation'}. Showing Events.`;
      shell.announceOrganisation(
        chosen === state.activeOrgId
          ? arrival
          : `${sameUser ? 'Your organisation' : 'Your account or organisation'} changed. ${arrival}`,
      );
    }
  });

  function updateChrome(route, params) {
    const showChrome = route.chrome !== false;
    shellRoot.hidden = !showChrome;
    bareRoot.hidden = showChrome;
    const wasOnConsoleRoute = onConsoleRoute;
    onConsoleRoute = showChrome;
    if (!wasOnConsoleRoute) flushIfOwner();
    if (!showChrome) return;
    lastNav = { route, params };
    renderNav(route, params);
  }

  function renderNav(route, params) {
    const links = [
      { label: 'Events', href: '#/events', active: !params.eventId && route.pattern !== '/team' },
    ];
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
    if (isTeamOwner) {
      links.push({ label: 'Team', href: '#/team', active: route.pattern === '/team' });
    }
    // Without the legacy audience organisation these links would only open the "out of date" card, so
    // they are left out until T-TEN.D4 makes them slug-qualified.
    if (legacyAudienceOrgId) {
      links.push(
        { label: 'Splash screen', href: '#/live/splash', openInNewTab: true },
        { label: 'Projector view', href: '#/live/projector', openInNewTab: true },
        { label: 'Phone view', href: '#/live/phone', openInNewTab: true },
      );
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

  // Switch the organisation the console works in. Refused, with a message to show, while this device
  // still holds changes that have not synced: they were made in the current organisation, and until
  // the outbox records which organisation each belongs to (T-TEN.C6) the only safe rule is "none
  // pending". The screen change itself follows from the org context's own notification above.
  async function switchOrg(orgId) {
    if (orgId === orgContext.getActiveOrgId()) return { ok: true };
    if (teamHoldsSecret)
      return { ok: false, reason: 'team_open', message: SWITCH_TEAM_OPEN_MESSAGE };
    let pending;
    try {
      // Bounded: an outbox read that never answers must not leave the switch (and the control) hanging.
      pending = await raceTimeout(listPendingOperations(), DEFAULT_LOAD_TIMEOUT_MS);
    } catch {
      return { ok: false, reason: 'unknown', message: SWITCH_CHECK_FAILED_MESSAGE };
    }
    if (pending.length > 0) {
      return {
        ok: false,
        reason: 'unsynced',
        count: pending.length,
        message: unsyncedSwitchMessage(pending.length),
      };
    }
    chosenOrgId = orgId;
    if (!orgContext.setActiveOrg(orgId)) {
      chosenOrgId = null;
      return { ok: false, reason: 'unknown_org', message: SWITCH_UNKNOWN_ORG_MESSAGE };
    }
    return { ok: true };
  }

  return {
    ready: started,
    orgContext,
    switchOrg,
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
      // Nothing may start a navigation from here on: no org-change reaction, no late Retry or sign-in.
      unsubscribeOrgContext();
      routerRef.current = null;
      // Only a context made here is this app's to end; an injected one belongs to its caller.
      if (!injectedOrgContext) orgContext.destroy();
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
