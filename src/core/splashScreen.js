// Splash / promo screen (not tied to a phase task, 2026-08-31) — a full-bleed,
// stage-mode screen meant to be pulled up on demand: before an event starts,
// between heats, or as a pure product-brand loop. Format-agnostic by design —
// its content (the "Seduh Score" wordmark, an event's own name/date/is_test)
// carries nothing Cup-Taster-specific, so it lives in core/, not
// formats/cup-taster/, matching viewer-shell.js's own reasoning for the same
// choice.
//
// Deliberately simpler than viewer-shell.js: no live_sessions subscription,
// no holding-state machine. This surface doesn't need instant reactivity —
// a reload is an acceptable way to pick up a newly-created or newly-started
// event — so it's a single findLatestEventForOrg read, not a realtime watch.
// The branded shell (wordmark, glow) always renders immediately, never
// blocked on that read; the event-specific line and badge progressively fill
// in once it resolves, and silently stay on the brand-only state on failure,
// timeout, or "no event yet" — all three are genuinely fine idle states for
// a screensaver-style surface, not errors needing a Retry affordance nobody
// watching this screen is meant to click anyway.
import { getSupabase } from './supabaseClient.js';
import { el } from './dom.js';
import { findLatestEventForOrg } from './events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const APP_NAME = 'Seduh Score';

