// BTC preliminary standings (Phase T-BTC.2, sub-step 4). Read-only: this module
// only derives a ranked table from btc_standings, it never writes anything. Bracket
// generation/advancement (sub-step 5) is a separate step with its own module — that one
// decides who plays whom next and needs different logic (bonus-inclusive knockout
// totals, an unresolved-tie rule); this one is purely "where does everyone stand right
// now in the preliminary round".
import { getSupabase } from '../../core/supabaseClient.js';
import { rank, chainComparators } from '../../core/ranking.js';

// btc_standings (the SQL view, the one source of truth for points/wins — see
// supabase/migrations/20260922100000_btc_cup_votes_per_cup_tokens.sql) only ever holds
// a row for a team with at least one CONFIRMED, complete preliminary match. A team that
// hasn't played yet has no row there at all, so this merges in every registered team
// from btc_teams and treats a missing row as 0 played / 0 wins / 0 points — an
// organiser checking standings mid-event sees the full field, not just whoever has
// already played.
export async function fetchPreliminaryStandings(eventId, client = getSupabase()) {
  const [{ data: teams, error: teamsError }, { data: standings, error: standingsError }] =
    await Promise.all([
      client.from('btc_teams').select('*').eq('event_id', eventId).order('name'),
      // btc_standings has no round column — it is already scoped to the preliminary
      // round internally (its own WHERE clause), so there is nothing to filter here.
      client.from('btc_standings').select('*').eq('event_id', eventId),
    ]);
  if (teamsError) throw teamsError;
  if (standingsError) throw standingsError;

  const byTeam = new Map(standings.map((row) => [row.team_id, row]));
  const items = teams.map((team) => {
    const row = byTeam.get(team.id);
    return {
      teamId: team.id,
      teamName: team.name,
      played: row?.played ?? 0,
      wins: row?.wins ?? 0,
      totalPoints: row?.total_points ?? 0,
    };
  });

  // Points decide the position (Build C, 2026-11: the committee's rule is points, then the sum of the two finish
  // times, decided by hand): teams on equal points SHARE one position, whatever their wins, so this table never
  // says one of two level teams is ahead (the tie card on the bracket screen is where the organiser orders
  // them). Wins only sort the rows within a shared position, for display, so a team with more wins is listed
  // first; they are never a tie-break. No name comparator: it would make every team distinct. `items` is
  // already alphabetical (`btc_teams` was queried ordered by name above) and Array#sort is stable, so equal rows
  // still come out alphabetical.
  const positions = new Map(
    rank(items, (a, b) => b.totalPoints - a.totalPoints).map(({ item, position }) => [
      item.teamId,
      position,
    ]),
  );
  return [...items]
    .sort(
      chainComparators(
        (a, b) => b.totalPoints - a.totalPoints,
        (a, b) => b.wins - a.wins,
      ),
    )
    .map((item) => ({ item, position: positions.get(item.teamId) }));
}
