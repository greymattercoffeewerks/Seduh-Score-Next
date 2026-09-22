// BTC match scoring (Phase T-BTC.2, scoring sub-step). The scorer records, per cup,
// which team each of the match's 3 judges voted for. Those raw votes are the
// only stored fact (btc_cup_votes) — token totals and points are always derived,
// never persisted (root CLAUDE.md non-negotiable; scoring-auditor verifies).
//
// Write model, identical to cup-taster/scoring.js and for the same reason: taps
// accumulate in a local IndexedDB draft and are never written to the database
// one at a time. Confirming submits the WHOLE match as ONE operation through the
// outbox to the confirm_btc_match RPC (migration 20260922091000), so a dropped
// connection can never leave a half-scored match behind.
//
// The scoring formula's authority is the btc_match_scores SQL view. computeScores
// below is a PREVIEW of it for the live totals panel; scoring.test.js pins both to
// the same fixture numbers as supabase/tests/014_btc_scoring.sql so they cannot
// silently drift apart.
import { cacheGet, cacheSet } from '../../core/db.js';
import {
  buildRpcHandler,
  enqueueOperation,
  flushOutbox,
  listPendingOperations,
} from '../../core/outbox.js';
import { getSupabase } from '../../core/supabaseClient.js';

export const JUDGES_PER_MATCH = 3;
const ROUND_WINNER_BONUS = 5;
const FASTEST_BONUS = 2;
const SIGNATURE_BEVERAGE_BONUS = 2;

const ROUND_LABELS = {
  preliminary: 'Preliminary',
  quarterfinal: 'Quarter-final',
  semifinal: 'Semi-final',
  final: 'Final',
  third_place: 'Third place',
};

export function roundLabel(round) {
  return ROUND_LABELS[round] ?? round;
}

// Mirrors app.btc_cups_for_round in SQL (server-side truth): 15 preliminary cups,
// 20 in every knockout round including third place.
export function cupsForRound(round) {
  return round === 'preliminary' ? 15 : 20;
}

// `baseUpdatedAt` is the match version this draft was started from: it is what the
// server's optimistic-concurrency check must be given, NOT whatever the match happens
// to hold when the screen is next opened, or a draft built on an old version would
// sail through the check. `confirmOpId` is the outbox operation submitted for this
// draft, so a reload can tell "confirmed", "still queued" and "rejected" apart.
export function blankDraft() {
  return {
    votes: {}, // votes[cupNumber][judgeId] = teamId
    fastest: null, // 'team1' | 'team2' | null
    signature: { team1: false, team2: false },
    times: { team1: '', team2: '' },
    baseUpdatedAt: null,
    confirmOpId: null,
  };
}

// Three-state, like Cup Taster's toggle: no vote -> team 1 -> team 2 -> no vote, so a
// mis-tap is always recoverable within three taps.
export function toggleVote(current, team1Id, team2Id) {
  if (current == null) return team1Id;
  if (current === team1Id) return team2Id;
  return null;
}

// Immutable update; a null vote removes the key rather than storing null.
export function withVote(draft, cup, judgeId, teamId) {
  const cupVotes = { ...(draft.votes[cup] ?? {}) };
  if (teamId == null) delete cupVotes[judgeId];
  else cupVotes[judgeId] = teamId;
  const votes = { ...draft.votes, [cup]: cupVotes };
  if (Object.keys(cupVotes).length === 0) delete votes[cup];
  return { ...draft, votes };
}

// Only votes that could actually be sent count: a cup inside the round, a judge on
// this match, a team that is one of its two participants. Everything below derives from
// this ONE filter, so a tally, the totals and the completeness check can never disagree
// about which votes exist.
function validVoteEntries(draft, match, judgeIds, round) {
  const cups = cupsForRound(round);
  const judges = new Set(judgeIds);
  const teams = new Set([match.team1_id, match.team2_id]);
  const entries = [];
  for (let cup = 1; cup <= cups; cup += 1) {
    for (const [judgeId, teamId] of Object.entries(draft.votes[cup] ?? {})) {
      if (judges.has(judgeId) && teams.has(teamId)) entries.push({ cup, judgeId, teamId });
    }
  }
  return entries;
}

export function tokensForCup(draft, cup, match, judgeIds, round) {
  const entries = validVoteEntries(draft, match, judgeIds, round).filter((e) => e.cup === cup);
  return {
    team1: entries.filter((e) => e.teamId === match.team1_id).length,
    team2: entries.filter((e) => e.teamId === match.team2_id).length,
  };
}

