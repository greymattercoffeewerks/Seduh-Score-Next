// My Seduh ID's pure half: the entry form checked the way the database checks it, every hint in words, the settings in
// plain words, and the record rebuilt from known keys.
import { describe, expect, it } from 'vitest';
import {
  COUNTRY_LISTING,
  SEARCH_LISTING,
  ENTRY_LIMIT,
  LIMITS,
  SETTINGS,
  TEAM_LINK_LIMIT,
  choiceWord,
  describeMeHint,
  fieldForHint,
  groupEntriesByYear,
  isSignedOutHint,
  normaliseMyRecord,
  normaliseTeamOptions,
  teamResultWords,
  validateCourseForm,
  validateEntryForm,
} from './meFlow.js';

const good = {
  year: '2024',
  kind: 'competed',
  competition_name: 'Regional Open',
  location: '',
  role: '',
  result_text: '',
  placement: '',
  note: '',
};
const thisYear = 2026;
const check = (over) => validateEntryForm({ ...good, ...over }, { thisYear });
const chr = (code) => String.fromCharCode(code);

describe('validateEntryForm', () => {
  it('accepts a minimal entry and turns empty optional fields into null', () => {
    expect(check({})).toEqual({
      ok: true,
      params: {
        p_year: 2024,
        p_competition_name: 'Regional Open',
        p_kind: 'competed',
        p_location: null,
        p_role: null,
        p_result_text: null,
        p_placement: null,
        p_note: null,
      },
    });
  });

  it('trims every field and passes a full entry through', () => {
    const r = check({
      competition_name: '  Cup  ',
      location: ' Bandar ',
      role: ' head judge ',
      result_text: ' 2nd ',
      placement: ' 2 ',
      note: ' a note ',
      kind: 'judged',
    });
    expect(r.params).toMatchObject({
      p_competition_name: 'Cup',
      p_location: 'Bandar',
      p_role: 'head judge',
      p_result_text: '2nd',
      p_placement: 2,
      p_note: 'a note',
      p_kind: 'judged',
    });
  });

  it.each([
    ['year', { year: '1979' }, 'bad_year'],
    ['year', { year: '2028' }, 'bad_year'],
    ['year', { year: 'abcd' }, 'bad_year'],
    ['year', { year: '' }, 'bad_year'],
    ['kind', { kind: 'wizard' }, 'bad_kind'],
    ['competition_name', { competition_name: '   ' }, 'bad_competition'],
    ['competition_name', { competition_name: 'x'.repeat(121) }, 'bad_competition'],
    ['location', { location: 'x'.repeat(81) }, 'bad_location'],
    ['role', { role: 'x'.repeat(61) }, 'bad_role'],
    ['result_text', { result_text: 'x'.repeat(81) }, 'bad_result'],
    ['note', { note: 'x'.repeat(501) }, 'bad_note'],
    ['placement', { placement: '0' }, 'bad_placement'],
    ['placement', { placement: '501' }, 'bad_placement'],
    ['placement', { placement: '2.5' }, 'bad_placement'],
    ['placement', { placement: 'first' }, 'bad_placement'],
  ])('refuses a bad %s with its own hint', (field, over, hint) => {
    const r = check(over);
    expect(r.ok).toBe(false);
    expect(r.errors[field]).toBe(hint);
  });

  it('allows the limits exactly, and next year (anywhere on Earth)', () => {
    const r = check({
      year: '2027',
      competition_name: 'x'.repeat(LIMITS.competition_name),
      note: 'x'.repeat(LIMITS.note),
      placement: String(LIMITS.maxPlacement),
    });
    expect(r.ok).toBe(true);
  });

  it('refuses control, invisible and direction-override characters in any text field', () => {
    for (const bad of [chr(0), chr(9), chr(0x202e), chr(0x200b), chr(0x2028), chr(0xad)]) {
      expect(
        check({ competition_name: `Cu${bad}p` }).errors?.competition_name,
        bad.charCodeAt(0),
      ).toBe('bad_competition');
      expect(check({ note: `a${bad}b` }).errors?.note).toBe('bad_note');
    }
  });

  it('reports every wrong field at once', () => {
    const r = check({ year: '1', competition_name: '', placement: 'x' });
    expect(Object.keys(r.errors).sort()).toEqual(['competition_name', 'placement', 'year']);
  });
});

