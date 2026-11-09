import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLandingScreen } from './landingScreen.js';
import { mountPricingScreen } from './pricingScreen.js';
import { mountResultsScreen } from './resultsScreen.js';
import { mountTourScreen } from './tourScreen.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';

// The public pages draw their tags, panels, toggles, buttons and live dots from the shared primitives in
// src/ui/tokens/base.css (see "Public pages" in DESIGN.md), so one change there restyles the console and these pages
// together. tokenDrift.test.js stops a stylesheet from copying them; this stops the MARKUP from quietly dropping
// the shared class (which would leave the page's own class with nothing to draw its shape).

const mount = (fn) => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  fn(root);
  return root;
};
const cls = (el, name) => el?.classList.contains(name);

describe('public pages use the shared primitives', () => {
  // jsdom has no matchMedia; "reduced motion" takes the synchronous path (as landingScreen.test.js does)
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));

  it('the header: menu toggle, live dot and Start-free action', () => {
    const header = buildPublicHeader({ active: 'tour' });
    expect(cls(header.querySelector('.public-header-toggle'), 'menu-toggle')).toBe(true);
    expect(cls(header.querySelector('.public-header-live-dot'), 'status-live-dot')).toBe(true);
    expect(header.querySelectorAll('.public-header-action').length).toBeGreaterThan(0);
    for (const action of header.querySelectorAll('.public-header-action')) {
      expect(cls(action, 'action') && cls(action, 'action-primary')).toBe(true);
    }
  });

  it('the footer version chip is a tag', () => {
    const footer = buildPublicFooter({
      companionHref: '/',
      companionText: 'Home',
      currentSlug: '',
    });
    expect(cls(footer.querySelector('.public-footer-version'), 'tag')).toBe(true);
  });

  it('the landing page: tags, nav toggle, pricing plate, and bevelled primary action', () => {
    const root = mount((r) => mountLandingScreen(r));
    expect(root.querySelectorAll('.tag').length).toBeGreaterThan(0);
    expect(root.querySelector('.petrol-tag')).toBeNull();
    expect(cls(root.querySelector('.petrol-nav-toggle'), 'menu-toggle')).toBe(true);
    expect(cls(root.querySelector('.petrol-plate'), 'panel')).toBe(true);
    const primary = root.querySelector('.action-primary');
    expect(cls(primary, 'btn-bevel')).toBe(true);
    expect(cls(root.querySelector('.action-outline'), 'action')).toBe(true);
  });

  it('the landing live-now dot is the shared live dot', async () => {
    const root = document.createElement('div');
    const loadLive = async () => ({
      rows: [
        {
          kind: 'live',
          eventName: 'E',
          orgName: 'O',
          format: 'cup_taster',
          href: '/app/#/live/o/phone',
        },
      ],
      total: 1,
    });
    mountLandingScreen(root, { loadLive });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cls(root.querySelector('.petrol-live-bar-dot'), 'status-live-dot')).toBe(true);
  });

  it('pricing: cards, rows and the soon word are shared shapes', () => {
    const root = mount(mountPricingScreen);
    for (const sel of [
      '.pricing-card',
      '.pricing-row',
      '.pricing-cta',
      '.pricing-cell-soon .pricing-cell-word',
    ])
      expect(root.querySelectorAll(sel).length, sel).toBeGreaterThan(0);
    for (const card of root.querySelectorAll('.pricing-card'))
      expect(cls(card, 'panel')).toBe(true);
    for (const row of root.querySelectorAll('.pricing-row')) expect(cls(row, 'panel')).toBe(true);
    for (const cta of root.querySelectorAll('.pricing-cta')) {
      expect(cls(cta, 'action') && cls(cta, 'btn-bevel')).toBe(true);
    }
    for (const word of root.querySelectorAll('.pricing-cell-soon .pricing-cell-word')) {
      expect(cls(word, 'tag') && cls(word, 'tag-dashed')).toBe(true);
    }
  });
});

