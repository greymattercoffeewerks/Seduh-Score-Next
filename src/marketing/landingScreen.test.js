import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('mountLandingScreen — pricing', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says Per-event is "branded", never "fully branded" (branding is Level 2, not a full theme)', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);
    const text = root.querySelector('#pricing').textContent;
    expect(text).toMatch(/branded, with PDF reports/);
    expect(text).not.toMatch(/fully branded/i);
  });

  it('states each tier as the owner confirmed it, and drops the claims that were not true', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);
    const [community, perEvent, annual] = [
      ...root.querySelectorAll('#pricing .petrol-plate-col'),
    ].map((column) => column.querySelector('.petrol-band-body').textContent);
    expect(community).toMatch(/Up to 8 competitors, and one active event at a time/);
    expect(community).not.toMatch(/BTC/);
    expect(community).toMatch(/podium is published to the public archive when the event ends/);
    expect(perEvent).toMatch(/One event, in the format you choose/);
    expect(annual).toMatch(/Every format and feature, with no competitor limit/);

    const everything = [community, perEvent, annual].join(' ');
    expect(everything).not.toMatch(/no account needed/i);
    expect(everything).not.toMatch(/every live format/i);
    expect(everything).not.toMatch(/persistent history|across seasons/i);
    expect(everything).not.toMatch(/unbranded/i);
  });

  it('has a Learn more link in the pricing section that goes to the pricing page', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);
    const link = root.querySelector('#pricing .petrol-pricing-more a');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/pricing/');
    expect(link.textContent).toMatch(/^Learn more/);
  });
});

describe('mountLandingScreen — navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  it('links to the public Results archive from both the desktop and the mobile nav', () => {
    const root = document.createElement('div');
    mountLandingScreen(root);

    for (const container of ['.petrol-nav-links', '.petrol-nav-mobile-links']) {
      const results = [...root.querySelectorAll(`${container} a`)].filter(
        (link) => link.textContent === 'Results',
      );
      expect(results, container).toHaveLength(1);
      expect(results[0].getAttribute('href')).toBe('/results/');
    }
  });
});

