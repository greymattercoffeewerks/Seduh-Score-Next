import { beforeEach, describe, expect, it } from 'vitest';
import { mountTourScreen } from './tourScreen.js';

describe('mountTourScreen', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('keeps Cup Taster as the sole live format and links it to the organiser console', () => {
    mountTourScreen(root);
    expect(root.querySelector('#cup-taster')).not.toBeNull();
    expect(root.querySelector('.tour-primary-link').getAttribute('href')).toBe('/app/#/events');
    expect(root.querySelector('.tour-cup-media img').getAttribute('src')).toBe(
      '/marketing/hero-cupping-bowls.jpg',
    );
    expect(root.querySelectorAll('.tour-planned-status')).toHaveLength(3);
    expect(root.textContent).toContain('BTC');
    expect(root.textContent).toContain('Barista Team Competition');
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