// The pages that open on a headline share ONE hero (.page-hero in base.css): the same distance from the header,
// headline size, kicker, intro and grid backdrop. Each used to carry its own copy and they drifted apart.
describe('the headline pages open on the shared page hero', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));

  const expectSharedHero = (root, page) => {
    const hero = root.querySelector('.page-hero');
    expect(hero, `${page} hero`).not.toBeNull();
    expect(hero.querySelector(':scope > .page-hero-grid')?.getAttribute('aria-hidden'), page).toBe(
      'true',
    );
    expect(hero.querySelector(':scope > .page-hero-kicker'), `${page} kicker`).not.toBeNull();
    expect(hero.querySelector(':scope > h1'), `${page} h1`).not.toBeNull();
    expect(hero.querySelector(':scope > .page-hero-intro'), `${page} intro`).not.toBeNull();
  };

  it('tour, pricing, community hub and results', async () => {
    expectSharedHero(mount(mountTourScreen), 'tour');
    expectSharedHero(mount(mountPricingScreen), 'pricing');

    const hub = document.createElement('div');
    hub.id = 'app';
    document.body.replaceChildren(hub);
    await import('../community/communityHub.js');
    expectSharedHero(hub, 'community');

    const results = document.createElement('div');
    const row = { event_id: 'ev1', payload: { eventName: 'E' }, published_at: '2026-09-14' };
    const builder = {
      select: () => builder,
      order: () => builder,
      then: (resolve) => resolve({ data: [row], error: null }),
    };
    await mountResultsScreen(results, { client: { from: () => builder } });
    expectSharedHero(results, 'results');
  });

  const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

  it('no page restates the hero headline or sizes an h1 of its own', () => {
    for (const path of [
      'src/marketing/tour.css',
      'src/marketing/pricing.css',
      'src/marketing/results.css',
      'src/community/communityHub.css',
    ]) {
      const css = read(path);
      expect(css, path).not.toMatch(/-hero\s*[>+~]?\s*h1\b/);
      // any rule whose selector names an h1 must not set a font-size (the hero's size is base.css's)
      for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (/\bh1\b/.test(selector))
          expect(body, `${path}: ${selector.trim()}`).not.toMatch(/font-size/);
      }
    }
  });

  it('each of the four pages loads the token layer that defines .page-hero', () => {
    for (const page of ['tour', 'community', 'pricing', 'results']) {
      expect(read(`${page}/index.html`), page).toMatch(/href="\/src\/ui\/tokens\/index\.css"/);
    }
  });
});

describe('the shared primitives exist once, in the layer every page loads', () => {
  const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
  const base = read('src/ui/tokens/base.css');
  const components = read('src/ui/tokens/components.css');
  const indexCss = read('src/ui/tokens/index.css');
  // the declarations of the first top-level `.name { ... }` rule, or '' when there is none
  const ruleBody = (css, name) =>
    new RegExp(String.raw`(?:^|\n)\.${name} \{([^}]*)\}`).exec(css)?.[1] ?? '';

  it('base.css (imported by tokens/index.css) defines each one, with a token radius', () => {
    expect(indexCss).toMatch(/@import '\.\/base\.css'/);
    for (const name of ['tag', 'panel', 'icon-frame', 'menu-toggle', 'action']) {
      const rule = ruleBody(base, name);
      expect(rule, `.${name} in base.css`).not.toBeNull();
      expect(rule, `.${name} radius`).toMatch(/border-radius: var\(--radius-(sm|md)\)/);
    }
  });

  it('components.css does not redefine them, and .card keeps the same edge and corner as .panel', () => {
    for (const name of ['tag', 'panel', 'icon-frame', 'menu-toggle', 'action']) {
      expect(components).not.toMatch(new RegExp(String.raw`(?:^|\n)\.${name}[ ,{]`));
    }
    const edge = (css, sel) =>
      ruleBody(css, sel)
        .split(';')
        .map((d) => d.trim())
        .filter((d) => /^border(-radius)?:/.test(d))
        .sort();
    expect(edge(base, 'panel').length).toBe(2);
    expect(edge(components, 'card')).toEqual(edge(base, 'panel'));
  });
});
