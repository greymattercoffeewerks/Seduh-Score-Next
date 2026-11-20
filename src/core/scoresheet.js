// Scoresheet arithmetic: a match decided by judges' filled-in sheets instead of taps. Format-agnostic on purpose (no
// format's vocabulary in here): a knockout format uses it first, and a later judged format can reuse it without editing it.
//
// A SHEET is data: a list of lines { key, label, max }. One judge's sheet for one competitor holds every cup, as
//   { "1": { <line key>: points, ... }, "2": { ... } }          (cup number -> line key -> whole points 0..max)
// A COMPETITOR here is { key, sheets: { <judge seat>: <sheet> } }; `key` is whatever the caller uses to tell the two
// apart (a slot position, an id) and is handed back untouched. A judge SEAT is a plain number 1..judgeCount; nothing
// here knows who sits in it.
//
// Nothing is stored. Cup totals, judge totals, grand totals and the winner are ALWAYS computed from the raw points, and
// the database holds the same winner rule (one SQL function, one JS function; the two are driven by the same fixture
// file, supabase/tests/fixtures/scoresheet-parity.json, in the unit tests and in the pgTAP suite).

// Built-in presets (no editor in this version). Whole numbers only. A preset's lines are COPIED into an event's settings
// when it is set up, so changing a preset here never alters a past event.
export const PRESETS = Object.freeze({
  latte_art_v1: Object.freeze({
    key: 'latte_art_v1',
    lines: Object.freeze([
      Object.freeze({ key: 'contrast', label: 'Contrast/Definition', max: 6 }),
      Object.freeze({ key: 'surface', label: 'Visual surface', max: 3 }),
      Object.freeze({ key: 'harmony', label: 'Harmony', max: 3 }),
      Object.freeze({ key: 'size_position', label: 'Size & position of pattern', max: 3 }),
      Object.freeze({ key: 'achieved', label: 'Successfully achieved', max: 6 }),
      Object.freeze({ key: 'appeal', label: 'Overall appeal', max: 6 }),
    ]),
  }),
});

export function presetKeys() {
  return Object.keys(PRESETS);
}

// A fresh copy of a preset's lines (the caller stores it), or null for an unknown preset.
export function presetLines(presetKey) {
  const preset = Object.hasOwn(PRESETS, presetKey) ? PRESETS[presetKey] : null;
  return preset ? preset.lines.map((line) => ({ ...line })) : null;
}

// The most one cup can score on these lines.
export function cupMax(lines) {
  return lines.reduce((sum, line) => sum + line.max, 0);
}

