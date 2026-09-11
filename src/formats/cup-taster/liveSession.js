// Live-session payload assembly + automatic publish triggers (handoff §8.1,
// §8.2, D7, D23). core/publish.js built the write mechanism (T5.1) and
// core/viewer-shell.js + viewerBody.js built the read side (T5.2-T5.4), but
// nothing ever called publishSession() from a real screen — an organiser
// running a live event saw "Waiting for the organiser" the whole time,
// because publishing was a step nobody remembered to add, exactly the
// failure the legacy Throwdown app already had (user-reported, 2026-09-04).
// This module closes that gap automatically, not with a "Go Live" button an
// organiser can still forget: buildLiveSessionPayload() assembles
// viewerBody.js's own documented payload contract fresh from current DB
// state, and publishLiveSession() is called from timingScreen.js right
// after a heat starts (§8.2: "publish started_at + duration_secs once at
// heat start") and from scoringScreen.js right after a heat is confirmed
// (§8.1/D23: "one publish per heat, on close") — the exact two moments the
// frozen spec already names, no new trigger invented beyond them.
//
// Deliberately NOT wired into timingManualScreen.js's own entry flow — a
// manual heat has no started_at/clock to publish early (§8.2's "no-clock"
// state is a RENDERING contract viewerBody.js's isNoClockHeat already
// satisfies, not a reason for this module to invent an extra trigger); a
// manual heat surfaces once confirmed, same as any other heat's
// results-on-close publish. Known, deliberate scope boundary: a manual heat
// mid-entry won't show as "in progress" on the audience view, only once
// confirmed — see ROADMAP.md.
//
// `standings` rows' `tieStatus` (2026-09-11, closing the ROADMAP-tracked
// product decision) — computed via standings.js's OWN `resolveAdvancement`
// plus its shared `tieStatusFor` (also used by standingsScreen.js, so the
// two never hand-drift), applied to the identical `ranked` list this
// function already fetched for the standings rows themselves, so this is
// zero new DB reads, not a new rule: the audience payload now shows exactly
// the same "who's advancing, who's tied at the border" grouping the
// organiser's own Standings screen already computes and displays. The
// computation is SKIPPED once `stage.status === 'complete'` (every row gets
// `tieStatus: null` instead) — matches this codebase's own established
// convention (`standingsScreen.js`'s own primary table keeps showing "tied"
// right up through a confirmed tiebreak heat, only clearing once the
// organiser actually commits; see that screen's module comment) rather than
// inventing a different cutover point for this second consumer. A tiebreak
// heat's own result never changes `ct_standings` (tiebreak heats are
// deliberately excluded from it — see standings.js), so without this gate
// `tieStatus` would keep reporting "tied" on two cuppers whose tie was
// already broken but not yet committed — same known, accepted
// characteristic the organiser's own screen already has, not a new one
// introduced here.
//
// Deliberately does NOT reuse core/publish.js's publishSession() —
// found in review (offline-sync-auditor): that function's contract assumes
// the caller already HAS its payload before enqueueing (true for every
// other outbox write in this app — start_heat/confirm_heat build their RPC
// payload from data the calling screen already loaded), but this module's
// payload can only be assembled via ~15-20 sequential DB reads
// (buildLiveSessionPayload below). Awaiting those reads BEFORE enqueueing
// (the original version of this module did exactly that) meant an offline
// device never even reached enqueueOperation() — the very first read
// throws, so nothing is ever persisted to IndexedDB for the outbox to
// retry, silently dropping the publish instead of queuing it (the one
// outcome §9's offline model exists to prevent). The fix: enqueue a small,
// already-known `publish_live_session` intent FIRST (orgId/eventId/
// stageId/isTest — nothing here needs a network read), and let
// publishLiveSessionHandlers' own handler perform the real reads + RPC call
// at ACTUAL FLUSH time instead. This also means a publish enqueued right
// behind an still-un-flushed start_heat/confirm_heat naturally waits its
// turn (flushOutbox's own FIFO-halt-on-failure discipline) and drains
// automatically once main.js's existing reconnect-triggered flush succeeds
// — no new reconnect wiring needed, since that flush already passes
// cupTasterOutboxHandlers(client), which now includes this operation type.
import { listHeatsForStage, hydrateEntries } from './heats.js';
import { fetchStandingsForStage, resolveAdvancement, tieStatusFor } from './standings.js';
import { listEntriesByIds } from '../../core/registry.js';
import { enqueueOperation, flushOutbox } from '../../core/outbox.js';
import { getSupabase } from '../../core/supabaseClient.js';

const RECENT_HEATS_LIMIT = 3;

