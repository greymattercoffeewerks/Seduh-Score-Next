import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasViewableContent, isNoClockHeat, mountViewerBody } from './viewerBody.js';

function baseCupper(overrides = {}) {
  return { displayName: 'Alex', station: 'A', totalElapsedSecs: null, maxed: false, ...overrides };
}

// Fake timers for the whole file — an app-timed active heat starts a real
// setInterval (the countdown), and without this every such test would leak
// one into the real event loop.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('hasViewableContent', () => {
  it('is false for null/undefined', () => {
    expect(hasViewableContent(null)).toBe(false);
    expect(hasViewableContent(undefined)).toBe(false);
  });

  it('is false for a stage descriptor with no standings and no active heat', () => {
    expect(hasViewableContent({ stage: { kind: 'prelims', setCount: 5 }, standings: [] })).toBe(
      false,
    );
  });

  it('is true when standings has at least one row', () => {
    expect(hasViewableContent({ standings: [{ position: 1 }] })).toBe(true);
  });

  it('is true when an active heat exists, even with empty standings', () => {
    expect(hasViewableContent({ standings: [], activeHeat: { heatNumber: 1 } })).toBe(true);
  });
});

describe('isNoClockHeat', () => {
  it('is true for a manual heat with no startedAt', () => {
    expect(isNoClockHeat({ timingMode: 'manual', startedAt: null })).toBe(true);
  });

  it('is false for a manual heat that HAS started', () => {
    expect(isNoClockHeat({ timingMode: 'manual', startedAt: '2026-08-28T00:00:00Z' })).toBe(false);
  });

  it('is false for an app-mode heat, regardless of startedAt', () => {
    expect(isNoClockHeat({ timingMode: 'app', startedAt: null })).toBe(false);
    expect(isNoClockHeat({ timingMode: 'app', startedAt: '2026-08-28T00:00:00Z' })).toBe(false);
  });
});

describe('mountViewerBody — standings', () => {
  it('shows a defined empty state, not a blank table, when standings is empty', () => {
    const container = document.createElement('div');
    mountViewerBody(container, { stage: { kind: 'prelims', setCount: 5 }, standings: [] });
    expect(container.textContent).toContain('No scores yet.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('renders one row per standing with position/name/correct-of-setCount/time', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [
        { position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 240 },
        { position: 2, displayName: 'Jordan', numCorrect: 4, totalElapsedSecs: 260 },
      ],
    });
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('1');
    expect(rows[0].textContent).toContain('Alex');
    expect(rows[0].textContent).toContain('5/5');
    expect(rows[0].textContent).toContain('4:00');
  });

  it('pairs the visible M:SS time with an unambiguous screen-reader expansion', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 240 }],
    });
    const timeCell = container.querySelector('[data-label="Time"]');
    // The visible text is the cell's own first child node, distinct from
    // the nested .sr-only expansion checked on the next line — both
    // contribute to a bare .textContent read, so checking the specific
    // node is what actually proves the VISIBLE format is M:SS.
    expect(timeCell.childNodes[0].textContent).toBe('4:00');
    expect(timeCell.querySelector('.sr-only').textContent).toBe('4 minutes 0 seconds');
  });

  it('shows a dash, not a raw null, for a standing with no recorded time yet', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 0, totalElapsedSecs: null }],
    });
    expect(container.querySelector('tbody tr').textContent).toContain('—');
  });

  it('titles the section with the stage kind', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'finals', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
    });
    expect(container.querySelector('h2').textContent).toBe('Finals standings');
  });

  it('renders standings without a heading, and a bare correct-count, when the payload has no stage', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
    });
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('tbody tr').textContent).toContain('5');
    expect(container.querySelector('tbody tr').textContent).not.toContain('undefined');
  });

  it('marks a tied or advancing row with a text-carried label and a data-status attribute', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [
        {
          position: 3,
          displayName: 'Alex',
          numCorrect: 4,
          totalElapsedSecs: 200,
          tieStatus: 'tied',
        },
        {
          position: 1,
          displayName: 'Jordan',
          numCorrect: 5,
          totalElapsedSecs: 190,
          tieStatus: 'advancing',
        },
        { position: 5, displayName: 'Sam', numCorrect: 2, totalElapsedSecs: 300 },
      ],
    });
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0].dataset.status).toBe('tied');
    expect(rows[0].textContent).toContain('(tied)');
    expect(rows[1].dataset.status).toBe('advancing');
    expect(rows[1].textContent).toContain('(advancing)');
    expect(rows[2].dataset.status).toBeUndefined();
    expect(rows[2].textContent).not.toContain('(tied)');
    expect(rows[2].textContent).not.toContain('(advancing)');
  });
});

