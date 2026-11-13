// Seduh ID country pages, T-CTY.2: read an organiser's historical-results files, validate them, and write the load SQL.
//
// Pure functions only (no file or database access), so the unit tests can run them on fictional data. The command-line
// wrapper is import.mjs. The rules mirror the database's constraints (supabase/migrations/20261113120000_country_history.sql)
// and add the checks a constraint cannot make: the bracket shape, who played whom, and the stage each team's rounds imply.
//
// Two inputs, as the owner's templates have them:
//   template  one row per team per year (competition_name, edition_year, host_city, host_country, team_name, country,
//             stage_reached, placement, supplied_by, and optionally permission_ref, supplied_on, source_ref, competition)
//   rounds    one row per team per round (edition_year, round, team_name, country, r1, r2, score, opponent,
//             opponent_score), the source of truth for scores. Optional.
// The template's score_note column is deliberately NOT loaded: it is prose derived from the rounds, and a correction to a
// round would leave it stale. The column stays in the table for an organiser whose file has only a note.

import { countryCode } from './iso.mjs';

export const STAGES = [
  'champion',
  'final',
  'semi_final',
  'quarter_final',
  'preliminary',
  'entered',
];
export const ROUNDS = [
  'preliminary',
  'quarter_final',
  'semi_final',
  'final_champion',
  'final_runner_up',
];
export const COMPETITIONS = ['btc'];

// ---------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------