function toStandingsRow({ item, position }, tieGroups) {
  return {
    position,
    displayName: item.displayName,
    numCorrect: item.numCorrect,
    totalElapsedSecs: item.total_elapsed_secs,
    tieStatus: tieGroups ? tieStatusFor(item, tieGroups) : null,
  };
}

async function hydrateHeatEntries(entries, client) {
  const roster = await listEntriesByIds(
    entries.map((entry) => entry.entry_id),
    client,
  );
  return hydrateEntries(entries, roster);
}

// One extra query per confirmed heat surfaced in recentHeats — heat-level
// correct counts aren't in ct_standings (a per-STAGE aggregate), so this
// mirrors standings.js's own fetchTiebreakHeatOutcome (same ct_results
// query/tally shape, applied to any confirmed heat, not just a tiebreak
// one).
async function fetchHeatResults(hydratedEntries, client) {
  const heatEntryIds = hydratedEntries.map((entry) => entry.id);
  const { data: results, error } =
    heatEntryIds.length === 0
      ? { data: [], error: null }
      : await client.from('ct_results').select('*').in('heat_entry_id', heatEntryIds);
  if (error) throw error;

  const correctByHeatEntryId = new Map();
  for (const result of results) {
    if (!result.correct) continue;
    correctByHeatEntryId.set(
      result.heat_entry_id,
      (correctByHeatEntryId.get(result.heat_entry_id) ?? 0) + 1,
    );
  }

  return hydratedEntries.map((entry) => ({
    displayName: entry.displayName,
    numCorrect: correctByHeatEntryId.get(entry.id) ?? 0,
    totalElapsedSecs: entry.elapsed_secs,
  }));
}

function toActiveHeat(stage, heat, hydratedEntries) {
  return {
    heatNumber: heat.heat_number,
    stageKind: stage.kind,
    status: heat.status,
    timingMode: heat.timing_mode,
    startedAt: heat.started_at,
    durationSecs: heat.duration_secs,
    cuppers: hydratedEntries.map((entry) => ({
      displayName: entry.displayName,
      station: entry.station,
      totalElapsedSecs: entry.elapsed_secs,
      maxed: entry.maxed,
    })),
  };
}

// DB. Fresh state, not carried forward from whichever action triggered the
// publish — both call sites below just ask "what does this stage look like
// right now," rather than each hand-rolling its own partial payload. One
// query per heat in the stage (listHeatsForStage) plus one more per
// timing/scoring or confirmed heat actually surfaced (roster + results) —
// matches this codebase's own established N+1-is-fine-for-a-low-frequency
// organiser action precedent (heats.js's own listHeatsForStage comment);
// this only runs twice per heat, not on every tap. Uses
// fetchStandingsForStage's OWN `stage` result rather than a second,
// redundant findStageById call — found in review (code-reviewer): the
// original version fetched the identical row twice.
export async function buildLiveSessionPayload(stageId, client = getSupabase()) {
  const { stage, ranked } = await fetchStandingsForStage(stageId, client);
  // See this module's own top comment for why this is gated on stage status
  // and why it's safe to compute from `ranked` alone (already fetched above,
  // no new DB read) — mirrors standingsScreen.js's own advancingIds/
  // tiedBorderIds construction exactly.
  let tieGroups = null;
  if (stage.status !== 'complete') {
    const { advancing, tiedAtBorder } = resolveAdvancement(ranked, stage.cutoff ?? 1);
    tieGroups = {
      advancingIds: new Set(advancing.map(({ item }) => item.stageEntryId)),
      tiedBorderIds: new Set(tiedAtBorder.map(({ item }) => item.stageEntryId)),
    };
  }
  const standings = ranked.map((row) => toStandingsRow(row, tieGroups));

  const heatsWithEntries = await listHeatsForStage(stageId, client);

  // Singular by contract (viewerBody.js's `activeHeat` is `null | {...}`,
  // never an array) even though multiple heats can in principle be timing
  // in parallel across different stations — the lowest heat number running
  // is the one featured, a deliberate, documented simplification rather
  // than an attempt to represent every concurrent heat at once.
  const running = heatsWithEntries
    .filter(({ heat }) => heat.status === 'timing' || heat.status === 'scoring')
    .sort((a, b) => a.heat.heat_number - b.heat.heat_number)[0];
  let activeHeat = null;
  if (running) {
    const hydrated = await hydrateHeatEntries(running.entries, client);
    activeHeat = toActiveHeat(stage, running.heat, hydrated);
  }

  const confirmed = heatsWithEntries
    .filter(({ heat }) => heat.status === 'confirmed')
    .sort((a, b) => b.heat.heat_number - a.heat.heat_number)
    .slice(0, RECENT_HEATS_LIMIT);
  const recentHeats = [];
  for (const { heat, entries } of confirmed) {
    const hydrated = await hydrateHeatEntries(entries, client);
    const results = await fetchHeatResults(hydrated, client);
    recentHeats.push({ heatNumber: heat.heat_number, stageKind: stage.kind, results });
  }

  // The tournament's own champion — not a per-stage winner — is exactly
  // "the terminal stage (no cutoff) has been resolved" (standingsScreen.js's
  // own commitStageResolution sets ct_stages.status = 'complete' on commit,
  // gated on there being a single advancing entry when the stage is
  // terminal — see that function's own comment). Deliberately NOT
  // `standings.find(row => row.position === 1)` — found in review
  // (scoring-auditor): `rank()`'s own `position` comes from ct_standings'
  // correct_count/total_elapsed_secs alone, which is exactly the tally a
  // border tie shares identically between the tied cuppers (a tiebreak
  // heat's results are deliberately excluded from ct_standings — see
  // standings.js's own listStageEntries/ct_standings comment). Once a tie
  // is broken by a tiebreak heat or coin toss, BOTH tied entries still
  // report `position: 1` from rank() alone, so picking whichever one
  // happens to sort first would silently name the loser as champion on
  // exactly the dramatic contested-finals case an audience is most likely
  // watching closely. `item.finalPosition` (from `ranked`, before the
  // lossy `toStandingsRow` mapping) is the actual, DB-persisted winner
  // commitStageResolution wrote — the one field this determination must
  // use instead.
  const champion =
    stage.cutoff == null && stage.status === 'complete'
      ? (ranked.find(({ item }) => item.finalPosition === 1)?.item.displayName ?? null)
      : null;

  return {
    stage: { kind: stage.kind, ordinal: stage.ordinal, setCount: stage.set_count },
    standings,
    activeHeat,
    recentHeats,
    champion,
  };
}

