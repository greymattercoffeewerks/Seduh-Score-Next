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

  it("draws one navigation link per panel, to that panel's route", () => {
    open([panel('orgs'), panel('audit')]);
    const links = [...root.querySelectorAll('nav a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/orgs', '#/audit']);
  });
});
