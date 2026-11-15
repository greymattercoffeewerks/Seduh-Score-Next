// The claim page's calls (T-ID2.B3b), behind one small object so the screen can be driven by a fake in tests. Each call
// reduces every way it can fail to a HINT (claimFlow.js turns it into words) and never throws:
//   sendCode(token, email)      the Edge Function `seduh-claim`: checks the token FIRST, then emails a 6-digit code
//   verifyCode(email, code)     supabase-js verifyOtp (type 'email'): signs the person in, in THIS browser's own session
//   handleAvailability(handle)  the anonymous door seduh_handle_available
//   claim(token, handle, adult) claim_seduh_id, as the signed-in person (the database uses auth.uid(), never an id we send)
//   leave()                     drops the competitor session from this browser
// The client is the competitor client (claimClient.js): its own storage key, so it can never replace an organiser's or the
// admin console's session. Nothing here logs or stores the token, the email or the code.
import { callDoor } from '../core/doorCall.js';
import { invokeEdgeFunction } from '../core/edgeFunction.js';
import { raceTimeout } from '../core/timeout.js';
import { getClaimClient } from './claimClient.js';

const CALL_TIMEOUT_MS = 20000;
const HINT = /^[a-z_]{1,40}$/;

function hintFromFailure(error) {
  if (error?.timedOut) return 'timeout';
  if (error?.offline) return 'offline';
  if (typeof error?.hint === 'string' && HINT.test(error.hint)) return error.hint;
  return 'server_error';
}

// A supabase-js / PostgREST error to a hint: the database's own hint when it is a refusal, 42501 as "signed out".
function hintFromRpcError(error) {
  if (typeof error?.hint === 'string' && HINT.test(error.hint)) return error.hint;
  if (error?.code === '42501') return 'signed_out';
  if (error?.status === 0 || error?.message === 'timeout') return 'offline';
  return 'server_error';
}

const text = (value, max) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;

export function createClaimApi({ client } = {}) {
  const getClient = () => client ?? getClaimClient();

  return {
    async sendCode(token, email) {
      const { data, error } = await invokeEdgeFunction(
        getClient(),
        'seduh-claim',
        { token, email },
        { timeoutMs: CALL_TIMEOUT_MS },
      );
      if (error) return { ok: false, hint: hintFromFailure(error) };
      return { ok: true, displayName: text(data?.display_name, 120) };
    },

    async verifyCode(email, code) {
      try {
        const { error } = await raceTimeout(
          getClient().auth.verifyOtp({ email, token: code, type: 'email' }),
          CALL_TIMEOUT_MS,
        );
        if (!error) return { ok: true };
        if (error.status === 429) return { ok: false, hint: 'too_many_attempts' };
        if (error.status === 0 || error.status === undefined) {
          return { ok: false, hint: 'offline' };
        }
        return { ok: false, hint: 'otp_invalid' };
      } catch (thrown) {
        return { ok: false, hint: thrown?.timedOut ? 'timeout' : 'offline' };
      }
    },

    // 'available' | 'taken' | 'reserved' | 'invalid' | 'failed' (a failed check never blocks a claim: the database decides)
    async handleAvailability(handle) {
      const answer = await callDoor(
        getClient(),
        'seduh_handle_available',
        { p_handle: handle },
        { timeoutMs: CALL_TIMEOUT_MS },
      );
      if (answer.status !== 'ok') return 'failed';
      return ['available', 'taken', 'reserved', 'invalid'].includes(answer.data)
        ? answer.data
        : 'failed';
    },

    async claim(token, handle, adult) {
      try {
        const { data, error } = await raceTimeout(
          getClient().rpc('claim_seduh_id', { p_token: token, p_handle: handle, p_adult: adult }),
          CALL_TIMEOUT_MS,
        );
        if (error) return { ok: false, hint: hintFromRpcError(error) };
        const claimedHandle = text(data?.handle, 30);
        const number = Number.isInteger(data?.founding_number) ? data.founding_number : null;
        if (!claimedHandle || number === null) return { ok: false, hint: 'server_error' };
        return { ok: true, handle: claimedHandle, foundingNumber: number };
      } catch (thrown) {
        // A timeout does not cancel the request: the claim may have gone through. The page says so.
        return { ok: false, hint: thrown?.timedOut ? 'timeout' : 'offline' };
      }
    },

    async leave() {
      try {
        await getClient().auth.signOut({ scope: 'local' });
      } catch {
        // nothing to do: the session lives in this tab's storage only
      }
    },
  };
}
