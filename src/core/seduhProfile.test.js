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
        self_reported: [{ title: 'A', provenance: 'seduh_score', kind: 'judged', year: 2024 }],
        organiser_records: [{ title: 'B', provenance: 'seduh_score' }],
      }),
    );
    expect(p.entries.find((e) => e.title === 'A')).toMatchObject({
      provenance: 'self_reported',
      kind: 'judged',
      year: 2024,
    });
    expect(p.entries.find((e) => e.title === 'B').provenance).toBe('organiser_archive');
  });

  it('judging roles default to judged and to the cautious provenance', () => {
    const [e] = normaliseProfile(
      door({ judging_roles: [{ title: 'BTC 2026', provenance: 'bogus' }] }),
    ).entries;
    expect(e).toMatchObject({ kind: 'judged', provenance: 'self_reported' });
  });

  it('an unknown kind falls back to the seam default', () => {
    const [e] = normaliseProfile(door({ self_reported: [{ title: 'A', kind: 'wizard' }] })).entries;
    expect(e.kind).toBe('competed');
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
