// Seduh ID discovery (T-ID2.C5): the shaping of what the anonymous doors return, and the results-page links. The doors
// themselves (who may ever be returned, the switch) are proved in supabase/tests/088_seduh_discovery.sql; this file proves
// that a closed, failed or malformed answer shows nothing and that nothing the door did not send can be drawn.
import { describe, expect, it, vi } from 'vitest';
import {
  applyProfileLinks,
  cleanQuery,
  fetchDiscoveryOpen,
  fetchResultsProfileLinks,
  linkClaimedNames,
  normaliseCountries,
  normaliseLinks,
  normalisePerson,
  normaliseSearch,
  searchSeduhIds,
} from './seduhDiscovery.js';

const person = (over = {}) => ({
  handle: 'alpha-t88',
  display_name: 'Alpha',
  country_code: 'bn',
  photo_url: null,
  ...over,
});

describe('normalisePerson', () => {
  it('rebuilds a person from known keys only', () => {
    expect(normalisePerson({ ...person(), email: 'a@b.c', id: 'x' })).toEqual({
      handle: 'alpha-t88',
      name: 'Alpha',
      countryCode: 'BN',
      photoUrl: null,
    });
  });
  it.each([
    null,
    'x',
    {},
    person({ handle: 'AB' }),
    person({ handle: 'has space' }),
    person({ handle: '-bad' }),
    person({ display_name: '  ' }),
  ])('drops a malformed row: %j', (row) => expect(normalisePerson(row)).toBeNull());
  it('keeps a photo only in the person’s own folder, in the one accepted shape', () => {
    const own = `/storage/v1/object/public/seduh-avatars/alpha-t88/${'a'.repeat(32)}.webp`;
    expect(normalisePerson(person({ photo_url: own })).photoUrl).toBe(own);
    expect(
      normalisePerson(person({ photo_url: own.replace('alpha-t88', 'other') })).photoUrl,
    ).toBeNull();
    expect(
      normalisePerson(person({ photo_url: 'https://evil.example/x.png' })).photoUrl,
    ).toBeNull();
  });
  it('strips control and direction characters from a name', () => {
    expect(normalisePerson(person({ display_name: 'A‮lpha\u0007' })).name).toBe('Alpha');
  });
});

describe('closed means nothing', () => {
  it.each([
    null,
    undefined,
    'x',
    [],
    { open: false, results: [person()] },
    { open: 'true', results: [person()] },
    { results: [person()] },
  ])('search: %j', (raw) =>
    expect(normaliseSearch(raw)).toEqual({ open: false, results: [], more: false }),
  );
  it.each([null, { open: false, countries: [{ country_code: 'BN', people: 3 }] }])(
    'countries: %j',
    (raw) => expect(normaliseCountries(raw)).toEqual({ open: false, countries: [] }),
  );
  it.each([null, { open: false, links: [{ name: 'A', cafe: '', handle: 'alpha-t88' }] }])(
    'links: %j',
    (raw) => expect(normaliseLinks(raw)).toEqual([]),
  );
  it('an open answer keeps only well-formed rows and the more flag', () => {
    const out = normaliseSearch({
      open: true,
      more: true,
      results: [person(), { handle: 'x' }, null],
    });
    expect(out.open).toBe(true);
    expect(out.more).toBe(true);
    expect(out.results.map((p) => p.handle)).toEqual(['alpha-t88']);
  });
  it('countries need a two-letter code and a positive whole count', () => {
    const raw = {
      open: true,
      countries: [
        { country_code: 'bn', people: 2 },
        { country_code: 'BRN', people: 1 },
        { country_code: 'MY', people: 0 },
        { country_code: 'ID', people: 1.5 },
      ],
    };
    expect(normaliseCountries(raw).countries).toEqual([{ code: 'BN', people: 2 }]);
  });
});

