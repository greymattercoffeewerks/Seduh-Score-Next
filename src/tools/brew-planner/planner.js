// Brew Planner engine — pure functions, no DOM, no storage, no clock. Works out how many
// batches each heat needs, which machine brews each one and when, so every heat's coffee
// is pooled and ready before its cups have to be poured.
//
// Vocabulary follows CONVENTIONS.md: a "set" is three cups (two identical, one different),
// a "stage" runs a fixed number of sets, and a "heat" is one group of cuppers tasting the
// stage's sets together. Deliberately not tied to Cup Taster's schema or to any format —
// it is a free community tool, so it takes plain numbers in and hands plain numbers back.
//
// Times are minutes since midnight. The schedule is built BACKWARDS from each heat's pour
// deadline, placing every batch as late as the machines allow, which keeps hold times as
// short as the equipment can manage.

export const CUPS_PER_SET = 3;
// Grams of water a gram of ground coffee holds back in a batch brew. A working figure, not
// a measurement — the planner says so wherever it shows yield.
export const ABSORPTION = 2;
// Cambros keep coffee hotter when they are mostly full and spill when brim full.
export const CAMBRO_MAX_FILL = 0.85;
// The three Cambro sizes the planner sizes against, by their nominal US-gallon labels.
const CAMBRO_SIZES = [
  { id: 'g1_5', label: '1.5 gal', gallons: 1.5 },
  { id: 'g2_5', label: '2.5 gal', gallons: 2.5 },
  { id: 'g4_75', label: '4.75 gal', gallons: 4.75 },
].map((size) => ({ ...size, litres: size.gallons * 3.785411784 }));
// One paper filter goes in every batch, whichever machine brews it.
export const FILTERS_PER_BATCH = 1;

export const EXAMPLE_CONFIG = {
  version: 1,
  startMin: 13 * 60 + 15,
  cupMl: 150,
  doseGrams: 75,
  ratio: 16,
  resetMins: 2,
  holdLimitMins: 45,
  pourLeadMins: 12,
  tabulationMins: 20,
  breakBeforeLastMins: 0,
  coffees: [
    { id: 'c1', name: 'Coffee A', grams: 3000 },
    { id: 'c2', name: 'Coffee B', grams: 2000 },
    { id: 'c3', name: 'Coffee C', grams: 1000 },
  ],
  stages: [
    {
      id: 's1',
      name: 'Prelim',
      code: 'P',
      heats: [4, 4, 3, 3, 3],
      sets: 5,
      heatMins: 6,
      changeoverMins: 5,
      mix: { c1: 5 },
    },
    {
      id: 's2',
      name: 'Semi',
      code: 'SF',
      heats: [4, 4],
      sets: 7,
      heatMins: 8,
      changeoverMins: 6,
      mix: { c2: 7 },
    },
    {
      id: 's3',
      name: 'Final',
      code: 'F',
      heats: [4],
      sets: 7,
      heatMins: 8,
      changeoverMins: 6,
      mix: { c2: 3, c3: 4 },
    },
  ],
  machines: [
    { name: 'Aiden 1', brewMins: 7 },
    { name: 'Aiden 2', brewMins: 7 },
    { name: 'Moccamaster 1', brewMins: 6 },
    { name: 'Moccamaster 2', brewMins: 6 },
  ],
};

// Fewest containers that hold `litres` without any passing its safe fill. The epsilon keeps
// a pool that lands exactly on the limit in one container despite float noise.
export function containersNeeded(litres, usableLitres) {
  return Math.ceil(litres / usableLitres - 1e-9);
}

export function batchYieldMl(doseGrams, ratio) {
  return doseGrams * ratio - ABSORPTION * doseGrams;
}