describe('mountLandingScreen — latest published event card', () => {
  const STATIC_NEXT = 'Next event — date to be announced.';
  const ID = '3f2a1c9e-1b2d-4c3e-8f4a-5b6c7d8e9f01';
  const row = (payload, eventId = ID) => ({
    event_id: eventId,
    payload,
    published_at: '2026-10-05',
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  function mount(loadLatest) {
    const root = document.createElement('div');
    mountLandingScreen(root, { loadLatest });
    return root;
  }

  it("renders name, date, organiser and a link to that event's results sheet when a row arrives", async () => {
    const root = mount(async () =>
      row({
        eventName: 'Grey Matter Cup Taster Competition 2026',
        eventDate: '2026-10-04',
        org_name: 'Grey Matter Coffee Werks',
      }),
    );
    await settle();
    const block = root.querySelector('.petrol-story-latest');
    expect(block.querySelector('.petrol-story-latest-name').textContent).toBe(
      'Grey Matter Cup Taster Competition 2026',
    );
    expect(block.querySelector('.petrol-story-latest-meta').textContent).toBe(
      '4 October 2026 · Organised by Grey Matter Coffee Werks',
    );
    const link = block.querySelector('a');
    expect(link.getAttribute('href')).toBe(`/results/?sheet=${ID}`);
    expect(link.textContent).toBe('View results →');
    expect(root.querySelector('.petrol-story-next').textContent).toBe(STATIC_NEXT);
    expect(root.querySelector('.petrol-story-copy').textContent).toContain('Completed');
  });

  it('shows no competitor or score fields even when the payload carries them', async () => {
    const root = mount(async () =>
      row({
        eventName: 'E',
        podium: [{ name: 'Secret Winner', correct: 9 }],
        standings: [{ name: 'Second Placer', correct: 7 }],
      }),
    );
    await settle();
    const text = root.querySelector('.petrol-story-latest').textContent;
    expect(text).toBe('Latest published resultEView results →');
  });

  const staticCard = (root) => root.querySelector('.petrol-story').innerHTML;

  it.each([
    ['a failed fetch', () => Promise.reject(new Error('boom'))],
    ['an empty archive', async () => null],
    ['a row with no usable name', async () => row({ eventDate: '2026-10-04' })],
    ['a row with a malformed event id', async () => row({ eventName: 'X' }, '"><script>')],
  ])('leaves the static card byte-for-byte unchanged on %s', async (_label, loadLatest) => {
    const before = staticCard(mount(undefined));
    const root = mount(loadLatest);
    await settle();
    expect(root.querySelector('.petrol-story-latest')).toBeNull();
    expect(staticCard(root)).toBe(before);
  });

  it('renders payload text as text, never markup, and tolerates a bad date and no organiser', async () => {
    const root = mount(async () =>
      row({ eventName: '<img src=x onerror=alert(1)>', eventDate: '2026-13-99', org_name: '' }),
    );
    await settle();
    const block = root.querySelector('.petrol-story-latest');
    expect(block.querySelector('.petrol-story-latest-name').textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(block.querySelector('img')).toBeNull();
    expect(block.querySelector('.petrol-story-latest-meta')).toBeNull();
  });
});

describe('latest event card — impossible dates and markup in the organiser name', () => {
  const ID = '3f2a1c9e-1b2d-4c3e-8f4a-5b6c7d8e9f01';
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01'])(
    'drops the date %s instead of rolling it over',
    async (eventDate) => {
      const root = document.createElement('div');
      mountLandingScreen(root, {
        loadLatest: async () => ({
          event_id: ID,
          payload: { eventName: 'E', eventDate },
          published_at: 'x',
        }),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.querySelector('.petrol-story-latest-meta')).toBeNull();
    },
  );

  it('renders a markup-looking organiser name as text', async () => {
    const root = document.createElement('div');
    mountLandingScreen(root, {
      loadLatest: async () => ({
        event_id: ID,
        payload: { eventName: 'E', org_name: '<b>Org</b>' },
        published_at: 'x',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const meta = root.querySelector('.petrol-story-latest-meta');
    expect(meta.textContent).toBe('Organised by <b>Org</b>');
    expect(meta.querySelector('b')).toBeNull();
  });
});

describe('mountLandingScreen — live now bar', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const r = (n, over = {}) => ({
    kind: 'live',
    eventName: `Event ${n}`,
    orgName: `Org ${n}`,
    format: 'cup_taster',
    href: `/app/#/live/org-${n}/phone`,
    ...over,
  });
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));

  function mount(loadLive) {
    const root = document.createElement('div');
    mountLandingScreen(root, { loadLive });
    return root;
  }

  it('renders nothing without a loader (tests, the prerender)', () => {
    expect(mount(undefined).querySelector('.petrol-live-bar')).toBeNull();
  });

  it.each([
    ['nothing live', async () => ({ rows: [], total: 0 })],
    ['a failed request', async () => Promise.reject(new Error('down'))],
    ['a malformed answer', async () => null],
    ['only unknown kinds', async () => ({ rows: [r(1, { kind: 'registration' })], total: 1 })],
  ])('leaves the page exactly as it was on %s', async (_l, loader) => {
    const before = mount(undefined).innerHTML;
    const root = mount(loader);
    await settle();
    expect(root.innerHTML).toBe(before);
  });

  it('puts a labelled region ABOVE the nav with a named link to the live page', async () => {
    const root = mount(async () => ({ rows: [r(1)], total: 1 }));
    await settle();
    const bar = root.querySelector('.petrol-live-bar');
    expect(bar.tagName).toBe('SECTION');
    expect(bar.getAttribute('aria-label')).toBe('Live now');
    expect(bar.nextElementSibling.classList.contains('petrol-nav')).toBe(true);
    expect(bar.textContent).toContain('Live now: Event 1 by Org 1');
    const link = bar.querySelector('a');
    expect(link.getAttribute('href')).toBe('/app/#/live/org-1/phone');
    expect(link.getAttribute('aria-label')).toBe('Watch Event 1 by Org 1 live');
    expect(bar.querySelector('.petrol-live-bar-more-toggle')).toBeNull();
  });

  it('shows names as text, never markup', async () => {
    const root = mount(async () => ({ rows: [r(1, { eventName: '<b>x</b>' })], total: 1 }));
    await settle();
    expect(root.querySelector('.petrol-live-bar b')).toBeNull();
    expect(root.querySelector('.petrol-live-bar').textContent).toContain('<b>x</b>');
  });

  it('puts the rest behind a "+N more" disclosure', async () => {
    const root = mount(async () => ({ rows: [r(1), r(2), r(3)], total: 5 }));
    await settle();
    const toggle = root.querySelector('.petrol-live-bar-more-toggle');
    const panel = root.querySelector('#petrol-live-bar-more');
    expect(toggle.textContent).toBe('+4 more live');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect([...panel.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/app/#/live/org-2/phone',
      '/app/#/live/org-3/phone',
    ]);
    expect(panel.textContent).toContain('and 2 more live now');
  });
});
