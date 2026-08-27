// Heat generation (handoff §14 T4.2): random + manual, both assigning
// stations (D15). A heat targets `HEAT_TARGET` cuppers and never drops below
// `HEAT_MIN` (§2) — `core/partition` already computes valid heat sizes; this
// module's own job is turning a stage's entries into concrete heats/stations
// and persisting them, idempotently, the same disciplined shape as
// setup.js's stage/set creation (config-drift detection on retry, bounded
// retry on a concurrent-insert race).
//
// Seeding the first stage's entries from the roster lives here too — no §14
// task owns it explicitly, and heat generation can't run without it. Later
// stages (semis/finals) get their `ct_stage_entries` from T4.6's advancement
// logic instead; this module only ever reads whatever entries already exist
// for a stage it didn't seed itself.
import { partition } from '../../core/partition.js';
import { listEntries } from '../../core/registry.js';
import { findStageByOrdinal, findStageById } from './setup.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { UNIQUE_VIOLATION } from '../../core/errors.js';

const HEAT_TARGET = 4;
const HEAT_MIN = 2;
const MAX_INSERT_ATTEMPTS = 3;

export async function listStageEntries(stageId, client = getSupabase()) {
  const { data, error } = await client.from('ct_stage_entries').select('*').eq('stage_id', stageId);
  if (error) throw error;
  return data;
}

// Pure — joins locally rather than a DB-side embed, so it stays trivially
// testable and independent of PostgREST's embed syntax. Entries with no
// matching roster row (shouldn't happen — entry_id is a real FK — but a
// stale/deleted row shouldn't crash the UI) fall back to a placeholder name.
// Generic over the caller's row shape — anything carrying `entry_id`
// (`ct_stage_entries` or `ct_heat_entries` rows both do), not stage-specific
// despite living in this file; `timing.js` reuses it for heat entries.
export function hydrateEntries(entries, eventEntries) {
  const byId = new Map(eventEntries.map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    const person = byId.get(entry.entry_id);
    return {
      ...entry,
      displayName: person?.display_name ?? '(unknown cupper)',
      cafe: person?.cafe ?? null,
      bib: person?.bib ?? null,
    };
  });
}

// Idempotent: only seeds a stage that has zero stage entries yet, from the
// event's non-withdrawn roster. Safe to call again after a partial failure —
// a stage that already has entries (from this call or a previous one) is
// left untouched, never re-seeded or duplicated.
export async function seedFirstStageEntries(eventId, client = getSupabase()) {
  const stage = await findStageByOrdinal(eventId, 1, client);
  if (!stage) {
    throw new Error(
      `seedFirstStageEntries: no stage at ordinal 1 for event ${eventId} — run createStagePlan first`,
    );
  }

  const existing = await listStageEntries(stage.id, client);
  if (existing.length > 0) return existing;

  const entries = await listEntries(eventId, client);
  const rows = entries
    .filter((entry) => !entry.withdrawn)
    .map((entry) => ({ stage_id: stage.id, entry_id: entry.id, source: 'seed' }));
  if (rows.length === 0) return [];

  const { data, error } = await client.from('ct_stage_entries').insert(rows).select();
  if (error) throw error;
  return data;
}

function shuffle(array, random) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function stationLabel(index) {
  return String.fromCharCode(65 + index); // 0 -> 'A', 1 -> 'B', ...
}

// Pure. `sizes` must already sum to `entries.length` (core/partition's own
// output always does; this only guards a caller passing a mismatched pair).
// Station letters are assigned within each heat independently (every heat
// has its own "Table A"), not globally across the stage.
export function buildHeatPlansFromSizes(entries, sizes, { random = Math.random } = {}) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total !== entries.length) {
    throw new Error(
      `buildHeatPlansFromSizes: sizes sum to ${total} but ${entries.length} entries were given`,
    );
  }

  const shuffled = shuffle(entries, random);
  let cursor = 0;
  return sizes.map((size, heatIndex) => {
    const heatEntries = shuffled.slice(cursor, cursor + size).map((entry, i) => ({
      entryId: entry.entry_id,
      station: stationLabel(i),
    }));
    cursor += size;
    return { heatNumber: heatIndex + 1, entries: heatEntries };
  });
}

