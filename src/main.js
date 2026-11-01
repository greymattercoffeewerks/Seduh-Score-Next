// Composition root (2026-08-29 app-wiring pass). The one file allowed to
// know both "this app is Cup Taster" (the `defaultFormat: 'cup_taster'`
// passed into core/eventsScreen.js) and the full route table connecting
// every already-built, already-reviewed screen. Everything downstream stays
// format-agnostic (core/router.js has zero opinion about screens or chrome)
// or is itself the format module being wired (formats/cup-taster/*).
import { createRouter } from './core/router.js';
import { mountAppShell } from './core/appShell.js';
import { getLegacyAudienceOrgId, getLegacyAudienceOrgSlug } from './core/config.js';
import { resolveOrgBySlug } from './core/orgResolver.js';
import { createOrgContext, ORG_STATUS } from './core/orgContext.js';
import { mustChangePassword } from './core/sessionGate.js';
import { goToHash, replaceHash } from './core/navigation.js';
import { orgLabel } from './core/orgLabel.js';
import { getSupabase } from './core/supabaseClient.js';
import { el, setBusyDisabled } from './core/dom.js';
import { describeError } from './core/errors.js';
import { findEvent, findEventOrgId } from './core/events.js';
import { cacheGet, cacheSet } from './core/db.js';
import { findMatchEventId } from './formats/btc/matches.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './core/timeout.js';
import { mountEventsScreen } from './core/eventsScreen.js';
import { mountLoginScreen } from './core/loginScreen.js';
import { mountSetPasswordScreen } from './core/setPasswordScreen.js';
import { mountForgotPasswordScreen } from './core/forgotPasswordScreen.js';
import { mountRecoveryScreen } from './core/recoveryScreen.js';
import { mountChangePasswordScreen } from './core/changePasswordScreen.js';
import { createRecoveryFlow, takeRecoveryArrival } from './core/passwordRecovery.js';
import { mountTeamScreen } from './core/teamScreen.js';
import { mountPeopleScreen } from './core/peopleScreen.js';
import { mountNoOrgScreen } from './core/noOrgScreen.js';
import { loadWindowState, windowWarningText } from './core/eventWindow.js';
import { mountEventWindowLockedScreen } from './core/eventWindowScreen.js';
import { canManageTeam } from './core/team.js';
import { mountEventDashboardScreen } from './formats/cup-taster/eventDashboardScreen.js';
import { mountSetupScreen } from './formats/cup-taster/setupScreen.js';
import { mountRosterScreen } from './formats/cup-taster/rosterScreen.js';
import { mountReportScreen } from './formats/cup-taster/reportScreen.js';
import { mountHeatGenerationScreen } from './formats/cup-taster/heatsScreen.js';
import { mountStandingsScreen } from './formats/cup-taster/standingsScreen.js';
import { mountTimingRouteScreen } from './formats/cup-taster/timingRouteScreen.js';
import { mountScoringScreen } from './formats/cup-taster/scoringScreen.js';
import { mountProjector, mountPhone, mountSplash } from './liveSurfaces.js';
import { mountBtcEventDashboardScreen } from './formats/btc/eventDashboardScreen.js';
import { mountSetupScreen as mountBtcSetupScreen } from './formats/btc/setupScreen.js';
import { mountMatchesScreen as mountBtcMatchesScreen } from './formats/btc/matchesScreen.js';
import { mountStandingsScreen as mountBtcStandingsScreen } from './formats/btc/standingsScreen.js';
import { mountBracketScreen as mountBtcBracketScreen } from './formats/btc/bracketScreen.js';
import { mountScoringScreen as mountBtcScoringScreen } from './formats/btc/scoringScreen.js';
import { flushOutbox, listPendingOperations, setOutboxOwner } from './core/outbox.js';
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
const ORG_CHANGED_MESSAGE =
  'Your organisation changed while this event was opening. Try again to open it in the one you are working in now.';

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

// ---- Links into another organisation's event (T-TEN.C7) ----
//
// Every console route is organisation-scoped, and the person's active organisation decides the header,
// the Events list, what gets queued and what gets sent. An event URL carries no organisation, and a
// person in two organisations can open either one's events (they are visible to every member). So for an
// event-keyed route the event's own organisation is read first: the same as the active one (the common
// case: nothing changes), another of theirs (switch to it, say so, then show the event), or not one of
// theirs / not there at all ("not found": the database makes those the same answer).
//
// A person with ONE organisation is asked too, but more gently (placeOwnOrgEventRoute): there is nothing to
// switch to, so the only question is "is this event mine?", and the answer is never allowed to hold up or
// break the screen. Without it, an event link from ANOTHER organisation (which the database hides from them)
// reached the event screen, failed to load, and showed a generic "Something went wrong saving that" with a
// Retry that could never work. The answer is remembered on the device (so an event, or a BTC match, costs one
// read the first time it is opened there), the whole question is given up on after a couple of seconds, and on
// any failure the event screen opens exactly as it always did. The one cost is a wait of up to that couple of
// seconds on the very first visit to an event when the network is black-holed (connected, but nothing answers).
// Only the first visit sees "Page not found" for an event that has since been deleted: one already remembered
// opens its screen straight away, and the screen reports its own load failure.
//
// The answer is remembered on the device (an event never changes organisation), so reloading an event
// page with no connection still finds its organisation. For a person with SEVERAL organisations a failed read
// with nothing remembered is a Retry card, never a guess (they need the answer to know where to work); a person
// with one is never refused for want of it.

