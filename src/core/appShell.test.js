import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountAppShell } from './appShell.js';
import { _clearAllForTests, outboxPut } from './db.js';
import { enqueueOperation, flushOutbox } from './outbox.js';
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

// The lost-write notice survives a reload via sessionStorage — no test may
// inherit another's losses, in any describe block.
beforeEach(() => {
  sessionStorage.clear();
});

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

  it('wraps the icon and wordmark in one link to the public home page, so an organiser can always leave the /app/ shell', () => {
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) });
    const brand = root.querySelector('.app-shell-brand');
    expect(brand.tagName).toBe('A');
    expect(brand.getAttribute('href')).toBe('/');
    expect(brand.getAttribute('aria-label')).toBe('Seduh Score home');
    expect(brand.querySelector('.app-shell-mark')).not.toBeNull();
    expect(brand.querySelector('.app-shell-name').textContent).toBe('Seduh Score');
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

  it('re-measures --app-shell-header-height whenever the header itself resizes (menu opened, window resized, tablet rotated) — not only on setNav() — and stops observing on unmount', () => {
    const observers = [];
    class FakeResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        observers.push(this);
      }
      observe(node) {
        this.observed.push(node);
      }
      disconnect() {
        this.disconnected = true;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const root = document.createElement('div');
      const { unmount } = mountAppShell(root, { client: fakeClient({}) });
      const header = root.querySelector('.app-shell-header');
      expect(observers).toHaveLength(1);
      expect(observers[0].observed).toEqual([header]);

      header.getBoundingClientRect = () => ({ height: 240 });
      observers[0].callback();
      expect(root.style.getPropertyValue('--app-shell-header-height')).toBe('240px');

      unmount();
      expect(observers[0].disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('mobile nav toggle', () => {
    it('renders a closed hamburger toggle wired to the nav panel via aria-controls, and the panel starts collapsed', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
    });

    it('clicking the toggle opens the panel and flips aria-expanded; clicking again closes it', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
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
      const panel = root.querySelector('.app-shell-nav-panel');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);

      const newTabLink = [...root.querySelectorAll('.app-shell-link')].find((l) =>
        l.textContent.startsWith('Projector view'),
      );
      newTabLink.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      document.body.removeChild(root);
    });

    it('pressing Escape on the toggle closes an open menu and returns focus to the toggle', () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);

      toggle.focus();
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
      document.body.removeChild(root);
    });

    it('Escape is a no-op while the menu is already closed', () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');

      expect(() =>
        toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ).not.toThrow();
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
    });

    it("pressing Escape from a nav link INSIDE the open panel also closes it and returns focus to the toggle — found in review, 2026-09-06: the toggle's own Escape listener only ever covered focus still sitting ON the toggle, not focus a keyboard user has already Tabbed forward into the panel's own contents", async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { setNav } = mountAppShell(root, { client: fakeClient({}) });
      await setNav({ links: [{ label: 'Events', href: '#/events' }] });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');

      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);

      const link = root.querySelector('.app-shell-link');
      link.focus();
      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
      document.body.removeChild(root);
    });

    it('the open/closed state survives a setNav() re-render (navPanel itself is never recreated)', async () => {
      const root = document.createElement('div');
      const { setNav } = mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);

      await setNav({ links: [{ label: 'Events', href: '#/events' }] });
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
    });

    it('the nav panel contains both the nav links and the auth control, so opening the menu reveals them together (2026-09-06, closing the "auth as its own always-visible row" vertical-space complaint)', async () => {
      const root = document.createElement('div');
      const { setNav } = mountAppShell(root, { client: fakeClient({}) });
      await setNav({ links: [{ label: 'Events', href: '#/events' }] });
      const panel = root.querySelector('.app-shell-nav-panel');
      expect(panel.querySelector('.app-shell-nav')).not.toBeNull();
      expect(panel.querySelector('.app-shell-auth')).not.toBeNull();
    });

    it("carries a visible 'Menu' label beside the icon whose text matches its aria-label (WCAG 2.5.3 label-in-name), hidden from assistive tech so it isn't announced twice", () => {
      const root = document.createElement('div');
      mountAppShell(root, { client: fakeClient({}) });
      const toggle = root.querySelector('.app-shell-nav-toggle');
      const label = toggle.querySelector('.app-shell-nav-toggle-label');
      expect(label.textContent).toBe(toggle.getAttribute('aria-label'));
      expect(label.getAttribute('aria-hidden')).toBe('true');
      expect(toggle.querySelectorAll('.app-shell-nav-toggle-bar')).toHaveLength(3);
    });
  });

  describe('crossing the inline/hamburger breakpoint', () => {
    // jsdom has no matchMedia; this stub records the shell's own change
    // listener (and the query it asked for) so a test can fire it the way a
    // real resize/rotation would.
    let listeners;
    let removed;
    let queries;
    let attached;
    let shells;
    beforeEach(() => {
      listeners = [];
      removed = [];
      queries = [];
      attached = [];
      shells = [];
      vi.stubGlobal('matchMedia', (query) => {
        queries.push(query);
        return {
          media: query,
          matches: false,
          addEventListener: (_type, fn) => listeners.push(fn),
          removeEventListener: (_type, fn) => removed.push(fn),
        };
      });
    });
    afterEach(() => {
      // Unmount every shell so its document-level listeners never outlive the
      // test that mounted it.
      for (const shell of shells) shell.unmount();
      vi.unstubAllGlobals();
      for (const node of attached) node.remove();
    });

    async function mountShell({
      links = [{ label: 'Events', href: '#/events' }],
      signedIn = false,
    } = {}) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      attached.push(root);
      const { auth, trigger } = fakeAuthWithTrigger();
      const shell = mountAppShell(root, { client: { ...fakeClient({}), auth } });
      shells.push(shell);
      if (signedIn) trigger({ user: { email: 'organiser@local.test' } });
      await shell.setNav({ links });
      return {
        ...shell,
        root,
        toggle: root.querySelector('.app-shell-nav-toggle'),
        panel: root.querySelector('.app-shell-nav-panel'),
        link: root.querySelector('.app-shell-link'),
        signOut: [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out'),
      };
    }
    const cross = (matches) => listeners.forEach((fn) => fn({ matches }));
    const isOpen = (panel) => panel.classList.contains('app-shell-nav-panel-open');

    it('watches the same breakpoint appShell.css uses for the inline row (min-width: 1366px) — if either drifts, this fails', async () => {
      await mountShell();
      expect(queries).toEqual(['(min-width: 1366px)']);
    });

    it('going inline with focus still on the toggle closes the menu and moves focus to the first nav link, not <body>', async () => {
      const { toggle, panel, link } = await mountShell();
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      toggle.focus();

      cross(true);

      expect(isOpen(panel)).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(link);
    });

    it('going inline after the browser already dropped focus to <body> (the toggle was hidden) still restores it to the first nav link', async () => {
      const { toggle, link } = await mountShell();
      toggle.focus();
      toggle.blur(); // what the browser's focus fixup leaves behind
      expect(document.activeElement).toBe(document.body);

      cross(true);

      expect(document.activeElement).toBe(link);
    });

    it('going inline with no nav links falls back to the auth control', async () => {
      const { toggle, signOut } = await mountShell({ links: [], signedIn: true });
      toggle.focus();

      cross(true);

      expect(document.activeElement).toBe(signOut);
    });

    it('going inline with focus on a link inside the (open) panel leaves focus where it is — it stays visible', async () => {
      const { toggle, panel, root } = await mountShell({
        links: [
          { label: 'Events', href: '#/events' },
          { label: 'Roster', href: '#/roster' },
        ],
      });
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      const second = root.querySelectorAll('.app-shell-link')[1];
      second.focus();

      cross(true);

      expect(document.activeElement).toBe(second);
      expect(isOpen(panel)).toBe(false);
    });

    it('collapsing into the hamburger with focus on a link inside the panel returns focus to the toggle, with the menu closed', async () => {
      const { toggle, panel, link } = await mountShell();
      link.focus();

      cross(false);

      expect(isOpen(panel)).toBe(false);
      expect(document.activeElement).toBe(toggle);
    });

    it('collapsing with the menu open and focus on the Sign out button returns focus to the toggle, with the menu closed', async () => {
      const { toggle, panel, signOut } = await mountShell({ signedIn: true });
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      signOut.focus();

      cross(false);

      expect(isOpen(panel)).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle);
    });

    it('never steals focus from something outside the header', async () => {
      const { toggle } = await mountShell();
      const input = document.createElement('input');
      document.body.appendChild(input);
      attached.push(input);
      toggle.focus();
      input.focus();

      cross(true);

      expect(document.activeElement).toBe(input);
    });

    it("doesn't restore focus after the user clicked away from the header to <body> — nothing was stranded", async () => {
      const { toggle } = await mountShell();
      toggle.focus();
      toggle.blur();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      cross(true);

      expect(document.activeElement).toBe(document.body);
    });

    it("doesn't restore focus after a press on non-focusable header chrome (padding, breadcrumb) dropped it to <body>", async () => {
      const { toggle, root } = await mountShell();
      toggle.focus();
      toggle.blur();
      root
        .querySelector('.app-shell-header')
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));

      cross(true);

      expect(document.activeElement).toBe(document.body);
    });

    it("doesn't yank focus back after a tap on a nav link closed the menu (the link was hidden with it)", async () => {
      const { toggle, link } = await mountShell();
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      link.focus();
      link.dispatchEvent(new Event('click', { bubbles: true })); // closes the menu
      link.blur(); // the hidden link loses focus

      cross(false);

      expect(document.activeElement).toBe(document.body);
    });

    it('stops listening for the breakpoint, focus and pointer events after unmount', async () => {
      const added = [];
      const removedDoc = [];
      vi.spyOn(document, 'addEventListener').mockImplementation((type) => added.push(type));
      vi.spyOn(document, 'removeEventListener').mockImplementation((type) => removedDoc.push(type));
      try {
        const { unmount } = await mountShell();
        shells.pop(); // unmounted here, not again in afterEach
        expect(listeners).toHaveLength(1);
        unmount();
        expect(removed).toEqual(listeners);
        for (const type of ['focusin', 'pointerdown']) {
          expect(added).toContain(type);
          expect(removedDoc).toContain(type);
        }
      } finally {
        vi.restoreAllMocks();
      }
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

    it("clicking Sign out while ALREADY on #/events still forces the router to re-resolve — user-reported, 2026-09-09: setting location.hash to its own current value is a browser no-op (no hashchange event fires per the WHATWG URL spec unless the fragment actually differs), which previously left the stale, still-rendered organiser screen on screen indefinitely until a manual refresh, since router.js only re-resolves via a real hashchange listener. Spies on window.dispatchEvent directly rather than relying on a real hashchange round-trip — jsdom (confirmed empirically, 2026-09-09) does not reliably reproduce real browsers' same-value suppression once an async gap (the awaited signOut() call) sits between the two assignments, so asserting on the native event's own side effect would be testing jsdom's quirk, not this fix's own code path.", async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      trigger({ user: { email: 'organiser@local.test' } });
      location.hash = '#/events';

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      signOutButton.dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(location.hash).toBe('#/events');
      const dispatchedHashChange = dispatchSpy.mock.calls.some(
        ([event]) => event.type === 'hashchange',
      );
      expect(dispatchedHashChange).toBe(true);
      dispatchSpy.mockRestore();
    });

    it('clicking Sign out from an open mobile menu closes the menu — found in review, 2026-09-06: unlike a nav link, Sign out never closed the panel on its own, leaving an expanded (now-empty) menu sitting over the login screen that mounts underneath it', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { auth, trigger } = fakeAuthWithTrigger();
      mountAppShell(root, { client: { auth, from: () => ({}) } });
      trigger({ user: { email: 'organiser@local.test' } });

      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);

      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      signOutButton.dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      document.body.removeChild(root);
    });

    it('a FAILED Sign out leaves the menu open — the button is right there to retry without reopening it', async () => {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const failingAuth = {
        signOut: vi.fn(() => Promise.resolve({ error: new Error('network unreachable') })),
        onAuthStateChange: (cb) => {
          cb('SIGNED_IN', { user: { email: 'organiser@local.test' } });
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      };
      mountAppShell(root, { client: { auth: failingAuth, from: () => ({}) } });

      const toggle = root.querySelector('.app-shell-nav-toggle');
      const panel = root.querySelector('.app-shell-nav-panel');
      toggle.dispatchEvent(new Event('click', { bubbles: true }));

      const signOutButton = [...root.querySelectorAll('button')].find(
        (b) => b.textContent === 'Sign out',
      );
      signOutButton.dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
      document.body.removeChild(root);
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

  // `tick(ms)` above waits a FIXED real duration, chosen against an idle
  // CPU, then hopes refreshSync()'s own await (an IndexedDB read via
  // listPendingOperations(), a real macrotask hop through fake-indexeddb)
  // has actually finished by the time the assertion runs. Found flaky under
  // full-suite CPU contention (2026-09-07, reproduced directly by
  // saturating every core during full `vitest run`s — six different
  // assertions in this describe block failed across several runs, each
  // with the stale pre-poll text still showing). Nothing was actually
  // broken in any of those failures — refreshSync()'s promise just hadn't
  // resolved yet by the arbitrary fixed deadline. `flush()` polls for the
  // real outcome instead of sleeping a guessed duration and hoping, same
  // fix applied to timingScreen.test.js's own identical failure mode the
  // day before. A generous 3s timeout keeps this from ever masking a
  // genuine regression as a hang; a real pass still resolves in tens of
  // milliseconds on an idle machine.
  async function flush(assertFn, { timeout = 3000 } = {}) {
    await vi.waitFor(assertFn, { timeout, interval: 20 });
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
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    expect(syncEl.classList.contains('app-shell-sync-live')).toBe(true);
    expect(syncEl.querySelector('.status-live-dot')).not.toBeNull();
  });

  it('shows the pending count as "not synced" once an operation is queued', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced (1 pending)');
    });
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(true);
  });

  it('escalates to the distinct "retrying failed" styling once an operation has a real attempt on record (a poison operation, not just in-flight)', async () => {
    const op = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await outboxPut({ ...op, attempts: 1, lastError: 'stale conflict' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced — retrying failed (1 pending)');
    });
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
    expect(syncEl.classList.contains('app-shell-sync-pending')).toBe(false);
  });

  it('names the stuck operation type when the caller supplies operationLabels — ROADMAP.md gap: an organiser could not tell a stuck publish apart from a stuck heat-start', async () => {
    const op = await enqueueOperation('some_op', { id: 1 });
    await outboxPut({ ...op, attempts: 1, lastError: 'stale conflict' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, {
      client: fakeClient({}),
      // Deliberately not a real Cup Taster operation type — appShell.js
      // itself must stay format-agnostic (see its own top comment), so this
      // proves the wiring works for WHATEVER map a caller supplies, not
      // specifically for that format's own vocabulary.
      operationLabels: { some_op: 'doing a thing' },
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced — doing a thing failed (1 pending)');
    });
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
  });

  it('falls back to the generic "retrying failed" message for a stuck type absent from operationLabels — an unlabeled type must never render "undefined"', async () => {
    const op = await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await outboxPut({ ...op, attempts: 1, lastError: 'stale conflict' });
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, {
      client: fakeClient({}),
      operationLabels: { some_other_op: 'doing a different thing' },
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced — retrying failed (1 pending)');
    });
  });

  it('fail-open: a pending operation still reports "not synced", never "off", even with no current event context — computeSyncState()\'s own guarantee, this caller must not accidentally suppress it', async () => {
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    const root = document.createElement('div');
    mountAppShell(root, { client: fakeClient({}) }); // no setNav call at all — cachedEventId stays null
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced (1 pending)');
    });
  });

  it('picks up a change on its own poll cycle, without requiring another setNav call', async () => {
    const root = document.createElement('div');
    const { setNav } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });

    // Enqueued directly against the outbox — nothing tells the shell about
    // this new operation except its own poll.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced (1 pending)');
    });
  });

  it('unmount() stops the poll — a leaked interval would keep reading IndexedDB (and touching a detached DOM node) forever', async () => {
    const root = document.createElement('div');
    const { setNav, unmount } = mountAppShell(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    unmount();

    // Enqueued AFTER unmount — if the interval weren't really cleared, a
    // later poll tick would eventually reflect this. Waiting past several
    // poll intervals and asserting NOTHING changed proves the timer is
    // actually gone, not just that clearInterval() was called. A fixed
    // real wait is correct here (not a flush()) — under CPU contention a
    // still-leaking timer would fire LATER, never earlier, so a slower
    // machine can only make this assertion more conservative, never flaky.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(80);
    expect(syncEl.textContent).toBe('Synced');
  });

  // Lost writes reach the panel from the outbox itself (onOperationDropped),
  // whoever triggered the flush — found in review (offline-sync-auditor,
  // 2026-09-27): only main.js's background reconnect flush used to forward a
  // drop here, so a drop during a screen's own flush (publishLiveSession from
  // scoring/standings/timing, a tap flushing past a rehearsal leftover) left
  // the next poll on a false "Synced" — the "conflict silently resolved"
  // failure §8.4/§9 exist to prevent. These tests drop operations through the
  // REAL flushOutbox with no main.js involved, which is exactly what a
  // screen-triggered flush is.
  const mountedShells = [];
  function mountTracked(root, options) {
    const shell = mountAppShell(root, options);
    mountedShells.push(shell);
    return shell;
  }
  afterEach(() => {
    while (mountedShells.length) mountedShells.pop().unmount();
  });

  function permanentError(message) {
    return Object.assign(new Error(message), { permanent: true });
  }

  // Enqueues `count` operations that can never succeed, then flushes them
  // the way any screen would — one flushOutbox() call, its result ignored.
  async function dropOperations(count) {
    for (let i = 0; i < count; i += 1) {
      await enqueueOperation('doomed_op', { i });
    }
    return flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
    });
  }

  it('an operation dropped during a flush the shell did not trigger shows the lost-write notice, instead of falsely reporting "Synced"', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });

    const result = await dropOperations(1);
    expect(result.permanentFailure).toBe(true); // the drop really happened
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
  });

  // Counted per dropped operation, not per flush (offline-sync-auditor D1,
  // 2026-09-27): five rehearsal leftovers dropped in one pass are five lost
  // writes — "1 write lost" undersold it.
  it('counts every operation dropped in one flush, not the flush as one loss', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');

    await dropOperations(3);
    await flush(() => {
      expect(syncEl.textContent).toBe('3 writes lost — not saved and not retried');
    });
  });

  // Every render of this live region is announced — a burst of drops in one
  // pass must be announced once with its final count, not once per drop
  // (ui-accessibility-reviewer, 2026-09-27).
  it('announces a burst of drops once, with the final count — never the intermediate counts', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}), dropCheckMs: 50 });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    await dropOperations(3);
    await flush(() => {
      expect(syncEl.textContent).toBe('3 writes lost — not saved and not retried');
    });
    observer.disconnect();

    const lostTexts = [...new Set(seen.filter((text) => text.includes('lost')))];
    expect(lostTexts).toEqual(['3 writes lost — not saved and not retried']);
  });

  // 2026-09-26 (ui-accessibility-reviewer / offline-sync-auditor): the
  // report is sticky, so later losses must still reach the panel rather than
  // reading the same as the first.
  it('counts a loss in a later flush on top of the earlier one — never downgrading the first notice to a plain "Not synced"', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('2 writes lost — not saved and not retried');
    });
    observer.disconnect();
    // test-auditor, 2026-09-27 (A6): an unconditional holding render
    // replaced the earlier notice with "Not synced" for the whole hold.
    expect(seen).not.toContain('Not synced');
  });

  // A dropped write never comes back, so a later, unrelated success must
  // not flip the panel back to "Synced" (code-reviewer, 2026-09-26).
  it('keeps the notice after a later flush lands cleanly', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}), syncPollMs: 20 });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });

    await enqueueOperation('fine_op', {});
    const clean = await flushOutbox({ fine_op: async () => {} });
    expect(clean).toEqual({ processed: 1, stopped: false, permanentFailure: false });
    await tick(60); // several poll cycles over the now-empty queue
    expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
  });

  it.each([
    ['names a labelled stuck operation', { some_op: 'doing a thing' }, '; doing a thing failed'],
    ['falls back to generic wording for an unlabelled one', {}, '; retrying failed'],
  ])(
    '%s alongside a lost write, so the notice never masks a new failure',
    async (_l, labels, suffix) => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, {
        client: fakeClient({}),
        operationLabels: labels,
        // The drop announcement renders mid-flush, before the stuck
        // operation's attempts are persisted; the next poll picks that up.
        syncPollMs: 20,
      });
      await setNav({ eventId: 'ev1', links: [] });
      // Dropped first, then the same pass stops on a transient failure that
      // stays queued with attempts > 0.
      await enqueueOperation('doomed_op', {});
      await enqueueOperation('some_op', { id: 1 });
      await flushOutbox({
        doomed_op: async () => {
          throw permanentError('stale conflict');
        },
        some_op: async () => {
          throw new Error('upstream 503');
        },
      });
      await flush(() => {
        expect(root.querySelector('.app-shell-sync').textContent).toBe(
          `1 write lost, not retried${suffix}`,
        );
      });
    },
  );

  it('fail-open also covers a dropped write: it still reports "not synced", never "off", with no current event context', async () => {
    const root = document.createElement('div');
    mountTracked(root, { client: fakeClient({}) }); // no setNav — cachedEventId stays null
    await dropOperations(1);
    await flush(() => {
      expect(root.querySelector('.app-shell-sync').textContent).toBe(
        '1 write lost — not saved and not retried',
      );
    });
  });

  it('a dropped write stays visible while other operations are queued — hiding it behind "N pending" would hide it for most of an event', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 20,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    // Enqueued directly, same as the "picks up a change on its own poll
    // cycle" test above — nothing calls refreshSync() directly here, only
    // the poll itself observes it.
    await enqueueOperation('confirm_heat', { heatId: 'h1' });
    await tick(60);
    expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    expect(syncEl.classList.contains('app-shell-sync-stuck')).toBe(true);
  });

  // offline-sync-auditor / ui-accessibility-reviewer, 2026-09-27: the
  // dropped operation leaves the queue before the panel announces it; a poll
  // in between read an empty queue and announced a false "Synced".
  it('never shows "Synced" between a drop and its announcement, even with polls landing in between', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 10,
      dropCheckMs: 150,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await enqueueOperation('doomed_op', {});
    await flush(() => {
      expect(syncEl.textContent).toBe('Not synced (1 pending)');
    });
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    await flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
    });
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    observer.disconnect();

    expect(seen).not.toContain('Synced');
    // Already "Not synced (1 pending)": the hold keeps that (true) text rather
    // than replacing it with the plain holding marker.
    expect(seen).not.toContain('Not synced');
  });

  // offline-sync-auditor, round 3: a write enqueued and dropped between two
  // polls never showed as pending, so holding the last render kept a lost
  // write green until the pass ended.
  it('leaves "Synced" at once when a drop lands between polls, and never shows it again before the notice', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000, // no poll during the test — only the drop itself can move the panel
      dropCheckMs: 10,
      dropMaxWaitMs: 5000,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });
    try {
      // The flush is still running, so the count isn't announced yet — but
      // the panel must already have left green.
      await flush(() => {
        expect(syncEl.textContent).toBe('Not synced');
      });
      expect(syncEl.classList.contains('app-shell-sync-live')).toBe(false);
    } finally {
      release();
      await running;
    }
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    observer.disconnect();

    expect(seen).not.toContain('Synced');
  });

  // offline-sync-auditor, round 3: the cap is what bounds the hold, so it must
  // not depend on a wall clock that can step backwards mid-event.
  it('still announces at the cap when the wall clock steps backwards during the hold', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 20,
      dropCheckMs: 10,
      dropMaxWaitMs: 100,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });
    let clockBack;
    try {
      await flush(() => {
        expect(syncEl.textContent).toBe('Not synced');
      });
      const realNow = Date.now();
      clockBack = vi.spyOn(Date, 'now').mockReturnValue(realNow - 60 * 60 * 1000);
      await flush(
        () => {
          expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
        },
        { timeout: 3000 },
      );
    } finally {
      clockBack?.mockRestore();
      release();
      await running;
    }
  });

  // test-auditor, 2026-09-27 (A2): the hold AFTER refreshSync's read is what
  // stops a read that started before a drop from rendering "Synced" over it.
  // An uncloneable payload fails outboxPut, so the drop is announced while
  // the read setNav started is still in flight.
  it('a drop landing while a read is in flight never lets that read render "Synced"', async () => {
    const root = document.createElement('div');
    const shell = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
    });
    const syncEl = root.querySelector('.app-shell-sync');
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const nav = shell.setNav({ eventId: 'ev1', links: [] }); // starts a read
      await enqueueOperation('doomed_op', { notCloneable: () => {} }).catch(() => {});
      await nav;
      await flush(() => {
        expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
      });
    } finally {
      observer.disconnect();
      consoleWarn.mockRestore();
    }
    expect(seen).not.toContain('Synced');
  });

  // test-auditor, 2026-09-27 (A3/A21): the cap is measured from each pass's
  // own first drop — measured from the first-ever drop, every later pass
  // would be announced mid-flush with a partial count.
  it("holds a later pass until it ends, capped from that pass's own first drop", async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
      dropMaxWaitMs: 1500, // wide margin: a CPU stall must not reach the cap mid-pass
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    await tick(1600); // past the cap, measured from the FIRST pass's drop

    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });
    try {
      await tick(150); // several drop checks, well inside this pass's own cap
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    } finally {
      release();
      await running;
    }
    await flush(() => {
      expect(syncEl.textContent).toBe('2 writes lost — not saved and not retried');
    });
  });

  // A transaction aborted without an error rejects with `tx.error === null`;
  // announced as-is, that null read as "no loss" and the panel went back to
  // "Synced" (code-reviewer, 2026-09-27). Reproduced for real: the put
  // succeeds, then its transaction is aborted with no error.
  it('a write lost to a transaction aborted with no error still shows as lost, never "Synced"', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function abortingPut(...args) {
      // One-shot: if the enqueue below ever hung, a lingering patch would
      // abort every later put in this file and bury the real failure.
      IDBObjectStore.prototype.put = realPut;
      const request = realPut.apply(this, args);
      const tx = this.transaction;
      request.addEventListener('success', () => tx.abort());
      return request;
    };
    let thrown = 'not thrown';
    try {
      await enqueueOperation('doomed_op', {}).catch((error) => {
        thrown = error;
      });
    } finally {
      IDBObjectStore.prototype.put = realPut;
    }
    try {
      expect(thrown).toBeNull(); // the case under test: rejected with null
      await flush(() => {
        expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
      });
    } finally {
      consoleWarn.mockRestore();
    }
  });

  // offline-sync-auditor, 2026-09-27: a failed persist (the likeliest drop
  // when IndexedDB is failing) makes the announcing read likely to fail too —
  // the notice must not stay a plain "Not synced", which reads as "will
  // catch up".
  it('shows the lost-write notice even when the queue read fails as the hold ends', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Every later outboxListAll read fails; the drop itself is announced
    // from inside the flush before that matters.
    const realGetAll = IDBIndex.prototype.getAll; // outboxListAll reads via the createdAt index
    IDBIndex.prototype.getAll = function failingGetAll() {
      throw new Error('IndexedDB unavailable');
    };
    try {
      await enqueueOperation('doomed_op', { notCloneable: () => {} }).catch(() => {});
      await flush(() => {
        expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
      });
    } finally {
      IDBIndex.prototype.getAll = realGetAll;
      consoleError.mockRestore();
    }
  });

  // offline-sync-auditor, 2026-09-27 (round 5): the fallback first covered
  // only a hold; a new loss on top of an earlier notice (or a pending
  // count) stayed under-counted while reads kept failing.
  it('updates an earlier lost-write notice when reads fail as a later loss is announced', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realGetAll = IDBIndex.prototype.getAll;
    IDBIndex.prototype.getAll = function failingGetAll() {
      throw new Error('IndexedDB unavailable');
    };
    try {
      await enqueueOperation('doomed_op', { notCloneable: () => {} }).catch(() => {});
      await flush(() => {
        expect(syncEl.textContent).toBe('2 writes lost — not saved and not retried');
      });
    } finally {
      IDBIndex.prototype.getAll = realGetAll;
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  // ui-accessibility-reviewer, 2026-09-27: from an empty ("off") panel — no
  // event context, e.g. the events list during a reconnect flush — a drop
  // goes to "Not synced" then the notice, never "Synced".
  it('from an empty panel with no event context, a drop shows "Not synced" then the notice, never "Synced"', async () => {
    const root = document.createElement('div');
    mountTracked(root, { client: fakeClient({}), syncPollMs: 60000, dropCheckMs: 10 });
    const syncEl = root.querySelector('.app-shell-sync');
    await tick(30);
    expect(syncEl.textContent).toBe('');
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });
    try {
      await flush(() => {
        expect(syncEl.textContent).toBe('Not synced');
      });
    } finally {
      release();
      await running;
    }
    await flush(() => {
      expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
    });
    observer.disconnect();
    expect(seen).not.toContain('Synced');
  });

  // offline-sync-auditor D4, 2026-09-27: the notice was in memory only, so a
  // reload — or the browser restoring a tab the OS discarded — erased the
  // only record that a write was lost.
  it('keeps the lost-write notice across a reload of the tab, via sessionStorage', async () => {
    const root = document.createElement('div');
    const first = mountTracked(root, { client: fakeClient({}), dropCheckMs: 10 });
    await first.setNav({ eventId: 'ev1', links: [] });
    await dropOperations(2);
    await flush(() => {
      expect(root.querySelector('.app-shell-sync').textContent).toBe(
        '2 writes lost — not saved and not retried',
      );
    });
    first.unmount(); // the page going away
    // Held in storage, not module state.
    expect(JSON.parse(sessionStorage.getItem('seduh-lost-writes'))).toEqual({ count: 2 });

    const reloaded = document.createElement('div');
    const second = mountTracked(reloaded, { client: fakeClient({}), dropCheckMs: 10 });
    await second.setNav({ eventId: 'ev1', links: [] });
    const syncEl = reloaded.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('2 writes lost — not saved and not retried');
    });

    // A later loss adds to the restored count rather than starting over.
    await dropOperations(1);
    await flush(() => {
      expect(syncEl.textContent).toBe('3 writes lost — not saved and not retried');
    });

    // And with storage cleared, a fresh mount starts clean.
    sessionStorage.clear();
    const fresh = document.createElement('div');
    const third = mountTracked(fresh, { client: fakeClient({}) });
    await third.setNav({ eventId: 'ev1', links: [] });
    await flush(() => {
      expect(fresh.querySelector('.app-shell-sync').textContent).toBe('Synced');
    });
  });

  // offline-sync-auditor, 2026-09-27: saving only at announcement left the
  // hold (up to DROP_MAX_WAIT_MS) unsaved — a reload then lost those drops.
  it('saves a drop at once, before the hold ends', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 60000,
      dropCheckMs: 10,
    });
    await setNav({ eventId: 'ev1', links: [] });
    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });
    try {
      await flush(() => {
        expect(root.querySelector('.app-shell-sync').textContent).toBe('Not synced');
      });
      // Still holding — not announced yet — but already saved.
      expect(JSON.parse(sessionStorage.getItem('seduh-lost-writes'))).toEqual({ count: 1 });
    } finally {
      release();
      await running;
    }
  });

  it.each([
    ['unreadable JSON', '{not json'],
    ['a zero count', '{"count":0}'],
    ['a negative count', '{"count":-1}'],
    ['a non-integer count', '{"count":"2"}'],
  ])('starts clean when the saved record holds %s', async (_label, saved) => {
    sessionStorage.setItem('seduh-lost-writes', saved);
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, { client: fakeClient({}) });
    await setNav({ eventId: 'ev1', links: [] });
    await flush(() => {
      expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced');
    });
  });

  // test-auditor, 2026-09-27: private or site-data-blocked browsers throw
  // from getItem itself; that must not take the whole console down.
  it('starts clean, not crashed, when sessionStorage refuses the read', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}) });
      await setNav({ eventId: 'ev1', links: [] });
      await flush(() => {
        expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced');
      });
      expect(getItem).toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it('still shows the notice in memory when sessionStorage refuses the write', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}), dropCheckMs: 10 });
      await setNav({ eventId: 'ev1', links: [] });
      await dropOperations(1);
      await flush(() => {
        expect(root.querySelector('.app-shell-sync').textContent).toBe(
          '1 write lost — not saved and not retried',
        );
      });
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  // ui-accessibility-reviewer, 2026-09-27: at 360px the status wrapped onto
  // its own header row and grew from "Synced" to a two-line pill mid-heat,
  // shifting the Stop buttons under a judge's finger (and, with the real nav
  // and email, at 640–1280px too). The row is now reserved (min-height in
  // appShell.css) whenever there's anything to report — jsdom does no
  // layout, so these pin when the row is reserved and the CSS rules behind
  // it; the heights were measured in a real browser at
  // 320/360/640/800/1024/1280px.
  describe('reserved status row (no header shift)', () => {
    const row = (root) => root.querySelector('.app-shell-sync-row');

    it('wraps the status in the row, and leaves it unreserved while there is nothing to report', async () => {
      const root = document.createElement('div');
      mountTracked(root, { client: fakeClient({}) }); // no event context: 'off'
      await tick(30);
      expect(row(root).contains(root.querySelector('.app-shell-sync'))).toBe(true);
      // A direct child of the (flex-wrap) header — that's what lets
      // flex-basis: 100% give it its own line.
      expect(row(root).parentElement).toBe(root.querySelector('.app-shell-header'));
      expect(root.querySelector('.app-shell-sync').textContent).toBe('');
      expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(false);
    });

    it('reserves the row on an event screen and keeps it through every status change', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, {
        client: fakeClient({}),
        syncPollMs: 20,
        dropCheckMs: 10,
      });
      await setNav({ eventId: 'ev1', links: [] });
      const syncEl = root.querySelector('.app-shell-sync');
      const states = [];
      // Reserved exactly while the status has something to show.
      const record = () =>
        states.push([
          syncEl.textContent,
          row(root).classList.contains('app-shell-sync-row-active') === (syncEl.textContent !== ''),
        ]);
      await flush(() => expect(syncEl.textContent).toBe('Synced'));
      record();
      await enqueueOperation('confirm_heat', { heatId: 'h1' });
      await flush(() => expect(syncEl.textContent).toBe('Not synced (1 pending)'));
      record();
      await flushOutbox({
        confirm_heat: async () => {
          throw permanentError('stale conflict');
        },
      });
      await flush(() =>
        expect(syncEl.textContent).toBe('1 write lost — not saved and not retried'),
      );
      record();

      expect(states.every(([, reserved]) => reserved)).toBe(true);
    });

    it('reserves the row for the immediate "Not synced" when a drop lands on an empty panel', async () => {
      const root = document.createElement('div');
      mountTracked(root, { client: fakeClient({}), syncPollMs: 60000, dropCheckMs: 10 });
      await tick(30);
      expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(false);
      await enqueueOperation('doomed_op', {});
      await enqueueOperation('slow_op', {});
      let release;
      const stalled = new Promise((resolve) => {
        release = resolve;
      });
      const running = flushOutbox({
        doomed_op: async () => {
          throw permanentError('stale conflict');
        },
        slow_op: () => stalled,
      });
      try {
        await flush(() =>
          expect(root.querySelector('.app-shell-sync').textContent).toBe('Not synced'),
        );
        expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(true);
      } finally {
        release();
        await running;
      }
      // test-auditor, 2026-09-27: the announced notice, still with no event
      // context, must keep the row — keyed on the event context instead, a
      // loss on the events list would sit in an unreserved row.
      await flush(() =>
        expect(root.querySelector('.app-shell-sync').textContent).toBe(
          '1 write lost — not saved and not retried',
        ),
      );
      expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(true);
    });

    // jsdom does no layout; this pins the CSS half against accidental
    // deletion, from the source text (same approach as countdown.test.js).
    it('keeps the row rules in appShell.css: contents while empty, a reserved min-height while active', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const css = fs.readFileSync(path.join(dir, 'appShell.css'), 'utf8');
      const rule = (selector) => {
        const start = css.indexOf(`\n${selector} {`);
        return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
      };
      expect(rule('.app-shell-sync-row')).toMatch(/display:\s*contents/);
      expect(rule('.app-shell-sync-row-active')).toMatch(/display:\s*flex/);
      expect(rule('.app-shell-sync-row-active')).toMatch(/flex-basis:\s*100%/);
      expect(rule('.app-shell-sync-row-active')).toMatch(
        /min-height:\s*calc\(2 \* var\(--leading-normal\) \* var\(--text-sm\) \+ 2 \* var\(--space-1\)\)/,
      );
      // One line at 1024px+, where the longest notice fits on a line.
      expect(css).toMatch(
        /@media \(min-width: 1024px\)\s*\{\s*\.app-shell-sync-row-active\s*\{[^}]*min-height:\s*calc\(var\(--leading-normal\) \* var\(--text-sm\) \+ 2 \* var\(--space-1\)\)/,
      );
    });

    it('releases the row when navigation leaves the event and nothing is pending or lost', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}) });
      await setNav({ eventId: 'ev1', links: [] });
      await flush(() =>
        expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(true),
      );
      await setNav({ eventId: null, links: [] });
      await flush(() =>
        expect(row(root).classList.contains('app-shell-sync-row-active')).toBe(false),
      );
    });
  });

  // Drops in one pass each follow a server round trip, which on venue wifi
  // is longer than any fixed quiet window — the pass is announced once it
  // is over, not once it goes quiet.
  it('announces a pass whose drops arrive slowly once, when the flush ends', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 10,
      dropCheckMs: 10,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    const seen = [];
    const observer = new MutationObserver(() => seen.push(syncEl.textContent));
    observer.observe(syncEl, { childList: true, characterData: true, subtree: true });

    for (let i = 0; i < 3; i += 1) await enqueueOperation('doomed_op', { i });
    await flushOutbox({
      doomed_op: async () => {
        await tick(40); // each round trip is longer than dropCheckMs
        throw permanentError('stale conflict');
      },
    });
    await flush(() => {
      expect(syncEl.textContent).toBe('3 writes lost — not saved and not retried');
    });
    observer.disconnect();

    const lostTexts = [...new Set(seen.filter((text) => text.includes('lost')))];
    expect(lostTexts).toEqual(['3 writes lost — not saved and not retried']);
  });

  // A pass that keeps running (or stalls on a slow request) must not hold a
  // lost write back indefinitely.
  it('announces a drop after the maximum wait even while its flush is still running', async () => {
    const root = document.createElement('div');
    const { setNav } = mountTracked(root, {
      client: fakeClient({}),
      syncPollMs: 20,
      dropCheckMs: 10,
      dropMaxWaitMs: 100,
    });
    await setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await enqueueOperation('doomed_op', {});
    await enqueueOperation('slow_op', {});
    let release;
    const stalled = new Promise((resolve) => {
      release = resolve;
    });
    const running = flushOutbox({
      doomed_op: async () => {
        throw permanentError('stale conflict');
      },
      slow_op: () => stalled,
    });

    try {
      await flush(
        () => {
          expect(syncEl.textContent).toBe('1 write lost — not saved and not retried');
        },
        { timeout: 3000 },
      );
    } finally {
      release();
      await running;
    }
  });

  // Waits well past dropCheckMs, so a leaked listener's announcement would
  // have landed (test-auditor, 2026-09-27: the first version waited less
  // than the settle delay and passed with the listener leaked).
  it('an unmounted shell stops listening — a drop after unmount does not touch its panel', async () => {
    const root = document.createElement('div');
    const shell = mountAppShell(root, { client: fakeClient({}), dropCheckMs: 10 });
    await shell.setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });
    shell.unmount(); // clears root; syncEl is detached but still inspectable

    await dropOperations(1);
    await tick(80);
    expect(syncEl.textContent).toBe('Synced');
  });

  it('a drop still unannounced at unmount never renders into the torn-down panel', async () => {
    const root = document.createElement('div');
    const shell = mountAppShell(root, { client: fakeClient({}), dropCheckMs: 30 });
    await shell.setNav({ eventId: 'ev1', links: [] });
    const syncEl = root.querySelector('.app-shell-sync');
    await flush(() => {
      expect(syncEl.textContent).toBe('Synced');
    });

    // Two drops: a second drop must not orphan the first timer, which
    // clearTimeout at unmount would then miss (test-auditor, 2026-09-27).
    await dropOperations(2); // announcement scheduled, not yet due
    const atUnmount = syncEl.textContent; // 'Not synced' — the hold's own marker
    shell.unmount();
    await tick(100);
    expect(syncEl.textContent).toBe(atUnmount);
    expect(syncEl.textContent).not.toContain('lost');
  });
});
