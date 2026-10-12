import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { mountAppShell } from './appShell.js';
import { _clearAllForTests, outboxPut, outboxListAll, outboxRemove } from './db.js';
import {
  enqueueOperation,
  flushOutbox,
  countPendingOperations,
  setOutboxOwner,
  _resetOutboxOwnerForTests,
} from './outbox.js';
import { APP_VERSION, NAMEPLATE } from './version.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import {
  SIGN_OUT_FAILED_MESSAGE,
  SIGN_OUT_SLOW_MESSAGE,
  SIGN_OUT_UNCHECKED_MESSAGE,
} from './signOut.js';

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

    it('pressing the toggle while it already has focus (no new focus event) does not forget it: crossing still restores focus', async () => {
      const { toggle, link } = await mountShell();
      toggle.focus();
      // A second press on the focused button: pointerdown, and no focusin because nothing moved.
      toggle.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      toggle.dispatchEvent(new Event('click', { bubbles: true }));
      toggle.blur(); // the browser's focus fixup when the toggle is hidden
      expect(document.activeElement).toBe(document.body);

      cross(true);

      expect(document.activeElement).toBe(link);
    });

    it('a press on something else (the page, or non-focusable chrome) still forgets the header focus', async () => {
      const { toggle } = await mountShell();
      toggle.focus();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      toggle.blur();

      cross(true);

      // Nothing was stranded by the resize, so nothing is pulled to a link.
      expect(document.activeElement).toBe(document.body);
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

  // Nothing waiting to sync, answered at once: these tests are about the button, not the outbox read.
  const noUnsynced = () => Promise.resolve([]);
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
      mountAppShell(root, { client: { auth, from: () => ({}) }, accountOperations: noUnsynced });
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
      mountAppShell(root, { client: { auth, from: () => ({}) }, accountOperations: noUnsynced });
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
      mountAppShell(root, { client: { auth, from: () => ({}) }, accountOperations: noUnsynced });
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
      mountAppShell(root, {
        client: { auth: failingAuth, from: () => ({}) },
        accountOperations: noUnsynced,
      });

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

    describe('when Sign out does not work', () => {
      // A shell signed in as organiser@local.test whose signOut() behaves as the test says, with the
      // mobile menu open: returns the pieces the assertions look at.
      function mountSignedInWith(signOut) {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const auth = {
          signOut: vi.fn(signOut),
          onAuthStateChange: (cb) => {
            cb('SIGNED_IN', { user: { email: 'organiser@local.test' } });
            return { data: { subscription: { unsubscribe: vi.fn() } } };
          },
        };
        mountAppShell(root, { client: { auth, from: () => ({}) }, accountOperations: noUnsynced });
        const toggle = root.querySelector('.app-shell-nav-toggle');
        toggle.dispatchEvent(new Event('click', { bubbles: true }));
        return {
          root,
          auth,
          panel: root.querySelector('.app-shell-nav-panel'),
          status: root.querySelector('.app-shell-auth-status'),
          button: [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out'),
        };
      }
      const clickAndSettle = async (button) => {
        button.dispatchEvent(new Event('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      };

      afterEach(() => {
        vi.useRealTimers();
        location.hash = '';
      });

      it('says so in a polite status region next to the button, and leaves everything as it was', async () => {
        const { root, panel, status, button } = mountSignedInWith(() =>
          Promise.resolve({ error: new Error('network unreachable') }),
        );
        location.hash = '#/events/ev1';
        await clickAndSettle(button);
        expect(status.getAttribute('role')).toBe('status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toBe(SIGN_OUT_FAILED_MESSAGE);
        expect(location.hash).toBe('#/events/ev1');
        expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
        document.body.removeChild(root);
      });

      it('a sign-out that throws is reported the same way and goes nowhere', async () => {
        const { root, panel, status, button } = mountSignedInWith(() =>
          Promise.reject(new TypeError('Failed to fetch')),
        );
        location.hash = '#/events/ev1';
        await clickAndSettle(button);
        expect(status.textContent).toBe(SIGN_OUT_FAILED_MESSAGE);
        expect(location.hash).toBe('#/events/ev1');
        expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
        document.body.removeChild(root);
      });

      it('a sign-out that never answers gives up at the shared timeout, with its own message', async () => {
        vi.useFakeTimers();
        const { root, panel, status, button } = mountSignedInWith(() => new Promise(() => {}));
        location.hash = '#/events/ev1';
        button.dispatchEvent(new Event('click', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
        expect(status.textContent).toBe('');
        await vi.advanceTimersByTimeAsync(2);
        expect(status.textContent).toBe(SIGN_OUT_SLOW_MESSAGE);
        expect(location.hash).toBe('#/events/ev1');
        expect(panel.classList.contains('app-shell-nav-panel-open')).toBe(true);
        document.body.removeChild(root);
      });

      it('the message is cleared by the next attempt, and a success leaves none', async () => {
        let attempt = 0;
        const { root, status, button } = mountSignedInWith(() => {
          attempt += 1;
          return Promise.resolve({ error: attempt === 1 ? new Error('network') : null });
        });
        await clickAndSettle(button);
        expect(status.textContent).toBe(SIGN_OUT_FAILED_MESSAGE);
        await clickAndSettle(button);
        expect(status.textContent).toBe('');
        expect(location.hash).toBe('#/events');
        document.body.removeChild(root);
      });
    });

    it('unmount() unsubscribes from the auth-state listener', () => {
      const root = document.createElement('div');
      const { auth, unsubscribe } = fakeAuthWithTrigger();
      const { unmount } = mountAppShell(root, { client: { auth, from: () => ({}) } });
      unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('the organisation slot (T-TEN.C3)', () => {
    const ORG_A = { id: 'org-a', name: 'Alpha Coffee', slug: 'alpha-coffee' };
    const ORG_B = { id: 'org-b', name: 'Bravo Roasters', slug: 'bravo-roasters' };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    function mountWithShell() {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const shell = mountAppShell(root, { client: { auth: fakeAuth(), from: () => ({}) } });
      return {
        root,
        shell,
        slot: root.querySelector('.app-shell-org'),
        notice: root.querySelector('#app-shell-org-notice'),
        select: () => root.querySelector('.app-shell-org-select'),
      };
    }
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('is hidden and empty until it is told which organisations there are, and with none', () => {
      const { shell, slot } = mountWithShell();
      expect(slot.hidden).toBe(true);
      shell.setOrganisation({ orgs: [ORG_A], activeOrgId: 'org-a' });
      expect(slot.hidden).toBe(false);
      shell.setOrganisation({ orgs: [], activeOrgId: null });
      expect(slot.hidden).toBe(true);
      expect(slot.childNodes).toHaveLength(0);
    });

    it('sits in the header between the brand and the Menu button, outside the collapsing panel', () => {
      const { root, slot } = mountWithShell();
      const header = root.querySelector('.app-shell-header');
      const order = [...header.children].map((child) => child.className.split(' ')[0]);
      expect(order.indexOf('app-shell-org')).toBe(order.indexOf('app-shell-brand') + 1);
      expect(order.indexOf('app-shell-org')).toBeLessThan(order.indexOf('app-shell-nav-toggle'));
      expect(root.querySelector('.app-shell-nav-panel').contains(slot)).toBe(false);
    });

    it('shows one organisation as a plain label a screen reader introduces as the organisation', () => {
      const { shell, slot, select } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A], activeOrgId: 'org-a' });
      expect(select()).toBeNull();
      expect(slot.textContent).toBe('Organisation: Alpha Coffee');
      expect(slot.querySelector('.sr-only').textContent).toBe('Organisation: ');
    });

    it('shows several as a native select named "Organisation", on the active one', () => {
      const { shell, select } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-b' });
      expect(select().tagName).toBe('SELECT');
      expect(select().getAttribute('aria-label')).toBe('Organisation');
      expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([
        ['org-a', 'Alpha Coffee'],
        ['org-b', 'Bravo Roasters'],
      ]);
      expect(select().value).toBe('org-b');
    });

    it('warns, before use, that choosing switches straight away (WCAG 3.2.2)', () => {
      const { shell, select, slot } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
      const hintId = select().getAttribute('aria-describedby');
      const hint = slot.querySelector(`#${hintId}`);
      expect(hint.textContent).toBe('Choosing another organisation switches to it straight away.');
      // `hidden`: not read a second time in browse mode, yet still the control's description.
      expect(hint.hidden).toBe(true);
    });

    it('tells apart two organisations that share a name by their slug, and only those', () => {
      const { shell, select } = mountWithShell();
      const twin = { id: 'org-c', name: 'Alpha Coffee', slug: 'alpha-coffee-nz' };
      shell.setOrganisation({ orgs: [ORG_A, twin, ORG_B], activeOrgId: 'org-a' });
      expect([...select().options].map((o) => o.textContent)).toEqual([
        'Alpha Coffee (alpha-coffee)',
        'Alpha Coffee (alpha-coffee-nz)',
        'Bravo Roasters',
      ]);
    });

    it('writes names as text, never as markup', () => {
      const { shell, slot, select } = mountWithShell();
      const hostile = { id: 'org-x', name: '<img src=x onerror=alert(1)>', slug: 'x-x' };
      shell.setOrganisation({ orgs: [hostile], activeOrgId: 'org-x' });
      expect(slot.querySelector('img')).toBeNull();
      expect(slot.textContent).toContain('<img src=x onerror=alert(1)>');
      shell.setOrganisation({ orgs: [hostile, ORG_A], activeOrgId: 'org-x' });
      expect(slot.querySelector('img')).toBeNull();
      expect(select().options[0].textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('falls back to the first organisation when the active one is not in the list', () => {
      const { shell, select } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-gone' });
      expect(select().value).toBe('org-a');
    });

    it('keeps the very same select (and so keyboard focus) when the list changes', () => {
      const { shell, select } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
      const before = select();
      before.focus();
      shell.setOrganisation({
        orgs: [ORG_A, ORG_B, { id: 'org-c', name: 'Charlie Beans', slug: 'charlie-beans' }],
        activeOrgId: 'org-b',
      });
      expect(select()).toBe(before);
      expect(document.activeElement).toBe(before);
      expect(before.options).toHaveLength(3);
      expect(before.value).toBe('org-b');
    });

    it('moves between a label and a select as the number of organisations changes', () => {
      const { shell, slot, select } = mountWithShell();
      shell.setOrganisation({ orgs: [ORG_A], activeOrgId: 'org-a' });
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
      expect(select()).not.toBeNull();
      expect(slot.querySelector('.app-shell-org-label')).toBeNull();
      shell.setOrganisation({ orgs: [ORG_B], activeOrgId: 'org-b' });
      expect(select()).toBeNull();
      expect(slot.textContent).toBe('Organisation: Bravo Roasters');
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-b' });
      expect(select().value).toBe('org-b');
    });

    describe('choosing another organisation', () => {
      const choose = (select, orgId) => {
        select.value = orgId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };

      it('asks the caller to switch, and leaves the choice where it is on success', async () => {
        const { shell, select, notice } = mountWithShell();
        const onSelect = vi.fn(async () => ({ ok: true }));
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect });
        select().focus();
        choose(select(), 'org-b');
        await tick();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('org-b');
        expect(select().value).toBe('org-b');
        expect(notice.textContent).toBe('');
      });

      it('on a refusal puts the select back, says why in a polite status panel, and keeps focus', async () => {
        const { shell, select, notice } = mountWithShell();
        const message = '2 changes on this device have not synced yet.';
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message }),
        });
        select().focus();
        choose(select(), 'org-b');
        await tick();
        expect(select().value).toBe('org-a');
        expect(notice.textContent).toBe(message);
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(true);
        expect(notice.getAttribute('role')).toBe('status');
        expect(notice.getAttribute('aria-live')).toBe('polite');
        expect(document.activeElement).toBe(select());
      });

      it('says something generic when a refusal carries no message, or the caller throws', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false }),
        });
        choose(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Could not switch organisation. Try again.');

        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => {
            throw new Error('boom');
          },
        });
        choose(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Could not switch organisation. Try again.');
        expect(select().value).toBe('org-a');
      });

      it('with no caller to ask, refuses rather than pretending', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
        choose(select(), 'org-b');
        await tick();
        expect(select().value).toBe('org-a');
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(true);
      });

      it('ignores choosing the organisation that is already active', async () => {
        const { shell, select } = mountWithShell();
        const onSelect = vi.fn(async () => ({ ok: true }));
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect });
        choose(select(), 'org-a');
        await tick();
        expect(onSelect).not.toHaveBeenCalled();
      });

      it('ignores a second choice while the first is still being decided', async () => {
        const { shell, select } = mountWithShell();
        let finish;
        const onSelect = vi.fn(
          () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: true });
            }),
        );
        const orgs = [ORG_A, ORG_B, { id: 'org-c', name: 'Charlie Beans', slug: 'charlie-beans' }];
        shell.setOrganisation({ orgs, activeOrgId: 'org-a', onSelect });
        choose(select(), 'org-b');
        choose(select(), 'org-c');
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(select().value).toBe('org-a');
        finish();
        await tick();
        // After it settles, a new choice is accepted again.
        shell.setOrganisation({ orgs, activeOrgId: 'org-b', onSelect });
        choose(select(), 'org-c');
        expect(onSelect).toHaveBeenCalledTimes(2);
      });

      it('clears an old refusal when the next choice is made', async () => {
        const { shell, select, notice } = mountWithShell();
        let answer = { ok: false, message: 'Not yet.' };
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => answer,
        });
        choose(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Not yet.');
        answer = { ok: true };
        choose(select(), 'org-b');
        expect(notice.textContent).toBe('');
        await tick();
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(false);
      });

      it('clears a refusal on Escape, and when focus leaves the control', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        select().focus();
        choose(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Not yet.');
        select().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(notice.textContent).toBe('');

        choose(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Not yet.');
        select().blur();
        expect(notice.textContent).toBe('');
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(false);
      });

      it('other keys leave a refusal showing', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        choose(select(), 'org-b');
        await tick();
        select().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(notice.textContent).toBe('Not yet.');
      });
    });

    describe('what survives a change of focus, and what does not', () => {
      const chooseIn = (select, orgId) => {
        select.value = orgId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };

      it('a quiet announcement survives the select losing focus (the new screen takes focus moments later)', () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
        select().focus();
        shell.announceOrganisation('Now working in Bravo Roasters. Showing Events.');
        select().blur();
        expect(notice.textContent).toBe('Now working in Bravo Roasters. Showing Events.');
      });

      it('and Escape on the select does not wipe it either', () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
        shell.announceOrganisation('Now working in Bravo Roasters. Showing Events.');
        select().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(notice.textContent).toBe('Now working in Bravo Roasters. Showing Events.');
      });

      it('a tap or click anywhere dismisses a refusal (a touch browser may not blur the select)', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        chooseIn(select(), 'org-b');
        await tick();
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(true);
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(notice.textContent).toBe('');
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(false);
      });

      it('a tap does not wipe an announcement', () => {
        const { shell, notice } = mountWithShell();
        shell.announceOrganisation('Now working in Alpha Coffee. Showing Events.');
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(notice.textContent).toBe('Now working in Alpha Coffee. Showing Events.');
      });

      it('an ignored re-pick or second choice leaves a refusal that is showing alone', async () => {
        const { shell, select, notice } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        chooseIn(select(), 'org-b');
        await tick();
        chooseIn(select(), 'org-a');
        expect(notice.textContent).toBe('Not yet.');
      });

      it('an open refusal leaves no tap listener behind when the shell is unmounted', async () => {
        const { shell, select } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        chooseIn(select(), 'org-b');
        await tick();
        const remove = vi.spyOn(document, 'removeEventListener');
        shell.unmount();
        expect(remove.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
        remove.mockRestore();
      });

      it('the refusal listener is removed once the refusal is gone', async () => {
        const { shell, select, notice, root } = mountWithShell();
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        chooseIn(select(), 'org-b');
        await tick();
        const addedFor = (type) => add.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);
        const removedFor = (type) =>
          remove.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);
        // one dismissal listener of each kind while the refusal is up...
        const [onPointer] = addedFor('pointerdown');
        const [onKey] = addedFor('keydown');
        expect(addedFor('pointerdown')).toHaveLength(1);
        expect(onKey).toBeTypeOf('function');
        select().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        // ...and exactly those are taken off again
        expect(removedFor('pointerdown')).toContain(onPointer);
        expect(removedFor('keydown')).toContain(onKey);
        expect(notice.textContent).toBe('');
        add.mockRestore();
        remove.mockRestore();
        void root;
      });
    });

    describe('while a choice is being decided, and after the control is gone', () => {
      const chooseIn = (select, orgId) => {
        select.value = orgId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };

      it('marks the select busy (aria-disabled, so focus is not lost), then frees it', async () => {
        const { shell, select } = mountWithShell();
        let finish;
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: true });
            }),
        });
        select().focus();
        chooseIn(select(), 'org-b');
        expect(select().getAttribute('aria-disabled')).toBe('true');
        expect(select().getAttribute('aria-busy')).toBe('true');
        expect(select().disabled).toBe(false);
        expect(document.activeElement).toBe(select());
        finish();
        await tick();
        expect(select().hasAttribute('aria-disabled')).toBe(false);
      });

      it('does not flick back to the old organisation if the list is re-rendered meanwhile', async () => {
        const { shell, select } = mountWithShell();
        let finish;
        const onSelect = () =>
          new Promise((resolve) => {
            finish = () => resolve({ ok: true });
          });
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect });
        chooseIn(select(), 'org-b');
        // An unrelated change (a role, a refresh) re-renders with the same active organisation.
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect });
        expect(select().value).toBe('org-b');
        finish();
        await tick();
      });

      it('shows no refusal if the control was taken away before the answer came', async () => {
        const { shell, select, notice, slot } = mountWithShell();
        let finish;
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: false, message: 'Not yet.' });
            }),
        });
        chooseIn(select(), 'org-b');
        shell.setOrganisation({ orgs: [], activeOrgId: null });
        finish();
        await tick();
        expect(slot.hidden).toBe(true);
        expect(notice.textContent).toBe('');
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(false);
      });

      it('clears a refusal when the control goes away (one organisation left, or none)', async () => {
        const { shell, select, notice } = mountWithShell();
        const refuse = async () => ({ ok: false, message: 'Not yet.' });
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect: refuse });
        chooseIn(select(), 'org-b');
        await tick();
        expect(notice.textContent).toBe('Not yet.');
        shell.setOrganisation({ orgs: [ORG_A], activeOrgId: 'org-a' });
        expect(notice.textContent).toBe('');

        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect: refuse });
        chooseIn(select(), 'org-b');
        await tick();
        shell.setOrganisation({ orgs: [], activeOrgId: null });
        expect(notice.textContent).toBe('');
      });

      it('leaves the options alone when the list has not changed (an open picker would collapse)', () => {
        const { shell, select } = mountWithShell();
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a' });
        const before = [...select().options];
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-b' });
        expect([...select().options]).toEqual(before);
        expect(select().value).toBe('org-b');
        shell.setOrganisation({
          orgs: [ORG_A, { ...ORG_B, name: 'Bravo Roasters Ltd' }],
          activeOrgId: 'org-b',
        });
        expect(select().options[1].textContent).toBe('Bravo Roasters Ltd');
      });
    });

    describe('naming the active organisation in full', () => {
      it('gives the full name, on a line of its own at the top of the menu, hidden from a screen reader', () => {
        const { root, shell } = mountWithShell();
        const line = root.querySelector('.app-shell-nav-panel > .app-shell-org-full');
        expect(line.hidden).toBe(true);
        expect(root.querySelector('.app-shell-nav-panel').firstElementChild).toBe(line);
        shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-b' });
        expect(line.hidden).toBe(false);
        expect(line.textContent).toBe('Organisation: Bravo Roasters');
        expect(line.getAttribute('aria-hidden')).toBe('true');
        shell.setOrganisation({ orgs: [], activeOrgId: null });
        expect(line.hidden).toBe(true);
      });

      it('puts the full name in a tooltip on the label and the select, for a pointer user', () => {
        const { shell, slot, select } = mountWithShell();
        const long = { id: 'org-l', name: 'Greymatter Coffee Werks Roasters and Cafe', slug: 'gm' };
        shell.setOrganisation({ orgs: [long], activeOrgId: 'org-l' });
        expect(slot.querySelector('.app-shell-org-label').title).toBe(long.name);
        shell.setOrganisation({ orgs: [long, ORG_A], activeOrgId: 'org-l' });
        expect(select().title).toBe(long.name);
      });

      it('names a nameless organisation by its slug, and keeps the hint attached after a label becomes a select', () => {
        const { shell, slot, select } = mountWithShell();
        const nameless = { id: 'org-n', name: '', slug: 'no-name-co' };
        shell.setOrganisation({ orgs: [nameless], activeOrgId: 'org-n' });
        expect(slot.textContent).toBe('Organisation: no-name-co');
        shell.setOrganisation({ orgs: [nameless, ORG_A], activeOrgId: 'org-n' });
        expect(select().options[0].textContent).toBe('no-name-co');
        expect(slot.querySelector('#app-shell-org-hint')).not.toBeNull();
      });

      it('writes an announcement as text, never as markup', () => {
        const { shell, notice } = mountWithShell();
        shell.announceOrganisation('Now working in <img src=x onerror=alert(1)>. Showing Events.');
        expect(notice.querySelector('img')).toBeNull();
        expect(notice.textContent).toContain('<img src=x onerror=alert(1)>');
      });
    });

    describe('announcing', () => {
      it('speaks to a screen reader without opening the visible panel, and replaces a refusal', async () => {
        const { shell, notice, select } = mountWithShell();
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        select().value = 'org-b';
        select().dispatchEvent(new Event('change', { bubbles: true }));
        await tick();
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(true);

        shell.announceOrganisation('Now working in Bravo Roasters. Showing Events.');
        expect(notice.textContent).toBe('Now working in Bravo Roasters. Showing Events.');
        expect(notice.classList.contains('app-shell-org-notice-open')).toBe(false);
      });

      it('uses the one persistent live region, so it is announced reliably', () => {
        const { shell, notice, root } = mountWithShell();
        shell.announceOrganisation('Now working in Alpha Coffee. Showing Events.');
        expect(root.querySelector('#app-shell-org-notice')).toBe(notice);
        expect(notice.getAttribute('aria-live')).toBe('polite');
      });
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
    expect(root.querySelector('span.app-shell-sync-chip').hidden).toBe(false);
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
    // The chip says so in words, not only in the danger colour: an ordinary in-flight write is
    // "Not synced (1)", a stuck one "Sync failing (1)" (colour alone can't be relied on).
    const chip = root.querySelector('button.app-shell-sync-chip');
    expect(chip.textContent).toBe('Sync failing (1)');
    expect(chip.classList.contains('app-shell-sync-chip-stuck')).toBe(true);
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
      expect(root.querySelector('span.app-shell-sync-chip').hidden).toBe(true);
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

  // The sync status is a one-line chip in the header, so the sticky header is
  // the same height in every status (2026-10-08, user-reported: the old
  // full-width "Synced" row kept the header two rows tall). That row had been
  // added on purpose (ui-accessibility-reviewer, 2026-09-27): a status that
  // wrapped to two lines grew the header mid-heat and shifted the Stop
  // buttons under a judge's finger. The chip keeps that guarantee by being
  // short and single-line in every state; the long sentence is the live
  // region, clipped away until a problem chip is tapped, then overlaid under
  // the header instead of pushed into it. jsdom does no layout, so these pin
  // the markup and the CSS rules behind the guarantee; the heights were
  // measured in a real browser at 320/360/640/768/1024/1366/1440px in the live,
  // stuck and open states.
  describe('header status chip (no header shift)', () => {
    const button = (root) => root.querySelector('button.app-shell-sync-chip');
    const staticChip = (root) => root.querySelector('span.app-shell-sync-chip');
    const context = (root) => root.querySelector('.app-shell-context');

    it('puts the status next to the event name inside the header, and shows nothing while there is nothing to report', async () => {
      const root = document.createElement('div');
      mountTracked(root, { client: fakeClient({}) }); // no event context: 'off'
      await tick(30);
      const header = root.querySelector('.app-shell-header');
      expect(button(root).parentElement).toBe(context(root));
      expect(staticChip(root).parentElement).toBe(context(root));
      expect(root.querySelector('.app-shell-sync').parentElement).toBe(context(root));
      expect(context(root).parentElement).toBe(header);
      expect(context(root).contains(root.querySelector('.app-shell-breadcrumb'))).toBe(true);
      expect(root.querySelector('.app-shell-sync').textContent).toBe('');
      expect(button(root).hidden).toBe(true);
      expect(staticChip(root).hidden).toBe(true);
      // Nothing to put in the row, so it takes no space of its own.
      expect(context(root).classList.contains('app-shell-context-empty')).toBe(true);
    });

    it('shows each status as ONE short chip, and the live region keeps the full sentence', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, {
        client: fakeClient({}),
        syncPollMs: 20,
        dropCheckMs: 10,
      });
      await setNav({ eventId: 'ev1', links: [] });
      const syncEl = root.querySelector('.app-shell-sync');
      const seen = [];
      const record = () =>
        seen.push({
          chip: button(root).hidden ? staticChip(root).textContent : button(root).textContent,
          buttonShown: !button(root).hidden,
          staticShown: !staticChip(root).hidden,
          full: syncEl.textContent,
        });
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

      expect(seen).toEqual([
        { chip: 'Synced', buttonShown: false, staticShown: true, full: 'Synced' },
        {
          chip: 'Not synced (1)',
          buttonShown: true,
          staticShown: false,
          full: 'Not synced (1 pending)',
        },
        {
          chip: '1 write lost',
          buttonShown: true,
          staticShown: false,
          full: '1 write lost — not saved and not retried',
        },
      ]);
      expect(button(root).classList.contains('app-shell-sync-chip-stuck')).toBe(true);
    });

    it('never rebuilds the live region or the chips: the same nodes are mutated through every status', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}), syncPollMs: 20 });
      await setNav({ eventId: 'ev1', links: [] });
      const nodes = [root.querySelector('.app-shell-sync'), button(root), staticChip(root)];
      await flush(() => expect(nodes[0].textContent).toBe('Synced'));
      await enqueueOperation('confirm_heat', { heatId: 'h1' });
      await flush(() => expect(nodes[0].textContent).toBe('Not synced (1 pending)'));
      expect(root.querySelector('.app-shell-sync')).toBe(nodes[0]);
      expect(button(root)).toBe(nodes[1]);
      expect(staticChip(root)).toBe(nodes[2]);
      for (const [i, node] of nodes.entries()) {
        expect(root.contains(node), `node ${i}`).toBe(true);
      }
      expect(nodes[0].getAttribute('role')).toBe('status');
      expect(nodes[0].getAttribute('aria-live')).toBe('polite');
    });

    it('hides the decorative "Synced" chip from assistive tech (the live region already says it) and never shows it next to a problem', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}), syncPollMs: 20 });
      await setNav({ eventId: 'ev1', links: [] });
      await flush(() => expect(staticChip(root).hidden).toBe(false));
      expect(staticChip(root).getAttribute('aria-hidden')).toBe('true');
      expect(staticChip(root).querySelector('.status-live-dot')).not.toBeNull();
      await enqueueOperation('confirm_heat', { heatId: 'h1' });
      await flush(() => expect(staticChip(root).hidden).toBe(true));
      expect(button(root).hidden).toBe(false);
    });

    it('is closed to start with: the button names the detail it controls and says it is collapsed', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}), syncPollMs: 20 });
      await setNav({ eventId: 'ev1', links: [] });
      await enqueueOperation('confirm_heat', { heatId: 'h1' });
      await flush(() => expect(button(root).hidden).toBe(false));
      expect(button(root).getAttribute('type')).toBe('button');
      expect(button(root).getAttribute('aria-expanded')).toBe('false');
      const controlled = root.querySelector(`#${button(root).getAttribute('aria-controls')}`);
      expect(controlled).toBe(root.querySelector('.app-shell-sync'));
      expect(controlled.classList.contains('app-shell-sync-open')).toBe(false);
    });

    describe('the detail panel', () => {
      async function mountWithPending() {
        const root = document.createElement('div');
        document.body.append(root);
        const shell = mountTracked(root, { client: fakeClient({}), syncPollMs: 20 });
        const { setNav } = shell;
        await setNav({ eventId: 'ev1', links: [] });
        await enqueueOperation('confirm_heat', { heatId: 'h1' });
        await flush(() => expect(button(root).hidden).toBe(false));
        return { root, setNav, shell };
      }
      afterEach(() => {
        document.body.innerHTML = '';
      });

      it('opens on a tap and shows the full sentence, in the live region itself', async () => {
        const { root } = await mountWithPending();
        button(root).click();
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
        const panel = root.querySelector('.app-shell-sync');
        expect(panel.classList.contains('app-shell-sync-open')).toBe(true);
        expect(panel.textContent).toBe('Not synced (1 pending)');
        expect(panel.getAttribute('role')).toBe('status');
        button(root).click();
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(panel.classList.contains('app-shell-sync-open')).toBe(false);
      });

      it('closes when a refused organisation switch opens its own panel in the same place', async () => {
        const { root, shell } = await mountWithPending();
        const ORG_A = { id: 'org-a', name: 'Alpha Coffee', slug: 'alpha-coffee' };
        const ORG_B = { id: 'org-b', name: 'Bravo Roasters', slug: 'bravo-roasters' };
        shell.setOrganisation({
          orgs: [ORG_A, ORG_B],
          activeOrgId: 'org-a',
          onSelect: async () => ({ ok: false, message: 'Not yet.' }),
        });
        button(root).click();
        const panel = root.querySelector('.app-shell-sync');
        expect(panel.classList.contains('app-shell-sync-open')).toBe(true);

        const select = root.querySelector('.app-shell-org-select');
        select.value = 'org-b';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(root.querySelector('#app-shell-org-notice').textContent).toBe('Not yet.');
        expect(panel.classList.contains('app-shell-sync-open')).toBe(false);
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
      });

      it('stays open (and keeps its own class) while the status text changes underneath it', async () => {
        const { root } = await mountWithPending();
        button(root).click();
        await enqueueOperation('confirm_heat', { heatId: 'h2' });
        await flush(() =>
          expect(root.querySelector('.app-shell-sync').textContent).toBe('Not synced (2 pending)'),
        );
        expect(
          root.querySelector('.app-shell-sync').classList.contains('app-shell-sync-open'),
        ).toBe(true);
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
      });

      it('closes on Escape and puts focus back on the chip', async () => {
        const { root } = await mountWithPending();
        button(root).click();
        document.body.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button(root));
      });

      it('ignores other keys', async () => {
        const { root } = await mountWithPending();
        button(root).click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
      });

      it('closes on a press anywhere outside it, but not on the chip or the panel itself', async () => {
        const { root } = await mountWithPending();
        const press = (target) =>
          target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
        button(root).click();
        press(root.querySelector('.app-shell-sync'));
        press(button(root));
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
        press(document.body);
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(
          root.querySelector('.app-shell-sync').classList.contains('app-shell-sync-open'),
        ).toBe(false);
      });

      it('closes when the status goes back to Synced, and moves focus off the chip that disappears', async () => {
        const { root } = await mountWithPending();
        button(root).focus();
        button(root).click();
        await flushOutbox({ confirm_heat: async () => ({ ok: true }) });
        await flush(() => expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced'));
        expect(button(root).hidden).toBe(true);
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(
          root.querySelector('.app-shell-sync').classList.contains('app-shell-sync-open'),
        ).toBe(false);
        // jsdom does no layout, so a hidden button keeps focus unless the shell moves it: it
        // must land on the Menu toggle (the toggle is displayed here), not stay on the chip.
        expect(document.activeElement).not.toBe(button(root));
        expect(document.activeElement).toBe(root.querySelector('.app-shell-nav-toggle'));
      });

      it('an Escape pressed elsewhere (a time or score field) closes the panel but leaves focus where it is', async () => {
        const { root } = await mountWithPending();
        const field = document.createElement('input');
        document.body.append(field);
        button(root).click();
        field.focus();
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(field);
      });

      it('closes when keyboard focus moves on from the chip, but not when it stays on it', async () => {
        const { root } = await mountWithPending();
        button(root).focus();
        button(root).click();
        button(root).dispatchEvent(
          new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
        );
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
        button(root).dispatchEvent(
          new FocusEvent('focusout', { bubbles: true, relatedTarget: button(root) }),
        );
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
        button(root).dispatchEvent(
          new FocusEvent('focusout', {
            bubbles: true,
            relatedTarget: root.querySelector('.app-shell-nav-toggle'),
          }),
        );
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
      });

      it('once closed, neither Escape nor a press outside does anything', async () => {
        const { root } = await mountWithPending();
        const focus = vi.spyOn(button(root), 'focus');
        button(root).click();
        button(root).click(); // closed again
        focus.mockClear();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(focus).not.toHaveBeenCalled();
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
      });

      it('closes when the status goes back to Synced even if the chip never had focus', async () => {
        const { root } = await mountWithPending();
        button(root).click(); // a mouse/touch press: opens it, focus stays elsewhere
        expect(button(root).getAttribute('aria-expanded')).toBe('true');
        await flushOutbox({ confirm_heat: async () => ({ ok: true }) });
        await flush(() => expect(root.querySelector('.app-shell-sync').textContent).toBe('Synced'));
        expect(button(root).getAttribute('aria-expanded')).toBe('false');
        expect(
          root.querySelector('.app-shell-sync').classList.contains('app-shell-sync-open'),
        ).toBe(false);
      });

      it('stops listening to the document once closed and after unmount', async () => {
        const add = vi.spyOn(document, 'addEventListener');
        const remove = vi.spyOn(document, 'removeEventListener');
        try {
          const { root, shell } = await mountWithPending();
          const count = (spy, type) => spy.mock.calls.filter(([t]) => t === type).length;
          const baseAdd = [count(add, 'pointerdown'), count(add, 'keydown')];
          button(root).click();
          expect(count(add, 'pointerdown')).toBe(baseAdd[0] + 1);
          expect(count(add, 'keydown')).toBe(baseAdd[1] + 1);
          button(root).click();
          expect(count(remove, 'keydown')).toBeGreaterThanOrEqual(1);
          const removedBefore = count(remove, 'pointerdown');
          button(root).click(); // open again, then leave it open
          shell.unmount();
          expect(count(remove, 'pointerdown')).toBe(removedBefore + 1);
        } finally {
          add.mockRestore();
          remove.mockRestore();
        }
      });
    });

    describe('the event-name row', () => {
      it('exists while there is an event name, and while there is a status to show', async () => {
        const root = document.createElement('div');
        const { setNav } = mountTracked(root, {
          client: fakeClient({ ev1: { id: 'ev1', name: 'October Cup' } }),
          syncPollMs: 20,
        });
        await tick(30);
        expect(context(root).classList.contains('app-shell-context-empty')).toBe(true);
        await setNav({ eventId: 'ev1', links: [] });
        await flush(() =>
          expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('October Cup'),
        );
        expect(context(root).classList.contains('app-shell-context-empty')).toBe(false);
        await setNav({ eventId: null, links: [] });
        await flush(() =>
          expect(context(root).classList.contains('app-shell-context-empty')).toBe(true),
        );
      });

      it('keeps the row for a status with no event name (a write lost on the events list)', async () => {
        const root = document.createElement('div');
        mountTracked(root, { client: fakeClient({}), syncPollMs: 60000, dropCheckMs: 10 });
        await tick(30);
        expect(context(root).classList.contains('app-shell-context-empty')).toBe(true);
        await enqueueOperation('doomed_op', {});
        await flushOutbox({
          doomed_op: async () => {
            throw permanentError('stale conflict');
          },
        });
        await flush(() =>
          expect(root.querySelector('.app-shell-sync').textContent).toBe(
            '1 write lost — not saved and not retried',
          ),
        );
        expect(context(root).classList.contains('app-shell-context-empty')).toBe(false);
        expect(button(root).textContent).toBe('1 write lost');
      });
    });

    it('shows the immediate "Not synced" chip when a drop lands on an empty panel', async () => {
      const root = document.createElement('div');
      mountTracked(root, { client: fakeClient({}), syncPollMs: 60000, dropCheckMs: 10 });
      await tick(30);
      expect(context(root).classList.contains('app-shell-context-empty')).toBe(true);
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
        expect(context(root).classList.contains('app-shell-context-empty')).toBe(false);
        expect(button(root).hidden).toBe(false);
        // Worded apart from the pending chip's "Not synced (N)": the two differ in text, not only colour.
        expect(button(root).textContent).toBe('Sync failing');
        expect(button(root).classList.contains('app-shell-sync-chip-stuck')).toBe(true);
      } finally {
        release();
        await running;
      }
      // test-auditor, 2026-09-27: the announced notice, still with no event
      // context, must stay up — keyed on the event context instead, a loss on
      // the events list would vanish.
      await flush(() =>
        expect(root.querySelector('.app-shell-sync').textContent).toBe(
          '1 write lost — not saved and not retried',
        ),
      );
      expect(context(root).classList.contains('app-shell-context-empty')).toBe(false);
      expect(button(root).textContent).toBe('1 write lost');
    });

    it('releases the chip when navigation leaves the event and nothing is pending or lost', async () => {
      const root = document.createElement('div');
      const { setNav } = mountTracked(root, { client: fakeClient({}) });
      await setNav({ eventId: 'ev1', links: [] });
      await flush(() => expect(staticChip(root).hidden).toBe(false));
      await setNav({ eventId: null, links: [] });
      await flush(() => expect(staticChip(root).hidden).toBe(true));
      expect(button(root).hidden).toBe(true);
      expect(context(root).classList.contains('app-shell-context-empty')).toBe(true);
    });

    // jsdom does no layout; this pins the CSS half of the guarantee against
    // accidental deletion, from the source text (same approach as
    // countdown.test.js). Walks the whole stylesheet block by block, so a late
    // override or a media-query copy can't slip past a check of one rule.
    describe('appShell.css', () => {
      let css;
      let blocks;
      beforeAll(async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = path.dirname(fileURLToPath(import.meta.url));
        css = fs
          .readFileSync(path.join(dir, 'appShell.css'), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '');
        blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
          selector: selector.trim().replace(/\s+/g, ' '),
          body,
        }));
      });
      const decls = (selectorRe) =>
        blocks
          .filter((b) => selectorRe.test(b.selector))
          .map((b) => b.body)
          .join(';');

      it('makes every chip one line of one fixed height, whatever the status', () => {
        const base = blocks.filter((b) => b.selector === '.app-shell-sync-chip');
        expect(base).toHaveLength(1);
        expect(base[0].body).toMatch(/white-space:\s*nowrap/);
        expect(base[0].body).toMatch(/min-height:\s*var\(--app-shell-chip-height\)/);
        expect(base[0].body).toMatch(/line-height:\s*var\(--leading-normal\)/);
        // The invisible border (drawn in forced-colors mode) is paid for out of the padding, so the
        // chip is still exactly one line of text plus the pill padding tall.
        expect(base[0].body).toMatch(/border:\s*var\(--border-hairline\) solid transparent/);
        expect(base[0].body).toMatch(
          /padding:\s*calc\(var\(--space-1\) - var\(--border-hairline\)\) 0/,
        );
        expect(base[0].body).toMatch(/font-size:\s*var\(--text-sm\)/);
        // A status variant may recolour, pad sideways and embolden; it must not change what
        // sets the chip's height.
        const variants = decls(/\.app-shell-sync-chip-(pending|stuck|live)/);
        expect(variants).not.toMatch(/(font-size|line-height|min-height|height|white-space)\s*:/);
        // And the chip's height is exactly one line of text plus the pill padding.
        expect(css).toMatch(
          /--app-shell-chip-height:\s*calc\(var\(--leading-normal\) \* var\(--text-sm\) \+ 2 \* var\(--space-1\)\)/,
        );
        // A hidden chip must really hide (display: inline-flex would override [hidden]).
        expect(css).toMatch(/\.app-shell-sync-chip\[hidden\]\s*\{\s*display:\s*none/);
      });

      // The checks above look at the rules by name; a late override under ANOTHER selector (a
      // longer one, an extra class) would beat them without touching them. So: every block that
      // mentions the sync chip, the live region or the context row, and sets a property that can
      // change the header's height or take the chip out of its line, must be one we know about.
      it('lets only the known rules set layout-changing properties on the sync chip, live region and context row', () => {
        const LAYOUT =
          /(?:^|;)\s*(position|display|flex|flex-basis|flex-grow|flex-shrink|white-space|order|float|width|height|min-height|max-height|inset|top|right|bottom|left|margin)\s*:/g;
        const found = blocks
          .filter((b) => /app-shell-(sync|context)/.test(b.selector))
          .map((b) => {
            const props = [...b.body.matchAll(LAYOUT)].map((m) => m[1]);
            return props.length
              ? `${b.selector} => ${[...new Set(props)].sort().join(', ')}`
              : null;
          })
          .filter(Boolean)
          .sort();
        expect(found).toEqual(
          [
            '.app-shell-context => display, flex, min-height, order',
            '.app-shell-context => display',
            '.app-shell-context-empty => display',
            '.app-shell-sync => height, margin, position, white-space, width',
            '.app-shell-sync-chip => display, flex, min-height, position, white-space',
            '.app-shell-sync-chip[hidden] => display',
            '.app-shell-sync-chip-pending::after, .app-shell-sync-chip-stuck::after => inset, position',
            '.app-shell-sync.app-shell-sync-open => height, left, margin, right, top, white-space, width',
            '.app-shell-sync.app-shell-sync-open => left, width',
          ].sort(),
        );
        // The old reserved full-width row (the header's permanent second line) must not come back.
        expect(css).not.toMatch(/app-shell-sync-row/);
      });

      it('clips the live region away until opened, and opens it as an overlay that takes no layout space', () => {
        const base = blocks.filter((b) => b.selector === '.app-shell-sync');
        expect(base).toHaveLength(1);
        for (const d of [
          /position:\s*absolute/,
          /width:\s*1px/,
          /height:\s*1px/,
          /overflow:\s*hidden/,
          /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/,
          /white-space:\s*nowrap/,
          /padding:\s*0/,
          /border:\s*0/,
        ]) {
          expect(base[0].body).toMatch(d);
        }
        const open = decls(/^\.app-shell-sync\.app-shell-sync-open$/);
        expect(open).toMatch(/top:\s*100%/);
        // Stays absolute (inherited from the base rule): never position: static/relative/sticky.
        expect(open).not.toMatch(/position\s*:/);
        expect(open).toMatch(/background:\s*var\(--color-surface\)/);
        expect(open).toMatch(/white-space:\s*normal/);
      });

      it('lays the event-name row out as its own phone row, and dissolves it from 640px up', () => {
        const phone = blocks.filter((b) => b.selector === '.app-shell-context');
        expect(phone.length).toBeGreaterThanOrEqual(2); // the base rule and the 640px one
        expect(phone[0].body).toMatch(/display:\s*flex/);
        expect(phone[0].body).toMatch(/flex:\s*1 1 100%/);
        expect(phone[0].body).toMatch(/min-height:\s*var\(--app-shell-chip-height\)/);
        expect(css).toMatch(
          /@media \(min-width: 640px\)\s*\{\s*\.app-shell-context\s*\{\s*display:\s*contents/,
        );
        expect(decls(/^\.app-shell-context-empty$/)).toMatch(/display:\s*contents/);
      });

      it('truncates the event name instead of wrapping it, so a long name can never grow the header', () => {
        const crumb = decls(/^\.app-shell-breadcrumb$/);
        expect(crumb).toMatch(/white-space:\s*nowrap/);
        expect(crumb).toMatch(/text-overflow:\s*ellipsis/);
        expect(crumb).toMatch(/overflow:\s*hidden/);
        expect(crumb).toMatch(/min-width:\s*0/);
        expect(crumb).toMatch(/flex:\s*1 1 0/);
      });
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

// ---------------------------------------------------------------------------------------------
// T-TEN.C6: one browser's outbox is shared by every account and organisation that uses the device.
// What waits for somebody else is reported (never run, never dropped), and signing out says what it
// leaves behind.
// ---------------------------------------------------------------------------------------------
describe('mountAppShell — work that belongs to somebody else (T-TEN.C6)', () => {
  const ALICE = { userId: 'alice', orgId: 'org1' };
  const BOB = { userId: 'bob', orgId: 'org1' };
  const ORG_A = { id: 'org1', name: 'Alpha Coffee', slug: 'alpha-coffee' };
  const ORG_B = { id: 'org2', name: 'Bravo Roasters', slug: 'bravo-roasters' };
  const ORG_C = { id: 'org3', name: 'Charlie Beans', slug: 'charlie-beans' };
  const queue = (heat, org = 'org1') =>
    enqueueOperation('confirm_heat', { p_org_id: org, p_heat_id: heat });
  const detail = (root) => root.querySelector('.app-shell-sync');
  const chip = (root) => root.querySelector('button.app-shell-sync-chip');
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  function signedInClient(email = 'alice@test.com') {
    let listener = null;
    const auth = {
      signOut: vi.fn(() => Promise.resolve({ error: null })),
      onAuthStateChange: (cb) => {
        listener = cb;
        cb('SIGNED_IN', { user: { id: 'u1', email } });
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    };
    return { auth, from: () => ({}), fire: (event, session) => listener(event, session) };
  }
  function mount(options = {}) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = mountAppShell(root, { client: signedInClient(), syncPollMs: 20, ...options });
    return { root, shell };
  }

  beforeEach(async () => {
    await _clearAllForTests();
    _resetOutboxOwnerForTests();
    location.hash = '';
  });
  afterEach(() => {
    _resetOutboxOwnerForTests();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('the sync panel', () => {
    it("says so when the only unsynced changes on the device are another account's, and how to send them", async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      setOutboxOwner(BOB);
      const { root } = mount();
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '1 unsynced change from another account. Sign in as that account to send it.',
        ),
      );
      expect(chip(root).hidden).toBe(false);
      expect(chip(root).textContent).toBe('Unsent (1 other)');
    });

    it("pluralises, and does not count them as this account's own pending", async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      await queue('h2');
      setOutboxOwner(BOB);
      const { root } = mount();
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '2 unsynced changes from another account. Sign in as that account to send them.',
        ),
      );
      expect(detail(root).textContent).not.toContain('pending');
    });

    it("names the organisation when the account's own changes are waiting in another one", async () => {
      setOutboxOwner(ALICE);
      await queue('h1', 'org1');
      setOutboxOwner({ userId: 'alice', orgId: 'org2' });
      const { root, shell } = mount();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org2', onSelect: () => {} });
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '1 unsynced change waiting in Alpha Coffee. Switch to it to send it.',
        ),
      );
    });

    it('does not guess a name when the changes are in several organisations', async () => {
      setOutboxOwner(ALICE);
      await queue('h1', 'org1');
      await queue('h2', 'org2');
      setOutboxOwner({ userId: 'alice', orgId: 'org3' });
      const { root, shell } = mount();
      shell.setOrganisation({
        orgs: [ORG_A, ORG_B, ORG_C],
        activeOrgId: 'org3',
        onSelect: () => {},
      });
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '2 unsynced changes waiting in another of your organisations. Switch to it to send them.',
        ),
      );
    });

    it('does not offer to switch to an organisation this account is not part of', async () => {
      setOutboxOwner(ALICE);
      await queue('h1', 'org9');
      setOutboxOwner({ userId: 'alice', orgId: 'org2' });
      const { root, shell } = mount();
      shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org2', onSelect: () => {} });
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '1 unsynced change from an organisation this account is not part of. It stays on this device.',
        ),
      );
      expect(detail(root).textContent).not.toContain('Switch');
    });

    it("says it plainly when there is both another account's and another organisation's", async () => {
      setOutboxOwner(ALICE);
      await queue('h1', 'org1');
      setOutboxOwner(BOB);
      await queue('h2', 'org1');
      setOutboxOwner({ userId: 'alice', orgId: 'org2' });
      const { root } = mount();
      await vi.waitFor(() =>
        expect(detail(root).textContent).toBe(
          '2 unsynced changes are waiting for another account or organisation.',
        ),
      );
    });

    it("keeps this account's own pending count as it was while it has work waiting (a live region that changes as they score)", async () => {
      setOutboxOwner(ALICE);
      await queue('mine');
      setOutboxOwner(BOB);
      await queue('theirs');
      setOutboxOwner(ALICE);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Not synced (1 pending)'));
      expect(chip(root).textContent).toBe('Not synced (1)');
      // Several polls later it has not grown a second sentence.
      await tick(100);
      expect(detail(root).textContent).toBe('Not synced (1 pending)');
    });

    it("says what waits for somebody else once this account's own work has gone", async () => {
      setOutboxOwner(ALICE);
      await queue('mine');
      setOutboxOwner(BOB);
      await queue('theirs');
      setOutboxOwner(ALICE);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Not synced (1 pending)'));
      await flushOutbox({ confirm_heat: () => Promise.resolve() });
      await vi.waitFor(() => expect(detail(root).textContent).toContain('from another account'));
    });

    it("stays on what it was showing, and never says 'Synced', when the read fails", async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      setOutboxOwner(BOB);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toContain('from another account'));
      const realGetAll = IDBIndex.prototype.getAll;
      IDBIndex.prototype.getAll = () => {
        throw new Error('idb down');
      };
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await tick(100);
        expect(detail(root).textContent).toContain('from another account');
        expect(detail(root).textContent).not.toContain('Synced');
      } finally {
        IDBIndex.prototype.getAll = realGetAll;
        logged.mockRestore();
      }
    });

    it("says nothing yet, rather than 'waiting in another organisation', while the organisation is still loading", async () => {
      setOutboxOwner(ALICE);
      await queue('mine', 'org1');
      setOutboxOwner({ userId: 'alice', orgId: null });
      const { root } = mount();
      await tick(100);
      expect(chip(root).hidden).toBe(true);
      expect(detail(root).textContent).not.toContain('another');
      expect(detail(root).textContent).not.toBe('Synced');
      // ...and tells the truth once it is known
      setOutboxOwner(ALICE);
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Not synced (1 pending)'));
    });

    it('updates when more changes of somebody else arrive', async () => {
      setOutboxOwner(ALICE);
      await queue('theirs-1');
      setOutboxOwner(BOB);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toContain('1 unsynced change from'));
      setOutboxOwner(ALICE);
      await queue('theirs-2');
      setOutboxOwner(BOB);
      await vi.waitFor(() => expect(detail(root).textContent).toContain('2 unsynced changes from'));
    });

    it('updates when the changes waiting are in a different organisation but the count is the same', async () => {
      setOutboxOwner(ALICE);
      await queue('a1', 'org1');
      setOutboxOwner({ userId: 'alice', orgId: 'org3' });
      const { root, shell } = mount();
      shell.setOrganisation({
        orgs: [ORG_A, ORG_B, ORG_C],
        activeOrgId: 'org3',
        onSelect: () => {},
      });
      await vi.waitFor(() => expect(detail(root).textContent).toContain('waiting in Alpha Coffee'));
      await outboxRemove((await outboxListAll())[0].id);
      await queue('b1', 'org2');
      await vi.waitFor(() =>
        expect(detail(root).textContent).toContain('waiting in Bravo Roasters'),
      );
    });

    it("is 'Synced' when everything on the device is this account's own, in this organisation (and was read: a change arrives later and shows)", async () => {
      setOutboxOwner(ALICE);
      const { root, shell } = mount();
      await shell.setNav({ eventId: 'ev1', links: [] });
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Synced'));
      // Several polls with an own change and a legacy change that names no organisation: still own
      // work, never reported as somebody else's.
      await queue('mine');
      await outboxPut({
        id: 'legacy-1',
        type: 'confirm_heat',
        payload: { p_heat_id: 'old' },
        createdAt: Date.now() + 1,
        attempts: 0,
        lastError: null,
      });
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Not synced (2 pending)'));
      await tick(100);
      expect(detail(root).textContent).toBe('Not synced (2 pending)');
      expect(detail(root).textContent).not.toContain('other');
    });

    it("follows the owner: the same change is somebody else's and then this account's again", async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      setOutboxOwner(BOB);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toContain('from another account'));
      setOutboxOwner(ALICE);
      await vi.waitFor(() => expect(detail(root).textContent).toBe('Not synced (1 pending)'));
    });

    it('signed out, says the changes wait for their account to sign in', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      setOutboxOwner(null);
      const { root } = mount();
      await vi.waitFor(() => expect(detail(root).textContent).toContain('from another account'));
    });
  });

  describe('Sign out with changes that have not synced', () => {
    const signOutButton = (root) =>
      [...root.querySelectorAll('button')].find((b) => /^Sign out/.test(b.textContent));
    const notice = (root) => root.querySelector('.app-shell-org-notice');
    const noticeOpen = (root) => notice(root).classList.contains('app-shell-org-notice-open');
    const click = (button) => button.dispatchEvent(new Event('click', { bubbles: true }));
    const press = (button) => {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      click(button);
    };
    const quick = { signOutArmGraceMs: 0 };
    const WARNING_2 =
      '2 changes have not been sent yet. They stay on this device and are sent once alice@test.com is signed in. To sign out now, press Sign out again.';

    it('goes straight through when nothing is waiting', async () => {
      setOutboxOwner(ALICE);
      const client = signedInClient();
      const { root } = mount({ client });
      click(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
      expect(noticeOpen(root)).toBe(false);
    });

    it('first says how many are waiting and what happens to them, under the header, and does not sign out', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      await queue('h2');
      const client = signedInClient('alice@test.com');
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(notice(root).textContent).toBe(WARNING_2));
      // In the overlay region, not in the header's own row (the header must never grow).
      expect(noticeOpen(root)).toBe(true);
      expect(notice(root).getAttribute('role')).toBe('status');
      expect(root.querySelector('.app-shell-auth-status').textContent).toBe('');
      expect(client.auth.signOut).not.toHaveBeenCalled();
      expect(noticeOpen(root)).toBe(true);
      // nothing was thrown away by asking
      expect(await countPendingOperations()).toBe(2);
    });

    it('says it in the singular', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const { root } = mount(quick);
      click(signOutButton(root));
      await vi.waitFor(() =>
        expect(notice(root).textContent).toBe(
          '1 change has not been sent yet. It stays on this device and is sent once alice@test.com is signed in. To sign out now, press Sign out again.',
        ),
      );
    });

    it('says "this account" when it does not know the email', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient('');
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() =>
        expect(notice(root).textContent).toContain('once this account is signed in'),
      );
    });

    it('signs out on the second press, and still keeps the changes for their owner', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      click(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
      expect(await outboxListAll()).toHaveLength(1);
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(false));
    });

    it('ignores a press that follows at once (a double tap has not read the warning)', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      click(signOutButton(root));
      await tick(50);
      expect(client.auth.signOut).not.toHaveBeenCalled();
      expect(noticeOpen(root)).toBe(true);
    });

    it('ignores a second press while the first is still counting', async () => {
      setOutboxOwner(ALICE);
      let release;
      const accountOperations = vi.fn(() => new Promise((resolve) => (release = resolve)));
      const client = signedInClient();
      const { root } = mount({ client, accountOperations, ...quick });
      click(signOutButton(root));
      click(signOutButton(root));
      expect(accountOperations).toHaveBeenCalledTimes(1);
      release([]);
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
    });

    it('stays armed when the sign-out itself fails, so the next press tries again without a new warning', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      client.auth.signOut.mockResolvedValueOnce({ error: new Error('network') });
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      click(signOutButton(root));
      await vi.waitFor(() =>
        expect(root.querySelector('.app-shell-auth-status').textContent).toBe(
          SIGN_OUT_FAILED_MESSAGE,
        ),
      );
      expect(noticeOpen(root)).toBe(true);
      click(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(2));
    });

    it('withdraws the warning after a while: the count was as of when it was shown', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const { root } = mount({ ...quick, signOutArmMs: 200 });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(false));
      expect(signOutButton(root).textContent).toBe('Sign out');
      expect(notice(root).textContent).toBe('');
    });

    it('withdraws it when the menu is closed', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const { root } = mount(quick);
      const toggle = root.querySelector('.app-shell-nav-toggle');
      click(toggle);
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      click(toggle);
      expect(noticeOpen(root)).toBe(false);
      expect(signOutButton(root).textContent).toBe('Sign out');
    });

    it('closing the menu with Escape withdraws it too, and the next press counts afresh', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(root.querySelector('.app-shell-nav-toggle'));
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      signOutButton(root).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(noticeOpen(root)).toBe(false);
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      expect(client.auth.signOut).not.toHaveBeenCalled();
    });

    it('after the warning was dismissed, the next press warns again instead of signing out', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(noticeOpen(root)).toBe(false);
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      expect(client.auth.signOut).not.toHaveBeenCalled();
    });

    it('withdraws it when the person taps anywhere else, but not when they press the button it is about', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      // the press on the button itself (pointerdown, then click) is the confirmation, not a dismissal
      press(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));

      const again = mount({ ...quick });
      click(signOutButton(again.root));
      await vi.waitFor(() => expect(noticeOpen(again.root)).toBe(true));
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(noticeOpen(again.root)).toBe(false);
      expect(signOutButton(again.root).textContent).toBe('Sign out');
    });

    it('keeps the half-confirmed sign-out when the same session is announced again', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      const button = signOutButton(root);
      client.fire('TOKEN_REFRESHED', { user: { id: 'u1', email: 'alice@test.com' } });
      expect(signOutButton(root)).toBe(button);
      expect(noticeOpen(root)).toBe(true);
      expect(noticeOpen(root)).toBe(true);
    });

    it('a different person gets a fresh, unarmed button', async () => {
      setOutboxOwner(ALICE);
      await queue('h1');
      const client = signedInClient();
      const { root } = mount({ client, ...quick });
      click(signOutButton(root));
      await vi.waitFor(() => expect(noticeOpen(root)).toBe(true));
      client.fire('SIGNED_IN', { user: { id: 'u2', email: 'bob@test.com' } });
      expect(signOutButton(root).textContent).toBe('Sign out');
      expect(noticeOpen(root)).toBe(false);
    });

    it("counts the account's changes in every organisation, and never another account's", async () => {
      setOutboxOwner(ALICE);
      await queue('a1', 'org1');
      await queue('a2', 'org2');
      setOutboxOwner(BOB);
      await queue('b1', 'org1');
      setOutboxOwner(ALICE);
      const { root } = mount(quick);
      click(signOutButton(root));
      await vi.waitFor(() => expect(notice(root).textContent).toContain('2 changes have not'));
    });

    it("does not warn the signed-in account about somebody else's changes", async () => {
      setOutboxOwner(ALICE);
      await queue('a1');
      setOutboxOwner(BOB);
      const client = signedInClient('bob@test.com');
      const { root } = mount({ client });
      click(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
    });

    it('when it cannot tell, says so and asks again rather than guessing either way', async () => {
      const client = signedInClient();
      const { root } = mount({
        client,
        ...quick,
        accountOperations: () => Promise.reject(new Error('indexeddb unavailable')),
      });
      click(signOutButton(root));
      await vi.waitFor(() => expect(notice(root).textContent).toBe(SIGN_OUT_UNCHECKED_MESSAGE));
      expect(client.auth.signOut).not.toHaveBeenCalled();
      click(signOutButton(root));
      await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
    });
  });
});