describe('mountViewerBody — active heat', () => {
  it('shows the stage/heat number/status in the heading', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 2,
        stageKind: 'semis',
        status: 'timing',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [baseCupper()],
      },
    });
    expect(container.querySelector('.viewer-active-heat h3').textContent).toBe(
      'Semis · Heat 2 — Timing…',
    );
  });

  it('shows "Scoring…" once the heat has moved past timing', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'scoring',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        cuppers: [baseCupper()],
      },
    });
    expect(container.querySelector('.viewer-active-heat h3').textContent).toContain('Scoring…');
  });

  it('renders a chip per cupper, tagged running/done/maxed', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [
          baseCupper({ displayName: 'Running Cupper', totalElapsedSecs: null, maxed: false }),
          baseCupper({ displayName: 'Done Cupper', totalElapsedSecs: 200, maxed: false }),
          baseCupper({ displayName: 'Maxed Cupper', totalElapsedSecs: 480, maxed: true }),
        ],
      },
    });
    const chips = [...container.querySelectorAll('.viewer-heat-chip')];
    expect(chips).toHaveLength(3);
    expect(chips[0].dataset.status).toBe('running');
    expect(chips[0].textContent).not.toContain('✓');
    expect(chips[0].textContent).not.toContain('(max)');
    expect(chips[0].textContent).toContain('(timing)');
    expect(chips[1].dataset.status).toBe('done');
    expect(chips[1].textContent).toContain('✓');
    expect(chips[1].textContent).toContain('(done)');
    expect(chips[2].dataset.status).toBe('maxed');
    expect(chips[2].textContent).toContain('(max)');
  });

  it('includes the station in the chip label when present', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [baseCupper({ displayName: 'Alex', station: 'B' })],
      },
    });
    expect(container.querySelector('.viewer-heat-chip').textContent).toContain('Alex · B');
  });

  it('shows the defined no-clock state for a manual heat with no startedAt — no timer implied anywhere', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'manual',
        startedAt: null,
        cuppers: [baseCupper({ displayName: 'Alex', station: 'A' })],
      },
    });
    expect(container.textContent).toContain('Manual heat — not yet started.');
    // Still shows the cupper roster (name/station/finished-or-not) — the
    // AC's own "not a blank" requirement — just with no timer anywhere.
    expect(container.querySelector('.viewer-heat-chip').textContent).toContain('Alex · A');
    // The AC is a negative ("rather than a blank or a zeroed timer") — prove
    // it, not just that the message string appears.
    expect(container.textContent).not.toMatch(/\d+s\b/);
    expect(container.textContent).not.toMatch(/0:00|\bmm:ss\b/);
    // The heading itself must not contradict the no-clock message by
    // claiming "Timing…" right above it.
    const heading = container.querySelector('.viewer-active-heat h3').textContent;
    expect(heading).not.toContain('Timing…');
    expect(heading).toContain('Not started');
  });

  it('does NOT show the no-clock message for a manual heat that has started', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'manual',
        startedAt: '2026-08-28T00:00:00Z',
        cuppers: [baseCupper()],
      },
    });
    expect(container.textContent).not.toContain('not yet started');
  });

  it('does NOT show the no-clock message for an app-mode heat with no startedAt (e.g. still connecting)', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'app',
        startedAt: null,
        cuppers: [baseCupper()],
      },
    });
    expect(container.textContent).not.toContain('not yet started');
  });

  it('shows no countdown for a manual heat, even one that has started', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'manual',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [baseCupper()],
      },
    });
    expect(container.querySelector('.viewer-countdown')).toBeNull();
  });

  it('shows no countdown once a heat has moved to scoring', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'scoring',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [baseCupper()],
      },
    });
    expect(container.querySelector('.viewer-countdown')).toBeNull();
  });

  it('shows no countdown for an app-mode heat with no startedAt yet', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      activeHeat: {
        heatNumber: 1,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'app',
        startedAt: null,
        durationSecs: 480,
        cuppers: [baseCupper()],
      },
    });
    expect(container.querySelector('.viewer-countdown')).toBeNull();
  });

  it('omits the active-heat section entirely when there is no active heat', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
      activeHeat: null,
    });
    expect(container.querySelector('.viewer-active-heat')).toBeNull();
  });
});