export function mountSplashScreen(root, { orgId, client = getSupabase(), signal } = {}) {
  root.innerHTML = '';
  root.classList.add('splash-screen');
  root.setAttribute('data-surface', 'stage');

  // Picked once per mount, not re-rolled on the async event fill-in below —
  // a screen invoked fresh should anchor its glow somewhere different each
  // time, not visibly jump once the event data arrives. Kept off the exact
  // edges and off dead-center so it stays a background presence behind the
  // wordmark rather than competing with it (mirrors the approved design
  // canvas's own anchor range).
  const anchorX = 22 + Math.random() * 56;
  const anchorY = 26 + Math.random() * 42;

  const glow = el('div', { className: 'splash-glow' });
  const glowDrift = el('div', {
    className: 'splash-glow-drift',
    attrs: { style: `left:${anchorX}%; top:${anchorY}%` },
  });
  glowDrift.appendChild(glow);

  const eventLine = el('p', { className: 'splash-eventline' });
  const subLine = el('p', { className: 'splash-subline' });
  // role="status"/aria-live="polite" on the container, not the individual
  // lines — matches core/viewer-shell.js's own `body` region: only fires on
  // a later MUTATION (the async fill-in below), never on the wordmark's own
  // static initial content, which a screen reader already announces as
  // part of the normal page load. Found in review: without this, a screen
  // reader user who starts reading before the event name arrives would
  // never learn it showed up at all.
  const content = el(
    'div',
    {
      className: 'splash-content',
      attrs: { role: 'status', 'aria-live': 'polite' },
    },
    [el('h1', { className: 'splash-wordmark', text: APP_NAME }), eventLine, subLine],
  );

  // The badge's own persistent inner nodes — built once at mount and
  // MUTATED in place on the generic-to-live transition (className/hidden/
  // textContent), never torn down and replaced. Found in review
  // (ui-accessibility-reviewer): badgeHost's own aria-live="polite" only
  // reliably announces a MUTATION to an existing node, matching
  // viewer-shell.js's own documented reasoning for its `body` region — a
  // freshly re-inserted replacement element (what this used to do, via
  // badgeHost.replaceChildren(el(...))) is not reliably announced by every
  // AT, the exact failure mode that comment warns about.
  const badgeDot = el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } });
  badgeDot.hidden = true;
  const badgeText = el('span', { text: `Powered by ${APP_NAME}` });
  const badgeInner = el('div', { className: 'splash-badge splash-badge-generic' }, [
    badgeDot,
    badgeText,
  ]);
  const badgeHost = el('div', {
    className: 'splash-badge-host',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  badgeHost.appendChild(badgeInner);
  // Kept as a SEPARATE host from badgeHost, not one more state the same
  // container swaps between — .is-test-banner (src/ui/tokens/base.css) is a
  // full-width band by its own established design everywhere else it's
  // used, and per D9 that prominence is the point; shrinking it to fit
  // badgeHost's own small centered-pill sizing would make the one state
  // that most needs to be unmistakable LESS visually distinct than the two
  // states that don't.
  const testBannerHost = el('div', { className: 'splash-test-banner-host' });

  root.append(glowDrift, content, badgeHost, testBannerHost);

  loadEvent(orgId, client)
    .then((event) => {
      // A navigation away from this screen (router.js aborts `signal` the
      // instant a newer one starts) must stop this late-resolving read
      // from writing into a root some other, now-current screen may
      // already be using — same guard shape as every other screen's own
      // render() entry point. See ROADMAP.md's "A real DOM-write race
      // between the router..." entry.
      if (signal?.aborted) return;
      if (!event) return;
      fillEvent(
        eventLine,
        subLine,
        badgeHost,
        badgeInner,
        badgeDot,
        badgeText,
        testBannerHost,
        event,
      );
    })
    .catch((err) => {
      // Non-critical: this is exactly the same "log it, stay on the
      // holding/idle state" posture viewer-shell.js already takes for its
      // own secondary event-existence check — nothing here blocks the
      // branded shell that's already showing.
      console.error('splashScreen: failed to load the current event', err);
    });

  return {
    unmount() {
      // Found in review (code-reviewer): router.js documents an explicit
      // contract for any route using an `outlet` override (this one uses
      // the shared `bareRoot`, same as /live/projector and /live/phone) —
      // its own unmount() must actually clear the outlet, or a screen
      // reached by navigating AWAY from splash to a default-outlet route
      // leaves this DOM subtree (and its live-region nodes) orphaned under
      // the now-hidden bareRoot for the rest of the session, since nothing
      // at the default outlet ever touches bareRoot again. viewer-shell.js's
      // own unmount() does exactly this for the same reason; splash's own
      // "no timer, no subscription" comment answered the wrong question —
      // it ruled out leaked async resources, not leaked DOM.
      root.innerHTML = '';
    },
  };
}

async function loadEvent(orgId, client) {
  return raceTimeout(findLatestEventForOrg(orgId, client), DEFAULT_LOAD_TIMEOUT_MS);
}

function fillEvent(
  eventLine,
  subLine,
  badgeHost,
  badgeInner,
  badgeDot,
  badgeText,
  testBannerHost,
  event,
) {
  eventLine.textContent = event.name;
  // Raw, not reformatted — event_date is optional (eventsScreen.js's own
  // "Event date (optional)" field) and, when set, is a plain ISO date
  // string from a bare <input type="date">; eventsScreen.js's own event
  // list already just displays it as-is rather than reparsing it through
  // `new Date(...)`, which would risk a real off-by-one-day bug in any
  // timezone west of UTC. Matches that same precedent here.
  subLine.textContent = event.event_date ?? '';
  if (event.is_test) {
    // Hidden, not removed — the real is_test rendering (D9) moves to
    // testBannerHost's own full-width, role="alert" banner instead, which
    // is both more prominent and more assertive than this pill could be.
    // `is_test` never flips back on an already-created event, so this is a
    // one-time hide, not a repeated announcement a screen reader would need
    // to track — unlike the generic-to-live case below, which does.
    badgeHost.hidden = true;
    renderTestBanner(testBannerHost);
  } else {
    badgeHost.hidden = false;
    testBannerHost.replaceChildren();
    badgeInner.className = 'splash-badge splash-badge-live';
    badgeDot.hidden = false;
    badgeText.textContent = `Live — Powered by ${APP_NAME}`;
  }
}

// Reuses the real, shared D9 component (src/ui/tokens/base.css) verbatim —
// every other screen in this app renders is_test this exact way; a splash
// screen is no exception, and duplicating the stripe pattern here instead
// would be exactly the kind of drift that component exists to prevent.
// role="alert" (not badgeHost/content's own polite status) matches
// viewer-shell.js's own identical choice for this exact banner — D9's
// "unmistakable" bar means this needs to interrupt, not politely wait.
function renderTestBanner(host) {
  host.replaceChildren(
    el('div', {
      className: 'is-test-banner',
      text: 'Test Data — Not a Live Event',
      attrs: { role: 'alert' },
    }),
  );
}
