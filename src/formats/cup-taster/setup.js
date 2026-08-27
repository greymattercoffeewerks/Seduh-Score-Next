// Event setup (handoff §14 T4.1): the stage plan (kind, ordinal, set count,
// duration, cutoff) and the sets each stage runs. Roster registration itself
// is core/registry's registerEntry — nothing Cup-Taster-specific about
// registering a person and entering them into an event, so it lives there,
// reusable by a future identity-core format.
//
// Stage/set creation is idempotent by construction (check-then-create, same
// shape as registerPerson): setup happens ahead of the event, not under the
// live-heat time pressure §9's outbox model exists for, so a plain retryable
// compose is the right amount of ceremony here, not a new RPC. `saveStagePlan`
// extends that same setup-time-ceremony reasoning to edit/reorder/remove: an
// organiser reworking a plan before the event starts is still plain retryable
// composition, not a live write needing an RPC's atomicity. The one thing it
// guards — never rewriting a stage that already has real event data (heats)
// hanging off it — is checked for every touched stage BEFORE any write, but
// that check-then-write sequence is a series of separate round trips, not a
// transaction: it is not atomic against a heat being created for one of the
// touched stages in the gap between its check and its write. Accepted here
// under the same single-organiser, pre-event assumption the rest of this
// module already leans on (handoff §9) — a real concurrent-write scenario
// would need an RPC to close, not a stronger client-side check.
import { getSupabase } from '../../core/supabaseClient.js';

export const STAGE_KINDS = ['prelims', 'semis', 'finals'];

// A future format's setup screen needing more than a linear
// prelims→semis→finals progression is exactly why this is a rank, not a
// fixed two-sequence allowlist: any number of stages of any of these kinds
// is a real plan now (repeated prelims heats, prelims straight to finals, a
// plan with no prelims at all), as long as no stage's kind ever ranks lower
// than the one before it — a stage kind can never regress once the plan has
// moved on to a later kind.
const STAGE_KIND_RANK = Object.fromEntries(STAGE_KINDS.map((kind, index) => [kind, index]));

// Pure — no I/O. Validates a whole stage plan before anything is persisted:
// ordinals sequential from 1 (how §7.5 says stage order is expressed), kind
// order never regresses (prelims-type stages before semis before finals —
// duplicates of the same kind, or skipping a kind entirely, are both real
// plans; only running an earlier kind AFTER a later one is invalid), and the
// terminal stage (highest ordinal) is the one place `cutoff` must be null —
// every stage before it needs a real cutoff, since that's what a border tie
// (§7.2) resolves against. Cutoff must also be non-increasing stage over
// stage — a later stage can't advance more cuppers than the previous stage
// sent forward, or `core/advancement` would silently treat the oversized
// cutoff as "everyone advances" instead of trimming the field.
export function validateStagePlan(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('stage plan must contain at least one stage');
  }

  // Two entries carrying the same existing-row id is never a legitimate
  // plan — saveStagePlan's diff (existingById.get(stage.id)) can only ever
  // resolve one of them to a real row, so a duplicate silently loses
  // whichever entry updates first and corrupts the ordinal sequence
  // (found in review: reproduced against a real diff run, ending with two
  // stages sharing one row and no stage left at ordinal 1). Caught here,
  // pure and up front, rather than left for the diff to discover.
  const ids = stages.filter((stage) => stage.id != null).map((stage) => stage.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('stage plan contains the same stage id more than once');
  }

  const sorted = [...stages].sort((a, b) => a.ordinal - b.ordinal);
  let previousRank = -Infinity;

  sorted.forEach((stage, index) => {
    const expectedOrdinal = index + 1;
    if (stage.ordinal !== expectedOrdinal) {
      throw new Error(
        `stage ordinals must be sequential starting at 1 with no gaps (expected ${expectedOrdinal}, got ${stage.ordinal})`,
      );
    }

    if (!STAGE_KINDS.includes(stage.kind)) {
      throw new Error(`stage kind must be one of ${STAGE_KINDS.join(', ')}, got "${stage.kind}"`);
    }
    const rank = STAGE_KIND_RANK[stage.kind];
    if (rank < previousRank) {
      throw new Error(
        `stage "${stage.kind}" at ordinal ${stage.ordinal} runs after a later-kind stage — ` +
          `stage kinds must run in order (prelims-type stages, then semis, then finals); ` +
          `${STAGE_KINDS.join(' → ')} may repeat or be skipped, but never regress`,
      );
    }
    previousRank = rank;

    if (!Number.isInteger(stage.setCount) || stage.setCount < 1) {
      throw new Error(`stage "${stage.kind}": setCount must be a positive integer`);
    }
    if (!Number.isInteger(stage.durationSecs) || stage.durationSecs <= 0) {
      throw new Error(`stage "${stage.kind}": durationSecs must be a positive integer`);
    }

    const isTerminal = index === sorted.length - 1;
    if (isTerminal) {
      if (stage.cutoff != null) {
        throw new Error(
          `stage "${stage.kind}" is the terminal stage — cutoff must be null, nobody advances past it`,
        );
      }
    } else {
      if (!Number.isInteger(stage.cutoff) || stage.cutoff < 1) {
        throw new Error(
          `stage "${stage.kind}": non-terminal stages require a positive integer cutoff`,
        );
      }
      // `previous` is always non-terminal here (only the last element of
      // `sorted` is ever terminal, and this branch only runs for index <
      // sorted.length - 1), so its own cutoff was already validated as a
      // positive integer by this same forEach on an earlier iteration —
      // never null by the time it's read back here.
      const previous = index > 0 ? sorted[index - 1] : null;
      if (previous && stage.cutoff > previous.cutoff) {
        throw new Error(
          `stage "${stage.kind}": cutoff (${stage.cutoff}) cannot exceed the previous stage's cutoff (${previous.cutoff}) — a later stage can't advance more cuppers than the previous stage sent forward`,
        );
      }
    }
  });

  return sorted;
}

