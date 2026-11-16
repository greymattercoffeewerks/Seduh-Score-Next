// Unit tests for the person's own record loader. FICTIONAL data only: the real record is never committed.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTeamLink,
  linkRole,
  placementFrom,
  buildRecord,
  summarise,
  toSql,
  isHandle,
  MAX_ENTRIES,
} from './lib.mjs';
import { run, parseArgs, unsafeOutputPath } from './load.mjs';

const HEADER =
  'edition_year,competition_name,kind,role,result,team_link,location,provenance_now,provenance_possible,notes';
const csv = (...rows) => [HEADER, ...rows].join('\n');
const FIXTURE = csv(
  '2026,Fictional Team Open 2026,competed,team member,Quarter-final,Test Bandits (XA) 2026,Testville,x,y,',
  '2026,Fictional Brew Cup,competed,competitor,Preliminaries,,Testville,self-reported,,',
  '2025,Fictional Pour Over,competed,competitor,2nd,,Elsewhere,self-reported,,Held in 2026',
  '2025,Fictional Barista Jam,judged,head judge,,,Testville,self-reported,,',
  '2024,Fictional Team Open 2024,competed,captain,4th place,Test Bandits (XA) 2024,Testville,x,y,',
  '2024,Fictional Sprint,competed,competitor,Champion,,Testville,self-reported,,',
);
const ctx = { currentYear: 2027 };

describe('parsing helpers', () => {
  it('reads a team link as team, country and year', () => {
    expect(parseTeamLink('Test Bandits (XA) 2024')).toEqual({
      team_name: 'Test Bandits',
      country_code: 'XA',
      edition_year: 2024,
    });
    expect(parseTeamLink('  Odd  Name (xb)2023 ')).toEqual({
      team_name: 'Odd  Name',
      country_code: 'XB',
      edition_year: 2023,
    });
  });
  it('refuses anything that is not that shape', () => {
    for (const bad of [
      'Test Bandits 2024',
      'Test Bandits (XAA) 2024',
      '(XA) 2024',
      'Test Bandits (XA)',
      '',
      null,
    ]) {
      expect(parseTeamLink(bad)).toBeNull();
    }
  });
  it('takes the role from the words, member when silent', () => {
    expect(linkRole('team member')).toBe('member');
    expect(linkRole('Team Captain')).toBe('captain');
    expect(linkRole('assistant coach')).toBe('coach');
    expect(linkRole('reserve barista')).toBe('reserve');
    expect(linkRole('')).toBe('member');
  });
  it('reads a placing only where the text states a number', () => {
    expect(placementFrom('2nd')).toBe(2);
    expect(placementFrom('4th place')).toBe(4);
    expect(placementFrom('Champion')).toBe(1);
    expect(placementFrom('place 7')).toBe(7);
    for (const none of ['Quarter-final', 'Semi-final', 'Preliminaries', '', null, 'top 8']) {
      expect(placementFrom(none)).toBeNull();
    }
  });
  it('knows a handle', () => {
    expect(isHandle('abc')).toBe(true);
    expect(isHandle('a-b-c')).toBe(true);
    for (const bad of ['ab', 'Abc', 'a--b', '-abc', 'abc-', 'a'.repeat(31), "o'brien", '', null])
      expect(isHandle(bad)).toBe(false);
  });
});