// A malformed id (not a uuid) is "no such row", not a failure worth retrying.
const INVALID_TEXT_REPRESENTATION = '22P02';
const isInvalidIdError = (err) => err?.code === INVALID_TEXT_REPRESENTATION;

// How long a read of the device's own memory may take before it is given up on (a stuck IndexedDB open must
// not hang a navigation).
const REMEMBERED_READ_TIMEOUT_MS = 2000;
const readRemembered = (key) =>
  raceTimeout(cacheGet(key), REMEMBERED_READ_TIMEOUT_MS).catch(() => null);

// Resolves to the value, or null when there is none to be had (no such row, or a malformed id); throws when it
// cannot tell. A found answer is remembered on this device. `settled`: the answer can never change (an
// event never changes organisation), so what was remembered is used at once, with no request to wait for;
// otherwise the database is asked first and the memory is only the fallback when that read fails.
async function rememberedLookup(
  key,
  read,
  { settled = false, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
) {
  if (settled) {
    const remembered = await readRemembered(key);
    if (remembered) return remembered;
  }
  try {
    const value = await raceTimeout(read(), timeoutMs);
    if (value) cacheSet(key, value).catch(() => {});
    return value ?? null;
  } catch (err) {
    if (isInvalidIdError(err)) return null;
    const remembered = settled ? null : await readRemembered(key);
    if (remembered) return remembered;
    throw err;
  }
}

// { status: 'found', orgId }; { status: 'missing' }; { status: 'error', error }.
// A BTC match is resolved through its event (that is what its screen shows, whatever event id the URL
// carries); any other event-keyed route uses the event id in the URL.
async function resolveRouteOrg(params, client, { timeoutMs } = {}) {
  try {
    const eventId = params.matchId
      ? await rememberedLookup(
          `matchEvent:${params.matchId}`,
          () => findMatchEventId(params.matchId, client),
          // a match never moves to another event, so what is remembered is used at once (like the event's organisation)
          { settled: true, timeoutMs },
        )
      : params.eventId;
    if (!eventId) return { status: 'missing' };
    const orgId = await rememberedLookup(
      `eventOrg:${eventId}`,
      () => findEventOrgId(eventId, client),
      { settled: true, timeoutMs },
    );
    return orgId ? { status: 'found', orgId } : { status: 'missing' };
  } catch (error) {
    return { status: 'error', error };
  }
}

// The card shown when the event belongs to another of the person's organisations but the console cannot
// move there yet (changes here have not synced): says so, with the reason, and a way back.
function mountOtherOrgBlockedScreen(outlet, { orgName, currentOrgName, result, retry }) {
  outlet.innerHTML = '';
  const heading = el('h1', {
    text: `This event is in ${orgName}`,
    attrs: { tabindex: '-1', 'aria-describedby': 'other-org-reason' },
  });
  outlet.appendChild(
    el('section', { className: 'screen-container' }, [
      heading,
      el('p', { id: 'other-org-reason', text: blockedReason(result, currentOrgName) }),
      el('div', { className: 'btn-row' }, [
        el('button', {
          className: 'btn btn-primary tap-target',
          text: 'Try again',
          attrs: { type: 'button' },
        }),
        el('a', {
          className: 'btn btn-outline tap-target',
          text: `Back to ${currentOrgName} events`,
          attrs: { href: '#/events' },
        }),
      ]),
    ]),
  );
  outlet.querySelector('button').addEventListener('click', retry);
  heading.focus();
  return { unmount() {} };
}

// Why the link cannot open yet, in words for someone who never asked to switch: they followed a link.
function blockedReason(result, currentOrgName) {
  if (result.reason === 'unsynced') {
    const many = result.count !== 1;
    return `You are working in ${currentOrgName}. ${result.count} ${many ? 'changes' : 'change'} on this device ${many ? 'have' : 'has'} not synced yet, so this event cannot be opened yet. Wait for ${many ? 'them' : 'it'} to sync, then try again.`;
  }
  return `You are working in ${currentOrgName}. ${result.message}`;
}

// How long a person with one organisation waits, in all, for "whose event is this?" before the event screen is
// simply opened.
const OWN_ORG_LOOKUP_TIMEOUT_MS = 2500;

// A person with ONE organisation opening an event link: is it theirs? Not theirs (or not there: the database
// makes those the same answer) is "Page not found", the same card people in several organisations get. A question
// that cannot be answered (offline, slow, an error) is NOT a reason to refuse: the event screen opens as it
// always did, and it reports its own load failure if the event really is out of reach.
async function placeOwnOrgEventRoute(outlet, params, org, { orgContext, retry, showCard }) {
  // ONE budget for the whole question (the remembered answers and the reads together), not one per read.
  const target = await raceTimeout(
    resolveRouteOrg(params, params.client, { timeoutMs: OWN_ORG_LOOKUP_TIMEOUT_MS }),
    OWN_ORG_LOOKUP_TIMEOUT_MS,
  ).catch((error) => ({ status: 'error', error }));
  if (params.signal?.aborted) return { screen: undefined };
  // As for several organisations: if the person or organisation changed while the lookup was on its way, this
  // navigation was started under the old one, so start it again.
  const fresh = orgContext.getState();
  if (
    fresh.status !== ORG_STATUS.READY ||
    fresh.userId !== org.userId ||
    fresh.activeOrgId !== org.activeOrgId
  ) {
    retry();
    return { screen: undefined };
  }
  // While the list of organisations is only the remembered stand-in (the real one could not be fetched), "not in
  // my list" proves nothing: a person added since would be told their own event does not exist.
  if (target.status === 'error' || org.stale) return { org };
  const theirs =
    target.status === 'found' && org.orgs.some((candidate) => candidate.id === target.orgId);
  if (!theirs) return { screen: showCard(mountNotFoundScreen(outlet)) };
  return { org };
}

// Resolves to `{ org, notice }` (the organisation snapshot to mount under, switched if needed, and what to
// say about it) or to `{ screen }` (something already put in the outlet instead: not found, a Retry card, the
// blocked card; `screen` is undefined when the navigation is being started again or was superseded).
async function placeEventRoute(
  outlet,
  params,
  org,
  { orgContext, switchOrgForRoute, retry, showCard },
) {
  if (!(params.eventId || params.matchId)) return { org };
  if (org.orgs.length < 2)
    return placeOwnOrgEventRoute(outlet, params, org, { orgContext, retry, showCard });
  const target = await resolveRouteOrg(params, params.client);
  if (params.signal?.aborted) return { screen: undefined };
  // The organisation may have been changed (the header's select) while the lookup was on its way: this
  // navigation was started under the old one, so start it again under the new one rather than mounting an
  // event under a label that is no longer true.
  const fresh = orgContext.getState();
  if (
    fresh.status !== ORG_STATUS.READY ||
    fresh.userId !== org.userId ||
    fresh.activeOrgId !== org.activeOrgId
  ) {
    retry();
    return { screen: undefined };
  }
  if (target.status === 'error') {
    const message = target.error?.timedOut ? TIMEOUT_MESSAGE : describeError(target.error);
    return { screen: showCard(renderRetryableError(outlet, message, retry)) };
  }
  const memberOrg =
    target.status === 'found' && org.orgs.find((candidate) => candidate.id === target.orgId);
  if (!memberOrg) return { screen: showCard(mountNotFoundScreen(outlet)) };
  if (target.orgId === org.activeOrgId) return { org };

  // (If the person moves on while this is being checked, the switch still happens: header and screen are
  // then both the new organisation's, never mixed.)
  const result = await switchOrgForRoute(target.orgId);
  if (params.signal?.aborted) return { screen: undefined };
  if (!result.ok) {
    const current = org.orgs.find((candidate) => candidate.id === org.activeOrgId);
    return {
      screen: showCard(
        mountOtherOrgBlockedScreen(outlet, {
          orgName: orgLabel(memberOrg, org.orgs),
          currentOrgName: current ? orgLabel(current, org.orgs) : 'your organisation',
          result,
          retry,
        }),
      ),
    };
  }
  const now = orgContext.getState();
  if (now.status !== ORG_STATUS.READY || now.activeOrgId !== target.orgId) {
    // Something else moved the organisation again. Not started over by itself (an organisation that keeps
    // moving would loop): the person is told, and Try again is theirs.
    return { screen: showCard(renderRetryableError(outlet, ORG_CHANGED_MESSAGE, retry)) };
  }
  // Said once the event's screen is on show and has taken focus (a polite announcement written while focus
  // is still moving is the one a screen reader drops).
  return {
    org: now,
    notice: `Now working in ${orgLabel(memberOrg, now.orgs)}, the organisation this event belongs to.`,
  };
}

// Temporary auth gate (2026-08-30) — deliberately confined to this file,
// not core/router.js, since router.js is meant to be reused unedited by a
// future format and this concept (an unauthenticated screen swap-in) is
// explicitly scoped as temporary, ahead of D14's real entitlements-based
// gating. `routerRef` is a mutable box read lazily inside onSignedIn/retry —
// it's still null at buildRoutes() call time (createRouter() needs the
// routes this function returns), but by the time either can actually fire,
// mountApp has already set it.
function requireAuth(
  mount,
  {
    routerRef,
    orgContext,
    onConsoleMounted,
    switchOrgForRoute,
    showRouteNotice,
    clearEventContext,
    getRecoveryFlow = () => null,
  },
) {
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

    // A password-recovery link was opened (D-PW1): nothing else is reachable until the person has chosen a
    // new password, or left the flow. Before the session lookup below: the flow establishes the link's
    // session itself, and an expired link has no session to look up.
    const recoveryFlow = getRecoveryFlow();
    if (recoveryFlow?.isOpen()) {
      return mountRecoveryScreen(outlet, {
        flow: recoveryFlow,
        onFinished: resolveCurrentPath,
        signal: params.signal,
      });
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
    let org = await resolveOrg(orgContext, session, params.signal);
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
    // A link into an event (or a BTC match) of ANOTHER of this person's organisations: the console must
    // work in that event's organisation, never show it under the wrong organisation's name (T-TEN.C7).
    const placed = await placeEventRoute(outlet, params, org, {
      orgContext,
      switchOrgForRoute,
      retry: resolveCurrentPath,
      // A card put up for this link (not found, Retry, blocked) is about the organisation the person is
      // in now: it names no event, so the header must not keep naming one, and moving to another
      // organisation takes them to that organisation's Events list like any other screen.
      showCard: (card) => {
        clearEventContext();
        onConsoleMounted(`${org.userId}:${org.activeOrgId}`);
        return card;
      },
    });
    if ('screen' in placed) return placed.screen;
    org = placed.org;
    // An event on a Per-event plan whose window has ended is closed by the database (its tables read empty and
    // refuse writes); say so in words instead of mounting screens that would come up empty. UX only, and it fails
    // open: a slow or failed lookup opens the screen as it always did (the database decides either way).
    let windowState = { kind: 'none', endsAt: null };
    if (params.eventId) {
      windowState = await loadWindowState(org.activeOrgId, params.eventId, params.client);
      if (params.signal?.aborted) return undefined;
      if (windowState.kind === 'locked') {
        clearEventContext();
        onConsoleMounted(`${org.userId}:${org.activeOrgId}`);
        return mountEventWindowLockedScreen(outlet, { state: windowState });
      }
    }
    // The organisation the console works in is handed to the screen at mount, from the person's own
    // memberships; a change of person or organisation re-mounts the console (mountApp) rather than
    // mutating a screen in place. Remember who and which org this screen was built for.
    onConsoleMounted(`${org.userId}:${org.activeOrgId}`);
    // The name comes from the very snapshot the id came from (never from live state a moment later), so a
    // screen can never show one organisation's name over another's data.
    const activeOrg = org.orgs.find((candidate) => candidate.id === org.activeOrgId);
    const screen = await mount(outlet, {
      ...params,
      orgId: org.activeOrgId,
      // What to call it (the slug is added when two of the person's organisations share a name).
      orgName: activeOrg ? orgLabel(activeOrg, org.orgs) : null,
      // For the links an organiser hands to the audience.
      orgSlug: activeOrg?.slug ?? null,
    });
    // What to say once the screen is on show: why the organisation changed, and that the Per-event plan is about to end.
    const notice = [placed.notice, windowWarningText(windowState)].filter(Boolean).join(' ');
    if (notice && !params.signal?.aborted) showRouteNotice(notice);
    return screen;
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
function mountEventHomeScreen(outlet, { eventId, client, signal }) {
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
    return mountEventDashboardScreen(outlet, { eventId, client, signal });
  }
  return attempt();
}

// The holding card of the audience routes (viewer-shell.css's look): large, centred, dark stage tokens on a
// projector or the splash screen, the ordinary paper look on a phone. ONE card per mount, its text changed in
// place: the body is a persistent polite live region, so a screen reader hears each change once and nothing
// at all when the same words are set again (a card rebuilt on every retry would be announced, or not, at
// random). `action` is an optional button (a phone's "Try again now").
function createHoldingCard(root, { stage }) {
  root.innerHTML = '';
  if (stage) root.setAttribute('data-surface', 'stage');
  const title = el('h1', { className: 'viewer-holding-title' });
  const body = el('p', {
    className: 'viewer-holding-body',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const action = el('button', {
    className: 'btn btn-primary tap-target',
    attrs: { type: 'button', hidden: '' },
  });
  const card = el('div', { className: 'out-of-date-link' }, [
    el('div', { className: 'viewer-holding-card' }, [title, body, action]),
  ]);
  root.appendChild(card);
  return {
    isShown: () => root.contains(card),
    set({ title: titleText, body: bodyText, actionLabel = null, onAction = null }) {
      if (title.textContent !== titleText) title.textContent = titleText;
      if (body.textContent !== bodyText) body.textContent = bodyText;
      action.hidden = !actionLabel;
      action.onclick = onAction;
      if (actionLabel) action.textContent = actionLabel;
    },
  };
}

// A card that does not change: "This link is out of date". Its unmount does nothing, like the not-found
// screen's: the router mounts the next screen first, and the three routes share one root.
function mountOutOfDateLinkScreen(root, { stage }) {
  createHoldingCard(root, { stage }).set({
    title: 'This link is out of date',
    body: 'Ask whoever shared it with you for a new one.',
  });
  return { unmount() {} };
}

// ---- Audience links that name the organiser (T-TEN.D1) ----
//
// #/live/<slug>/projector (and /phone, /splash): the slug is turned into the organisation the surface works
// with (core/orgResolver.js), and the three outcomes are told apart on the screen: found (the surface
// mounts), not found ("We couldn't find that organiser": a mistyped or retired link must never read as "no
// event tonight"), and could not be asked (a card that says so and keeps trying until it can, so a projector
// that lost its wifi recovers by itself). The card is on screen from the first moment (the first lookup can
// take its whole 10-second allowance on bad wifi: never a blank page). The old slug-less links go through the
// same path when a legacy slug is configured (the shim): the slug, when set, is the only one asked; a slug
// that does not resolve shows "not found" and does NOT fall back to the older org id.
const AUDIENCE_RETRY_MS = [3000, 6000, 12000, 20000, 30000];
// Every phone in a room that loses its wifi would otherwise retry on the same beat.
const AUDIENCE_RETRY_JITTER = 0.25;

function mountAudienceBySlug(outlet, { slug, stage, client, signal, mountSurface }) {
  let stopped = false;
  let inner = null;
  let timer = null;
  let attempt = 0;
  let card = null;

  function showCard(content) {
    if (!card?.isShown()) {
      resetBareSurface(outlet);
      card = createHoldingCard(outlet, { stage });
    }
    card.set(content);
  }

  async function resolve() {
    clearTimeout(timer);
    timer = null;
    if (stopped || signal?.aborted) return;
    const outcome = await resolveOrgBySlug(slug, client);
    // Superseded while asking (the person moved on, or this was unmounted): nothing may touch the outlet.
    if (stopped || signal?.aborted) return;
    if (outcome.status === 'found') {
      // Where focus is now: on this card or on the page, in which case it goes to the surface's heading.
      const hadFocus =
        document.activeElement === document.body || outlet.contains(document.activeElement);
      resetBareSurface(outlet);
      try {
        inner = (await mountSurface(outlet, { orgId: outcome.org.id, client, signal })) ?? null;
      } catch (error) {
        // The surface itself failed to start: say so and keep trying, never a dead card.
        console.error('main: an audience surface failed to start', error);
        if (!stopped && !signal?.aborted) scheduleRetry();
        return;
      }
      // Unmounted while the surface itself was still starting: take it down again.
      if (stopped) {
        await inner?.unmount?.();
        return;
      }
      if (hadFocus) focusFirstHeading(outlet);
      return;
    }
    if (outcome.status === 'not_found') {
      showCard({
        title: 'We couldn’t find that organiser',
        body: 'This link doesn’t match any organiser. Check the link, or ask whoever shared it with you for a new one.',
      });
      return;
    }
    scheduleRetry();
  }

  function scheduleRetry() {
    showCard({
      title: 'We can’t reach Seduh right now',
      body: 'Check the internet connection. This page will update by itself.',
      // A phone's owner can act on it; nobody is touching a projector, where a button only invites a stray tap.
      ...(stage ? {} : { actionLabel: 'Try again now', onAction: resolve }),
    });
    const base = AUDIENCE_RETRY_MS[Math.min(attempt, AUDIENCE_RETRY_MS.length - 1)];
    attempt += 1;
    timer = setTimeout(resolve, base * (1 + Math.random() * AUDIENCE_RETRY_JITTER));
  }

  // Back on the network, or back on the tab: try at once rather than wait out the backoff (only while this
  // is still waiting to retry).
  function tryNow() {
    if (timer !== null) resolve();
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') tryNow();
  };
  window.addEventListener('online', tryNow);
  document.addEventListener('visibilitychange', onVisible);

  resetBareSurface(outlet);
  showCard({ title: 'Opening this link…', body: 'One moment.' });
  return resolve().then(() => ({
    unmount() {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', tryNow);
      document.removeEventListener('visibilitychange', onVisible);
      return inner?.unmount?.();
    },
  }));
}

// The audience links an organiser hands out for ONE organisation (T-TEN.D4): slug-qualified, so each names the
// organiser and works for any organisation. The ORIGIN and path are where this page is served from (so a link
// made on the production site opens the production site); a slug is letters, digits and hyphens, so encoding
// it changes nothing but is kept for safety. Null when the organisation has no slug to name.
export function audienceHash(orgSlug, surface) {
  if (typeof orgSlug !== 'string' || !orgSlug.trim()) return null;
  return `#/live/${encodeURIComponent(orgSlug.trim())}/${surface}`;
}

export function audienceLinksFor(orgSlug, location = window.location) {
  if (!audienceHash(orgSlug, 'phone')) return null;
  const page = `${location.origin}${location.pathname}`;
  return {
    phone: page + audienceHash(orgSlug, 'phone'),
    projector: page + audienceHash(orgSlug, 'projector'),
    splash: page + audienceHash(orgSlug, 'splash'),
  };
}

function focusFirstHeading(root) {
  const heading = root.querySelector('h1, h2');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

// What each audience surface is: the stage look (projector, splash) or the paper look (phone), and what
// mounts once the organisation is known.
const AUDIENCE_SURFACES = {
  projector: { stage: true, mountSurface: mountProjector },
  phone: { stage: false, mountSurface: mountPhone },
  splash: { stage: true, mountSurface: mountSplash },
};

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
  legacyAudienceOrgSlug = null,
  orgContext,
  bareRoot,
  routerRef,
  onConsoleMounted,
  setTeamHoldsSecret = () => {},
  showRouteNotice = () => {},
  clearEventContext = () => {},
  switchOrgForRoute = async () => ({
    ok: false,
    message: 'This event belongs to another of your organisations, which could not be opened.',
  }),
  getRecoveryFlow = () => null,
}) {
  const auth = {
    routerRef,
    orgContext,
    onConsoleMounted,
    switchOrgForRoute,
    showRouteNotice,
    clearEventContext,
    getRecoveryFlow,
  };
  return [
    {
      // Asks for a password-recovery link. Deliberately NOT wrapped in requireAuth: the person cannot sign
      // in, which is why they are here.
      pattern: '/forgot-password',
      mount: (outlet, { client, signal }) => mountForgotPasswordScreen(outlet, { client, signal }),
    },
    {
      pattern: '/account/password',
      mount: requireAuth(
        (outlet, { client, signal }) => mountChangePasswordScreen(outlet, { client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events',
      mount: requireAuth(
        (outlet, { client, signal, orgId, orgName, orgSlug }) =>
          mountEventsScreen(outlet, {
            orgId,
            orgName,
            audienceLinks: audienceLinksFor(orgSlug),
            peopleHref: '#/people',
            client,
            defaultFormat: 'cup_taster',
            formatOptions: FORMAT_OPTIONS,
            // Only Cup Taster has a manual publish (its report screen); other formats get no "Publish now" link.
            archivePublishHrefFor: (event) =>
              event.format === 'cup_taster' ? `#/events/${event.id}/report` : null,
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
      pattern: '/people',
      mount: requireAuth(
        (outlet, { client, signal, orgId, orgName }) =>
          mountPeopleScreen(outlet, { orgId, orgName, client, signal }),
        auth,
      ),
    },
    {
      pattern: '/events/:eventId',
      mount: requireAuth(
        (outlet, { eventId, client, signal }) =>
          mountEventHomeScreen(outlet, { eventId, client, signal }),
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
    // The audience routes: deliberately NOT wrapped in requireAuth — the audience never authenticates, by
    // design (live_sessions is anon-readable; see 20260821240000_grants.sql). `signal` IS threaded through
    // every one: the three share `bareRoot`, and leaving any unprotected would leave a gap on the shared
    // outlet (viewer-shell.js's own `mounted` flag does not cover a still-in-flight FIRST load).
    //
    // Slug-qualified links (T-TEN.D1), then the old slug-less ones, which keep working (the legacy shim).
    ...Object.entries(AUDIENCE_SURFACES).flatMap(([name, { stage, mountSurface }]) => [
      {
        pattern: `/live/:orgSlug/${name}`,
        chrome: false,
        outlet: bareRoot,
        mount: (outlet, { orgSlug, client, signal }) =>
          mountAudienceBySlug(outlet, { slug: orgSlug, stage, client, signal, mountSurface }),
      },
      {
        pattern: `/live/${name}`,
        chrome: false,
        outlet: bareRoot,
        mount: (outlet, { client, signal }) => {
          if (legacyAudienceOrgSlug) {
            return mountAudienceBySlug(outlet, {
              slug: legacyAudienceOrgSlug,
              stage,
              client,
              signal,
              mountSurface,
            });
          }
          resetBareSurface(outlet);
          if (!legacyAudienceOrgId) return mountOutOfDateLinkScreen(outlet, { stage });
          return mountSurface(outlet, { orgId: legacyAudienceOrgId, client, signal });
        },
      },
    ]),
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

// Console routes that are not the Events list (so the Events link is not marked current on them).
const NON_EVENTS_PATTERNS = new Set(['/team', '/account/password', '/forgot-password']);

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
    client: injectedClient,
    // A password-recovery link that arrived with this page load (see below). Undefined: read the address
    // bar. A test, or a caller that has already read it, passes the arrival itself (or null for none).
    recoveryArrival: injectedRecoveryArrival,
    orgContext: injectedOrgContext,
    legacyAudienceOrgId = getLegacyAudienceOrgId(),
    legacyAudienceOrgSlug = getLegacyAudienceOrgSlug(),
  } = {},
) {
  // FIRST, before the Supabase client is built (it would read the same hash and keep a session out of it)
  // and before the router starts (it would try to route `#access_token=…&type=recovery` as a console route
  // and show "Page not found" with the token still in the address bar): a password-recovery link carries
  // its session in the hash. Taking it removes it from the address bar at once (core/passwordRecovery.js).
  // This order is load-bearing: the organiser client reads the same hash by default, so building it first (an eager
  // getSupabase() added above this line later) would consume the link's token before it is taken.
  const arrival =
    injectedRecoveryArrival !== undefined ? injectedRecoveryArrival : takeRecoveryArrival();
  const client = injectedClient ?? getSupabase();
  let recoveryFlow = arrival ? createRecoveryFlow({ client, arrival }) : null;
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
  // The outbox replays only the signed-in account's operations in the active organisation (T-TEN.C6:
  // core/outbox.js), so it has to be told who and where. Nobody signed in until the first auth event
  // says otherwise: from here on nothing can flush for a person who is not known, which is the
  // fail-closed side of the outbox's "unset" default. Called whenever the session or the active
  // organisation changes, and always BEFORE the flush those changes may start.
  setOutboxOwner(null);
  let currentSession = null;
  function syncOutboxOwner() {
    const userId = currentSession?.user?.id ?? null;
    setOutboxOwner(userId ? { userId, orgId: orgContext.getActiveOrgIdFor(userId) } : null);
  }
  function flushIfOwner() {
    if (!hasSession || !onConsoleRoute) return;
    // Only once the organisation is known: the outbox replays an operation only in the organisation it
    // was made in, so a flush before the answer arrives could run nothing that matters, and the answer
    // itself starts one (the org-context subscriber below). That also covers someone in no organisation
    // at all: whatever is queued on this device was left by somebody else, and replaying it under this
    // person's login would be refused by the database as a permanent failure, which the outbox would
    // then drop. The outbox refuses to replay an operation that is not this account's in this
    // organisation too; this is the second, independent barrier.
    const userId = currentSession?.user?.id;
    if (!userId || !orgContext.getActiveOrgIdFor(userId)) return;
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
  } = client.auth.onAuthStateChange((event, session) => {
    // The session behind a password-recovery form ended (Sign out, or another tab): the form could only
    // fail now, so the flow is over and the front door (sign-in) takes its place. Re-resolved a tick
    // later, outside the auth lock, like every other reaction to an auth event in this handler.
    if (event === 'SIGNED_OUT' && recoveryFlow?.sessionEnded()) {
      setTimeout(() => routerRef.current?.resolve(currentRoutePath()), 0);
    }
    hasSession = Boolean(session);
    currentSession = session;
    syncOutboxOwner();
    // Not awaited, and it reads the database only a tick later (see orgContext.js): safe here.
    orgContext.refresh(session);
    flushIfOwner();
    refreshTeamOwnership(session);
  });

  // After a failed or stand-in organisation answer: ask again, and if the console was showing the error
  // card, show the real screen. Queued changes cannot be sent until the organisation is known (the outbox
  // replays an operation only in the organisation it was made in), so this also has to happen while the
  // device stays online, not only when it comes back: see the retry timer below.
  function retryOrgIfNeeded() {
    const orgState = orgContext.getState();
    if (!currentSession || (orgState.status !== ORG_STATUS.ERROR && !orgState.stale)) return;
    orgContext.retry().then(() => {
      if (orgState.status === ORG_STATUS.ERROR) routerRef.current?.resolve(currentRoutePath());
    });
  }
  function onOnline() {
    flushIfOwner();
    retryOrgIfNeeded();
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
    retryOrgIfNeeded();
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
  // The address a route notice was shown at (see showRouteNotice).
  let noticeHash = null;
  // Set by the Team screen while leaving it would lose a one-time password; cleared whenever any console
  // screen is mounted (the Team screen reports it again if it needs to).
  let teamHoldsSecret = false;
  const routes = buildRoutes({
    legacyAudienceOrgId,
    legacyAudienceOrgSlug,
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
    switchOrgForRoute,
    showRouteNotice,
    clearEventContext: () => shell.clearEventContext(),
    getRecoveryFlow: () => recoveryFlow,
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
    // The organisation the outbox works for follows the active one (a person who just switched to an
    // organisation, or whose organisation has only just been answered, has operations waiting there).
    syncOutboxOwner();
    flushIfOwner();
    // The header must never be able to stop the screen swap below (an old organisation's console left
    // up under the new one is the invariant this subscriber exists for).
    try {
      showOrganisation(state);
    } catch (err) {
      console.error('main: the organisation slot failed to render', err);
    }
    refreshTeamOwnership(currentSession);
    // The audience links depend on which organisation is active.
    if (lastNav) renderNav(lastNav.route, lastNav.params);
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
    // A notice about the screen the person was on does not follow them to the next one (the same route
    // announced twice, as a browser may, is not "the next one").
    if (noticeHash !== null && location.hash !== noticeHash) {
      noticeHash = null;
      shell.dismissNotice();
    }
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
      {
        label: 'Events',
        href: '#/events',
        active: !params.eventId && !NON_EVENTS_PATTERNS.has(route.pattern),
      },
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
    // The audience screens, for whichever organisation the console is working in (T-TEN.D4): slug-qualified
    // links, so any organisation's organiser has them (they used to exist only for the one legacy organisation,
    // because the old links could only show that one). They open in a new tab; the Events screen also offers
    // them with a QR code to hand to the audience.
    const activeSlug = orgContext.getActiveOrg()?.slug;
    if (audienceHash(activeSlug, 'phone')) {
      links.push(
        { label: 'Splash screen', href: audienceHash(activeSlug, 'splash'), openInNewTab: true },
        {
          label: 'Projector view',
          href: audienceHash(activeSlug, 'projector'),
          openInNewTab: true,
        },
        { label: 'Phone view', href: audienceHash(activeSlug, 'phone'), openInNewTab: true },
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

  // A recovery link opened INTO an already-running console (the hash changes, the page does not reload, so
  // the take above never saw it). Registered before the router's own listener so it runs first: it takes
  // the token out of the address bar and points the hash at the console, whose gate then shows the flow.
  function onRecoveryHashChange() {
    const next = takeRecoveryArrival();
    if (!next) return;
    recoveryFlow = createRecoveryFlow({ client, arrival: next });
    history.replaceState(history.state, '', '#/events');
  }
  window.addEventListener('hashchange', onRecoveryHashChange);

  const started = router.start(shell.outlet, { fallbackPath: '/events' });

  // Switch the organisation the console works in. Refused, with a message to show, while this account
  // still has changes in the CURRENT organisation that have not synced (the outbox's own list: another
  // account's changes, or this account's in another organisation, are not this switch's business, and
  // the sync panel reports them). The refusal is a courtesy, not the safety: every operation is
  // tagged with the organisation it was made in, so one queued in the instant between the check and the
  // switch (a write from the screen being replaced) stays queued for that organisation and is reported
  // as waiting for it, never replayed into the new one. The screen change itself follows from the org
  // context's own notification above.
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

  // The same switch, for a link into another organisation's event: the navigation that asked for it is
  // replacing whatever screen is on show, so that screen must not be sent back to the Events list by the
  // organisation change it is about to cause (the org-context subscriber above).
  async function switchOrgForRoute(orgId) {
    mountedKey = null;
    // This navigation is replacing the screen on show anyway (a link inside the same organisation would
    // do the same), so a one-time password on the Team screen no longer blocks the switch.
    teamHoldsSecret = false;
    return switchOrg(orgId);
  }

  // The notice that explains why the organisation changed under a link (shown by requireAuth once the
  // event's screen has focus). It belongs to the screen it explains: moving on puts it away.
  function showRouteNotice(text) {
    noticeHash = location.hash;
    shell.showNotice(text);
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
      // Nobody is being worked for any more. Before the awaits: a newer mountApp() that starts while this
      // one is still stopping must not have its owner taken away afterwards.
      setOutboxOwner(null);
      await router.stop();
      shell.unmount();
      window.removeEventListener('hashchange', onRecoveryHashChange);
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
