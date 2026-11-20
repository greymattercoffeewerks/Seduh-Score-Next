import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PROFILE,
  fetchSeduhProfile,
  handleFromPath,
  normaliseProfile,
  profileProvenanceLabel,
} from './seduhProfile.js';

const door = (over = {}) => ({
  has_profile: true,
  handle: 'syafiqah',
  identity: {
    display_name: 'Syafiqah Omar',
    country_code: 'bn',
    founding_number: 7,
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

describe('normaliseProfile', () => {
  it('turns anything that is not a page into the empty shape', () => {
    for (const raw of [
      null,
      undefined,
      'x',
      [],
      {},
      { has_profile: false },
      { has_profile: 'true' },
      { has_profile: true },
    ]) {
      expect(normaliseProfile(raw)).toEqual(EMPTY_PROFILE);
    }
  });

  it('keeps the identity, upper-cases the country and refuses a malformed one', () => {
    expect(normaliseProfile(door()).identity).toEqual({
      displayName: 'Syafiqah Omar',
      countryCode: 'BN',
      foundingNumber: 7,
      photoUrl: null,
    });
    expect(
      normaliseProfile(door({ identity: { display_name: 'A', country_code: 'Brunei' } })).identity
        .countryCode,
    ).toBeNull();
    expect(
      normaliseProfile(door({ identity: { display_name: 'A', founding_number: 0 } })).identity
        .foundingNumber,
    ).toBeNull();
  });

  it('has no identity when the person hides it (every key null)', () => {
    const p = normaliseProfile(
      door({
        identity: {
          display_name: null,
          country_code: null,
          founding_number: null,
          photo_url: null,
        },
      }),
    );
    expect(p.hasProfile).toBe(true);
    expect(p.identity).toBeNull();
  });

  it('ignores photo_url (a later task draws it)', () => {
    const p = normaliseProfile(
      door({ identity: { display_name: 'A', photo_url: 'https://x/y.webp' } }),
    );
    expect(JSON.stringify(p)).not.toContain('y.webp');
  });

  it('shapes a recorded result as a Seduh Score competed entry', () => {
    const [e] = normaliseProfile(
      door({
        recorded_results: [
          {
            event_name: 'Kiulap Open',
            format: 'cup_taster',
            organiser_name: 'Grey Matter',
            event_date: '2026-11-02',
            placing: 1,
            stage: 'Final',
            correct: 8,
            total: 8,
            time_secs: 161,
            provenance: 'seduh_score',
          },
        ],
      }),
    ).entries;
    expect(e).toMatchObject({
      kind: 'competed',
      provenance: 'seduh_score',
      title: 'Kiulap Open',
      organiser: 'Grey Matter',
      year: 2026,
      placing: 1,
      detail: 'Final · 8 / 8 correct · 2:41',
      format: 'cup_taster',
    });
  });

  it('drops a row with no name and a placing below 1, and types every field', () => {
    const p = normaliseProfile(
      door({
        recorded_results: [
          { event_name: '  ' },
          { event_name: 'X', placing: 0, correct: 'a', time_secs: null },
          5,
          null,
        ],
      }),
    );
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ placing: null, correct: null, detail: '' });
  });

  it('forces provenance by seam: self_reported rows are always self-reported, whatever they claim', () => {
    const p = normaliseProfile(
      door({
        self_reported: [
          { competition_name: 'A', provenance: 'seduh_score', kind: 'judged', year: 2024 },
        ],
        organiser_records: [{ competition_name: 'B', provenance: 'seduh_score' }],
      }),
    );
    expect(p.entries.find((e) => e.title === 'A')).toMatchObject({
      provenance: 'self_reported',
      kind: 'judged',
      year: 2024,
    });
    expect(p.entries.find((e) => e.title === 'B').provenance).toBe('organiser_archive');
  });

  it('reads the real shapes of the two seams (T-ID2.D-a): a self-reported entry and a team link', () => {
    const p = normaliseProfile(
      door({
        self_reported: [
          {
            year: 2025,
            competition_name: 'Regional Open',
            kind: 'judged',
            role: 'head judge',
            result_text: 'Final',
            placement: 3,
            location: 'Testville',
            note: 'A note',
            provenance: 'self_reported',
          },
        ],
        organiser_records: [
          {
            competition: 'btc',
            competition_name: 'ASEAN Championship',
            edition_year: 2024,
            team_name: 'Test Team',
            country_code: 'XA',
            stage_reached: 'quarter_final',
            placement: null,
            role: 'member',
            membership: 'self_reported',
            provenance: 'organiser_archive',
          },
        ],
      }),
    );
    expect(p.entries.find((e) => e.title === 'Regional Open')).toMatchObject({
      kind: 'judged',
      provenance: 'self_reported',
      year: 2025,
      placing: 3,
      location: 'Testville',
      detail: 'head judge · Final · A note',
    });
    // the title is the competition's name, never the competition code ('btc')
    expect(p.entries.find((e) => e.title === 'ASEAN Championship')).toMatchObject({
      provenance: 'organiser_archive',
      year: 2024,
      team: 'Test Team',
      placing: null,
      detail: 'Member · Quarter-final',
      membership: 'self_reported',
      country: 'XA',
    });
    expect(p.entries.some((e) => e.title === 'btc')).toBe(false);
  });

  it('a team link: confirmed stays confirmed, anything else is self-reported; a champion or finalist has a place', () => {
    const link = (over) => ({
      competition_name: 'ASEAN Championship',
      edition_year: 2024,
      team_name: 'T',
      country_code: 'xa',
      ...over,
    });
    const [a, b, c, d] = normaliseProfile(
      door({
        organiser_records: [
          link({ membership: 'confirmed', stage_reached: 'champion', role: 'captain' }),
          link({ membership: 'bogus', stage_reached: 'final' }),
          link({ stage_reached: 'entered', country_code: 'nope' }),
          link({ placement: 4, stage_reached: 'semi_final' }),
        ],
      }),
    ).entries;
    expect(a).toMatchObject({
      membership: 'confirmed',
      placing: 1,
      detail: 'Captain · Champion',
      country: 'XA',
    });
    expect(b).toMatchObject({ membership: 'self_reported', placing: 2, detail: 'Runner-up' });
    expect(c).toMatchObject({ placing: null, country: null, detail: 'Entered' });
    expect(d).toMatchObject({ placing: 4, detail: '4th place' });
  });

  it('judging roles default to judged and to the cautious provenance', () => {
    const [e] = normaliseProfile(
      door({ judging_roles: [{ title: 'BTC 2026', provenance: 'bogus' }] }),
    ).entries;
    expect(e).toMatchObject({ kind: 'judged', provenance: 'self_reported' });
  });

  it('an unknown kind falls back to the seam default', () => {
    const [e] = normaliseProfile(
      door({ self_reported: [{ competition_name: 'A', kind: 'wizard' }] }),
    ).entries;
    expect(e.kind).toBe('competed');
  });

  it('reads a Throwdown result (a place and a round, no score) and its knockout record as the door sends them', () => {
    const p = normaliseProfile(
      door({
        recorded_results: [
          {
            event_name: 'Night One',
            format: 'throwdown',
            organiser_name: 'Grey Matter',
            event_date: '2026-11-27',
            placing: 3,
            stage: 'Semi-finals',
            correct: null,
            total: null,
            time_secs: null,
            provenance: 'seduh_score',
          },
        ],
        knockout_record: {
          won: 5,
          lost: 1,
          opponents: [{ display_name: 'Bravo', matches: 1, won: 1, lost: 0 }],
        },
      }),
    );
    expect(p.entries[0]).toMatchObject({
      format: 'throwdown',
      placing: 3,
      detail: 'Semi-finals',
      correct: null,
      total: null,
    });
    expect(p.knockout).toEqual({
      won: 5,
      lost: 1,
      opponents: [{ displayName: 'Bravo', matches: 1, won: 1, lost: 0 }],
    });
  });

  it('keeps the knockout record and at most ten named opponents', () => {
    const opponents = Array.from({ length: 12 }, (_, i) => ({
      display_name: `Opp ${i}`,
      matches: 1,
      won: 1,
      lost: 0,
    }));
    const p = normaliseProfile(door({ knockout_record: { won: 3, lost: -1, opponents } }));
    expect(p.knockout.won).toBe(3);
    expect(p.knockout.lost).toBe(0);
    expect(p.knockout.opponents).toHaveLength(10);
  });
});

describe('labels and small helpers', () => {
  it('has the three provenance words and treats an unknown one as self-reported', () => {
    expect(profileProvenanceLabel('seduh_score')).toBe('Recorded by Seduh Score');
    expect(profileProvenanceLabel('organiser_archive')).toBe('From the organiser’s records');
    expect(profileProvenanceLabel('self_reported')).toBe('Self-reported, not verified by Seduh');
    expect(profileProvenanceLabel('whatever')).toBe('Self-reported, not verified by Seduh');
  });
  it('reads a handle from /id/<handle>/ only, lower-cased', () => {
    expect(handleFromPath('/id/MFosa/')).toBe('mfosa');
    expect(handleFromPath('/id/mfosa')).toBe('mfosa');
    expect(handleFromPath('/id/')).toBeNull();
    expect(handleFromPath('/id/a/b/')).toBeNull();
    expect(handleFromPath('/id/a.b/')).toBeNull();
    expect(handleFromPath(undefined)).toBeNull();
  });
});

describe('fetchSeduhProfile', () => {
  it('calls the one door with the handle and normalises the answer', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: door(), error: null });
    const p = await fetchSeduhProfile('syafiqah', { rpc });
    expect(rpc).toHaveBeenCalledWith('public_seduh_profile', { p_handle: 'syafiqah' });
    expect(p.hasProfile).toBe(true);
  });
  it('throws on a failed request (a failure is not "no page")', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(fetchSeduhProfile('x', { rpc })).rejects.toThrow('boom');
  });
});

