import { mountAuthScreen } from './authScreen.js';
import { mountSetupScreen } from './setupScreen.js';
import { el } from '../../core/dom.js';
import { buildCommunityToolChrome } from '../toolChrome.js';

// The organiser page (sign-in, then setup) sits inside the shared community frame: header, breadcrumb, the
// "More free community tools" strip and the footer. Each screen tears its root down on every render, so they
// mount into `host`, never into #app itself. The participant page (/guess-the-bean/play/) and the live display
// (/guess-the-bean/display/) are separate entries with no frame at all: the display is the projector view and the
// play page is what a guest sees at the booth.
const app = document.getElementById('app');
const chrome = buildCommunityToolChrome({
  toolId: 'guess-the-bean',
  toolName: 'Guess the Bean',
  edition: 'Booth game',
});
const host = el('div', { className: 'gtb-host' });
app.replaceChildren(chrome.top, host, chrome.bottom);

// Same handle-then-unmount discipline as authScreen.js's own onSignedIn
// required (code-reviewer, Phase 2) — this page has no router to tear
// anything down automatically, so each screen transition must unmount the
// previous one itself before replacing #app's contents.
//
// `signingIn` guards against Supabase firing SIGNED_IN more than once (it
// can, e.g. around a token refresh) — without it, a duplicate event would
// call mountSetupScreen a second time with no teardown of the first,
// leaving two live subscriptions/timers/renders fighting over #app.
// `.catch()` on the mountSetupScreen promise matters too: unlike the
// original fire-and-forget call, an initial-load failure inside it (its own
// client.auth.getUser()/loadSessions()) must not disappear as an unhandled
// rejection with the user stranded on the just-unmounted auth screen with
// no error and no recovery path short of a reload. Found in review
// (code-reviewer).
// Wrapped in an async IIFE rather than a top-level `await` — this project's
// vite build target (chrome87/edge88/es2020/firefox78/safari14, set for
// broad compatibility) doesn't support top-level await at the module scope
// esbuild sees during production bundling, even though it runs fine
// unbundled in dev. Sibling entries (playMain.js/displayMain.js) never
// needed this because they don't hold onto their mount's return value across
// an async boundary the way `authHandle` is here.
let signingIn = false;
(async () => {
  const authHandle = await mountAuthScreen(host, {
    onSignedIn: () => {
      if (signingIn) return;
      signingIn = true;
      authHandle.unmount();
      mountSetupScreen(host).catch((err) => {
        host.innerHTML =
          '<section class="gtb-screen"><p class="form-field-error">Something went wrong loading your sessions — try reloading the page.</p></section>';
        console.error(err);
      });
    },
  });
})();
