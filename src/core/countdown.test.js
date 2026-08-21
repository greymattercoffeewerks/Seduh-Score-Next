import { describe, it, expect } from 'vitest';
import { remainingSecs, isExpired } from './countdown.js';

const START = 1_000_000_000; // epoch ms — an arbitrary fixed instant, not real time
const DURATION = 480; // 8:00, a real Cup Taster stage duration

describe('remainingSecs', () => {
  it('returns the full duration at the start instant', () => {
    expect(remainingSecs(START, DURATION, START)).toBe(480);
  });

  it('counts down as the injected clock advances', () => {
    expect(remainingSecs(START, DURATION, START + 100_000)).toBe(380);
  });

  it('clamps at zero once the duration has elapsed', () => {
    expect(remainingSecs(START, DURATION, START + 480_000)).toBe(0);
  });

  it('clamps at zero well past the duration — never goes negative', () => {
    expect(remainingSecs(START, DURATION, START + 10_000_000)).toBe(0);
  });

  it('two instances with the same startedAt agree even when their now-reads differ by a few hundred ms within the same second', () => {
    // Simulates two viewers (e.g. organiser + projector) reading their own
    // clocks a moment apart rather than sharing one `now` value — both must
    // still land on the same whole-second remaining count.
    const a = remainingSecs(START, DURATION, START + 200_000);
    const b = remainingSecs(START, DURATION, START + 200_400);
    expect(a).toBe(b);
  });

  it('a genuinely different now-value (crossing a second boundary) yields a different result', () => {
    // Guards the test above against a version of this function that ignores
    // `now` entirely — proves the two reads above actually exercise different
    // inputs, not just the same one twice.
    const a = remainingSecs(START, DURATION, START + 200_000);
    const b = remainingSecs(START, DURATION, START + 201_000);
    expect(a).not.toBe(b);
  });

  it('a 60-second background gap reports correctly on resume — no drift from missed ticks', () => {
    // Simulates a tab suspended mid-heat: one read before the gap, then a jump
    // straight to a point 60s later with no reads in between. Since this engine
    // recomputes from (now - startedAt) rather than ticking, the gap can't
    // accumulate drift the way a setInterval-based timer would.
    const beforeGap = remainingSecs(START, DURATION, START + 100_000);
    expect(beforeGap).toBe(380);

    const afterGap = remainingSecs(START, DURATION, START + 100_000 + 60_000);
    expect(afterGap).toBe(320);
  });
});

describe('isExpired', () => {
  it('is false before the duration elapses', () => {
    expect(isExpired(START, DURATION, START + 100_000)).toBe(false);
  });

  it('is true exactly at the duration boundary', () => {
    expect(isExpired(START, DURATION, START + 480_000)).toBe(true);
  });

  it('is true well past the duration', () => {
    expect(isExpired(START, DURATION, START + 10_000_000)).toBe(true);
  });
});

describe('engine purity (handoff §14 T2.4 AC: provable by grep)', () => {
  it('the module source contains no timer or DOM APIs', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, 'countdown.js'), 'utf8');
    // Matches actual calls/property access, not the module's own header comment
    // explaining why these are absent (which mentions the bare words as prose).
    expect(source).not.toMatch(
      /setInterval\(|setTimeout\(|requestAnimationFrame\(|document\.|window\./,
    );
  });
});
