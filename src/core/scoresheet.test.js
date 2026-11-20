import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRESETS,
  presetKeys,
  presetLines,
  cupMax,
  validateSheet,
  cupTotal,
  judgeTotal,
  grandTotals,
  decideScored,
  sheetsProgress,
} from './scoresheet.js';

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'supabase', 'tests', 'fixtures', 'scoresheet-parity.json'),
    'utf8',
  ),
);
const lines = presetLines(fixture.preset);
const cups = fixture.cups;

// fixture arrays (six numbers in line order) -> the sheet shape
const cupObject = (values) => Object.fromEntries(lines.map((line, i) => [line.key, values[i]]));
const sheetFrom = (cupsArray) =>
  Object.fromEntries(cupsArray.map((values, i) => [String(i + 1), cupObject(values)]));
const seatsFrom = (seatsArray) =>
  Object.fromEntries(seatsArray.map((cupsArray, i) => [i + 1, sheetFrom(cupsArray)]));
const competitorsOf = (c) =>
  Object.entries(c.sheets).map(([key, seats]) => ({ key, sheets: seatsFrom(seats) }));

describe('the latte_art_v1 preset (owner decision D2)', () => {
  it('has the six lines of the paper sheet, in order, worth 27 a cup', () => {
    expect(lines.map((l) => [l.key, l.label, l.max])).toEqual([
      ['contrast', 'Contrast/Definition', 6],
      ['surface', 'Visual surface', 3],
      ['harmony', 'Harmony', 3],
      ['size_position', 'Size & position of pattern', 3],
      ['achieved', 'Successfully achieved', 6],
      ['appeal', 'Overall appeal', 6],
    ]);
    expect(cupMax(lines)).toBe(27);
    expect(presetKeys()).toEqual(['latte_art_v1']);
  });

  it('hands out copies: changing one never changes the preset', () => {
    const copy = presetLines('latte_art_v1');
    copy[0].max = 99;
    expect(presetLines('latte_art_v1')[0].max).toBe(6);
    expect(Object.isFrozen(PRESETS.latte_art_v1)).toBe(true);
    expect(presetLines('nope')).toBeNull();
    expect(presetLines('toString')).toBeNull();
  });

  it('knows nothing about any format (no Throwdown words in the module source)', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'core', 'scoresheet.js'), 'utf8');
    expect(source).not.toMatch(/throwdown|\btd_/i);
  });
});

describe('validateSheet: only a complete, whole-number sheet is valid', () => {
  const full = sheetFrom([
    [6, 3, 3, 3, 6, 6],
    [0, 0, 0, 0, 0, 0],
  ]);
  const check = (sheet, n = 2) => validateSheet(sheet, { lines, cups: n });

  it('accepts every line at its max and at zero', () => {
    expect(check(full)).toEqual({ ok: true, problems: [] });
  });

  it('refuses a sheet that is not an object', () => {
    for (const bad of [null, undefined, [], 'x', 5]) {
      expect(check(bad)).toEqual({ ok: false, problems: [{ code: 'sheet_invalid' }] });
    }
  });

  it('refuses a wrong cup count, a missing cup and an extra cup', () => {
    expect(check({ 1: full['1'] }).problems.map((p) => p.code)).toContain('cups');
    expect(check({ ...full, 3: full['1'] }).problems.map((p) => p.code)).toContain('cups');
    expect(check({ 1: full['1'], 3: full['2'] }).problems.map((p) => p.code)).toContain('cups');
  });

  it('refuses a blank line, naming the cup and the line', () => {
    const sheet = structuredClone(full);
    delete sheet['2'].harmony;
    expect(check(sheet).problems).toEqual([{ code: 'line_missing', cup: 2, line: 'harmony' }]);
    sheet['2'].harmony = null;
    expect(check(sheet).problems).toEqual([{ code: 'line_missing', cup: 2, line: 'harmony' }]);
  });

  it('refuses a line the sheet does not have', () => {
    const sheet = structuredClone(full);
    sheet['1'].flavour = 3;
    expect(check(sheet).problems).toEqual([{ code: 'line_unknown', cup: 1, line: 'flavour' }]);
  });

  it('refuses fractions, text, negatives and anything above the line max', () => {
    for (const [line, value] of [
      ['contrast', 2.5],
      ['contrast', '5'],
      ['contrast', -1],
      ['contrast', 7],
      ['surface', 4],
      ['harmony', Number.NaN],
      ['appeal', Infinity],
      ['achieved', true],
    ]) {
      const sheet = structuredClone(full);
      sheet['1'][line] = value;
      expect(check(sheet).problems, `${line}=${String(value)}`).toEqual([
        { code: 'points_invalid', cup: 1, line },
      ]);
    }
  });

  it('refuses a cup that is not an object', () => {
    expect(check({ 1: full['1'], 2: 'x' }).problems).toEqual([{ code: 'cup_invalid', cup: 2 }]);
  });
});

