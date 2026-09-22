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

  // Points first (the actual competitive result), wins as the declared tiebreak. A
  // genuine tie (equal on both) shares one position — this is DISPLAY ordering, not
  // the seeding/advancement decision (that's the bracket step's own job, on the
  // bonus-inclusive totals, with its own unresolved-tie rule), so an honest shared
  // position is the right thing to show, not a manufactured ranking. No name
  // comparator here: adding one would make rank() treat every team as distinct and
  // never share a position at all. `items` is already alphabetical (`btc_teams` was
  // queried ordered by name above) and Array#sort is a stable sort, so a genuine tie's
  // display order still comes out alphabetical without name deciding the tie itself.
  return rank(
    items,
    chainComparators(
      (a, b) => b.totalPoints - a.totalPoints,
      (a, b) => b.wins - a.wins,
    ),
  );
}