const isWhole = (value) => typeof value === 'number' && Number.isInteger(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Checks one judge's sheet for one competitor against the event's lines and cup count. Only a COMPLETE sheet is valid:
// every cup 1..cups, every line of every cup, a whole number 0..max. Returns every problem found as
// { code, cup?, line? }; an empty list means valid.
//   sheet_invalid  not an object        cups  a cup is missing, extra or not numbered 1..cups
//   cup_invalid    a cup is not an object                       line_unknown  a line key the sheet does not have
//   line_missing   a line was left blank                        points_invalid  not a whole number, or outside 0..max
export function validateSheet(sheet, { lines, cups }) {
  if (!isObject(sheet)) return { ok: false, problems: [{ code: 'sheet_invalid' }] };
  const problems = [];
  const expected = Array.from({ length: cups }, (_, i) => String(i + 1));
  const given = Object.keys(sheet);
  if (given.length !== expected.length || expected.some((cup) => !Object.hasOwn(sheet, cup))) {
    problems.push({ code: 'cups' });
  }
  const byKey = new Map(lines.map((line) => [line.key, line]));
  for (const cup of expected) {
    if (!Object.hasOwn(sheet, cup)) continue;
    const cupScores = sheet[cup];
    if (!isObject(cupScores)) {
      problems.push({ code: 'cup_invalid', cup: Number(cup) });
      continue;
    }
    for (const key of Object.keys(cupScores)) {
      if (!byKey.has(key)) problems.push({ code: 'line_unknown', cup: Number(cup), line: key });
    }
    for (const line of lines) {
      if (!Object.hasOwn(cupScores, line.key) || cupScores[line.key] === null) {
        problems.push({ code: 'line_missing', cup: Number(cup), line: line.key });
      } else if (
        !isWhole(cupScores[line.key]) ||
        cupScores[line.key] < 0 ||
        cupScores[line.key] > line.max
      ) {
        problems.push({ code: 'points_invalid', cup: Number(cup), line: line.key });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// One cup's points: { <line key>: points } -> the sum. This is what a scorekeeper checks against the judge's own total.
export function cupTotal(cup) {
  return Object.values(cup ?? {}).reduce((sum, points) => sum + (isWhole(points) ? points : 0), 0);
}

// One judge's total for one competitor: every cup added together.
export function judgeTotal(sheet) {
  return Object.values(sheet ?? {}).reduce((sum, cup) => sum + cupTotal(cup), 0);
}

// Every competitor's grand total (all judges, all cups) and each judge's own total.
// [{ key, sheets }] -> [{ key, total, bySeat: { <seat>: judge total } }]   (input order kept)
export function grandTotals(competitors) {
  return competitors.map(({ key, sheets }) => {
    const bySeat = {};
    for (const [seat, sheet] of Object.entries(sheets ?? {})) bySeat[seat] = judgeTotal(sheet);
    return { key, total: Object.values(bySeat).reduce((sum, n) => sum + n, 0), bySeat };
  });
}

// The winner rule (owner decision D7), in this ONE place (the database has its twin):
//   (a) the highest grand total wins                                              rule 'total'
//   (b) if level: the competitor MORE judges scored higher (a judge's own total) rule 'judges'
//   (c) if still level: nobody; the organiser picks and the pick is recorded      rule 'organiser_needed'
// Exactly two competitors. A judge counts toward (b) only when BOTH competitors have that seat's sheet; (a) is a plain
// sum, so call this once every sheet is in (sheetsProgress says when). `winner` is the winning `key`, or null.
export function decideScored(competitors) {
  if (competitors.length !== 2) throw new RangeError('decideScored needs exactly two competitors');
  const [a, b] = grandTotals(competitors);
  const preferring = [0, 0];
  for (const seat of Object.keys(a.bySeat)) {
    if (!Object.hasOwn(b.bySeat, seat)) continue;
    if (a.bySeat[seat] > b.bySeat[seat]) preferring[0] += 1;
    else if (b.bySeat[seat] > a.bySeat[seat]) preferring[1] += 1;
  }
  const result = (winner, rule) => ({
    winner,
    rule,
    totals: [a.total, b.total],
    preferring,
  });
  if (a.total !== b.total) return result(a.total > b.total ? a.key : b.key, 'total');
  if (preferring[0] !== preferring[1])
    return result(preferring[0] > preferring[1] ? a.key : b.key, 'judges');
  return result(null, 'organiser_needed');
}

// How many of the expected sheets are in. A sheet counts only when it is complete and valid (validateSheet).
// competitors: [{ key, sheets }] for the filled slots only; judgeCount: seats 1..judgeCount; lines and cups as above.
// -> { done, total, complete, missing: [{ key, seat }] }
export function sheetsProgress(competitors, { judgeCount, lines, cups }) {
  const missing = [];
  let done = 0;
  for (const { key, sheets } of competitors) {
    for (let seat = 1; seat <= judgeCount; seat += 1) {
      const sheet = sheets?.[seat];
      if (sheet !== undefined && validateSheet(sheet, { lines, cups }).ok) done += 1;
      else missing.push({ key, seat });
    }
  }
  const total = competitors.length * judgeCount;
  return { done, total, complete: total > 0 && done === total, missing };
}
