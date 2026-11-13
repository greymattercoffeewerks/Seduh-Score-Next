import { describe, expect, it } from 'vitest';
import {
  fetchCountryIndex,
  fetchCountryRecord,
  normaliseCountryIndex,
  normaliseCountryRecord,
  provenanceLabel,
} from './countryRecord.js';

import { FICTIONAL_RECORD } from './countryRecord.testkit.js';

describe('normaliseCountryRecord', () => {
  it('rebuilds a good record in the page shape', () => {
    const record = normaliseCountryRecord(FICTIONAL_RECORD);
    expect(record.hasRecord).toBe(true);
    expect(record.stats.bestFinish).toEqual({
      teamName: 'Alpha Brew',
      year: 2025,
      stage: 'semi_final',
      placement: 3,
    });
    expect(record.championships[0].teams[0].rounds[1]).toMatchObject({
      round: 'quarter_final',
      score: 26,
      opponentTeamName: 'Rival',
      opponentScore: 20,
    });
    expect(record.championships[0].suppliedBy).toBe('Fictional Federation');
    expect(record.teams[0].years).toEqual([2024, 2025]);
  });

  it.each([
    null,
    undefined,
    'x',
    5,
    [],
    {},
    { has_record: true },
    { has_record: true, championships: 'no' },
  ])('never throws and says "no record" for %j', (raw) => {
    const record = normaliseCountryRecord(raw);
    expect(record.hasRecord).toBe(false);
    expect(record.championships).toEqual([]);
  });

  it('drops a team with an unknown stage, a round with no score and a half pairing, and trims text', () => {
    const raw = structuredClone(FICTIONAL_RECORD);
    raw.championships[0].teams.push({
      team_name: 'Ghost',
      stage_reached: 'winner-ish',
      rounds: [],
    });
    raw.championships[0].teams[0].rounds.push(
      { round: 'semi_final', score: 'many' },
      { round: 'weird', score: 3 },
    );
    raw.championships[0].teams[0].rounds[0].opponent_team_name = 'Half'; // a name with no score is no pairing
    const record = normaliseCountryRecord(raw);
    const team = record.championships[0].teams;
    expect(team.map((t) => t.teamName)).toEqual(['Alpha Brew']);
    expect(team[0].rounds.map((r) => r.round)).toEqual(['preliminary', 'quarter_final']);
    expect(team[0].rounds[0].opponentTeamName).toBeNull();
  });

  it('says "no record" when the database says yes but nothing can be drawn', () => {
    expect(
      normaliseCountryRecord({ has_record: true, championships: [{ edition_year: 'x' }] })
        .hasRecord,
    ).toBe(false);
  });
});

describe('provenance', () => {
  it('labels the organiser archive as such, and never claims "Recorded by Seduh Score" for an unknown source', () => {
    expect(provenanceLabel('organiser_archive')).toBe('From the organiser’s records');
    expect(provenanceLabel('seduh_score')).toBe('Recorded by Seduh Score');
    expect(provenanceLabel('something_new')).toBe('From the organiser’s records');
    expect(provenanceLabel(undefined)).toBe('From the organiser’s records');
  });
});

describe('index and reads', () => {
  it('keeps only rows with a two-letter upper-case code', () => {
    expect(
      normaliseCountryIndex({
        countries: [
          { country_code: 'XA', championships: 2, entries: 3, teams: 2 },
          { country_code: 'xa' },
          { country_code: 'XAB' },
          null,
        ],
      }),
    ).toEqual([{ code: 'XA', championships: 2, entries: 3, teams: 2 }]);
    expect(normaliseCountryIndex(null)).toEqual([]);
  });

  it('calls the two doors by name with the code, and throws on a failed request (not "no record")', async () => {
    const calls = [];
    const client = {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return {
          data: name === 'public_country_index' ? { countries: [] } : FICTIONAL_RECORD,
          error: null,
        };
      },
    };
    expect((await fetchCountryRecord('XA', client)).hasRecord).toBe(true);
    expect(await fetchCountryIndex(client)).toEqual([]);
    expect(calls).toEqual([
      ['public_country_record', { p_country_code: 'XA' }],
      ['public_country_index', undefined],
    ]);
    const failing = { rpc: async () => ({ data: null, error: new Error('boom') }) };
    await expect(fetchCountryRecord('XA', failing)).rejects.toThrow('boom');
  });
});