// The `publish_live_session` outbox handler — unlike core/outbox.js's
// generic buildRpcHandler (payload IS the RPC call, fixed at enqueue time),
// this handler's stored payload is only the small INTENT
// (orgId/eventId/stageId/isTest); the real, current-as-of-right-now
// `live_sessions` payload is built here, at actual flush time, by calling
// buildLiveSessionPayload fresh — see this module's own top comment for why.
// Mirrors buildRpcHandler's own error-to-permanent mapping (status: 0 means
// a network failure, retry later; any real HTTP status means a genuine
// server rejection, won't succeed on retry) since it can't reuse that
// generic wrapper directly — the stored payload here isn't the RPC payload
// yet when the handler is invoked.
export function publishLiveSessionHandlers(client) {
  return {
    publish_live_session: async ({ orgId, eventId, stageId, format, isTest }) => {
      const payload = await buildLiveSessionPayload(stageId, client);
      const { error, status } = await client.rpc('publish_session', {
        p_operation_id: crypto.randomUUID(),
        p_org_id: orgId,
        p_event_id: eventId,
        p_format: format,
        p_is_test: isTest,
        p_payload: payload,
      });
      if (error) {
        const err = new Error(error.message);
        err.code = error.code;
        err.details = error.details;
        err.permanent = Boolean(status);
        throw err;
      }
    },
  };
}

// The automatic trigger itself. Enqueues the intent FIRST — a pure local
// IndexedDB write that can't fail just because the device is offline — then
// attempts a flush; if that flush can't complete right now (offline, or the
// read chain inside the handler above fails), the operation stays queued
// exactly like any other tracked write, and drains on the next flush
// (another screen action, or main.js's existing reconnect-triggered flush).
// `isTest` is threaded straight through from the caller's already-loaded
// event (D9 propagation), never re-derived here.
//
// `handlers`, when passed, REPLACES publishLiveSessionHandlers(client) alone
// — same optional cross-module-composition override timing.js's
// startHeat/scoring.js's submitConfirmHeat take (see their own comments).
// Deliberately NOT defaulting to a cupTasterOutboxHandlers(client) import
// here: outboxHandlers.js itself composes THIS module's own
// publishLiveSessionHandlers into its map, so importing outboxHandlers.js
// back from here would cycle. Every real call site (timingScreen.js,
// scoringScreen.js) already passes the composed map explicitly, exactly as
// they already do for startHeat/submitConfirmHeat.
export async function publishLiveSession(
  { orgId, eventId, stageId, isTest },
  client = getSupabase(),
  handlers,
) {
  if (typeof isTest !== 'boolean') {
    throw new TypeError('publishLiveSession: isTest must be explicitly true or false');
  }
  await enqueueOperation('publish_live_session', {
    orgId,
    eventId,
    stageId,
    format: 'cup_taster',
    isTest,
  });
  return flushOutbox(handlers ?? publishLiveSessionHandlers(client));
}