describe('hints in words', () => {
  const hints = [
    'no_account',
    'bad_year',
    'bad_kind',
    'bad_competition',
    'bad_location',
    'bad_role',
    'bad_result',
    'bad_placement',
    'bad_note',
    'too_many_entries',
    'not_found',
    'bad_input',
    'team_not_found',
    'already_linked',
    'too_many_links',
    'bad_setting',
    'photo_not_image',
    'photo_input_too_big',
    'photo_unreadable',
    'photo_too_big',
    'photo_bad_type',
    'photo_upload_failed',
    'bad_path',
    'no_object',
    'otp_invalid',
    'too_many_attempts',
    'signed_out',
    'offline',
    'timeout',
    'server_error',
  ];
  it('every hint of the person doors and of signing in has its own sentence, never a raw code', () => {
    const generic = describeMeHint('nothing_like_this');
    for (const hint of hints) {
      const words = describeMeHint(hint);
      expect(words, hint).not.toBe(generic);
      expect(words, hint).not.toContain('_');
      expect(words.length).toBeGreaterThan(20);
    }
  });
  it('the limits named in words are the real ones', () => {
    expect(describeMeHint('too_many_entries')).toContain(String(ENTRY_LIMIT));
    expect(describeMeHint('too_many_links')).toContain(String(TEAM_LINK_LIMIT));
  });
  it('an unknown or missing hint gets the generic sentence', () => {
    expect(describeMeHint(undefined)).toBe(describeMeHint('x'));
    expect(describeMeHint('toString')).toBe(describeMeHint('x'));
  });
  it('a refusal maps to its form field, and a sign-in loss is recognised', () => {
    expect(fieldForHint('bad_note')).toBe('note');
    expect(fieldForHint('too_many_entries')).toBeNull();
    expect(isSignedOutHint('no_account')).toBe(true);
    expect(isSignedOutHint('signed_out')).toBe(true);
    expect(isSignedOutHint('bad_year')).toBe(false);
  });
});

describe('settings in words', () => {
  it('covers exactly the eight visibility settings of the door, plus the country listing', () => {
    expect(SETTINGS.map((s) => s.key).sort()).toEqual([
      'vis_cafe_affiliations',
      'vis_courses',
      'vis_identity',
      'vis_judging_roles',
      'vis_knockout_record',
      'vis_organiser_results',
      'vis_recorded_results',
      'vis_self_reported_results',
    ]);
    expect(COUNTRY_LISTING.key).toBe('listed_on_country_pages');
  });
  it('offers each setting only the values the door accepts', () => {
    for (const s of SETTINGS) {
      const values = s.choices.map(([v]) => v);
      const three = [
        'vis_recorded_results',
        'vis_organiser_results',
        'vis_self_reported_results',
        'vis_judging_roles',
      ];
      expect(values, s.key).toEqual(
        three.includes(s.key) ? ['public', 'organisers', 'hidden'] : ['public', 'hidden'],
      );
    }
    expect(choiceWord('vis_judging_roles', 'organisers')).toBe('Only organisers I competed for');
    expect(choiceWord('vis_identity', 'organisers')).toBeNull();
  });
  it('says the country listing is off unless switched on, and when it shows', () => {
    expect(COUNTRY_LISTING.help).toMatch(/Off unless you switch it on/);
    expect(COUNTRY_LISTING.help).toMatch(/public/);
  });
});

