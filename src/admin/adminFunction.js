// Calls an Edge Function as the signed-in operator and hands back the same shape `client.rpc` does:
// { data, error }, where `error` is { hint?, status?, timedOut?, offline? } and is never an Error with text from the
// server. The transport is core/edgeFunction.js; the function's own body carries a stable `hint` (spec section 4),
// which is all the console translates (adminErrors.js). The function's `error` TEXT is deliberately not read: the
// words shown come from this console, by hint, so only `status` and `hint` are taken from the answer and its body
// (`payload`) goes no further than this file.
import { invokeEdgeFunction } from '../core/edgeFunction.js';

// A call that CHANGES something and returns the only copy of what it made (a one-time password) gets longer than a
// page load does: a cold function start can be slow, and giving up on a request that is still running (raceTimeout
// does not cancel it) throws that answer away.
export const FUNCTION_TIMEOUT_MS = 30000;

export async function invokeAdminFunction(
  client,
  name,
  body,
  { timeoutMs = FUNCTION_TIMEOUT_MS } = {},
) {
  const { data, error } = await invokeEdgeFunction(client, name, body, { timeoutMs });
  if (!error) return { data, error: null };
  // An allow-list, not a strip-list: a field the transport grows later does not reach a screen by itself.
  const { status, hint, timedOut, offline } = error;
  const failure = { status, hint, timedOut, offline };
  for (const key of Object.keys(failure)) if (failure[key] === undefined) delete failure[key];
  return { data: null, error: failure };
}
