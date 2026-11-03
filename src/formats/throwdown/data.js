// Throwdown's data layer: reads the event's rows, and writes through the database's functions (the tables are
// SELECT-only for the API, see migration 20261103110000). Reads are plain selects the organiser's RLS already allows.
//
// Writes that must survive a bad connection (a judge's tap, an undo, confirm, walkover, the draw) go through the
// shared outbox: enqueued first with a client-made operation id (the database records it, so a replay does
// nothing), then flushed. Setup is a one-shot like BTC's team setup and is called directly.
import { getSupabase } from '../../core/supabaseClient.js';
import {
  buildRpcHandler,
  enqueueOperation,
  flushOutbox,
  listAllOperations,
} from '../../core/outbox.js';
import { deriveBracket } from './bracket.js';

export const TD_OPERATIONS = Object.freeze({
  start: 'td_start_event',
  vote: 'td_cast_vote',
  undo: 'td_undo_vote',
  confirm: 'td_confirm_match',
  walkover: 'td_record_walkover',
});

// A plain select returns at most the API's row limit (1000 here), which a large event's vote rows can pass: a
// silently shortened vote list would make a derived winner differ from the database's. Read in pages, in a stable order.
const PAGE = 500;
async function readAll(client, table, columns, eventId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq('event_id', eventId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Everything one screen or one live payload needs, read together.
export async function loadThrowdown(eventId, client = getSupabase()) {
  const [settings, draw, rounds, matches, slots, votes, entries] = await Promise.all([
    client.from('td_settings').select('*').eq('event_id', eventId).maybeSingle(),
    client.from('td_draws').select('*').eq('event_id', eventId).maybeSingle(),
    readAll(client, 'td_rounds', 'id, position, kind, phase', eventId),
    readAll(
      client,
      'td_matches',
      'id, round_id, position, result_kind, confirmed_at, walkover_winner_position',
      eventId,
    ),
    readAll(client, 'td_slots', 'id, match_id, position, entry_id', eventId),
    readAll(client, 'td_votes', 'id, match_id, slot_id, created_at', eventId),
    readAll(client, 'event_entries', 'id, display_name, cafe, withdrawn, created_at', eventId),
  ]);
  if (settings.error) throw settings.error;
  if (draw.error) throw draw.error;
  const rows = { rounds, matches, slots, votes, entries };
  return {
    settings: settings.data ?? {
      judge_count: 3,
      third_place: true,
      seeding_mode: 'random',
      modules: {},
    },
    settingsSaved: Boolean(settings.data),
    draw: draw.data,
    ...rows,
    bracket: deriveBracket(rows),
  };
}

export async function saveSettings(orgId, eventId, settings, client = getSupabase()) {
  const { error } = await client.rpc('td_save_settings', {
    p_org_id: orgId,
    p_event_id: eventId,
    p_judge_count: settings.judgeCount,
    p_third_place: settings.thirdPlace,
    p_seeding_mode: settings.seedingMode,
    p_modules: settings.modules ?? {},
  });
  if (error) throw error;
}

// Handler map for a flush; composed into the app-wide map by outboxHandlers.js.
export function dataHandlers(client) {
  return Object.fromEntries(
    Object.values(TD_OPERATIONS).map((t) => [t, buildRpcHandler(client, t)]),
  );
}

async function submit(type, payload, handlers) {
  const operationId = crypto.randomUUID();
  const operation = await enqueueOperation(type, { p_operation_id: operationId, ...payload });
  let result = await flushOutbox(handlers);
  // A flush that was already running when this operation was queued can finish without having seen it. If the
  // operation is still waiting (and the flush did not stop on a failure), take one more pass for it.
  if (!result?.stopped && (await listAllOperations()).some((op) => op.id === operation.id)) {
    result = await flushOutbox(handlers);
  }
  // the OUTBOX's id for the operation (what droppedErrorFor compares), not the database's idempotency key
  return { operationId: operation.id, result };
}

export const startEvent = ({ orgId, eventId, mode, seed, slotCount, pairs }, handlers) =>
  submit(
    TD_OPERATIONS.start,
    {
      p_org_id: orgId,
      p_event_id: eventId,
      p_mode: mode,
      p_seed: seed ?? null,
      p_slot_count: slotCount,
      p_pairs: pairs,
    },
    handlers,
  );

export const castVote = ({ orgId, matchId, slotId }, handlers) =>
  submit(TD_OPERATIONS.vote, { p_org_id: orgId, p_match_id: matchId, p_slot_id: slotId }, handlers);

export const undoVote = ({ orgId, matchId, slotId }, handlers) =>
  submit(TD_OPERATIONS.undo, { p_org_id: orgId, p_match_id: matchId, p_slot_id: slotId }, handlers);

export const confirmMatch = ({ orgId, matchId, expectedWinnerSlotId = null }, handlers) =>
  submit(
    TD_OPERATIONS.confirm,
    { p_org_id: orgId, p_match_id: matchId, p_expected_winner_slot_id: expectedWinnerSlotId },
    handlers,
  );

export const recordWalkover = ({ orgId, matchId, winnerSlotId }, handlers) =>
  submit(
    TD_OPERATIONS.walkover,
    { p_org_id: orgId, p_match_id: matchId, p_winner_slot_id: winnerSlotId },
    handlers,
  );

// What is still waiting in the outbox, as the screen needs it: per match the change to the displayed vote counts (+1
// per queued tap for a slot, -1 per queued undo) and whether a decision (confirm or walkover) is queued, and whether a
// draw is queued. The screen shows server counts plus these, so a tap made offline is visible at once. `signature`
// lets a reader tell that the queue changed while it was reading the server (see eventScreen.js refresh).
export async function pendingSnapshot() {
  const ops = await listAllOperations();
  const matches = new Map();
  const forMatch = (id) => {
    if (!matches.has(id)) matches.set(id, { deltas: new Map(), queued: 0, decisionQueued: false });
    return matches.get(id);
  };
  let startQueued = false;
  for (const op of ops) {
    const payload = op.payload ?? {};
    if (op.type === TD_OPERATIONS.start) startQueued = true;
    else if (op.type === TD_OPERATIONS.vote || op.type === TD_OPERATIONS.undo) {
      const m = forMatch(payload.p_match_id);
      const step = op.type === TD_OPERATIONS.vote ? 1 : -1;
      m.deltas.set(payload.p_slot_id, (m.deltas.get(payload.p_slot_id) ?? 0) + step);
      m.queued += 1;
    } else if (op.type === TD_OPERATIONS.confirm || op.type === TD_OPERATIONS.walkover) {
      forMatch(payload.p_match_id).decisionQueued = true;
    }
  }
  return { matches, startQueued, signature: ops.map((o) => o.id).join(',') };
}

// One match's share of the snapshot.
export async function pendingVoteDeltas(matchId) {
  const { matches } = await pendingSnapshot();
  return matches.get(matchId) ?? { deltas: new Map(), queued: 0, decisionQueued: false };
}
