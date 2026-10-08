import { describe, it, expect, vi } from 'vitest';
import { renderCountdown, URGENT_THRESHOLD_SECS } from './countdownDisplay.js';

function setUp(remainingSecs, durationSecs = 480) {
  vi.useFakeTimers();
  const now = new Date('2026-10-08T10:00:00Z');
  vi.setSystemTime(now);
  const startedAt = new Date(now.getTime() - (durationSecs - remainingSecs) * 1000).toISOString();
  return renderCountdown({ startedAt, durationSecs });
}

describe('renderCountdown', () => {
  it('shows the remaining time as M:SS in a live element tagged for the cross-surface check', () => {
    const countdown = setUp(300);
    try {
      const [digits] = countdown.elements;
      expect(digits.textContent).toBe('5:00');
      expect(digits.classList.contains('viewer-countdown')).toBe(true);
      expect(digits.classList.contains('font-mono-score')).toBe(true);
      countdown.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a surface sizing class next to the shared ones', () => {
    vi.useFakeTimers();
    try {
      const { elements, cleanup } = renderCountdown(
        { startedAt: new Date().toISOString(), durationSecs: 60 },
        { className: 'projector-countdown' },
      );
      expect(elements[0].className).toBe('font-mono-score viewer-countdown projector-countdown');
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks once a second', () => {
    const countdown = setUp(300);
    try {
      const [digits] = countdown.elements;
      vi.advanceTimersByTime(1_000);
      expect(digits.textContent).toBe('4:59');
      vi.advanceTimersByTime(59_000);
      expect(digits.textContent).toBe('4:00');
      countdown.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the per-second digits out of the screen reader (aria-live off) and the one-shot messages in', () => {
    const countdown = setUp(300);
    try {
      const [digits, announcement] = countdown.elements;
      expect(digits.getAttribute('aria-live')).toBe('off');
      expect(announcement.getAttribute('aria-live')).toBe('polite');
      expect(announcement.classList.contains('sr-only')).toBe(true);
      countdown.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags the urgent window at the threshold and announces it once', () => {
    const countdown = setUp(URGENT_THRESHOLD_SECS + 2);
    try {
      const [digits, announcement] = countdown.elements;
      expect(digits.dataset.urgent).toBe('false');
      expect(announcement.textContent).toBe('');
      vi.advanceTimersByTime(2_000);
      expect(digits.dataset.urgent).toBe('true');
      expect(announcement.textContent).toBe('Less than 10 seconds remaining.');
      announcement.textContent = '';
      vi.advanceTimersByTime(3_000);
      expect(announcement.textContent).toBe(''); // never announced twice
      countdown.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces "Time is up." when it runs out, and stops ticking', () => {
    const countdown = setUp(2);
    try {
      const [digits, announcement] = countdown.elements;
      vi.advanceTimersByTime(2_000);
      expect(digits.textContent).toBe('0:00');
      expect(announcement.textContent).toBe('Time is up.');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a heat that has already run out starts at 0:00 with no timer at all', () => {
    const countdown = setUp(0);
    try {
      expect(countdown.elements[0].textContent).toBe('0:00');
      expect(countdown.elements[1].textContent).toBe('Time is up.');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanup() stops the ticking', () => {
    const countdown = setUp(300);
    try {
      countdown.cleanup();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