// Pure. `assignments` is `[{entryId, heatNumber, station}]`, one row per
// cupper — the shape a manual-assignment form naturally produces. Validates:
// every entryId belongs to this stage, no entryId assigned twice, every
// stage entry is assigned to exactly one heat (strict — matches §7.4's
// "every set scored before confirm" discipline applied to "every cupper
// placed before generation completes," so nobody is silently forgotten),
// heat numbers sequential from 1, each heat meets HEAT_MIN, and stations are
// unique within a heat.
export function buildHeatPlansFromAssignments(assignments, stageEntries) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error('manual heat assignment must contain at least one entry');
  }

  const validEntryIds = new Set(stageEntries.map((entry) => entry.entry_id));
  const seenEntryIds = new Set();
  const byHeat = new Map();

  for (const assignment of assignments) {
    const { entryId, heatNumber, station } = assignment;
    if (!validEntryIds.has(entryId)) {
      throw new Error(`manual assignment references entry ${entryId}, which is not in this stage`);
    }
    if (seenEntryIds.has(entryId)) {
      throw new Error(`entry ${entryId} is assigned to more than one heat`);
    }
    seenEntryIds.add(entryId);

    if (!Number.isInteger(heatNumber) || heatNumber < 1) {
      throw new Error(
        `entry ${entryId}: heat number must be a positive integer, got ${heatNumber}`,
      );
    }
    if (!station || typeof station !== 'string') {
      throw new Error(`entry ${entryId}: station is required`);
    }

    if (!byHeat.has(heatNumber)) byHeat.set(heatNumber, []);
    byHeat.get(heatNumber).push({ entryId, station });
  }

  const missingEntryIds = [...validEntryIds].filter((id) => !seenEntryIds.has(id));
  if (missingEntryIds.length > 0) {
    throw new Error(
      `manual assignment is missing ${missingEntryIds.length} stage entr${missingEntryIds.length === 1 ? 'y' : 'ies'} — every cupper in the stage must be assigned a heat`,
    );
  }

  const heatNumbers = [...byHeat.keys()].sort((a, b) => a - b);
  heatNumbers.forEach((heatNumber, index) => {
    const expected = index + 1;
    if (heatNumber !== expected) {
      throw new Error(
        `heat numbers must be sequential starting at 1 with no gaps (expected ${expected}, got ${heatNumber})`,
      );
    }
  });

  return heatNumbers.map((heatNumber) => {
    const entries = byHeat.get(heatNumber);
    if (entries.length < HEAT_MIN) {
      throw new Error(
        `heat ${heatNumber} has ${entries.length} cupper(s), below the minimum of ${HEAT_MIN}`,
      );
    }
    const stations = new Set();
    for (const entry of entries) {
      if (stations.has(entry.station)) {
        throw new Error(
          `heat ${heatNumber}: station "${entry.station}" is assigned to more than one cupper`,
        );
      }
      stations.add(entry.station);
    }
    return { heatNumber, entries };
  });
}

function heatMatchesConfig(existing, durationSecs, timingMode) {
  return existing.duration_secs === durationSecs && existing.timing_mode === timingMode;
}

function throwHeatConfigConflict(heatNumber, existing, requested) {
  throw new Error(
    `heat ${heatNumber} already exists with a different configuration — ` +
      `existing: durationSecs=${existing.duration_secs} timingMode=${existing.timing_mode}, ` +
      `requested: durationSecs=${requested.durationSecs} timingMode=${requested.timingMode}`,
  );
}