export async function findStageByOrdinal(eventId, ordinal, client = getSupabase()) {
  const { data, error } = await client
    .from('ct_stages')
    .select('*')
    .eq('event_id', eventId)
    .eq('ordinal', ordinal)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findStageById(stageId, client = getSupabase()) {
  const { data, error } = await client.from('ct_stages').select('*').eq('id', stageId).single();
  if (error) throw error;
  return data;
}

// Every stage in an event, in the order they run — the shape T4.7's report
// needs to walk prelims → semis → finals, and the shape a future org-facing
// event overview would need too. Ordinal order is how §7.5 expresses stage
// sequence throughout this codebase (validateStagePlan's own ordinal check,
// heats.js's per-stage generation), so this stays consistent with every
// other stage-ordering read.
export async function listStagesForEvent(eventId, client = getSupabase()) {
  const { data, error } = await client
    .from('ct_stages')
    .select('*')
    .eq('event_id', eventId)
    .order('ordinal', { ascending: true });
  if (error) throw error;
  return data;
}

// True only when an existing row matches the incoming config exactly — the
// one case a retry may silently reuse. Anything else (a genuinely different
// cutoff/duration/set count at the same ordinal) is a config change, not a
// retry, and must not be silently discarded.
function stageMatchesConfig(existing, stage) {
  return (
    existing.kind === stage.kind &&
    existing.set_count === stage.setCount &&
    existing.duration_secs === stage.durationSecs &&
    existing.cutoff === (stage.cutoff ?? null)
  );
}

// Two genuinely different shapes (a real DB row vs. the caller's camelCase
// request) formatted separately on purpose — a single formatter reconciling
// both via `??` fallbacks would silently print `undefined` on a future
// rename of either side's field instead of failing loudly.
function describeStoredStage(row) {
  return `kind=${row.kind} setCount=${row.set_count} durationSecs=${row.duration_secs} cutoff=${row.cutoff}`;
}

function describeRequestedStage(stage) {
  return `kind=${stage.kind} setCount=${stage.setCount} durationSecs=${stage.durationSecs} cutoff=${stage.cutoff ?? null}`;
}

function throwConfigConflict(ordinal, existing, requested) {
  throw new Error(
    `stage at ordinal ${ordinal} already exists with a different configuration — ` +
      `existing: ${describeStoredStage(existing)}, requested: ${describeRequestedStage(requested)}`,
  );
}

// Postgres unique-violation — shared with heats.js's own race-recovery, same
// meaning either place: a concurrent caller won an insert between our check
// and ours.
export const UNIQUE_VIOLATION = '23505';

export async function createStage(eventId, stage, client = getSupabase()) {
  const existing = await findStageByOrdinal(eventId, stage.ordinal, client);
  if (existing) {
    if (!stageMatchesConfig(existing, stage)) throwConfigConflict(stage.ordinal, existing, stage);
    return existing;
  }

  const { data, error } = await client
    .from('ct_stages')
    .insert({
      event_id: eventId,
      kind: stage.kind,
      ordinal: stage.ordinal,
      set_count: stage.setCount,
      duration_secs: stage.durationSecs,
      cutoff: stage.cutoff ?? null,
    })
    .select()
    .single();
  if (error) {
    // Lost a race to a concurrent caller inserting the same (event_id,
    // ordinal) between our check and our insert — the same outcome
    // findStageByOrdinal would have reported had it run a moment later, so
    // resolve it the same way: adopt the winner if it matches, else surface
    // the same config-conflict error a sequential retry would have gotten.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findStageByOrdinal(eventId, stage.ordinal, client);
      if (raced) {
        if (!stageMatchesConfig(raced, stage)) throwConfigConflict(stage.ordinal, raced, stage);
        return raced;
      }
    }
    throw error;
  }
  return data;
}

