// Hash-based router (2026-08-29, closing a real, previously-unscoped gap —
// every organiser screen and both audience surfaces already existed, fully
// built and reviewed, but nothing connected them; src/main.js was still the
// literal Phase 0 placeholder). Hand-rolled, not a library — matches this
// project's explicit no-framework stance. Hash routing specifically (never
// real paths): `wrangler.jsonc`'s Cloudflare Workers Static Assets config
// has no SPA-fallback (`not_found_handling`) set, so a real path would 404
// on any direct navigation/reload; a hash fragment never round-trips to the
// server at all, so this needs zero deployment config changes.
//
// Deliberately format-agnostic, matching core/outbox.js's own "queue
// mechanics only, zero knowledge of what's queued" discipline applied here
// to navigation: this file has no opinion about screens, chrome, or nav UI.
// `route.outlet` and `onNavigate` are its only two extension points — a
// future format wires its own routes/shell through the exact same
// `createRouter()` unedited.
import { getSupabase } from './supabaseClient.js';

// Pure — directly unit-testable without touching `location`/`window` at
// all. `path`/`pattern` are both plain strings with no leading '#' and no
// query string (the caller strips those); segments are matched
// positionally, `:name` segments capture. No wildcard/optional-segment
// support — this app's own route table never needs one, and adding support
// for a shape nothing uses yet would be exactly the kind of speculative
// generality this project avoids.
export function matchRoute(routes, path) {
  const pathSegments = path.split('/').filter(Boolean);
  for (const route of routes) {
    const patternSegments = route.pattern.split('/').filter(Boolean);
    if (patternSegments.length !== pathSegments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const patternSegment = patternSegments[i];
      const pathSegment = pathSegments[i];
      if (patternSegment.startsWith(':')) {
        params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      } else if (patternSegment !== pathSegment) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

// Stateful lifecycle wrapper around matchRoute. `client` is resolved ONCE
// here (defaulting to getSupabase()) and threaded into every mount call as
// `{...params, client}` — the single chokepoint that guarantees every
// screen the router ever mounts gets the same, right client, rather than
// relying on each of the ~10 screens' own internal `client = getSupabase()`
// default to never accidentally fire in a test environment. Matches this
// codebase's existing single-chokepoint discipline (buildRpcHandler,
// app.is_org_member).
export function createRouter({ routes, client = getSupabase(), notFoundMount, onNavigate } = {}) {
  let current = null;
  let defaultOutlet = null;
  // Staleness guard for overlapping resolve() calls — same shape
  // core/viewer-shell.js's own `requestSeq`/`seq !== requestSeq` already
  // uses ("a slower call must never clobber a faster one"). Two resolves
  // CAN genuinely overlap: setting `location.hash` before `start()` has
  // attached its listener can leave a hashchange event queued by the
  // browser/jsdom that fires just after attachment, racing the explicit
  // initial resolve `start()` itself performs — found exactly this way
  // while testing. Without this guard, the stale (slower) resolve's own
  // `current?.unmount?.()` step could run AFTER a newer resolve has already
  // mounted the real current screen, incorrectly unmounting IT instead of
  // whatever the stale resolve was actually superseding.
  let resolveSeq = 0;

  function currentPath() {
    return location.hash.replace(/^#/, '');
  }

  async function resolve(path) {
    const mySeq = (resolveSeq += 1);
    const matched = matchRoute(routes, path);
    const route = matched?.route ?? { mount: notFoundMount, outlet: undefined };
    const params = matched?.params ?? {};

    onNavigate?.(route, params);

    // A route with its own `outlet` override MUST implement real DOM
    // cleanup in its own `unmount()` — most of this app's screens instead
    // document their `unmount()` as a no-op, relying on the NEXT screen
    // sharing the same outlet and wholesale-clearing it
    // (`root.innerHTML = ''`) on its own mount. That convention silently
    // breaks across an outlet override, since the next screen at the
    // DEFAULT outlet never touches the overridden one. `viewer-shell.js`
    // (the only outlet-override consumer today, `/live/projector` and
    // `/live/phone`) is safe because its own `unmount()` genuinely clears
    // its root — found worth codifying explicitly in review, since
    // nothing here enforces the pairing for a future outlet-override route
    // built on a no-op-unmount screen.
    const outlet = route.outlet ?? defaultOutlet;
    const mounted = (await route.mount(outlet, { ...params, client })) ?? null;

    if (mySeq !== resolveSeq) {
      // A newer resolve() started while this one's mount() was in flight —
      // this result lost the race; tear IT down instead of touching
      // `current`, which the newer resolve now owns.
      await mounted?.unmount?.();
      return;
    }

    // Tear down whatever was previously current only once we know this
    // resolve is still the latest one — optional-chained so a screen that
    // (still) returns no handle doesn't throw; every screen this app ships
    // is expected to return { unmount() {...} } (see heatsScreen.js's own
    // 2026-08-29 fix closing the one screen that didn't).
    await current?.unmount?.();
    current = mounted;

    // Focus management for the navigation itself — found missing in
    // review (2026-08-29): removing the outgoing screen's DOM subtree
    // resets focus to <body>, and nothing moved it into the new screen,
    // so a screen-reader user got no signal navigation even happened.
    // Guarded on `document.activeElement` still being <body> (or unset)
    // so this never overrides a screen's OWN more specific choice — every
    // screen's loading/error states already call `.focus()` on their own
    // feedback region during `route.mount()`'s own await, which runs
    // entirely BEFORE this line; only a screen that focused nothing at
    // all (the common case for a successful initial render) falls
    // through to this default.
    if (outlet && (document.activeElement === document.body || !document.activeElement)) {
      const heading = outlet.querySelector('h1, h2');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
  }

  // No history entry is ever written for the empty-hash -> fallbackPath
  // case — `resolve()` is called directly with `fallbackPath`, `location.hash`
  // itself is left untouched. `location.hash` only ever changes from a
  // screen's own `<a href="#/...">` link (normal browser behavior) or an
  // explicit `navigate()` call.
  let hashChangeListener = null;

  async function start(outletEl, { fallbackPath = '/' } = {}) {
    defaultOutlet = outletEl;
    hashChangeListener = () => resolve(currentPath());
    window.addEventListener('hashchange', hashChangeListener);
    await resolve(currentPath() || fallbackPath);
  }

  function navigate(path) {
    location.hash = path;
  }

  // Removes the hashchange listener and tears down whatever's currently
  // mounted — the app itself never calls this in production (one router,
  // one page load, for the app's whole lifetime), but a test creating a
  // fresh router per case needs it, or an earlier test's listener stays
  // registered on the shared jsdom `window` and fires with a stale closure
  // over a LATER test's location.hash changes (found exactly this way: a
  // subsequent test's `location.hash = ''` in its own afterEach triggered a
  // previous test's still-registered listener, calling `route.mount` on a
  // route table that test's own router no longer owned).
  async function stop() {
    if (hashChangeListener) {
      window.removeEventListener('hashchange', hashChangeListener);
      hashChangeListener = null;
    }
    await current?.unmount?.();
    current = null;
  }

  return { start, stop, navigate, resolve, matchRoute: (path) => matchRoute(routes, path) };
}
