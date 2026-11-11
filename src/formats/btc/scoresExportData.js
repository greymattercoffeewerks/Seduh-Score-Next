// The reads behind the BTC scores CSV (scoresExport.js is the pure half). Called on the click of a download, never
// on a dashboard load: it reads fresh rows, so a match confirmed since the page opened is in the file.
// Plain selects the organiser's own screens already make; the scores come from the btc_match_scores view.
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { listEventMatches } from './dashboardData.js';
import { buildScoresTables } from './scoresExport.js';

const MAX_ROWS = 1000;

async function readByMatch(client, table, columns, matchIds) {
  if (matchIds.length === 0) return [];
  const { data, error } = await client.from(table).select(columns).in('match_id', matchIds);
  if (error) throw error;
  const rows = data ?? [];
  // PostgREST caps a response (max_rows = 1000): a file built from a cut-off read would be wrong without saying
  // so, so a full page is a failure, not a result.
  if (rows.length >= MAX_ROWS) throw new Error(`${table} read reached the ${MAX_ROWS}-row limit`);
  return rows;
}

// @returns {Promise<{ matches: object, cups: object }>} the two table specs; throws on any failed read (the
// Records card words the failure), so a half-read file is never saved.
export async function loadScoresTables(eventId, client = getSupabase()) {
  const [event, teams, judges, matches] = await Promise.all([
    findEvent(eventId, client),
    listTeams(eventId, client),
    listJudges(eventId, client),
    listEventMatches(eventId, client),
  ]);
  const matchIds = matches.map((m) => m.match.id);
  const [scores, cupVotes, bonuses] = await Promise.all([
    readByMatch(
      client,
      'btc_match_scores',
      'match_id, status, round, team1_id, team2_id, team1_tokens, team2_tokens, team1_total, team2_total',
      matchIds,
    ),
    readByMatch(client, 'btc_cup_votes', 'match_id, cup_number, team1_tokens', matchIds),
    readByMatch(
      client,
      'btc_match_bonuses',
      'match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage',
      matchIds,
    ),
  ]);
  return buildScoresTables({ event, teams, judges, matches, scores, cupVotes, bonuses });
}
