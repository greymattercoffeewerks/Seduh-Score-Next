// BTC's live-session payload and the automatic publish that sends it (T-BTC.live-publish, stage 2 of the BTC
// live surfaces). The audience surfaces (projector, phone, results) read ONE `live_sessions` row per org, so
// every BTC change the room should see ends in a publish; nothing relies on an organiser remembering a "Go
// live" button (the failure the legacy app had, and Cup Taster's liveSession.js closed the same way).
//
// Two halves, kept apart so the rules are testable without a database:
// - `assembleBtcLivePayload` is PURE: rows in, payload out. Every winner, tie and podium decision reuses the
//   modules the organiser's own screens use (`recordedWinnerId`, `derivePodium`, the SQL views' totals), so the
//   audience can never disagree with the organiser about who won.
// - `buildBtcLivePayload` reads the rows, and `publishBtcLive` / the handler send it. The machinery (enqueue
//   an intent first so an offline device still queues it, build the payload at flush time from fresh state,
//   order publishes with a snapshot clock, classify read failures) is core/publishIntent.js, shared with
//   Cup Taster.
//
// Payload (additive; the projector and phone read it, nothing here is a screen):
//   eventName, phase ('setup' | 'preliminary' | 'knockout' | 'complete'), progress { played, total }
//   (preliminary matches confirmed / created), standings (every team, ranked), upNext / thenNext (the next two
//   unconfirmed matches in play order, or null), recentResults (the three newest confirmed matches, newest
//   first, each with its breakdown), bracket (rounds of slots, or null before it exists), podium (or null).
//
// Order: "newest" is `btc_matches.updated_at`. There is no confirmed_at column, so a tie-break recorded on, or
// a correction made to, an old match makes it the newest again. That is news the room should see, but it means
// a result card can reappear: each card carries `confirmedAt` so a display can tell a re-score from a new one.
//
// Everything in the payload is public (live_sessions is readable by anon): team and judge names, and the
// organiser's typed tie-break reason, as plain text.
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { findActiveLiveEventId } from '../../core/publish.js';
import {
  publishIntentHandler,
  submitPublishIntent,
  enqueuePublishIntent,
} from '../../core/publishIntent.js';
import { fetchPreliminaryStandings } from './standings.js';
import { fetchBracket, BRACKET_ROUND_ORDER, BRACKET_ROUND_LABELS } from './bracket.js';
import { derivePodium } from './podium.js';
import { recordedWinnerId, winnerOfScore } from './tiebreak.js';
import { roundLabel } from './scoring.js';

export const BTC_LIVE_OPERATION = 'publish_btc_live_session';

const RECENT_RESULTS_LIMIT = 3;

// The order matches are played in: the round, then the order they were created. Third place is played before
// the final.
const PLAY_ORDER = ['preliminary', 'quarterfinal', 'semifinal', 'third_place', 'final'];

const num = (value) => Number(value);

// Timestamps compare as instants, not strings (a whole-second value must not sort after a fractional one in
// the same second), and equal instants fall back to the id, so one set of rows always gives one order. This
// matters for demo data, where every match is inserted in one statement and shares a timestamp.
const instant = (value) => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function byPlayOrder(a, b) {
  const round = PLAY_ORDER.indexOf(a.round) - PLAY_ORDER.indexOf(b.round);
  if (round !== 0) return round;
  return instant(a.created_at) - instant(b.created_at) || byId(a, b);
}

const byNewest = (a, b) => instant(b.updated_at) - instant(a.updated_at) || byId(a, b);