export function missingVoteCount(draft, match, judgeIds, round) {
  const total = cupsForRound(round) * judgeIds.length;
  return total - validVoteEntries(draft, match, judgeIds, round).length;
}

export function isMatchComplete(draft, match, judgeIds, round) {
  return (
    judgeIds.length === JUDGES_PER_MATCH && missingVoteCount(draft, match, judgeIds, round) === 0
  );
}

// The first (cup, judge) cell with no valid vote, in cup order then judge order, so a
// scorer with 45 to 60 buttons can be told exactly where to look.
export function firstMissingVote(draft, match, judgeIds, round) {
  const present = new Set(
    validVoteEntries(draft, match, judgeIds, round).map((e) => `${e.cup}:${e.judgeId}`),
  );
  for (let cup = 1; cup <= cupsForRound(round); cup += 1) {
    for (const judgeId of judgeIds) {
      if (!present.has(`${cup}:${judgeId}`)) return { cup, judgeId };
    }
  }
  return null;
}

// One team's total, mirroring one half of the btc_match_scores view: judge tokens,
// +5 if strictly more tokens than the opponent (a tie awards nobody), +2 fastest, and +2
// signature beverage outside the preliminary round.
function teamTotal(own, opponent, isFastest, hasSignature, knockout) {
  return (
    own +
    (own > opponent ? ROUND_WINNER_BONUS : 0) +
    (isFastest ? FASTEST_BONUS : 0) +
    (knockout && hasSignature ? SIGNATURE_BEVERAGE_BONUS : 0)
  );
}

// PREVIEW of btc_match_scores (see the header).
export function computeScores(draft, match, judgeIds, round) {
  const entries = validVoteEntries(draft, match, judgeIds, round);
  const team1Tokens = entries.filter((e) => e.teamId === match.team1_id).length;
  const team2Tokens = entries.filter((e) => e.teamId === match.team2_id).length;
  const knockout = round !== 'preliminary';
  return {
    team1Tokens,
    team2Tokens,
    team1Total: teamTotal(
      team1Tokens,
      team2Tokens,
      draft.fastest === 'team1',
      draft.signature.team1,
      knockout,
    ),
    team2Total: teamTotal(
      team2Tokens,
      team1Tokens,
      draft.fastest === 'team2',
      draft.signature.team2,
      knockout,
    ),
  };
}

// The one place a confirm_btc_match payload is built. Unset votes are OMITTED, never
// sent as null: an incomplete payload is then simply short on votes, which the RPC's
// own strict-confirm count rejects with its friendly message (the same reasoning as
// cup-taster/scoring.js's buildConfirmEntries), instead of tripping a raw NOT NULL.
export function buildConfirmParams(match, draft, judgeIds, round) {
  const knockout = round !== 'preliminary';
  return {
    p_votes: validVoteEntries(draft, match, judgeIds, round).map((e) => ({
      cup_number: e.cup,
      judge_id: e.judgeId,
      team_id: e.teamId,
    })),
    p_fastest_team_id:
      draft.fastest === 'team1'
        ? match.team1_id
        : draft.fastest === 'team2'
          ? match.team2_id
          : null,
    p_team1_signature: knockout && draft.signature.team1,
    p_team2_signature: knockout && draft.signature.team2,
    p_team1_time_note: draft.times.team1,
    p_team2_time_note: draft.times.team2,
  };
}

function draftKey(matchId) {
  return `btc-scoring-draft:${matchId}`;
}

// null (not a blank draft) when nothing is stored, so a caller can tell "the
// organiser has an edit in progress" from "start from the confirmed record".
export async function loadDraft(matchId) {
  const stored = await cacheGet(draftKey(matchId));
  if (!stored || typeof stored !== 'object' || !stored.votes) return null;
  const base = blankDraft();
  return {
    votes: stored.votes,
    fastest: stored.fastest ?? null,
    signature: { ...base.signature, ...stored.signature },
    times: { ...base.times, ...stored.times },
    baseUpdatedAt: stored.baseUpdatedAt ?? null,
    confirmOpId: stored.confirmOpId ?? null,
  };
}

export async function saveDraft(matchId, draft) {
  await cacheSet(draftKey(matchId), draft);
}

export async function clearDraft(matchId) {
  await cacheSet(draftKey(matchId), null);
}

