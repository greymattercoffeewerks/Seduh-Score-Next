// The transport half of calling a Supabase Edge Function, shared by every screen that calls one (team.js is the
// first). It makes the call and reduces every way it can fail to one raw shape; what the
// words are is the caller's business.
//
// supabase-js reports a non-2xx answer as an error whose `context` is the fetch Response, so the function's own
// JSON body (`{ error, hint }`) has to be read from there. Resolves `{ data, error }` and never rejects:
//   - success:            { data, error: null }
//   - the function said no: error = { status, hint, payload }. `hint` is the body's stable `hint` when it has the
//     shape the functions send (lower-case letters and underscores) and undefined otherwise. `payload` is the
//     parsed JSON body (null when it was not JSON), for a caller that shows the function's own words. A
//     caller that must never show them (one that translates hints into its own words) does not read it, and does
//     not pass it on.
//   - no answer at all:   error = { offline: true }, or { timedOut, offline } when the call threw or ran out of time.
import { raceTimeout } from './timeout.js';

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
      payload,
    };
  }
  // No response at all: the request never got an answer (offline, blocked).
  return { offline: true };
}

// `timeoutMs` (optional; leave it out, or 0, to wait for ever): give up waiting after that long. A timeout does not cancel the request, so a call that
// changes something may still have gone through; the caller says so.
export async function invokeEdgeFunction(client, name, body, { timeoutMs } = {}) {
  let result;
  try {
    const pending = client.functions.invoke(name, { body });
    result = await (timeoutMs ? raceTimeout(pending, timeoutMs) : pending);
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
