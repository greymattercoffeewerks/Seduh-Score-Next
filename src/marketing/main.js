// Composition root for the marketing landing page — parallel to src/main.js
// for the console, but far simpler: one static page, no router, no auth.
// The one network read is the proof card's newest published event (anon, one row);
// the page is complete without it. The build-time prerender (jsdom) never asks.
import { mountLandingScreen } from './landingScreen.js';
import { raceTimeout } from '../core/timeout.js';

const LATEST_TIMEOUT_MS = 6000;
// The prerender (tools/prerender-public-pages.mjs) installs a jsdom `window`; a bare `navigator` there is
// Node's own, so read it from `window`.
const prerendering = /jsdom/i.test(window.navigator?.userAgent ?? '');

mountLandingScreen(document.getElementById('app'), {
  loadLatest: prerendering
    ? undefined
    : () =>
        // Loaded on demand so the Supabase client stays off the page's critical path.
        raceTimeout(
          import('../core/publicResults.js').then((m) => m.findLatestPublishedResult()),
          LATEST_TIMEOUT_MS,
        ),
});
