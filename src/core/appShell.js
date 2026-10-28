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
import { el, brandLockup, setBusyDisabled } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { orgLabel } from './orgLabel.js';
import { findEvent } from './events.js';
import { getSupabase } from './supabaseClient.js';
import {
  getOutboxOwner,
  isFlushInProgress,
  listAccountOperations,
  onOperationDropped,
  partitionOperations,
  payloadOrgId,
} from './outbox.js';
import { computeSyncState } from './syncState.js';
import { signOutWithTimeout, unsyncedSignOutWarning } from './signOut.js';
import { goToHash } from './navigation.js';
import { APP_VERSION, NAMEPLATE } from './version.js';

const APP_NAME = 'Seduh Score';
const SIGN_OUT_ARM_MS = 15000;
const SIGN_OUT_ARM_GRACE_MS = 600;

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

// How the sync panel batches dropped operations (see the drop listener in
// mountAppShell): it re-checks every DROP_CHECK_MS and announces once the
// flush that dropped them has finished, or after DROP_MAX_WAIT_MS at the
// latest so a long or stalled pass can't hold a lost write back. Both are
// overridable via mountAppShell's dropCheckMs/dropMaxWaitMs (test seams).
const DROP_CHECK_MS = 250;
const DROP_MAX_WAIT_MS = 5000;

// Where the lost-write notice is kept across a reload of this tab (see
// saveLostWriteCount/loadLostWriteCount in mountAppShell).
const LOST_WRITES_STORAGE_KEY = 'seduh-lost-writes';

// Only the count is kept: the panel never displays the error itself.
// sessionStorage can be missing or throw (private mode, blocked site data);
// both helpers then fall back to in-memory only, the pre-2026-09-27 state.
function loadLostWriteCount() {
  try {
    const count = JSON.parse(sessionStorage.getItem(LOST_WRITES_STORAGE_KEY))?.count;
    if (Number.isInteger(count) && count > 0) return count;
  } catch {
    // unreadable or malformed — start clean
  }
  return 0;
}

function saveLostWriteCount(count) {
  try {
    sessionStorage.setItem(LOST_WRITES_STORAGE_KEY, JSON.stringify({ count }));
  } catch {
    // storage unavailable — the in-memory notice still shows
  }
}

