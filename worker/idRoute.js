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
const NOT_A_HANDLE = new Set(['country']);

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
