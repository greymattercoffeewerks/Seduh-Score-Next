// BTC seeding ties (T-BTC seeding tie rule; points only since Build C, migration 20261110100000). Teams level
// on POINTS are seeded by the order the organiser records (record_btc_seeding_tiebreak), because seeds decide
// who plays whom and, for the group level across the 8th/9th places, who qualifies at all. Wins neither order
// nor define a tie. The database owns the seed order (btc_seeding_order): this module reads it, finds the level
// groups, checks a draft order and records it. It never ranks anyone itself. The committee's rule is points,
// then the sum of each team's two preliminary finish times, decided by hand: this module also reads those
// times (btc_prelim_times) so the card can show them, for guidance only.
import { getSupabase } from '../../core/supabaseClient.js';
import { describeError } from '../../core/errors.js';
import { checkReason, REASON_MAX } from '../../core/reason.js';
import { parseDuration } from '../../core/duration.js';
import { KNOCKOUT_PLACES } from './words.js';
import { maxTimeSecsForRound } from './scoring.js';

export const SEEDING_REASON_MAX = REASON_MAX;

// PostgREST says a relation it cannot find is PGRST205 (not in its schema cache); Postgres itself says 42P01.
// The seed order's migration may not be applied yet where this front end is (the 2026-09-05 incident): that one
// case means "there is nothing to show", never "the read failed".
export function isMissingSeedingView(err) {
  return err?.code === 'PGRST205' || err?.code === '42P01';
}

// The seed order of an event, one row per team with a result, best seed first: the view's own columns,
// coerced (PostgREST may return counts as numbers or strings). Team names are the screen's own to supply
// (it already holds the roster).
export async function fetchSeedingOrder(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('btc_seeding_order')
    .select('*')
    .eq('event_id', eventId);
  if (error) throw error;
  return data
    .map((row) => ({
      teamId: row.team_id,
      seed: Number(row.seed),
      wins: Number(row.wins),
      totalPoints: Number(row.total_points),
      tiedCount: Number(row.tied_count),
      tiebreakRank: row.tiebreak_rank == null ? null : Number(row.tiebreak_rank),
      reason: row.reason ?? null,
      groupResolved: row.group_resolved === true,
    }))
    .sort((a, b) => a.seed - b.seed);
}

// Each team's typed preliminary finish times, one row per team per confirmed preliminary match: { teamId,
// round, note } (round: an unnumbered match is round 1, as the view says; note: the text as typed, or null).
// Any failed read throws (including a view that does not exist yet): the caller maps that to "the times could
// not be loaded", never to "no time".
export async function fetchPrelimTimes(eventId, client = getSupabase()) {
  const { data, error } = await client.from('btc_prelim_times').select('*').eq('event_id', eventId);
  if (error) throw error;
  return data.map((row) => ({
    teamId: row.team_id,
    round: Number(row.prelim_round),
    note: row.time_note ?? null,
  }));
}