// RFC 4180: quoted fields, doubled quotes, CRLF or LF, a leading byte-order mark. Returns an array of string arrays.
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Header + rows as objects; `__row` is the 1-based data row number (header excluded), used in source_ref and messages.
export function readTable(text) {
  const grid = parseCsv(text);
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim().toLowerCase());
  const rows = grid.slice(1).map((cells, n) => {
    const o = { __row: n + 1 };
    headers.forEach((h, c) => {
      o[h] = (cells[c] ?? '').trim();
    });
    return o;
  });
  return { headers, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

// 'Quarter-final', 'quarter final', 'QUARTER_FINAL' -> 'quarter_final'; anything else comes back as it is for the report.
export function stageSlug(label) {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const INT = /^\d+$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const hasControlChars = (s) => /[\u0000-\u001f\u007f]/.test(s);
const normName = (s) =>
  s
    .toLowerCase()
    .replace(/^(the|team)\s+/, '')
    .replace(/[^a-z0-9]/g, '');

// Words that make a name read as a team, not a person. A name of two or three plain capitalised words with none of these
// is flagged for the owner to look at (spec 6.2); it never blocks a load.
const TEAM_WORDS = new Set(
  `team crew brew coffee coffees roasters roastery roasting baristas barista bean beans bandits bird birds collective squad
   cafe cafes club society association guild lab labs works workers studio league united alliance company co group house
   craft craftist craftists extractors extraction espresso brewers brewing cup cups kopi artisan artist artists army
   gang pack hub station corner room alley shot shots grind grinders press drip pour roast tamp tampd fusion origin
   specialty specialist specialists academy college school university institute grounds mates bloc crusaders moon honey
   black flow origins caffeine`.split(/\s+/),
);

export function looksLikePersonName(name) {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 3) return false;
  if (tokens[0].toLowerCase() === 'the') return false;
  if (!tokens.every((t) => /^[A-Z][a-z]{1,}$/.test(t))) return false;
  return !tokens.some((t) => TEAM_WORDS.has(t.toLowerCase()));
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) {
  if (!ymd.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const key = (year, country, team) => `${year}|${country}|${team}`;

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {{templateText: string, roundsText?: string, templateName?: string,
 *          options?: {competition?: string, permissionRef?: string, suppliedOn?: string, currentYear?: number, extraCodes?: string[]}}} input
 * @returns {{results: object[], rounds: object[], errors: string[], warnings: string[]}}
 *   Nothing is changed anywhere; `errors` must be empty before SQL may be written.
 */
export function buildDataset({
  templateText,
  roundsText,
  templateName = 'template.csv',
  options = {},
}) {
  const errors = [];
  const warnings = [];
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const extraCodes = options.extraCodes ?? [];
  const defaultCompetition = options.competition ?? 'btc';
  const results = [];
  const rounds = [];

  if (options.suppliedOn !== undefined && !validDate(options.suppliedOn)) {
    errors.push(`--supplied-on "${options.suppliedOn}" is not a date (YYYY-MM-DD)`);
  }

  // ---- template ----
  const tpl = readTable(templateText);
  const needT = [
    'competition_name',
    'edition_year',
    'team_name',
    'country',
    'stage_reached',
    'supplied_by',
  ];
  const missingT = needT.filter((h) => !tpl.headers.includes(h));
  if (tpl.rows.length === 0) errors.push('template: no data rows');
  if (missingT.length > 0) {
    errors.push(`template: missing column(s) ${missingT.join(', ')}`);
    return { results, rounds, errors, warnings };
  }

  const seen = new Map();
  for (const r of tpl.rows) {
    const at = `template row ${r.__row}`;
    const bad = (msg) => errors.push(`${at}: ${msg}`);
    const competition = (r.competition || defaultCompetition).toLowerCase();
    if (!COMPETITIONS.includes(competition))
      bad(`competition "${competition}" is not one of ${COMPETITIONS.join(', ')}`);

    const year = INT.test(r.edition_year) ? Number(r.edition_year) : NaN;
    if (Number.isNaN(year) || year < 2000 || year > currentYear)
      bad(`edition_year "${r.edition_year}" is not a year from 2000 to ${currentYear}`);

    const code = countryCode(r.country, extraCodes);
    if (!code) bad(`country "${r.country}" is not an ISO 3166-1 country name or code`);

    let hostCode = null;
    if (r.host_country) {
      hostCode = countryCode(r.host_country, extraCodes);
      if (!hostCode)
        bad(`host_country "${r.host_country}" is not an ISO 3166-1 country name or code`);
    }

    const stage = stageSlug(r.stage_reached);
    if (!STAGES.includes(stage))
      bad(`stage_reached "${r.stage_reached}" is not one of ${STAGES.join(', ')}`);

    let placement = null;
    if (r.placement !== undefined && r.placement !== '') {
      if (!INT.test(r.placement) || Number(r.placement) < 1 || Number(r.placement) > 4) {
        bad(
          `placement "${r.placement}" must be 1 to 4 (or empty where the organiser published none)`,
        );
      } else {
        placement = Number(r.placement);
        const ok =
          (placement === 1 && stage === 'champion') ||
          (placement === 2 && stage === 'final') ||
          ((placement === 3 || placement === 4) && stage === 'semi_final');
        if (!ok)
          bad(
            `placement ${placement} does not fit stage ${stage} (1 champion, 2 final, 3 or 4 semi_final)`,
          );
      }
    }

    if (!r.team_name) bad('team_name is empty');
    if (!r.competition_name) bad('competition_name is empty');
    if (!r.supplied_by) bad('supplied_by is empty');
    for (const f of ['team_name', 'competition_name', 'host_city', 'supplied_by']) {
      if (r[f] && hasControlChars(r[f])) bad(`${f} contains a control character`);
    }
    if (r.team_name.length > 120) bad('team_name is longer than 120 characters');

    const permissionRef = (r.permission_ref || options.permissionRef || '').trim();
    if (!permissionRef)
      bad(
        'permission_ref is missing (no row may be loaded without a record of who allowed it to be published)',
      );
    else if (permissionRef.length > 300) bad('permission_ref is longer than 300 characters');

    const suppliedOn = r.supplied_on || options.suppliedOn || '';
    if (!suppliedOn) bad('supplied_on is missing (a column, or --supplied-on)');
    else if (!validDate(suppliedOn)) bad(`supplied_on "${suppliedOn}" is not a date (YYYY-MM-DD)`);

    if (r.team_name && !Number.isNaN(year) && code) {
      const k = key(year, code, r.team_name);
      if (seen.has(k))
        bad(`${r.team_name} (${code}, ${year}) appears twice (first at row ${seen.get(k)})`);
      else seen.set(k, r.__row);
    }

    if (r.team_name && looksLikePersonName(r.team_name)) {
      warnings.push(
        `${at}: "${r.team_name}" looks like a person's name; confirm it is a team name before it is published`,
      );
    }

    results.push({
      competition,
      competition_name: r.competition_name,
      edition_year: year,
      host_city: r.host_city || null,
      host_country_code: hostCode,
      team_name: r.team_name,
      country_code: code,
      stage_reached: stage,
      placement,
      score_note: null,
      source_ref: r.source_ref || `${templateName}#${r.__row}`,
      supplied_by: r.supplied_by,
      supplied_on: suppliedOn,
      permission_ref: permissionRef,
      __row: r.__row,
    });
  }

  // One championship, one set of details: rows of one edition must agree on the name, host and supplier.
  const editions = new Map();
  for (const r of results) {
    const k = `${r.competition}|${r.edition_year}`;
    if (!editions.has(k)) editions.set(k, r);
    else {
      const first = editions.get(k);
      for (const f of ['competition_name', 'host_city', 'host_country_code', 'supplied_by']) {
        if (r[f] !== first[f]) {
          errors.push(
            `template row ${r.__row}: ${f} "${r[f] ?? ''}" differs from row ${first.__row} of the same championship ("${first[f] ?? ''}")`,
          );
        }
      }
    }
  }

  // Two spellings of what looks like one team in one country, across years (the owner says whether they are one team).
  const spellings = new Map();
  for (const r of results) {
    if (!r.country_code) continue;
    const k = `${r.country_code}|${normName(r.team_name)}`;
    if (!spellings.has(k)) spellings.set(k, new Set());
    spellings.get(k).add(r.team_name);
  }
  for (const [k, names] of spellings) {
    if (names.size > 1)
      warnings.push(
        `${k.slice(0, 2)}: ${[...names].map((n) => `"${n}"`).join(' and ')} look like one team; they stay separate unless the owner says they are the same`,
      );
  }

  // ---- rounds ----
  if (roundsText !== undefined && roundsText.trim() !== '') {
    const rt = readTable(roundsText);
    const needR = ['edition_year', 'round', 'team_name', 'country', 'score'];
    const missingR = needR.filter((h) => !rt.headers.includes(h));
    if (missingR.length > 0) {
      errors.push(`rounds: missing column(s) ${missingR.join(', ')}`);
    } else {
      const resultByKey = new Map(
        results
          .filter((r) => r.country_code && !Number.isNaN(r.edition_year))
          .map((r) => [key(r.edition_year, r.country_code, r.team_name), r]),
      );
      const roundSeen = new Set();
      for (const r of rt.rows) {
        const at = `rounds row ${r.__row}`;
        const bad = (msg) => errors.push(`${at}: ${msg}`);
        const year = INT.test(r.edition_year) ? Number(r.edition_year) : NaN;
        const code = countryCode(r.country, extraCodes);
        const round = r.round.toLowerCase();
        if (Number.isNaN(year)) bad(`edition_year "${r.edition_year}" is not a year`);
        if (!code) bad(`country "${r.country}" is not an ISO 3166-1 country name or code`);
        if (!ROUNDS.includes(round)) bad(`round "${r.round}" is not one of ${ROUNDS.join(', ')}`);

        const num = (field) => {
          const v = r[field];
          if (v === undefined || v === '') return null;
          if (!INT.test(v)) {
            bad(`${field} "${v}" is not a whole number`);
            return undefined;
          }
          return Number(v);
        };
        const r1 = num('r1');
        const r2 = num('r2');
        const score = num('score');
        const opponentScore = num('opponent_score');
        if (score === null) bad('score is empty');
        if ((r1 === null) !== (r2 === null)) bad('r1 and r2 must both be filled or both empty');
        else if (
          r1 !== null &&
          r2 !== null &&
          score !== null &&
          score !== undefined &&
          r1 + r2 !== score
        ) {
          bad(`r1 + r2 = ${r1 + r2} but the printed total is ${score}`);
        }
        const opponent = r.opponent || null;
        if ((opponent === null) !== (opponentScore === null))
          bad('opponent and opponent_score must both be filled or both empty');

        if (Number.isNaN(year) || !code || !ROUNDS.includes(round)) continue;
        const parent = resultByKey.get(key(year, code, r.team_name));
        if (!parent) {
          bad(`${r.team_name} (${code}, ${year}) has no row in the template`);
          continue;
        }
        const rk = `${parent.edition_year}|${parent.country_code}|${parent.team_name}|${round}`;
        if (roundSeen.has(rk)) bad(`${r.team_name} (${code}, ${year}) has two ${round} rows`);
        roundSeen.add(rk);
        rounds.push({
          competition: parent.competition,
          edition_year: parent.edition_year,
          country_code: parent.country_code,
          team_name: parent.team_name,
          round,
          r1: r1 ?? null,
          r2: r2 ?? null,
          score: score ?? null,
          opponent_team_name: opponent,
          opponent_score: opponentScore ?? null,
          __row: r.__row,
        });
      }
      checkBrackets(results, rounds, errors, warnings);
    }
  }

  return { results, rounds, errors, warnings };
}

// The bracket of every year that has round scores: 8 in the quarter-finals, 4 in the semi-finals, a final of 2 and a
// third-place match of 2; the quarter-finalists are the top 8 of the preliminaries; every pairing is the same on both
// sides; and each team's stage and placement are what its rounds imply.
function checkBrackets(results, rounds, errors, warnings) {
  const years = [...new Set(rounds.map((r) => r.edition_year))].sort();
  for (const year of years) {
    const yr = rounds.filter((r) => r.edition_year === year);
    const tag = `${year}`;
    const idOf = (r) => `${r.country_code}|${r.team_name}`;
    const by = (round) => yr.filter((r) => r.round === round);
    const ids = (round) => new Set(by(round).map(idOf));

    const expect = { quarter_final: 8, semi_final: 4, final_champion: 2, final_runner_up: 2 };
    for (const [round, n] of Object.entries(expect)) {
      if (ids(round).size !== n)
        errors.push(`${tag}: ${round} has ${ids(round).size} team(s); a championship has ${n}`);
    }
    const prelim = by('preliminary');
    if (ids('preliminary').size < 8)
      errors.push(
        `${tag}: preliminary has ${ids('preliminary').size} team(s); at least 8 are needed to fill the quarter-finals`,
      );

    const subset = (a, b, what) => {
      for (const id of ids(a))
        if (!ids(b).has(id))
          errors.push(`${tag}: ${id.split('|')[1]} is in the ${what} but not in the ${b}`);
    };
    subset('quarter_final', 'preliminary', 'quarter_final');
    subset('semi_final', 'quarter_final', 'semi_final');
    const finalists = new Set([...ids('final_champion'), ...ids('final_runner_up')]);
    for (const id of finalists)
      if (!ids('semi_final').has(id))
        errors.push(`${tag}: ${id.split('|')[1]} reached a final but not the semi_final`);
    for (const id of ids('final_champion'))
      if (ids('final_runner_up').has(id))
        errors.push(`${tag}: ${id.split('|')[1]} is in both the final and the third-place match`);

    // quarter-finalists = top 8 of the preliminaries
    const qf = ids('quarter_final');
    const inQf = prelim.filter((r) => qf.has(idOf(r)));
    const outQf = prelim.filter((r) => !qf.has(idOf(r)));
    if (inQf.length > 0 && outQf.length > 0) {
      const worstIn = Math.min(...inQf.map((r) => r.score));
      const bestOut = Math.max(...outQf.map((r) => r.score));
      if (worstIn < bestOut)
        errors.push(
          `${tag}: the quarter-finalists are not the top 8 of the preliminaries (a team out scored ${bestOut}, one in scored ${worstIn})`,
        );
      else if (worstIn === bestOut)
        warnings.push(
          `${tag}: a tie at the quarter-final cut (${bestOut}); confirm how the organiser broke it`,
        );
    }

    // pairings are the same on both sides
    for (const r of yr.filter((x) => x.opponent_team_name !== null)) {
      const other = yr.find((x) => x.round === r.round && x.team_name === r.opponent_team_name);
      if (!other)
        errors.push(
          `${tag}: ${r.team_name} (${r.round}) names opponent ${r.opponent_team_name}, who has no ${r.round} row`,
        );
      else if (
        other.opponent_team_name !== r.team_name ||
        other.opponent_score !== r.score ||
        other.score !== r.opponent_score
      ) {
        errors.push(
          `${tag}: ${r.team_name} and ${other.team_name} do not agree on their ${r.round} match (${r.score}-${r.opponent_score} against ${other.score}-${other.opponent_score})`,
        );
      }
    }

    // who each team was, per the rounds, against what the template says
    const winnerOf = (round) => {
      const pair = by(round);
      if (pair.length !== 2) return null;
      if (pair[0].score === pair[1].score) {
        errors.push(
          `${tag}: the ${round} match ended level (${pair[0].score}-${pair[1].score}); a winner is needed`,
        );
        return null;
      }
      return pair[0].score > pair[1].score ? pair : [pair[1], pair[0]];
    };
    const derived = new Map();
    const note = (r, stage, placement) => {
      const id = idOf(r);
      const cur = derived.get(id);
      if (!cur || STAGES.indexOf(stage) <= STAGES.indexOf(cur.stage))
        derived.set(id, { stage, placement });
    };
    for (const r of by('preliminary')) note(r, 'preliminary', null);
    for (const r of by('quarter_final')) note(r, 'quarter_final', null);
    for (const r of by('semi_final')) note(r, 'semi_final', null);
    const fin = winnerOf('final_champion');
    if (fin) {
      note(fin[0], 'champion', 1);
      note(fin[1], 'final', 2);
    }
    const third = winnerOf('final_runner_up');
    if (third) {
      note(third[0], 'semi_final', 3);
      note(third[1], 'semi_final', 4);
    }
    for (const res of results.filter((x) => x.edition_year === year)) {
      const d = derived.get(`${res.country_code}|${res.team_name}`);
      const at = `template row ${res.__row} (${res.team_name}, ${year})`;
      if (!d) {
        if (res.stage_reached !== 'entered')
          errors.push(
            `${at}: stage ${res.stage_reached} but the rounds file has no round for this team`,
          );
        continue;
      }
      if (res.stage_reached !== d.stage)
        errors.push(`${at}: stage is ${res.stage_reached} but its rounds imply ${d.stage}`);
      else if (d.placement !== null) {
        if (res.placement === null)
          warnings.push(`${at}: the rounds imply placement ${d.placement} but none is filled in`);
        else if (res.placement !== d.placement)
          errors.push(`${at}: placement ${res.placement} but its rounds imply ${d.placement}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------------------------

// Counts per year and per country: what a load would insert or update (the owner's "preview" step).
export function summarise({ results, rounds }) {
  const years = new Map();
  const countries = new Map();
  for (const r of results) {
    const y = years.get(r.edition_year) ?? { entries: 0, countries: new Set(), rounds: 0 };
    y.entries += 1;
    y.countries.add(r.country_code);
    years.set(r.edition_year, y);
    const c = countries.get(r.country_code) ?? { entries: 0, years: new Set(), teams: new Set() };
    c.entries += 1;
    c.years.add(r.edition_year);
    c.teams.add(r.team_name);
    countries.set(r.country_code, c);
  }
  for (const r of rounds) {
    const y = years.get(r.edition_year);
    if (y) y.rounds += 1;
  }
  return {
    perYear: [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({
        year,
        entries: v.entries,
        countries: v.countries.size,
        rounds: v.rounds,
      })),
    perCountry: [...countries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, v]) => ({ code, entries: v.entries, years: v.years.size, teams: v.teams.size })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------------------------

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'null' : String(Number(v)));

/**
 * The load as ONE statement (so a failure leaves nothing half-loaded) inside a transaction:
 * upsert the results on their natural key, upsert the round scores on (result, round), and remove rounds of the loaded
 * results that the file no longer has. `listed` is never in the update list: a row the owner unlisted stays unlisted
 * when its file is loaded again. Throws if the dataset has errors.
 */
export function toSql({ results, rounds, errors }, meta = {}) {
  if (errors.length > 0) throw new Error('refusing to write SQL: the dataset has errors');
  const sorted = [...results].sort(
    (a, b) =>
      a.edition_year - b.edition_year ||
      a.country_code.localeCompare(b.country_code) ||
      a.team_name.localeCompare(b.team_name),
  );
  const sortedRounds = [...rounds].sort(
    (a, b) =>
      a.edition_year - b.edition_year ||
      a.country_code.localeCompare(b.country_code) ||
      a.team_name.localeCompare(b.team_name) ||
      a.round.localeCompare(b.round),
  );

  const resultRows = sorted
    .map(
      (r) =>
        `  (${[q(r.competition), q(r.competition_name), n(r.edition_year), q(r.host_city), q(r.host_country_code), q(r.team_name), q(r.country_code), q(r.stage_reached), n(r.placement), q(r.score_note), q(r.source_ref), q(r.supplied_by), q(r.supplied_on), q(r.permission_ref)].join(', ')})`,
    )
    .join(',\n');
  const roundRows = sortedRounds
    .map(
      (r) =>
        `  (${[q(r.competition), n(r.edition_year), q(r.country_code), q(r.team_name), q(r.round), n(r.r1), n(r.r2), n(r.score), q(r.opponent_team_name), n(r.opponent_score)].join(', ')})`,
    )
    .join(',\n');

  const rCols =
    'competition, edition_year, country_code, team_name, round, r1, r2, score, opponent_team_name, opponent_score';
  const roundsCte =
    sortedRounds.length > 0
      ? `v_rounds (${rCols}) as (\n  values\n${roundRows}\n)`
      : `v_rounds (${rCols}) as (\n  select null::text, null::int, null::text, null::text, null::text, null::int, null::int, null::int, null::text, null::int where false\n)`;

  return `-- Generated by scripts/country-history/import.mjs. LOCAL ONLY: never commit this file (it holds real results).
-- ${meta.summary ?? `${sorted.length} result row(s), ${sortedRounds.length} round row(s)`}
-- Idempotent: loading it twice changes nothing the second time. A row unlisted by hand stays unlisted.
begin;

with v_results (competition, competition_name, edition_year, host_city, host_country_code, team_name, country_code,
                stage_reached, placement, score_note, source_ref, supplied_by, supplied_on, permission_ref) as (
  values
${resultRows}
),
up as (
  insert into app.historical_results
    (competition, competition_name, edition_year, host_city, host_country_code, team_name, country_code,
     stage_reached, placement, score_note, source_ref, supplied_by, supplied_on, permission_ref)
  select competition, competition_name, edition_year::smallint, host_city::text, host_country_code::text, team_name,
         country_code, stage_reached, placement::smallint, score_note::text, source_ref, supplied_by,
         supplied_on::date, permission_ref
    from v_results
  on conflict (competition, edition_year, country_code, team_name) do update
    set competition_name = excluded.competition_name, host_city = excluded.host_city,
        host_country_code = excluded.host_country_code, stage_reached = excluded.stage_reached,
        placement = excluded.placement, score_note = excluded.score_note, source_ref = excluded.source_ref,
        supplied_by = excluded.supplied_by, supplied_on = excluded.supplied_on, permission_ref = excluded.permission_ref
  returning id, competition, edition_year, country_code, team_name
),
${roundsCte},
rs as (
  insert into app.historical_round_scores (result_id, round, r1, r2, score, opponent_team_name, opponent_score)
  select up.id, v.round, v.r1::smallint, v.r2::smallint, v.score::smallint, v.opponent_team_name::text, v.opponent_score::smallint
    from v_rounds v
    join up on up.competition = v.competition and up.edition_year = v.edition_year::smallint
           and up.country_code = v.country_code and up.team_name = v.team_name
  on conflict (result_id, round) do update
    set r1 = excluded.r1, r2 = excluded.r2, score = excluded.score,
        opponent_team_name = excluded.opponent_team_name, opponent_score = excluded.opponent_score
  returning result_id, round
)
delete from app.historical_round_scores s
 using up
 where s.result_id = up.id
   and not exists (select 1 from rs where rs.result_id = s.result_id and rs.round = s.round);

-- What the table holds now (every listed row, not only this file's).
select edition_year, count(*) as entries, count(distinct country_code) as countries
  from app.historical_results where listed group by edition_year order by edition_year;

commit;
`;
}