export async function listSetPositions(stageId, client = getSupabase()) {
  const { data, error } = await client.from('ct_sets').select('position').eq('stage_id', stageId);
  if (error) throw error;
  return data.map((row) => row.position);
}

// Full rows (id, position, label), ordered — the scoring surface (T4.5)
// needs `id` to key results by `set_id`, which `listSetPositions` above
// (built for T4.1's own missing-position check) never needed.
export async function listSetsForStage(stageId, client = getSupabase()) {
  const { data, error } = await client
    .from('ct_sets')
    .select('*')
    .eq('stage_id', stageId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data;
}

async function computeMissingPositions(stageId, setCount, client) {
  const existingPositions = new Set(await listSetPositions(stageId, client));
  const missing = [];
  for (let position = 1; position <= setCount; position += 1) {
    if (!existingPositions.has(position)) missing.push({ stage_id: stageId, position });
  }
  return missing;
}

const MAX_INSERT_ATTEMPTS = 3;

// Idempotent: only inserts positions missing from what's already there, so a
// retry after a partial failure heals to the full set instead of erroring on
// (stage_id, position)'s unique index or double-creating sets. A concurrent
// caller can still win positions between our read and our insert — on a
// unique-violation, recompute what's still actually missing and retry, up to
// a small bounded number of attempts. Setup-time racing this many levels
// deep isn't a real scenario, but a bounded retry that eventually throws a
// clear "gave up" error beats an unbounded loop that could in principle spin
// forever, or a single retry that surfaces a raw constraint error on the
// second collision instead of the first.
export async function ensureSetsForStage(stageId, setCount, client = getSupabase()) {
  let missing = await computeMissingPositions(stageId, setCount, client);

  for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt += 1) {
    if (missing.length === 0) return [];

    const { data, error } = await client.from('ct_sets').insert(missing).select();
    if (!error) return data;
    if (error.code !== UNIQUE_VIOLATION) throw error;

    missing = await computeMissingPositions(stageId, setCount, client);
  }

  // The loop's own "already done" check only runs at the top of each
  // iteration, so the recompute after the final attempt's collision is never
  // re-checked — without this, a race that resolved in our favor on the very
  // last collision would still report "gave up" instead of the success it
  // actually reached.
  if (missing.length === 0) return [];

  throw new Error(
    `ensureSetsForStage: gave up after ${MAX_INSERT_ATTEMPTS} attempts racing concurrent inserts for stage ${stageId}`,
  );
}

// The mirror image of ensureSetsForStage's add-only healing: when an edited
// stage's setCount SHRINKS, the positions above the new count are no longer
// part of the plan and must actually go, not just stop being topped up.
// Simple per-position deletes rather than a single `.in()` filter — matches
// this file's existing plain-Postgrest style (no exotic filter operators
// used anywhere else here) and keeps the fake-client test doubles simple.
async function deleteSetsAbovePosition(stageId, setCount, client) {
  const toDelete = (await listSetPositions(stageId, client)).filter(
    (position) => position > setCount,
  );
  for (const position of toDelete) {
    const { error } = await client
      .from('ct_sets')
      .delete()
      .eq('stage_id', stageId)
      .eq('position', position);
    if (error) throw error;
  }
}

export async function createStagePlan(eventId, stages, client = getSupabase()) {
  const validated = validateStagePlan(stages);
  const created = [];
  for (const stageConfig of validated) {
    const stage = await createStage(eventId, stageConfig, client);
    const sets = await ensureSetsForStage(stage.id, stageConfig.setCount, client);
    created.push({ stage, sets });
  }
  return created;
}