export function formatClock(mins) {
  const rounded = Math.round(mins);
  const hours24 = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function isPositive(value) {
  return Number.isFinite(value) && value > 0;
}

// Returns problems as { step, message }, `step` being the wizard step (0 Heats, 1 Coffees,
// 2 Machines, 3 Timing) that owns the fix. An empty array means the config can be planned.
export function validateConfig(config) {
  const problems = [];
  const add = (step, message) => problems.push({ step, message });
  if (!Number.isFinite(config.startMin)) add(3, 'Set a start time for the first heat.');
  if (!isPositive(config.cupMl)) add(0, 'Cup volume must be more than zero.');
  if (!isPositive(config.doseGrams)) add(2, 'Coffee per batch must be more than zero.');
  if (!isPositive(config.ratio) || config.ratio <= ABSORPTION) {
    add(2, `Ratio must be above 1:${ABSORPTION} (water to coffee).`);
  }
  if (!config.machines.length) add(2, 'Add at least one machine.');
  config.machines.forEach((machine, index) => {
    if (!isPositive(machine.brewMins)) add(2, `Machine ${index + 1} needs a brew time above zero.`);
  });
  if (!config.coffees.length) add(1, 'Add at least one coffee.');
  if (!config.stages.length) add(0, 'Add at least one stage.');
  config.stages.forEach((stage, index) => {
    const label = stage.name || `Stage ${index + 1}`;
    if (!stage.heats.length || stage.heats.some((cuppers) => !isPositive(cuppers))) {
      add(0, `${label}: list the cuppers in each heat, for example 4, 4, 3.`);
    }
    if (!isPositive(stage.sets)) add(0, `${label}: sets per cupper must be above zero.`);
    if (!isPositive(stage.heatMins)) add(0, `${label}: heat length must be above zero.`);
    const assigned = Object.values(stage.mix).reduce((sum, sets) => sum + (sets || 0), 0);
    if (assigned !== stage.sets)
      add(1, `${label}: coffees cover ${assigned} of ${stage.sets} sets.`);
  });
  return problems;
}

function buildHeats(config, yieldMl) {
  const heats = [];
  let clock = config.startMin;
  config.stages.forEach((stage, stageIndex) => {
    if (stageIndex > 0) {
      const previous = heats[heats.length - 1];
      clock = previous.startMin + previous.lengthMins + config.tabulationMins;
      if (stageIndex === config.stages.length - 1) clock += config.breakBeforeLastMins;
    }
    stage.heats.forEach((cuppers, heatIndex) => {
      if (heatIndex > 0) {
        const previous = heats[heats.length - 1];
        clock = previous.startMin + previous.lengthMins + stage.changeoverMins;
      }
      const cups = cuppers * stage.sets * CUPS_PER_SET;
      const lots = config.coffees
        .filter((coffee) => (stage.mix[coffee.id] || 0) > 0)
        .map((coffee) => {
          const sets = stage.mix[coffee.id];
          const cupsForLot = cuppers * sets * CUPS_PER_SET;
          return {
            coffeeId: coffee.id,
            sets,
            cups: cupsForLot,
            neededMl: cupsForLot * config.cupMl,
            batches: Math.ceil((cupsForLot * config.cupMl) / yieldMl - 1e-9),
          };
        });
      heats.push({
        code: stage.heats.length > 1 ? `${stage.code}${heatIndex + 1}` : stage.code,
        label: stage.heats.length > 1 ? `${stage.name} ${heatIndex + 1}` : stage.name,
        stageId: stage.id,
        stageIndex,
        cuppers,
        cups,
        startMin: clock,
        lengthMins: stage.heatMins,
        poolByMin: clock - config.pourLeadMins,
        lots,
        batches: lots.reduce((sum, lot) => sum + lot.batches, 0),
        maxHoldMins: 0,
      });
    });
  });
  return heats;
}

// Backwards list scheduling: walk heats last to first, give each batch to the machine that
// can finish it latest without passing the heat's pool-by time.
function placeBatches(config, heats) {
  const nextFree = config.machines.map(() => Infinity);
  const placed = [];
  for (let heatIndex = heats.length - 1; heatIndex >= 0; heatIndex--) {
    const heat = heats[heatIndex];
    for (let n = 0; n < heat.batches; n++) {
      let best = 0;
      let bestEnd = -Infinity;
      config.machines.forEach((machine, machineIndex) => {
        const end = Math.min(nextFree[machineIndex], heat.poolByMin);
        if (end > bestEnd) {
          bestEnd = end;
          best = machineIndex;
        }
      });
      const start = bestEnd - config.machines[best].brewMins;
      nextFree[best] = start - config.resetMins;
      placed.push({
        heatIndex,
        machineIndex: best,
        startMin: start,
        endMin: bestEnd,
        holdMins: heat.poolByMin - bestEnd,
      });
    }
  }
  placed.sort((a, b) => a.startMin - b.startMin || a.machineIndex - b.machineIndex);
  const counts = {};
  placed.forEach((batch) => {
    const heat = heats[batch.heatIndex];
    counts[heat.code] = (counts[heat.code] || 0) + 1;
    batch.number = counts[heat.code];
    batch.heatCode = heat.code;
    heat.maxHoldMins = Math.max(heat.maxHoldMins, batch.holdMins);
    batch.pourByMin = heat.poolByMin;
    // Within a heat the machines run one coffee at a time, in the order the stage lists them,
    // so the grinder is purged once per heat rather than once per batch.
    const sequence = heat.lots.flatMap((lot) => Array(lot.batches).fill(lot.coffeeId));
    batch.coffeeId = sequence[batch.number - 1];
    batch.key = `${heat.code}-${batch.number}`;
  });
  return placed;
}

function summarisePools(heats, batches, yieldMl) {
  const pools = [];
  heats.forEach((heat) => {
    heat.lots.forEach((lot) => {
      const own = batches.filter((b) => b.heatCode === heat.code && b.coffeeId === lot.coffeeId);
      pools.push({
        heatCode: heat.code,
        coffeeId: lot.coffeeId,
        brewedLitres: (lot.batches * yieldMl) / 1000,
        neededLitres: lot.neededMl / 1000,
        fromMin: Math.min(...own.map((b) => b.endMin)),
        untilMin: heat.startMin,
      });
    });
  });
  // Peak number of containers in use at once, each pool weighing in as `weight(pool)`.
  const peak = (weight) => {
    const events = pools.flatMap((pool) => [
      { at: pool.fromMin, delta: weight(pool) },
      { at: pool.untilMin, delta: -weight(pool) },
    ]);
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let open = 0;
    let highest = 0;
    events.forEach((event) => {
      open += event.delta;
      highest = Math.max(highest, open);
    });
    return highest;
  };
  // A pool bigger than one Cambro's safe fill is split across several of the same size.
  const sizes = CAMBRO_SIZES.map((size) => {
    const usableLitres = size.litres * CAMBRO_MAX_FILL;
    const needed = (pool) => containersNeeded(pool.brewedLitres, usableLitres);
    return {
      ...size,
      usableLitres,
      concurrent: peak(needed),
      perPool: Object.fromEntries(
        pools.map((pool) => [`${pool.heatCode}|${pool.coffeeId}`, needed(pool)]),
      ),
    };
  });
  return {
    pools,
    sizes,
    largestLitres: Math.max(...pools.map((pool) => pool.brewedLitres)),
  };
}

// The one public entry point. `config` must pass validateConfig().
export function planBrews(config) {
  const yieldMl = batchYieldMl(config.doseGrams, config.ratio);
  const waterMlPerBatch = config.doseGrams * config.ratio;
  const heats = buildHeats(config, yieldMl);
  const batches = placeBatches(config, heats);

  const needByCoffee = {};
  config.coffees.forEach((coffee) => {
    needByCoffee[coffee.id] = 0;
  });
  heats.forEach((heat) =>
    heat.lots.forEach((lot) => {
      needByCoffee[lot.coffeeId] += lot.batches * config.doseGrams;
    }),
  );

  const cadenceMins =
    1 / config.machines.reduce((sum, m) => sum + 1 / (m.brewMins + config.resetMins), 0);

  return {
    yieldMl,
    waterMlPerBatch,
    heats,
    batches,
    needByCoffee,
    totalGrams: Object.values(needByCoffee).reduce((sum, grams) => sum + grams, 0),
    filters: batches.length * FILTERS_PER_BATCH,
    filtersByStage: Object.fromEntries(
      config.stages.map((stage) => [
        stage.id,
        heats.filter((h) => h.stageId === stage.id).reduce((sum, h) => sum + h.batches, 0) *
          FILTERS_PER_BATCH,
      ]),
    ),
    filtersByMachine: config.machines.map(
      (_, index) => batches.filter((b) => b.machineIndex === index).length * FILTERS_PER_BATCH,
    ),
    waterLitres: (batches.length * waterMlPerBatch) / 1000,
    cadenceMins,
    firstBrewMin: batches[0].startMin,
    lastBrewEndMin: Math.max(...batches.map((b) => b.endMin)),
    maxHoldMins: Math.max(...batches.map((b) => b.holdMins)),
    cambros: summarisePools(heats, batches, yieldMl),
  };
}
