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

async function readAll(client, table, columns, eventId) {
  const { data, error } = await client.from(table).select(columns).eq('event_id', eventId);
  if (error) throw error;
  return data;
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
  await enqueueOperation(type, { p_operation_id: operationId, ...payload });
  const result = await flushOutbox(handlers);
  return { operationId, result };
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

export const confirmMatch = ({ orgId, matchId }, handlers) =>
  submit(TD_OPERATIONS.confirm, { p_org_id: orgId, p_match_id: matchId }, handlers);

export const recordWalkover = ({ orgId, matchId, winnerSlotId }, handlers) =>
  submit(
    TD_OPERATIONS.walkover,
    { p_org_id: orgId, p_match_id: matchId, p_winner_slot_id: winnerSlotId },
    handlers,
  );

// Taps still waiting in the outbox for a match, as a change to the displayed counts: +1 per queued vote for a slot,
// -1 per queued undo. The screen shows server counts plus this, so a tap made offline is visible at once and a
// replay that has not landed yet is not double counted (the server count only moves when the operation lands, and
// a landed operation is removed from the queue).
export async function pendingVoteDeltas(matchId) {
  const ops = await listAllOperations();
  const deltas = new Map();
  let queued = 0;
  for (const op of ops) {
    if (op.payload?.p_match_id !== matchId) continue;
    if (op.type === TD_OPERATIONS.vote) {
      deltas.set(op.payload.p_slot_id, (deltas.get(op.payload.p_slot_id) ?? 0) + 1);
      queued += 1;
    } else if (op.type === TD_OPERATIONS.undo) {
      deltas.set(op.payload.p_slot_id, (deltas.get(op.payload.p_slot_id) ?? 0) - 1);
      queued += 1;
    }
  }
  return { deltas, queued };
}