// The groups of teams that are level on points, in seed order. `decidesQualifying` marks the group
// level ACROSS the cut-off (it holds both the last qualifying seed and the first that misses out): only that
// one blocks the bracket until it is ordered, but any group's order decides seeds. `resolved` is the
// database's own word (every team in the group ranked, on the numbers that are tied now, in a group of the
// size it is now). `reason` is the recorded one, and only for a resolved group: a partly ordered group has no
// decision to quote. The key is "points-<n>": digits and one hyphen, so it is safe in an attribute.
export function seedingTieGroups(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.tiedCount < 2) continue;
    const key = `points-${row.totalPoints}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return [...byKey.entries()]
    .map(([key, teams]) => {
      teams.sort((a, b) => a.seed - b.seed);
      const resolved = teams.every((team) => team.groupResolved);
      return {
        key,
        points: teams[0].totalPoints,
        teams,
        firstSeed: teams[0].seed,
        lastSeed: teams[teams.length - 1].seed,
        decidesQualifying:
          teams[0].seed <= KNOCKOUT_PLACES && teams[teams.length - 1].seed > KNOCKOUT_PLACES,
        resolved,
        reason: resolved ? (teams.find((team) => team.reason)?.reason ?? null) : null,
      };
    })
    .sort((a, b) => a.firstSeed - b.firstSeed);
}

// What the tie card shows for one team: its typed time per preliminary round (round 1 and 2 always, any
// other round that has a match too), a sum when rounds 1 and 2 each have exactly one time and both parse, and
// whether it is at the preliminary limit in both. Pure. An old or demo row with no time is "no time" (an empty
// `notes`), never an error; a time that does not parse is shown as typed and leaves the sum out. The sum is
// for guidance only: the organiser decides.
export const TIE_SUM_ROUNDS = [1, 2];

export function teamTimeEvidence(teamId, times) {
  const mine = times.filter((row) => row.teamId === teamId);
  const rounds = [...new Set([...TIE_SUM_ROUNDS, ...mine.map((row) => row.round)])].sort(
    (a, b) => a - b,
  );
  const perRound = rounds.map((round) => ({
    round,
    notes: mine
      .filter((row) => row.round === round)
      .map((row) => (row.note == null ? '' : String(row.note).trim()))
      .filter((note) => note !== ''),
  }));
  const secsOf = (round) => {
    const notes = perRound.find((entry) => entry.round === round)?.notes ?? [];
    return notes.length === 1 ? parseDuration(notes[0]) : null;
  };
  const [first, second] = TIE_SUM_ROUNDS.map(secsOf);
  const limit = maxTimeSecsForRound('preliminary');
  return {
    teamId,
    rounds: perRound,
    sumSecs: first !== null && second !== null ? first + second : null,
    bothAtLimit: first === limit && second === limit,
  };
}

// The evidence for every team of a group. `allAtLimit`: every team is at the limit in both rounds, so the times
// cannot separate them (still the organiser's decision; what the committee wants then is open).
export function groupTimeEvidence(group, times) {
  const teams = group.teams.map((team) => teamTimeEvidence(team.teamId, times));
  return { teams, allAtLimit: teams.length > 0 && teams.every((team) => team.bothAtLimit) };
}

// The groups that stop the bracket being generated: level across the cut-off and not yet ordered.
export const blockingGroups = (groups) =>
  groups.filter((group) => group.decidesQualifying && !group.resolved);

// Pure; the RPC is the real enforcement. A faster "no" for the common mistakes, with messages fit to show to
// the person at the screen. Returns null, or { field, message }.
export function validateSeedingOrder({ orderedTeamIds, groupTeamIds, reason }) {
  const sameTeams =
    orderedTeamIds.length === groupTeamIds.length &&
    new Set(orderedTeamIds).size === orderedTeamIds.length &&
    orderedTeamIds.every((id) => groupTeamIds.includes(id));
  if (!sameTeams) {
    return { field: 'form', message: 'The order must list every team in the group once.' };
  }
  const checked = checkReason(reason);
  if (!checked.ok && checked.kind === 'empty') {
    return { field: 'reason', message: 'Type a reason. It is kept with the event.' };
  }
  if (!checked.ok) {
    return {
      field: 'reason',
      message: `Keep the reason to ${checked.max} characters or fewer.`,
    };
  }
  return null;
}

// orderedTeamIds: best seed first. Throws the RPC's error (with its `hint`) on a refusal.
export async function recordSeedingTiebreak(
  orgId,
  eventId,
  orderedTeamIds,
  reason,
  client = getSupabase(),
) {
  const { error } = await client.rpc('record_btc_seeding_tiebreak', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_team_ids: orderedTeamIds,
    p_reason: reason.trim(),
  });
  if (error) throw error;
}

// The hints the database attaches to its refusals, so this never depends on message wording. `reload` marks
// the refusals that mean the screen is showing stale state: the caller refreshes it.
const REFUSALS = {
  seeding_bracket_exists: {
    message: 'The top 8 are already locked, so the seeds are fixed.',
    reload: true,
  },
  seeding_preliminary_open: {
    message: 'Confirm every match in rounds 1 and 2 before putting level teams in order.',
    reload: true,
  },
  seeding_not_tied: {
    message:
      'Those teams are no longer level, so there is nothing to order. The page is up to date.',
    reload: true,
  },
  seeding_group_incomplete: {
    message: 'Another team is now level with this group. Put all the level teams in order.',
    reload: true,
  },
  seeding_group_invalid: {
    message: 'We could not find those teams. The page is up to date. Try again.',
    reload: true,
  },
  seeding_event_not_found: {
    message: 'We could not find this event. Check you are signed in to the right organisation.',
    reload: false,
  },
  seeding_reason_required: {
    message: 'Type a reason. It is kept with the event.',
    reload: false,
  },
  seeding_reason_too_long: {
    message: `Keep the reason to ${SEEDING_REASON_MAX} characters or fewer.`,
    reload: false,
  },
};

export function seedingRefusal(err) {
  return REFUSALS[err?.hint] ?? null;
}

// Anything unrecognised falls through to describeError (a raw failure becomes the generic "try again").
export function describeSeedingError(err) {
  return seedingRefusal(err)?.message ?? describeError(err);
}

// generate_btc_bracket refuses with a plain message (no hint) while teams are level across the cut-off and
// unordered. The screen already knows that from the seed order, so this only recognises the refusal when the
// order it holds was out of date.
export function isCutoffTieRefusal(err) {
  return /tied for the 8th qualifying spot/.test(err?.message ?? '');
}

export const CUTOFF_TIE_MESSAGE =
  'Teams are level across the cut line. Put them in order first, in "Teams level in the standings".';