// T-ID2.C2: the photo's accepted shape is exact.
import { cleanPhotoUrl, photoObjectName, photoSrc } from './seduhProfile.js';
describe('the profile photo address', () => {
  const name = `alpha/${'0f'.repeat(16)}.webp`;
  const path = `/storage/v1/object/public/seduh-avatars/${name}`;
  it('accepts only the one relative shape, in the right folder', () => {
    expect(cleanPhotoUrl(path)).toBe(path);
    expect(cleanPhotoUrl(path, 'alpha')).toBe(path);
    expect(cleanPhotoUrl(path, 'beta')).toBeNull();
    for (const bad of [
      null,
      undefined,
      5,
      '',
      `https://x.test${path}`,
      `${path}?a=1`,
      `${path}#x`,
      path.replace('.webp', '.png'),
      path.replace('seduh-avatars', 'x'),
      `${path}/../x`,
      path.toUpperCase(),
    ])
      expect(cleanPhotoUrl(bad), String(bad)).toBeNull();
  });
  it('gives the object name, and the absolute address on a safe origin only', () => {
    expect(photoObjectName(path)).toBe(name);
    expect(photoObjectName('nope')).toBeNull();
    expect(photoSrc(path, 'https://p.supabase.co')).toBe(`https://p.supabase.co${path}`);
    expect(photoSrc(path, 'https://p.supabase.co/rest/v1')).toBe(`https://p.supabase.co${path}`);
    expect(photoSrc(path, 'http://127.0.0.1:54421')).toBe(`http://127.0.0.1:54421${path}`);
    for (const base of ['http://p.supabase.co', 'javascript:alert(1)', '', undefined, 'not a url'])
      expect(photoSrc(path, base), String(base)).toBeNull();
    expect(photoSrc('bad', 'https://p.supabase.co')).toBeNull();
  });
});

