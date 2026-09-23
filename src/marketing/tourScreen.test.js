import { beforeEach, describe, expect, it } from 'vitest';
import { mountTourScreen } from './tourScreen.js';

describe('mountTourScreen', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('links Cup Taster to the organiser console with its own real event photo', () => {
    mountTourScreen(root);
    expect(root.querySelector('#cup-taster')).not.toBeNull();
    const cupLink = root.querySelector('#cup-taster .tour-primary-link');
    expect(cupLink.getAttribute('href')).toBe('/app/#/events');
    expect(cupLink.textContent).toContain('Open Cup Taster');
    expect(root.querySelector('.tour-cup-media img').getAttribute('src')).toBe(
      '/marketing/hero-cupping-bowls.jpg',
    );
  });

  it('lists BTC as live too, linked to the same organiser console, with no fabricated photo', () => {
    mountTourScreen(root);
    const btcSection = root.querySelector('#btc');
    expect(btcSection).not.toBeNull();
    expect(btcSection.querySelector('h2').textContent).toBe('BTC.');
    const btcLink = btcSection.querySelector('.tour-primary-link');
    expect(btcLink.getAttribute('href')).toBe('/app/#/events');
    expect(btcLink.textContent).toContain('Open BTC');
    // No <img> — BTC has no real event photography yet, unlike Cup Taster's
    // genuine one; this section must not imply a photo it doesn't have.
    expect(btcSection.querySelector('img')).toBeNull();
  });

  it('only lists genuinely not-yet-live formats (Throwdown, Liga Seduh) as "Coming soon", not BTC', () => {
    mountTourScreen(root);
    expect(root.querySelectorAll('.tour-planned-status')).toHaveLength(2);
    const plannedTitles = [...root.querySelectorAll('.tour-planned-card h3')].map(
      (h3) => h3.textContent,
    );
    expect(plannedTitles).toEqual(['Throwdown', 'Liga Seduh']);
    expect(root.querySelector('.tour-planned').textContent).not.toContain('BTC');
  });

  it('lists both live formats in the shared public header\'s own "Live —" indicator, not just Cup Taster', () => {
    mountTourScreen(root);
    expect(root.querySelector('.public-header-live').textContent).toContain(
      'Live — Cup Taster, BTC',
    );
  });

  it('finishes with links to the two current Community tools and their hub', () => {
    mountTourScreen(root);
    const links = [...root.querySelectorAll('#community a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toEqual(
      expect.arrayContaining(['/tools/timer/', '/guess-the-bean/', '/community/']),
    );
    expect(root.querySelector('.public-header-link-active').textContent).toBe('Formats');
    expect(root.querySelector('.public-footer-link').getAttribute('href')).toBe('/community/');
  });
});