function appHeatFixture(overrides = {}) {
  return {
    standings: [],
    activeHeat: {
      heatNumber: 1,
      stageKind: 'prelims',
      status: 'timing',
      timingMode: 'app',
      startedAt: '2026-08-28T00:00:00Z',
      durationSecs: 480,
      cuppers: [baseCupper()],
      ...overrides,
    },
  };
}

describe('mountViewerBody — live countdown', () => {
  it('paints the initial remaining time on mount, tabular/mono, not announced per-tick', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture());
    const countdown = container.querySelector('.viewer-countdown');
    expect(countdown).not.toBeNull();
    expect(countdown.textContent).toBe('8:00');
    expect(countdown.className).toContain('font-mono-score');
    expect(countdown.getAttribute('aria-live')).toBe('off');
  });

  it('ticks down by one second per second', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture());
    const countdown = container.querySelector('.viewer-countdown');
    vi.advanceTimersByTime(3000);
    expect(countdown.textContent).toBe('7:57');
  });

  it('marks urgent at 10s remaining or below, not above', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture({ durationSecs: 11 }));
    const countdown = container.querySelector('.viewer-countdown');
    expect(countdown.dataset.urgent).toBe('false'); // 11s remaining
    vi.advanceTimersByTime(1000);
    expect(countdown.dataset.urgent).toBe('true'); // 10s remaining
  });

  it('freezes at 0:00 once expired, rather than ticking negative', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture({ durationSecs: 2 }));
    const countdown = container.querySelector('.viewer-countdown');
    vi.advanceTimersByTime(5000);
    expect(countdown.textContent).toBe('0:00');
    expect(countdown.dataset.urgent).toBe('true');
  });

  it('actually stops the interval on expiry — the display floor alone is not proof of that', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture({ durationSecs: 2 }));
    // remainingSecs/formatDuration already floor at 0 regardless of whether
    // the interval is still running — vi.getTimerCount() is the only way to
    // prove the interval itself was cleared, not merely that the displayed
    // value can't go visibly wrong once it is.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(5000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an interval at all when already expired at mount time', () => {
    const container = document.createElement('div');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    mountViewerBody(
      container,
      appHeatFixture({ durationSecs: 2, startedAt: '2026-08-27T00:00:00Z' }),
    );
    expect(setSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("mountViewerBody's returned cleanup stops the tick — a later render never touches this container again", () => {
    const container = document.createElement('div');
    const cleanup = mountViewerBody(container, appHeatFixture());
    const countdown = container.querySelector('.viewer-countdown');
    expect(typeof cleanup).toBe('function');
    vi.advanceTimersByTime(2000);
    expect(countdown.textContent).toBe('7:58');
    cleanup();
    vi.advanceTimersByTime(5000);
    // Unchanged — the interval was cleared, not merely detached.
    expect(countdown.textContent).toBe('7:58');
  });

  it('returns a falsy cleanup when there is no active heat at all', () => {
    const container = document.createElement('div');
    const cleanup = mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
    });
    expect(cleanup).toBeFalsy();
  });

  it('returns a falsy cleanup when the active heat has no live countdown (e.g. manual mode)', () => {
    const container = document.createElement('div');
    const cleanup = mountViewerBody(
      container,
      appHeatFixture({ timingMode: 'manual', startedAt: '2026-08-28T00:00:00Z' }),
    );
    expect(cleanup).toBeFalsy();
  });

  it('shows no countdown, not "NaN:NaN", when durationSecs is missing on an otherwise-live app heat', () => {
    const container = document.createElement('div');
    const cleanup = mountViewerBody(container, appHeatFixture({ durationSecs: undefined }));
    expect(container.querySelector('.viewer-countdown')).toBeNull();
    expect(container.textContent).not.toContain('NaN');
    expect(cleanup).toBeFalsy();
  });

  it('announces once, non-visually, on crossing into the urgent window', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture({ durationSecs: 12 }));
    const announcement = () => container.querySelector('.sr-only');
    expect(announcement().textContent).toBe('');
    vi.advanceTimersByTime(2000); // 10s remaining — crosses the threshold
    expect(announcement().textContent).toBe('Less than 10 seconds remaining.');
    const textAfterFirstCross = announcement().textContent;
    vi.advanceTimersByTime(1000); // 9s remaining — still urgent, not a new crossing
    expect(announcement().textContent).toBe(textAfterFirstCross); // unchanged, not re-announced
  });

  it('announces once, non-visually, on expiry — distinct from the urgent message', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture({ durationSecs: 2 }));
    vi.advanceTimersByTime(3000);
    expect(container.querySelector('.sr-only').textContent).toBe('Time is up.');
  });

  it('the countdown digits themselves stay aria-live="off" throughout — the announcement node is the separate, sparse channel', () => {
    const container = document.createElement('div');
    mountViewerBody(container, appHeatFixture());
    expect(container.querySelector('.viewer-countdown').getAttribute('aria-live')).toBe('off');
    const announcement = container.querySelector('.sr-only');
    expect(announcement.getAttribute('aria-live')).toBe('polite');
  });
});

