// Organiser app shell (2026-08-29 app-wiring pass) — a persistent header
// (app name, an event-name breadcrumb, nav links) plus a content outlet the
// router mounts screens into. Lives in `core/` (parallel to
// `viewer-shell.js`'s own precedent as the first CSS file placed inside
// `core/` rather than a format directory — this is the second), and
// deliberately does NOT reuse `viewer-shell.js`'s `renderChrome()` — that's
// the audience-surface identity band (app name + live/not-live status
// badge, no navigation, no event context at all), a different purpose
// entirely. This file follows its structural/naming precedent (one
// `APP_NAME`-shaped constant, a simple flex-row header) without importing
// or extending it.
//
// No format-specific vocabulary lives here — `setNav({links})`'s `links`
// are plain `{label, href}` data; the persistent shell nav's own strings
// ("Events", "Overview") are decided by main.js's `updateChrome()`, not
// hardcoded in this file (per-event actions like "Setup"/"Roster"/"Report"
// live inside eventDashboardScreen.js's own routed content, not this
// shell's nav — this shell only ever renders the small, persistent set).
// Same inversion-of-control shape viewer-shell.js's own `hasContent`/
// `renderBody` callbacks already use — appShell owns the chrome MECHANICS
// (a persistent header, a nav slot, an outlet); the composition root owns
// what the nav actually SAYS.
import { el, brandMark } from './dom.js';
import { findEvent } from './events.js';
import { getSupabase } from './supabaseClient.js';
import { listPendingOperations } from './outbox.js';
import { computeSyncState } from './syncState.js';
import { APP_VERSION, NAMEPLATE } from './version.js';

const APP_NAME = 'Seduh Score';

// How often the sync panel re-checks the outbox — a plain poll, not a
// realtime subscription, since outbox state is local IndexedDB with no
// network round-trip to watch. Frequent enough to feel responsive right
// after a reconnect, cheap enough (a local IndexedDB read) that polling is
// the right tool rather than inventing a pub/sub layer for one consumer.
// Overridable via mountAppShell's own syncPollMs param — test-only seam:
// vi.useFakeTimers() and fake-indexeddb's own internal callback scheduling
// don't mix safely (found writing appShell.test.js — any IndexedDB op
// performed while timers are faked just hangs), so a real-time test proving
// the poll actually fires needs a genuinely short interval, not a faked one.
const SYNC_POLL_MS = 3000;