describe('totals are computed, never stored', () => {
  it('adds a cup, a judge and a competitor', () => {
    const sheet = sheetFrom([
      [6, 3, 3, 3, 6, 6],
      [3, 2, 2, 2, 3, 3],
    ]);
    expect(cupTotal(sheet['1'])).toBe(27);
    expect(cupTotal(sheet['2'])).toBe(15);
    expect(judgeTotal(sheet)).toBe(42);
    expect(cupTotal(undefined)).toBe(0);
    expect(judgeTotal(undefined)).toBe(0);
    expect(grandTotals([{ key: 'a', sheets: { 1: sheet, 2: sheet, 3: sheet } }])).toEqual([
      { key: 'a', total: 126, bySeat: { 1: 42, 2: 42, 3: 42 } },
    ]);
  });
});

describe('decideScored (owner decision D7) over the shared fixture', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const result = decideScored(competitorsOf(c));
      expect(result.winner).toBe(c.expect.winner);
      expect(result.rule).toBe(c.expect.rule);
      expect(result.totals).toEqual(c.expect.totals);
      expect(result.preferring).toEqual(c.expect.preferring);
    });
  }

  it('does not depend on the order the competitors are given in', () => {
    for (const c of fixture.cases) {
      const flipped = decideScored(competitorsOf(c).reverse());
      expect(flipped.winner).toBe(c.expect.winner);
      expect(flipped.rule).toBe(c.expect.rule);
    }
  });

  it('counts a judge toward (b) only when both competitors have that seat', () => {
    const c = fixture.cases[3]; // level total, 2 of 3 judges for slot 1
    const [one, two] = competitorsOf(c);
    delete one.sheets[1];
    delete two.sheets[1];
    expect(decideScored([one, two]).preferring).toEqual([1, 1]);
  });

  it('needs exactly two competitors', () => {
    expect(() => decideScored([])).toThrow(RangeError);
    expect(() => decideScored([{ key: 1, sheets: {} }])).toThrow(RangeError);
    expect(() => decideScored([1, 2, 3].map((key) => ({ key, sheets: {} })))).toThrow(RangeError);
  });
});

describe('sheetsProgress', () => {
  const opts = { judgeCount: 3, lines, cups };
  const c = fixture.cases[0];

  it('is complete when every seat has a valid sheet for every competitor', () => {
    const result = sheetsProgress(competitorsOf(c), opts);
    expect(result).toEqual({ done: 6, total: 6, complete: true, missing: [] });
  });

  it('lists what is missing, and does not count a sheet that is invalid', () => {
    const [one, two] = competitorsOf(c);
    delete one.sheets[2];
    two.sheets[3]['1'].contrast = 9;
    const result = sheetsProgress([one, two], opts);
    expect(result.done).toBe(4);
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([
      { key: '1', seat: 2 },
      { key: '2', seat: 3 },
    ]);
  });

  it('is never complete with nobody to score', () => {
    expect(sheetsProgress([], opts)).toEqual({ done: 0, total: 0, complete: false, missing: [] });
  });
});

describe('the shared fixture reaches the database', () => {
  it('is embedded unchanged in the pgTAP file that runs the same cases against SQL', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'tests', '091_td_scoresheet.sql'),
      'utf8',
    );
    const match =
      /-- parity-fixture:begin\n.*?\$fx\$(.*?)\$fx\$::jsonb as j;\n-- parity-fixture:end/s.exec(
        sql,
      );
    expect(match, 'the fixture markers are in 091_td_scoresheet.sql').not.toBeNull();
    expect(JSON.parse(match[1])).toEqual(fixture);
  });
});
