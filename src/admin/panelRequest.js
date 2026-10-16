// What the panels share for asking the console a question and showing the answer.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';

// One admin call, never rejecting: { data } or { error }. `error.timedOut` is true when it never answered (the
// request may or may not have been carried out); a call that threw is an error with no hint, which a panel that
// WRITES must read as "unknown", not "refused".
export async function ask(ctx, name, args) {
  try {
    const { data, error } = await raceTimeout(ctx.callAdmin(name, args), DEFAULT_LOAD_TIMEOUT_MS);
    return error ? { error } : { data };
  } catch (thrown) {
    return { error: { timedOut: Boolean(thrown?.timedOut) } };
  }
}

// An error is announced by moving focus to it, but only while focus is on the panel or nowhere: an answer that
// arrives seconds later must not take focus from wherever the person has since moved.
export function mayTakeFocus(host) {
  const active = document.activeElement;
  return !active || active === document.body || host.contains(active);
}
