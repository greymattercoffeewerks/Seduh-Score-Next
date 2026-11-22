// Throwdown's match log as a CSV (the dashboard's Records card). Pure: a derived bracket in, a table spec out; the
// file is built by core/export.js's `buildCsv` (RFC 4180 quoting of commas, quotes and line breaks), which
// core/recordsCard.js's `csvText` also accepts as a table spec. Nothing here decides a winner: `deriveBracket`
// already did, and the log only words it.
import { buildCsv } from '../../core/export.js';
import { formatGeneratedAt } from '../../core/signOffSheet.js';

export const MATCH_LOG_COLUMNS = Object.freeze([
  { key: 'round', label: 'Round' },
  { key: 'match', label: 'Match' },
  { key: 'competitorA', label: 'Competitor A' },
  { key: 'competitorB', label: 'Competitor B' },
  { key: 'votesA', label: 'Votes A' },
  { key: 'votesB', label: 'Votes B' },
  { key: 'resultKind', label: 'Result' },
  { key: 'winner', label: 'Winner' },
  { key: 'confirmedAt', label: 'Confirmed at' },
]);

// Pure. Competitor names are typed by people. A spreadsheet runs a cell starting with = + - @ as a formula, so a
// leading apostrophe keeps it text; a bare carriage return is not quoted by core/export.js, so it becomes a space.
function safeText(value) {
  const text = value == null ? '' : String(value).replace(/\r\n?/g, ' ');
  return /^[=+\-@\t]/.test(text) ? `'${text}` : text;
}

// Pure. One row per match, rounds in the bracket's order (the 3rd place match last).
export function matchLogRows(bracket) {
  const rows = [];
  for (const round of bracket.rounds) {
    round.matches.forEach((match, index) => {
      const [a, b] = match.sides;
      // A walkover or bye is never a tally, and a scored match has no taps: those rows carry no vote counts.
      const tapped = match.resultKind === null || match.resultKind === 'votes';
      rows.push({
        round: safeText(round.label),
        match: index + 1,
        competitorA: safeText(a?.name),
        competitorB: safeText(b?.name),
        votesA: tapped ? (a?.votes ?? '') : '',
        votesB: tapped ? (b?.votes ?? '') : '',
        resultKind: match.resultKind ?? '',
        winner: safeText(match.sides.find((s) => s.winner)?.name),
        confirmedAt: match.confirmedAt ? formatGeneratedAt(new Date(match.confirmedAt)) : '',
      });
    });
  }
  return rows;
}

// Pure. The CSV text: a header row and one row per match.
export function matchLogCsv(bracket) {
  return buildCsv({ title: 'Matches', columns: MATCH_LOG_COLUMNS, rows: matchLogRows(bracket) });
}

// Pure. `<event-slug>-matches-<YYYY-MM-DD>.csv`, the same shape BTC's score files use.
export function matchLogFilename(event, now = new Date()) {
  const slug =
    String(event?.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'throwdown-event';
  return `${slug}-matches-${formatGeneratedAt(now).slice(0, 10)}.csv`;
}
