// The Seduh ID person page: every state, the long record, the filters, the provenance labels, and the rule that a
// stranger learns nothing about why a handle has no page. The fetch is injected; no network, no Supabase.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normaliseProfile } from '../core/seduhProfile.js';
import { mountProfilePage, mountProfileFromLocation } from './profileScreen.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = '';
});

const door = (over = {}) => ({
  has_profile: true,
  handle: 'syafiqah',
  identity: {
    display_name: 'Syafiqah Omar',
    country_code: 'BN',
    founding_number: 42,
    claimed_on: '2026-11-20',
    photo_url: null,
  },
  recorded_results: [],
  knockout_record: { won: 0, lost: 0, opponents: [] },
  organiser_records: [],
  self_reported: [],
  judging_roles: [],
  cafe_affiliations: [],
  ...over,
});

const recorded = (i, over = {}) => ({
  event_name: `Cup ${i}`,
  format: 'cup_taster',
  organiser_name: `Organiser ${i % 5}`,
  event_date: `${2019 + (i % 8)}-0${1 + (i % 9)}-15`,
  placing: (i % 6) + 1,
  stage: 'Final',
  correct: 6,
  total: 8,
  time_secs: 100 + i,
  provenance: 'seduh_score',
  ...over,
});

// 60 entries, mixed kinds and provenance, across 2019 to 2026. Fictional.
function longDoor() {
  const kinds = ['competed', 'judged', 'organised', 'coached'];
  return door({
    recorded_results: Array.from({ length: 20 }, (_, i) => recorded(i)),
    organiser_records: Array.from({ length: 10 }, (_, i) => ({
      competition: 'btc',
      competition_name: `Championship ${i}`,
      edition_year: 2023 + (i % 4),
      placement: 4 + (i % 3),
      team_name: 'Bean Bandits',
      country_code: 'BN',
      role: 'member',
      membership: i % 2 ? 'confirmed' : 'self_reported',
    })),
    self_reported: Array.from({ length: 24 }, (_, i) => ({
      competition_name: `Self entry ${i}`,
      kind: kinds[i % 4],
      year: 2019 + (i % 8),
      placement: i % 4 === 0 ? 1 : null,
    })),
    judging_roles: Array.from({ length: 6 }, (_, i) => ({
      title: `Judged ${i}`,
      year: 2024 + (i % 3),
    })),
  });
}

async function mount(raw, { handle = 'syafiqah', ...options } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const fetchProfile = vi.fn().mockResolvedValue(normaliseProfile(raw));
  await mountProfilePage(root, handle, { fetchProfile, ...options });
  return { root, fetchProfile };
}

const text = (root) => root.textContent.replace(/\s+/g, ' ');
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const filterButton = (root, label) =>
  [...root.querySelectorAll('.profile-filter')].find((b) => b.textContent === label);

describe('loading and failure', () => {
  it('asks the door with the lower-cased handle', async () => {
    const { fetchProfile } = await mount(door(), { handle: 'SyaFiqah' });
    expect(fetchProfile).toHaveBeenCalledWith('syafiqah', undefined);
  });

  it('draws a loading state first', async () => {
    const root = document.createElement('div');
    let release;
    const fetchProfile = vi.fn(() => new Promise((r) => (release = r)));
    const pending = mountProfilePage(root, 'x', { fetchProfile });
    expect(text(root)).toContain('Loading');
    release(normaliseProfile(door()));
    await pending;
    expect(text(root)).not.toContain('Loading');
  });

  it('a failed read is an alert with Try again, and Try again moves focus to the heading', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const fetchProfile = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(normaliseProfile(door()));
    await mountProfilePage(root, 'syafiqah', { fetchProfile });
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(root)).not.toContain('No Seduh ID here');
    click(root.querySelector('button.action-primary'));
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
    expect(document.activeElement.textContent).toBe('Syafiqah Omar');
  });

  it('a timeout says it is taking longer than expected', async () => {
    const root = document.createElement('div');
    const err = Object.assign(new Error('timed out'), { timedOut: true });
    await mountProfilePage(root, 'x', { fetchProfile: vi.fn().mockRejectedValue(err) });
    expect(text(root)).toContain('taking longer than expected');
  });
});