describe('the doors', () => {
  const rpc = (data, error = null) => ({ rpc: vi.fn(async () => ({ data, error })) });
  const throwing = {
    rpc: () => {
      throw new Error('down');
    },
  };

  it('fetchDiscoveryOpen is true only for a literal true, and false for an error or a throw', async () => {
    expect(await fetchDiscoveryOpen(rpc(true))).toBe(true);
    expect(await fetchDiscoveryOpen(rpc('true'))).toBe(false);
    expect(await fetchDiscoveryOpen(rpc(null, { message: 'x' }))).toBe(false);
    expect(await fetchDiscoveryOpen(throwing)).toBe(false);
  });

  it('cleanQuery enforces 2 to 40 characters and collapses spaces', () => {
    expect(cleanQuery(' a ')).toBeNull();
    expect(cleanQuery('  ab   cd ')).toBe('ab cd');
    expect(cleanQuery('x'.repeat(41))).toBeNull();
    expect(cleanQuery('x'.repeat(40))).toBe('x'.repeat(40));
  });

  it('searchSeduhIds asks the door with the cleaned query and the upper-cased country', async () => {
    const client = rpc({ open: true, results: [person()], more: false });
    const out = await searchSeduhIds({ query: '  alpha ', country: 'bn' }, client);
    expect(client.rpc).toHaveBeenCalledWith('seduh_discovery_search', {
      p_query: 'alpha',
      p_country: 'BN',
    });
    expect(out.results).toHaveLength(1);
  });

  it('searchSeduhIds does not ask for a too-short query, a bad country or no query at all', async () => {
    const client = rpc({ open: true, results: [person()], more: false });
    for (const args of [{ query: 'a' }, { country: 'BRN' }, {}, { query: 'ab', country: 'B1' }]) {
      expect((await searchSeduhIds(args, client)).results).toEqual([]);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('searchSeduhIds throws on a failed call (the page words it)', async () => {
    await expect(searchSeduhIds({ query: 'alpha' }, rpc(null, new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });

  it('fetchResultsProfileLinks asks only for a uuid, and answers [] on any problem', async () => {
    const client = rpc({
      open: true,
      links: [{ name: 'Alpha', cafe: 'Cafe', handle: 'alpha-t88' }],
    });
    expect(await fetchResultsProfileLinks('not-an-id', client)).toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
    const id = '00000000-0000-0000-0000-000000000001';
    expect(await fetchResultsProfileLinks(id, client)).toEqual([
      { name: 'Alpha', cafe: 'Cafe', handle: 'alpha-t88' },
    ]);
    expect(client.rpc).toHaveBeenCalledWith('seduh_results_profile_links', { p_event_id: id });
    expect(await fetchResultsProfileLinks(id, rpc(null, { message: 'x' }))).toEqual([]);
    expect(await fetchResultsProfileLinks(id, throwing)).toEqual([]);
  });
});

describe('applyProfileLinks', () => {
  function table() {
    const root = document.createElement('div');
    root.innerHTML =
      '<span data-profile-name="Alpha" data-profile-cafe="Cafe One">Alpha</span>' +
      '<span data-profile-name="Alpha" data-profile-cafe="Cafe Two">Alpha</span>' +
      '<span data-profile-name="Nobody" data-profile-cafe="">Nobody</span>';
    return root;
  }
  const link = { name: 'Alpha', cafe: 'Cafe One', handle: 'alpha-t88' };

  it('links a name only when name AND cafe match a claimed competitor, and leaves the rest untouched', () => {
    const root = table();
    expect(applyProfileLinks(root, [link])).toBe(1);
    const links = [...root.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/id/alpha-t88/');
    expect(links[0].textContent).toBe('Alpha');
    expect(root.querySelectorAll('span')[2].querySelector('a')).toBeNull();
  });
  it('does nothing for no links (discovery closed), and applying twice links once', () => {
    const root = table();
    const before = root.innerHTML;
    expect(applyProfileLinks(root, [])).toBe(0);
    expect(root.innerHTML).toBe(before);
    applyProfileLinks(root, [link]);
    expect(applyProfileLinks(root, [link])).toBe(0);
  });
  it('a handle can never carry markup into the address', () => {
    expect(
      normaliseLinks({ open: true, links: [{ name: 'A', cafe: '', handle: '"><script>' }] }),
    ).toEqual([]);
  });
  it('linkClaimedNames never throws and links once the door answers', async () => {
    const root = table();
    const id = '00000000-0000-0000-0000-000000000001';
    const answer = (data) => ({ rpc: async () => ({ data, error: null }) });
    expect(await linkClaimedNames(root, id, answer({ open: false, links: [] }))).toBe(0);
    expect(
      await linkClaimedNames(root, id, {
        rpc: () => {
          throw new Error('x');
        },
      }),
    ).toBe(0);
    expect(await linkClaimedNames(root, id, answer({ open: true, links: [link] }))).toBe(1);
  });
});
