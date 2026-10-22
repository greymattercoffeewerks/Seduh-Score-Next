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
import { el, brandMark } from './dom.js';
import { findLatestEventForOrg } from './events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { applyBrandColors, normaliseBrand, renderBrandIdentity } from './brandSlot.js';
import { poweredByText, renderPoweredBy } from './poweredBy.js';

const APP_NAME = 'Seduh Score';

// `brand` (optional, core/brandSlot.js): the organiser's logo, display name and accent colour. Branded, the splash
// shows their identity in place of the Seduh Score mark and wordmark, uses their accent for the glow and the live
// badge, and carries "Powered by Seduh Score" in its own element at the top (outside the badge, which is hidden on a
// test event, so the credit is never lost). `setBrand(brand)` changes or clears it later; it is never awaited.
// `onEvent(event)` (optional) is called once the event line is filled, with the event the screen shows.
export function mountSplashScreen(
  root,
  { orgId, client = getSupabase(), signal, brand: initialBrand = null, onEvent } = {},
) {
  root.innerHTML = '';
  // This route shares its outlet (bareRoot, main.js) with #/live/projector
  // and #/live/phone — neither this screen's own unmount() nor
  // viewer-shell.js's own unmount() ever clears a root's OWN classList/
  // attributes, only its own child nodes, so a stale
  // sibling route's surface class/attribute could otherwise persist across
  // a direct cross-navigation. main.js's buildRoutes() resets the shared
  // root before calling this mount function, not this screen itself — a
  // core module has no business knowing a format's class names (found in
  // review: this used to hardcode `classList.remove('projector-surface')`,
  // a module-boundary violation).
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
  // Kept as persistent nodes and shown or hidden, never rebuilt: a brand that arrives late (setBrand) must not
  // re-announce the whole live region or drop a screen reader's place.
  const markEl = el('span', { className: 'splash-mark', attrs: { 'aria-hidden': 'true' } }, [
    brandMark(),
  ]);
  const wordmarkEl = el('h1', { className: 'splash-wordmark', text: APP_NAME });
  // Built only when a brand first arrives, so an unbranded splash has exactly the markup it always had.
  let brandEl = null;
  const content = el(
    'div',
    {
      className: 'splash-content',
      attrs: { role: 'status', 'aria-live': 'polite' },
    },
    [
      // Found missing entirely in a live production check — this whole
      // screen (the app's own biggest, most brand-forward surface) was
      // text-only, no mark. Ported from the legacy Seduh-Score repo (see
      // brandMark()'s own comment in dom.js).
      markEl,
      wordmarkEl,
      eventLine,
      subLine,
    ],
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
  const badgeText = el('span', { text: poweredByText() });
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

  // The one list both append and unmount() use, so a node added here can't
  // be forgotten there and leak into the shared root.
  const ownNodes = [glowDrift, content, badgeHost, testBannerHost];
  root.append(...ownNodes);

  // ---- branding (see the comment above mountSplashScreen) ----
  // The credit's own host, present only while branded. Not inside badgeHost (hidden on a test event) and not inside
  // the live region (static text must not be announced again).
  const creditHost = el('div', { className: 'splash-credit-host' });
  let brand = normaliseBrand(initialBrand);
  let latestEvent = null;

  // The pill. Unbranded it says what it always has ("Powered by Seduh Score", or "Live — Powered by Seduh Score").
  // Branded, the credit has its own element, so the pill drops the words (and the idle pill is hidden entirely)
  // rather than say the same thing twice. A test event hides it either way: D9's banner is what speaks there.
  function paintBadge() {
    if (latestEvent?.is_test) {
      badgeHost.hidden = true;
    } else if (latestEvent) {
      badgeHost.hidden = false;
      badgeInner.className = 'splash-badge splash-badge-live';
      badgeDot.hidden = false;
      // The words come through poweredByText(), so the pill obeys the same single decision as the credit element.
      const credit = brand ? '' : poweredByText();
      badgeText.textContent = credit ? `Live — ${credit}` : 'Live';
    } else {
      badgeInner.className = 'splash-badge splash-badge-generic';
      badgeDot.hidden = true;
      badgeText.textContent = poweredByText();
      badgeHost.hidden = Boolean(brand) || !badgeText.textContent;
    }
  }

  // After unmount this screen touches nothing: a brand that arrives late must not re-attach a credit or colours to
  // the shared root, which another screen may own by then.
  let unmounted = false;
  // The accent is set on the nodes this screen owns (the glow, the content, the pill), never on the shared root,
  // which outlives the screen and would leak the colours into the next audience screen mounted there.
  const accentNodes = [glowDrift, content, badgeHost];

  function paintBrand() {
    if (unmounted) return;
    for (const node of accentNodes) applyBrandColors(node, brand, 'stage');
    markEl.hidden = Boolean(brand);
    wordmarkEl.hidden = Boolean(brand);
    // Present only while branded: built when a brand arrives, removed when it is cleared, so the unbranded splash is
    // always exactly the markup it always had.
    if (brand && !brandEl) {
      // Inside the content's polite live region, but never announced: a brand that arrives late (or changes) is the
      // screen's identity, not a status update.
      brandEl = el('div', { className: 'splash-brand', attrs: { 'aria-live': 'off' } });
      wordmarkEl.after(brandEl);
    } else if (!brand && brandEl) {
      brandEl.remove();
      brandEl = null;
    }
    // The name is the page's heading. With no name (a logo alone) the logo is wrapped in the heading instead, so a
    // branded splash always has exactly one, and its accessible name is the logo's description.
    const hasName = Boolean(brand?.displayName);
    const identity = brand
      ? renderBrandIdentity(brand, {
          nameTag: hasName ? 'h1' : 'span',
          className: 'splash-brand-identity',
        })
      : null;
    brandEl?.replaceChildren(
      ...(identity
        ? [hasName ? identity : el('h1', { className: 'splash-brand-heading' }, [identity])]
        : []),
    );
    const credit = brand ? renderPoweredBy('powered-by-splash') : null;
    if (credit) {
      creditHost.replaceChildren(credit);
      if (!creditHost.isConnected) root.append(creditHost);
    } else {
      creditHost.remove();
    }
    paintBadge();
  }
  if (brand) paintBrand();

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
      latestEvent = event;
      fillEvent(eventLine, subLine, testBannerHost, event);
      paintBadge();
      // Told which event this is, so a caller can ask for that event's brand. Never allowed to break the screen.
      try {
        onEvent?.(event);
      } catch (err) {
        console.error('splashScreen: onEvent failed', err);
      }
    })
    .catch((err) => {
      // Non-critical: this is exactly the same "log it, stay on the
      // holding/idle state" posture viewer-shell.js already takes for its
      // own secondary event-existence check — nothing here blocks the
      // branded shell that's already showing.
      console.error('splashScreen: failed to load the current event', err);
    });

  return {
    // Changes or clears the brand; see the comment above mountSplashScreen.
    setBrand(next) {
      brand = normaliseBrand(next);
      paintBrand();
    },
    unmount() {
      // Found in review (code-reviewer): router.js documents an explicit
      // contract for any route using an `outlet` override (this one uses
      // the shared `bareRoot`, same as /live/projector and /live/phone) —
      // its own unmount() must actually clear the outlet, or a screen
      // reached by navigating AWAY from splash to a default-outlet route
      // leaves this DOM subtree (and its live-region nodes) orphaned under
      // the now-hidden bareRoot for the rest of the session, since nothing
      // at the default outlet ever touches bareRoot again. viewer-shell.js's
      // own unmount() removes its own DOM for the same reason; splash's own
      // "no timer, no subscription" comment answered the wrong question —
      // it ruled out leaked async resources, not leaked DOM.
      //
      // Removes only the nodes this screen appended, not the whole root: the
      // router mounts the NEW screen before unmounting this one, and the
      // audience routes share one root, so `root.innerHTML = ''` here wiped
      // whichever screen had just been mounted into it.
      unmounted = true;
      for (const node of ownNodes) node.remove();
      creditHost.remove();
    },
  };
}

