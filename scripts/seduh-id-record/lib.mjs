// Seduh ID Layer 2, T-ID2.D-a: turns a person's own competition record (a CSV) into ONE owner-SQL transaction that loads it
// into app.seduh_self_reported_entries and app.seduh_team_memberships. Pure functions only (no file, no database): the
// command line is load.mjs. Runbook: CONVENTIONS.md, "Seduh ID: a person's own record".
//
// What it does, by the CSV's own columns (edition_year, competition_name, kind, role, result, team_link, location,
// provenance_now, provenance_possible, notes):
//   * a row WITHOUT a team_link becomes a self-reported ENTRY (year, competition name, kind, role, result text, an optional
//     placement read from the result text, location, note);
//   * a row WITH a team_link ("Bean Bandits (BN) 2024") is NOT an entry: it becomes a TEAM LINK to the matching
//     app.historical_results row (competition, country, team name, year), role member unless the role says otherwise, status
//     self_reported. The SQL stops (raises) if a team-year does not exist, so nothing half-loads.
// Nothing is confirmed here: confirming a membership is a separate, audited owner step (app.seduh_membership_confirm).
// The validation mirrors the database's checks, so a file that passes here cannot be refused by the table.
import { readTable } from '../country-history/lib.mjs';

export const KINDS = ['competed', 'judged', 'organised', 'coached', 'volunteered'];
export const MAX_ENTRIES = 200;
export const MAX_LINKS = 40;
// control characters, zero-width and direction-override characters (the database refuses the same set)
const BAD_RANGES = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];
const hasBadChar = (text) =>
  [...text].some((ch) =>
    BAD_RANGES.some(([from, to]) => ch.codePointAt(0) >= from && ch.codePointAt(0) <= to),
  );

export const HANDLE_RE = /^[a-z0-9](-?[a-z0-9])*$/;

export function isHandle(handle) {
  return (
    typeof handle === 'string' &&
    HANDLE_RE.test(handle) &&
    handle.length >= 3 &&
    handle.length <= 30
  );
}

// "Bean Bandits (BN) 2024" -> { team_name, country_code, edition_year }; null when it is not that shape
export function parseTeamLink(text) {
  const m = /^(.+?)\s*\(([A-Za-z]{2})\)\s*(\d{4})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  return { team_name: m[1].trim(), country_code: m[2].toUpperCase(), edition_year: Number(m[3]) };
}

// The role in the team, from the CSV's own role column ("team member", "captain", "coach", ...); member when it says nothing
export function linkRole(role) {
  const r = String(role ?? '').toLowerCase();
  if (/captain/.test(r)) return 'captain';
  if (/coach/.test(r)) return 'coach';
  if (/reserve|substitute/.test(r)) return 'reserve';
  return 'member';
}

// A placement only where the text says a number outright: "2nd", "4th place", "Champion" (1). "Quarter-final" is no placement.
export function placementFrom(result) {
  const t = String(result ?? '')
    .trim()
    .toLowerCase();
  let m = /^(\d{1,3})(st|nd|rd|th)(\s+place)?$/.exec(t);
  if (m) return Number(m[1]);
  if (/^(champion|winner)$/.test(t)) return 1;
  m = /^place\s+(\d{1,3})$/.exec(t);
  return m ? Number(m[1]) : null;
}

function checkText(label, value, max, errors, row, { required = false } = {}) {
  const v = String(value ?? '').trim();
  if (v === '') {
    if (required) errors.push(`row ${row}: ${label} is required`);
    return null;
  }
  if (v.length > max)
    errors.push(`row ${row}: ${label} is ${v.length} characters (at most ${max})`);
  if (hasBadChar(v)) errors.push(`row ${row}: ${label} has a control or invisible character`);
  if (v.includes('$load$')) errors.push(`row ${row}: ${label} may not contain "$load$"`);
  return v;
}

/**
 * Reads the CSV and returns { entries, links, errors, warnings }. `currentYear` is the latest year accepted (injectable for tests).
 * An error blocks the SQL; a warning is for the owner to read.
 */
