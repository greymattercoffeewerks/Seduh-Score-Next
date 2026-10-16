import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountShell, routeOf } from './shell.js';

const panel = (route, mount = () => ({ unmount() {} })) => ({
  id: route,
  label: route,
  route,
  mount,
});

describe('routeOf', () => {
  const panels = [panel('orgs'), panel('audit')];

  it('names a panel by the FIRST segment of the hash, so a detail address is still its panel', () => {
    expect(routeOf('#/orgs', panels).route).toBe('orgs');
    expect(routeOf('#/orgs/11111111-1111-4111-8111-111111111111', panels).route).toBe('orgs');
    expect(routeOf('#/audit/5', panels).route).toBe('audit');
    expect(routeOf('#audit', panels).route).toBe('audit');
  });

  it('shows the first panel for a hash that names none, including near misses', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/nowhere',
      '#/orgsx',
      '#/org',
      '#/ORGS',
      '#//orgs',
      undefined,
      null,
    ]) {
      expect(routeOf(hash, panels).route, String(hash)).toBe('orgs');
    }
  });
});

describe('the shell', () => {
  let root;
  let shell;

  function open(panels, options = {}) {
    root = document.createElement('div');
    document.body.appendChild(root);
    shell = mountShell(root, {
      panels,
      email: 'ops@example.test',
      ctx: {},
      onSignOut: async () => ({ ok: true }),
      onSignOutEverywhere: async () => ({ ok: true }),
      ...options,
    });
  }

  afterEach(() => {
    shell?.unmount();
    root?.remove();
    window.location.hash = '';
  });

  it('puts a skip button first, which moves focus to the content without changing the address', () => {
    window.location.hash = '#/orgs';
    open([panel('orgs')]);
    const first = root.firstElementChild;
    expect(first.tagName).toBe('BUTTON');
    expect(first.textContent).toBe('Skip to content');
    // a link to another hash would navigate the console, so it is a button
    expect(first.getAttribute('href')).toBeNull();
    first.click();
    expect(document.activeElement).toBe(root.querySelector('#admin-main'));
    expect(window.location.hash).toBe('#/orgs');
  });

  it('keeps the same panel mounted while the hash moves inside it, and swaps it for another panel', () => {
    const mountOrgs = vi.fn(() => ({ unmount: vi.fn() }));
    const mountAudit = vi.fn(() => ({ unmount: vi.fn() }));
    window.location.hash = '#/orgs';
    open([panel('orgs', mountOrgs), panel('audit', mountAudit)]);
    expect(mountOrgs).toHaveBeenCalledTimes(1);

    window.location.hash = '#/orgs/11111111-1111-4111-8111-111111111111';
    window.dispatchEvent(new Event('hashchange'));
    expect(mountOrgs).toHaveBeenCalledTimes(1);
    expect(root.querySelector('nav a[aria-current="page"]').dataset.route).toBe('orgs');

    window.location.hash = '#/audit';
    window.dispatchEvent(new Event('hashchange'));
    expect(mountAudit).toHaveBeenCalledTimes(1);
    expect(mountOrgs.mock.results[0].value.unmount).toHaveBeenCalledTimes(1);
    expect(root.querySelector('nav a[aria-current="page"]').dataset.route).toBe('audit');
  });

  it('rewrites a hash that names no panel to the first panel, so the page and the address agree', () => {
    for (const hash of ['', '#/', '#/nowhere', '#/orgsx/1']) {
      window.location.hash = hash;
      open([panel('orgs'), panel('audit')]);
      expect(window.location.hash, hash).toBe('#/orgs');
      shell.unmount();
      root.remove();
    }
  });

  it('leaves an address inside a panel exactly as it is', () => {
    const detail = '#/orgs/11111111-1111-4111-8111-111111111111';
    window.location.hash = detail;
    open([panel('orgs'), panel('audit')]);
    expect(window.location.hash).toBe(detail);
  });

  describe('a panel with something that cannot be got back (leaveWarning)', () => {
    const WARNING = 'The one-time password will be lost.';
    function twoPanels(warning) {
      const unmountFirst = vi.fn();
      const mountSecond = vi.fn(() => ({ unmount() {} }));
      const first = panel('orgs', () => ({ unmount: unmountFirst, leaveWarning: () => warning() }));
      return { unmountFirst, mountSecond, panels: [first, panel('audit', mountSecond)] };
    }
    const go = (hash) => {
      window.location.hash = hash;
      window.dispatchEvent(new Event('hashchange'));
    };

    it('asks before another panel replaces it, and stays (with the address put back) when the answer is no', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { unmountFirst, mountSecond, panels } = twoPanels(() => WARNING);
      window.location.hash = '#/orgs';
      open(panels);
      go('#/audit');
      expect(confirm).toHaveBeenCalledWith(WARNING);
      expect(unmountFirst).not.toHaveBeenCalled();
      expect(mountSecond).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('#/orgs');
      expect(root.querySelector('nav a[aria-current="page"]').dataset.route).toBe('orgs');
      confirm.mockRestore();
    });

    it('goes ahead when the answer is yes', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { unmountFirst, mountSecond, panels } = twoPanels(() => WARNING);
      window.location.hash = '#/orgs';
      open(panels);
      go('#/audit');
      expect(unmountFirst).toHaveBeenCalledTimes(1);
      expect(mountSecond).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe('#/audit');
      confirm.mockRestore();
    });

    it('does not ask when the panel has nothing to lose, or when the address only moves inside it', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      let warning = null;
      const { mountSecond, panels } = twoPanels(() => warning);
      window.location.hash = '#/orgs';
      open(panels);
      go('#/orgs/11111111-1111-4111-8111-111111111111');
      warning = WARNING;
      go('#/orgs');
      expect(confirm).not.toHaveBeenCalled();
      warning = null;
      go('#/audit');
      expect(confirm).not.toHaveBeenCalled();
      expect(mountSecond).toHaveBeenCalledTimes(1);
      confirm.mockRestore();
    });

    it('asks before either sign-out, and does not sign out on no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onSignOut = vi.fn(async () => ({ ok: true }));
      const onSignOutEverywhere = vi.fn(async () => ({ ok: true }));
      const { panels } = twoPanels(() => WARNING);
      window.location.hash = '#/orgs';
      open(panels, { onSignOut, onSignOutEverywhere });
      const buttons = [...root.querySelectorAll('header button')];
      buttons.find((b) => b.textContent === 'Sign out').click();
      buttons.find((b) => b.textContent === 'Sign out everywhere').click();
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(onSignOut).not.toHaveBeenCalled();
      expect(onSignOutEverywhere).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      buttons.find((b) => b.textContent === 'Sign out').click();
      expect(onSignOut).toHaveBeenCalledTimes(1);
      confirm.mockRestore();
    });
  });

  it("draws one navigation link per panel, to that panel's route", () => {
    open([panel('orgs'), panel('audit')]);
    const links = [...root.querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/orgs', '#/audit']);
  });
});