async function findHeatByNumber(stageId, heatNumber, client, kind = 'normal') {
  const { data, error } = await client
    .from('ct_heats')
    .select('*')
    .eq('stage_id', stageId)
    .eq('heat_number', heatNumber)
    .eq('kind', kind)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findHeatById(heatId, client = getSupabase()) {
  const { data, error } = await client.from('ct_heats').select('*').eq('id', heatId).single();
  if (error) throw error;
  return data;
}

async function createHeat(stageId, heatNumber, durationSecs, timingMode, client, kind = 'normal') {
  const existing = await findHeatByNumber(stageId, heatNumber, client, kind);
  if (existing) {
    if (!heatMatchesConfig(existing, durationSecs, timingMode)) {
      throwHeatConfigConflict(heatNumber, existing, { durationSecs, timingMode });
    }
    return existing;
  }

  const { data, error } = await client
    .from('ct_heats')
    .insert({
      stage_id: stageId,
      heat_number: heatNumber,
      kind,
      timing_mode: timingMode,
      status: 'pending',
      duration_secs: durationSecs,
    })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findHeatByNumber(stageId, heatNumber, client, kind);
      if (raced) {
        if (!heatMatchesConfig(raced, durationSecs, timingMode)) {
          throwHeatConfigConflict(heatNumber, raced, { durationSecs, timingMode });
        }
        return raced;
      }
    }
    throw error;
  }
  return data;
}

export async function listHeatEntries(heatId, client = getSupabase()) {
  const { data, error } = await client.from('ct_heat_entries').select('*').eq('heat_id', heatId);
  if (error) throw error;
  return data;
}

// Idempotent, bounded-retry on a concurrent-insert race — the same shape as
// setup.js's ensureSetsForStage, applied to (heat_id, entry_id) instead of
// (stage_id, position): only inserts rows genuinely missing, throws a
// descriptive conflict if an existing row's station disagrees with what was
// requested (rather than silently keeping the stale value), and gives up
// with a clear error after MAX_INSERT_ATTEMPTS rather than looping forever
// or leaking a raw constraint error on a second collision.
async function ensureHeatEntries(heatId, entries, client) {
  function diffAgainst(existingRows) {
    const existingByEntryId = new Map(existingRows.map((row) => [row.entry_id, row]));
    const missing = [];
    for (const entry of entries) {
      const existingRow = existingByEntryId.get(entry.entryId);
      if (!existingRow) {
        missing.push(entry);
        continue;
      }
      if (existingRow.station !== entry.station) {
        throw new Error(
          `heat entry for cupper ${entry.entryId} already exists with a different station — ` +
            `existing: ${existingRow.station}, requested: ${entry.station}`,
        );
      }
    }
    return missing;
  }

  const initialExisting = await listHeatEntries(heatId, client);
  let missing = diffAgainst(initialExisting);

  for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt += 1) {
    if (missing.length === 0) return listHeatEntries(heatId, client);

    const { error } = await client
      .from('ct_heat_entries')
      .insert(
        missing.map((entry) => ({
          heat_id: heatId,
          entry_id: entry.entryId,
          station: entry.station,
        })),
      )
      .select();
    if (!error) return listHeatEntries(heatId, client);
    if (error.code !== UNIQUE_VIOLATION) throw error;

    missing = diffAgainst(await listHeatEntries(heatId, client));
  }

  if (missing.length === 0) return listHeatEntries(heatId, client);

  throw new Error(
    `ensureHeatEntries: gave up after ${MAX_INSERT_ATTEMPTS} attempts racing concurrent inserts for heat ${heatId}`,
  );
}

async function createHeats(stageId, heatPlans, durationSecs, timingMode, client, kind = 'normal') {
  const created = [];
  for (const plan of heatPlans) {
    const heat = await createHeat(stageId, plan.heatNumber, durationSecs, timingMode, client, kind);
    const entries = await ensureHeatEntries(heat.id, plan.entries, client);
    created.push({ heat, entries });
  }
  return created;
}

export async function generateHeatsRandom(
  stageId,
  { random = Math.random, timingMode = 'app' } = {},
  client = getSupabase(),
) {
  const stage = await findStageById(stageId, client);
  const stageEntries = await listStageEntries(stageId, client);
  if (stageEntries.length === 0) {
    throw new Error(`generateHeatsRandom: stage ${stageId} has no stage entries — seed them first`);
  }

  const sizes = partition(stageEntries.length, { target: HEAT_TARGET, min: HEAT_MIN });
  const heatPlans = buildHeatPlansFromSizes(stageEntries, sizes, { random });
  return createHeats(stageId, heatPlans, stage.duration_secs, timingMode, client);
}

