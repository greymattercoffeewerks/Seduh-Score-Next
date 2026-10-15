// Composition for the admin console: ask the gate who this is and what is missing, draw the one screen that
// answers it, and ask again whenever something that could change the answer happens (a sign-in, a verified
// code, a sign-out, a gate refusal from a panel, a retry). Everything is injected (the client, the panel
// list), so a test drives the whole flow with a fake client.
import { trackInputModality } from '../core/inputModality.js';
import { getAdminClient } from './adminClient.js';
import { checkAccess, signOut, GATE_STATE } from './gate.js';
import { PANELS } from './panels.js';
import { mountShell } from './shell.js';
import { mountSignInScreen } from './signInScreen.js';
import { mountChallengeScreen, mountEnrolScreen } from './mfaScreens.js';
import {
  mountCheckingScreen,
  mountNoAccessScreen,
  mountCheckFailedScreen,
} from './statusScreens.js';

export function mountAdminConsole(
  root,
  { client = getAdminClient(), panels = PANELS, signal } = {},
) {
  // Pointer users get no focus ring on the heading the console moves focus to after each screen; a keypress
  // brings the rings back (the same rule the organiser console follows).
  const stopTrackingInputModality = trackInputModality();
  let current = null;
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

  function show(access) {
    clear();
    const verified = () => route();
    switch (access.state) {
      case GATE_STATE.SIGNED_OUT:
        current = mountSignInScreen(root, {
          client,
          notice: access.notice,
          onSignedIn: () => route(),
          signal,
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
          ctx: { client, onGateRefused: () => route() },
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
    // A new screen is announced by moving focus to its heading (the shell's panel does its own).
    root.querySelector('[data-heading]')?.focus();
  }

  async function route() {
    const mine = ++generation;
    clear();
    current = mountCheckingScreen(root);
    const access = await checkAccess(client);
    if (mine !== generation || signal?.aborted) return;
    show(access);
  }

  route();

  return {
    unmount() {
      generation += 1;
      stopTrackingInputModality();
      clear();
    },
  };
}
