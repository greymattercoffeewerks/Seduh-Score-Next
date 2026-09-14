import { mountAuthScreen } from './authScreen.js';
import { mountSetupScreen } from './setupScreen.js';

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
let signingIn = false;
const authHandle = await mountAuthScreen(document.getElementById('app'), {
  onSignedIn: () => {
    if (signingIn) return;
    signingIn = true;
    authHandle.unmount();
    mountSetupScreen(document.getElementById('app')).catch((err) => {
      document.getElementById('app').innerHTML =
        '<section class="gtb-screen"><p class="gtb-field-error">Something went wrong loading your sessions — try reloading the page.</p></section>';
      console.error(err);
    });
  },
});
