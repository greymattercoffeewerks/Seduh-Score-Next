import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FICTIONAL_RECORD } from '../core/countryRecord.testkit.js';
import { normaliseCountryRecord } from '../core/countryRecord.js';
import { mountCountryHub, mountCountryPage } from './countryScreen.js';

// FICTIONAL teams and scores, under a real country code so the page accepts it.
const RECORD = normaliseCountryRecord({ ...FICTIONAL_RECORD, country_code: 'BN' });
const EMPTY = normaliseCountryRecord({ country_code: 'BN', has_record: false });
const INDEX = [
  { code: 'TW', championships: 1, entries: 1, teams: 1 },
  { code: 'BN', championships: 2, entries: 3, teams: 2 },
  { code: 'ID', championships: 3, entries: 4, teams: 4 },
];

let root;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector('#app');
});
const text = () => root.textContent;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the country page', () => {
  const mount = (record = RECORD, extra = {}) =>
    mountCountryPage(root, 'bn', {
      fetchRecord: async () => record,
      fetchIndex: async () => INDEX,
      ...extra,
    });

  it('is noindex-shaped content: names the country, the two chips and the code as text', async () => {
    await mount();
    expect(root.querySelector('h1').textContent).toBe('Brunei');
    expect(root.querySelector('.country-tile-code').textContent).toBe('BN');
    expect(text()).toContain('Built from official results');
    expect(text()).toContain('Nobody claims this page');
    expect(document.title).toContain('Brunei');
  });

  it('shows derived stats and the best finish', async () => {
    await mount();
    const stats = [...root.querySelectorAll('.country-stat')].map((n) => n.textContent);
    // won–lost is deliberately absent (the organiser publishes only the final pairings): totals only
    expect(stats).toEqual(['2championships', '2teams sent', '3entries']);
    expect(text()).not.toMatch(/won/i);
    // nor in any attribute (the totals group's accessible name, a title)
    expect(root.innerHTML).not.toMatch(/won/i);
    expect(root.querySelector('.country-best-finish').textContent).toBe('3rd place');
    expect(root.querySelector('.country-best-detail').textContent).toBe('Alpha Brew · 2025');
  });

  it('lists each championship with its teams, stage and round scores', async () => {
    await mount();
    const champ = root.querySelector('.country-champ');
    expect(champ.querySelector('h3').textContent).toBe('Fictional Championship 2025');
    expect(champ.textContent).toContain('Testville');
    const team = champ.querySelector('.country-team');
    expect(team.querySelector('.country-team-name').textContent).toBe('Alpha Brew');
    expect(team.querySelector('.country-team-stage').textContent).toBe('3rd place');
    expect(team.querySelector('.country-team-rounds [aria-hidden]').textContent).toBe(
      'Prelims 40+33=73 · QF 26',
    );
    const spoken = team.querySelector('.country-team-rounds .sr-only').textContent;
    expect(spoken).toContain('Quarter-final: 26');
    // the spoken line says what the screen shows: no opponent
    expect(spoken).not.toContain('Rival');
  });

  it('labels every result "From the organiser’s records" and never "Recorded by Seduh Score"', async () => {
    await mount();
    const labels = [...root.querySelectorAll('.country-provenance')].map((n) => n.textContent);
    expect(labels).toEqual(['From the organiser’s records']);
    expect(text()).not.toContain('Recorded by Seduh Score');
  });

  it('labels EVERY championship, whatever provenance the door names, and says so in the footer', async () => {
    const raw = structuredClone(FICTIONAL_RECORD);
    raw.country_code = 'BN';
    raw.championships.push({
      ...structuredClone(raw.championships[0]),
      edition_year: 2024,
      provenance: 'something_new',
    });
    await mount(normaliseCountryRecord(raw));
    const labels = [...root.querySelectorAll('.country-provenance')].map((n) => n.textContent);
    expect(labels).toEqual(['From the organiser’s records', 'From the organiser’s records']);
    expect(root.querySelector('.country-source').textContent).toContain(
      'Every result here is labelled “From the organiser’s records”',
    );
  });

  it('lists the teams across years and links to the other countries, not this one', async () => {
    await mount();
    expect(root.querySelector('.country-summary-list').textContent).toContain('2024 and 2025');
    const links = [...root.querySelectorAll('.country-others a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Indonesia', '/id/country/id/'],
      ['Taiwan', '/id/country/tw/'],
    ]);
  });

  it('ends with the source, the supplier and how to ask for a correction', async () => {
    await mount();
    const note = root.querySelector('.country-source');
    expect(note.textContent).toContain('Fictional Federation');
    expect(note.textContent).toContain('10 days');
    expect(note.querySelector('a').getAttribute('href')).toBe('mailto:hello@seduhscore.com');
  });

  it('still shows the page when the list of other countries fails', async () => {
    await mount(RECORD, {
      fetchIndex: async () => {
        throw new Error('x');
      },
    });
    expect(root.querySelector('.country-champ')).not.toBeNull();
    expect(root.querySelector('.country-others')).toBeNull();
  });

  it('has a designed empty state for a country with no record, pointing at the hub, with no share button', async () => {
    await mount(EMPTY);
    expect(root.querySelector('.country-state-card h2').textContent).toBe('No record here yet');
    expect(root.querySelector('.country-state-actions a').getAttribute('href')).toBe(
      '/id/country/',
    );
    expect(root.querySelector('.country-share')).toBeNull();
  });

  it('says so, without asking the database, for a code that is not a country', async () => {
    const fetchRecord = vi.fn();
    await mountCountryPage(root, 'zz9', { fetchRecord, fetchIndex: fetchRecord });
    expect(fetchRecord).not.toHaveBeenCalled();
    expect(root.querySelector('.country-state-card h2').textContent).toBe(
      'We do not know that country code',
    );
    expect(root.querySelector('.country-state-card').getAttribute('role')).toBe('status');
  });

  it('has a loading state, then an alert with Try again that loads again', async () => {
    let calls = 0;
    const fetchRecord = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return RECORD;
    });
    const mounted = mountCountryPage(root, 'bn', { fetchRecord, fetchIndex: async () => INDEX });
    expect(text()).toContain('Loading the record');
    await mounted;
    const alert = root.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Something went wrong');
    alert.querySelector('button').click();
    await flush();
    await flush();
    expect(root.querySelector('.country-champ')).not.toBeNull();
  });
});

