// Calls an Edge Function as the signed-in operator and hands back the same shape `client.rpc` does:
// { data, error }, where `error` is { hint?, status?, timedOut?, offline? } and is never an Error with text from the
// server. supabase-js reports a non-2xx answer as an error whose `context` is the Response; the function's own body
// carries a stable `hint` (spec section 4), which is all the console translates (adminErrors.js). The function's
// `error` TEXT is deliberately not read: the words shown come from this console, by hint.
import { raceTimeout } from '../core/timeout.js';

// A call that CHANGES something and returns the only copy of what it made (a one-time password) gets longer than a
// page load does: a cold function start can be slow, and giving up on a request that is still running (raceTimeout
// does not cancel it) throws that answer away.
export const FUNCTION_TIMEOUT_MS = 30000;

const HINT = /^[a-z_]{1,40}$/;

async function failureOf(error) {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // not JSON: only the status is known
    }
    return {
      status: typeof response.status === 'number' ? response.status : undefined,
      hint: typeof payload?.hint === 'string' && HINT.test(payload.hint) ? payload.hint : undefined,
    };
  }
  // No response at all: the request never got an answer (offline, blocked).
  return { offline: true };
}

export async function invokeAdminFunction(
  client,
  name,
  body,
  { timeoutMs = FUNCTION_TIMEOUT_MS } = {},
) {
  let result;
  try {
    result = await raceTimeout(client.functions.invoke(name, { body }), timeoutMs);
  } catch (thrown) {
    return {
      data: null,
      error: { timedOut: Boolean(thrown?.timedOut), offline: !thrown?.timedOut },
    };
  }
  const { data, error } = result ?? {};
  if (!error) return { data: data ?? null, error: null };
  return { data: null, error: await failureOf(error) };
}