// One side of a result. The bonuses repeat the view's own conditions (btc_match_scores) only to LABEL the
// points; the totals themselves are the view's, never recomputed. The labels come from a separate read
// (btc_match_totals), so a card shows them only when they explain BOTH totals exactly (tokens + 5 for the win
// + 2 fastest + 2 signature): a missing row, or reads that straddle a confirm, show the totals without a
// breakdown rather than one that does not add up, on both sides together.
function resultSide(side, match, score, totalsRow, winnerId, nameOf) {
  const own = side === 1 ? 'team1' : 'team2';
  const other = side === 1 ? 'team2' : 'team1';
  const teamId = score[`${own}_id`];
  const tokens = num(score[`${own}_tokens`]);
  const total = num(score[`${own}_total`]);
  const bonuses = {
    win: tokens > num(score[`${other}_tokens`]),
    fastest: totalsRow?.fastest_team_id === teamId,
    signature: match.round !== 'preliminary' && totalsRow?.[`${own}_signature_beverage`] === true,
  };
  const explained =
    tokens + (bonuses.win ? 5 : 0) + (bonuses.fastest ? 2 : 0) + (bonuses.signature ? 2 : 0);
  return {
    side: { name: nameOf(teamId), tokens, total, bonuses, winner: winnerId === teamId },
    explainsTotal: Boolean(totalsRow) && explained === total,
  };
}

function resultCard(match, score, totalsRow, nameOf) {
  const winnerId = winnerOfScore(match, score);
  const tiebreakWinnerId = recordedWinnerId(match, score);
  const sides = [1, 2].map((n) => resultSide(n, match, score, totalsRow, winnerId, nameOf));
  const explained = sides.every((side) => side.explainsTotal);
  return {
    matchId: match.id,
    round: match.round,
    roundLabel: roundLabel(match.round),
    confirmedAt: match.updated_at,
    teams: sides.map(({ side }) => ({ ...side, bonuses: explained ? side.bonuses : null })),
    level: num(score.team1_total) === num(score.team2_total),
    tiebreak: tiebreakWinnerId
      ? { winnerName: nameOf(tiebreakWinnerId), reason: match.tiebreak_reason }
      : null,
  };
}

function matchCard(match, judgeNamesByMatch, placeByTeam, nameOf) {
  return {
    matchId: match.id,
    round: match.round,
    roundLabel: roundLabel(match.round),
    status: match.status,
    teams: [match.team1_id, match.team2_id].map((id) => ({
      name: nameOf(id),
      place: placeByTeam.get(id) ?? null,
    })),
    judges: judgeNamesByMatch.get(match.id) ?? [],
  };
}

function bracketPayload(entries, scoresByMatchId, nameOf) {
  if (entries.length === 0) return null;
  const rounds = [];
  for (const round of BRACKET_ROUND_ORDER) {
    const inRound = entries.filter(({ slot }) => slot.round === round);
    if (inRound.length === 0) continue;
    rounds.push({
      round,
      label: BRACKET_ROUND_LABELS[round],
      slots: inRound.map(({ slot, match }) => {
        const score = match && scoresByMatchId.get(slot.match_id);
        const confirmed = match?.status === 'confirmed' && score?.status === 'confirmed';
        const winnerId = confirmed ? winnerOfScore(match, score) : null;
        const tiebreakWinnerId = confirmed ? recordedWinnerId(match, score) : null;
        // A slot's total is looked up by TEAM, not by position, so a slot seated the other way round from its
        // match can never attach a total to the wrong name.
        const totalFor = (teamId) => {
          if (!confirmed || !teamId) return null;
          if (score.team1_id === teamId) return num(score.team1_total);
          if (score.team2_id === teamId) return num(score.team2_total);
          return null;
        };
        const team = (teamId) => ({
          name: teamId ? nameOf(teamId) : null,
          total: totalFor(teamId),
          winner: confirmed && teamId !== null && teamId === winnerId,
        });
        return {
          label: slot.slot_label,
          status: match ? match.status : null,
          teams: [team(slot.team1_id), team(slot.team2_id)],
          level: confirmed ? num(score.team1_total) === num(score.team2_total) : false,
          tiebreak: tiebreakWinnerId
            ? { winnerName: nameOf(tiebreakWinnerId), reason: match.tiebreak_reason }
            : null,
        };
      }),
    });
  }
  return { rounds };
}