export function buildRecord({
  csvText,
  competition = 'btc',
  currentYear = new Date().getUTCFullYear() + 1,
}) {
  const errors = [];
  const warnings = [];
  const entries = [];
  const links = [];
  const { headers, rows } = readTable(csvText);
  for (const need of ['edition_year', 'competition_name', 'kind']) {
    if (!headers.includes(need)) errors.push(`the CSV has no "${need}" column`);
  }
  if (errors.length > 0) return { entries, links, errors, warnings };

  const seenEntry = new Map();
  const seenLink = new Map();
  for (const r of rows) {
    const row = r.__row;
    const year = Number(r.edition_year);
    if (!Number.isInteger(year) || year < 1980 || year > currentYear) {
      errors.push(
        `row ${row}: the year "${r.edition_year}" is not a year from 1980 to ${currentYear}`,
      );
      continue;
    }
    const link = parseTeamLink(r.team_link);
    if (r.team_link && !link) {
      errors.push(`row ${row}: the team link "${r.team_link}" is not like "Team name (BN) 2024"`);
      continue;
    }
    if (link) {
      if (link.edition_year !== year) {
        warnings.push(
          `row ${row}: the team link says ${link.edition_year} but the row's year is ${year}; the team link's year is used`,
        );
      }
      const team = checkText('team name', link.team_name, 120, errors, row, { required: true });
      const key = `${link.country_code}|${team}|${link.edition_year}`;
      if (seenLink.has(key)) {
        errors.push(`row ${row}: the same team-year as row ${seenLink.get(key)}`);
        continue;
      }
      seenLink.set(key, row);
      links.push({
        competition,
        country_code: link.country_code,
        team_name: team,
        edition_year: link.edition_year,
        role: linkRole(r.role),
        row,
      });
      continue;
    }
    const kind = String(r.kind ?? '')
      .trim()
      .toLowerCase();
    if (!KINDS.includes(kind)) {
      errors.push(`row ${row}: the kind "${r.kind}" is not one of ${KINDS.join(', ')}`);
      continue;
    }
    const entry = {
      year,
      competition_name: checkText('competition name', r.competition_name, 120, errors, row, {
        required: true,
      }),
      kind,
      role: checkText('role', r.role, 60, errors, row),
      result_text: checkText('result', r.result, 80, errors, row),
      location: checkText('location', r.location, 80, errors, row),
      note: checkText('notes', r.notes, 500, errors, row),
      placement: null,
      row,
    };
    // a placement column, when the file has one, wins; otherwise it is read from the result text where that is unambiguous
    if (headers.includes('placement') && String(r.placement ?? '').trim() !== '') {
      const p = Number(r.placement);
      if (!Number.isInteger(p) || p < 1 || p > 500)
        errors.push(`row ${row}: placement "${r.placement}" is not 1 to 500`);
      else entry.placement = p;
    } else if (kind === 'competed') {
      // only a competitor has a placing: "Champion" on a judging row is not one
      entry.placement = placementFrom(entry.result_text);
    }
    const key = `${entry.year}|${(entry.competition_name ?? '').toLowerCase()}|${entry.kind}`;
    if (seenEntry.has(key)) {
      errors.push(
        `row ${row}: the same year, competition and kind as row ${seenEntry.get(key)} (the load matches on those three)`,
      );
      continue;
    }
    seenEntry.set(key, row);
    entries.push(entry);
  }
  if (entries.length > MAX_ENTRIES)
    errors.push(`${entries.length} entries; a person may hold at most ${MAX_ENTRIES}`);
  if (links.length > MAX_LINKS)
    errors.push(`${links.length} team links; a person may hold at most ${MAX_LINKS}`);
  return { entries, links, errors, warnings };
}

export function summarise({ entries, links }) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const e of entries) byKind[e.kind] += 1;
  return {
    entries: entries.length,
    byKind,
    links: links.length,
    placements: entries.filter((e) => e.placement !== null).length,
  };
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
const n = (v) => (v === null || v === undefined ? 'null' : String(Number(v)));

/**
 * ONE owner-SQL transaction, idempotent. It refuses (raises, rolls back) if the account is not an OPEN claimed account, or a
 * team-year is not in app.historical_results (listed or not), or the result would pass the caps. Running it twice changes
 * nothing the second time. Throws if the record has errors or the handle is not a handle.
 */
