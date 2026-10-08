import { describe, it, expect, vi } from 'vitest';
import { createScreenDirector } from './screenDirector.js';

// A screen that records what happened to it.
function makeScreen(key, { minDwellMs = 0, urgent = false, log } = {}) {
  return {
    key,
    minDwellMs,
    urgent,
    mount(host, payload) {
      log.push(`mount:${key}:${payload}`);
      const node = document.createElement('div');
      node.dataset.screen = key;
      host.append(node);
      return {
        update: (next) => log.push(`update:${key}:${next}`),
        destroy: () => log.push(`destroy:${key}`),
      };
    },
  };
}

function setUp() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  const host = document.createElement('div');
  const log = [];
  const director = createScreenDirector({ host });
  const screen = (key, options) => makeScreen(key, { ...options, log });
  return { host, log, director, screen };
}
const shown = (host) => [...host.children].map((c) => c.dataset.screen);

describe('createScreenDirector', () => {
  it('mounts the first screen asked for, at once', () => {
    const { host, log, director, screen } = setUp();
    try {
      director.show(screen('heat'), 'p1');
      expect(shown(host)).toEqual(['heat']);
      expect(log).toEqual(['mount:heat:p1']);
      expect(director.currentKey()).toBe('heat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates the same screen in place instead of remounting it (a ticking countdown keeps its place)', () => {
    const { host, log, director, screen } = setUp();
    try {
      const heat = screen('heat');
      director.show(heat, 'p1');
      director.show(heat, 'p2');
      expect(log).toEqual(['mount:heat:p1', 'update:heat:p2']);
      expect(host.children).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the screen at once when the current one has no minimum dwell', () => {
    const { host, log, director, screen } = setUp();
    try {
      director.show(screen('idle'), 'p1');
      director.show(screen('heat'), 'p2');
      expect(shown(host)).toEqual(['heat']);
      expect(log).toEqual(['mount:idle:p1', 'destroy:idle', 'mount:heat:p2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a screen for its minimum dwell, then shows what was asked for', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      vi.advanceTimersByTime(3_000);
      director.show(screen('idle'), 'p2');
      expect(shown(host)).toEqual(['scoring']); // not cut off mid-read
      vi.advanceTimersByTime(4_999);
      expect(shown(host)).toEqual(['scoring']);
      vi.advanceTimersByTime(1);
      expect(shown(host)).toEqual(['idle']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an urgent screen arriving while a change is already waiting replaces it for good: the stale wait must not fire later and take the running screen away', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      director.show(screen('idle'), 'p2'); // waits for the 8s hold
      vi.advanceTimersByTime(2_000);
      director.show(screen('heat', { urgent: true }), 'p3');
      expect(shown(host)).toEqual(['heat']);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(shown(host)).toEqual(['heat']); // not swapped for the idle screen six seconds later
    } finally {
      vi.useRealTimers();
    }
  });

  it('the hold is the CURRENT screen’s own minimum, not the longer of the two: a short-held screen is replaced at once even by a long-held one', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('idle'), 'p1'); // no minimum
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p2');
      expect(shown(host)).toEqual(['scoring']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets an urgent screen through at once, whatever the current one is holding', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('champion', { minDwellMs: 60_000 }), 'p1');
      vi.advanceTimersByTime(1_000);
      director.show(screen('heat', { urgent: true }), 'p2');
      expect(shown(host)).toEqual(['heat']);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces what arrives while holding: only the latest request is shown when the hold ends', () => {
    const { host, log, director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      director.show(screen('idle'), 'p2');
      vi.advanceTimersByTime(2_000);
      director.show(screen('champion'), 'p3');
      vi.advanceTimersByTime(10_000);
      expect(shown(host)).toEqual(['champion']);
      expect(log.filter((entry) => entry.startsWith('mount:'))).toEqual([
        'mount:scoring:p1',
        'mount:champion:p3',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asking for the current screen again cancels a pending change', () => {
    const { host, director, screen } = setUp();
    try {
      const scoring = screen('scoring', { minDwellMs: 8_000 });
      director.show(scoring, 'p1');
      director.show(screen('idle'), 'p2');
      director.show(scoring, 'p3'); // the wish to leave is withdrawn
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(shown(host)).toEqual(['scoring']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps updating the current screen while a change is pending', () => {
    const { log, director, screen } = setUp();
    try {
      const scoring = screen('scoring', { minDwellMs: 8_000 });
      director.show(scoring, 'p1');
      director.show(screen('idle'), 'p2');
      expect(log).not.toContain('update:scoring:p2'); // a different screen was asked for, not this one
      director.show(scoring, 'p3');
      expect(log).toContain('update:scoring:p3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures the dwell from when the current screen was shown, not from the request', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      vi.advanceTimersByTime(9_000);
      director.show(screen('idle'), 'p2'); // already held long enough
      expect(shown(host)).toEqual(['idle']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('show(null) tears the current screen down and empties the host', () => {
    const { host, log, director, screen } = setUp();
    try {
      director.show(screen('idle'), 'p1');
      director.show(null);
      expect(host.children).toHaveLength(0);
      expect(log).toContain('destroy:idle');
      expect(director.currentKey()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('show(null) also drops a pending change', () => {
    const { director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      director.show(screen('idle'), 'p2');
      director.show(null);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy() destroys the current screen, clears its timer, and ignores later requests', () => {
    const { host, log, director, screen } = setUp();
    try {
      director.show(screen('scoring', { minDwellMs: 8_000 }), 'p1');
      director.show(screen('idle'), 'p2');
      director.destroy();
      expect(log).toContain('destroy:scoring');
      expect(vi.getTimerCount()).toBe(0);
      director.show(screen('heat'), 'p3');
      vi.advanceTimersByTime(60_000);
      expect(log.filter((entry) => entry.startsWith('mount:'))).toEqual(['mount:scoring:p1']);
      expect(host.children).toHaveLength(1); // left as it was; nothing new was added
    } finally {
      vi.useRealTimers();
    }
  });

  describe('onShown: the payload whose screen is actually on show', () => {
    function withShown() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
      const host = document.createElement('div');
      const log = [];
      const shownPayloads = [];
      const director = createScreenDirector({
        host,
        onShown: (payload) => shownPayloads.push(payload),
      });
      return {
        host,
        log,
        director,
        shownPayloads,
        screen: (key, o) => makeScreen(key, { ...o, log }),
      };
    }

    it('reports a mount, and an in-place update of the same screen', () => {
      const { director, screen, shownPayloads } = withShown();
      try {
        const live = screen('live');
        director.show(live, 'p1');
        director.show(live, 'p2');
        expect(shownPayloads).toEqual(['p1', 'p2']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT report a request that is still waiting out a hold, and reports it when the hold ends', () => {
      const { director, screen, shownPayloads } = withShown();
      try {
        director.show(screen('hold', { minDwellMs: 8_000 }), 'p1');
        director.show(screen('next'), 'p2');
        expect(shownPayloads).toEqual(['p1']); // p2 is not on screen yet
        vi.advanceTimersByTime(8_000);
        expect(shownPayloads).toEqual(['p1', 'p2']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports null when nothing is shown', () => {
      const { director, screen, shownPayloads } = withShown();
      try {
        director.show(screen('live'), 'p1');
        director.show(null);
        expect(shownPayloads).toEqual(['p1', null]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('a screen that throws while mounting leaves nothing pointing at the one it replaced', () => {
    const { host, director, screen } = setUp();
    try {
      director.show(screen('good'), 'p1');
      const bad = {
        key: 'bad',
        mount: () => {
          throw new Error('boom');
        },
      };
      expect(() => director.show(bad, 'p2')).toThrow('boom');
      expect(director.currentKey()).toBeNull();
      expect(host.children).toHaveLength(0);
      director.show(screen('good'), 'p3'); // a later request mounts afresh instead of updating a dead handle
      expect(shown(host)).toEqual(['good']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a screen with no update() when the same screen is asked for again', () => {
    const { director } = setUp();
    try {
      const bare = {
        key: 'bare',
        mount: () => ({ destroy() {} }),
      };
      director.show(bare, 'p1');
      expect(() => director.show(bare, 'p2')).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
