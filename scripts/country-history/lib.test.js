// Unit tests for the country-history import. FICTIONAL data only (the real results are never committed): countries XA,
// XB and XC are user-assigned ISO codes that no real country uses, accepted through the `extraCodes` option.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCsv,
  readTable,
  stageSlug,
  buildDataset,
  summarise,
  toSql,
  looksLikePersonName,
} from './lib.mjs';
import { countryCode, ISO_COUNTRIES } from './iso.mjs';
import { run, parseArgs } from './import.mjs';

const OPTS = {
  permissionRef: 'Fictional Federation, 2026-01-01: test',
  suppliedOn: '2026-01-01',
  extraCodes: ['XA', 'XB', 'XC'],
  currentYear: 2026,
};
const WORDS = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliet',
];
const COUNTRY = ['XA', 'XB', 'XC'];

const csv = (rows) =>
  rows
    .map((r) =>
      r
        .map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c)))
        .join(','),
    )
    .join('\n');

// One complete fictional championship: 10 teams, 8 in the quarter-finals, 4 in the semi-finals, a final and a
// third-place match. T1 champion, T2 final, T3 3rd, T4 4th, T5 to T8 quarter-finalists, T9 and T10 out in the preliminaries.
function year(y, edit = {}) {
  const teams = WORDS.map((w, i) => ({ n: i + 1, name: `Crew ${w}`, country: COUNTRY[i % 3] }));
  const stage = [
    'champion',
    'final',
    'semi_final',
    'semi_final',
    'quarter_final',
    'quarter_final',
    'quarter_final',
    'quarter_final',
    'preliminary',
    'preliminary',
  ];
  const placement = [1, 2, 3, 4, '', '', '', '', '', ''];
  const tpl = teams.map((t, i) => [
    `Fictional Cup ${y}`,
    y,
    'Testville',
    'XA',
    t.name,
    t.country,
    stage[i],
    placement[i],
    'Fictional Federation',
  ]);
  const rnd = [];
  teams.forEach((t, i) => rnd.push([y, 'preliminary', t.name, t.country, '', '', 100 - i, '', '']));
  teams
    .slice(0, 8)
    .forEach((t, i) => rnd.push([y, 'quarter_final', t.name, t.country, '', '', 20 - i, '', '']));
  const pair = (round, a, b, sa, sb) => {
    rnd.push([y, round, teams[a].name, teams[a].country, '', '', sa, teams[b].name, sb]);
    rnd.push([y, round, teams[b].name, teams[b].country, '', '', sb, teams[a].name, sa]);
  };
  const semiScore = [14, 13, 12, 11];
  teams
    .slice(0, 4)
    .forEach((t, i) =>
      rnd.push([y, 'semi_final', t.name, t.country, '', '', semiScore[i], '', '']),
    );
  pair('final_champion', 0, 1, 15, 12);
  pair('final_runner_up', 2, 3, 17, 8);
  edit.tpl?.(tpl);
  edit.rnd?.(rnd);
  return { tpl, rnd };
}
const TPL_HEAD = [
  'competition_name',
  'edition_year',
  'host_city',
  'host_country',
  'team_name',
  'country',
  'stage_reached',
  'placement',
  'supplied_by',
];
const RND_HEAD = [
  'edition_year',
  'round',
  'team_name',
  'country',
  'r1',
  'r2',
  'score',
  'opponent',
  'opponent_score',
];

function dataset(edit = {}, years = [2024], options = OPTS) {
  const all = years.map((y) => year(y, edit));
  return buildDataset({
    templateText: csv([TPL_HEAD, ...all.flatMap((a) => a.tpl)]),
    roundsText: csv([RND_HEAD, ...all.flatMap((a) => a.rnd)]),
    templateName: 'fictional.csv',
    options,
  });
}
const hasError = (d, re) => d.errors.some((e) => re.test(e));

