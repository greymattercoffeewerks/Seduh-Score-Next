// BTC scores CSV: the two tables behind the dashboard's "Download matches / cups (CSV)" records
// (docs/specs/BTC-SCORES-CSV-PROPOSAL.md; Organiser UX spec section 6, open question Q10). Pure: rows in, two
// `{ title, columns, rows }` table specs out, ready for core/export.js `buildCsv`. The reads are in
// scoresExportData.js.
//
// The layout is a PROPOSAL the committee may change, so the columns live in two lists below (MATCH_COLUMNS,
// CUP_COLUMNS) and nowhere else: renaming or reordering one is an edit to a list, never to the row builders.
//
// What this module never does is score. Tokens, totals and the match state come from the `btc_match_scores`
// view; the winner is the higher view total (or Level), and a recorded tie-break is named by `tiebreak.js`'s
// `recordedWinnerId`, the one rule the podium and the live payload read. The
// +5 and "cups won" columns only LABEL what the view already decided (which side has strictly more tokens;
// cups with 2 or 3 tokens, a display count that is not part of the score).
import { roundLabel as knockoutLabel } from './roundNames.js';
import { recordedWinnerId } from './tiebreak.js';
import { cupsForRound } from './scoring.js';
import { formatGeneratedAt } from '../../core/signOffSheet.js';

export const TEST_PREFIX = 'TEST · ';
export const BETA_PREFIX = 'BETA TEST · ';

// The order rows are written in: round 1, round 2 (and any later preliminary round), then the knockout.
const KNOCKOUT_ORDER = ['quarterfinal', 'semifinal', 'third_place', 'final'];

export const MATCH_COLUMNS = [
  { key: 'event', label: 'Event' },
  { key: 'round', label: 'Round' },
  { key: 'match', label: 'Match' },
  { key: 'status', label: 'Status' },
  { key: 'team1', label: 'Team 1' },
  { key: 'team1Country', label: 'Team 1 country' },
  { key: 'team2', label: 'Team 2' },
  { key: 'team2Country', label: 'Team 2 country' },
  { key: 'judge1', label: 'Judge 1' },
  { key: 'judge2', label: 'Judge 2' },
  { key: 'judge3', label: 'Judge 3' },
  { key: 'team1CupsWon', label: 'Team 1 cups won' },
  { key: 'team2CupsWon', label: 'Team 2 cups won' },
  { key: 'team1Tokens', label: 'Team 1 tokens' },
  { key: 'team2Tokens', label: 'Team 2 tokens' },
  { key: 'moreTokens', label: 'More tokens (+5)' },
  { key: 'fastest', label: 'Fastest (+2)' },
  { key: 'team1Signature', label: 'Team 1 signature beverage (+2)' },
  { key: 'team2Signature', label: 'Team 2 signature beverage (+2)' },
  { key: 'team1Time', label: 'Team 1 finish time' },
  { key: 'team2Time', label: 'Team 2 finish time' },
  { key: 'team1Total', label: 'Team 1 total' },
  { key: 'team2Total', label: 'Team 2 total' },
  { key: 'winner', label: 'Winner' },
  { key: 'tiebreakWinner', label: 'Tie-break winner' },
  { key: 'tiebreakReason', label: 'Tie-break reason' },
  { key: 'confirmedAt', label: 'Confirmed at' },
];

export const CUP_COLUMNS = [
  { key: 'event', label: 'Event' },
  { key: 'round', label: 'Round' },
  { key: 'match', label: 'Match' },
  { key: 'team1', label: 'Team 1' },
  { key: 'team2', label: 'Team 2' },
  { key: 'cup', label: 'Cup' },
  { key: 'team1Tokens', label: 'Team 1 tokens' },
  { key: 'team2Tokens', label: 'Team 2 tokens' },
  { key: 'cupWonBy', label: 'Cup won by' },
];

const STATUS_LABELS = { pending: 'Scheduled', scoring: 'Scoring', confirmed: 'Confirmed' };

// Pure. "2027-03-14 10:21" in the machine's local time (core's one formatter); '' for a missing or unreadable value.
export function formatLocalDateTime(value) {
  return value ? formatGeneratedAt(new Date(value)) : '';
}

