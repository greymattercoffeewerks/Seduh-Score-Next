// Password recovery for the organiser console, with no screen attached (D-PW1; the screens are
// forgotPasswordScreen.js and recoveryScreen.js). Format-agnostic: the client is injected, nothing here
// touches the DOM except takeRecoveryArrival's one look at the address bar, and every request races the
// shared timeout (core/timeout.js).
//
// Three jobs live here:
//
// 1. ASKING for a link (`requestPasswordReset`): the answer must never say whether an address has an account.
// 2. READING a link that arrives (`readRecoveryArrival`, `takeRecoveryArrival`): Supabase's implicit flow puts
//    the session in the URL HASH, and this app routes by the hash too, so the token has to be recognised and
//    taken out of the address bar before the router (or anything else) sees it.
// 3. The state of ONE arrival (`createRecoveryFlow`): verifying the link, the authenticator case, the new
//    password, "done". Held outside the screen because the screen is rebuilt whenever the router resolves
//    again (an auth event, a Retry), and a rebuilt screen must not forget that the password was just saved.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { signOutRequest } from './signOutRequest.js';
import {
  savePasswordAndEndOtherSessions,
  passwordChangeBlockedByAuthenticator,
} from './passwordChange.js';

// ---- asking for a link ----

// The words for every answer the server could give about an address. Identical whether or not the address
// has an account, and for every refusal that could differ with whether it does (see below).
export const RESET_REQUESTED_MESSAGE = 'If that address has an account, we sent a link.';

// The Supabase endpoint answers an address that has no account exactly like one that has, but several of its
// REFUSALS only ever happen for a real account: the once-a-minute limit per address
// (`over_email_send_rate_limit`) is checked against the account's own row, and a mail server that rejects
// the message (a 5xx `unexpected_failure`) is only reached for an address that exists. Showing either would
// let anyone test addresses against the form. So only an outcome that carries no information about the
// ADDRESS is reported as different: no answer at all (nobody learned anything), a gateway error that never
// reached the account lookup, and the limit that counts requests from this connection whatever they ask
// about (`over_request_rate_limit`). Everything else gets the same answer as success.
export function classifyResetError(error) {
  if (!error) return 'requested';
  // No verdict from the server: a dropped connection or a gateway (502 to 504), or an answer that was not
  // Auth's at all (a CDN error page), which never reached the account lookup.
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError') {
    return 'unreachable';
  }
  if (error.code === 'over_request_rate_limit') return 'busy';
  return 'requested';
}