describe('normaliseMyRecord', () => {
  const raw = () => ({
    account: {
      handle: 'mine',
      founding_number: 7,
      display_name: 'Test Person',
      country_code: 'BN',
    },
    settings: { vis_identity: 'hidden', vis_judging_roles: 'bogus', listed_on_country_pages: true },
    entries: [
      { id: 1, year: 2024, competition_name: 'A', kind: 'judged', placement: 0, note: ' n ' },
      { id: 'x', year: 2024, competition_name: 'bad id' },
      { id: 2, year: 2023, competition_name: 'B', kind: 'wizard' },
    ],
    team_links: [
      {
        id: 5,
        team_key: 'k',
        team_name: 'T',
        country_code: 'bn',
        membership: 'bogus',
        role: 'captain',
      },
      { id: 6, team_name: 'U', membership: 'confirmed', listed: false },
      { id: 7 },
    ],
  });
  it('rebuilds from known keys and drops rows that cannot be drawn', () => {
    const r = normaliseMyRecord(raw());
    expect(r.account).toMatchObject({
      handle: 'mine',
      foundingNumber: 7,
      displayName: 'Test Person',
    });
    expect(r.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(r.entries[0]).toMatchObject({ kind: 'judged', placement: null, note: 'n' });
    expect(r.entries[1].kind).toBe('competed');
    expect(r.teamLinks.map((l) => l.id)).toEqual([5, 6]);
  });
  it('never claims more than it knows: only the word confirmed is confirmed', () => {
    const r = normaliseMyRecord(raw());
    expect(r.teamLinks[0]).toMatchObject({
      membership: 'self_reported',
      country_code: 'BN',
      role: 'captain',
    });
    expect(r.teamLinks[1]).toMatchObject({ membership: 'confirmed', listed: false });
  });
  it('settings: a value outside the vocabulary falls back to the default, the listing is off unless true', () => {
    const r = normaliseMyRecord(raw());
    expect(r.settings.vis_identity).toBe('hidden');
    expect(r.settings.vis_judging_roles).toBe('public');
    expect(r.settings.listed_on_country_pages).toBe(true);
    expect(normaliseMyRecord({ account: { handle: 'x' } }).settings.listed_on_country_pages).toBe(
      false,
    );
  });
  it('is null for anything that is not a record', () => {
    for (const bad of [null, 'x', {}, { account: {} }]) expect(normaliseMyRecord(bad)).toBeNull();
  });
});

describe('grouping and words', () => {
  it('groups by year, newest first, keeping the order inside a year', () => {
    const groups = groupEntriesByYear([
      { id: 1, year: 2020 },
      { id: 2, year: 2024 },
      { id: 3, year: 2020 },
      { id: 4, year: 2024 },
    ]);
    expect(groups.map((g) => g.year)).toEqual([2024, 2020]);
    expect(groups[0].entries.map((e) => e.id)).toEqual([2, 4]);
  });
  it('the picker answer is rebuilt and the truncation flag is kept', () => {
    const o = normaliseTeamOptions({
      teams: [
        { team_key: 'k', team_name: 'T', linked: true, edition_year: 2024 },
        { team_name: 'no key' },
      ],
      truncated: true,
    });
    expect(o.teams).toHaveLength(1);
    expect(o.teams[0].linked).toBe(true);
    expect(o.truncated).toBe(true);
    expect(normaliseTeamOptions(null)).toEqual({ teams: [], truncated: false });
  });
  it('words a team result', () => {
    expect(teamResultWords({ placement: 4, stage_reached: 'semi_final' })).toBe('4th place');
    expect(teamResultWords({ placement: null, stage_reached: 'quarter_final' })).toBe(
      'Quarter-final',
    );
    expect(teamResultWords({ placement: null, stage_reached: 'champion' })).toBe('Champion');
    expect(teamResultWords({ placement: null, stage_reached: null })).toBe('');
  });
});

describe('Show me in Seduh ID search (T-ID2.C5)', () => {
  it('is on unless the record says exactly false', () => {
    const rec = (settings) => normaliseMyRecord({ account: { handle: 'x' }, settings });
    expect(rec({}).settings.listed_in_search).toBe(true);
    expect(rec({ listed_in_search: true }).settings.listed_in_search).toBe(true);
    expect(rec({ listed_in_search: false }).settings.listed_in_search).toBe(false);
    expect(rec({ listed_in_search: 'no' }).settings.listed_in_search).toBe(true);
    expect(SEARCH_LISTING.key).toBe('listed_in_search');
    expect(SEARCH_LISTING.label).toBe('Show me in Seduh ID search');
  });
});

describe('courses and certificates', () => {
  const good = {
    title: ' Barista Skills ',
    provider: ' Test Academy ',
    year: '2024',
    valid_until_year: '2027',
    level: '',
    note: '',
  };
  it('checks a course form the way the database will and sends trimmed values, empty optionals as null', () => {
    expect(validateCourseForm(good, { thisYear: 2026 })).toEqual({
      ok: true,
      params: {
        p_title: 'Barista Skills',
        p_provider: 'Test Academy',
        p_completed_year: 2024,
        p_valid_until_year: 2027,
        p_level: null,
        p_note: null,
      },
    });
    expect(
      validateCourseForm({ ...good, valid_until_year: '' }, { thisYear: 2026 }).params
        .p_valid_until_year,
    ).toBeNull();
  });
  it('names every wrong field with its own hint', () => {
    const r = validateCourseForm(
      {
        title: ' ',
        provider: 'x'.repeat(81),
        year: '1979',
        valid_until_year: '2030',
        level: 'l'.repeat(41),
        note: 'n'.repeat(301),
      },
      { thisYear: 2026 },
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual({
      year: 'bad_year',
      title: 'bad_title',
      provider: 'bad_provider',
      level: 'bad_level',
      note: 'bad_note',
    });
  });
  it('refuses an end year before the completed year, and control or direction characters', () => {
    expect(
      validateCourseForm({ ...good, valid_until_year: '2023' }, { thisYear: 2026 }).errors,
    ).toEqual({ valid_until_year: 'bad_valid_until' });
    expect(validateCourseForm({ ...good, title: 'a\u202Eb' }, { thisYear: 2026 }).errors).toEqual({
      title: 'bad_title',
    });
    expect(validateCourseForm({ ...good, year: '2028' }, { thisYear: 2026 }).errors).toEqual({
      year: 'bad_year',
    });
  });
  it('says every course hint in words, and maps each to its field', () => {
    for (const hint of [
      'bad_title',
      'bad_provider',
      'bad_valid_until',
      'bad_level',
      'too_many_courses',
      'not_current',
    ]) {
      expect(describeMeHint(hint), hint).not.toMatch(/^Something went wrong/);
    }
    expect(fieldForHint('bad_title')).toBe('title');
    expect(fieldForHint('bad_valid_until')).toBe('valid_until_year');
  });
  it("rebuilds courses from known keys; only the exact word confirmed is confirmed; current is the database's word", () => {
    const rec = normaliseMyRecord({
      account: { handle: 'mine' },
      settings: {},
      courses: [
        {
          id: 1,
          title: 'A',
          provider: 'P',
          completed_year: 2020,
          valid_until_year: 2019,
          status: 'maybe',
          current: false,
          on_card: true,
        },
        {
          id: 2,
          title: 'B',
          provider: 'P',
          completed_year: 2021,
          valid_until_year: 2030,
          status: 'confirmed',
        },
        { id: 3, title: '', provider: 'P', completed_year: 2021 },
        { title: 'no id', provider: 'P', completed_year: 2021 },
      ],
    });
    expect(rec.courses).toHaveLength(2);
    expect(rec.courses[0]).toMatchObject({
      valid_until_year: null,
      confirmed: false,
      current: false,
      on_card: true,
    });
    expect(rec.courses[1]).toMatchObject({
      valid_until_year: 2030,
      confirmed: true,
      current: true,
      on_card: false,
    });
    expect(rec.settings.vis_courses).toBe('public');
  });
});