export function mountAppShell(
  root,
  { appName = APP_NAME, client = getSupabase(), syncPollMs = SYNC_POLL_MS } = {},
) {
  root.innerHTML = '';

  // Not an <h1> — every routed screen already owns the page's real <h1>
  // (its own heading, e.g. "Events", "October Cup"), so a second one here
  // would give every organiser page two level-1 headings. This is brand
  // text inside the <header> landmark, not a content heading — unlike
  // viewer-shell.js's own renderChrome() identity name, which IS a real
  // <h1> deliberately, because there's no separate routed screen heading
  // competing with it on that audience-facing surface.
  // Found missing entirely in a live production check — this whole shell
  // rendered a text-only wordmark, no mark/logo anywhere. Ported from the
  // legacy Seduh-Score repo (see brandMark()'s own comment in dom.js).
  const markEl = el('span', { className: 'app-shell-mark', attrs: { 'aria-hidden': 'true' } }, [
    brandMark(),
  ]);
  const nameEl = el('p', { className: 'app-shell-name', text: appName });
  const breadcrumbEl = el('span', { className: 'app-shell-breadcrumb' });
  const navEl = el('nav', {
    className: 'app-shell-nav',
    id: 'app-shell-nav',
    attrs: { 'aria-label': 'Sections' },
  });
  // Mobile hamburger toggle (production UI/UX feedback, 2026-09-05):
  // below the CSS breakpoint, `.app-shell-nav` collapses to nothing by
  // default — without a toggle, several nav links plus the auth control
  // used to force the header onto 2-3 wrapped rows before any real screen
  // content appeared. `navEl` itself is never recreated (only its children,
  // on every setNav()), so the open/closed class toggled here survives
  // across navigation the same way the rest of this shell's persistent
  // nodes do — no extra state threading needed.
  const navToggle = el('button', {
    className: 'app-shell-nav-toggle tap-target',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'app-shell-nav',
      'aria-label': 'Menu',
    },
  });
  navToggle.append(
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
  );
  navToggle.addEventListener('click', () => {
    const open = navEl.classList.toggle('app-shell-nav-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Escape closes the menu and returns focus to the toggle — found in
  // review (ui-accessibility-reviewer): the standard disclosure-button
  // pattern (WAI-ARIA APG) expects this when the button retains focus (it
  // does here — nothing moves focus into the panel on open), and without
  // it the only way to close the menu was tapping a link or the toggle
  // itself again. Scoped to the toggle, not `document`, so this never
  // fires while focus is somewhere else entirely unrelated to this menu.
  navToggle.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!navEl.classList.contains('app-shell-nav-open')) return;
    navEl.classList.remove('app-shell-nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.focus();
  });
  // §8.4/T3.3's own AC: "three-state sync panel on the organiser device: off
  // / live / not synced. Fail-open never lies about a write that failed."
  // syncState.js's computeSyncState() already implemented that logic (T3.3)
  // but had ZERO consumers anywhere in the app — found in Phase 6 offline-
  // soak scoping: an organiser on real venue wifi had no visual indication
  // whatsoever that a tap/write was queued and unsynced. role="status"/
  // aria-live on a node that's mutated in place (never torn down and
  // recreated) rather than rebuilt — this codebase's own root.innerHTML =
  // ''-then-repopulate pattern is what makes aria-live unreliable elsewhere
  // (see loginScreen.js's comment); this node persists across every
  // refreshSync() call specifically to avoid that trap.
  const syncEl = el('span', {
    className: 'app-shell-sync',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const authEl = el('div', { className: 'app-shell-auth' });
  const header = el('header', { className: 'app-shell-header' }, [
    markEl,
    nameEl,
    breadcrumbEl,
    navToggle,
    navEl,
    syncEl,
    authEl,
  ]);
  const outlet = el('main', { className: 'app-shell-outlet' });
  // Quick, glance-based verification for bug reports (2026-09-05) — mirrors
  // the legacy Seduh Score site's own footer nameplate (seduhscore.com/bts/:
  // "seduhscore.com · v5.16.0"). A plain static `<footer>`, not `role="status"`
  // — this text never changes after mount, so there's nothing to announce.
  //
  // The version number itself links to /bts/index.html (2026-09-05, same day
  // the BTS page was migrated and wired in — public/bts/index.html) — same
  // idea as the legacy site's own footer, which reads as a nameplate/credit
  // line pointing at exactly that page. The full `index.html` filename is
  // required, not just `/bts/` — verified live: this app's SPA fallback
  // (needed so a direct/refreshed load of any hash route still serves
  // index.html) claims any path without an exact file match first, so the
  // trailing-slash form silently serves the login screen instead of this
  // static page. openInNewTab-shaped (target=_blank, rel=noopener noreferrer,
  // sr-only context-change warning) for the same reason setNav's own
  // openInNewTab links are: this organiser tab shouldn't navigate away from
  // whatever screen is currently open just to read a credits page.
  const footerEl = el('footer', { className: 'app-shell-footer' }, [
    el('span', { text: `${appName} · ${NAMEPLATE} · ` }),
    el(
      'a',
      {
        className: 'app-shell-footer-link',
        attrs: { href: '/bts/index.html', target: '_blank', rel: 'noopener noreferrer' },
      },
      [
        document.createTextNode(`v${APP_VERSION}`),
        el('span', { className: 'sr-only', text: ' — Behind the Seduh (opens in a new tab)' }),
      ],
    ),
  ]);

  root.append(header, outlet, footerEl);

  // Temporary (2026-08-30) — a plain "who's signed in, sign out" control,
  // ahead of any real access-control UI (D14). Reactive via
  // onAuthStateChange rather than a one-time fetch: this shell is mounted
  // ONCE per app lifetime, but a sign-in can happen well after that (the
  // login screen mounts inside THIS shell's own outlet — see main.js's
  // requireAuth), so a static fetch at mount time would show "signed out"
  // forever even after a real sign-in succeeds.
  function renderAuth(session) {
    authEl.innerHTML = '';
    if (!session) return;
    const signOutButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Sign out',
      attrs: { type: 'button' },
    });
    signOutButton.addEventListener('click', async () => {
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch {
        // Found missing in review: an unguarded await here meant a failed
        // signOut() (a real possibility over a bad connection) left the
        // click handler throwing as an unhandled rejection and the user
        // believing they'd signed out when they hadn't — the button stays
        // enabled and clickable so they can just try again.
        return;
      }
      // Re-triggers the router (requireAuth finds no session and shows
      // the login screen) — no extra plumbing needed between this shell
      // and main.js's own routing.
      location.hash = '#/events';
    });
    authEl.append(
      el('span', { className: 'app-shell-auth-email', text: session.user.email }),
      signOutButton,
    );
  }

  const {
    data: { subscription: authSubscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    renderAuth(session);
  });

  // `enabled` mirrors syncState.js's own doc: "sync only means something
  // once there's an active context to sync (e.g. a running event)" — this
  // shell already tracks exactly that signal via cachedEventId (declared
  // below), so no new state is needed. computeSyncState() itself still
  // checks pendingCount/lastFlushError FIRST, before enabled, so a pending
  // or stuck operation left over from a PREVIOUS event never hides behind
  // "off" just because the organiser navigated back to the plain events
  // list — fail-open is computeSyncState's own job, not this caller's.
  //
  // `lastFlushError` — found in review (offline-sync-auditor, Phase 6
  // offline soak): main.js's own sync-on-reconnect flush attempt
  // (attemptReconnectFlush) runs with no screen watching its result, unlike
  // every pre-existing flush call site (each reads its own flushResult off
  // the same await that triggered the write, and surfaces a real conflict
  // via its own pendingHeatCheck-style handling). A permanently-failed
  // operation is REMOVED from the outbox by design (core/outbox.js's own
  // runFlush — a conflict that will never succeed must not block every
  // later, unrelated operation behind it forever) — but with nobody reading
  // that removal's reason, the very next poll saw an empty queue and
  // reported "Synced," a false all-clear for a write that was actually
  // discarded. That's exactly the "conflict silently resolved" failure mode
  // §9 exists to prevent, and worse than staying "not synced" would have
  // been. `reportFlushError()` below is how a caller outside any screen
  // (main.js's reconnect trigger) surfaces that same conflict here instead.
  let lastFlushError = null;
  let lastSyncKey = null;
  function renderSync(state) {
    syncEl.innerHTML = '';
    syncEl.className = 'app-shell-sync';
    if (state.status === 'off') return; // nothing to report — no context yet, not a warning
    if (state.status === 'live') {
      syncEl.classList.add('app-shell-sync-live');
      syncEl.append(
        el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: 'Synced' }),
      );
      return;
    }
    // 'not synced' — a stuckOperation (attempts > 0) is the one case that
    // actually needs a human's attention (repeatedly failing, not just
    // in-flight), so it gets its own distinct, more alarming styling rather
    // than being indistinguishable from an ordinary few-seconds-behind
    // pending state. A surfaced lastFlushError with ZERO pending operations
    // is a different, also-urgent case: the write is gone, not retrying —
    // same danger-toned styling as stuckOperation, but its own wording,
    // since "N pending" would be actively misleading here (N is 0).
    if (state.pendingCount === 0 && state.lastFlushError) {
      syncEl.classList.add('app-shell-sync-stuck');
      syncEl.textContent = 'Not synced — a write failed to save and was not retried';
    } else if (state.stuckOperation) {
      syncEl.classList.add('app-shell-sync-stuck');
      syncEl.textContent = `Not synced — retrying failed (${state.pendingCount} pending)`;
    } else {
      syncEl.classList.add('app-shell-sync-pending');
      syncEl.textContent = `Not synced (${state.pendingCount} pending)`;
    }
  }

  async function refreshSync() {
    const operations = await listPendingOperations();
    const state = computeSyncState({
      enabled: cachedEventId != null,
      operations,
      lastFlushError,
    });
    // Skip re-rendering (and re-announcing via aria-live) when nothing
    // actually changed since the last poll — found in review: without this,
    // every 3s tick would re-mutate syncEl even while idle at "live",
    // spamming an aria-live announcement for no real change.
    const key = `${state.status}:${state.pendingCount}:${state.stuckOperation?.id ?? ''}:${Boolean(state.lastFlushError)}`;
    if (key === lastSyncKey) return;
    lastSyncKey = key;
    renderSync(state);
  }

  const syncIntervalId = setInterval(refreshSync, syncPollMs);

  // Cached by event id — repeat navigation within the same event's screens
  // (Setup <-> Roster <-> Heats <-> ...) shouldn't refetch the event just to
  // redraw the same breadcrumb text every time. Every organiser screen
  // already calls findEvent() internally for its own is_test banner;
  // threading that value back out of 8 already-shipped, already-reviewed
  // screens (as a second return value, or a callback) just for a cosmetic
  // breadcrumb isn't worth touching every one of them — one small,
  // independent, non-performance-sensitive read here is the cheaper trade.
  //
  // Deliberately NOT gated by main.js's requireAuth() — setNav() (and the
  // findEvent() call inside it) is invoked by router.js's onNavigate
  // synchronously, before requireAuth's own session check even starts
  // (found in security review). This is safe, not a hole: `events` is
  // RLS-scoped to org membership regardless of caller, so an
  // unauthenticated/non-member client's query here returns zero rows —
  // caught below, clearing the breadcrumb — never real data. RLS, not this
  // UI gate, is what actually protects this read, same as everywhere else
  // in this app.
  let cachedEventId = null;

  // Keeps a CSS custom property on `root` in sync with the header's own
  // real rendered height — set on `root` (the common ancestor of both
  // `header` and `outlet`), not `header` itself, since a CSS custom
  // property only inherits DOWN the tree and `outlet` is header's SIBLING,
  // not its descendant. Needed because the header is now `position:
  // sticky` (found in the same production-feedback pass): router.js's own
  // post-navigation focus-move (`heading.focus()` on `outlet`'s new h1/h2)
  // can trigger the browser's native scroll-into-view, which has no
  // concept of the sticky header's own paint-order occlusion — on a long
  // scrolled page (exactly the case the sticky header itself exists to
  // help with), that scroll can land the newly-focused heading directly
  // UNDER the header instead of below it, hiding both the heading and its
  // own focus ring. `appShell.css`'s own `.app-shell-outlet h1, h2` rule
  // reads this via `scroll-margin-top` to compensate. Re-measured here
  // (called on every setNav(), i.e. every navigation) since the header's
  // real height changes with the nav link count/wrap state, not just the
  // viewport width. Guarded on height > 0 so a headless/layout-less test
  // environment (jsdom never performs real layout) leaves the CSS
  // fallback value in place instead of clobbering it with a meaningless 0.
  function syncHeaderHeightVar() {
    const height = header.getBoundingClientRect().height;
    if (height > 0) root.style.setProperty('--app-shell-header-height', `${height}px`);
  }

  async function setNav({ eventId = null, links = [] } = {}) {
    navEl.innerHTML = '';
    for (const link of links) {
      const linkAttrs = { href: link.href };
      // aria-current: 'page' — found in the app-wiring holistic pass: the
      // active link was only ever distinguished visually (bold + underline
      // via .app-shell-link-active), giving a screen-reader user no
      // programmatic signal of which section they're currently in. Doesn't
      // apply to an external (openInNewTab) link — those never become the
      // "current section" of this app's own navigation. Explicitly guarded
      // on !link.openInNewTab, not just asserted in this comment — found in
      // review (test-auditor): no real caller passes both flags on the same
      // link today, but the comment's own claim was previously unenforced
      // in code, so a future link that did would have silently gotten
      // aria-current on a tab-opening link anyway.
      if (link.active && !link.openInNewTab) linkAttrs['aria-current'] = 'page';
      // openInNewTab — the three /live/* surfaces (splash, projector,
      // phone) are meant to be pulled up on a SEPARATE device/tab (a
      // projector, a phone) while the organiser keeps working in this one;
      // navigating the organiser's own tab away to reach them (found
      // missing in a live production check — there was no link to them at
      // all) would lose their place. `noopener` — this new tab must not be
      // able to reach back into this one via window.opener.
      if (link.openInNewTab) {
        linkAttrs.target = '_blank';
        linkAttrs.rel = 'noopener noreferrer';
      }
      // A screen-reader user gets no other warning that clicking this link
      // opens a brand-new tab rather than navigating the current one — an
      // unannounced context change (found in the accessibility review of
      // this same feedback pass). Sighted mouse users at least see
      // target=_blank behave differently; a screen-reader user has no such
      // signal without this. Kept out of the VISIBLE label (which is
      // already fairly long — "Audience — projector") via .sr-only, same
      // token/utility class this codebase already uses elsewhere (see
      // base.css) rather than inventing a second convention.
      const linkChildren = link.openInNewTab
        ? [
            document.createTextNode(link.label),
            el('span', { className: 'sr-only', text: ' (opens in a new tab)' }),
          ]
        : [];
      const linkEl = el(
        'a',
        {
          className: link.active ? 'app-shell-link app-shell-link-active' : 'app-shell-link',
          text: link.openInNewTab ? undefined : link.label,
          attrs: linkAttrs,
        },
        linkChildren,
      );
      // Blur immediately on click — found in the same pass: unlike a link
      // INSIDE a routed screen (removed wholesale by the next screen's own
      // root.innerHTML = ''), this shell's own nav links are never removed
      // across a navigation, so router.js's own post-navigation focus
      // fallback (which only moves focus to the new screen's heading when
      // `document.activeElement === document.body`) never fires after a
      // shell-nav click — the click just leaves focus stranded on the same
      // link while the outlet underneath it silently changes screens, with
      // no signal to a screen-reader/keyboard user that anything happened.
      // Blurring here restores that fallback's own assumption without
      // touching router.js itself; default navigation still proceeds (this
      // never calls preventDefault()). Doesn't apply to an external link —
      // THIS tab never navigates away, so there's no "new screen" for focus
      // to land on; blurring would just strand a keyboard user's place for
      // no reason.
      if (!link.openInNewTab) linkEl.addEventListener('click', () => linkEl.blur());
      // Closes the mobile menu on any link tap, including openInNewTab
      // links — this tab doesn't navigate away for those, but the organiser
      // has still made a choice, and leaving the menu open over whatever
      // renders next (or the same screen, for a new-tab link) has no
      // upside. Harmless no-op above the CSS breakpoint, where the class
      // has no visual effect.
      linkEl.addEventListener('click', () => {
        navEl.classList.remove('app-shell-nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
      navEl.appendChild(linkEl);
    }

    syncHeaderHeightVar();

    if (!eventId) {
      cachedEventId = null;
      breadcrumbEl.textContent = '';
      refreshSync(); // don't wait up to SYNC_POLL_MS for "enabled" to catch up
      return;
    }
    if (eventId === cachedEventId) {
      refreshSync();
      return;
    }
    cachedEventId = eventId;
    refreshSync();
    try {
      const event = await findEvent(eventId, client);
      // A slower-resolving call must never clobber a faster one — same
      // staleness discipline core/viewer-shell.js's own requestSeq/seq
      // guard uses, applied here via the simplest possible form: if
      // cachedEventId has moved on to a DIFFERENT event since this fetch
      // started, this result is stale, drop it.
      if (cachedEventId !== eventId) return;
      breadcrumbEl.textContent = event.name;
    } catch {
      if (cachedEventId !== eventId) return;
      breadcrumbEl.textContent = '';
    }
  }

  refreshSync(); // first paint — don't wait for the first SYNC_POLL_MS tick

  return {
    outlet,
    setNav,
    // Lets a caller outside any screen (main.js's own sync-on-reconnect
    // trigger) surface a permanently-failed flush the sync panel would
    // otherwise have no way to learn about — see the lastFlushError comment
    // above. Pass an Error to report one, or `null`/no argument to clear a
    // previously-reported one once a later attempt genuinely succeeds
    // (deliberately NOT auto-cleared by the poll itself — a real conflict
    // must stay visible until something concrete supersedes it, not time
    // out silently).
    reportFlushError(error = null) {
      lastFlushError = error;
      refreshSync();
    },
    unmount() {
      clearInterval(syncIntervalId);
      authSubscription.unsubscribe();
      root.innerHTML = '';
    },
  };
}