describe('buildRecord', () => {
  const r = buildRecord({ csvText: FIXTURE, competition: 'btc', ...ctx });
  it('has no errors for the fixture', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('turns the rows with a team link into links and NEVER into entries', () => {
    expect(
      r.links.map((l) => `${l.team_name}|${l.country_code}|${l.edition_year}|${l.role}`),
    ).toEqual(['Test Bandits|XA|2026|member', 'Test Bandits|XA|2024|captain']);
    expect(r.entries.map((e) => e.competition_name)).toEqual([
      'Fictional Brew Cup',
      'Fictional Pour Over',
      'Fictional Barista Jam',
      'Fictional Sprint',
    ]);
    expect(r.entries.some((e) => /Team Open/.test(e.competition_name))).toBe(false);
  });
  it('maps the columns and reads placings from the result text', () => {
    const jam = r.entries.find((e) => e.competition_name === 'Fictional Barista Jam');
    expect(jam).toMatchObject({
      year: 2025,
      kind: 'judged',
      role: 'head judge',
      result_text: null,
      placement: null,
      location: 'Testville',
    });
    expect(r.entries.find((e) => e.competition_name === 'Fictional Pour Over')).toMatchObject({
      result_text: '2nd',
      placement: 2,
      note: 'Held in 2026',
    });
    expect(r.entries.find((e) => e.competition_name === 'Fictional Sprint').placement).toBe(1);
    expect(r.entries.find((e) => e.competition_name === 'Fictional Brew Cup').placement).toBeNull();
  });
  it('summarises derived counts', () => {
    expect(summarise(r)).toEqual({
      entries: 4,
      byKind: { competed: 3, judged: 1, organised: 0, coached: 0, volunteered: 0 },
      links: 2,
      placements: 2,
    });
  });
  it('warns when the team link year and the row year disagree, and uses the link year', () => {
    const w = buildRecord({
      csvText: csv('2025,Fictional Team,competed,member,,Test Bandits (XA) 2024,,,,'),
      ...ctx,
    });
    expect(w.errors).toEqual([]);
    expect(w.warnings).toHaveLength(1);
    expect(w.links[0].edition_year).toBe(2024);
  });
  it('refuses what the database would refuse', () => {
    const bad = (row) => buildRecord({ csvText: csv(row), ...ctx }).errors.join('|');
    expect(bad('1979,X,competed,,,,,,,')).toMatch(/not a year/);
    expect(bad('2099,X,competed,,,,,,,')).toMatch(/not a year/);
    expect(bad('abcd,X,competed,,,,,,,')).toMatch(/not a year/);
    expect(bad('2024,X,won,,,,,,,')).toMatch(/kind "won"/);
    expect(bad('2024,,competed,,,,,,,')).toMatch(/competition name is required/);
    expect(bad(`2024,${'x'.repeat(121)},competed,,,,,,,`)).toMatch(/121 characters/);
    expect(bad(`2024,X,competed,${'r'.repeat(61)},,,,,,`)).toMatch(/role is 61/);
    expect(bad(`2024,X,competed,,,,${'l'.repeat(81)},,,`)).toMatch(/location is 81/);
    expect(bad(`2024,X,competed,,,,,,,${'n'.repeat(501)}`)).toMatch(/notes is 501/);
    expect(bad('2024,"a‮b",competed,,,,,,,')).toMatch(/control or invisible/);
    expect(bad('2024,"a​b",competed,,,,,,,')).toMatch(/control or invisible/);
    expect(bad('2024,"a$load$b",competed,,,,,,,')).toMatch(/\$load\$/);
    expect(bad('2024,X,competed,,,Not a link,,,,')).toMatch(/team link/);
  });
  it('reads a placing only for a competitor, and refuses the extra invisible characters', () => {
    const r2 = buildRecord({
      csvText: csv('2024,Jam,judged,judge,Champion,,,,,', '2024,Cup,competed,,Champion,,,,,'),
      ...ctx,
    });
    expect(r2.entries.map((e) => e.placement)).toEqual([null, 1]);
    for (const ch of [
      String.fromCodePoint(0xad),
      String.fromCodePoint(0x61c),
      String.fromCodePoint(0x2028),
      String.fromCodePoint(0xe0041),
    ]) {
      expect(
        buildRecord({ csvText: csv(`2024,"a${ch}b",competed,,,,,,,`), ...ctx }).errors.join('|'),
      ).toMatch(/invisible/);
    }
  });
  it('refuses a duplicate entry and a duplicate team-year', () => {
    expect(
      buildRecord({
        csvText: csv('2024,Same,competed,,,,,,,', '2024,SAME,competed,,,,,,,'),
        ...ctx,
      }).errors.join('|'),
    ).toMatch(/same year, competition and kind as row 1/);
    expect(
      buildRecord({
        csvText: csv('2024,A,competed,,,T (XA) 2024,,,,', '2024,B,competed,,,T (XA) 2024,,,,'),
        ...ctx,
      }).errors.join('|'),
    ).toMatch(/same team-year as row 1/);
    // the same competition in a different year or kind is fine
    expect(
      buildRecord({
        csvText: csv(
          '2024,Same,competed,,,,,,,',
          '2025,Same,competed,,,,,,,',
          '2024,Same,judged,,,,,,,',
        ),
        ...ctx,
      }).errors,
    ).toEqual([]);
  });
  it('refuses a file over the caps and one with missing columns', () => {
    const many = csv(
      ...Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => `2024,Event ${i},competed,,,,,,,`),
    );
    expect(buildRecord({ csvText: many, ...ctx }).errors.join('|')).toMatch(/at most 200/);
    expect(buildRecord({ csvText: 'a,b\n1,2', ...ctx }).errors.join('|')).toMatch(
      /no "edition_year" column/,
    );
  });
});