// Pure. Inputs are plain rows: event, teams ({id,name}), judges ({id,name}), matches (btc_matches),
// matchJudges ({match_id, judge_id}), scores (btc_match_scores), totals (btc_match_totals), standings
// (fetchPreliminaryStandings' [{item, position}]) and bracketEntries (fetchBracket's [{slot, match}]).
export function assembleBtcLivePayload({
  event,
  teams,
  judges,
  matches,
  matchJudges,
  scores,
  totals,
  standings,
  bracketEntries,
}) {
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id) => teamsById.get(id)?.name ?? 'Unknown team';
  const judgeNames = new Map(judges.map((j) => [j.id, j.name]));
  const judgeNamesByMatch = new Map();
  for (const { match_id: matchId, judge_id: judgeId } of matchJudges) {
    const list = judgeNamesByMatch.get(matchId) ?? [];
    list.push(judgeNames.get(judgeId) ?? 'Unknown judge');
    judgeNamesByMatch.set(matchId, list);
  }
  const scoresByMatchId = new Map(scores.map((s) => [s.match_id, s]));
  const totalsByMatchId = new Map(totals.map((t) => [t.match_id, t]));
  const placeByTeam = new Map(standings.map(({ item, position }) => [item.teamId, position]));

  const ordered = [...matches].sort(byPlayOrder);
  const prelim = ordered.filter((m) => m.round === 'preliminary');
  const upcoming = ordered.filter((m) => m.status !== 'confirmed');
  const confirmed = matches
    .filter((m) => m.status === 'confirmed' && scoresByMatchId.get(m.id)?.status === 'confirmed')
    .sort(byNewest);

  const podium = derivePodium({
    entries: bracketEntries,
    scores,
    teams,
  });
  const hasBracket = bracketEntries.length > 0;
  let phase = 'preliminary';
  if (matches.length === 0 && !hasBracket) phase = 'setup';
  else if (hasBracket) phase = podium.complete ? 'complete' : 'knockout';

  return {
    eventName: event?.name ?? null,
    phase,
    progress: {
      played: prelim.filter((m) => m.status === 'confirmed').length,
      total: prelim.length,
    },
    standings: standings.map(({ item, position }) => ({
      position,
      teamName: item.teamName,
      played: num(item.played),
      wins: num(item.wins),
      points: num(item.totalPoints),
    })),
    upNext: upcoming[0] ? matchCard(upcoming[0], judgeNamesByMatch, placeByTeam, nameOf) : null,
    thenNext: upcoming[1] ? matchCard(upcoming[1], judgeNamesByMatch, placeByTeam, nameOf) : null,
    recentResults: confirmed
      .slice(0, RECENT_RESULTS_LIMIT)
      .map((m) => resultCard(m, scoresByMatchId.get(m.id), totalsByMatchId.get(m.id), nameOf)),
    bracket: bracketPayload(bracketEntries, scoresByMatchId, nameOf),
    podium: hasBracket
      ? {
          complete: podium.complete,
          places: podium.places.map(({ key, label, state, teamName, viaTiebreak }) => ({
            key,
            label,
            state,
            teamName: state === 'decided' ? teamName : null,
            viaTiebreak: state === 'decided' ? viaTiebreak === true : false,
          })),
        }
      : null,
  };
}

const SCORE_COLUMNS =
  'match_id, status, round, team1_id, team2_id, team1_tokens, team2_tokens, team1_total, team2_total';
const TOTALS_COLUMNS =
  'match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage';

// One plain select for this event. Async, so a client that throws synchronously becomes a rejection like any
// other failed read: built inline in an array literal, that throw would escape Promise.all and orphan the
// reads already started (an unhandled rejection).
async function readForEvent(client, table, columns, eventId) {
  const { data, error } = await client.from(table).select(columns).eq('event_id', eventId);
  if (error) throw error;
  return data;
}

