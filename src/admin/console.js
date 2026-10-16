// Composition for the admin console: ask the gate who this is and what is missing, draw the one screen that
// answers it, and ask again whenever something that could change the answer happens (a sign-in, a verified
// code, a sign-out, a gate refusal from a panel, a retry). Everything is injected (the client, the panel
// list), so a test drives the whole flow with a fake client.
import { trackInputModality } from '../core/inputModality.js';
import { getAdminClient } from './adminClient.js';
import { invokeAdminFunction } from './adminFunction.js';
import { checkAccess, signOut, isGateRefusal, isAuthFailure, GATE_STATE } from './gate.js';
import { PANELS } from './panels.js';
import { mountShell } from './shell.js';
import { mountSignInScreen } from './signInScreen.js';
import { mountChallengeScreen, mountEnrolScreen } from './mfaScreens.js';
import {
  mountCheckingScreen,
  mountNoAccessScreen,
  mountCheckFailedScreen,
} from './statusScreens.js';

// While the console is open the gate is asked again now and then, not just at the start: a second factor goes
// stale after an hour, and another tab's "Sign out everywhere" ends this tab's session, and until it is asked
// the header would keep saying "Verified" over a console the database no longer honours.
export const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

export function mountAdminConsole(root, { client = getAdminClient(), panels = PANELS } = {}) {
  // Pointer users get no focus ring on the heading the console moves focus to after each screen; a keypress
  // brings the rings back (the same rule the organiser console follows).
  const stopTrackingInputModality = trackInputModality();
  let current = null;
  let ready = false;
  let unmounted = false;
  // Each route() takes a number; an answer that arrives after a newer route() started is discarded, so a slow
  // check can never paint over a screen the person has already moved on from.
  let generation = 0;

  function clear() {
    current?.unmount?.();
    current = null;
    root.replaceChildren();
  }

  async function signOutThenRoute(scope) {
    const result = await signOut(client, scope);
    if (result.ok) route();
    return result;
  }
  const onSignOut = () => signOutThenRoute('local');
  const onSignOutEverywhere = () => signOutThenRoute('global');

  // What a panel uses to call an admin function. A gate refusal in the answer (the second factor went stale,
  // the session ended, the login stopped being an admin) is handled HERE, by running the access check again,
  // so no panel has to remember to look for it; the answer is still returned for the panel's own handling.
  async function callAdmin(name, args) {
    const result = await client.rpc(name, args);
    // A rejected token (HTTP 401) has no hint, but it closes the gate just the same: sign in again.
    if (isGateRefusal(result?.error) || isAuthFailure(result)) route();
    return result;
  }

  // The same for an Edge Function (a login can only be created by the Auth admin API). It answers like
  // callAdmin: { data, error } with error { hint, status, userId, timedOut, offline }, and a gate refusal or a
  // rejected token (HTTP 401) closes the gate here too.
  async function callFunction(name, body) {
    const result = await invokeAdminFunction(client, name, body);
    if (isGateRefusal(result.error) || result.error?.status === 401) route();
    return result;
  }

  function show(access) {
    clear();
    ready = access.state === GATE_STATE.READY;
    const verified = () => route();
    switch (access.state) {
      case GATE_STATE.SIGNED_OUT:
        current = mountSignInScreen(root, {
          client,
          notice: access.notice,
          onSignedIn: () => route(),
        });
        break;
      case GATE_STATE.NOT_ADMIN:
        current = mountNoAccessScreen(root, { email: access.email, onSignOut });
        break;
      case GATE_STATE.NEED_ENROL:
        current = mountEnrolScreen(root, {
          client,
          email: access.email,
          onVerified: verified,
          onSignOut,
        });
        break;
      case GATE_STATE.NEED_CHALLENGE:
        current = mountChallengeScreen(root, {
          client,
          factorId: access.factorId,
          email: access.email,
          onVerified: verified,
          onSignOut,
        });
        break;
      case GATE_STATE.READY:
        current = mountShell(root, {
          panels,
          email: access.email,
          ctx: { client, callAdmin, callFunction, onGateRefused: () => route() },
          onSignOut,
          onSignOutEverywhere,
        });
        break;
      default:
        current = mountCheckFailedScreen(root, {
          email: access.email,
          message: access.message,
          onRetry: () => route(),
          onSignOut,
        });
    }
    // A new screen is announced by moving focus to its notice if it opens with one (why the person is back at
    // sign-in), otherwise to its heading. The shell's panel moves focus to its own heading.
    (
      root.querySelector('.screen-feedback[data-tone]') ?? root.querySelector('[data-heading]')
    )?.focus();
  }

  async function route() {
    // A sign-in, a verified code or a sign-out that was still in flight when the console was unmounted lands
    // here afterwards; it must not paint into a root that is no longer ours.
    if (unmounted) return;
    ready = false;
    const mine = ++generation;
    clear();
    current = mountCheckingScreen(root);
    const access = await checkAccess(client);
    if (unmounted || mine !== generation) return;
    show(access);
  }

  // Asks the gate again WITHOUT blanking the console; only a changed answer replaces it. A route() started in
  // the meantime wins (it bumps `generation`), and a recheck never starts while nothing is `ready`.
  async function recheck() {
    if (unmounted || !ready) return;
    const mine = generation;
    const access = await checkAccess(client);
    if (unmounted || mine !== generation || !ready) return;
    if (access.state !== GATE_STATE.READY) show(access);
  }

  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') recheck();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  const recheckTimer = setInterval(recheck, RECHECK_INTERVAL_MS);

  route();

  return {
    unmount() {
      unmounted = true;
      generation += 1;
      clearInterval(recheckTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopTrackingInputModality();
      clear();
    },
  };
}
