// BTC match scoring (Phase T-BTC.2, scoring sub-step). Each cup holds exactly 3
// tokens, split between the two teams: the scorer enters ONE number — team1's share
// (0-3) — and team2's share is always the balance (3 - team1). Judges are still
// assigned to the match, exactly 3, and shown on the scoring screen for the record,
// but no vote is attributed to one of them (design correction, 2026-09-22 — caught
// against the legacy Seduh Score UI before this shipped; see
// supabase/migrations/20260922100000_btc_cup_votes_per_cup_tokens.sql's header for
// the full account of what this superseded). Token totals and points are always
// derived, never persisted (root CLAUDE.md non-negotiable; scoring-auditor verifies).
//
// Write model, identical to cup-taster/scoring.js and for the same reason: taps
// accumulate in a local IndexedDB draft and are never written to the database
// one at a time. Confirming submits the WHOLE match as ONE operation through the
// outbox to the confirm_btc_match RPC, so a dropped connection can never leave a
// half-scored match behind.
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

// A match must still carry exactly 3 assigned judges before it can be confirmed —
// an on-the-record fact about who scored the match, not a per-vote attribution.
export const JUDGES_PER_MATCH = 3;
export const TOKENS_PER_CUP = 3;

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
    votes: {}, // votes[cupNumber] = team1's token share, 0-3 (team2 = 3 - that)
    fastest: null, // 'team1' | 'team2' | null
    signature: { team1: false, team2: false },
    times: { team1: '', team2: '' },
    baseUpdatedAt: null,
    confirmOpId: null,
  };
}

// Immutable update. team1Tokens must be an integer 0-3; anything else is rejected
// rather than silently clamped, so a caller bug shows up immediately instead of
// quietly mis-scoring a cup.
export function withCupTokens(draft, cup, team1Tokens) {
  if (!Number.isInteger(team1Tokens) || team1Tokens < 0 || team1Tokens > TOKENS_PER_CUP) {
    throw new RangeError(`withCupTokens: team1Tokens must be 0-${TOKENS_PER_CUP}`);
  }
  return { ...draft, votes: { ...draft.votes, [cup]: team1Tokens } };
}

// Only a cup inside the round counts — matches the SQL view's own filter, so the
// two can never disagree about a stray value (e.g. left over from a round change).
function validCupEntries(draft, round) {
  const cups = cupsForRound(round);
  return Object.entries(draft.votes)
    .map(([cup, team1Tokens]) => [Number(cup), team1Tokens])
    .filter(([cup]) => cup >= 1 && cup <= cups);
}

// { team1, team2 } for one cup, or null if that cup has not been scored yet.
export function cupTokens(draft, cup, round) {
  const team1 = draft.votes[cup];
  if (team1 == null || cup < 1 || cup > cupsForRound(round)) return null;
  return { team1, team2: TOKENS_PER_CUP - team1 };
}

export function missingCupCount(draft, round) {
  return cupsForRound(round) - validCupEntries(draft, round).length;
}

export function isMatchComplete(draft, judgeCount, round) {
  return judgeCount === JUDGES_PER_MATCH && missingCupCount(draft, round) === 0;
}

// The first cup (in order) with no score yet, or null once every cup has one.
export function firstMissingCup(draft, round) {
  const scored = new Set(validCupEntries(draft, round).map(([cup]) => cup));
  for (let cup = 1; cup <= cupsForRound(round); cup += 1) {
    if (!scored.has(cup)) return cup;
  }
  return null;
}

// One team's total, mirroring one half of the btc_match_scores view: cup tokens,
// +5 if strictly more tokens than the opponent (a tie awards nobody), +2 fastest, and
// +2 signature beverage outside the preliminary round.
function teamTotal(own, opponent, isFastest, hasSignature, knockout) {
  return own + (own > opponent ? 5 : 0) + (isFastest ? 2 : 0) + (knockout && hasSignature ? 2 : 0);
}

// PREVIEW of btc_match_scores (see the header).
export function computeScores(draft, round) {
  const entries = validCupEntries(draft, round);
  const team1Tokens = entries.reduce((sum, [, team1]) => sum + team1, 0);
  const team2Tokens = entries.reduce((sum, [, team1]) => sum + (TOKENS_PER_CUP - team1), 0);
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

// The one place a confirm_btc_match payload is built. An unscored cup is OMITTED,
// never sent as some placeholder value: an incomplete payload is then simply short on
// cups, which the RPC's own strict-confirm count rejects with its friendly message,
// instead of tripping a raw constraint error.
export function buildConfirmParams(match, draft, round) {
  const knockout = round !== 'preliminary';
  return {
    p_votes: validCupEntries(draft, round).map(([cup, team1Tokens]) => ({
      cup_number: cup,
      team1_tokens: team1Tokens,
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
  for (const row of votes) draft = withCupTokens(draft, row.cup_number, row.team1_tokens);
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
  /^\d+ of \d+ cups are missing a score$/,
  /^cup numbers must be between \d+ and \d+ for a \w+ match$/,
  /^each cup's tokens must be between 0 and 3$/,
  /^the signature-beverage bonus does not apply in the preliminary round$/,
  /^match not found$/,
  /^match must have exactly \d+ judges \(has \d+\)$/,
];

// P0002 is the optimistic-concurrency conflict; P0001 is one of this RPC's own validation
// messages (or a trigger's, which gets the generic sentence below instead — the curated
// list can only ever match the RPC's own wording). Returns null for anything else so the
// caller falls through to core/errors' generic describeError.
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