// The reads behind one payload. Every read is for this event only, and all of them are plain selects the
// organiser's own screens already make; the totals and the winner rules come from the same views and modules.
export async function buildBtcLivePayload(eventId, client = getSupabase()) {
  const [event, teams, judges, matches, scores, totals, standings, bracketEntries] =
    await Promise.all([
      findEvent(eventId, client),
      readForEvent(client, 'btc_teams', 'id, name', eventId),
      readForEvent(client, 'btc_judges', 'id, name', eventId),
      readForEvent(client, 'btc_matches', '*', eventId),
      readForEvent(client, 'btc_match_scores', SCORE_COLUMNS, eventId),
      readForEvent(client, 'btc_match_totals', TOTALS_COLUMNS, eventId),
      fetchPreliminaryStandings(eventId, client),
      fetchBracket(eventId, client),
    ]);
  const matchIds = matches.map((m) => m.id);
  let matchJudges = [];
  if (matchIds.length > 0) {
    const { data, error } = await client
      .from('btc_match_judges')
      .select('match_id, judge_id')
      .in('match_id', matchIds);
    if (error) throw error;
    matchJudges = data;
  }
  return assembleBtcLivePayload({
    event,
    teams,
    judges,
    matches,
    matchJudges,
    scores,
    totals,
    standings,
    bracketEntries,
  });
}

// `onlyIfLive` intents (schedule edits: a match created or removed, the bracket generated) must never take the
// org's one live display away from another event, so the flush publishes only if THIS event already is the
// active session. Decided at flush time, not enqueue time: offline, the question cannot be asked yet. (A test
// event deleted while its publish was queued is a no-op in core/publishIntent.js.)
async function buildPayloadForIntent({ orgId, eventId, onlyIfLive }, client) {
  if (onlyIfLive && (await findActiveLiveEventId(orgId, client)) !== eventId) return null;
  return buildBtcLivePayload(eventId, client);
}

export function publishBtcLiveSessionHandlers(client) {
  return {
    [BTC_LIVE_OPERATION]: publishIntentHandler(client, (intent) =>
      buildPayloadForIntent(intent, client),
    ),
  };
}

// The intent a trigger sends. `takeOver: true` is for what is genuinely running the event (a match confirmed, a
// tie-break recorded, demo data loaded): it makes this event the org's live session, as any activity does in
// Cup Taster. Anything else is a schedule edit: it republishes only if this event is already live.
function intentFor(event, takeOver) {
  if (typeof event?.is_test !== 'boolean') {
    throw new TypeError('BTC live publish: the event must carry an explicit boolean is_test');
  }
  return {
    orgId: event.org_id,
    eventId: event.id,
    format: 'btc',
    isTest: event.is_test,
    onlyIfLive: takeOver !== true,
  };
}

// Persists the intent without flushing. For a caller that must have it durable BEFORE its own flush, so the
// publish queues BEHIND the write it describes and survives the screen being left: the scoring screen enqueues
// it right after the confirm, then flushes both in one pass.
export async function enqueueBtcLive({ event, takeOver }) {
  await enqueuePublishIntent(BTC_LIVE_OPERATION, intentFor(event, takeOver));
}

// The automatic trigger for one-shot writes: enqueue, then flush. `handlers` is the caller's composed outbox
// map (main.js's allOutboxHandlers) and is REQUIRED: a map without another format's handler stops the whole
// FIFO queue at that format's operation, so there is no BTC-only fallback. A failure to enqueue or flush is
// logged here and changes nothing about the organiser's own action; a flush that stops leaves the publish
// queued, and the sync panel reports it. A programming error (an event without a boolean `is_test`, no handler
// map) REJECTS, loudly, because D9 must not be defeated by a caller that forgot it: callers that do not await
// it catch the rejection and log it.
export async function publishBtcLive({ event, takeOver }, handlers) {
  const intent = intentFor(event, takeOver);
  if (!handlers) {
    throw new TypeError('publishBtcLive: the composed outbox handler map is required');
  }
  try {
    await submitPublishIntent(BTC_LIVE_OPERATION, intent, handlers);
  } catch (error) {
    console.error('btc liveSession: live-view publish failed (may still be queued)', error);
  }
}