describe('csv', () => {
  it('reads quotes, doubled quotes, embedded commas and newlines, CRLF and a byte-order mark', () => {
    const grid = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n');
    expect(grid).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });
  it('numbers data rows from 1 and trims cells and lower-cases headers', () => {
    const t = readTable('Team_Name , Score\n  A  ,1\nB,2');
    expect(t.headers).toEqual(['team_name', 'score']);
    expect(t.rows.map((r) => [r.__row, r.team_name])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
  });
});

describe('vocabulary and codes', () => {
  it("maps the organiser's labels to the stage slugs", () => {
    expect(stageSlug('Quarter-final')).toBe('quarter_final');
    expect(stageSlug(' Semi final ')).toBe('semi_final');
    expect(stageSlug('Champion')).toBe('champion');
  });
  it('knows all 249 ISO codes and reads names, aliases and codes, and rejects the rest', () => {
    expect(Object.keys(ISO_COUNTRIES)).toHaveLength(249);
    expect(countryCode('Brunei')).toBe('BN');
    expect(countryCode('brunei darussalam')).toBe('BN');
    expect(countryCode('vn')).toBe('VN');
    expect(countryCode('XA')).toBeNull();
    expect(countryCode('XA', ['XA'])).toBe('XA');
    expect(countryCode('Atlantis')).toBeNull();
    expect(countryCode('')).toBeNull();
  });
});

describe('a complete, correct fictional championship', () => {
  const d = dataset();
  it('has no errors and no warnings', () => {
    expect(d.errors).toEqual([]);
    expect(d.warnings).toEqual([]);
  });
  it('turns the template into rows of the table', () => {
    expect(d.results).toHaveLength(10);
    const t1 = d.results.find((r) => r.team_name === 'Crew Alpha');
    expect(t1).toMatchObject({
      competition: 'btc',
      edition_year: 2024,
      country_code: 'XA',
      stage_reached: 'champion',
      placement: 1,
      host_country_code: 'XA',
      source_ref: 'fictional.csv#1',
      score_note: null,
    });
    expect(d.rounds).toHaveLength(10 + 8 + 4 + 2 + 2);
  });
  it('previews the counts per year and per country', () => {
    const s = summarise(d);
    expect(s.perYear).toEqual([{ year: 2024, entries: 10, countries: 3, rounds: 26 }]);
    expect(s.perCountry.map((c) => [c.code, c.entries])).toEqual([
      ['XA', 4],
      ['XB', 3],
      ['XC', 3],
    ]);
  });
});

describe('what the validator refuses (each is an error that blocks a load)', () => {
  it('a country that is not ISO', () => {
    const d = dataset({ tpl: (t) => (t[4][5] = 'Atlantis') });
    expect(hasError(d, /country "Atlantis" is not an ISO/)).toBe(true);
  });
  it("a country code that is only valid for the fixtures, when the fixtures' codes are not allowed", () => {
    const d = dataset({}, [2024], { ...OPTS, extraCodes: [] });
    expect(hasError(d, /country "XA" is not an ISO/)).toBe(true);
  });
  it('a stage outside the vocabulary', () => {
    const d = dataset({ tpl: (t) => (t[8][6] = 'wild card') });
    expect(hasError(d, /stage_reached "wild card" is not one of/)).toBe(true);
  });
  it('a round outside the vocabulary', () => {
    const d = dataset({ rnd: (r) => (r[0][1] = 'repechage') });
    expect(hasError(d, /round "repechage" is not one of/)).toBe(true);
  });
  it('a year in the future, and one before 2000', () => {
    expect(
      hasError(dataset({}, [2027]), /edition_year "2027" is not a year from 2000 to 2026/),
    ).toBe(true);
    expect(hasError(dataset({}, [1999]), /edition_year "1999"/)).toBe(true);
  });
  it('round one plus round two that does not equal the printed total', () => {
    const d = dataset({
      rnd: (r) => {
        r[0][4] = 40;
        r[0][5] = 50;
      },
    });
    expect(hasError(d, /r1 \+ r2 = 90 but the printed total is 100/)).toBe(true);
  });
  it('round one without round two', () => {
    const d = dataset({
      rnd: (r) => {
        r[0][4] = 40;
        r[0][5] = '';
      },
    });
    expect(hasError(d, /r1 and r2 must both be filled or both empty/)).toBe(true);
  });
  it('a missing permission_ref (and the option that supplies it)', () => {
    const noRef = dataset({}, [2024], { ...OPTS, permissionRef: undefined });
    expect(noRef.errors.filter((e) => /permission_ref is missing/.test(e))).toHaveLength(10);
    const blank = dataset({}, [2024], { ...OPTS, permissionRef: '   ' });
    expect(hasError(blank, /permission_ref is missing/)).toBe(true);
    expect(dataset().errors).toEqual([]);
  });
  it('a permission_ref given in the file for one row only fixes that row', () => {
    const d = buildDataset({
      templateText: csv([
        [...TPL_HEAD, 'permission_ref'],
        [
          'Fictional Cup 2024',
          2024,
          '',
          '',
          'Crew Alpha',
          'XA',
          'preliminary',
          '',
          'F',
          'Fictional Federation, 2026-01-01: ok',
        ],
        ['Fictional Cup 2024', 2024, '', '', 'Crew Bravo', 'XA', 'preliminary', '', 'F', ''],
      ]),
      options: { suppliedOn: '2026-01-01', extraCodes: ['XA'], currentYear: 2026 },
    });
    expect(d.errors).toHaveLength(1);
    expect(d.errors[0]).toMatch(/template row 2: permission_ref is missing/);
  });
  it('a date that does not exist', () => {
    expect(hasError(dataset({}, [2024], { ...OPTS, suppliedOn: '2026-02-30' }), /not a date/)).toBe(
      true,
    );
  });
  it('a placement that does not fit the stage or is out of range', () => {
    expect(
      hasError(dataset({ tpl: (t) => (t[0][7] = 2) }), /placement 2 does not fit stage champion/),
    ).toBe(true);
    expect(hasError(dataset({ tpl: (t) => (t[2][7] = 5) }), /placement "5" must be 1 to 4/)).toBe(
      true,
    );
  });
  it('the same team twice in one year', () => {
    const d = dataset({ tpl: (t) => t.push([...t[9]]) });
    expect(hasError(d, /appears twice/)).toBe(true);
  });
  it('a stage that its rounds contradict', () => {
    const d = dataset({ tpl: (t) => (t[6][6] = 'semi_final') });
    expect(
      hasError(d, /Crew Golf, 2024\): stage is semi_final but its rounds imply quarter_final/),
    ).toBe(true);
  });
  it('a placement that its rounds contradict', () => {
    const d = dataset({
      tpl: (t) => {
        t[2][7] = 4;
        t[3][7] = 3;
      },
    });
    expect(hasError(d, /placement 4 but its rounds imply 3/)).toBe(true);
  });
  it('a round for a team that is not in the template', () => {
    const d = dataset({
      rnd: (r) => r.push([2024, 'preliminary', 'Crew Nobody', 'XA', '', '', 1, '', '']),
    });
    expect(hasError(d, /Crew Nobody \(XA, 2024\) has no row in the template/)).toBe(true);
  });
  it('two rows for one team and round', () => {
    const d = dataset({ rnd: (r) => r.push([...r[0]]) });
    expect(hasError(d, /has two preliminary rows/)).toBe(true);
  });
  it('a bracket that is not 8, 4 and 2 plus 2', () => {
    const d = dataset({
      rnd: (r) =>
        r.splice(
          r.findIndex((x) => x[1] === 'quarter_final' && x[2] === 'Crew Hotel'),
          1,
        ),
    });
    expect(hasError(d, /quarter_final has 7 team\(s\); a championship has 8/)).toBe(true);
  });
  it('quarter-finalists who are not the top 8 of the preliminaries', () => {
    const d = dataset({
      rnd: (r) => {
        const row = r.find((x) => x[1] === 'preliminary' && x[2] === 'Crew India');
        row[6] = 200;
      },
    });
    expect(hasError(d, /not the top 8 of the preliminaries \(a team out scored 200/)).toBe(true);
  });
  it('a pairing the other side does not mirror', () => {
    const d = dataset({
      rnd: (r) => {
        const row = r.find((x) => x[1] === 'final_champion' && x[2] === 'Crew Bravo');
        row[8] = 11;
      },
    });
    expect(hasError(d, /do not agree on their final_champion match/)).toBe(true);
  });
  it('a pairing against a team with no row in that round', () => {
    const d = dataset({
      rnd: (r) => {
        const row = r.find((x) => x[1] === 'final_champion' && x[2] === 'Crew Alpha');
        row[7] = 'Crew Nobody';
      },
    });
    expect(hasError(d, /names opponent Crew Nobody, who has no final_champion row/)).toBe(true);
  });
  it('a final that ended level', () => {
    const d = dataset({
      rnd: (r) =>
        r
          .filter((x) => x[1] === 'final_champion')
          .forEach((x) => {
            x[6] = 12;
            x[8] = 12;
          }),
    });
    expect(hasError(d, /ended level/)).toBe(true);
  });
  it('a team in the final that was not in the semi-finals', () => {
    const d = dataset({
      rnd: (r) =>
        r.splice(
          r.findIndex((x) => x[1] === 'semi_final' && x[2] === 'Crew Alpha'),
          1,
        ),
    });
    expect(hasError(d, /semi_final has 3 team\(s\)/)).toBe(true);
    expect(hasError(d, /Crew Alpha reached a final but not the semi_final/)).toBe(true);
  });
  it('an opponent without a score', () => {
    const d = dataset({
      rnd: (r) => {
        const row = r.find((x) => x[1] === 'final_runner_up');
        row[8] = '';
      },
    });
    expect(hasError(d, /opponent and opponent_score must both be filled or both empty/)).toBe(true);
  });
  it('a file with a missing column or no rows', () => {
    expect(buildDataset({ templateText: 'team_name\nA', options: OPTS }).errors[0]).toMatch(
      /template: missing column/,
    );
    expect(buildDataset({ templateText: '', options: OPTS }).errors).toContain(
      'template: no data rows',
    );
  });
  it('a control character in a name', () => {
    const d = dataset({ tpl: (t) => (t[0][4] = 'Crew\u0007 Alpha') });
    expect(hasError(d, /team_name contains a control character/)).toBe(true);
  });
  it('rows of one championship that disagree about the host', () => {
    const d = dataset({ tpl: (t) => (t[3][2] = 'Elsewhere') });
    expect(hasError(d, /host_city "Elsewhere" differs from row 1/)).toBe(true);
  });
});

describe('warnings (for the owner to decide, never blocking)', () => {
  it("a name that looks like a person's", () => {
    const d = dataset({
      tpl: (t) => (t[9][4] = 'Maria Santos'),
      rnd: (r) =>
        r.forEach((x) => {
          if (x[2] === 'Crew Juliet') x[2] = 'Maria Santos';
        }),
    });
    expect(d.errors).toEqual([]);
    expect(d.warnings.some((w) => /"Maria Santos" looks like a person's name/.test(w))).toBe(true);
    expect(looksLikePersonName('Crew Alpha')).toBe(false);
    expect(looksLikePersonName('The Alley')).toBe(false);
    expect(looksLikePersonName('3M1S')).toBe(false);
    expect(looksLikePersonName('Maria')).toBe(false);
  });
  it('two spellings of what looks like one team', () => {
    const d = dataset({}, [2024, 2025]);
    expect(d.warnings).toEqual([]);
    const e = buildDataset({
      templateText: csv([
        TPL_HEAD,
        ['Fictional Cup 2024', 2024, '', '', 'Crew Alpha', 'XA', 'preliminary', '', 'F'],
        ['Fictional Cup 2025', 2025, '', '', 'The Crew Alpha', 'XA', 'preliminary', '', 'F'],
      ]),
      options: OPTS,
    });
    expect(e.errors).toEqual([]);
    expect(e.warnings.some((w) => /look like one team/.test(w))).toBe(true);
  });
  it('a tie at the quarter-final cut', () => {
    const d = dataset({
      rnd: (r) => {
        const row = r.find((x) => x[1] === 'preliminary' && x[2] === 'Crew India');
        row[6] = 93;
      },
    });
    expect(d.errors).toEqual([]);
    expect(d.warnings.some((w) => /a tie at the quarter-final cut/.test(w))).toBe(true);
  });
});

describe('the load SQL', () => {
  it('refuses to be written for a dataset with errors', () => {
    expect(() => toSql(dataset({ tpl: (t) => (t[0][6] = 'bronze') }))).toThrow(/has errors/);
  });
  const sql = toSql(dataset({}, [2024, 2025]));
  it('is one transaction with one statement that upserts the results, upserts the rounds and prunes removed rounds', () => {
    expect(sql).toMatch(/^-- Generated by/);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql).toMatch(/\ncommit;\n$/);
    expect(
      sql.match(/on conflict \(competition, edition_year, country_code, team_name\) do update/g),
    ).toHaveLength(1);
    expect(sql.match(/on conflict \(result_id, round\) do update/g)).toHaveLength(1);
    expect(sql).toMatch(/delete from app\.historical_round_scores s/);
  });
  it('never touches listed on update, so an unlisted row stays unlisted after a re-load', () => {
    const update = sql.slice(sql.indexOf('do update'), sql.indexOf('returning id'));
    expect(update).not.toMatch(/listed/);
  });
  it('carries the permission reference on every row and is the same on every run', () => {
    expect(sql.match(/Fictional Federation, 2026-01-01: test/g)).toHaveLength(20);
    expect(toSql(dataset({}, [2024, 2025]))).toBe(sql);
  });
  it('escapes quotes in names', () => {
    const d = dataset({
      tpl: (t) => (t[9][4] = "Crew O'Neil's"),
      rnd: (r) =>
        r.forEach((x) => {
          if (x[2] === 'Crew Juliet') x[2] = "Crew O'Neil's";
        }),
    });
    expect(toSql(d)).toContain("'Crew O''Neil''s'");
  });
  it('can load results with no round scores', () => {
    const d = buildDataset({
      templateText: csv([
        TPL_HEAD,
        ['Fictional Cup 2024', 2024, '', '', 'Crew Alpha', 'XA', 'preliminary', '', 'F'],
      ]),
      options: OPTS,
    });
    expect(d.errors).toEqual([]);
    expect(toSql(d)).toMatch(/where false/);
  });
});

describe('the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'country-history-'));
  const good = year(2024);
  const tplPath = join(dir, 'tpl.csv');
  const rndPath = join(dir, 'rnd.csv');
  writeFileSync(tplPath, csv([TPL_HEAD, ...good.tpl]));
  writeFileSync(rndPath, csv([RND_HEAD, ...good.rnd]));
  const lines = [];
  const log = (s) => lines.push(s);

  it('parses its options and refuses unknown ones', () => {
    expect(parseArgs(['--template', 'a.csv', '--supplied-on', '2026-01-01'])).toEqual({
      template: 'a.csv',
      'supplied-on': '2026-01-01',
    });
    expect(() => parseArgs(['--nope', 'x'])).toThrow(/unknown option/);
    expect(() => parseArgs(['--template'])).toThrow(/needs a value/);
  });
  it('needs --template', () => {
    expect(run([], log)).toBe(2);
  });
  it('reports and writes nothing without --write-sql', () => {
    const out = join(dir, 'never.sql');
    // the fixture codes are not real ISO codes, so the command line (which allows none) reports them
    expect(
      run(
        [
          '--template',
          tplPath,
          '--rounds',
          rndPath,
          '--permission-ref',
          'ref',
          '--supplied-on',
          '2026-01-01',
        ],
        log,
      ),
    ).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(lines.some((l) => /ERROR/.test(l))).toBe(true);
  });
  it('writes the SQL only when the data is clean, and only with --write-sql', () => {
    // real ISO codes for this run, so the file is clean
    const real = year(2024, {
      tpl: (t) =>
        t.forEach((r) => {
          r[3] = 'Thailand';
          r[5] = { XA: 'Thailand', XB: 'Malaysia', XC: 'Singapore' }[r[5]];
        }),
      rnd: (r) =>
        r.forEach((x) => {
          x[3] = { XA: 'TH', XB: 'MY', XC: 'SG' }[x[3]];
        }),
    });
    writeFileSync(tplPath, csv([TPL_HEAD, ...real.tpl]));
    writeFileSync(rndPath, csv([RND_HEAD, ...real.rnd]));
    const out = join(dir, 'out', 'load.sql');
    const args = [
      '--template',
      tplPath,
      '--rounds',
      rndPath,
      '--permission-ref',
      'ref',
      '--supplied-on',
      '2026-01-01',
    ];
    expect(run(args, log)).toBe(0);
    expect(existsSync(out)).toBe(false);
    expect(run([...args, '--write-sql', out], log)).toBe(0);
    expect(readFileSync(out, 'utf8')).toMatch(/begin;/);
    rmSync(dir, { recursive: true, force: true });
  });
});