import { cardCourse, courseEntry, courseValidityWords } from './seduhProfile.js';
describe('courses and certificates (C6a)', () => {
  const raw = (over = {}) => ({
    title: ' Barista Skills ',
    provider: 'Test Academy',
    completed_year: 2024,
    valid_until_year: 2027,
    level: 'Intermediate',
    note: null,
    current: true,
    on_card: false,
    status: 'self_reported',
    ...over,
  });
  const door = (courses) => ({
    has_profile: true,
    handle: 'abc',
    identity: { display_name: 'A B', country_code: 'BN', founding_number: 1, photo_url: null },
    recorded_results: [],
    organiser_records: [],
    self_reported: [],
    courses,
  });
  it('rebuilds a course from known keys and never calls it confirmed unless the door says so', () => {
    expect(courseEntry(raw())).toEqual({
      id: null,
      title: 'Barista Skills',
      provider: 'Test Academy',
      completedYear: 2024,
      validUntilYear: 2027,
      level: 'Intermediate',
      note: null,
      current: true,
      onCard: false,
      confirmed: false,
    });
    expect(courseEntry(raw({ status: 'verified' })).confirmed).toBe(false);
    expect(courseEntry(raw({ status: 'confirmed' })).confirmed).toBe(true);
  });
  it('drops a malformed course and an end year before the completed year', () => {
    expect(courseEntry(null)).toBeNull();
    expect(courseEntry(raw({ title: '' }))).toBeNull();
    expect(courseEntry(raw({ provider: null }))).toBeNull();
    expect(courseEntry(raw({ completed_year: 'x' }))).toBeNull();
    expect(courseEntry(raw({ valid_until_year: 2020 })).validUntilYear).toBeNull();
  });
  it('words the end year by the database word `current`, never the clock', () => {
    expect(courseValidityWords(courseEntry(raw()))).toBe('Valid until 2027');
    expect(courseValidityWords(courseEntry(raw({ current: false })))).toBe('Expired 2027');
    expect(courseValidityWords(courseEntry(raw({ valid_until_year: null })))).toBeNull();
  });
  it('is its own list: courses never become entries', () => {
    const p = normaliseProfile(door([raw()]));
    expect(p.courses).toHaveLength(1);
    expect(p.entries).toHaveLength(0);
    expect(normaliseProfile(door(undefined)).courses).toEqual([]);
    expect(normaliseProfile({ has_profile: false }).courses).toEqual([]);
  });
  it('the card certificate is the one chosen course that is current', () => {
    const p = normaliseProfile(
      door([raw({ on_card: true, title: 'Chosen' }), raw({ title: 'Other' })]),
    );
    expect(cardCourse(p.courses).title).toBe('Chosen');
    const expired = normaliseProfile(door([raw({ on_card: true, current: false })]));
    expect(cardCourse(expired.courses)).toBeNull();
    expect(cardCourse([])).toBeNull();
  });
});
