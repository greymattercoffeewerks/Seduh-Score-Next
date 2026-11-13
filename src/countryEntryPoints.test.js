// The four entry points to the country pages (T-CTY.4), each in BOTH states of the one switch
// (core/countryPages.js, COUNTRY_PAGES_PUBLIC): off, nothing public points at the pages; on, each does what it says.
import { describe, expect, it, vi } from 'vitest';
import { buildCountryChip } from './core/countryChip.js';
import { buildPublicHeader } from './marketing/publicHeader.js';
import { buildPublicFooter } from './marketing/publicFooter.js';
import { buildResultsSheet } from './marketing/resultsSheet.js';
import { splashExtra } from './liveSurfaces.js';
import { mountResultsScreen } from './marketing/resultsScreen.js';
import { createBtcViewerBody } from './formats/btc/viewerBody.js';
import { preliminaryPayload } from './formats/btc/demoLivePayload.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ON = (country) => buildCountryChip(country, { enabled: true });

describe('the Records link in the public header', () => {
  const labels = (header) =>
    [...header.querySelectorAll('.public-header-links .public-header-link')].map(
      (a) => a.textContent,
    );
  it('is absent by default', () => {
    expect(labels(buildPublicHeader({ active: 'tour' }))).not.toContain('Records');
    // ... and nothing in the header, mobile panel included, points at the pages
    expect(buildPublicHeader({ active: 'tour' }).innerHTML).not.toContain('/id/country');
  });
  it('links to the hub, on desktop and in the phone menu, when switched on', () => {
    const header = buildPublicHeader({ active: 'tour', countryPagesPublic: true });
    expect(labels(header)).toContain('Records');
    const hrefs = [...header.querySelectorAll('a')]
      .filter((a) => a.textContent === 'Records')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/id/country/', '/id/country/']);
    const current = buildPublicHeader({
      active: 'records',
      countryPagesPublic: true,
    }).querySelector('[aria-current="page"]');
    expect(current.textContent).toBe('Records');
  });
});

describe('the QR code on the printed results sheet', () => {
  const sheetFor = (format, options) =>
    buildResultsSheet(
      {
        format,
        eventName: 'Fictional Cup',
        podium: [{ rank: 1, name: 'Alpha Brew', cafe: null, correct: 3, total: 7 }],
        publishedAt: '2026-10-05T00:00:00Z',
        eventId: 'e1',
      },
      options,
    );
  it('is not printed by default, for any format', () => {
    expect(sheetFor('btc').querySelector('.qr-block')).toBeNull();
  });
  it('is printed for a BTC sheet when switched on, with the hub address as text, and not for another format', () => {
    const block = sheetFor('btc', { countryPagesPublic: true }).querySelector('.qr-block');
    expect(block.querySelector('.qr-block-url').textContent).toBe('www.seduhscore.com/id/country/');
    expect(block.querySelector('.qr-block-caption').textContent).toContain('country');
    expect(
      sheetFor('cup_taster', { countryPagesPublic: true }).querySelector('.qr-block'),
    ).toBeNull();
  });
});

describe('the QR code on the BTC splash', () => {
  const live = (format, eventId = 'ev1') => vi.fn(async () => ({ eventId, format }));
  it('asks nothing and draws nothing by default', async () => {
    const lookupFormat = live('btc');
    expect(await splashExtra({ id: 'ev1' }, { lookupFormat })).toBeNull();
    expect(lookupFormat).not.toHaveBeenCalled();
  });
  it('draws the hub code when switched on and the splash event is the live BTC event', async () => {
    const block = await splashExtra(
      { id: 'ev1' },
      { enabled: true, lookupFormat: live('btc'), orgId: 'o', client: {} },
    );
    expect(block.querySelector('.qr-block-url').textContent).toBe('www.seduhscore.com/id/country/');
    await flush();
  });
  it('draws nothing for another format, another event, no live session, or no event', async () => {
    const on = { enabled: true, orgId: 'o', client: {} };
    expect(
      await splashExtra({ id: 'ev1' }, { ...on, lookupFormat: live('cup_taster') }),
    ).toBeNull();
    expect(
      await splashExtra({ id: 'ev1' }, { ...on, lookupFormat: live('btc', 'other') }),
    ).toBeNull();
    expect(await splashExtra({ id: 'ev1' }, { ...on, lookupFormat: async () => null })).toBeNull();
    expect(await splashExtra(null, { ...on, lookupFormat: live('btc') })).toBeNull();
  });
});

