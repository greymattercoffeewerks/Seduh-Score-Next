import { describe, it, expect, vi } from 'vitest';
import { ringProgress, ringDashArray, secondsLeft, createProgressRing } from './progressRing.js';

describe('ringProgress', () => {
  it('is 0 at the start, 1 once the duration has passed, and proportional in between', () => {
    expect(ringProgress(1000, 1000, 10_000)).toBe(0);
    expect(ringProgress(6000, 1000, 10_000)).toBe(0.5);
    expect(ringProgress(11_000, 1000, 10_000)).toBe(1);
  });

  it('never leaves 0..1: a clock before the start or long after the end is clamped', () => {
    expect(ringProgress(0, 1000, 10_000)).toBe(0);
    expect(ringProgress(999_999, 1000, 10_000)).toBe(1);
  });

  it('treats a zero, negative or missing duration as already complete rather than dividing by it', () => {
    for (const duration of [0, -5, undefined, NaN]) {
      expect(ringProgress(5000, 1000, duration)).toBe(1);
    }
  });
});

describe('ringDashArray', () => {
  it('draws the arc as a share of the circle (circumference 100)', () => {
    expect(ringDashArray(0)).toBe('0 100');
    expect(ringDashArray(0.25)).toBe('25 100');
    expect(ringDashArray(1)).toBe('100 100');
  });

  it('clamps out-of-range progress', () => {
    expect(ringDashArray(-1)).toBe('0 100');
    expect(ringDashArray(7)).toBe('100 100');
  });
});

describe('secondsLeft', () => {
  it('rounds UP, so the ring never shows 0 while there is still time', () => {
    expect(secondsLeft(0, 0, 10_000)).toBe(10);
    expect(secondsLeft(9_001, 0, 10_000)).toBe(1);
    expect(secondsLeft(10_000, 0, 10_000)).toBe(0);
  });

  it('never goes negative', () => {
    expect(secondsLeft(50_000, 0, 10_000)).toBe(0);
  });
});

describe('createProgressRing', () => {
  function setUp({ reduced = false } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    return createProgressRing({ reducedMotion: () => reduced });
  }
  const arcOf = (ring) => ring.el.querySelector('.stage-ring-arc').getAttribute('stroke-dasharray');
  const countOf = (ring) => ring.el.querySelector('.stage-ring-count').textContent;

  it('is decorative: hidden from assistive tech, with the seconds left in its middle', () => {
    const ring = setUp();
    try {
      expect(ring.el.getAttribute('aria-hidden')).toBe('true');
      ring.run({ durationMs: 10_000 });
      expect(countOf(ring)).toBe('10');
      expect(arcOf(ring)).toBe('0 100');
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fills as time passes, from the wall clock', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 10_000 });
      vi.advanceTimersByTime(5_000);
      expect(arcOf(ring)).toBe('50 100');
      expect(countOf(ring)).toBe('5');
      vi.advanceTimersByTime(5_000);
      expect(arcOf(ring)).toBe('100 100');
      expect(countOf(ring)).toBe('0');
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts from the given startedAt, so a ring re-attached mid-page shows the right value at once', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 10_000, startedAt: Date.now() - 4_000 });
      expect(arcOf(ring)).toBe('40 100');
      expect(countOf(ring)).toBe('6');
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs again from a new start: the previous run does not keep painting', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 10_000 });
      vi.advanceTimersByTime(8_000);
      ring.run({ durationMs: 10_000 });
      expect(arcOf(ring)).toBe('0 100');
      expect(vi.getTimerCount()).toBe(1);
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('repaints about ten times a second normally, and once a second under reduced motion', () => {
    for (const [reduced, expectedPaints] of [
      [false, 10],
      [true, 1],
    ]) {
      const ring = setUp({ reduced });
      try {
        ring.run({ durationMs: 60_000 });
        const arc = ring.el.querySelector('.stage-ring-arc');
        const spy = vi.spyOn(arc, 'setAttribute');
        vi.advanceTimersByTime(1_000);
        expect(spy).toHaveBeenCalledTimes(expectedPaints);
        ring.destroy();
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it('counts a part-second duration up to the next whole second (7.5s shows 8)', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 7_500 });
      expect(ring.el.querySelector('.stage-ring-count').textContent).toBe('8');
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes the ring and its number only when they change, not on every tick', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 600_000 }); // ten minutes: the arc moves a hair a second, the number once a second
      const arc = ring.el.querySelector('.stage-ring-arc');
      const count = ring.el.querySelector('.stage-ring-count');
      const arcWrites = vi.spyOn(arc, 'setAttribute');
      let numberWrites = 0;
      const realSet = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set;
      Object.defineProperty(count, 'textContent', {
        configurable: true,
        get: () => count.firstChild?.textContent ?? '',
        set: (value) => {
          numberWrites += 1;
          realSet.call(count, value);
        },
      });
      vi.advanceTimersByTime(2_000); // twenty ticks
      expect(numberWrites).toBe(2); // two seconds passed: the number changed twice, not twenty times
      expect(arcWrites.mock.calls.length).toBeLessThan(20);
      ring.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy() and stop() clear the timer', () => {
    const ring = setUp();
    try {
      ring.run({ durationMs: 10_000 });
      ring.stop();
      expect(vi.getTimerCount()).toBe(0);
      ring.run({ durationMs: 10_000 });
      ring.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
