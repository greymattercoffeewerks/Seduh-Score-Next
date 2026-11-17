// The person story card's content: highlights only, honest provenance words, hidden name = no card. Fictional data.
import { describe, expect, it } from 'vitest';
import { normaliseProfile } from '../core/seduhProfile.js';
import {
  availableStyles,
  canMakeStoryCard,
  cardPhotoUrl,
  latestResult,
  personAddress,
  personStorySpec,
  personUrl,
} from './profileStory.js';

const door = (over = {}) => ({
  has_profile: true,
  handle: 'syafiqah',
  identity: {
    display_name: 'Syafiqah Omar',
    country_code: 'BN',
    founding_number: 1,
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
const recorded = (over = {}) => ({
  event_name: 'Kiulap Open',
  format: 'cup_taster',
  organiser_name: 'Proof Org',
  event_date: '2026-03-15',
  placing: 2,
  stage: 'Final',
  correct: 6,
  total: 8,
  time_secs: 100,
  provenance: 'seduh_score',
  ...over,
});
const selfEntry = (over = {}) => ({
  id: 's1',
  kind: 'competed',
  title: 'Home Brew Cup',
  year: 2025,
  placing: 1,
  ...over,
});
const team = (membership) => ({
  competition: 'btc',
  competition_name: 'ASEAN BTC',
  edition_year: 2024,
  placement: 4,
  team_name: 'Bean Bandits',
  country_code: 'BN',
  role: 'member',
  membership,
});
const profile = (over) => normaliseProfile(door(over));

describe('the card is for a public name only', () => {
  it('has no card when the identity is hidden', () => {
    const hidden = profile({
      identity: { display_name: null, country_code: null, founding_number: null, photo_url: null },
      recorded_results: [recorded()],
    });
    expect(hidden.identity).toBeNull();
    expect(canMakeStoryCard(hidden)).toBe(false);
    expect(personStorySpec(hidden)).toBeNull();
    expect(availableStyles(hidden)).toEqual([]);
  });
});

describe('personStorySpec: whole record', () => {
  const p = profile({
    recorded_results: [
      recorded(),
      recorded({ event_name: 'Old Cup', event_date: '2024-05-01', placing: 5 }),
    ],
  });
  const spec = personStorySpec(p, 'record');

  it('names the person, the founding number like the page, the country and the address', () => {
    expect(spec.title).toBe('Syafiqah Omar');
    expect(spec.tile).toBe('#0001');
    expect(spec.subtitle).toBe('Brunei');
    expect(spec.address).toBe('seduhscore.com/id/syafiqah');
    expect(personUrl('syafiqah')).toBe('https://www.seduhscore.com/id/syafiqah');
    expect(personAddress('x1')).toBe('seduhscore.com/id/x1');
    expect(spec.tileInitials).toBe('SO');
  });
  it('shows the page own headline counts (competed and podiums), nothing else', () => {
    expect(spec.stats).toEqual([
      { value: '2', label: 'competed' },
      { value: '1', label: 'podium' },
    ]);
  });
  it('highlights the best verified result, with Seduh Score own words', () => {
    expect(spec.highlight.label).toBe('Best verified result');
    expect(spec.highlight.text).toContain('2nd');
    expect(spec.provenance).toContain('Recorded by Seduh Score');
  });
  it('never offers more than four counts and leaves out coached and volunteered', () => {
    const many = profile({
      recorded_results: [recorded()],
      self_reported: [
        selfEntry({ id: 'a', kind: 'judged' }),
        selfEntry({ id: 'b', kind: 'organised' }),
        selfEntry({ id: 'c', kind: 'coached' }),
        selfEntry({ id: 'd', kind: 'volunteered' }),
      ],
    });
    const labels = personStorySpec(many, 'record').stats.map((s) => s.label);
    expect(labels).toEqual(['competed', 'judged', 'organised', 'podium']);
  });
});

describe('highlight selection, and highlights only', () => {
  const p = profile({
    recorded_results: [
      recorded({ event_name: 'Kiulap Open', event_date: '2026-03-15', placing: 2 }),
      recorded({ event_name: 'Mid Cup', event_date: '2025-06-01', placing: 1 }),
      recorded({ event_name: 'Old Cup', event_date: '2024-05-01', placing: 5 }),
    ],
    self_reported: [selfEntry({ title: 'Home Cup', year: 2027, placing: 1 })],
  });
  it('highlights the best verified result, not the first, the newest or a self-reported one', () => {
    const spec = personStorySpec(p, 'record');
    expect(spec.highlight.text).toBe('1st · Mid Cup');
    expect(spec.highlight.label).toBe('Best verified result');
  });
  it('carries no record: only the named highlight fields', () => {
    const spec = personStorySpec(p, 'record');
    expect(Object.keys(spec).sort()).toEqual(
      [
        'address',
        'eyebrow',
        'highlight',
        'provenance',
        'stats',
        'subtitle',
        'tagline',
        'tile',
        'tileInitials',
        'tileWidth',
        'title',
      ].sort(),
    );
    expect(JSON.stringify(spec)).not.toContain('Old Cup');
  });
  it('latest skips a newer competed entry with no placing in favour of the newest placed one', () => {
    const q = profile({
      recorded_results: [recorded({ event_name: 'Placed Cup', event_date: '2025-06-01' })],
      self_reported: [selfEntry({ title: 'Unplaced Cup', year: 2027, placing: null })],
    });
    expect(personStorySpec(q, 'latest').highlight.text).toBe('2nd · Placed Cup');
  });
});

describe('provenance honesty', () => {
  it('says self-reported on a self-reported best result and never verified', () => {
    const spec = personStorySpec(profile({ self_reported: [selfEntry()] }), 'record');
    expect(spec.highlight.label).toBe('Best result');
    expect(spec.provenance).toMatch(/Self-reported, not verified by Seduh/);
    expect(spec.provenance).toMatch(/Totals include self-reported entries/);
    expect(JSON.stringify(spec)).not.toMatch(/Best verified/);
  });
  it('a team result with a self-reported membership is not verified, and says so', () => {
    const spec = personStorySpec(profile({ organiser_records: [team('self_reported')] }));
    expect(spec.highlight.label).toBe('Best result');
    expect(spec.provenance).toContain('Membership self-reported');
  });
  it('a confirmed membership may be called verified', () => {
    const spec = personStorySpec(profile({ organiser_records: [team('confirmed')] }));
    expect(spec.highlight.label).toBe('Best verified result');
  });
});

describe('personStorySpec: latest result', () => {
  const p = profile({
    recorded_results: [recorded({ event_date: '2024-05-01', event_name: 'Old Cup', placing: 1 })],
    self_reported: [selfEntry({ year: 2026, title: 'Newest Cup', placing: 3 })],
  });
  it('picks the newest placed competed entry, with that entry own provenance', () => {
    expect(latestResult(p.entries).title).toBe('Newest Cup');
    const spec = personStorySpec(p, 'latest');
    expect(spec.highlight.label).toBe('Latest result');
    expect(spec.highlight.text).toBe('3rd · Newest Cup');
    expect(spec.provenance).toMatch(/Self-reported/);
    expect(spec.stats.map((s) => s.label)).toEqual(['competed', 'podiums']);
  });
  it('is not offered when there is no competed entry', () => {
    const j = profile({ self_reported: [selfEntry({ kind: 'judged' })] });
    expect(availableStyles(j).map((s) => s.key)).toEqual(['record']);
    expect(availableStyles(p).map((s) => s.key)).toEqual(['record', 'latest']);
  });
});

describe('a person with nothing yet, and the photo', () => {
  it('still has a plain whole-record card (name, number, address)', () => {
    const spec = personStorySpec(profile({}), 'record');
    expect(spec.highlight).toBeNull();
    expect(spec.stats).toEqual([]);
    expect(spec.provenance).toBeTruthy();
  });
  it('builds the photo address on the project origin, else null (initials)', () => {
    const handle = 'syafiqah';
    const path = `/storage/v1/object/public/seduh-avatars/${handle}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp`;
    const withPhoto = profile({
      identity: {
        display_name: 'Syafiqah Omar',
        country_code: 'BN',
        founding_number: 1,
        photo_url: path,
      },
    });
    expect(cardPhotoUrl(withPhoto, 'https://proj.supabase.co')).toBe(
      `https://proj.supabase.co${path}`,
    );
    expect(cardPhotoUrl(profile({}), 'https://proj.supabase.co')).toBeNull();
    expect(cardPhotoUrl(withPhoto, 'http://proj.supabase.co')).toBeNull();
  });
});
