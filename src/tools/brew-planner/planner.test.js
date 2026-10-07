import { describe, expect, it } from 'vitest';
import {
  CAMBRO_MAX_FILL,
  EXAMPLE_CONFIG,
  batchYieldMl,
  containersNeeded,
  formatClock,
  planBrews,
  validateConfig,
} from './planner.js';
import { cloneConfig, timeValueToMinutes, minutesToTimeValue } from './plannerState.js';

describe('batchYieldMl', () => {
  it('subtracts 2 g of absorbed water per gram of coffee', () => {
    expect(batchYieldMl(75, 16)).toBe(1050);
    expect(batchYieldMl(60, 16)).toBe(840);
  });
});

describe('containersNeeded', () => {
  it('keeps a pool exactly at the safe fill in one container, and splits just above it', () => {
    expect(containersNeeded(15.3, 15.3)).toBe(1);
    expect(containersNeeded(15.3 + 0.001, 15.3)).toBe(2);
    expect(containersNeeded(0.1 + 0.2, 0.3)).toBe(1);
    expect(containersNeeded(30.6, 15.3)).toBe(2);
  });
});

describe('formatClock', () => {
  it('renders minutes past midnight as a 12-hour clock', () => {
    expect(formatClock(733)).toBe('12:13 pm');
    expect(formatClock(795)).toBe('1:15 pm');
  });
});

describe('planBrews with the Cup Taster 2026 example', () => {
  const plan = planBrews(cloneConfig(EXAMPLE_CONFIG));

  it('needs 76 batches', () => {
    expect(plan.batches).toHaveLength(76);
  });

  it('needs the expected grams of each coffee', () => {
    expect(plan.needByCoffee).toEqual({ c1: 2925, c2: 2250, c3: 525 });
  });

  it('starts brewing at 12:13 pm and never holds a batch past the limit', () => {
    expect(plan.firstBrewMin).toBe(733);
    expect(plan.maxHoldMins).toBe(44);
    expect(plan.maxHoldMins).toBeLessThanOrEqual(EXAMPLE_CONFIG.holdLimitMins);
  });

  it('uses about 91 litres of water', () => {
    expect(plan.waterLitres).toBeCloseTo(91.2, 1);
  });

  it('has a largest pool of 12.6 litres', () => {
    expect(plan.cambros.pools.length).toBe(9);
    expect(plan.cambros.largestLitres).toBeCloseTo(12.6, 1);
  });

  it('needs 76 paper filters, split by stage and machine', () => {
    expect(plan.filters).toBe(76);
    expect(plan.filtersByStage).toEqual({ s1: 39, s2: 24, s3: 13 });
    expect(plan.filtersByMachine.reduce((a, b) => a + b, 0)).toBe(76);
    expect(plan.filtersByMachine).toEqual(
      EXAMPLE_CONFIG.machines.map(
        (_, i) => plan.batches.filter((b) => b.machineIndex === i).length,
      ),
    );
  });

  it('counts Cambros for the 1.5, 2.5 and 4.75 gallon sizes', () => {
    const [small, medium, large] = plan.cambros.sizes;
    expect([small.label, medium.label, large.label]).toEqual(['1.5 gal', '2.5 gal', '4.75 gal']);
    expect(small.litres).toBeCloseTo(5.68, 2);
    expect(large.litres).toBeCloseTo(17.98, 2);
    expect(large.usableLitres).toBeCloseTo(large.litres * CAMBRO_MAX_FILL, 6);
    expect([small.concurrent, medium.concurrent, large.concurrent]).toEqual([8, 6, 4]);
    expect(plan.cambros.pools.length).toBeGreaterThan(0);
  });

  it.each([
    ['1.5 gal', 0],
    ['2.5 gal', 1],
    ['4.75 gal', 2],
  ])('splits every %s pool into the fewest Cambros under the safe fill', (_label, sizeIndex) => {
    const size = plan.cambros.sizes[sizeIndex];
    plan.cambros.pools.forEach((pool) => {
      const n = size.perPool[`${pool.heatCode}|${pool.coffeeId}`];
      expect(n * size.usableLitres).toBeGreaterThanOrEqual(pool.brewedLitres - 1e-9);
      expect((n - 1) * size.usableLitres).toBeLessThan(pool.brewedLitres);
    });
  });

  it('gives every batch a unique key and a machine', () => {
    const keys = new Set(plan.batches.map((batch) => batch.key));
    expect(keys.size).toBe(plan.batches.length);
    plan.batches.forEach((batch) => expect(batch.machineIndex).toBeGreaterThanOrEqual(0));
  });

  it('never runs two batches on one machine at the same time', () => {
    const byMachine = new Map();
    plan.batches.forEach((batch) => {
      const list = byMachine.get(batch.machineIndex) ?? [];
      list.push(batch);
      byMachine.set(batch.machineIndex, list);
    });
    for (const list of byMachine.values()) {
      list.sort((a, b) => a.startMin - b.startMin);
      for (let i = 1; i < list.length; i += 1) {
        expect(list[i].startMin).toBeGreaterThanOrEqual(list[i - 1].endMin);
      }
    }
  });
});

describe('validateConfig', () => {
  it('accepts the example', () => {
    expect(validateConfig(cloneConfig(EXAMPLE_CONFIG))).toEqual([]);
  });

  it('flags a stage that has no heats', () => {
    const config = cloneConfig(EXAMPLE_CONFIG);
    config.stages[0].heats = [];
    const problems = validateConfig(config);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].step).toBe(0);
  });

  it('flags a config with no machines', () => {
    const config = cloneConfig(EXAMPLE_CONFIG);
    config.machines = [];
    expect(validateConfig(config).some((problem) => problem.step === 2)).toBe(true);
  });
});

describe('time helpers', () => {
  it('round-trips a time input value', () => {
    expect(minutesToTimeValue(795)).toBe('13:15');
    expect(timeValueToMinutes('13:15')).toBe(795);
  });
});

describe('validateConfig rejections', () => {
  const broken = (change) => {
    const config = cloneConfig(EXAMPLE_CONFIG);
    change(config);
    return validateConfig(config);
  };

  it.each([
    ['a missing start time', 3, (c) => (c.startMin = Number.NaN)],
    ['a zero cup volume', 0, (c) => (c.cupMl = 0)],
    ['a zero dose', 2, (c) => (c.doseGrams = 0)],
    ['a ratio at the absorption floor', 2, (c) => (c.ratio = 2)],
    ['a machine with no brew time', 2, (c) => (c.machines[0].brewMins = 0)],
    ['no coffees', 1, (c) => (c.coffees = [])],
    ['no stages', 0, (c) => (c.stages = [])],
    ['a heat with zero cuppers', 0, (c) => (c.stages[0].heats = [4, 0])],
    ['zero sets', 0, (c) => (c.stages[0].sets = 0)],
    ['a zero heat length', 0, (c) => (c.stages[0].heatMins = 0)],
    ['a mix that under-covers the sets', 1, (c) => (c.stages[0].mix = { c1: 4 })],
    ['a mix that over-covers the sets', 1, (c) => (c.stages[0].mix = { c1: 6 })],
  ])('flags %s on step %i', (_name, step, change) => {
    const problems = broken(change);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.step === step)).toBe(true);
  });
});
