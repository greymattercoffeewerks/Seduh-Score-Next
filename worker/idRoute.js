// Which paths are a Seduh ID person page (/id/<handle>/), decided in ONE place for the edge Worker (worker/index.js) and
// the Vite dev server (vite.config.js), so development serves exactly what production serves.
//
// Handles are not a fixed list (a person claims one after the build), so there can be no build-time shell per handle the
// way /id/country/<iso2>/ has. Instead the Worker answers any one-segment path under /id/ with the same shell, and the
// page works out the handle itself. The shell answers 200 for EVERY such path, a real handle or not: a status that
// differed would tell a stranger which handles exist. What an unknown handle shows is the page's job (it must look
// exactly like an empty profile).
//
// Pure on purpose: no fetch, no environment, so it is unit-tested directly.

/** Where the built shell lives (id/index.html in the build output). */
export const PROFILE_SHELL_PATH = '/id/';

// Words that are never a person's handle because a real page or file already owns the path. The database's reserved list
// (the handle migration) is the authority for what may be CLAIMED; this is only what the EDGE must not shadow. `country`
// is the one that matters: /id/country (no trailing slash) is not covered by the Worker's run_worker_first exclusion
// "/id/country/*", so the Worker meets it and has to hand it back to the static assets.
const NOT_A_HANDLE = new Set(['country', 'claim', 'me']);

// One path segment of letters, digits, hyphen and underscore, up to 64 long. Deliberately wider than a real handle (3 to
// 30, lower case): a too-short, too-long or upper-case name must reach the same shell and be answered as "no such Seduh
// ID", not a different kind of error. A dot is not allowed, so /id/favicon.ico and the like stay real 404s.
const PROFILE_PATH = /^\/id\/([A-Za-z0-9_-]{1,64})\/?$/;

/** Pure. True when the request path is one person's page: /id/<segment> or /id/<segment>/ and nothing deeper. */
export function isProfilePath(pathname) {
  const match = PROFILE_PATH.exec(pathname);
  return match !== null && !NOT_A_HANDLE.has(match[1].toLowerCase());
}

/** Pure. The shell's path for a request path that is a person page, else null (the Vite dev middleware uses this). */
export function profileShellFor(pathname) {
  return isProfilePath(pathname) ? `${PROFILE_SHELL_PATH}index.html` : null;
}

/** Where the built claim page lives (id/claim/index.html in the build output). */
export const CLAIM_SHELL_PATH = '/id/claim/';

// The claim page (T-ID2.B3b): /id/claim and /id/claim/ in any case. `claim` is a reserved handle in the database, so no
// person page can ever have this path; the person's claim token rides in the URL FRAGMENT, which no request carries, so the
// Worker never sees it.
const CLAIM_PATH = /^\/id\/claim\/?$/i;

/** Pure. True for the claim page's own path and nothing else. */
export function isClaimPath(pathname) {
  return CLAIM_PATH.test(pathname);
}

/** Pure. The claim shell's path for a request path that is the claim page, else null (the Vite dev middleware uses this). */
export function claimShellFor(pathname) {
  return isClaimPath(pathname) ? `${CLAIM_SHELL_PATH}index.html` : null;
}

/** Where the built My Seduh ID page lives (id/me/index.html in the build output). */
export const ME_SHELL_PATH = '/id/me/';

// My Seduh ID (T-ID2.D-b): /id/me and /id/me/ in any case. `me` is a reserved handle in the database, so no person page can ever
// have this path. Nothing secret is in the URL: the page reads the competitor's own session from this tab's storage.
const ME_PATH = /^\/id\/me\/?$/i;

/** Pure. True for My Seduh ID's own path and nothing else. */
export function isMePath(pathname) {
  return ME_PATH.test(pathname);
}

/** Pure. The My Seduh ID shell's path for a request path that is that page, else null (the Vite dev middleware uses this). */
export function meShellFor(pathname) {
  return isMePath(pathname) ? `${ME_SHELL_PATH}index.html` : null;
}

// Owner aliases (owner decision, 2026-11-16): /id/<alias> answers a 301 to /id/<handle>/. Today there is one: the owner's first
// name goes to their page. EACH ALIAS MUST ALSO BE A RESERVED HANDLE in the database (app.seduh_handle_reserved), or a stranger
// could claim it and the redirect would hide their page; tools/seduh-handle-aliases.test.js fails when one is missing.
export const HANDLE_ALIASES = { firdaus: 'mfosa' };

/** Pure. The path to redirect a person-page request to (always /id/<handle>/), or null when the path is not an alias. */
export function aliasRedirectFor(pathname) {
  const match = PROFILE_PATH.exec(pathname);
  if (match === null) return null;
  const target = Object.hasOwn(HANDLE_ALIASES, match[1].toLowerCase())
    ? HANDLE_ALIASES[match[1].toLowerCase()]
    : null;
  return target === null ? null : `/id/${target}/`;
}
