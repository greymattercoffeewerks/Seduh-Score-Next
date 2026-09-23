import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountLandingScreen } from './landingScreen.js';

describe('mountLandingScreen — format list', () => {
  beforeEach(() => {
    // revealOnScroll (core/scrollReveal.js) and the hero photo carousel's own
    // autoplay both check prefers-reduced-motion before touching
    // IntersectionObserver/setInterval — jsdom implements neither `matchMedia` nor
    // `IntersectionObserver` by default. Stubbing "reduced motion: true" takes the
    // simpler synchronous path both features fall back to, matching
    // resultsScreen.test.js's own established precedent for this exact file's
    // sibling screens (this test file isn't testing scroll-reveal or the carousel).
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  it('gives each live row its own "Open {name} →" link text, not a shared hardcoded string', () => {
    // Regression coverage for a real bug found live in the browser while making BTC's
    // row live: formatRow()'s link text used to be hardcoded to literally
    // "Open Cup Taster →" for every row with `live: true`, so BTC's own row read
    // "Open Cup Taster →" too. A manual browser check caught it once; this is what
    // stops it happening silently on the next format that goes live.
    const root = document.createElement('div');
    mountLandingScreen(root);

    const liveRows = [...root.querySelectorAll('.petrol-format-row-live')];
    expect(liveRows).toHaveLength(2);

    const linkTexts = liveRows.map((row) => row.querySelector('.petrol-format-link').textContent);
    expect(linkTexts).toEqual(['Open Cup Taster →', 'Open BTC →']);
    // The load-bearing assertion: two DIFFERENT strings, not the same one twice.
    expect(new Set(linkTexts).size).toBe(2);
  });

  it('links Cup Taster and BTC to the same real app destination; the other two formats stay dimmed with no link', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);

    const liveHrefs = [...root.querySelectorAll('.petrol-format-row-live')].map((row) =>
      row.getAttribute('href'),
    );
    expect(liveHrefs).toEqual(['/app/#/events', '/app/#/events']);

    const dimmedRows = [...root.querySelectorAll('.petrol-format-row-dimmed')];
    expect(dimmedRows).toHaveLength(2);
    for (const row of dimmedRows) {
      expect(row.tagName).toBe('DIV');
      expect(row.querySelector('.petrol-format-link')).toBeNull();
    }
  });

  it('names BTC "BTC," not "BBTC" — the design reference had it right; this codebase corrected it backwards for a while, not the other way around', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);
    const names = [...root.querySelectorAll('.petrol-format-name')].map((n) => n.textContent);
    expect(names).toContain('BTC');
    expect(names).not.toContain('BBTC');
  });

  it('lists both live formats in the nav bar\'s own "Live —" indicator, not just Cup Taster', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);
    expect(root.querySelector('.petrol-live-indicator').textContent).toContain(
      'Live — Cup Taster, BTC',
    );
  });
});