// A confirmed match's recorded scores, in the same shape the draft uses, so the
// screen can show and edit either without caring which it was handed. Its base version
// is the match's own current version.
export async function loadConfirmedDraft(match, client = getSupabase()) {
  const { data: votes, error } = await client
    .from('btc_cup_votes')
    .select('*')
    .eq('match_id', match.id);
  if (error) throw error;
  const { data: bonuses, error: bonusError } = await client
    .from('btc_match_bonuses')
    .select('*')
    .eq('match_id', match.id)
    .maybeSingle();
  if (bonusError) throw bonusError;

  let draft = blankDraft();
  for (const row of votes) draft = withVote(draft, row.cup_number, row.judge_id, row.team_id);
  return {
    ...draft,
    fastest:
      bonuses?.fastest_team_id === match.team1_id
        ? 'team1'
        : bonuses?.fastest_team_id === match.team2_id
          ? 'team2'
          : null,
    signature: {
      team1: Boolean(bonuses?.team1_signature_beverage),
      team2: Boolean(bonuses?.team2_signature_beverage),
    },
    times: { team1: match.team1_time_note ?? '', team2: match.team2_time_note ?? '' },
    baseUpdatedAt: match.updated_at,
  };
}

// Handler map a flush needs to process a queued confirm. Composed into the app-wide map
// by ./outboxHandlers.js (kept out of this file to avoid a circular import).
export function confirmHandlers(client) {
  return { confirm_btc_match: buildRpcHandler(client, 'confirm_btc_match') };
}

// Enqueue, then immediately try a flush. The outbox persists the operation before any
// network call, so it survives a crash the instant this resolves. The caller supplies the
// operation id (and should have saved it into the draft first) so a reload can always
// work out what became of this exact operation. Returns the operation id and the flush
// result; the flush result must NOT be treated as proof THIS confirm landed (the outbox is
// one shared FIFO queue): use wasOperationProcessed for that.
export async function submitConfirmMatch(
  match,
  orgId,
  expectedUpdatedAt,
  params,
  client = getSupabase(),
  handlers,
  operationId = crypto.randomUUID(),
) {
  await enqueueOperation('confirm_btc_match', {
    p_operation_id: operationId,
    p_org_id: orgId,
    p_match_id: match.id,
    p_expected_updated_at: expectedUpdatedAt,
    ...params,
  });
  const result = await flushOutbox(handlers ?? confirmHandlers(client));
  return { operationId, result };
}

// A manual "try to sync now" for an operation left queued by an earlier attempt.
export function flushPending(client = getSupabase(), handlers) {
  return flushOutbox(handlers ?? confirmHandlers(client));
}

// Ground truth for "did THIS operation apply": the server's own idempotency ledger.
// Unlike comparing the match's updated_at, an unrelated write to the match (another
// queued operation, another device) cannot make this look like success or failure.
export async function wasOperationProcessed(operationId, client = getSupabase()) {
  const { data, error } = await client
    .from('processed_operations')
    .select('id')
    .eq('id', operationId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

// Is this operation still waiting in the local outbox (not yet applied, not dropped)?
export async function isOperationQueued(operationId) {
  const pending = await listPendingOperations();
  return pending.some((op) => op.payload?.p_operation_id === operationId);
}

// Only the RPC's own curated validation messages are shown. Anything else (a trigger's
// message naming columns, a raw database error) gets a generic sentence instead of
// leaking internals into the UI.
const CURATED_MESSAGES = [
  /^\d+ of \d+ judge votes are missing$/,
  /^cup numbers must be between \d+ and \d+ for a \w+ match$/,
  /^the signature-beverage bonus does not apply in the preliminary round$/,
  /^match not found$/,
  /^match must have exactly \d+ judges \(has \d+\)$/,
];

// P0002 is the optimistic-concurrency conflict; P0001 is one of this RPC's own validation
// messages (or a trigger's). Returns null for anything else so the caller falls through to
// core/errors' generic describeError.
export function describeConfirmError(err) {
  if (err?.code === 'P0002') {
    return 'This match was changed elsewhere after you started scoring it. Discard your edits to reload the latest scores, then re-enter your changes.';
  }
  if (err?.code === 'P0001' && err.message) {
    const message = err.message.replace(/^confirm_btc_match: /, '');
    return CURATED_MESSAGES.some((pattern) => pattern.test(message))
      ? `Could not confirm: ${message}.`
      : 'Could not confirm this match. Check the votes and try again.';
  }
  return null;
}