describe('mountViewerBody — recent heats', () => {
  it('omits the section entirely when there are no recent heats', () => {
    const container = document.createElement('div');
    mountViewerBody(container, { standings: [{ position: 1, displayName: 'Alex' }] });
    expect(container.querySelector('.viewer-recent-heats')).toBeNull();
  });

  it("sorts each heat's results by most correct, then fastest time", () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [{ position: 1, displayName: 'Alex' }],
      recentHeats: [
        {
          heatNumber: 1,
          stageKind: 'prelims',
          results: [
            { displayName: 'Slow Winner', numCorrect: 5, totalElapsedSecs: 300 },
            { displayName: 'Fast Winner', numCorrect: 5, totalElapsedSecs: 200 },
            { displayName: 'Runner Up', numCorrect: 3, totalElapsedSecs: 100 },
          ],
        },
      ],
    });
    const names = [...container.querySelectorAll('.viewer-recent-heat-list li')].map(
      (li) => li.textContent,
    );
    expect(names[0]).toContain('Fast Winner');
    expect(names[1]).toContain('Slow Winner');
    expect(names[2]).toContain('Runner Up');
  });

  it("renders one block per recent heat, most recent last as given (caller's own ordering)", () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      standings: [],
      recentHeats: [
        { heatNumber: 1, stageKind: 'prelims', results: [] },
        { heatNumber: 2, stageKind: 'prelims', results: [] },
      ],
    });
    const blocks = [...container.querySelectorAll('.viewer-recent-heat')];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toContain('Heat 1');
    expect(blocks[1].textContent).toContain('Heat 2');
  });
});

describe('mountViewerBody — section composition', () => {
  it('renders standings, active heat, and recent heats together, in that order', () => {
    const container = document.createElement('div');
    mountViewerBody(container, {
      stage: { kind: 'prelims', setCount: 5 },
      standings: [{ position: 1, displayName: 'Alex', numCorrect: 5, totalElapsedSecs: 200 }],
      activeHeat: {
        heatNumber: 2,
        stageKind: 'prelims',
        status: 'timing',
        timingMode: 'app',
        startedAt: '2026-08-28T00:00:00Z',
        durationSecs: 480,
        cuppers: [baseCupper()],
      },
      recentHeats: [{ heatNumber: 1, stageKind: 'prelims', results: [] }],
    });
    const sectionOrder = [...container.children].map((node) =>
      node.matches('h2, .viewer-active-heat, .viewer-recent-heats, table')
        ? node.className || node.tagName.toLowerCase()
        : null,
    );
    expect(sectionOrder).toEqual([
      'h2',
      'standings-table',
      'card viewer-active-heat',
      'viewer-recent-heats',
    ]);
  });
});
