// Event setup (handoff §14 T4.1): the stage plan (kind, ordinal, set count,
// duration, cutoff) and the sets each stage runs. Roster registration itself
// is core/registry's registerEntry — nothing Cup-Taster-specific about
// registering a person and entering them into an event, so it lives there,
// reusable by a future identity-core format.
//
// Stage/set creation is idempotent by construction (check-then-create, same
// shape as registerPerson): setup happens ahead of the event, not under the
// live-heat time pressure §9's outbox model exists for, so a plain retryable
// compose is the right amount of ceremony here, not a new RPC.
import { getSupabase } from '../../core/supabaseClient.js';

const STAGE_KINDS = ['prelims', 'semis', 'finals'];

// §7.5: only two configurations are real. Checked as whole sequences (not
// just per-stage kind validity) so a plan can't reorder them — e.g. `finals`
// running before `prelims`, or `semis` with no `prelims` feeding it — which
// would otherwise pass every per-stage check individually while producing an
// event where the stage named "finals" isn't actually the terminal one.
const VALID_KIND_SEQUENCES = [
  ['prelims', 'finals'],
  ['prelims', 'semis', 'finals'],
];

// Pure — no I/O. Validates a whole stage plan before anything is persisted:
// ordinals sequential from 1 (how §7.5 says stage order is expressed), kind
// sequence matches one of the two real configurations, and the terminal
// stage (highest ordinal) is the one place `cutoff` must be null — every
// stage before it needs a real cutoff, since that's what a border tie (§7.2)
// resolves against. Cutoff must also be non-increasing stage over stage — a
// later stage can't advance more cuppers than the previous stage sent
// forward, or `core/advancement` would silently treat the oversized cutoff
// as "everyone advances" instead of trimming the field.
export function validateStagePlan(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('stage plan must contain at least one stage');
  }

  const sorted = [...stages].sort((a, b) => a.ordinal - b.ordinal);
  const seenKinds = new Set();

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
    if (seenKinds.has(stage.kind)) {
      throw new Error(`duplicate stage kind "${stage.kind}" — each kind may appear at most once`);
    }
    seenKinds.add(stage.kind);

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
      const previous = index > 0 ? sorted[index - 1] : null;
      if (previous && previous.cutoff != null && stage.cutoff > previous.cutoff) {
        throw new Error(
          `stage "${stage.kind}": cutoff (${stage.cutoff}) cannot exceed the previous stage's cutoff (${previous.cutoff}) — a later stage can't advance more cuppers than the previous stage sent forward`,
        );
      }
    }
  });

  const kinds = sorted.map((stage) => stage.kind);
  const matchesAValidSequence = VALID_KIND_SEQUENCES.some(
    (sequence) =>
      sequence.length === kinds.length && sequence.every((kind, i) => kind === kinds[i]),
  );
  if (!matchesAValidSequence) {
    throw new Error(
      `stage plan must be exactly ["prelims","finals"] or ["prelims","semis","finals"] in that order, got [${kinds.join(', ')}]`,
    );
  }

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

const UNIQUE_VIOLATION = '23505';

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