describe('the country chip on the BTC audience phone view', () => {
  function render(countryChip) {
    const payload = preliminaryPayload();
    for (const row of payload.standings) row.country = null;
    payload.standings[0].country = { code: 'BN', name: 'Brunei' };
    const container = document.createElement('div');
    document.body.append(container);
    const body = createBtcViewerBody(countryChip ? { countryChip } : {});
    body.renderBody(container, payload, { isTest: false, format: 'btc', eventId: 'ev1' });
    return container;
  }
  it('draws no link while the pages are not public', () => {
    const container = render();
    expect(container.querySelector('.btc-phone-table a')).toBeNull();
    // the row still reads as before: country and team in words
    expect(container.querySelector('.btc-phone-name-text').textContent).toContain('Brunei');
  });
  it('draws one link to the country page on the team that has a country, when switched on', () => {
    const container = render(ON);
    const links = [...container.querySelectorAll('.btc-phone-table a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/id/country/bn/']);
    expect(links[0].closest('tr').querySelector('.btc-phone-name-text')).not.toBeNull();
  });
});

describe('the country chip on /results/', () => {
  const row = (country) => ({
    event_id: 'e1',
    published_at: '2026-10-05T00:00:00Z',
    payload: {
      format: 'btc',
      eventName: 'Fictional Cup',
      competitors: 4,
      rounds: 2,
      winningTimeSecs: 100,
      podium: [{ rank: 1, name: 'Alpha Brew', cafe: null, correct: 3, total: 7, country }],
    },
  });
  const client = (country) => ({
    from() {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve) => Promise.resolve({ data: [row(country)], error: null }).then(resolve),
      };
      return builder;
    },
  });
  async function mount(country, options) {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    await mountResultsScreen(root, { client: client(country), ...options });
    return root;
  }
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));

  it('draws no link by default, even for a team that has a country', async () => {
    const root = await mount({ code: 'BN', name: 'Brunei' });
    expect(root.querySelector('.results-podium a')).toBeNull();
  });
  it('draws the team’s country link when switched on, and nothing for a team with no country in the payload', async () => {
    const withCountry = await mount({ code: 'BN', name: 'Brunei' }, { countryChip: ON });
    expect(withCountry.querySelector('.results-podium a').getAttribute('href')).toBe(
      '/id/country/bn/',
    );
    const without = await mount(undefined, { countryChip: ON });
    expect(without.querySelector('.results-podium a')).toBeNull();
  });
});

describe('nothing public points at the country pages while the switch is off', () => {
  it('the shared header and footer, on every page they are built for, have no link to /id/country', () => {
    for (const active of [
      'tour',
      'pricing',
      'community',
      'results',
      'records',
      'trust-about',
      'trust-contact',
      'trust-privacy',
      'trust-terms',
      'trust-neutrality',
    ]) {
      const frame = document.createElement('div');
      frame.append(
        buildPublicHeader({ active }),
        buildPublicFooter({ companionHref: '/', companionText: 'Back', currentSlug: active }),
      );
      // the frame really has links (so an empty header or footer cannot pass this)
      expect(frame.querySelectorAll('a').length, active).toBeGreaterThan(5);
      expect(frame.querySelectorAll('a[href*="/id/country"]'), active).toHaveLength(0);
    }
  });
});
