// The Seduh ID hub (/id/): closed while the database switch is off, a search box and country chips while open, every state
// in words. Doors are injected; no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountHub, statusText } from './hubScreen.js';

afterEach(() => {
  document.title = '';
  document.body.replaceChildren();
});

const open =
  (countries = [{ code: 'BN', people: 2 }]) =>
  async () => ({ open: true, countries });
const closed = async () => ({ open: false, countries: [] });
const found =
  (...names) =>
  async () => ({
    open: true,
    more: false,
    results: names.map((n) => ({
      handle: `${n.toLowerCase()}-t88`,
      name: n,
      countryCode: 'BN',
      photoUrl: null,
    })),
  });
const where = (search = '') => ({ pathname: '/id/', search });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(options) {
  const root = document.createElement('div');
  document.body.append(root);
  await mountHub(root, { location: where(), ...options });
  return root;
}
const submit = (root, value) => {
  root.querySelector('#hub-q').value = value;
  root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
};

describe('hub: switch off', () => {
  it('says search is not open and offers nothing to type into or browse', async () => {
    const search = vi.fn();
    const root = await mount({ loadCountries: closed, search });
    expect(root.querySelector('h1').textContent).toBe('Find a competitor');
    expect(root.textContent).toContain('Seduh ID search is not open yet');
    expect(root.querySelector('input, [role="search"], .hub-country')).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
  it('even with ?q= in the address nothing is searched', async () => {
    const search = vi.fn();
    const root = await mount({ loadCountries: closed, search, location: where('?q=alpha') });
    expect(root.querySelector('input')).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});

describe('hub: failure', () => {
  it('a failed load is an alert with Try again', async () => {
    const root = await mount({
      loadCountries: async () => {
        throw new Error('down');
      },
    });
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(root.textContent).toContain('Try again');
  });
});

describe('hub: open', () => {
  it('has a labelled search form and country chips (buttons with aria-pressed)', async () => {
    const root = await mount({ loadCountries: open() });
    expect(root.querySelector('label[for="hub-q"]').textContent).toBe('Name, handle or café');
    expect(root.querySelector('#hub-q').getAttribute('maxlength')).toBe('40');
    expect(root.querySelector('form').getAttribute('role')).toBe('search');
    const chip = root.querySelector('.hub-country');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.textContent).toContain('Brunei');
  });

  it('a search lists people as links to their pages and announces the count', async () => {
    const search = vi.fn(found('Alpha', 'Bravo'));
    const root = await mount({ loadCountries: open(), search });
    submit(root, 'alp');
    await flush();
    expect(search).toHaveBeenCalledWith({ query: 'alp', country: null }, undefined);
    const hrefs = [...root.querySelectorAll('.hub-results a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/id/alpha-t88/', '/id/bravo-t88/']);
    expect(root.querySelector('#hub-note').textContent).toBe('2 people found.');
    expect(root.querySelector('#hub-note').getAttribute('role')).toBe('status');
  });

  it('a one-letter query is not sent and says why', async () => {
    const search = vi.fn(found('Alpha'));
    const root = await mount({ loadCountries: open(), search });
    submit(root, 'a');
    await flush();
    expect(search).not.toHaveBeenCalled();
    expect(root.querySelector('#hub-note').textContent).toContain('at least 2 letters');
  });

  it('a country chip browses that country, and pressing it again clears it', async () => {
    const search = vi.fn(found('Alpha'));
    const root = await mount({ loadCountries: open(), search });
    root.querySelector('.hub-country').click();
    await flush();
    expect(search).toHaveBeenCalledWith({ query: null, country: 'BN' }, undefined);
    expect(root.querySelector('.hub-country').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#hub-note').textContent).toBe('1 person found in Brunei.');
    root.querySelector('.hub-country').click();
    await flush();
    expect(root.querySelector('.hub-results').children).toHaveLength(0);
  });

  it('an empty answer says nobody was found, without saying why', async () => {
    const root = await mount({ loadCountries: open(), search: found() });
    submit(root, 'nobody');
    await flush();
    expect(root.querySelector('#hub-note').textContent).toContain('No one found');
  });

  it('a search that fails says so in the status line and keeps the box', async () => {
    const root = await mount({
      loadCountries: open(),
      search: async () => {
        throw new Error('x');
      },
    });
    submit(root, 'alpha');
    await flush();
    expect(root.querySelector('#hub-note').textContent).toContain('did not work');
    expect(root.querySelector('#hub-q')).not.toBeNull();
  });

  it('a search that comes back closed shows nothing', async () => {
    const root = await mount({
      loadCountries: open(),
      search: async () => ({ open: false, results: [], more: false }),
    });
    submit(root, 'alpha');
    await flush();
    expect(root.querySelector('.hub-results').children).toHaveLength(0);
  });

  it('starts from ?q= and ?country= in the address (the landing page box)', async () => {
    const search = vi.fn(found('Alpha'));
    const root = await mount({
      loadCountries: open(),
      search,
      location: where('?q=alpha&country=bn'),
    });
    expect(root.querySelector('#hub-q').value).toBe('alpha');
    expect(search).toHaveBeenCalledWith({ query: 'alpha', country: 'BN' }, undefined);
  });

  it('puts names as text: markup in a name is never parsed', async () => {
    const search = async () => ({
      open: true,
      more: false,
      results: [
        {
          handle: 'x-t88',
          name: '<img src=x onerror=alert(1)>',
          countryCode: null,
          photoUrl: null,
        },
      ],
    });
    const root = await mount({ loadCountries: open(), search, location: where('?q=xx') });
    expect(root.querySelector('.hub-results img')).toBeNull();
    expect(root.querySelector('.hub-person-name').textContent).toContain('<img');
  });
});

describe('statusText', () => {
  it('says there is more when the door said so', () => {
    expect(statusText({ query: 'ab', count: 20, more: true })).toContain(
      'Showing the first 20 people',
    );
  });
});
