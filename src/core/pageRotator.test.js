import { describe, it, expect, vi } from 'vitest';
import { paginate, pageRange, createPageRotator } from './pageRotator.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe('paginate', () => {
  it('splits a list into full pages and a shorter last one, in order', () => {
    const pages = paginate(items(17), 8);
    expect(pages.map((page) => page.length)).toEqual([8, 8, 1]);
    expect(pages.flat().map((item) => item.id)).toEqual(items(17).map((item) => item.id));
  });

  it('gives one page for a list that fits, and no pages for an empty list', () => {
    expect(paginate(items(8), 8)).toHaveLength(1);
    expect(paginate(items(3), 8)).toHaveLength(1);
    expect(paginate([], 8)).toEqual([]);
  });

  it.each([[0], [-1], [1.5], [NaN], ['8'], [undefined]])('refuses a page size of %s', (size) => {
    expect(() => paginate(items(3), size)).toThrow(TypeError);
  });

  describe('keeping a group together', () => {
    const tied = (positions) => positions.map((position, i) => ({ id: i, position }));
    const groupOf = (row) => row.position;

    it('moves a group that straddles a page boundary to the next page whole', () => {
      // positions 1..6 alone, then a three-way tie at 7 split by the page boundary at 8
      const rows = tied([1, 2, 3, 4, 5, 6, 7, 7, 7, 10]);
      const pages = paginate(rows, 8, { groupOf });
      expect(pages.map((page) => page.map((r) => r.position))).toEqual([
        [1, 2, 3, 4, 5, 6],
        [7, 7, 7, 10],
      ]);
    });

    it('does not move anything when the boundary falls between groups', () => {
      const rows = tied([1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
      const pages = paginate(rows, 8, { groupOf });
      expect(pages.map((page) => page.length)).toEqual([8, 2]);
    });

    it('splits a group that fills a whole page, since nothing else is possible', () => {
      const rows = tied([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
      const pages = paginate(rows, 4, { groupOf });
      expect(pages.map((page) => page.length)).toEqual([4, 4, 2]);
    });

    it('keeps a group that exactly fills a page together (it fits, so the page before is cut short)', () => {
      const rows = tied([1, 2, 9, 9, 9, 9, 10]);
      const pages = paginate(rows, 4, { groupOf });
      expect(pages.map((page) => page.map((r) => r.position))).toEqual([
        [1, 2],
        [9, 9, 9, 9],
        [10],
      ]);
    });

    it('does not move a group that is longer than a page: it is split anyway, so moving it would only shorten the page before', () => {
      const rows = tied([1, 2, 3, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
      const pages = paginate(rows, 4, { groupOf });
      expect(pages.map((page) => page.length)).toEqual([4, 4, 4]);
    });

    it('never loses or repeats a row however groups fall', () => {
      for (let n = 1; n <= 30; n += 1) {
        const rows = tied(Array.from({ length: n }, (_, i) => Math.floor(i / 3)));
        const pages = paginate(rows, 8, { groupOf });
        expect(pages.flat().map((r) => r.id)).toEqual(rows.map((r) => r.id));
        for (const page of pages) expect(page.length).toBeLessThanOrEqual(8);
      }
    });
  });
});

describe('pageRange', () => {
  it('gives the 1-based first and last item of a page and the total, for a "9 to 16 of 17" label', () => {
    const pages = paginate(items(17), 8);
    expect(pageRange(pages, 0)).toEqual({ first: 1, last: 8, total: 17 });
    expect(pageRange(pages, 1)).toEqual({ first: 9, last: 16, total: 17 });
    expect(pageRange(pages, 2)).toEqual({ first: 17, last: 17, total: 17 });
  });

  it('follows pages that are not all the same size (a tie moved to the next page)', () => {
    const pages = [[1, 2, 3], [4, 5, 6, 7], [8]];
    expect(pageRange(pages, 1)).toEqual({ first: 4, last: 7, total: 8 });
  });
});

describe('createPageRotator', () => {
  function harness({ pageCount, dwellMs = 10_000 }) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    const shown = [];
    const rotator = createPageRotator({
      pageCount,
      dwellMs,
      onPage: (index, info) => shown.push([index, info.dwellMs, info.startedAt]),
    });
    return { rotator, shown };
  }

  it('shows page 0 at once, then each next page after the dwell, and wraps round', () => {
    const { rotator, shown } = harness({ pageCount: 3 });
    try {
      rotator.start();
      expect(shown.map(([i]) => i)).toEqual([0]);
      vi.advanceTimersByTime(9_999);
      expect(shown).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(shown.map(([i]) => i)).toEqual([0, 1]);
      vi.advanceTimersByTime(20_000);
      expect(shown.map(([i]) => i)).toEqual([0, 1, 2, 0]);
      rotator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the caller how long each page is held and when it started, for the ring', () => {
    const { rotator, shown } = harness({ pageCount: 2, dwellMs: 7_000 });
    try {
      rotator.start();
      vi.advanceTimersByTime(7_000);
      expect(shown[0]).toEqual([0, 7_000, new Date('2026-10-08T10:00:00Z').getTime()]);
      expect(shown[1]).toEqual([1, 7_000, new Date('2026-10-08T10:00:07Z').getTime()]);
      rotator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a single page is shown once and never sets a timer', () => {
    const { rotator, shown } = harness({ pageCount: 1 });
    try {
      rotator.start();
      expect(shown).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no pages shows nothing and sets no timer', () => {
    const { rotator, shown } = harness({ pageCount: 0 });
    try {
      rotator.start();
      expect(shown).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() ends rotation and clears its timer', () => {
    const { rotator, shown } = harness({ pageCount: 3 });
    try {
      rotator.start();
      rotator.stop();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(shown).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starting twice does not run two loops', () => {
    const { rotator, shown } = harness({ pageCount: 3 });
    try {
      rotator.start();
      rotator.start();
      vi.advanceTimersByTime(10_000);
      expect(shown.map(([i]) => i)).toEqual([0, 1]);
      expect(vi.getTimerCount()).toBe(1);
      rotator.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be restarted after a stop, from the first page', () => {
    const { rotator, shown } = harness({ pageCount: 3 });
    try {
      rotator.start();
      vi.advanceTimersByTime(10_000);
      rotator.stop();
      rotator.start();
      expect(shown.map(([i]) => i)).toEqual([0, 1, 0]);
      rotator.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