export function mountAppShell(
  root,
  {
    appName = APP_NAME,
    client = getSupabase(),
    syncPollMs = SYNC_POLL_MS,
    // What signing out would leave behind for this account (T-TEN.C6). Injectable for the same reason
    // `client` is: a test of the button itself should not depend on how long an IndexedDB read takes.
    accountOperations = listAccountOperations,
    // How long a sign-out warning waits to be confirmed before it is withdrawn (it is a count as of now),
    // and how long after it appears a press is ignored (a double tap must not confirm what was never
    // read). Injectable so a test need not wait them out.
    signOutArmMs = SIGN_OUT_ARM_MS,
    signOutArmGraceMs = SIGN_OUT_ARM_GRACE_MS,
    dropCheckMs = DROP_CHECK_MS,
    dropMaxWaitMs = DROP_MAX_WAIT_MS,
    // Optional map of outbox operation `type` -> a short, lowercase gerund
    // phrase (e.g. "confirming a heat"), for the sync panel to name WHICH
    // operation is stuck (ROADMAP.md gap, closed 2026-09-11) instead of the
    // generic "retrying failed" every stuck operation used to share
    // regardless of type. No format-specific vocabulary lives in THIS file
    // (see its own top comment) — the active format's own labels are
    // supplied by main.js, the one file already allowed to know both (see
    // formats/cup-taster/outboxHandlers.js's own cupTasterOperationLabels).
    // A type with no entry (or no map supplied at all) falls back to a
    // still-honest, if less specific, message below rather than crashing or
    // showing "undefined".
    operationLabels = {},
  } = {},
) {
  root.innerHTML = '';

  // Not an <h1> — every routed screen already owns the page's real <h1>
  // (its own heading, e.g. "Events", "October Cup"), so a second one here
  // would give every organiser page two level-1 headings. This is brand
  // text inside the <header> landmark, not a content heading — unlike
  // viewer-shell.js's own renderChrome() identity name, which IS a real
  // <h1> deliberately, because there's no separate routed screen heading
  // competing with it on that audience-facing surface.
  // The mark and the wordmark are the shared brand lockup (core/dom.js brandLockup(), styled only in
  // src/ui/tokens/brand.css) — this shell just sizes it and wraps it in the home link below.
  const lockupEl = brandLockup({
    name: appName,
    markClass: 'app-shell-mark',
    nameClass: 'app-shell-name',
  });
  // The organiser shell lives at /app/, but it is part of the public site,
  // not a closed destination. Keep the full wordmark as one link back to
  // the root landing page so there is always an obvious route out of an
  // event or sign-in screen. Root-relative works for both production hosts.
  const brandEl = el(
    'a',
    {
      className: 'app-shell-brand',
      attrs: { href: '/', 'aria-label': `${appName} home` },
    },
    [lockupEl],
  );
  const breadcrumbEl = el('span', { className: 'app-shell-breadcrumb' });
  const navEl = el('nav', {
    className: 'app-shell-nav',
    attrs: { 'aria-label': 'Sections' },
  });
  const authEl = el('div', { className: 'app-shell-auth' });
  // Wraps navEl AND authEl together (2026-09-06, user-reported production
  // feedback + Figma's own suggestion) — the auth control ("signed in as
  // X" + Sign out) used to sit directly in the header row as its own
  // always-visible cluster, which on a phone viewport pushed it onto a
  // second full-width row below the header even with the nav itself
  // already collapsed into the hamburger — exactly the "vertical space"
  // problem the screenshot showed. Rolling it into the SAME collapsible
  // panel as the nav closes that gap: collapsed by default on mobile
  // (the brand and the hamburger), and revealed together with the nav
  // links once the menu opens. `navPanel` itself is never recreated (only
  // navEl's own children, on every setNav()) — same persistent-node
  // reasoning the toggle below already relied on for `navEl`.
  // The active organisation's FULL name, on its own wrapping line at the top of the menu: the header's
  // slot truncates a long name, and below 1366px (where the slot is tight) this is where it can be read
  // in full. Sighted aid only: a screen reader already gets the slot's own "Organisation: …" label.
  const orgFullEl = el('div', {
    className: 'app-shell-org-full',
    attrs: { hidden: '', 'aria-hidden': 'true' },
  });
  const navPanel = el('div', { className: 'app-shell-nav-panel', id: 'app-shell-nav-panel' }, [
    orgFullEl,
    navEl,
    authEl,
  ]);
  // Mobile hamburger toggle (production UI/UX feedback, 2026-09-05):
  // below the CSS breakpoint, `.app-shell-nav-panel` collapses to nothing
  // by default — without a toggle, several nav links plus the auth control
  // used to force the header onto 2-3 wrapped rows before any real screen
  // content appeared.
  // The header element that last had focus — see the breakpoint handling below.
  let lastHeaderFocus = null;
  const navToggle = el('button', {
    className: 'app-shell-nav-toggle tap-target',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'app-shell-nav-panel',
      'aria-label': 'Menu',
    },
  });
  const toggleBar = () =>
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } });
  navToggle.append(
    el('span', { className: 'app-shell-nav-toggle-icon', attrs: { 'aria-hidden': 'true' } }, [
      toggleBar(),
      toggleBar(),
      toggleBar(),
    ]),
    // Visible from 640px up (appShell.css), where an icon-only button is
    // easy to miss on a tablet-sized screen. Its text matches the button's
    // aria-label exactly (WCAG 2.5.3 label-in-name); aria-hidden so a screen
    // reader doesn't announce it twice.
    el('span', {
      className: 'app-shell-nav-toggle-label',
      text: 'Menu',
      attrs: { 'aria-hidden': 'true' },
    }),
  );
  // Shared by every "the menu should close now" trigger below — a nav link
  // tap, Sign out, Escape. Kept as one function (found worth factoring in
  // review, code-reviewer/ui-accessibility-reviewer, 2026-09-06) once
  // `authEl` moved into this same panel alongside the nav links: two
  // different KINDS of control now live in one collapsible unit, and each
  // needs the identical close side effect, not just the one link-click
  // case this used to be inlined for.
  // Set by the Sign out button: closing the menu is walking away from a half-confirmed sign-out.
  let disarmSignOut = () => {};
  function closeMenu() {
    disarmSignOut();
    navPanel.classList.remove('app-shell-nav-panel-open');
    navToggle.setAttribute('aria-expanded', 'false');
    // Whatever inside the panel had focus is about to be hidden (a tap on a
    // link closes the menu): forget it, so a later resize doesn't "restore"
    // focus the user never lost by resizing.
    if (lastHeaderFocus && navPanel.contains(lastHeaderFocus)) lastHeaderFocus = null;
  }
  navToggle.addEventListener('click', () => {
    const open = navPanel.classList.toggle('app-shell-nav-panel-open');
    if (!open) disarmSignOut();
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
    if (!navPanel.classList.contains('app-shell-nav-panel-open')) return;
    closeMenu();
    navToggle.focus();
  });
  // A second Escape listener, on the panel itself — found missing in review
  // (ui-accessibility-reviewer, 2026-09-06): the one above only fires while
  // focus is still ON the toggle button, but a keyboard user who Tabs
  // FORWARD into the panel's own contents (a nav link, or Sign out — both
  // real destinations now that the panel holds more than just the toggle's
  // own immediate next stop) gets no Escape handling at all once they've
  // left the toggle. This one is intentionally scoped to `navPanel`, not
  // `document` — Escape from somewhere totally unrelated to this menu
  // should never suddenly steal focus back to a hamburger button.
  navPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!navPanel.classList.contains('app-shell-nav-panel-open')) return;
    closeMenu();
    navToggle.focus();
  });
  // Keeps keyboard focus from being stranded when the window is resized (or a
  // tablet rotated) across the inline/hamburger breakpoint with focus on the
  // control that is about to disappear: the toggle when the nav goes inline,
  // a link inside the panel when it collapses. The browser drops focus to
  // <body> and a keyboard user has to Tab in from the top of the page again.
  // `lastHeaderFocus` remembers the header element that last had focus (cleared
  // on any pointer press), since by the
  // time the media query's change event fires the browser may already have
  // moved focus to <body>. Must match the min-width:1366px block in
  // appShell.css. matchMedia is absent in jsdom, so this is skipped there
  // unless a test stubs it.
  const INLINE_NAV_QUERY = '(min-width: 1366px)';
  const trackHeaderFocus = (event) => {
    lastHeaderFocus = header.contains(event.target) ? event.target : null;
  };
  // Any pointer press, inside the header or out: a press on a focusable
  // control re-sets this via the focusin that follows it, while a press on
  // non-focusable chrome (padding, the breadcrumb) or the page leaves focus on
  // <body> on purpose — nothing is stranded, so nothing should be restored.
  // ...except a press on the control that ALREADY has focus: that fires no new focusin, so clearing here
  // would leave nothing to restore when the browser drops that control's focus at the breakpoint (found
  // in a flaky browser test: a keyboard user dropped to the top of the page).
  const forgetHeaderFocus = (event) => {
    const active = document.activeElement;
    const pressedFocused =
      active &&
      active !== document.body &&
      header.contains(active) &&
      active.contains(event.target);
    lastHeaderFocus = pressedFocused ? active : null;
  };
  const inlineNavQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia(INLINE_NAV_QUERY) : null;
  const onNavLayoutChange = (event) => {
    // Where focus was: still on the element about to disappear, or — if the
    // browser already dropped it to <body> — the last header element that had
    // it. Read before closeMenu() below clears that memory for the panel.
    const active = document.activeElement;
    const from = !active || active === document.body ? lastHeaderFocus : active;
    // Inline (>= 1366px): the toggle is gone and the panel is always shown,
    // so its open/closed state is moot; collapsing: come back closed.
    closeMenu();
    if (event.matches) {
      if (from === navToggle) (navEl.querySelector('a') ?? authEl.querySelector('button'))?.focus();
    } else if (from && navPanel.contains(from)) {
      navToggle.focus();
    }
  };
  if (inlineNavQuery) {
    document.addEventListener('focusin', trackHeaderFocus);
    document.addEventListener('pointerdown', forgetHeaderFocus);
    inlineNavQuery.addEventListener('change', onNavLayoutChange);
  }
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
    attrs: { role: 'status', 'aria-live': 'polite', id: 'app-shell-sync-detail' },
  });
  // What a sighted user sees in the header: one short, one-line chip, so the
  // header never grows when the notice changes. A plain "Synced" chip is
  // decorative (the live region above already says it); a problem state is a
  // button that opens the full sentence (the live region itself, shown as a
  // panel under the header that overlays the page instead of pushing it).
  // Persistent nodes, mutated in place (see renderSync) — never rebuilt.
  const syncChipStatic = el('span', {
    className: 'app-shell-sync-chip app-shell-sync-chip-live',
    attrs: { 'aria-hidden': 'true', hidden: '' },
  });
  const syncChipButton = el('button', {
    className: 'app-shell-sync-chip',
    attrs: {
      type: 'button',
      hidden: '',
      'aria-expanded': 'false',
      'aria-controls': 'app-shell-sync-detail',
    },
  });
  // The event name and the sync chip: one extra row under the brand on a phone,
  // dissolved into the header's own row from 640px up (see appShell.css).
  const contextEl = el('div', { className: 'app-shell-context app-shell-context-empty' }, [
    breadcrumbEl,
    syncChipStatic,
    syncChipButton,
    syncEl,
  ]);
  // ---- Which organisation the console is working in (T-TEN.C3) ----
  // Identity must be unambiguous for someone who administers two organisations, so the active
  // organisation's name is always in the header's main row, between the brand and the Menu button
  // (never inside the collapsing panel, never in the event/sync row, whose layout it must not move).
  // One organisation: a plain label. Two or more: a native <select> (full keyboard and screen-reader
  // behaviour for free; the picker shows full names even where the closed control truncates).
  // Format-agnostic: the shell is told the list, the active one and what to call on a choice;
  // main.js owns what a switch means.
  const orgEl = el('div', { className: 'app-shell-org', attrs: { hidden: '' } });
  // One persistent live region (never rebuilt, like the sync region above) for two things: a quiet
  // announcement for a screen reader ("Now working in …"), and a visible refusal that opens as an
  // overlay under the header, so the header never grows and nothing below it moves.
  const orgNoticeEl = el('div', {
    className: 'app-shell-org-notice',
    attrs: { role: 'status', 'aria-live': 'polite', id: 'app-shell-org-notice' },
  });
  // Who to tell when the open notice is dismissed (the sign-out warning disarms its button), and the one
  // control a press on which must not dismiss it (the button the warning is about).
  let noticeOnDismiss = null;
  let noticeKeepOpenFor = null;
  const header = el('header', { className: 'app-shell-header' }, [
    brandEl,
    orgEl,
    contextEl,
    navToggle,
    navPanel,
    orgNoticeEl,
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
  // Rebuilt only when the person changes: an auth event that carries the same session again (a token
  // refresh, the tab regaining focus) must not wipe a half-confirmed sign-out or drop focus to the page.
  let renderedAuthKey = null;
  function renderAuth(session) {
    const key = session ? `${session.user?.id ?? ''}:${session.user?.email ?? ''}` : null;
    if (key === renderedAuthKey) return;
    renderedAuthKey = key;
    disarmSignOut();
    disarmSignOut = () => {};
    authEl.innerHTML = '';
    if (!session) return;
    const signOutButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Sign out',
      attrs: { type: 'button' },
    });
    const authStatus = el('span', {
      className: 'app-shell-auth-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    // Signing out leaves whatever has not synced on this device (kept for this account, sent when it is
    // signed in again), but never without the person knowing: the first press says how many changes are
    // waiting, in the notice under the header (it overlays the page: the header never grows), and the
    // next press signs out. The button keeps its label: a longer one wrapped the narrow menu row. The
    // warning is a count as of now, so it is withdrawn after a while, when the menu is closed, and when
    // the notice is dismissed; the next press then counts afresh.
    let armed = false;
    let armedAt = 0;
    let checking = false;
    let armTimer = null;
    function disarm() {
      if (!armed) return;
      armed = false;
      clearTimeout(armTimer);
      // Only if the open notice is this one's (it clears itself through the dismiss callback).
      if (noticeOnDismiss === disarm) clearRefusal();
    }
    disarmSignOut = disarm;
    signOutButton.addEventListener('click', async () => {
      if (checking) return;
      authStatus.textContent = '';
      // A double tap lands on the relabelled button before the warning can have been read.
      if (armed && Date.now() - armedAt < signOutArmGraceMs) return;
      if (!armed) {
        checking = true;
        let warning;
        try {
          warning = await unsyncedSignOutWarning(session.user?.email, accountOperations);
        } finally {
          checking = false;
        }
        if (warning) {
          armed = true;
          armedAt = Date.now();
          showOrganisationNotice(warning, { onDismiss: disarm, keepOpenFor: signOutButton });
          armTimer = setTimeout(clearRefusal, signOutArmMs);
          return;
        }
      }
      // Found missing in review: an unguarded await here meant a failed
      // signOut() (a real possibility over a bad connection) left the
      // click handler throwing as an unhandled rejection and the user
      // believing they'd signed out when they hadn't — the button stays
      // enabled and clickable so they can just try again. The shared helper
      // (signOut.js) also gives up at the shared timeout, which this button
      // used not to: a stalled connection could leave the click pending.
      const failure = await signOutWithTimeout(client);
      if (failure) {
        // Say so (a polite live region): the button stays enabled so they can simply try again.
        authStatus.textContent = failure;
        return;
      }
      // Found missing in review (code-reviewer/ui-accessibility-reviewer,
      // 2026-09-06): unlike a nav link, this button never closed the mobile
      // menu on its own — signing out from an open hamburger menu on a
      // phone left the panel open (now showing only nav links, since
      // renderAuth(null) below clears authEl) sitting over the login screen
      // that mounts underneath it, with no interaction having told the
      // organiser the menu was still expanded. Only on the success path —
      // a failed attempt (the catch above) keeps the menu open on purpose,
      // so Sign out is still right there to retry without reopening it.
      closeMenu();
      clearRefusal();
      // Re-triggers the router (requireAuth finds no session and shows the login screen). User-reported,
      // 2026-09-09: signing out while ALREADY on #/events left the stale screen up, because assigning
      // the same hash fires no hashchange; goToHash() (navigation.js) dispatches one in that case.
      goToHash('#/events');
    });
    // The rest of the account area (D-PW1): choosing a new password. A plain link to a console route, so it
    // goes through the same sign-in gate as every other one; like a nav link it closes the open menu and
    // gives up focus so the router's own focus move (to the new screen's heading) can happen.
    const changePasswordLink = el('a', {
      className: 'app-shell-auth-link',
      text: 'Change password',
      attrs: { href: '#/account/password' },
    });
    changePasswordLink.addEventListener('click', () => {
      changePasswordLink.blur();
      closeMenu();
    });
    authEl.append(
      el('span', { className: 'app-shell-auth-email', text: session.user.email }),
      changePasswordLink,
      signOutButton,
      authStatus,
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
  // `lastFlushError` — a dropped operation is REMOVED from the outbox by
  // design (core/outbox.js's runFlush: a conflict that will never succeed
  // must not block every later operation behind it), so without this the
  // very next poll sees an empty queue and reports a false "Synced" — the
  // "conflict silently resolved" failure §9 exists to prevent (found in
  // review, offline-sync-auditor, Phase 6 offline soak).
  //
  // Fed by core/outbox.js's onOperationDropped, not by callers reporting
  // results (2026-09-27, offline-sync-auditor): main.js's reconnect flush
  // used to be the only caller forwarding a drop here, so a drop during any
  // screen-triggered flush (publishLiveSession, a timing tap, a confirm)
  // never reached the panel and the next poll showed "Synced". Subscribing
  // at the source catches every flush in this tab, whoever triggered it.
  // Sticky: a dropped write never comes back, so a later, unrelated success
  // must not clear it. Kept in sessionStorage, so it also survives a reload
  // of this tab — and usually the browser restoring a tab the OS discarded,
  // common on venue phones — instead of vanishing with the only record of
  // the loss (offline-sync-auditor D4, 2026-09-27). Closing the tab still
  // clears it; persisting and acknowledging lost writes is ROADMAP's (and
  // should replace this key, not sit beside it). Deliberately not scoped to
  // the signed-in user: the writes were lost on this device, so a sign-out
  // and sign-in in the same tab keeps the notice.
  let lastFlushError = null;
  // How many operations have been dropped — counted per operation, not per
  // flush (five leftovers dropped in one pass are five lost writes, not
  // one). lastFlushError only holds the latest error, and a second loss
  // must not read the same as the first (ui-accessibility-reviewer,
  // 2026-09-26).
  //
  // A pass's drops are collected and announced together once that flush is
  // over: each render is a polite announcement, and ten rehearsal leftovers
  // dropped one by one — each after its own server round trip — would
  // otherwise queue "1 write lost…", "2 writes lost…", … ahead of the timing
  // screen's own "Less than 10 seconds remaining" (ui-accessibility-
  // reviewer, 2026-09-27). A quiet-time debounce couldn't tell a pass's end
  // on slow venue wifi.
  //
  // While any drop is still unannounced, the panel doesn't render at all
  // (refreshSync holds): the dropped operation has already left the queue,
  // so a render in that window would read an empty queue and announce a
  // false "Synced" (offline-sync-auditor, 2026-09-27). It keeps showing its
  // last state — "Not synced (N pending)" or earlier losses — until then,
  // except that a green "Synced" (or an empty "off") is replaced at once by a
  // plain "Not synced": a write enqueued and dropped between two polls never
  // showed as pending, so holding would leave a lost write green for up to
  // DROP_MAX_WAIT_MS (offline-sync-auditor, 2026-09-27). That plain "Not
  // synced" uses the danger style: the panel already knows a write is lost
  // (ui-accessibility-reviewer, 2026-09-27).
  //
  // The cap is timed with performance.now(), not Date.now(): a wall clock
  // stepped backwards (NTP, a manual fix on an event-day tablet) would
  // otherwise make the wait negative and hold the panel indefinitely.
  let lostWriteCount = 0;
  const restoredLostWriteCount = loadLostWriteCount();
  if (restoredLostWriteCount > 0) {
    lostWriteCount = restoredLostWriteCount;
    lastFlushError = new Error('outbox: operation dropped (before this page loaded)');
  }
  // What the panel last rendered: its dedupe key, and the status alone
  // ('live' | 'not synced' | 'off' | 'holding') so the drop listener needn't
  // parse the key.
  let lastSyncKey = null;
  let lastSyncStatus = null;
  // The lost-write count the panel last showed (0 while it shows none).
  let lastRenderedLostCount = 0;
  let pendingFlushError = lastFlushError;
  let pendingLostCount = lostWriteCount;
  let firstUnannouncedDropAt = 0;
  let dropCheckTimer = null;
  function hasUnannouncedDrops() {
    return pendingLostCount > lostWriteCount;
  }
  function announceDropsWhenFlushEnds() {
    dropCheckTimer = null;
    const waitedMs = performance.now() - firstUnannouncedDropAt;
    if (isFlushInProgress() && waitedMs < dropMaxWaitMs) {
      dropCheckTimer = setTimeout(announceDropsWhenFlushEnds, dropCheckMs);
      return;
    }
    lastFlushError = pendingFlushError;
    lostWriteCount = pendingLostCount;
    refreshSync();
  }
  const stopListeningForDrops = onOperationDropped(({ error }) => {
    if (!hasUnannouncedDrops()) {
      firstUnannouncedDropAt = performance.now();
      // Already "not synced" (pending, stuck, an earlier loss) or already
      // holding: leave it — re-rendering would re-announce or downgrade an
      // earlier lost-write notice.
      if (lastSyncStatus !== 'not synced' && lastSyncStatus !== 'holding') {
        showNotSyncedWhileHolding();
      }
    }
    // Never null: a transaction aborted without an error rejects with
    // `tx.error === null`, and a null here would read as "no loss" and turn
    // the panel back to "Synced" (code-reviewer, 2026-09-27).
    pendingFlushError = error ?? new Error('outbox: operation dropped');
    pendingLostCount += 1;
    // Saved at once, not when announced: a reload during the hold (up to
    // DROP_MAX_WAIT_MS — exactly when a stalled-looking panel invites one)
    // would otherwise lose these drops. Restore seeds both counters from it,
    // so they come back as already announced (offline-sync-auditor,
    // 2026-09-27).
    saveLostWriteCount(pendingLostCount);
    if (!dropCheckTimer) {
      dropCheckTimer = setTimeout(announceDropsWhenFlushEnds, dropCheckMs);
    }
  });
  // The header chip and the detail panel (see the markup above). The chip is
  // always one short line, so the sticky header's height never depends on the
  // notice; the long sentence lives in the live region, which is clipped away
  // until a problem chip is tapped and then overlays the page under the header.
  let detailOpen = false;
  function onDetailPointerDown(event) {
    if (syncChipButton.contains(event.target) || syncEl.contains(event.target)) return;
    setDetailOpen(false);
  }
  function onDetailKeyDown(event) {
    if (event.key !== 'Escape') return;
    // Only take focus back when it was on the chip or had already dropped to <body>: an Escape
    // pressed in a time or score field must leave that field where it is.
    const { activeElement } = document;
    const refocus =
      !activeElement || activeElement === document.body || activeElement === syncChipButton;
    setDetailOpen(false);
    if (refocus) syncChipButton.focus();
  }
  // Tabbing away from the chip closes the panel too — a keyboard user shouldn't be left with it
  // overlaying the page until they find Escape.
  function onChipFocusOut(event) {
    const next = event.relatedTarget;
    if (next && next !== syncChipButton) setDetailOpen(false);
  }
  function setDetailOpen(open) {
    if (open === detailOpen) return;
    detailOpen = open;
    syncEl.classList.toggle('app-shell-sync-open', open);
    syncChipButton.setAttribute('aria-expanded', String(open));
    const toggleListener = open ? 'addEventListener' : 'removeEventListener';
    document[toggleListener]('pointerdown', onDetailPointerDown);
    document[toggleListener]('keydown', onDetailKeyDown);
  }
  syncChipButton.addEventListener('click', () => setDetailOpen(!detailOpen));
  syncChipButton.addEventListener('focusout', onChipFocusOut);
  // The event-name row only exists while it has something in it (a phone shows
  // it under the brand; from 640px up it is dissolved into the header row).
  function updateContextRow() {
    contextEl.classList.toggle(
      'app-shell-context-empty',
      breadcrumbEl.textContent === '' && syncChipStatic.hidden && syncChipButton.hidden,
    );
  }
  // kind: null (nothing to report), 'live' (a quiet "Synced"), or 'pending' /
  // 'stuck' (a button that opens the detail). Called after renderSync has reset
  // syncEl's classes, so the open class is re-applied here.
  function setChip(kind, label) {
    const isButton = kind === 'pending' || kind === 'stuck';
    if (!isButton) {
      // Focus must not be lost to <body> when the chip it is on goes away.
      if (document.activeElement === syncChipButton) {
        const target = getComputedStyle(navToggle).display === 'none' ? brandEl : navToggle;
        target.focus();
      }
      setDetailOpen(false);
    }
    syncChipStatic.hidden = kind !== 'live';
    syncChipButton.hidden = !isButton;
    if (kind === 'live') {
      syncChipStatic.replaceChildren(
        el('span', { className: 'status-live-dot' }),
        el('span', { text: label }),
      );
    }
    if (isButton) {
      syncChipButton.className = `app-shell-sync-chip app-shell-sync-chip-${kind}`;
      syncChipButton.textContent = label;
      syncEl.classList.toggle('app-shell-sync-open', detailOpen);
    }
    updateContextRow();
  }
  // Rendered once when a drop lands while the panel reads "Synced"/"off" —
  // see the drop listener above. No count: the dropped operation is already
  // gone from the queue, and the real count follows when the pass ends.
  function showNotSyncedWhileHolding() {
    syncEl.className = 'app-shell-sync app-shell-sync-stuck';
    syncEl.textContent = 'Not synced';
    setChip('stuck', 'Sync failing');
    lastSyncKey = 'holding';
    lastSyncStatus = 'holding';
    syncHeaderHeightVar();
  }
  // What is waiting on this device for somebody else, in a sentence (T-TEN.C6). `lastOtherOrgIds` are the
  // organisations the signed-in person's own waiting changes were made in. Never blames anyone and never
  // offers to discard: the way forward is always to be that account, or in that organisation.
  let lastOtherOrgIds = new Set();
  function elsewhereSentence({ otherOrg, otherAccount }) {
    const total = otherOrg + otherAccount;
    const noun = total === 1 ? 'unsynced change' : 'unsynced changes';
    const them = total === 1 ? 'it' : 'them';
    if (otherAccount === 0) {
      const known = [...lastOtherOrgIds].map((id) => orgState.orgs.find((org) => org.id === id));
      // Waiting in an organisation this account is not (or no longer) a member of: there is nothing to
      // switch to, so do not say there is. They stay on the device.
      if (known.some((org) => !org)) {
        return `${total} unsynced ${total === 1 ? 'change' : 'changes'} from an organisation this account is not part of. ${total === 1 ? 'It stays' : 'They stay'} on this device.`;
      }
      const where =
        lastOtherOrgIds.size === 1
          ? orgLabel(known[0], orgState.orgs)
          : 'another of your organisations';
      return `${total} ${noun} waiting in ${where}. Switch to it to send ${them}.`;
    }
    if (otherOrg === 0) {
      return `${total} ${noun} from another account. Sign in as that account to send ${them}.`;
    }
    return `${total} ${noun} are waiting for another account or organisation.`;
  }
  function renderSync(state) {
    // The chip shows exactly while there's something to show — 'off' (no
    // event context, nothing pending or lost) shows nothing. Not keyed on
    // the event context: a loss on the events list must show too. Only
    // navigation, or a write queued, lost or drained off an event screen,
    // moves it in or out — never a write on the timing/scoring screens,
    // which always have an event context and so are never 'off'.
    syncEl.innerHTML = '';
    syncEl.className = 'app-shell-sync';
    if (state.status === 'off') {
      setChip(null); // nothing to report — no context yet, not a warning
      return;
    }
    if (state.status === 'live') {
      syncEl.append(
        el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: 'Synced' }),
      );
      setChip('live', 'Synced');
      return;
    }
    // 'not synced' — a stuckOperation (attempts > 0) is the one case that
    // actually needs a human's attention (repeatedly failing, not just
    // in-flight), so it gets its own distinct, more alarming styling rather
    // than being indistinguishable from an ordinary few-seconds-behind
    // pending state. A surfaced lastFlushError is a different, also-urgent
    // case: the write is gone, not retrying — same danger-toned styling as
    // stuckOperation, but its own wording.
    //
    // That lost-write notice wins over everything else (2026-09-26, found in
    // review: offline-sync-auditor). The report is kept for the life of the
    // tab — a dropped write never comes back — so hiding it whenever anything
    // else is queued would hide it for most of a busy event. A later stuck
    // operation is still named alongside it, so the notice never masks a
    // new, retrying failure. The pending count is left out: this is a live
    // region, and
    // re-announcing the whole sentence on every tap/flush only to change a
    // number drowned out the timing and scoring screens for screen-reader
    // users (ui-accessibility-reviewer, 2026-09-26). Not "Not synced"
    // either — later writes may well have landed; what's true is that
    // these ones were lost.
    if (state.lastFlushError) {
      syncEl.classList.add('app-shell-sync-stuck');
      const lost = lostWriteCount > 1 ? `${lostWriteCount} writes` : '1 write';
      // Shorter when a stuck operation is named alongside, so the longest
      // combination stays within the detail panel's three lines at 360px,
      // including at 130% text size or with a fallback font
      // (ui-accessibility-reviewer, 2026-09-27).
      const stuckLabel = state.stuckOperation && operationLabels[state.stuckOperation.type];
      syncEl.textContent = state.stuckOperation
        ? `${lost} lost, not retried; ${stuckLabel ? `${stuckLabel} failed` : 'retrying failed'}`
        : `${lost} lost — not saved and not retried`;
      setChip('stuck', `${lost} lost`);
    } else if (state.stuckOperation) {
      syncEl.classList.add('app-shell-sync-stuck');
      const label = operationLabels[state.stuckOperation.type];
      syncEl.textContent = label
        ? `Not synced — ${label} failed (${state.pendingCount} pending)`
        : `Not synced — retrying failed (${state.pendingCount} pending)`;
      setChip('stuck', `Sync failing (${state.pendingCount})`);
    } else if (state.pendingCount === 0) {
      // Nothing of this person's own is waiting: what is on the device belongs to someone else.
      const away = state.elsewhere.otherOrg + state.elsewhere.otherAccount;
      syncEl.classList.add('app-shell-sync-pending');
      syncEl.textContent = elsewhereSentence(state.elsewhere);
      setChip('pending', `Unsent (${away} other)`);
    } else {
      // This person's own work comes first and keeps its short wording (a live region: the count changes
      // while they score). What waits for somebody else is reported once their own work has gone.
      syncEl.classList.add('app-shell-sync-pending');
      syncEl.textContent = `Not synced (${state.pendingCount} pending)`;
      setChip('pending', `Not synced (${state.pendingCount})`);
    }
  }

  // Set by unmount(): a refresh already awaiting the outbox must not paint once the shell is gone.
  let unmounted = false;

  async function refreshSync() {
    if (unmounted) return;
    // Held while a drop is unannounced — see the drop listener above.
    if (hasUnannouncedDrops()) return;
    // A failed IndexedDB read keeps the panel's last state rather than
    // throwing an unhandled rejection on every poll tick (found in review:
    // code-reviewer, 2026-09-26).
    let operations;
    let others = { otherOrg: [], otherAccount: [] };
    try {
      // One read, split once: the owner cannot change between "mine" and "somebody else's".
      const parts = await partitionOperations();
      operations = parts.own;
      others = { otherOrg: parts.otherOrg, otherAccount: parts.otherAccount };
    } catch (err) {
      console.error('appShell: pending-operation read failed', err);
      // A newly announced loss needs nothing from the queue — show it anyway
      // rather than leave "Not synced (N pending)", the holding marker, or an
      // under-counted earlier notice up. A failed persist (the likeliest
      // drop when IndexedDB is failing) makes this read likely to fail too
      // (offline-sync-auditor, 2026-09-27). A stuck operation is named again
      // on the next successful read.
      if (!lastFlushError || hasUnannouncedDrops() || lostWriteCount === lastRenderedLostCount) {
        return;
      }
      operations = [];
    }
    if (unmounted) return;
    // The organisation is not known yet (the page has only just loaded): this person's own changes in
    // it would read as "waiting in another organisation", which is not true, and "Synced" would not be
    // either. Say nothing this tick; the next one, once it is known, tells the truth.
    const owner = getOutboxOwner();
    if (owner && owner.userId && owner.orgId == null && others.otherOrg.length > 0) return;
    // A drop can land during that read — its operation is already missing
    // from `operations`, so rendering them now would under-report.
    if (hasUnannouncedDrops()) return;
    lastOtherOrgIds = new Set(
      others.otherOrg.map((operation) => operation.orgId ?? payloadOrgId(operation.payload)),
    );
    const state = computeSyncState({
      enabled: cachedEventId != null,
      operations,
      lastFlushError,
      elsewhere: { otherOrg: others.otherOrg.length, otherAccount: others.otherAccount.length },
    });
    // Skip re-rendering (and re-announcing via aria-live) when nothing
    // actually changed since the last poll — found in review: without this,
    // every 3s tick would re-mutate syncEl even while idle at "live",
    // spamming an aria-live announcement for no real change.
    const pendingPart = state.lastFlushError ? '' : state.pendingCount;
    const key = `${state.status}:${pendingPart}:${state.stuckOperation?.type ?? ''}:${state.stuckOperation?.id ?? ''}:${state.lastFlushError ? lostWriteCount : 0}:${state.elsewhere.otherOrg}:${state.elsewhere.otherAccount}:${[...lastOtherOrgIds].join(',')}`;
    if (key === lastSyncKey) return;
    lastSyncKey = key;
    lastSyncStatus = state.status;
    lastRenderedLostCount = state.lastFlushError ? lostWriteCount : 0;
    renderSync(state);
    // The one-line chip means a changed status never changes the header's
    // height, but the context row appearing or disappearing ('off' <->
    // anything else) and extreme text sizes still do — keep the sticky-header offset
    // that scroll-margin-top relies on in step, or focused content can land
    // behind the header (ui-accessibility-reviewer, 2026-09-26).
    syncHeaderHeightVar();
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
  // The header's height also changes without any setNav()/sync-notice call:
  // opening the hamburger menu, a window resize or a tablet rotation across
  // the 1366px breakpoint. Without re-measuring, scroll-margin-top (which
  // reads this var) could leave a focused heading or error behind the sticky
  // header. Absent in jsdom, where nothing lays out anyway.
  const headerResizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncHeaderHeightVar);
  headerResizeObserver?.observe(header);

  // ---- the organisation slot: rendering, choosing, announcing ----
  const ORG_SWITCH_FAILED_MESSAGE = 'Could not switch organisation. Try again.';
  let orgState = { orgs: [], activeOrgId: null, onSelect: null };
  let orgSelect = null;
  let orgSwitching = false;

  const refusalOpen = () => orgNoticeEl.classList.contains('app-shell-org-notice-open');
  // Only a REFUSAL is ever cleared by the person moving on (Escape, leaving the control, tapping
  // anywhere): the quiet announcement must survive the focus moves a switch itself causes, since the
  // new screen takes focus within milliseconds of the announcement being written.
  function clearRefusal() {
    if (!refusalOpen()) return;
    orgNoticeEl.classList.remove('app-shell-org-notice-open');
    orgNoticeEl.textContent = '';
    document.removeEventListener('pointerdown', onRefusalPointerDown);
    document.removeEventListener('keydown', onRefusalKeyDown);
    const onDismiss = noticeOnDismiss;
    noticeOnDismiss = null;
    noticeKeepOpenFor = null;
    delete orgNoticeEl.dataset.tone;
    onDismiss?.();
  }
  // Any tap or click dismisses it: a touch browser may not blur a select when the person taps empty
  // page, and on a phone the panel can sit over the page heading. (Except on the control it is about.)
  function onRefusalPointerDown(event) {
    if (noticeKeepOpenFor?.contains(event.target)) return;
    clearRefusal();
  }
  // And Escape, wherever focus is: a keyboard or switch user must be able to put it away (it overlays the
  // top of the page, where the focused heading is).
  function onRefusalKeyDown(event) {
    if (event.key === 'Escape') clearRefusal();
  }
  // A notice the person must see (and a screen reader hears): the overlay opens under the header, in
  // the place the sync detail uses, so that one closes. A refusal to switch organisation, and the
  // warning before signing out with changes that have not synced.
  function showOrganisationNotice(
    text,
    { onDismiss = null, keepOpenFor = null, tone = null } = {},
  ) {
    clearRefusal();
    setDetailOpen(false);
    orgNoticeEl.textContent = text;
    // 'info': something that happened, not something that went wrong (the border is not the error colour).
    if (tone) orgNoticeEl.dataset.tone = tone;
    orgNoticeEl.classList.add('app-shell-org-notice-open');
    noticeOnDismiss = onDismiss;
    noticeKeepOpenFor = keepOpenFor;
    document.addEventListener('pointerdown', onRefusalPointerDown);
    document.addEventListener('keydown', onRefusalKeyDown);
  }
  // Heard, not shown: the visible change is the name in the header and the screen underneath.
  function announceOrganisation(text) {
    clearRefusal();
    orgNoticeEl.textContent = text;
  }

  // A native select switches the moment its value changes (arrow keys included), which WCAG 3.2.2
  // (On Input) allows only if the person is told beforehand: the description is read with the control.
  // `hidden`: browse mode does not read it a second time, while aria-describedby still does.
  const orgHint = el('span', {
    id: 'app-shell-org-hint',
    text: 'Choosing another organisation switches to it straight away.',
    attrs: { hidden: '' },
  });

  function buildOrgSelect() {
    const select = el('select', {
      className: 'app-shell-org-select',
      attrs: { 'aria-label': 'Organisation', 'aria-describedby': 'app-shell-org-hint' },
    });
    select.addEventListener('change', async () => {
      const chosen = select.value;
      // A second choice while the first is being decided, or a re-pick of the current one: ignore
      // (and leave whatever is on show alone).
      if (orgSwitching || chosen === orgState.activeOrgId) {
        select.value = orgState.activeOrgId ?? '';
        return;
      }
      clearRefusal();
      orgSwitching = true;
      // aria-disabled, not disabled: a native disabled control loses focus.
      setBusyDisabled(select, true);
      let result;
      try {
        // Bounded: a hung check on the caller's side must not leave this control dead.
        result = await raceTimeout(
          Promise.resolve(orgState.onSelect?.(chosen)),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
      } catch {
        result = { ok: false, message: ORG_SWITCH_FAILED_MESSAGE };
      }
      orgSwitching = false;
      setBusyDisabled(select, false);
      // Taken away while the answer was on its way (signed out, or no organisations left): there is
      // nothing left to refuse on, and a panel must not open over the screen that replaced this one.
      if (!select.isConnected) return;
      if (!result?.ok) {
        // Nothing changed: put the control back on what is true, and say why. Focus never left it.
        select.value = orgState.activeOrgId ?? '';
        showOrganisationNotice(result?.message || ORG_SWITCH_FAILED_MESSAGE);
      }
      // On success main.js calls setOrganisation() with the new active organisation, and the console
      // re-mounts: the new screen focuses its own loading region and then its heading, as after any
      // navigation (so focus does NOT stay here after a successful switch; the live region announces
      // the change). A refusal re-mounts nothing, so there focus stays on this control.
    });
    // Escape closes a refusal (the native picker handles its own Escape); leaving the control means the
    // person has moved on. Neither touches a quiet announcement.
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') clearRefusal();
    });
    select.addEventListener('blur', clearRefusal);
    return select;
  }

  // Expects organisations as `{ id, name, slug }`.
  function renderOrganisation() {
    const { orgs, activeOrgId } = orgState;
    if (orgs.length === 0) {
      // Whatever refusal was showing belonged to a control that is going away.
      clearRefusal();
      orgEl.hidden = true;
      orgFullEl.hidden = true;
      orgEl.replaceChildren();
      return;
    }
    const active = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
    const activeLabel = orgLabel(active, orgs);
    orgEl.hidden = false;
    orgFullEl.hidden = false;
    orgFullEl.textContent = `Organisation: ${activeLabel}`;
    if (orgs.length === 1) {
      clearRefusal();
      orgEl.replaceChildren(
        // `title`: the full name for a pointer user when the label is truncated (it does nothing on touch).
        el('span', { className: 'app-shell-org-label', attrs: { title: activeLabel } }, [
          el('span', { className: 'sr-only', text: 'Organisation: ' }),
          document.createTextNode(activeLabel),
        ]),
      );
      return;
    }
    // One select for the life of the shell: replacing it would drop the focus a keyboard user is on.
    orgSelect ??= buildOrgSelect();
    const labels = orgs.map((org) => orgLabel(org, orgs));
    // Rebuilt only when the list really changed: replacing the options of an open picker collapses it.
    const unchanged =
      orgSelect.options.length === orgs.length &&
      orgs.every(
        (org, i) =>
          orgSelect.options[i].value === org.id && orgSelect.options[i].textContent === labels[i],
      );
    if (!unchanged) {
      orgSelect.replaceChildren(
        ...orgs.map((org, i) => el('option', { text: labels[i], attrs: { value: org.id } })),
      );
    }
    // While a choice is being decided the select shows that choice: do not flick it back.
    if (!orgSwitching && orgSelect.value !== active.id) orgSelect.value = active.id;
    orgSelect.title = activeLabel;
    if (orgEl.firstChild !== orgSelect) orgEl.replaceChildren(orgSelect, orgHint);
  }

  // Tell the shell which organisations the signed-in person belongs to and which is active
  // (an empty list hides the slot). `onSelect(orgId)` resolves to `{ ok, message }`: a refusal
  // puts the control back and shows the message.
  function setOrganisation({ orgs = [], activeOrgId = null, onSelect = null } = {}) {
    orgState = { orgs, activeOrgId, onSelect };
    renderOrganisation();
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
      linkEl.addEventListener('click', () => closeMenu());
      navEl.appendChild(linkEl);
    }

    syncHeaderHeightVar();

    if (!eventId) {
      cachedEventId = null;
      breadcrumbEl.textContent = '';
      updateContextRow();
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
    updateContextRow();
  }

  refreshSync(); // first paint — don't wait for the first SYNC_POLL_MS tick

  return {
    outlet,
    setNav,
    setOrganisation,
    announceOrganisation,
    // A notice the person can see (until they tap elsewhere) and a screen reader hears, that is not an
    // error: "Now working in …, the organisation this event belongs to." (main.js, T-TEN.C7).
    showNotice: (text) => showOrganisationNotice(text, { tone: 'info' }),
    // Puts away whatever notice is open (main.js, when the person moves to another screen: a notice must
    // not outlive the screen it explains).
    dismissNotice: clearRefusal,
    // The header names no event any more (a card that is not an event's screen has replaced it): the same
    // as setNav without an event, without touching the links.
    clearEventContext() {
      cachedEventId = null;
      breadcrumbEl.textContent = '';
      updateContextRow();
      refreshSync();
    },
    unmount() {
      unmounted = true;
      headerResizeObserver?.disconnect();
      if (inlineNavQuery) {
        document.removeEventListener('focusin', trackHeaderFocus);
        document.removeEventListener('pointerdown', forgetHeaderFocus);
        inlineNavQuery.removeEventListener('change', onNavLayoutChange);
      }
      clearInterval(syncIntervalId);
      setDetailOpen(false);
      clearRefusal();
      stopListeningForDrops();
      clearTimeout(dropCheckTimer);
      authSubscription.unsubscribe();
      root.innerHTML = '';
    },
  };
}