describe('mountAppShell — showNotice (T-TEN.C7)', () => {
  const ORG_A = { id: 'a', name: 'A', slug: 'a' };
  const ORG_B = { id: 'b', name: 'B', slug: 'b' };
  function mountShell() {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = mountAppShell(root, { client: { auth: fakeAuth(), from: () => ({}) } });
    return { root, shell, notice: root.querySelector('.app-shell-org-notice') };
  }
  const isOpen = (notice) => notice.classList.contains('app-shell-org-notice-open');
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens a visible, polite notice that is not styled as an error, and a tap elsewhere closes it', () => {
    const { shell, notice } = mountShell();
    shell.showNotice('Now working in Org Two, the organisation this event belongs to.');
    expect(isOpen(notice)).toBe(true);
    expect(notice.textContent).toBe(
      'Now working in Org Two, the organisation this event belongs to.',
    );
    expect(notice.dataset.tone).toBe('info');
    expect(notice.getAttribute('role')).toBe('status');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen(notice)).toBe(false);
    expect(notice.textContent).toBe('');
    expect(notice.dataset.tone).toBeUndefined();
  });

  it('Escape closes it wherever focus is (the keyboard way to put it away)', () => {
    const { shell, notice } = mountShell();
    shell.showNotice('Now working in Org Two.');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen(notice)).toBe(false);
  });

  it('other keys leave it open', () => {
    const { shell, notice } = mountShell();
    shell.showNotice('Now working in Org Two.');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(isOpen(notice)).toBe(true);
  });

  it('dismissNotice puts it away (a notice does not follow the person to the next screen)', () => {
    const { shell, notice } = mountShell();
    shell.showNotice('Now working in Org Two.');
    shell.dismissNotice();
    expect(isOpen(notice)).toBe(false);
    expect(notice.dataset.tone).toBeUndefined();
  });

  it('a second notice replaces the first', () => {
    const { shell, notice } = mountShell();
    shell.showNotice('First.');
    shell.showNotice('Second.');
    expect(notice.textContent).toBe('Second.');
  });

  it('a refusal that follows a quiet notice is not quiet', async () => {
    const { shell, root, notice } = mountShell();
    shell.showNotice('Now working in Org Two.');
    shell.setOrganisation({
      orgs: [ORG_A, ORG_B],
      activeOrgId: 'a',
      onSelect: async () => ({ ok: false, message: 'Not yet.' }),
    });
    const select = root.querySelector('.app-shell-org select');
    select.value = 'b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notice.textContent).toBe('Not yet.');
    expect(notice.dataset.tone).toBeUndefined();
  });

  it('clearEventContext takes the event name out of the header and leaves the links', async () => {
    const { shell, root } = mountShell();
    await shell.setNav({
      eventId: null,
      links: [{ href: '#/events', label: 'Events' }],
    });
    root.querySelector('.app-shell-breadcrumb').textContent = 'October Cup';
    shell.clearEventContext();
    expect(root.querySelector('.app-shell-breadcrumb').textContent).toBe('');
    expect(root.querySelector('.app-shell-link')).not.toBeNull();
  });
});