async function loadEvent(orgId, client) {
  return raceTimeout(findLatestEventForOrg(orgId, client), DEFAULT_LOAD_TIMEOUT_MS);
}

// The event's own lines and, for a test event, the real D9 banner. The pill is painted separately (paintBadge in
// mountSplashScreen), because what it says depends on whether the screen is branded.
function fillEvent(eventLine, subLine, testBannerHost, event) {
  eventLine.textContent = event.name;
  // Raw, not reformatted — event_date is optional (eventsScreen.js's own
  // "Event date (optional)" field) and, when set, is a plain ISO date
  // string from a bare <input type="date">; eventsScreen.js's own event
  // list already just displays it as-is rather than reparsing it through
  // `new Date(...)`, which would risk a real off-by-one-day bug in any
  // timezone west of UTC. Matches that same precedent here.
  subLine.textContent = event.event_date ?? '';
  if (event.is_test) {
    // The pill is hidden, not removed (paintBadge) — the real is_test rendering (D9) moves to testBannerHost's own
    // full-width, role="alert" banner instead, which is both more prominent and more assertive than the pill could
    // be. `is_test` never flips back on an already-created event, so this is a one-time hide, not a repeated
    // announcement a screen reader would need to track — unlike the generic-to-live case, which does.
    renderTestBanner(testBannerHost);
  } else {
    testBannerHost.replaceChildren();
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