// A reset answer is held back to a minimum time so that the screen does not answer an address that has no
// account visibly faster than one that has (the real mail takes the server a moment to send). This hides
// nothing from someone who calls the Supabase endpoint directly: it only means this form is not the
// quicker oracle.
export const MIN_RESET_ANSWER_MS = 1200;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves to `{ kind }`: 'requested' (show RESET_REQUESTED_MESSAGE), 'unreachable' (no answer from the
// server: a dropped connection or a timeout, which says nothing about the address) or 'busy' (too many
// requests from this connection). Never rejects.
export async function requestPasswordReset(
  client,
  email,
  {
    redirectTo,
    timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
    minAnswerMs = MIN_RESET_ANSWER_MS,
    wait = pause,
  } = {},
) {
  const started = Date.now();
  let kind;
  try {
    const { error } = await raceTimeout(
      client.auth.resetPasswordForEmail(email, { redirectTo }),
      timeoutMs,
    );
    kind = classifyResetError(error);
  } catch {
    // A throw is the transport (or raceTimeout's timeout): no verdict from the server at all.
    return { kind: 'unreachable' };
  }
  const remaining = minAnswerMs - (Date.now() - started);
  if (remaining > 0) await wait(remaining);
  return { kind };
}

// Where the email link should land: this console, wherever it is served from (`/app/`), with no hash and no
// query. Supabase refuses a redirect that is not on the project's allow-list, so for production
// `https://www.seduhscore.com/app/` must be on it (a dashboard setting; nothing in this repo sets it).
export function resetRedirectUrl(loc = window.location) {
  return new URL('.', `${loc.origin}${loc.pathname}`).href;
}

// ---- reading a link that arrives ----

// What the address bar's hash says about an arriving email link, or null when it is not one:
//   { kind: 'token', accessToken, refreshToken }  a recovery link that worked (Supabase has already spent
//                                                  the one-time code; the session is in the hash)
//   { kind: 'link_error' }                          an expired, used or refused link (`#error=access_denied
//                                                  &error_code=otp_expired…`)
// A console route (`#/events`) is never an arrival. Pure: it reads a string and touches nothing.
export function readRecoveryArrival(rawHash) {
  const text = String(rawHash ?? '').replace(/^#/, '');
  if (!text || text.startsWith('/')) return null;
  let params;
  try {
    params = new URLSearchParams(text);
  } catch {
    return null;
  }
  if (params.get('type') === 'recovery') {
    const accessToken = params.get('access_token');
    if (accessToken) {
      return { kind: 'token', accessToken, refreshToken: params.get('refresh_token') ?? '' };
    }
    return { kind: 'link_error' };
  }
  if (params.has('error') || params.has('error_code') || params.has('error_description')) {
    return { kind: 'link_error' };
  }
  return null;
}

// Reads the arrival and, if there is one, takes it out of the address bar AT ONCE (replaceState, so there
// is no history entry holding it either, and nothing later can leak it in a Referer or a copied link).
// Called before the router starts and before the Supabase client is built: the client would otherwise read
// the same hash itself, and the router would try to route it.
export function takeRecoveryArrival(win = window) {
  const arrival = readRecoveryArrival(win.location.hash);
  if (!arrival) return null;
  win.history.replaceState(win.history.state, '', win.location.pathname + win.location.search);
  return arrival;
}

// ---- one arrival ----

// phase:
//   'verifying'    the link's session is being established
//   'ready'        a session exists and the new-password form can be shown
//   'invalid'      the link has expired, was used already, or was refused
//   'mfa'          the login has an authenticator app, which a link alone cannot satisfy (the session is ended)
//   'unreachable'  could not reach the server; `establish()` again retries
//   'done'         the password was saved
//   'closed'       the person has left the flow (the console takes over again)
export function createRecoveryFlow({ client, arrival, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS }) {
  let phase = arrival.kind === 'token' ? 'verifying' : 'invalid';
  // Held in this closure only: never stored, logged or put back in the address bar.
  let tokens =
    arrival.kind === 'token'
      ? { access_token: arrival.accessToken, refresh_token: arrival.refreshToken }
      : null;
  let othersSignedOut = true;
  let establishing = null;

  async function run() {
    let result;
    try {
      result = await raceTimeout(client.auth.setSession(tokens), timeoutMs);
    } catch {
      if (phase !== 'closed') phase = 'unreachable';
      return;
    }
    // Left while the link was being checked (signed out in this or another tab): nothing may reopen it.
    if (phase === 'closed') return;
    // A server fault or no connection says nothing about the link: keep it, so Try again can use it. Only
    // a refusal (a spent, expired or malformed code: a 4xx, or no status at all) makes it invalid.
    if (result.error?.name === 'AuthRetryableFetchError' || result.error?.status >= 500) {
      phase = 'unreachable';
      return;
    }
    tokens = null;
    if (result.error || !result.data?.session) {
      phase = 'invalid';
      return;
    }
    const blocked = await passwordChangeBlockedByAuthenticator(client);
    if (phase === 'closed') return;
    if (blocked) {
      // The link proved control of the mailbox, not of the second factor: it gets nothing here. Ended
      // locally so the level-1 session is not left behind. If that sign-out fails the message is the same and the
      // session stays stored until it expires or they sign out; the server still refuses a password change and
      // every admin function from it (a level-1 session), so this is hygiene, not the lock.
      phase = 'mfa';
      await signOutRequest(client, { scope: 'local', timeoutMs });
      return;
    }
    phase = 'ready';
  }

  return {
    getState: () => ({ phase, othersSignedOut }),
    isOpen: () => phase !== 'closed',
    // Safe to call from every mount: one run at a time, and a settled answer is returned as it stands.
    establish() {
      if (phase === 'unreachable') phase = 'verifying';
      if (phase !== 'verifying') return Promise.resolve();
      if (!establishing) {
        establishing = run().finally(() => {
          establishing = null;
        });
      }
      return establishing;
    },
    async save(password) {
      const result = await savePasswordAndEndOtherSessions(client, password);
      if (!result.error) {
        phase = 'done';
        othersSignedOut = result.othersSignedOut;
      }
      return result;
    },
    close() {
      phase = 'closed';
      tokens = null;
    },
    // The login's session ended (Sign out here, or in another tab) while a form that needs it was on show:
    // the flow is over, because a form with no session behind it can only fail. Returns whether it closed.
    // Not while the link is still being checked: the link's session does not exist yet, so a sign-out
    // then is a stale one (a stored session the client found revoked at start-up, delivered late) and
    // must not cost the person their link. The authenticator and dead-link screens expect no session
    // (the mfa one ended it on purpose).
    sessionEnded() {
      if (!['ready', 'done'].includes(phase)) return false;
      phase = 'closed';
      tokens = null;
      return true;
    },
  };
}
