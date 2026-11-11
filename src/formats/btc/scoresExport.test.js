import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCsv } from '../../core/export.js';
import {
  buildScoresTables,
  eventLabel,
  exportRoundLabel,
  formatLocalDateTime,
  safeText,
  scoresFilename,
  MATCH_COLUMNS,
  CUP_COLUMNS,
} from './scoresExport.js';

const sample = (name) =>
  readFileSync(resolve(process.cwd(), 'docs/specs/samples', name), 'utf8')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);
const csvLines = (table) => buildCsv(table).split('\r\n');

// A local-time timestamp, so the expected "Confirmed at" text does not depend on the machine's zone.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();

const EVENT = { id: 'ev', name: 'SAMPLE ABTC 2027 Regional Final', is_test: false };
const TEAMS = [
  { id: 'kopi', name: 'Kopi Lab', country_code: 'SG' },
  { id: 'pakse', name: 'Pakse Pour', country_code: 'LA' },
  { id: 'drip', name: 'Drip Theory', country_code: 'MY' },
  { id: 'ipoh', name: 'Ipoh White', country_code: 'MY' },
  { id: 'crack', name: 'Second Crack', country_code: 'BN' },
];
const JUDGES = [
  ['j1', 'A. Rahman'],
  ['j2', 'L. Tan'],
  ['j3', 'M. Ito'],
  ['j4', 'P. Nguyen'],
  ['j5', 'S. Lim'],
  ['j6', 'K. Sato'],
  ['j7', 'D. Cruz'],
  ['j8', 'H. Yusof'],
].map(([id, name]) => ({ id, name }));

// Team 1's tokens per cup. The view's sums are written out by hand below: this test never scores.
const R1M1 = [3, 2, 2, 3, 1, 2, 3, 2, 2, 1, 3, 2, 2, 3, 1]; // 32 / 13, 12 cups to team 1
const R1M2 = [3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0]; // 25 / 20, 9 cups to 6
const QF = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 2 : 1)); // 30 / 30

const votesFor = (matchId, tokens) =>
  tokens.map((team1_tokens, i) => ({ match_id: matchId, cup_number: i + 1, team1_tokens }));

const baseMatch = {
  prelim_round: null,
  team1_time_note: null,
  team2_time_note: null,
  tiebreak_winner_team_id: null,
  tiebreak_reason: null,
};

function sampleRows() {
  const matches = [
    {
      match: {
        ...baseMatch,
        id: 'qf1',
        round: 'quarterfinal',
        status: 'confirmed',
        team1_id: 'kopi',
        team2_id: 'crack',
        team1_time_note: '13:55',
        team2_time_note: '13:40',
        created_at: '2027-03-14T05:00:00Z',
        updated_at: at(2027, 3, 14, 15, 2),
        tiebreak_winner_team_id: 'kopi',
        tiebreak_reason: "[the committee's tie-break rule]",
      },
      judgeIds: ['j7', 'j8', 'j1'],
    },
    {
      match: {
        ...baseMatch,
        id: 'm2',
        round: 'preliminary',
        prelim_round: 1,
        status: 'confirmed',
        team1_id: 'drip',
        team2_id: 'ipoh',
        team1_time_note: '9:10',
        team2_time_note: '8:58',
        created_at: '2027-03-14T02:10:00Z',
        updated_at: at(2027, 3, 14, 10, 38),
      },
      judgeIds: ['j4', 'j5', 'j6'],
    },
    {
      match: {
        ...baseMatch,
        id: 'm1',
        round: 'preliminary',
        prelim_round: 1,
        status: 'confirmed',
        team1_id: 'kopi',
        team2_id: 'pakse',
        team1_time_note: '8:42',
        team2_time_note: '8:30',
        created_at: '2027-03-14T02:00:00Z',
        updated_at: at(2027, 3, 14, 10, 21),
      },
      judgeIds: ['j1', 'j2', 'j3'],
    },
  ];
  const score = (match_id, team1_id, team2_id, t1, t2, total1, total2) => ({
    match_id,
    status: 'confirmed',
    team1_id,
    team2_id,
    team1_tokens: t1,
    team2_tokens: t2,
    team1_total: total1,
    team2_total: total2,
  });
  const scores = [
    score('m1', 'kopi', 'pakse', 32, 13, 37, 15),
    score('m2', 'drip', 'ipoh', 25, 20, 30, 22),
    score('qf1', 'kopi', 'crack', 30, 30, 32, 32),
  ];
  const bonus = (match_id, fastest_team_id, team1_signature_beverage = false) => ({
    match_id,
    fastest_team_id,
    team1_signature_beverage,
    team2_signature_beverage: false,
  });
  const bonuses = [bonus('m1', 'pakse'), bonus('m2', 'ipoh'), bonus('qf1', 'crack', true)];
  const cupVotes = [...votesFor('m1', R1M1), ...votesFor('m2', R1M2), ...votesFor('qf1', QF)];
  return { event: EVENT, teams: TEAMS, judges: JUDGES, matches, scores, bonuses, cupVotes };
}

