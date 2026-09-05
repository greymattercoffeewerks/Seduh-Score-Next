import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountAppShell } from './appShell.js';
import { _clearAllForTests, outboxPut } from './db.js';
import { enqueueOperation } from './outbox.js';
import { APP_VERSION, NAMEPLATE } from './version.js';

// Every fake client needs a minimal auth shape now — mountAppShell's own
// "signed in as X / sign out" control subscribes via
// client.auth.onAuthStateChange on every mount (see that file's own
// comment for why: reactive, not a one-time fetch).
function fakeAuth() {
  return {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signOut: vi.fn(),
  };
}

function fakeClient(eventsById) {
  const calls = [];
  return {
    calls,
    auth: fakeAuth(),
    from(table) {
      return {
        select: () => ({
          eq: (col, val) => {
            calls.push([table, col, val]);
            return {
              single: () => Promise.resolve({ data: eventsById[val] ?? null, error: null }),
            };
          },
        }),
      };
    },
  };
}

describe('mountAppShell', () => {
  it('renders the app name and an empty outlet', () => {
    const root = document.createElement('div');
    const { outlet } = mountAppShell(root, { client: fakeClient({}) });
    expect(root.querySelector('.app-shell-name').textContent).toBe('Seduh Score');
    expect(outlet.className).toBe('app-shell-outlet');
    expect(root.contains(outlet)).toBe(true);
  });

  it('an explicit appName overrides the default', () => {
    const root = document.createElement('div');
    mountAppShell(root, { appName: 'Custom', client: fakeClient({}) });
    expect(root.querySelector('.app-shell-name').textContent).toBe('Custom');
  });

  it('renders a footer with the app name, nameplate, and version — for quick, glance-based bug-report verification (CONVENTIONS.md "Versioning")', () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    const appName = root.querySelector('.app-shell-name').textContent;
    const footer = root.querySelector('.app-shell-footer');
    expect(footer).not.toBeNull();
    // The version link's accessible name carries a sr-only suffix (see the
    // dedicated link tests below), so a plain exact-match on the whole
    // footer's textContent would also have to reproduce that suffix here —
    // asserting the visible text nodes specifically keeps this test about
    // what a sighted user actually reads.
    expect(footer.childNodes[0].textContent).toBe(`${appName} · ${NAMEPLATE} · `);
    expect(footer.querySelector('.app-shell-footer-link').childNodes[0].textContent).toBe(
      `v${APP_VERSION}`,
    );
  });

  it('an explicit appName also flows into the footer, not just the header name', () => {
    const root = document.createElement('div');
    mountAppShell(root, { appName: 'Custom', client: fakeClient({}) });
    expect(root.querySelector('.app-shell-footer').childNodes[0].textContent).toBe(
      `Custom · ${NAMEPLATE} · `,
    );
  });

  it('the footer version links to /bts/index.html, opening in a new tab so the organiser never loses their current screen just to read a credits page', () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    const link = root.querySelector('.app-shell-footer-link');
    expect(link.tagName).toBe('A');
    // The full filename, not just "/bts/" — verified live in a real browser:
    // this app's SPA fallback claims any path without an exact file match,
    // so the trailing-slash form silently served the login screen instead.
    expect(link.getAttribute('href')).toBe('/bts/index.html');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it("the footer version link's accessible name warns of the context change — a screen reader user gets no other signal that this link opens a new tab, matching this shell's own openInNewTab nav-link precedent", () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    const link = root.querySelector('.app-shell-footer-link');
    // Visible text stays exactly the version — the warning is sr-only, not
    // stuffed into what a sighted user reads.
    expect(link.childNodes[0].textContent).toBe(`v${APP_VERSION}`);
    expect(link.querySelector('.sr-only').textContent).toBe(
      ' — Behind the Seduh (opens in a new tab)',
    );
  });

  it('setNav({links}) renders exactly those links, with hrefs and active state', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [
        { label: 'Setup', href: '#/events/ev1/setup' },
        { label: 'Roster', href: '#/events/ev1/roster', active: true },
      ],
    });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('Setup');
    expect(links[0].getAttribute('href')).toBe('#/events/ev1/setup');
    expect(links[0].className).toBe('app-shell-link');
    expect(links[1].className).toContain('app-shell-link-active');
  });

  it('marks the active link with aria-current="page", the inactive link with no aria-current at all — found in the holistic-pass review: the active state was only ever a visual (bold/underline) signal', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [
        { label: 'Setup', href: '#/events/ev1/setup' },
        { label: 'Roster', href: '#/events/ev1/roster', active: true },
      ],
    });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links[0].hasAttribute('aria-current')).toBe(false);
    expect(links[1].getAttribute('aria-current')).toBe('page');
  });

  it("clicking a shell nav link blurs it — found in the holistic-pass review: unlike a link inside a routed screen (removed by the next screen's own root.innerHTML wipe), this link is never removed across a navigation, so router.js's own activeElement===document.body post-navigation focus fallback would otherwise never fire", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ links: [{ label: 'Events', href: '#/events' }] });
    const link = root.querySelector('.app-shell-link');
    link.focus();
    expect(document.activeElement).toBe(link);
    link.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(link);
  });

  it('renders the brand mark alongside the app name, hidden from assistive tech (the visible text already carries the same information)', () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    const mark = root.querySelector('.app-shell-mark');
    expect(mark).not.toBeNull();
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('svg')).not.toBeNull();
  });

  it('a link with openInNewTab opens in a new tab (target=_blank, rel=noopener) and is never marked aria-current, even if also flagged active', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      // active: true too — found in review (test-auditor): no real caller
      // combines these two flags today, but this test's own name claims
      // the interaction is covered, and until this assertion existed it
      // wasn't (the code didn't guard it either — see appShell.js's own
      // aria-current line).
      links: [
        { label: 'Audience view', href: '#/live/projector', openInNewTab: true, active: true },
      ],
    });
    const link = root.querySelector('.app-shell-link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.hasAttribute('aria-current')).toBe(false);
  });

  it("an openInNewTab link's accessible name warns of the context change, not just its visible label — a screen reader user gets no other signal that this link behaves differently (opens a new tab) than every other nav link", async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [{ label: 'Audience — projector', href: '#/live/projector', openInNewTab: true }],
    });
    const link = root.querySelector('.app-shell-link');
    // Visible text stays exactly the label — the warning is sr-only, not
    // stuffed into what a sighted user reads.
    expect(link.querySelector('.sr-only').textContent.trim()).toBe('(opens in a new tab)');
    // The accessible name (what a screen reader announces) includes both —
    // this is the actual assertion that matters here.
    expect(link.textContent).toBe('Audience — projector (opens in a new tab)');
  });

  it("clicking an openInNewTab link does NOT blur it — this tab never navigates away, so there's no reason to strand a keyboard user's place", async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({
      links: [{ label: 'Audience view', href: '#/live/projector', openInNewTab: true }],
    });
    const link = root.querySelector('.app-shell-link');
    link.focus();
    expect(document.activeElement).toBe(link);
    link.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(link);
    document.body.removeChild(root);
  });

  it("keeps --app-shell-header-height on root in sync with the header's own real rendered height, on every setNav() call — the sticky header (found in the same production-feedback pass) needs this for scroll-margin-top to actually compensate for its own occlusion", async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    const header = root.querySelector('.app-shell-header');
    // jsdom never performs real layout, so getBoundingClientRect() always
    // reports 0 — stubbed here to prove the write-through logic itself,
    // independent of that jsdom limitation (see the guard's own comment).
    header.getBoundingClientRect = () => ({ height: 72 });
    await setNav({ links: [{ label: 'Events', href: '#/events', active: true }] });
    expect(root.style.getPropertyValue('--app-shell-header-height')).toBe('72px');
  });

  it('never sets --app-shell-header-height to a meaningless 0 (e.g. jsdom, or any layout-less environment) — leaves the CSS fallback in place instead', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    // No stub — real jsdom always reports height 0 here.
    await setNav({ links: [{ label: 'Events', href: '#/events', active: true }] });
    expect(root.style.getPropertyValue('--app-shell-header-height')).toBe('');
  });

  describe('mobile nav toggle', () => {
    it('renders a closed hamburger toggle wired to the nav via aria-controls, and the nav starts collapsed', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(nav.id);
      expect(nav.classList.contains('app-shell-nav-open')).toBe(false);
    });

    it('clicking the toggle opens the nav and flips aria-expanded; clicking again closes it', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(nav.classList.contains('app-shell-nav-open')).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(nav.classList.contains('app-shell-nav-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('clicking a nav link closes an open mobile menu, including an openInNewTab link', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { setNav } = mountAppShell(root, { client: fakeClient({}) });
      await setNav({
        links: [
          { label: 'Events', href: '#/events' },
          { label: 'Projector view', href: '#/live/projector', openInNewTab: true },
        ],
      });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(nav.classList.contains('app-shell-nav-open')).toBe(true);

      const newTabLink = [...root.querySelectorAll('.app-shell-link')].find((l) =>
        l.textContent.startsWith('Projector view'),
      );
      newTabLink.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

      expect(nav.classList.contains('app-shell-nav-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      document.body.removeChild(root);
    });

    it('pressing Escape on the toggle closes an open menu and returns focus to the toggle', () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(nav.classList.contains('app-shell-nav-open')).toBe(true);

      toggle.focus();
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(nav.classList.contains('app-shell-nav-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
      document.body.removeChild(root);
    });

    it('Escape is a no-op while the menu is already closed', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');

      expect(() =>
        toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ).not.toThrow();
      expect(nav.classList.contains('app-shell-nav-open')).toBe(false);
    });

    it('the open/closed state survives a setNav() re-render (navEl itself is never recreated)', async () => {
      const root = document.createElement('div');
      const { setNav } = mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const nav = root.querySelector('.app-shell-nav');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(nav.classList.contains('app-shell-nav-open')).toBe(true);

      await setNav({ links: [{ label: 'Events', href: '#/events' }] });
      expect(nav.classList.contains('app-shell-nav-open')).toBe(true);
    });
  });

  it('a second setNav call replaces the previous links rather than appending', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ links: [{ label: 'A', href: '#/a' }] });
    await setNav({ links: [{ label: 'B', href: '#/b' }] });
    const links = [...root.querySelectorAll('.app-shell-link')];
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('B');
  });

  it('setNav({eventId}) resolves the event name via one findEvent call and renders it as the breadcrumb', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('October Cup');
    expect(client.calls.filter(([table]) => table === 'events')).toHaveLength(1);
  });

  it('a second setNav call with the SAME eventId does not refetch', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    await setNav({ eventId: 'ev1', links: [{ label: 'X', href: '#/x' }] });
    expect(client.calls.filter(([table]) => table === 'events')).toHaveLength(1);
    // Links still update even though the event fetch was skipped.
    expect(root.querySelector('.app-shell-link').textContent).toBe('X');
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('October Cup');
  });

  it('omitting eventId clears the breadcrumb and resets the cache', async () => {
    const client = fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    await setNav({ links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
  });

  it('a findEvent failure clears the breadcrumb rather than leaving stale/error text', async () => {
    const client = {
      auth: fakeAuth(),
      from: () => ({
        select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('boom')) }) }),
      }),
    };
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });
    await setNav({ eventId: 'ev1', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
  });

  it('unmount() clears the shell DOM', () => {
    const root = document.createElement('div');
    const { unmount } = mountAppShell(root, { client: fakeClient({}) });
    expect(root.children.length).toBeGreaterThan(0);
    unmount();
    expect(root.children.length).toBe(0);
  });

  function fakeAuthWithTrigger() {
    let listener = null;
    const unsubscribe = vi.fn();
    return {
      auth: {
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        onAuthStateChange: (cb) => {
          listener = cb;
          return { data: { subscription: { unsubscribe } } };
        },
      },
      unsubscribe,
      trigger(session) {
        listener?.('SIGNED_IN', session);
      },
    };
  }

  describe('the temporary sign-in/sign-out control', () => {
    it('renders nothing while signed out', () => {
      const root = document.createElement('div');
      const { auth } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      expect(root.querySelector('.app-shell-auth').children).toHaveLength(0);
    });

    it('shows the signed-in email and a Sign out button once a session appears — reactive, not a one-time fetch (the shell mounts before a sign-in can possibly have happened yet)', () => {
      const root = document.createElement('div');
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });

      trigger({ user: { email: 'organiser@local.test' } });

      expect(root.querySelector('.app-shell-auth-email').textContent).toBe('organiser@local.test');
      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      expect(signOutButton).not.toBeUndefined();
    });

    it('clicking Sign out calls client.auth.signOut() and navigates to #/events', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      trigger({ user: { email: 'organiser@local.test' } });
      location.hash = '#/events/ev1/setup';

      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      signOutButton.dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(location.hash).toBe('#/events');
    });

    it('unmount() unsubscribes from the auth-state listener', () => {
      const root = document.createElement('div');
      const { auth, unsubscribe } = fakeAuthWithTrigger();
      const { unmount } = mountAppShell(root, { client: { auth, from: () => ({}) } });
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  it('a slower-resolving setNav call for a since-superseded eventId does not clobber a faster, later one', async () => {
    // Same staleness discipline as core/viewer-shell.js's own requestSeq
    // guard: event A's findEvent call is deliberately delayed past event
    // B's, so B's breadcrumb must survive A's late arrival.
    let resolveA;
    const client = {
      calls: [],
      auth: fakeAuth(),
      from() {
        return {
          select: () => ({
            eq: (col, val) => ({
              single: () => {
                if (val === 'evA') {
                  return new Promise((resolve) => {
                    resolveA = () =>
                      resolve({ data: { id: 'evA', name: 'Slow Event' }, error: null });
                  });
                }
                return Promise.resolve({ data: { id: 'evB', name: 'Fast Event' }, error: null });
              },
            }),
          }),
        };
      },
    };
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client });

    const pendingA = setNav({ eventId: 'evA', links: [] });
    await setNav({ eventId: 'evB', links: [] });
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('Fast Event');

    resolveA();
    await pendingA;
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('Fast Event');
  });
});