describe('Share to story', () => {
  async function mountWith(share, render) {
    await mountCountryPage(root, 'bn', {
      fetchRecord: async () => RECORD,
      fetchIndex: async () => INDEX,
      share: { share, render },
    });
    return root.querySelector('.country-share button');
  }

  it('draws the card for this country and hands it to the share step with the page address', async () => {
    const blob = new Blob(['x']);
    const render = vi.fn(async () => blob);
    const share = vi.fn(async () => 'shared');
    const button = await mountWith(share, render);
    button.click();
    await flush();
    await flush();
    const spec = render.mock.calls[0][0];
    expect(spec.title).toBe('Brunei');
    expect(spec.tile).toBe('BN');
    expect(spec.address).toBe('seduhscore.com/id/country/bn');
    expect(spec.highlight.text).toBe('3rd place');
    // three numbers, none of them won–lost (only the final pairings are published)
    expect(spec.stats.map((x) => x.label)).toEqual(['championships', 'teams sent', 'entries']);
    expect(JSON.stringify(spec)).not.toMatch(/won/i);
    expect(spec.provenance).toContain('organiser’s records');
    expect(render.mock.calls[0][1].qrUrl).toBe('https://www.seduhscore.com/id/country/bn/');
    expect(share.mock.calls[0][0]).toBe(blob);
    expect(share.mock.calls[0][1].filename).toBe('seduh-id-bn-story.png');
    expect(root.querySelector('.country-share-note').textContent).toBe('Shared.');
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('says when the picture was saved instead, and when it could not be made, and can be tried again', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('no canvas'))
      .mockResolvedValue(new Blob(['x']));
    const share = vi.fn(async () => 'saved');
    const button = await mountWith(share, render);
    button.click();
    await flush();
    await flush();
    expect(root.querySelector('.country-share-note').textContent).toContain(
      'Could not make the picture',
    );
    button.click();
    await flush();
    await flush();
    expect(root.querySelector('.country-share-note').textContent).toContain('Picture saved');
  });
});

describe('the hub', () => {
  it('groups ASEAN members first, then guests, with counts, each a link to its page', async () => {
    await mountCountryHub(root, { fetchIndex: async () => INDEX });
    const headings = [...root.querySelectorAll('.country-section-title')].map((n) => n.textContent);
    expect(headings.slice(0, 2)).toEqual(['ASEAN members', 'Guest countries']);
    const cards = [...root.querySelectorAll('.country-card')].map((a) => [
      a.querySelector('.country-card-name').textContent,
      a.getAttribute('href'),
      a.querySelector('.country-card-counts').textContent,
    ]);
    expect(cards).toEqual([
      ['Brunei', '/id/country/bn/', '2 teams · 2 championships'],
      ['Indonesia', '/id/country/id/', '4 teams · 3 championships'],
      ['Taiwan', '/id/country/tw/', '1 team · 1 championship'],
    ]);
  });

  it('has empty and failed states', async () => {
    await mountCountryHub(root, { fetchIndex: async () => [] });
    expect(root.querySelector('.country-state-card h2').textContent).toBe('No records yet');
    await mountCountryHub(root, {
      fetchIndex: async () => {
        throw new Error('x');
      },
    });
    expect(root.querySelector('[role="alert"] button').textContent).toBe('Try again');
  });
});

describe('every state keeps the page frame and reaches no public link', () => {
  it('has the header and footer, and the header has no Records link while the pages are not public', async () => {
    await mountCountryHub(root, { fetchIndex: async () => INDEX });
    expect(root.querySelector('.public-header')).not.toBeNull();
    expect(root.querySelector('.public-footer')).not.toBeNull();
    expect(
      [...root.querySelectorAll('.public-header-link')].map((a) => a.textContent),
    ).not.toContain('Records');
  });
});