describe('a handle with no page', () => {
  it('shows "No Seduh ID here" and says nothing about why or which handle', async () => {
    const { root } = await mount({ has_profile: false }, { handle: 'ghost' });
    expect(root.querySelector('h1').textContent).toBe('No Seduh ID here.');
    expect(text(root)).not.toContain('ghost');
    expect(document.title).toBe('No Seduh ID here — Seduh Score');
  });

  it('looks identical for any non-page handle (unknown, closed, reserved all answer the same)', async () => {
    const a = (await mount({ has_profile: false }, { handle: 'aaa' })).root.innerHTML;
    const b = (await mount({ has_profile: false }, { handle: 'zzzzzz-closed' })).root.innerHTML;
    const c = (await mount(null, { handle: 'country' })).root.innerHTML;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('a path with no usable handle makes no call and shows the same page', async () => {
    const root = document.createElement('div');
    const reference = document.createElement('div');
    const fetchProfile = vi.fn();
    await mountProfileFromLocation(root, { pathname: '/id/' }, { fetchProfile });
    await mountProfilePage(reference, 'x', {
      fetchProfile: async () => normaliseProfile({ has_profile: false }),
    });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(reference.innerHTML);
  });
});

describe('a page whose every part is hidden', () => {
  it('shows the handle and one private line, and no stats or record', async () => {
    const hidden = door({
      identity: { display_name: null, country_code: null, founding_number: null, photo_url: null },
    });
    const { root } = await mount(hidden);
    expect(root.querySelector('h1').textContent).toBe('syafiqah');
    expect(text(root)).toContain('This person keeps their Seduh ID private');
    expect(
      root.querySelector('.profile-stats, .profile-best, .profile-filter, .profile-year'),
    ).toBeNull();
    expect(text(root)).not.toContain('No results on Seduh Score yet');
  });
});

describe('a claimed person with no results yet (the empty record)', () => {
  it('shows the identity, the founding chip and a friendly line, and hides every empty section', async () => {
    const { root } = await mount(
      door({ identity: { display_name: 'Firdaus Omar', country_code: 'BN', founding_number: 1 } }),
    );
    expect(root.querySelector('h1').textContent).toBe('Firdaus Omar');
    expect(text(root)).toContain('Seduh ID #0001');
    expect(text(root)).toContain('BN · Brunei');
    expect(text(root)).toContain('No results on Seduh Score yet.');
    expect(root.querySelector('.profile-stats, .profile-best')).toBeNull();
    expect(text(root)).not.toMatch(/Head to head|Works with|Knockout/);
    expect(root.querySelector('.profile-avatar').textContent).toBe('FO');
  });
});

describe('the full page', () => {
  const full = () =>
    door({
      recorded_results: [
        recorded(1, {
          event_name: 'Kiulap Open',
          placing: 1,
          event_date: '2026-11-02',
          correct: 8,
          total: 8,
          time_secs: 161,
        }),
        recorded(2, { event_name: 'Seria Weekend', placing: 4, event_date: '2025-05-10' }),
      ],
      knockout_record: {
        won: 7,
        lost: 3,
        opponents: [{ handle: 'aidil', display_name: 'Aidil H.', matches: 3, won: 2, lost: 1 }],
      },
      cafe_affiliations: [{ name: 'Kopi Tanjong', role: 'Staff' }],
    });

  it('draws the header, stats, gold best result, record, head to head, works with and the footer note', async () => {
    const { root } = await mount(full());
    const t = text(root);
    expect(root.querySelector('h1').textContent).toBe('Syafiqah Omar');
    expect(t).toContain('Seduh ID #0042');
    expect(root.querySelector('.profile-stats').textContent).toMatch(/2competed/);
    expect(root.querySelector('.profile-best-finish').textContent).toBe('1st · Kiulap Open');
    expect(root.querySelector('.profile-best-detail').textContent).toContain('8 / 8 correct');
    expect(t).toContain('Head to head');
    expect(t).toContain('7 won · 3 lost');
    expect(t).toContain('v Aidil H.');
    expect(t).toContain('Works with');
    expect(t).toContain('Kopi Tanjong');
    expect(t).toContain('This record belongs to Syafiqah Omar.');
    expect(t).toContain('“Recorded by Seduh Score”');
    expect(t).toContain('Phone number and email are never shown.');
    expect(document.title).toBe('Syafiqah Omar — Seduh ID — Seduh Score');
  });

  it('links a correction request by email with the handle in the subject', async () => {
    const { root } = await mount(full());
    const link = root.querySelector('.profile-note a');
    expect(link.getAttribute('href')).toMatch(
      /^mailto:.+\?subject=Seduh%20ID%20correction%3A%20syafiqah$/,
    );
  });

  it('has one h1, header and footer beside main, and no link into any profile', async () => {
    const { root } = await mount(full());
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main').querySelector('header, footer')).toBeNull();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
    const hrefs = [...root.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => /^\/id\//.test(h))).toEqual([]);
  });

  it('has no share button yet (a later task)', async () => {
    const { root } = await mount(full());
    expect(text(root)).not.toMatch(/share to story/i);
  });

  it('puts a name in as text, never as markup', async () => {
    const { root } = await mount(
      door({
        identity: {
          display_name: '<img src=x onerror=alert(1)>',
          country_code: 'BN',
          founding_number: 3,
        },
      }),
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('h1').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('free text is text, in every field', () => {
  it('never becomes markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { root } = await mount(
      door({
        recorded_results: [recorded(1, { event_name: hostile, organiser_name: hostile })],
        self_reported: [{ title: hostile, role: hostile }],
        judging_roles: [{ title: hostile }],
        cafe_affiliations: [{ name: hostile }],
        knockout_record: {
          won: 1,
          lost: 0,
          opponents: [{ display_name: hostile, matches: 1, won: 1, lost: 0 }],
        },
      }),
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('main').textContent).toContain(hostile);
  });
});

describe('the country chip', () => {
  it('is plain text while the country pages are not public (the switch is off)', async () => {
    const { root } = await mount(door());
    const chip = [...root.querySelectorAll('.profile-labels li')].find((li) =>
      li.textContent.includes('BN'),
    );
    expect(chip.querySelector('a')).toBeNull();
    expect(root.querySelector('a[href^="/id/country"]')).toBeNull();
  });

  it('links to the country page only when the switch is on', async () => {
    const { root } = await mount(door(), { linkCountry: true });
    expect(root.querySelector('.profile-labels a').getAttribute('href')).toBe('/id/country/bn/');
  });

  it('shows no country chip when the person hides or has no country', async () => {
    const { root } = await mount(
      door({ identity: { display_name: 'A B', country_code: null, founding_number: 5 } }),
    );
    expect(text(root.querySelector('.profile-labels'))).not.toContain('·');
  });
});

describe('provenance labels', () => {
  it('every entry carries the label for where it came from', async () => {
    const { root } = await mount(
      door({
        recorded_results: [recorded(1)],
        organiser_records: [
          { competition_name: 'ASEAN BTC 2024', edition_year: 2024, membership: 'confirmed' },
        ],
        self_reported: [{ competition_name: 'Regional qualifier', year: 2023 }],
      }),
    );
    const labels = [...root.querySelectorAll('.profile-entry')].map((li) =>
      [...li.querySelectorAll('.profile-provenance')].map((n) => n.textContent),
    );
    expect(labels).toHaveLength(3);
    expect(labels).toContainEqual(['Recorded by Seduh Score']);
    // a team link carries TWO labels: the team result is the organiser's, the membership the person's
    expect(labels).toContainEqual([
      'Team result from the organiser’s records',
      'Membership confirmed',
    ]);
    expect(labels).toContainEqual(['Self-reported, not verified by Seduh']);
  });

  it('the stats count everything and say so; the best card prefers a verified result and says which', async () => {
    const { root } = await mount(
      door({
        recorded_results: [recorded(1, { placing: 5 })],
        self_reported: [{ competition_name: 'Won everything', year: 2020, placement: 1 }],
      }),
    );
    expect(root.querySelector('.profile-best-label').textContent).toBe('Best verified result');
    expect(root.querySelector('.profile-best-finish').textContent).toMatch(/^5th/);
    expect(root.querySelector('.profile-stats').textContent).toMatch(/2competed/);
    expect(root.querySelector('.profile-stats-note').textContent).toMatch(/themselves/);
  });

  it('a person with only self-reported entries gets a best card that says it is self-reported', async () => {
    const { root } = await mount(
      door({ self_reported: [{ competition_name: 'Regional', year: 2023, placement: 2 }] }),
    );
    expect(root.querySelector('.profile-best-label').textContent).toBe(
      'Best result, self-reported',
    );
    expect(root.querySelector('.profile-best').textContent).toContain(
      'Self-reported, not verified',
    );
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(1);
  });
});

describe('the owner-shaped record: 14 self-reported entries and 4 team links', () => {
  const owner = () =>
    door({
      self_reported: Array.from({ length: 14 }, (_, i) => ({
        year: 2023 + (i % 4),
        competition_name: `Self ${i}`,
        location: 'Bandar',
        kind: ['competed', 'judged', 'organised'][i % 3],
        role: 'Competitor',
        result_text: '2nd',
        placement: 2,
        note: null,
      })),
      organiser_records: [
        ['quarter_final', null, 2023],
        ['semi_final', 4, 2024],
        ['preliminary', null, 2025],
        ['quarter_final', null, 2026],
      ].map(([stage, placement, year]) => ({
        competition: 'btc',
        competition_name: `ASEAN Barista Team Championship ${year}`,
        edition_year: year,
        team_name: 'Bean Bandits',
        country_code: 'BN',
        stage_reached: stage,
        placement,
        role: 'member',
        membership: 'self_reported',
      })),
    });
  const rowFor = (root, needle) =>
    [...root.querySelectorAll('.profile-entry')].find((li) => li.textContent.includes(needle));

  it('shows every entry, titled by competition name, grouped by edition year, never "Undated" or a raw code', async () => {
    const { root } = await mount(owner(), { linkCountry: false });
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(18);
    const t = text(root);
    expect(t).not.toContain('Undated');
    expect(t).not.toContain('btc');
    expect(t).toContain('ASEAN Barista Team Championship 2024');
    expect(t).toMatch(/Bean Bandits \(BN\)/);
  });

  it('shows the team result words, the role and both labels on a team link', async () => {
    const { root } = await mount(owner(), { linkCountry: false });
    const row = rowFor(root, 'Championship 2024');
    expect(row.textContent).toContain('Member · 4th place');
    expect(row.textContent).toContain('Team result from the organiser’s records');
    expect(row.textContent).toContain('Membership self-reported');
    expect(rowFor(root, 'Championship 2025').textContent).toContain('Preliminaries');
    expect(rowFor(root, 'Championship 2023').textContent).toContain('Quarter-final');
  });

  it('derives the stats from all items and picks the verified best (the organiser 4th place)', async () => {
    const { root } = await mount(owner(), { linkCountry: false });
    const stats = root.querySelector('.profile-stats').textContent;
    expect(stats).toMatch(/9competed/); // 5 self + 4 team
    expect(stats).toMatch(/5judged/);
    expect(stats).toMatch(/4organised/);
    expect(root.querySelector('.profile-best-label').textContent).toBe('Best verified result');
    expect(root.querySelector('.profile-best-finish').textContent).toMatch(/4th.*2024/);
    expect(root.querySelector('.profile-best').textContent).toContain('Membership self-reported');
  });

  it('links the team country only when the country pages are public', async () => {
    const off = await mount(owner(), { linkCountry: false });
    expect(off.root.querySelector('a[href^="/id/country/"]')).toBeNull();
    const on = await mount(owner(), { linkCountry: true });
    expect(on.root.querySelector('.profile-entry a[href="/id/country/bn/"]')).not.toBeNull();
  });
});

describe('the long record (60 mixed entries)', () => {
  it('draws every entry, grouped by year, newest year open and the rest closed', async () => {
    const { root } = await mount(longDoor());
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(60);
    const years = [...root.querySelectorAll('.profile-year')];
    const labels = years.map((d) => d.querySelector('.profile-year-label').textContent);
    expect(labels).toEqual([...labels].sort().reverse());
    expect(labels[0]).toBe('2026');
    expect(years[0].open).toBe(true);
    expect(years.slice(1).every((d) => !d.open)).toBe(true);
    const counts = years.map((d) =>
      Number(d.querySelector('.profile-year-count').textContent.split(' ')[0]),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60);
  });

  it('opens with a summary line by kind', async () => {
    const { root } = await mount(longDoor());
    expect(root.querySelector('.profile-summary').textContent).toMatch(
      /^60 entries: \d+ competed, \d+ judged, \d+ organised, \d+ coached$/,
    );
  });

  it('filters by kind, keeps the newest remaining year open, and announces the count', async () => {
    const { root } = await mount(longDoor());
    const judged = filterButton(root, 'Judged');
    click(judged);
    const shown = root.querySelectorAll('.profile-entry');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(60);
    expect(judged.getAttribute('aria-pressed')).toBe('true');
    expect(filterButton(root, 'All').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.profile-year').open).toBe(true);
    expect(root.querySelector('[role="status"]').textContent).toBe(
      `Showing ${shown.length} judged entries.`,
    );
    click(filterButton(root, 'All'));
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(60);
    expect(root.querySelector('[role="status"]').textContent).toBe('');
  });

  it('a filter shows only entries of that kind', async () => {
    const raw = longDoor();
    const { root } = await mount(raw);
    const expected = normaliseProfile(raw).entries.filter((e) => e.kind === 'organised').length;
    click(filterButton(root, 'Organised'));
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(expected);
  });

  it('offers a chip only for kinds that exist', async () => {
    const { root } = await mount(longDoor());
    expect([...root.querySelectorAll('.profile-filter')].map((b) => b.textContent)).toEqual([
      'All',
      'Competed',
      'Judged',
      'Organised',
      'Coached',
    ]);
  });

  it('hides the filter chips when only one kind exists', async () => {
    const { root } = await mount(door({ recorded_results: [recorded(1), recorded(2)] }));
    expect(root.querySelector('.profile-filters')).toBeNull();
    expect(root.querySelectorAll('.profile-entry')).toHaveLength(2);
  });

  it('an undated entry lands in a closing "Undated" group', async () => {
    const { root } = await mount(
      door({ self_reported: [{ title: 'Old one' }, { title: 'New one', year: 2025 }] }),
    );
    const labels = [...root.querySelectorAll('.profile-year-label')].map((n) => n.textContent);
    expect(labels).toEqual(['2025', 'Undated']);
  });
});

describe('sections with no data are hidden, not shown empty', () => {
  it('shows no knockout, works-with or stats when there is nothing', async () => {
    const { root } = await mount(door({ recorded_results: [recorded(1)] }));
    expect(text(root)).not.toMatch(/Head to head|Works with/);
    expect(root.querySelector('#profile-h2h-title, #profile-works-title')).toBeNull();
  });
});
