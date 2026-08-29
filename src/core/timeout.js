// Races a promise against a timeout so a caller never hangs indefinitely —
// this project's "unreliable venue wifi" design target means a request
// that neither resolves nor rejects is a real, expected failure mode, not
// an edge case. Extracted from core/viewer-shell.js's own private
// implementation on its 2nd verbatim use (setupScreen.js/rosterScreen.js
// both needed the identical pattern to close their own initial-load
// timeout/retry gap — see CHANGELOG.md's dated entry).
//
// The rejected timeout carries `.timedOut = true` so a caller can show a
// distinct "this is taking a while" message instead of describeError()'s
// generic failure text — a timeout never reaches the server, so there's no
// real error shape describeError() could read anything useful from.
export function raceTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error('timed out');
      err.timedOut = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Matches viewer-shell.js's own REFRESH_TIMEOUT_MS — the shared default for
// a screen's initial data load. Not enforced; callers may pass their own ms
// value to raceTimeout directly.
export const DEFAULT_LOAD_TIMEOUT_MS = 10000;