// Pure. The value in the first column: the event name, banded so a file can never pass for an official result.
export function eventLabel(event) {
  const name = String(event?.name ?? '');
  if (event?.is_shadow === true) return `${BETA_PREFIX}${name}`;
  if (event?.is_test === true) return `${TEST_PREFIX}${name}`;
  return name;
}

// Pure. A spreadsheet runs a cell that starts with = + - @ (or a tab or return) as a formula, and team, judge and
// reason text is typed by people. A leading apostrophe keeps it text. core/export.js is not edited for this.
export function safeText(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// Pure. "Round 1", "Round 2", ... for a preliminary match (a null prelim_round reads as round 1, as the matches
// screen does); the knockout round's own label otherwise.
export function exportRoundLabel(match) {
  if (match.round === 'preliminary') return `Round ${match.prelim_round ?? 1}`;
  if (match.round === 'quarterfinal') return 'Quarterfinal';
  if (match.round === 'semifinal') return 'Semifinal';
  return knockoutLabel(match.round);
}

function roundRank(match) {
  if (match.round === 'preliminary') return match.prelim_round ?? 1;
  const at = KNOCKOUT_ORDER.indexOf(match.round);
  return 1000 + (at === -1 ? KNOCKOUT_ORDER.length : at);
}

// Pure. Matches in file order, each with its number within its round (created_at order, the matches screen's
// own order; the id breaks an exact tie so the numbering cannot flip between two downloads).
function numberMatches(entries) {
  const sorted = [...entries].sort(
    (a, b) =>
      roundRank(a.match) - roundRank(b.match) ||
      String(a.match.created_at ?? '').localeCompare(String(b.match.created_at ?? '')) ||
      String(a.match.id).localeCompare(String(b.match.id)),
  );
  const counts = new Map();
  return sorted.map((entry) => {
    const key = roundRank(entry.match);
    const number = (counts.get(key) ?? 0) + 1;
    counts.set(key, number);
    return { ...entry, number };
  });
}

/**
 * @param {{
 *   event: object,
 *   teams: {id: string, name: string, country_code?: string|null}[],
 *   judges: {id: string, name: string}[],
 *   matches: { match: object, judgeIds: string[] }[]   // listEventMatches' shape
 *   scores: object[],     // btc_match_scores rows
 *   cupVotes: {match_id: string, cup_number: number, team1_tokens: number}[],
 *   bonuses: {match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage}[],  // btc_match_bonuses
 * }} rows
 * @returns {{ matches: {title: string, columns: object[], rows: object[]}, cups: {title: string, columns: object[], rows: object[]} }}
 */
export function buildScoresTables({
  event,
  teams = [],
  judges = [],
  matches = [],
  scores = [],
  cupVotes = [],
  bonuses = [],
}) {
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const judgesById = new Map(judges.map((j) => [j.id, j]));
  const scoresByMatch = new Map(scores.map((s) => [s.match_id, s]));
  const bonusByMatch = new Map(bonuses.map((b) => [b.match_id, b]));
  const votesByMatch = new Map();
  for (const vote of cupVotes) {
    if (!votesByMatch.has(vote.match_id)) votesByMatch.set(vote.match_id, new Map());
    votesByMatch.get(vote.match_id).set(Number(vote.cup_number), Number(vote.team1_tokens));
  }
  const nameOf = (id) => safeText(teamsById.get(id)?.name ?? '');
  const eventName = safeText(eventLabel(event));

  const matchRows = [];
  const cupRows = [];

  for (const { match, judgeIds, number } of numberMatches(matches)) {
    const score = scoresByMatch.get(match.id);
    // A score row only counts once the view says confirmed: an unconfirmed match reads 0-0 there, and a 0 would
    // pass for a result. Its score columns stay empty.
    const confirmed = match.status === 'confirmed' && score?.status === 'confirmed';
    const knockout = match.round !== 'preliminary';
    const round = exportRoundLabel(match);
    const team1 = teamsById.get(match.team1_id);
    const team2 = teamsById.get(match.team2_id);
    const judgeName = (index) => safeText(judgesById.get(judgeIds?.[index])?.name ?? '');

    const row = {
      event: eventName,
      round,
      match: number,
      status: STATUS_LABELS[match.status] ?? safeText(match.status),
      team1: nameOf(match.team1_id),
      team1Country: team1?.country_code ?? '',
      team2: nameOf(match.team2_id),
      team2Country: team2?.country_code ?? '',
      judge1: judgeName(0),
      judge2: judgeName(1),
      judge3: judgeName(2),
      team1CupsWon: '',
      team2CupsWon: '',
      team1Tokens: '',
      team2Tokens: '',
      moreTokens: '',
      fastest: '',
      team1Signature: '',
      team2Signature: '',
      team1Time: safeText(match.team1_time_note ?? ''),
      team2Time: safeText(match.team2_time_note ?? ''),
      team1Total: '',
      team2Total: '',
      winner: '',
      tiebreakWinner: '',
      tiebreakReason: '',
      confirmedAt: '',
    };

    if (confirmed) {
      const votes = votesByMatch.get(match.id) ?? new Map();
      const cups = cupsForRound(match.round);
      let team1CupsWon = 0;
      let team2CupsWon = 0;
      for (let cup = 1; cup <= cups; cup += 1) {
        const team1Tokens = votes.get(cup);
        if (team1Tokens === undefined) continue;
        const team2Tokens = 3 - team1Tokens;
        if (team1Tokens >= 2) team1CupsWon += 1;
        if (team2Tokens >= 2) team2CupsWon += 1;
        cupRows.push({
          event: eventName,
          round,
          match: number,
          team1: row.team1,
          team2: row.team2,
          cup,
          team1Tokens,
          team2Tokens,
          cupWonBy: team1Tokens >= 2 ? row.team1 : row.team2,
        });
      }
      const t1 = Number(score.team1_tokens);
      const t2 = Number(score.team2_tokens);
      const bonus = bonusByMatch.get(match.id);
      const fastestId = bonus?.fastest_team_id ?? null;
      // Winner is the higher total the view gives, or Level. A tie-break never changes it: the organiser's
      // decision has its own two columns (recordedWinnerId is only non-null for a level, confirmed match).
      const total1 = Number(score.team1_total);
      const total2 = Number(score.team2_total);
      const tiebreakId = knockout ? recordedWinnerId(match, score) : null;

      row.team1CupsWon = team1CupsWon;
      row.team2CupsWon = team2CupsWon;
      row.team1Tokens = t1;
      row.team2Tokens = t2;
      row.moreTokens = t1 > t2 ? row.team1 : t2 > t1 ? row.team2 : '';
      row.fastest = fastestId ? nameOf(fastestId) : '';
      row.team1Signature = knockout
        ? bonus?.team1_signature_beverage === true
          ? 'Yes'
          : 'No'
        : 'n/a';
      row.team2Signature = knockout
        ? bonus?.team2_signature_beverage === true
          ? 'Yes'
          : 'No'
        : 'n/a';
      row.team1Total = total1;
      row.team2Total = total2;
      row.winner =
        total1 === total2 ? 'Level' : nameOf(total1 > total2 ? match.team1_id : match.team2_id);
      if (tiebreakId) {
        row.tiebreakWinner = nameOf(tiebreakId);
        row.tiebreakReason = safeText(match.tiebreak_reason ?? '');
      }
      // btc_matches has no confirmed-at column: updated_at is the nearest fact (liveSession's `confirmedAt` reads
      // it too). A tie-break recorded afterwards moves it, so it is "last changed" for such a match.
      row.confirmedAt = formatLocalDateTime(match.updated_at);
    }
    matchRows.push(row);
  }

  return {
    matches: { title: 'Matches', columns: MATCH_COLUMNS, rows: matchRows },
    cups: { title: 'Cups', columns: CUP_COLUMNS, rows: cupRows },
  };
}

// Pure. `<event-slug>-<kind>-<YYYY-MM-DD>.csv`, the slug the same shape the dispute-pack file name uses.
export function scoresFilename(event, kind, date = new Date()) {
  const slug =
    String(event?.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'btc-event';
  return `${slug}-${kind}-${formatGeneratedAt(date).slice(0, 10)}.csv`;
}
