// Calls an Edge Function as the signed-in operator and hands back the same shape `client.rpc` does:
// { data, error }, where `error` is { hint?, status?, userId?, timedOut? } and is never an Error with text from
// the server. supabase-js reports a non-2xx answer as an error whose `context` is the Response; the function's
// own body carries a stable `hint` (spec section 4), which is all the console translates (adminErrors.js). The
// function's `error` TEXT is deliberately not read: the words shown come from this console, by hint.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

// `userId` is read only when it looks like one: it names a stranded login and is shown to nobody, but a value the
// server sent is never trusted to be what it says.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      userId:
        typeof payload?.userId === 'string' && UUID.test(payload.userId)
          ? payload.userId
          : undefined,
    };
  }
  // No response at all: the request never got an answer (offline, blocked).
  return { offline: true };
}

export async function invokeAdminFunction(
  client,
  name,
  body,
  { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
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
