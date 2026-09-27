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
import { isFlushInProgress, listPendingOperations, onOperationDropped } from './outbox.js';
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
  // Found missing entirely in a live production check — this whole shell
  // rendered a text-only wordmark, no mark/logo anywhere. Ported from the
  // legacy Seduh-Score repo (see brandMark()'s own comment in dom.js).
  const markEl = el('span', { className: 'app-shell-mark', attrs: { 'aria-hidden': 'true' } }, [
    brandMark(),
  ]);
  const nameEl = el('p', { className: 'app-shell-name', text: appName });
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
    [markEl, nameEl],
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
  // (one row: mark, name, hamburger), and revealed together with the nav
  // links once the menu opens. `navPanel` itself is never recreated (only
  // navEl's own children, on every setNav()) — same persistent-node
  // reasoning the toggle below already relied on for `navEl`.
  const navPanel = el('div', { className: 'app-shell-nav-panel', id: 'app-shell-nav-panel' }, [
    navEl,
    authEl,
  ]);
  // Mobile hamburger toggle (production UI/UX feedback, 2026-09-05):
  // below the CSS breakpoint, `.app-shell-nav-panel` collapses to nothing
  // by default — without a toggle, several nav links plus the auth control
  // used to force the header onto 2-3 wrapped rows before any real screen
  // content appeared.
  const navToggle = el('button', {
    className: 'app-shell-nav-toggle tap-target',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'app-shell-nav-panel',
      'aria-label': 'Menu',
    },
  });
  navToggle.append(
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'app-shell-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
  );
  // Shared by every "the menu should close now" trigger below — a nav link
  // tap, Sign out, Escape. Kept as one function (found worth factoring in
  // review, code-reviewer/ui-accessibility-reviewer, 2026-09-06) once
  // `authEl` moved into this same panel alongside the nav links: two
  // different KINDS of control now live in one collapsible unit, and each
  // needs the identical close side effect, not just the one link-click
  // case this used to be inlined for.
  function closeMenu() {
    navPanel.classList.remove('app-shell-nav-panel-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
  navToggle.addEventListener('click', () => {
    const open = navPanel.classList.toggle('app-shell-nav-panel-open');
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
  // The status gets its own full-width header row, sized for the tallest
  // notice (see .app-shell-sync-row in appShell.css) and present whenever
  // there's anything to report — so "Synced" turning into a two-line
  // "N writes lost…" pill never grows the sticky header mid-heat and pushes
  // the Stop buttons out from under a judge's finger
  // (ui-accessibility-reviewer, 2026-09-27).
  const syncRow = el('div', { className: 'app-shell-sync-row' }, [syncEl]);
  const header = el('header', { className: 'app-shell-header' }, [
    brandEl,
    breadcrumbEl,
    navToggle,
    navPanel,
    syncRow,
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
      // Re-triggers the router (requireAuth finds no session and shows
      // the login screen) — no extra plumbing needed between this shell
      // and main.js's own routing. User-reported, 2026-09-09: signing out
      // while ALREADY on #/events (a common case, e.g. the organiser
      // landed there first) left the stale, still-rendered screen on
      // screen indefinitely, needing a manual refresh — `location.hash =
      // path` is a no-op when `path` already equals the current hash, so
      // no `hashchange` event ever fires and router.js's own listener
      // (`() => resolve(currentPath())`) never runs. Dispatching a
      // synthetic `hashchange` unconditionally, after the assignment,
      // forces the router to re-resolve regardless of whether the hash
      // value actually changed — the listener only reads `location.hash`
      // fresh via `currentPath()`, never anything off the event itself, so
      // a plain `Event` (no `oldURL`/`newURL`) is sufficient.
      location.hash = '#/events';
      window.dispatchEvent(new Event('hashchange'));
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
  // Rendered once when a drop lands while the panel reads "Synced"/"off" —
  // see the drop listener above. No count: the dropped operation is already
  // gone from the queue, and the real count follows when the pass ends.
  function showNotSyncedWhileHolding() {
    syncRow.classList.add('app-shell-sync-row-active');
    syncEl.className = 'app-shell-sync app-shell-sync-stuck';
    syncEl.textContent = 'Not synced';
    lastSyncKey = 'holding';
    lastSyncStatus = 'holding';
    syncHeaderHeightVar();
  }
  function renderSync(state) {
    // Row reserved exactly while there's something to show — 'off' (no
    // event context, nothing pending or lost) takes no space. Not keyed on
    // the event context: a loss on the events list must show too. Only
    // navigation, or a write queued, lost or drained off an event screen,
    // moves it in or out — never a write on the timing/scoring screens,
    // which always have an event context and so are never 'off'.
    syncRow.classList.toggle('app-shell-sync-row-active', state.status !== 'off');
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
      // combination stays within the status row's reserved two lines at
      // 360px, including at 130% text size or with a fallback font
      // (ui-accessibility-reviewer, 2026-09-27).
      const stuckLabel = state.stuckOperation && operationLabels[state.stuckOperation.type];
      syncEl.textContent = state.stuckOperation
        ? `${lost} lost, not retried; ${stuckLabel ? `${stuckLabel} failed` : 'retrying failed'}`
        : `${lost} lost — not saved and not retried`;
    } else if (state.stuckOperation) {
      syncEl.classList.add('app-shell-sync-stuck');
      const label = operationLabels[state.stuckOperation.type];
      syncEl.textContent = label
        ? `Not synced — ${label} failed (${state.pendingCount} pending)`
        : `Not synced — retrying failed (${state.pendingCount} pending)`;
    } else {
      syncEl.classList.add('app-shell-sync-pending');
      syncEl.textContent = `Not synced (${state.pendingCount} pending)`;
    }
  }

  async function refreshSync() {
    // Held while a drop is unannounced — see the drop listener above.
    if (hasUnannouncedDrops()) return;
    // A failed IndexedDB read keeps the panel's last state rather than
    // throwing an unhandled rejection on every poll tick (found in review:
    // code-reviewer, 2026-09-26).
    let operations;
    try {
      operations = await listPendingOperations();
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
    // A drop can land during that read — its operation is already missing
    // from `operations`, so rendering them now would under-report.
    if (hasUnannouncedDrops()) return;
    const state = computeSyncState({
      enabled: cachedEventId != null,
      operations,
      lastFlushError,
    });
    // Skip re-rendering (and re-announcing via aria-live) when nothing
    // actually changed since the last poll — found in review: without this,
    // every 3s tick would re-mutate syncEl even while idle at "live",
    // spamming an aria-live announcement for no real change.
    const pendingPart = state.lastFlushError ? '' : state.pendingCount;
    const key = `${state.status}:${pendingPart}:${state.stuckOperation?.type ?? ''}:${state.stuckOperation?.id ?? ''}:${state.lastFlushError ? lostWriteCount : 0}`;
    if (key === lastSyncKey) return;
    lastSyncKey = key;
    lastSyncStatus = state.status;
    lastRenderedLostCount = state.lastFlushError ? lostWriteCount : 0;
    renderSync(state);
    // The status row's reserved height absorbs text changes, but the row
    // appearing or disappearing ('off' <-> anything else) and extreme text
    // sizes still change the header's height — keep the sticky-header offset
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
    unmount() {
      clearInterval(syncIntervalId);
      stopListeningForDrops();
      clearTimeout(dropCheckTimer);
      authSubscription.unsubscribe();
      root.innerHTML = '';
    },
  };
}
