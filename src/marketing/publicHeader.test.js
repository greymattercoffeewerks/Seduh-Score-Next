import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPublicHeader, publicNavItems } from './publicHeader.js';
import { mountLandingScreen } from './landingScreen.js';
import { COUNTRY_HUB_PATH } from '../core/countryPages.js';

function desktopLinks(active) {
  const header = buildPublicHeader({ active });
  return [...header.querySelectorAll('.public-header-links .public-header-link')];
}

describe('buildPublicHeader — active link', () => {
  it.each([
    ['tour', 'Formats'],
    ['pricing', 'Pricing'],
    ['community', 'Community Tools'],
    ['results', 'Results'],
  ])('marks exactly one link, "%s" -> %s, as the current page', (active, label) => {
    const links = desktopLinks(active);
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
    // The visual active class and the aria-current attribute never drift apart.
    const styled = links.filter((link) => link.classList.contains('public-header-link-active'));
    expect(styled.map((link) => link.textContent)).toEqual([label]);
  });

  it('marks nothing as the current page for a page that has no nav entry (e.g. a trust page)', () => {
    const links = desktopLinks('trust-about');
    expect(links.filter((link) => link.hasAttribute('aria-current'))).toEqual([]);
    expect(links.filter((link) => link.classList.contains('public-header-link-active'))).toEqual(
      [],
    );
  });

  it.each(['tour', 'pricing', 'community', 'results', 'trust-about'])(
    'links Pricing to the pricing page on every page (%s)',
    (active) => {
      const pricing = desktopLinks(active).filter((link) => link.textContent === 'Pricing');
      expect(pricing).toHaveLength(1);
      expect(pricing[0].getAttribute('href')).toBe('/pricing/');
    },
  );

  it.each(['tour', 'pricing', 'community', 'results', 'trust-about'])(
    'always links to the Results archive, even when it is not the current page (%s)',
    (active) => {
      const results = desktopLinks(active).filter((link) => link.textContent === 'Results');
      expect(results).toHaveLength(1);
      expect(results[0].getAttribute('href')).toBe('/results/');
    },
  );
});

// Every public page's header sends each link to the same place, including the landing page's own nav, which is
// built separately (landingScreen.js). Formats and Pricing are the full pages, never the landing page's #formats /
// #pricing preview sections, and Org login / Start free go into the console, not back to the landing page.
const EXPECTED_NAV = [
  ['Formats', '/tour/'],
  ['Pricing', '/pricing/'],
  ['Community Tools', '/community/'],
  ['Results', '/results/'],
  ['Org login', '/app/'],
];

describe('buildPublicHeader — nav targets', () => {
  it.each(['tour', 'pricing', 'community', 'results', 'trust-about', 'records'])(
    'sends every desktop and mobile link to its page (%s)',
    (active) => {
      const header = buildPublicHeader({ active, countryPagesPublic: false });
      const pairs = (selector) =>
        [...header.querySelectorAll(selector)].map((a) => [a.textContent, a.getAttribute('href')]);
      expect(pairs('.public-header-links .public-header-link')).toEqual(EXPECTED_NAV);
      expect(pairs('.public-header-mobile-links .public-header-link')).toEqual(EXPECTED_NAV);
      const startFree = [...header.querySelectorAll('.public-header-action')].map((a) =>
        a.getAttribute('href'),
      );
      expect(startFree).toEqual(['/app/#/events', '/app/#/events']);
    },
  );

  afterEach(() => vi.unstubAllGlobals());

  it('matches the landing page nav link for link, desktop and mobile', () => {
    // jsdom has no matchMedia; "reduced motion" keeps the landing page's scroll-reveal and carousel synchronous.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const root = document.createElement('div');
    mountLandingScreen(root);
    const pairs = (selector) =>
      [...root.querySelectorAll(selector)].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(pairs('.petrol-nav-links .petrol-nav-link')).toEqual(EXPECTED_NAV);
    expect(pairs('.petrol-nav-mobile-links .petrol-nav-link')).toEqual(EXPECTED_NAV);
    const startFree = [
      ...root.querySelectorAll(
        '.petrol-nav-desktop .petrol-action, .petrol-nav-mobile-links .petrol-action',
      ),
    ].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(startFree).toEqual([
      ['Start free', '/app/#/events'],
      ['Start free', '/app/#/events'],
    ]);
  });

  it('adds Records before Org login on both headers once the country pages go public', () => {
    const items = publicNavItems({ countryPagesPublic: true }).map((item) => item.text);
    expect(items).toEqual([
      'Formats',
      'Pricing',
      'Community Tools',
      'Results',
      'Records',
      'Org login',
    ]);
    const header = buildPublicHeader({ active: 'records', countryPagesPublic: true });
    const withRecords = [
      ...EXPECTED_NAV.slice(0, 4),
      ['Records', COUNTRY_HUB_PATH],
      EXPECTED_NAV[4],
    ];
    const pairs = (selector) =>
      [...header.querySelectorAll(selector)].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(pairs('.public-header-links .public-header-link')).toEqual(withRecords);
    expect(pairs('.public-header-mobile-links .public-header-link')).toEqual(withRecords);
    const current = header.querySelector('.public-header-links [aria-current="page"]');
    expect(current.textContent).toBe('Records');
  });
});
