// Edge Worker in front of the static assets. It exists for ONE reason: /id/<handle>/ person pages, whose handles are not
// a fixed list (see worker/idRoute.js). wrangler.jsonc sends only /id/* (minus /id/country and /id/country/*) here with
// `run_worker_first`; every other request on the site is served by the static assets without running this code.
//
// The claim page (/id/claim/) is served from its own built page. A person page request gets the shell (the built id/index.html) with status 200. Anything else that reaches the Worker
// (for example /id/favicon.ico, or /id/country with no slash) is handed to the assets unchanged, so it behaves exactly as
// it did before this Worker existed (a redirect or Cloudflare's own 404).
import { CLAIM_SHELL_PATH, isClaimPath, isProfilePath, PROFILE_SHELL_PATH } from './idRoute.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const readOnly = request.method === 'GET' || request.method === 'HEAD';
    if (readOnly && isClaimPath(url.pathname)) {
      // The claim page (T-ID2.B3b): the built id/claim/ page, never indexed, never cached, and no referrer leaves it.
      const claim = await env.ASSETS.fetch(new Request(new URL(CLAIM_SHELL_PATH, url), request));
      if (!claim.ok) return claim;
      const headers = new Headers(claim.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('Cache-Control', 'no-store');
      return new Response(claim.body, { status: 200, headers });
    }
    if (!readOnly || !isProfilePath(url.pathname)) return env.ASSETS.fetch(request);

    const shell = await env.ASSETS.fetch(new Request(new URL(PROFILE_SHELL_PATH, url), request));
    if (!shell.ok) return shell;
    // Not indexable, whatever the shell's own meta tag says: a person page is not public to search until the owner decides.
    const headers = new Headers(shell.headers);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(shell.body, { status: 200, headers });
  },
};