describe('toSql', () => {
  const data = buildRecord({ csvText: FIXTURE, ...ctx });
  const sql = toSql(data, { handle: 'test-person' });
  it('is one transaction that checks the account first', () => {
    expect(sql).toMatch(/^-- Generated by/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).toMatch(/a\.handle = 'test-person' and a\.closed_at is null/);
    expect(sql).toMatch(/raise exception 'no OPEN claimed Seduh ID/);
  });
  it('carries the entries and NOT the team rows as entries', () => {
    expect(sql).toContain(
      "(2025, 'Fictional Pour Over', 'competed', 'Elsewhere', 'competitor', '2nd', 2, 'Held in 2026')",
    );
    expect(sql).not.toMatch(/'Fictional Team Open 20\d\d', 'competed'/);
  });
  it('creates team links as self_reported members (never confirmed) and stops when a team is missing', () => {
    expect(sql).toContain("('btc', 'XA', 'Test Bandits', 2026, 'member')");
    expect(sql).toContain("('btc', 'XA', 'Test Bandits', 2024, 'captain')");
    expect(sql).toMatch(/insert into app\.seduh_team_memberships \(account_id, result_id, role\)/);
    expect(sql).toMatch(/on conflict \(account_id, result_id\) do nothing/);
    expect(sql).toMatch(/raise exception 'no team in app\.historical_results/);
    expect(sql).not.toMatch(/'confirmed'|membership_confirm\(/);
  });
  it('carries the idempotency guards (update only on a difference, insert only when absent; the e2e spec runs it twice)', () => {
    expect(sql).toMatch(/is distinct from/);
    expect(sql).toMatch(/where not exists \(select 1 from app\.seduh_self_reported_entries/);
  });
  it('escapes quotes', () => {
    const tricky = buildRecord({
      csvText: csv("2024,O'Brien's Open,competed,,,,,,,It's a note"),
      ...ctx,
    });
    expect(toSql(tricky, { handle: 'abc' })).toContain("'O''Brien''s Open'");
    expect(toSql(tricky, { handle: 'abc' })).toContain("'It''s a note'");
  });
  it('refuses a record with errors and a bad handle', () => {
    const bad = buildRecord({ csvText: csv('1900,X,competed,,,,,,,'), ...ctx });
    expect(() => toSql(bad, { handle: 'abc' })).toThrow(/errors/);
    expect(() => toSql(data, { handle: "x'; drop table" })).toThrow(/handle/);
    expect(() => toSql(data, {})).toThrow(/handle/);
  });
  it('handles a file with only entries or only links', () => {
    const onlyEntries = buildRecord({ csvText: csv('2024,A,competed,,,,,,,'), ...ctx });
    expect(toSql(onlyEntries, { handle: 'abc' })).toMatch(/-- no team links in this file/);
    const onlyLinks = buildRecord({ csvText: csv('2024,A,competed,,,T (XA) 2024,,,,'), ...ctx });
    expect(toSql(onlyLinks, { handle: 'abc' })).toMatch(/-- no entries in this file/);
  });
});

describe('the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seduh-record-'));
  const file = join(dir, 'record.csv');
  writeFileSync(file, FIXTURE);
  const lines = [];
  const log = (m) => lines.push(m);

  it('parses options and refuses unknown ones', () => {
    expect(parseArgs(['--csv', 'a.csv', '--handle', 'abc'])).toEqual({
      csv: 'a.csv',
      handle: 'abc',
    });
    expect(() => parseArgs(['--nope', 'x'])).toThrow(/unknown option/);
    expect(() => parseArgs(['--csv'])).toThrow(/needs a value/);
    expect(() => parseArgs(['stray'])).toThrow(/unexpected/);
  });
  it('previews without writing anything', () => {
    lines.length = 0;
    expect(run(['--csv', file, '--handle', 'abc'], log, ctx)).toBe(0);
    expect(lines.join('\n')).toMatch(/4 entries.*2 team link/s);
    expect(lines.join('\n')).toMatch(/Preview only/);
  });
  it('needs a csv and a valid handle', () => {
    expect(run(['--handle', 'abc'], log)).toBe(2);
    expect(run(['--csv', file, '--handle', 'A B'], log)).toBe(2);
  });
  it('writes the SQL only outside the repository or under out/, and only when there are no errors', () => {
    const out = join(dir, 'out.sql');
    lines.length = 0;
    expect(run(['--csv', file, '--handle', 'abc', '--write-sql', out], log, ctx)).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toMatch(/Test Bandits/);
    // a bad record writes nothing
    const badFile = join(dir, 'bad.csv');
    writeFileSync(badFile, csv('1900,X,competed,,,,,,,'));
    const out2 = join(dir, 'out2.sql');
    expect(run(['--csv', badFile, '--handle', 'abc', '--write-sql', out2], log, ctx)).toBe(1);
    expect(existsSync(out2)).toBe(false);
  });
  it('refuses to write into the repository outside the ignored out/ folder', () => {
    const repo = join(dir, 'repo');
    const out = join(repo, 'scripts', 'seduh-id-record', 'out');
    expect(unsafeOutputPath(join(repo, 'README.sql'), { repo, out })).toBe(true);
    expect(unsafeOutputPath(join(repo, 'scripts', 'seduh-id-record', 'x.sql'), { repo, out })).toBe(
      true,
    );
    expect(unsafeOutputPath(join(out, 'x.sql'), { repo, out })).toBe(false);
    expect(unsafeOutputPath(join(dir, 'elsewhere', 'x.sql'), { repo, out })).toBe(false);
    lines.length = 0;
    // the real repository: the repo root itself is unsafe
    expect(
      run(
        ['--csv', file, '--handle', 'abc', '--write-sql', 'record-should-not-exist.sql'],
        log,
        ctx,
      ),
    ).toBe(2);
    expect(existsSync('record-should-not-exist.sql')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
