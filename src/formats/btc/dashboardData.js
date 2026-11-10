// What the BTC event dashboard reads, in one place, so runSheet.js can stay pure. Every read that only ADVISES
// (finish times, the seed order, the bracket scores, what is queued on this device) fails to `null` instead of
// stopping the page: a slow or missing advisory read must never stop an organiser opening their own event. The
// reads that the phases cannot be drawn without (the event, teams, judges, matches) throw.
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { listPendingOperations } from '../../core/outbox.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { countPreliminaryMatchesWithoutTimes } from './matches.js';
import { fetchBracket, bracketMatchIds, fetchBracketScores } from './bracket.js';
import { fetchSeedingOrder } from './seeding.js';

const advisory = (promise) =>
  raceTimeout(Promise.resolve(promise), DEFAULT_LOAD_TIMEOUT_MS).catch(() => null);

// Every match of the event (all rounds) with its judges attached client-side, oldest first.
export async function listEventMatches(eventId, client = getSupabase()) {
  const { data: matches, error } = await client
    .from('btc_matches')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!matches || matches.length === 0) return [];
  const { data: links, error: linkError } = await client
    .from('btc_match_judges')
    .select('match_id, judge_id')
    .in(
      'match_id',
      matches.map((m) => m.id),
    );
  if (linkError) throw linkError;
  const byMatch = new Map();
  for (const link of links ?? []) {
    if (!byMatch.has(link.match_id)) byMatch.set(link.match_id, []);
    byMatch.get(link.match_id).push(link.judge_id);
  }
  return matches.map((match) => ({ match, judgeIds: byMatch.get(match.id) ?? [] }));
}

// Confirms waiting in THIS person's outbox on this device for matches of this event.
export async function countQueuedConfirms(matchIds, listQueued = listPendingOperations) {
  const ids = new Set(matchIds);
  const queued = await listQueued();
  return queued.filter((op) => op.type === 'confirm_btc_match' && ids.has(op.payload?.p_match_id))
    .length;
}

/**
 * @returns {Promise<object>} `{ event, teams, judges, matches, bracket, bracketScores, seedingRows,
 *   withoutTimes, queuedConfirms }`; the last four are null when their read failed.
 */
export async function loadDashboardData(
  eventId,
  { client = getSupabase(), listQueued = listPendingOperations } = {},
) {
  // The advisory reads start beside the required ones, not after them: a slow link must not double the wait.
  const withoutTimes = advisory(countPreliminaryMatchesWithoutTimes(eventId, client));
  const seedingRows = advisory(fetchSeedingOrder(eventId, client));
  const bracketRead = fetchBracket(eventId, client);
  const bracketScores = advisory(
    bracketRead.then((entries) => fetchBracketScores(bracketMatchIds(entries), client)),
  );
  const [event, teams, judges, matches, bracket] = await raceTimeout(
    Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      listJudges(eventId, client),
      listEventMatches(eventId, client),
      bracketRead,
    ]),
    DEFAULT_LOAD_TIMEOUT_MS,
  );
  const queuedConfirms = await advisory(
    countQueuedConfirms(
      matches.map((m) => m.match.id),
      listQueued,
    ),
  );
  return {
    event,
    teams,
    judges,
    matches,
    bracket,
    bracketScores: await bracketScores,
    seedingRows: await seedingRows,
    withoutTimes: await withoutTimes,
    queuedConfirms,
  };
}