// True once a stage has any heat at all — the point past which its plan
// (kind/ordinal/set_count/duration_secs/cutoff) is no longer safely
// editable. A heat snapshots duration_secs at creation and stations/results
// key off the stage's sets, so rewriting the stage out from under it would
// silently strand or mis-time real event data; results themselves (ct_results)
// can only exist once a heat does, so checking for heats alone already
// covers "or results" without a second query.
export async function stageHasHeats(stageId, client = getSupabase()) {
  const { data, error } = await client.from('ct_heats').select('id').eq('stage_id', stageId);
  if (error) throw error;
  return data.length > 0;
}

async function updateStageRow(stageId, patch, client) {
  const { error } = await client.from('ct_stages').update(patch).eq('id', stageId);
  if (error) throw error;
}

async function deleteStageRow(stageId, client) {
  const { error } = await client.from('ct_stages').delete().eq('id', stageId);
  if (error) throw error;
}

// Reconciles a whole desired stage plan against whatever's already
// persisted for the event, letting the setup screen support an arbitrary
// add/remove/reorder chain across repeated saves rather than only ever
// appending. `stages` mixes untouched/edited stages (carrying the `id` of
// the row they correspond to) with brand-new ones (no `id`). Refuse-then-
// explain, not partially apply: if the plan would touch (edit, reorder, or
// remove) any stage that already has heats — real event data hanging off
// its ordinal/kind/set_count/duration_secs/cutoff — the WHOLE save is
// rejected before anything is written, naming the specific stage that
// blocked it, rather than a raw constraint error surfacing partway through.
export async function saveStagePlan(eventId, stages, client = getSupabase()) {
  const validated = validateStagePlan(stages);
  const existing = await listStagesForEvent(eventId, client);
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const keepIds = new Set(validated.filter((stage) => stage.id).map((stage) => stage.id));

  const removed = existing.filter((row) => !keepIds.has(row.id));
  const changed = [];
  const created = [];

  for (const stage of validated) {
    if (!stage.id) {
      created.push(stage);
      continue;
    }
    const row = existingById.get(stage.id);
    if (!row) {
      throw new Error(
        `stage ${stage.id} was not found on this event — it may already have been removed`,
      );
    }
    if (!(stageMatchesConfig(row, stage) && row.ordinal === stage.ordinal)) {
      changed.push({ stage, row });
    }
  }

  const touched = [...removed, ...changed.map(({ row }) => row)];
  for (const row of touched) {
    if (await stageHasHeats(row.id, client)) {
      throw new Error(
        `stage "${row.kind}" (currently ordinal ${row.ordinal}) already has heats generated — ` +
          `its plan is locked and can't be edited, reordered, or removed from this screen`,
      );
    }
  }

  // Every changed row first moves to a guaranteed-unused negative ordinal,
  // THEN to its real final ordinal — otherwise an ordinary sequential update
  // could try to write a target ordinal another row (not yet moved off it)
  // is still occupying, tripping the (event_id, ordinal) unique index even
  // though the finished plan itself has no collisions. Tracked in a local
  // Map keyed by id, not a scratch property bolted onto the fetched row
  // object — `row` came straight out of a DB read and callers may hold
  // their own reference to it; a `.tempOrdinal` mutation would leak this
  // function's own bookkeeping onto data that isn't this function's to
  // annotate.
  const tempOrdinals = new Map(changed.map(({ row }, index) => [row.id, -(index + 1)]));
  for (const { row } of changed) {
    await updateStageRow(row.id, { ordinal: tempOrdinals.get(row.id) }, client);
  }

  for (const row of removed) {
    await deleteStageRow(row.id, client);
  }

  for (const { stage } of changed) {
    await updateStageRow(
      stage.id,
      {
        kind: stage.kind,
        ordinal: stage.ordinal,
        set_count: stage.setCount,
        duration_secs: stage.durationSecs,
        cutoff: stage.cutoff ?? null,
      },
      client,
    );
    await ensureSetsForStage(stage.id, stage.setCount, client);
    // ensureSetsForStage only ever ADDS missing positions — a setCount
    // that shrank needs the positions above the new count actually
    // removed, or a future listSetsForStage read (scoring, T4.5) would
    // still see the stale, now-out-of-plan sets.
    await deleteSetsAbovePosition(stage.id, stage.setCount, client);
  }

  for (const stage of created) {
    const row = await createStage(eventId, stage, client);
    await ensureSetsForStage(row.id, stage.setCount, client);
  }

  return listStagesForEvent(eventId, client);
}
