import { describe, expect, it } from 'vitest';
import { buildPublicHeader } from './publicHeader.js';

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