// §8.4/T3.3's own AC: "three-state sync panel on the organiser device: off /
// live / not synced." Regression coverage for the Phase 6 offline-soak
// finding that computeSyncState() (syncState.js) had this logic fully built
// and tested, but zero UI consumers anywhere in the app.
describe('mountAppShell — sync panel', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  // A real, short wait — not vi.useFakeTimers(): fake-indexeddb schedules
  // its own callback resolution in a way that doesn't fire under faked
  // timers, so any IndexedDB op performed while timers are faked just hangs
  // (found writing this suite). Real time, kept small via mountAppShell's
  // own syncPollMs test-only override below, is the reliable choice here.
  // A non-zero default — refreshSync() is fired-and-forgotten from inside
  // setNav (never awaited there, so awaiting setNav itself doesn't
  // guarantee its own internal IndexedDB read has resolved yet); a single
  // 0ms macrotask tick wasn't reliably enough (found writing this suite).
  function tick(ms = 10) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('renders nothing ("off") with no event context and no pending operations', async () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    await tick(); // let the mount-time refreshSync() settle
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('');
    expect(syncEl.className).toBe('app-shell-sync');
  });

  it('shows "Synced" once an event is set with nothing pending', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');
    expect(syncEl.classList.contains('app-shell-sync-live')).toBe(true);
    expect(syncEl.querySelector('.status-live-dot')).not.toBeNull();
  });

  it('shows the pending count as "not synced" once an operation is queued', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(true);
  });

  it('escalates to the distinct "retrying failed" styling once an operation has a real attempt on record (a poison operation, not just in-flight)', async () => {
    const op = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await outboxPut({ ...op, attempts: 1, lastError: 'stale conflict' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced — retrying failed (1 pending)');
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(false);
  });

  it('fail-open: a pending operation still reports "not synced", never "off", even with no current event context — computeSyncState()\'s own guarantee, this caller must not accidentally suppress it', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) }); // no setNav call at all — cachedEventId stays null
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
  });

  it('picks up a change on its own poll cycle, without requiring another setNav call', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');

    // Enqueued directly against the outbox — nothing tells the shell about
    // this new operation except its own poll.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(60); // > syncPollMs, so at least one poll tick has fired
    expect(syncEl.textContent).toBe('Not synced (1 pending)');
  });

  it('unmount() stops the poll — a leaked interval would keep reading IndexedDB (and touching a detached DOM node) forever', async () => {
    const root = document.createElement('div');
    const { setNav, unmount } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');
    unmount();

    // Enqueued AFTER unmount — if the interval weren't really cleared, a
    // later poll tick would eventually reflect this. Waiting past several
    // poll intervals and asserting NOTHING changed proves the timer is
    // actually gone, not just that clearInterval() was called.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(80);
    expect(syncEl.textContent).toBe('Synced');
  });

  // reportFlushError() — found in review (offline-sync-auditor): main.js's
  // own sync-on-reconnect trigger has no screen watching its flush result,
  // unlike every other flush call site. Without a way to surface a genuine
  // conflict here, a permanently-failed (and therefore removed-from-the-
  // queue) operation left the very next poll seeing zero pending operations
  // and reporting "Synced" — a false all-clear for a write that was
  // actually discarded, exactly the "conflict silently resolved" failure
  // mode §9 exists to prevent.
  it('reportFlushError() surfaces a permanently-failed write even with zero pending operations, instead of falsely reporting "Synced"', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    const syncEl = root.querySelector('.app-shell-sync');
    expect(syncEl.textContent).toBe('Synced');

    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(syncEl.textContent).toBe('Not synced — a write failed to save and was not retried');
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
  });

  it('reportFlushError(null) clears a previously-reported error once a later attempt succeeds', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      'Not synced — a write failed to save and was not retried',
    );

    reportFlushError(null);
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced');
  });

  it('fail-open also covers a reported flush error: it still reports "not synced", never "off", with no current event context', async () => {
    const root = document.createElement('div');
    const { reportFlushError } = mountAppShell(root, { client: fakeClient({}) }); // no setNav — cachedEventId stays null
    reportFlushError(new Error('stale conflict'));
    await tick();
    expect(root.querySelector('.app-shell-sync').textContent).toBe(
      'Not synced — a write failed to save and was not retried',
    );
  });

  it('a genuinely pending operation takes priority over a stale reported flush error in the displayed text — the "N pending" case is the more actionable one', async () => {
    const root = document.createElement('div');
    const { setNav, reportFlushError } = mountAppShell(root, {
      client: fakeClient({}),
      syncPollMs: 20,
    });
    await setNav({ eventId: 'ev1', links: [] });
    await tick();
    reportFlushError(new Error('stale conflict'));
    await tick();
    // Enqueued directly, same as the "picks up a change on its own poll
    // cycle" test above — nothing calls refreshSync() directly here, only
    // the poll itself observes it.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(60); // > syncPollMs, so at least one poll tick has fired
    // Not the zero-pending "a write failed to save" wording — a real
    // operation is sitting in the queue now, so the ordinary pending count
    // is what's actionable (it hasn't even had a failed attempt of its
    // own yet — attempts starts at 0 on enqueue).
    expect(root.querySelector('.app-shell-sync').textContent).toBe('Not synced (1 pending)');
  });
});
