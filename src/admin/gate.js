// The console's access gate (spec section 5): who is this, may they be here, and is their second factor
// current. One async question, `checkAccess(client)`, answered with one of six states; the screens draw the
// state and never decide it. The DATABASE decides who is an admin and whether the second factor is fresh
// (app.require_platform_admin); this module only asks and translates.
//
//   signedOut -> (sign in) -> checking -> { notAdmin | needMfaEnrol | needMfaChallenge | ready | error }
//
// Two traps this avoids on purpose:
//  - `am_i_platform_admin()` answers "is this login an admin, and at which assurance level" from the signed
//    token alone. It does NOT check that the session behind the token is still alive or that the second
//    factor is recent, so a `{ is_admin: true, aal: 'aal2' }` is never treated as "ready". `ready` needs
//    `admin_can_provision()` to succeed, which runs the full gate (aal2, a TOTP verification in the last 60
//    minutes, a live aal2 session row).
//  - A refusal later, from any admin call, is the same signal as a refusal here. `isGateRefusal` names those
//    hints so a screen can send the console back through this check instead of showing an error.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

export const GATE_STATE = Object.freeze({
  SIGNED_OUT: 'signedOut',
  NOT_ADMIN: 'notAdmin',
  NEED_ENROL: 'needMfaEnrol',
  NEED_CHALLENGE: 'needMfaChallenge',
  READY: 'ready',
  ERROR: 'error',
});

export const SESSION_ENDED_NOTICE = 'Your session ended. Sign in again.';
export const SLOW_MESSAGE = 'This is taking longer than expected. Check your connection and retry.';
export const CHECK_FAILED_MESSAGE = 'Could not check your access. Check your connection and retry.';

const GATE_HINTS = Object.freeze(['admin_required', 'admin_mfa_required', 'admin_session_ended']);

// True for the three refusals that mean "the gate is closed", whichever call raised them.
export function isGateRefusal(error) {
  return GATE_HINTS.includes(error?.hint);
}

function limited(promise, ms) {
  return raceTimeout(Promise.resolve(promise), ms);
}

// A rejected token (expired beyond refresh, person deleted) reaches us as an HTTP 401 from PostgREST.
function isAuthFailure(result) {
  const error = result?.error;
  return result?.status === 401 || error?.code === 'PGRST301' || error?.code === 'PGRST303';
}

async function verifiedFactorId(client, ms) {
  const { data, error } = await limited(client.auth.mfa.listFactors(), ms);
  if (error) throw error;
  return data?.totp?.[0]?.id ?? null;
}

async function mfaState(client, ms, email) {
  const factorId = await verifiedFactorId(client, ms);
  return factorId
    ? { state: GATE_STATE.NEED_CHALLENGE, email, factorId }
    : { state: GATE_STATE.NEED_ENROL, email };
}

export async function checkAccess(client, { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  let email = '';
  try {
    const { data } = await limited(client.auth.getSession(), timeoutMs);
    const session = data?.session;
    if (!session) return { state: GATE_STATE.SIGNED_OUT };
    email = session.user?.email ?? '';

    const who = await limited(client.rpc('am_i_platform_admin'), timeoutMs);
    if (isAuthFailure(who)) return { state: GATE_STATE.SIGNED_OUT, notice: SESSION_ENDED_NOTICE };
    if (who.error) return { state: GATE_STATE.ERROR, email, message: CHECK_FAILED_MESSAGE };
    if (who.data?.is_admin !== true) return { state: GATE_STATE.NOT_ADMIN, email };

    // Password only: the second factor is the next step, enrolling it or answering it.
    if (who.data.aal !== 'aal2') return await mfaState(client, timeoutMs, email);

    const gate = await limited(client.rpc('admin_can_provision'), timeoutMs);
    if (isAuthFailure(gate)) return { state: GATE_STATE.SIGNED_OUT, notice: SESSION_ENDED_NOTICE };
    if (!gate.error && gate.data === true) return { state: GATE_STATE.READY, email };
    switch (gate.error?.hint) {
      case 'admin_mfa_required':
        return await mfaState(client, timeoutMs, email);
      case 'admin_session_ended':
        return { state: GATE_STATE.SIGNED_OUT, notice: SESSION_ENDED_NOTICE };
      case 'admin_required':
        return { state: GATE_STATE.NOT_ADMIN, email };
      default:
        return { state: GATE_STATE.ERROR, email, message: CHECK_FAILED_MESSAGE };
    }
  } catch (error) {
    return {
      state: GATE_STATE.ERROR,
      email,
      message: error?.timedOut ? SLOW_MESSAGE : CHECK_FAILED_MESSAGE,
    };
  }
}

// Plain sign-out ends this tab's session only ('local'); "Sign out everywhere" ends every session of this
// login ('global'). The caller reports a failure; it is never silent.
export async function signOut(
  client,
  scope = 'local',
  { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
) {
  try {
    const { error } = await limited(client.auth.signOut({ scope }), timeoutMs);
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
