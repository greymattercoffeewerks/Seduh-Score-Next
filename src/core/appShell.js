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
import { el } from './dom.js';
import { findEvent } from './events.js';
import { getSupabase } from './supabaseClient.js';

const APP_NAME = 'Seduh Score';

export function mountAppShell(root, { appName = APP_NAME, client = getSupabase() } = {}) {
  root.innerHTML = '';

  // Not an <h1> — every routed screen already owns the page's real <h1>
  // (its own heading, e.g. "Events", "October Cup"), so a second one here
  // would give every organiser page two level-1 headings. This is brand
  // text inside the <header> landmark, not a content heading — unlike
  // viewer-shell.js's own renderChrome() identity name, which IS a real
  // <h1> deliberately, because there's no separate routed screen heading
  // competing with it on that audience-facing surface.
  const nameEl = el('p', { className: 'app-shell-name', text: appName });
  const breadcrumbEl = el('span', { className: 'app-shell-breadcrumb' });
  const navEl = el('nav', { className: 'app-shell-nav', attrs: { 'aria-label': 'Sections' } });
  const authEl = el('div', { className: 'app-shell-auth' });
  const header = el('header', { className: 'app-shell-header' }, [
    nameEl,
    breadcrumbEl,
    navEl,
    authEl,
  ]);
  const outlet = el('main', { className: 'app-shell-outlet' });

  root.append(header, outlet);

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

  async function setNav({ eventId = null, links = [] } = {}) {
    navEl.innerHTML = '';
    for (const link of links) {
      navEl.appendChild(
        el('a', {
          className: link.active ? 'app-shell-link app-shell-link-active' : 'app-shell-link',
          text: link.label,
          attrs: { href: link.href },
        }),
      );
    }

    if (!eventId) {
      cachedEventId = null;
      breadcrumbEl.textContent = '';
      return;
    }
    if (eventId === cachedEventId) return;
    cachedEventId = eventId;
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

  return {
    outlet,
    setNav,
    unmount() {
      authSubscription.unsubscribe();
      root.innerHTML = '';
    },
  };
}