describe('golden: the proposal samples', () => {
  it('writes the matches sample exactly (headers and values)', () => {
    const { matches } = buildScoresTables(sampleRows());
    expect(csvLines(matches)).toEqual(sample('btc-scores-matches-SAMPLE.csv'));
  });

  it('writes the cups sample exactly, for the two matches the sample file shows', () => {
    const { cups } = buildScoresTables(sampleRows());
    const lines = csvLines(cups);
    // The sample cups file is abbreviated: it leaves out Round 1 match 2's cups, which the full output has.
    const withoutMatch2 = lines.filter(
      (line) => !line.startsWith('SAMPLE ABTC 2027 Regional Final,Round 1,2,'),
    );
    expect(withoutMatch2).toEqual(sample('btc-scores-cups-SAMPLE.csv'));
    expect(lines.length).toBe(1 + 15 + 15 + 20);
  });

  it('keeps the column lists as the proposal words them', () => {
    expect(MATCH_COLUMNS.map((c) => c.label)).toEqual(
      sample('btc-scores-matches-SAMPLE.csv')[0].split(','),
    );
    expect(CUP_COLUMNS.map((c) => c.label)).toEqual(
      sample('btc-scores-cups-SAMPLE.csv')[0].split(','),
    );
  });
});

describe('rows and edge cases', () => {
  // The quarterfinal alone, with some of its fields changed.
  const one = (matchOver = {}, scoreOver = {}) => {
    const rows = sampleRows();
    const base = rows.matches[0];
    return buildScoresTables({
      ...rows,
      matches: [{ ...base, match: { ...base.match, ...matchOver } }],
      scores: [{ ...rows.scores[2], ...scoreOver }],
    }).matches.rows[0];
  };

  it('leaves an unconfirmed match with its status and empty score columns, never 0', () => {
    const rows = sampleRows();
    const pending = {
      match: { ...rows.matches[2].match, id: 'p', status: 'pending', team1_time_note: null },
      judgeIds: ['j1', 'j2', 'j3'],
    };
    const zeroScore = {
      match_id: 'p',
      status: 'pending',
      team1_id: 'kopi',
      team2_id: 'pakse',
      team1_tokens: 0,
      team2_tokens: 0,
      team1_total: 0,
      team2_total: 0,
    };
    const tables = buildScoresTables({
      ...rows,
      matches: [pending],
      scores: [zeroScore],
      bonuses: [],
      cupVotes: votesFor('p', [3, 3]),
    });
    const row = tables.matches.rows[0];
    expect(row.status).toBe('Scheduled');
    for (const key of [
      'team1CupsWon',
      'team2CupsWon',
      'team1Tokens',
      'team2Tokens',
      'moreTokens',
      'fastest',
      'team1Signature',
      'team2Signature',
      'team1Total',
      'team2Total',
      'winner',
      'tiebreakWinner',
      'tiebreakReason',
      'confirmedAt',
    ]) {
      expect(row[key], key).toBe('');
    }
    expect(tables.cups.rows).toEqual([]);
  });

  it('says Scoring for a match in scoring, with its score columns empty', () => {
    const row = one({ status: 'scoring' }, { status: 'scoring' });
    expect(row.status).toBe('Scoring');
    expect(row.team1Total).toBe('');
    expect(row.winner).toBe('');
  });

  it('a level knockout with no recorded winner is Level with no tie-break columns', () => {
    const row = one({ tiebreak_winner_team_id: null, tiebreak_reason: null });
    expect(row.winner).toBe('Level');
    expect(row.tiebreakWinner).toBe('');
    expect(row.tiebreakReason).toBe('');
  });

  it('a level knockout with a recorded tie-break names the winner and the reason', () => {
    const row = one({ tiebreak_winner_team_id: 'crack', tiebreak_reason: 'Coin toss' });
    expect(row.winner).toBe('Level'); // the totals are level; the tie-break has its own columns
    expect(row.tiebreakWinner).toBe('Second Crack');
    expect(row.tiebreakReason).toBe('Coin toss');
  });

  it('a decisive knockout ignores a stale recorded tie-break', () => {
    const row = one({}, { team1_total: 40, team2_total: 32 });
    expect(row.winner).toBe('Kopi Lab');
    expect(row.tiebreakWinner).toBe('');
    expect(row.tiebreakReason).toBe('');
  });

  it('a recorded winner who is not one of the two teams is not named', () => {
    const row = one({ tiebreak_winner_team_id: 'drip' });
    expect(row.winner).toBe('Level');
    expect(row.tiebreakWinner).toBe('');
  });

  it('numbers a null prelim_round as round 1 and orders rounds as the proposal lists them', () => {
    const rows = sampleRows();
    const mk = (id, round, prelim, created) => ({
      match: { ...rows.matches[2].match, id, round, prelim_round: prelim, created_at: created },
      judgeIds: [],
    });
    const out = buildScoresTables({
      ...rows,
      matches: [
        mk('f', 'final', null, '2027-03-14T09:00:00Z'),
        mk('t', 'third_place', null, '2027-03-14T08:00:00Z'),
        mk('s', 'semifinal', null, '2027-03-14T07:00:00Z'),
        mk('r2', 'preliminary', 2, '2027-03-14T03:00:00Z'),
        mk('a', 'preliminary', null, '2027-03-14T02:00:00Z'),
        mk('b', 'preliminary', 1, '2027-03-14T01:00:00Z'),
      ],
      scores: [],
    }).matches.rows;
    expect(out.map((r) => `${r.round} ${r.match}`)).toEqual([
      'Round 1 1',
      'Round 1 2',
      'Round 2 1',
      'Semifinal 1',
      'Third place 1',
      'Final 1',
    ]);
    expect(exportRoundLabel({ round: 'preliminary', prelim_round: null })).toBe('Round 1');
    expect(exportRoundLabel({ round: 'quarterfinal' })).toBe('Quarterfinal');
  });

  it('shows n/a for signature in a preliminary round and Yes or No in a knockout', () => {
    const { rows } = buildScoresTables(sampleRows()).matches;
    expect(rows.find((r) => r.round === 'Round 1').team1Signature).toBe('n/a');
    const qf = rows.find((r) => r.round === 'Quarterfinal');
    expect([qf.team1Signature, qf.team2Signature]).toEqual(['Yes', 'No']);
  });

  it('writes an empty country for a team with none, and keeps the row', () => {
    const rows = sampleRows();
    const teams = TEAMS.map((t) => (t.id === 'crack' ? { ...t, country_code: null } : t));
    const row = buildScoresTables({ ...rows, teams }).matches.rows.find(
      (r) => r.round === 'Quarterfinal',
    );
    expect(row.team2).toBe('Second Crack');
    expect(row.team2Country).toBe('');
  });

  it('More tokens is empty when tokens are level; cups won is a display count', () => {
    const row = one({});
    expect(row.moreTokens).toBe('');
    expect([row.team1CupsWon, row.team2CupsWon]).toEqual([10, 10]);
  });

  it('prefixes the event for a test event and a shadow event, in both files', () => {
    expect(eventLabel({ name: 'X', is_test: true })).toBe('TEST · X');
    expect(eventLabel({ name: 'X', is_test: true, is_shadow: true })).toBe('BETA TEST · X');
    expect(eventLabel({ name: 'X', is_shadow: true })).toBe('BETA TEST · X');
    expect(eventLabel({ name: 'X', is_test: false })).toBe('X');
    for (const [flags, prefix] of [
      [{ is_test: true }, 'TEST · '],
      [{ is_shadow: true }, 'BETA TEST · '],
    ]) {
      const t = buildScoresTables({ ...sampleRows(), event: { ...EVENT, ...flags } });
      expect(t.matches.rows.every((r) => r.event.startsWith(prefix))).toBe(true);
      expect(t.cups.rows.every((r) => r.event.startsWith(prefix))).toBe(true);
    }
  });

  it('escapes a team name with a comma or a quote in the CSV', () => {
    const rows = sampleRows();
    const teams = TEAMS.map((t) => (t.id === 'kopi' ? { ...t, name: 'Kopi, "Lab"' } : t));
    const lines = csvLines(buildScoresTables({ ...rows, teams }).matches);
    expect(lines.some((line) => line.includes('"Kopi, ""Lab"""'))).toBe(true);
  });

  it('names team 2 as the winner and the +5 holder when team 2 is ahead', () => {
    const row = one({}, { team1_tokens: 26, team2_tokens: 34, team1_total: 28, team2_total: 41 });
    expect(row.winner).toBe('Second Crack');
    expect(row.moreTokens).toBe('Second Crack');
  });

  it('writes the cups of Round 1 match 2 from its votes', () => {
    const rows = buildScoresTables(sampleRows()).cups.rows.filter((r) => r.match === 2);
    expect(rows.map((r) => r.team1Tokens)).toEqual(R1M2);
    expect(rows.map((r) => r.team2Tokens)).toEqual(R1M2.map((t) => 3 - t));
    expect([rows[0].cupWonBy, rows[4].cupWonBy, rows[12].cupWonBy]).toEqual([
      'Drip Theory',
      'Drip Theory',
      'Ipoh White',
    ]);
  });

  it('leaves score columns empty when the match says confirmed but its score row does not', () => {
    const row = one({}, { status: 'pending' });
    expect(row.status).toBe('Confirmed');
    expect(row.team1Total).toBe('');
    expect(row.winner).toBe('');
  });

  it('keeps formula-like team names, judges, times and reasons as text in the rows', () => {
    const rows = sampleRows();
    const teams = TEAMS.map((t) => (t.id === 'kopi' ? { ...t, name: '=HYPERLINK("x")' } : t));
    const judges = JUDGES.map((j) => (j.id === 'j7' ? { ...j, name: '@cmd' } : j));
    const matches = [
      {
        ...rows.matches[0],
        match: { ...rows.matches[0].match, tiebreak_reason: '+1', team1_time_note: '-5' },
      },
    ];
    const out = buildScoresTables({ ...rows, teams, judges, matches });
    const row = out.matches.rows[0];
    expect(row.team1).toBe(`'=HYPERLINK("x")`);
    expect(row.judge1).toBe("'@cmd");
    expect(row.tiebreakReason).toBe("'+1");
    expect(row.team1Time).toBe("'-5");
    expect(out.cups.rows[0].team1).toBe(`'=HYPERLINK("x")`);
    expect(csvLines(out.matches)[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('keeps a name that starts like a formula as text', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeText('Kopi')).toBe('Kopi');
    expect(safeText(null)).toBe('');
  });

  it('formats Confirmed at in local time and names the files', () => {
    expect(formatLocalDateTime(at(2027, 3, 4, 9, 5))).toBe('2027-03-04 09:05');
    expect(formatLocalDateTime(null)).toBe('');
    expect(scoresFilename({ name: 'BTC Regional 2027!' }, 'cups', new Date(2027, 2, 4))).toBe(
      'btc-regional-2027-cups-2027-03-04.csv',
    );
    expect(scoresFilename({ name: '' }, 'matches', new Date(2027, 0, 9))).toBe(
      'btc-event-matches-2027-01-09.csv',
    );
  });
});