export async function generateHeatsManual(
  stageId,
  assignments,
  { timingMode = 'app' } = {},
  client = getSupabase(),
) {
  const stage = await findStageById(stageId, client);
  const stageEntries = await listStageEntries(stageId, client);
  const heatPlans = buildHeatPlansFromAssignments(assignments, stageEntries);
  return createHeats(stageId, heatPlans, stage.duration_secs, timingMode, client);
}

// Tiebreak heat generation (handoff §7.2, §14 T4.6): one heat, `kind:
// 'tiebreak'`, containing exactly the cuppers tied at a stage's border —
// reuses every existing heat-creation primitive above (buildHeatPlansFromSizes
// for station assignment, createHeats' now-generalized `kind` parameter)
// rather than a parallel implementation, matching this project's own
// module-boundary discipline. Once created, this heat is indistinguishable
// from a normal one to timingScreen.js/scoringScreen.js — neither reads
// `kind` — so it flows through the existing timing → scoring surfaces
// unmodified; ct_standings' own `kind = 'normal'` filter is what keeps its
// result out of the stage's primary tally (see that view's migration
// comment).
//
// Heat numbers are scoped per (stage_id, heat_number, kind) at the DB level
// (§5.2's unique constraint), so tiebreak heats get their own 1, 2, 3...
// sequence independent of the stage's normal heats — this stage's second
// border tie (e.g. one at the prelims cutoff, a separate one for some other
// position) produces tiebreak heat 2, not a collision with normal heat 2.
//
// `tiedEntries` must carry `entry_id` (the shape core/advancement's
// `tiedAtBorder` groups already carry, once unwrapped from their `{item,
// position}` ranking envelope) and have at least 2 members — a genuine tie
// always does (see standings.js's own reasoning: a group of exactly 1 can
// never be flagged as a border tie by computeAdvancement).
export async function generateTiebreakHeat(
  stageId,
  tiedEntries,
  { timingMode = 'app', random = Math.random } = {},
  client = getSupabase(),
) {
  if (!Array.isArray(tiedEntries) || tiedEntries.length < HEAT_MIN) {
    throw new Error(
      `generateTiebreakHeat: needs at least ${HEAT_MIN} tied entries, got ${tiedEntries?.length ?? 0}`,
    );
  }

  const stage = await findStageById(stageId, client);
  const existingHeats = await listHeatsForStage(stageId, client);
  const nextHeatNumber = existingHeats.filter(({ heat }) => heat.kind === 'tiebreak').length + 1;

  const [{ entries: planEntries }] = buildHeatPlansFromSizes(tiedEntries, [tiedEntries.length], {
    random,
  });
  const heatPlan = { heatNumber: nextHeatNumber, entries: planEntries };

  const [created] = await createHeats(
    stageId,
    [heatPlan],
    stage.duration_secs,
    timingMode,
    client,
    'tiebreak',
  );
  return created;
}

// For display: every heat in the stage, each with its own entries. One query
// for the heat list plus one more per heat (sequential, not parallelized) —
// composed in JS rather than a DB-side join, matching hydrateEntries's
// own reasoning (simpler to test, no dependency on PostgREST embed syntax).
// Acceptable for a low-frequency, organiser-only setup screen; a stage with
// many heats would be worth switching to Promise.all or a single
// `.in('heat_id', heatIds)` query if this ever becomes a hot path.
export async function listHeatsForStage(stageId, client = getSupabase()) {
  const { data: heats, error } = await client
    .from('ct_heats')
    .select('*')
    .eq('stage_id', stageId)
    .order('heat_number', { ascending: true });
  if (error) throw error;

  const withEntries = [];
  for (const heat of heats) {
    const entries = await listHeatEntries(heat.id, client);
    withEntries.push({ heat, entries });
  }
  return withEntries;
}