export function toSql({ entries, links, errors }, { handle, summary } = {}) {
  if (errors.length > 0) throw new Error('refusing to write SQL: the record has errors');
  if (!isHandle(handle)) throw new Error('the handle is not a Seduh ID handle');
  const entryRows = entries
    .map(
      (e) =>
        `    (${[n(e.year), q(e.competition_name), q(e.kind), q(e.location), q(e.role), q(e.result_text), n(e.placement), q(e.note)].join(', ')})`,
    )
    .join(',\n');
  const linkRows = links
    .map(
      (l) =>
        `      (${[q(l.competition), q(l.country_code), q(l.team_name), n(l.edition_year), q(l.role)].join(', ')})`,
    )
    .join(',\n');
  const entriesBlock =
    entries.length === 0
      ? '  -- no entries in this file'
      : `  -- ENTRIES: update the one that matches (year, competition, kind) when something differs, insert the rest
  with v (year, competition_name, kind, location, role, result_text, placement, note) as (
    values
${entryRows}
  ), upd as (
    update app.seduh_self_reported_entries e
       set location = v.location, role = v.role, result_text = v.result_text, placement = v.placement::smallint, note = v.note
      from v
     where e.account_id = v_acct and e.year = v.year and lower(e.competition_name) = lower(v.competition_name) and e.kind = v.kind
       and (e.location, e.role, e.result_text, e.placement, e.note)
           is distinct from (v.location, v.role, v.result_text, v.placement::smallint, v.note)
    returning e.id
  ), ins as (
    insert into app.seduh_self_reported_entries (account_id, year, competition_name, location, kind, role, result_text, placement, note)
    select v_acct, v.year, v.competition_name, v.location, v.kind, v.role, v.result_text, v.placement::smallint, v.note
      from v
     where not exists (select 1 from app.seduh_self_reported_entries e
                        where e.account_id = v_acct and e.year = v.year and lower(e.competition_name) = lower(v.competition_name) and e.kind = v.kind)
    returning id
  )
  select (select count(*) from ins), (select count(*) from upd) into v_ins, v_upd;
  raise notice 'entries: % inserted, % updated', v_ins, v_upd;`;
  const linksBlock =
    links.length === 0
      ? '  -- no team links in this file'
      : `  -- TEAM LINKS: every team-year must exist in app.historical_results, or nothing is loaded
  for v_link in
    select v.*, h.id as result_id
      from (values
${linkRows}
      ) v (competition, country_code, team_name, edition_year, role)
      left join app.historical_results h
        on h.competition = v.competition and h.country_code = v.country_code and h.team_name = v.team_name
       and h.edition_year = v.edition_year
  loop
    if v_link.result_id is null then
      raise exception 'no team in app.historical_results for % % (%) %', v_link.competition, v_link.team_name, v_link.country_code, v_link.edition_year;
    end if;
    insert into app.seduh_team_memberships (account_id, result_id, role)
    values (v_acct, v_link.result_id, v_link.role)
    on conflict (account_id, result_id) do nothing;
    get diagnostics v_n = row_count;
    v_links_new := v_links_new + v_n;
  end loop;
  raise notice 'team links: % inserted (status self_reported; confirm each with app.seduh_membership_confirm)', v_links_new;`;

  return `-- Generated by scripts/seduh-id-record/load.mjs. LOCAL ONLY: never commit this file (it holds a real person's record).
-- ${summary ?? `${entries.length} entr(ies), ${links.length} team link(s)`} for the Seduh ID with handle ${q(handle)}.
-- Read it, then run it as owner SQL (CONVENTIONS.md, "Seduh ID: a person's own record"). Idempotent: running it twice changes
-- nothing the second time. It confirms nothing.
begin;
do $load$
declare
  v_acct      uuid;
  v_ins       bigint := 0;
  v_upd       bigint := 0;
  v_n         bigint;
  v_links_new integer := 0;
  v_link      record;
begin
  select a.id into v_acct from app.seduh_accounts a where a.handle = ${q(handle)} and a.closed_at is null;
  if v_acct is null then
    raise exception 'no OPEN claimed Seduh ID with the handle ${handle}: claim it first';
  end if;

${entriesBlock}

${linksBlock}

  if (select count(*) from app.seduh_self_reported_entries where account_id = v_acct) > ${MAX_ENTRIES} then
    raise exception 'the load would take this person past ${MAX_ENTRIES} entries';
  end if;
  if (select count(*) from app.seduh_team_memberships where account_id = v_acct) > ${MAX_LINKS} then
    raise exception 'the load would take this person past ${MAX_LINKS} team links';
  end if;
end
$load$;

-- What the person now holds (compare with the preview):
select (select count(*) from app.seduh_self_reported_entries e join app.seduh_accounts a on a.id = e.account_id where a.handle = ${q(handle)} and a.closed_at is null) as entries,
       (select count(*) from app.seduh_team_memberships m join app.seduh_accounts a on a.id = m.account_id where a.handle = ${q(handle)} and a.closed_at is null) as team_links;
commit;
`;
}
