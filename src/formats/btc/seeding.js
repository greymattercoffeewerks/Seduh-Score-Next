// BTC seeding ties (T-BTC seeding tie rule). Teams level on points AND wins are seeded by the order the
// organiser records (record_btc_seeding_tiebreak), because seeds decide who plays whom and, for the group
// level across the 8th/9th places, who qualifies at all. The database owns the seed order
// (btc_seeding_order, migration 20261010100000): this module reads it, finds the level groups, checks a draft
// order and records it. It never ranks anyone itself.
import { getSupabase } from '../../core/supabaseClient.js';
import { describeError } from '../../core/errors.js';
import { KNOCKOUT_PLACES } from './words.js';

export const SEEDING_REASON_MAX = 120;

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

// The groups of teams that are level on (points, wins), in seed order. `decidesQualifying` marks the group
// level ACROSS the cut-off (it holds both the last qualifying seed and the first that misses out): only that
// one blocks the bracket until it is ordered, but any group's order decides seeds. `resolved` is the
// database's own word (every team in the group ranked, on the numbers that are tied now, in a group of the
// size it is now). `reason` is the recorded one, and only for a resolved group: a partly ordered group has no
// decision to quote. The key is "points-wins": digits and one hyphen, so it is safe in an attribute.
export function seedingTieGroups(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.tiedCount < 2) continue;
    const key = `${row.totalPoints}-${row.wins}`;
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
        wins: teams[0].wins,
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
  const trimmed = reason.trim();
  if (trimmed === '') {
    return { field: 'reason', message: 'Give a reason, so the decision can be explained later.' };
  }
  if (trimmed.length > SEEDING_REASON_MAX) {
    return {
      field: 'reason',
      message: `Keep the reason to ${SEEDING_REASON_MAX} characters or fewer.`,
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
    message: 'The bracket has already been generated, so the seeds are fixed.',
    reload: true,
  },
  seeding_preliminary_open: {
    message: 'Every preliminary match must be confirmed before ties can be ordered.',
    reload: true,
  },
  seeding_not_tied: {
    message:
      'Those teams are no longer level, so there is nothing to order. The page has been refreshed.',
    reload: true,
  },
  seeding_group_incomplete: {
    message:
      'Another team is now level with this group. The page has been refreshed: order all of them.',
    reload: true,
  },
  seeding_group_invalid: {
    message: 'Those teams could not be found. The page has been refreshed.',
    reload: true,
  },
  seeding_event_not_found: {
    message: 'That event could not be found. Check you are signed in to the right organisation.',
    reload: false,
  },
  seeding_reason_required: {
    message: 'Give a reason, so the decision can be explained later.',
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
  'Teams are level across the 8th and 9th places. Put them in order first, in "Teams level in the standings".';
