import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  selectProjectorScreen,
  projectorBand,
  hasProjectorContent,
  STANDINGS_PAGE_SIZE,
  PAGE_DWELL_MS,
} from './projectorScreens.js';

afterEach(() => {
  vi.useRealTimers();
});

const row = (position, displayName, extra = {}) => ({
  position,
  displayName,
  numCorrect: 3,
  totalElapsedSecs: 200 + position,
  tieStatus: null,
  ...extra,
});
const standingsOf = (n) => Array.from({ length: n }, (_, i) => row(i + 1, `Cupper ${i + 1}`));
const stage = { kind: 'prelims', ordinal: 1, setCount: 7 };

function heat(overrides = {}) {
  return {
    heatNumber: 3,
    stageKind: 'prelims',
    status: 'timing',
    timingMode: 'app',
    startedAt: new Date().toISOString(),
    durationSecs: 480,
    cuppers: [
      { displayName: 'Wilky', station: 'A', totalElapsedSecs: null, maxed: false },
      { displayName: 'Taufiq', station: 'B', totalElapsedSecs: 195, maxed: false },
      { displayName: 'Hazman', station: 'C', totalElapsedSecs: 480, maxed: true },
    ],
    ...overrides,
  };
}
const upNext = {
  heatNumber: 4,
  stageKind: 'prelims',
  cuppers: [
    { displayName: 'Ayu', station: 'A' },
    { displayName: 'Bima', station: 'B' },
  ],
};

// Mounts whichever screen the payload selects, the way the director would.
function mountFor(payload) {
  const screen = selectProjectorScreen(payload);
  const host = document.createElement('div');
  const handle = screen.mount(host, payload);
  return { screen, host, handle };
}
const text = (host, selector) => host.querySelector(selector)?.textContent ?? null;

describe('selectProjectorScreen', () => {
  it('a decided tournament shows the champion, whatever else the payload carries', () => {
    const payload = {
      champion: 'Wilky',
      activeHeat: heat(),
      standings: standingsOf(3),
      upNext,
      stage,
    };
    expect(selectProjectorScreen(payload).key).toBe('champion');
  });

  it('a heat being timed shows the heat screen, and it is urgent (a live countdown never waits)', () => {
    const screen = selectProjectorScreen({ activeHeat: heat(), standings: standingsOf(3), stage });
    expect(screen.key).toBe('heat');
    expect(screen.urgent).toBe(true);
  });

  it('a heat being scored shows "being scored", held for a while so it is not flashed past', () => {
    const screen = selectProjectorScreen({
      activeHeat: heat({ status: 'scoring' }),
      standings: standingsOf(3),
      stage,
    });
    expect(screen.key).toBe('scoring');
    expect(screen.minDwellMs).toBeGreaterThan(0);
  });

  it('with no heat running, standings or an up-next heat show the idle loop', () => {
    expect(selectProjectorScreen({ standings: standingsOf(3), stage }).key).toBe('idle');
    expect(selectProjectorScreen({ upNext, standings: [], stage }).key).toBe('idle');
  });

  it('shows nothing when there is nothing to show (the shell’s own holding card covers that)', () => {
    expect(selectProjectorScreen(null)).toBeNull();
    expect(selectProjectorScreen(undefined)).toBeNull();
    expect(selectProjectorScreen({ standings: [], stage })).toBeNull();
    expect(selectProjectorScreen({})).toBeNull();
  });

  it('depends on the payload alone, never on what was shown before', () => {
    const a = { standings: standingsOf(3), stage };
    const b = { activeHeat: heat(), standings: standingsOf(3), stage };
    const first = [selectProjectorScreen(a).key, selectProjectorScreen(b).key];
    const second = [selectProjectorScreen(b).key, selectProjectorScreen(a).key];
    expect(first).toEqual(['idle', 'heat']);
    expect(second).toEqual(['heat', 'idle']);
  });

  it('a champion screen outlasts non-urgent changes, and only a running heat replaces it sooner', () => {
    const champion = selectProjectorScreen({ champion: 'Wilky', standings: standingsOf(3) });
    expect(champion.minDwellMs).toBeGreaterThanOrEqual(30_000);
    expect(champion.urgent).toBe(false);
  });
});

describe('projectorBand', () => {
  it('names the event and the stage in the format’s own words, and is live', () => {
    expect(projectorBand({ eventName: 'Cup 2026', stage })).toEqual({
      eventName: 'Cup 2026',
      sectionLabel: 'Preliminary',
      live: true,
    });
    expect(projectorBand({ stage: { ...stage, kind: 'finals' } }).sectionLabel).toBe('Finals');
  });

  it('copes with a payload published before the event name existed, or with no stage', () => {
    expect(projectorBand({ stage })).toMatchObject({ eventName: null });
    expect(projectorBand({ eventName: 'Cup' })).toMatchObject({ sectionLabel: null });
    expect(projectorBand(null)).toEqual({ eventName: null, sectionLabel: null, live: true });
  });
});

describe('hasProjectorContent', () => {
  it('is exactly "there is a screen for it", so the shell and the selector can never disagree', () => {
    const payloads = [
      { standings: standingsOf(1) },
      { activeHeat: heat() },
      { upNext },
      { champion: 'Wilky' },
      { standings: [] },
      { activeHeat: { ...heat(), status: 'confirmed' } },
      {},
      null,
    ];
    for (const payload of payloads) {
      expect(hasProjectorContent(payload)).toBe(selectProjectorScreen(payload) !== null);
    }
  });

  it('is false for a heat in a state no screen shows, rather than leaving a blank display', () => {
    expect(
      hasProjectorContent({ activeHeat: { ...heat(), status: 'confirmed' }, standings: [] }),
    ).toBe(false);
  });

  it('counts standings, a running heat, an up-next heat or a champion', () => {
    expect(hasProjectorContent({ standings: standingsOf(1) })).toBe(true);
    expect(hasProjectorContent({ activeHeat: heat() })).toBe(true);
    expect(hasProjectorContent({ upNext })).toBe(true);
    expect(hasProjectorContent({ champion: 'Wilky' })).toBe(true);
  });

  it('is false for an empty payload', () => {
    expect(hasProjectorContent({ standings: [] })).toBe(false);
    expect(hasProjectorContent(null)).toBe(false);
    expect(hasProjectorContent({})).toBe(false);
  });
});

describe('heat screen', () => {
  it('shows the heat number, the shared live countdown, and each cupper on a station card', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ activeHeat: heat(), standings: standingsOf(3), stage });
    expect(text(host, '.stage-title')).toBe('Heat 3');
    expect(host.querySelector('.viewer-countdown')).not.toBeNull();
    expect(text(host, '.projector-clock-label')).toBe('Time remaining');
    const cards = [...host.querySelectorAll('.projector-station')];
    expect(cards.map((c) => text(c, '.projector-station-label'))).toEqual([
      'Station A',
      'Station B',
      'Station C',
    ]);
    expect(cards.map((c) => text(c, '.projector-station-name'))).toEqual([
      'Wilky',
      'Taufiq',
      'Hazman',
    ]);
    handle.destroy();
  });

  it('says how each cupper is getting on in words: timing, their time, or max time', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ activeHeat: heat(), standings: standingsOf(3), stage });
    const notes = [...host.querySelectorAll('.projector-station-note')].map((n) => n.textContent);
    expect(notes).toEqual(['Timing', 'Finished 3:15', 'Max time']);
    handle.destroy();
  });

  it('a heat timed by hand that has not started shows no clock, never a zeroed one', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({
      activeHeat: heat({ timingMode: 'manual', startedAt: null }),
      standings: standingsOf(3),
      stage,
    });
    expect(host.querySelector('.viewer-countdown')).toBeNull();
    expect(text(host, '.projector-clock-label')).toBe('Timed by hand');
    handle.destroy();
  });

  it('names who is up next and who is leading in the footer', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({
      activeHeat: heat(),
      standings: standingsOf(3),
      upNext,
      stage,
    });
    expect(text(host, '.stage-footer-start')).toBe('Up next: Heat 4');
    expect(text(host, '.stage-footer-end')).toBe('Leading: Cupper 1 · 3/7 · 3:21');
    handle.destroy();
  });

  it('leaves the footer quiet when there is no next heat and no standings yet', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ activeHeat: heat(), standings: [], stage });
    expect(text(host, '.stage-footer-start')).toBe('');
    expect(text(host, '.stage-footer-end')).toBe('');
    handle.destroy();
  });

  it('repaints when only the up-next heat, the leader or the set count changes', () => {
    vi.useFakeTimers();
    const payload = { activeHeat: heat(), standings: standingsOf(3), upNext, stage };
    const { host, handle } = mountFor(payload);
    handle.update({ ...payload, upNext: { ...upNext, heatNumber: 5 } });
    expect(text(host, '.stage-footer-start')).toBe('Up next: Heat 5');
    handle.update({
      ...payload,
      upNext: { ...upNext, heatNumber: 5 },
      standings: [row(1, 'New Leader'), row(2, 'B')],
    });
    expect(text(host, '.stage-footer-end')).toContain('New Leader');
    handle.update({
      ...payload,
      upNext: { ...upNext, heatNumber: 5 },
      standings: [row(1, 'New Leader'), row(2, 'B')],
      stage: { ...stage, setCount: 9 },
    });
    expect(text(host, '.stage-footer-end')).toContain('3/9');
    handle.destroy();
  });

  it('a republish with nothing changed keeps the same countdown element (its one-time announcements are not re-armed)', () => {
    vi.useFakeTimers();
    const payload = { activeHeat: heat(), standings: standingsOf(3), stage };
    const { host, handle } = mountFor(payload);
    const countdown = host.querySelector('.viewer-countdown');
    handle.update({ ...payload, standings: [...payload.standings] });
    expect(host.querySelector('.viewer-countdown')).toBe(countdown);
    handle.destroy();
  });

  it('repaints in place on an update without leaking a second countdown timer', () => {
    vi.useFakeTimers();
    const payload = { activeHeat: heat(), standings: standingsOf(3), stage };
    const { host, handle } = mountFor(payload);
    expect(vi.getTimerCount()).toBe(1);
    handle.update({
      ...payload,
      activeHeat: heat({
        cuppers: [{ displayName: 'Wilky', station: 'A', totalElapsedSecs: 120, maxed: false }],
      }),
    });
    expect(vi.getTimerCount()).toBe(1);
    expect(host.querySelectorAll('.projector-station')).toHaveLength(1);
    expect(host.querySelectorAll('.viewer-countdown')).toHaveLength(1);
    handle.destroy();
  });

  it('destroy() stops the countdown', () => {
    vi.useFakeTimers();
    const { handle } = mountFor({ activeHeat: heat(), standings: standingsOf(3), stage });
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders names as text, never as markup', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({
      activeHeat: heat({
        cuppers: [{ displayName: '<b>x</b>', station: 'A', totalElapsedSecs: null, maxed: false }],
      }),
      standings: [],
      stage,
    });
    expect(host.querySelector('.projector-station-name b')).toBeNull();
    expect(text(host, '.projector-station-name')).toBe('<b>x</b>');
    handle.destroy();
  });
});

describe('tiebreak heats are named as such (they number from 1 again)', () => {
  it('on the heat screen, the scoring screen, the up-next page and the footer', () => {
    vi.useFakeTimers();
    const tiebreak = heat({ heatNumber: 1, kind: 'tiebreak' });
    const running = mountFor({ activeHeat: tiebreak, standings: standingsOf(3), stage });
    expect(text(running.host, '.stage-title')).toBe('Heat 1 (tiebreak)');
    running.handle.destroy();

    const scoring = mountFor({
      activeHeat: { ...tiebreak, status: 'scoring' },
      standings: [],
      stage,
    });
    expect(text(scoring.host, '.stage-title')).toBe('Heat 1 (tiebreak) is being scored');

    const idle = mountFor({
      standings: standingsOf(3),
      upNext: { ...upNext, heatNumber: 1, kind: 'tiebreak' },
      stage,
    });
    expect(text(idle.host, '.stage-title')).toBe('Heat 1 (tiebreak) starts soon');
    idle.handle.destroy();

    const footer = mountFor({
      activeHeat: heat(),
      standings: standingsOf(3),
      upNext: { ...upNext, heatNumber: 1, kind: 'tiebreak' },
      stage,
    });
    expect(text(footer.host, '.stage-footer-start')).toBe('Up next: Heat 1 (tiebreak)');
    footer.handle.destroy();
  });

  it('a payload published before the kind existed still reads "Heat N"', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({
      activeHeat: heat({ kind: undefined }),
      standings: [],
      stage,
    });
    expect(text(host, '.stage-title')).toBe('Heat 3');
    handle.destroy();
  });
});

describe('five or more stations take the compact layout', () => {
  const cuppers = (n) =>
    Array.from({ length: n }, (_, i) => ({
      displayName: `Cupper ${i + 1}`,
      station: String.fromCharCode(65 + i),
      totalElapsedSecs: null,
      maxed: false,
    }));

  it('a heat of four or fewer keeps the roomy layout, five or six switch to the compact one', () => {
    vi.useFakeTimers();
    for (const [n, compact] of [
      [1, false],
      [4, false],
      [5, true],
      [6, true],
    ]) {
      const { host, handle } = mountFor({
        activeHeat: heat({ cuppers: cuppers(n) }),
        standings: standingsOf(3),
        stage,
      });
      expect(host.querySelector('.stage-main').classList.contains('projector-many')).toBe(compact);
      expect(host.querySelectorAll('.projector-station')).toHaveLength(n);
      handle.destroy();
    }
  });

  it('the compact layout follows an update that grows or shrinks the heat', () => {
    vi.useFakeTimers();
    const payload = { activeHeat: heat({ cuppers: cuppers(4) }), standings: standingsOf(3), stage };
    const { host, handle } = mountFor(payload);
    handle.update({ ...payload, activeHeat: heat({ cuppers: cuppers(6) }) });
    expect(host.querySelector('.stage-main').classList.contains('projector-many')).toBe(true);
    handle.update({ ...payload, activeHeat: heat({ cuppers: cuppers(3) }) });
    expect(host.querySelector('.stage-main').classList.contains('projector-many')).toBe(false);
    handle.destroy();
  });

  it('the "up next" page uses the compact layout for a big heat, and drops it again on the standings pages', () => {
    vi.useFakeTimers();
    const big = { ...upNext, cuppers: cuppers(6) };
    const { host, handle } = mountFor({ standings: standingsOf(17), upNext: big, stage });
    const main = host.querySelector('.stage-main');
    expect(main.classList.contains('projector-many')).toBe(true);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(main.classList.contains('projector-many')).toBe(false);
    handle.destroy();
  });
});

describe('scoring screen', () => {
  it('says time is up and that the heat is being scored, and what is next', () => {
    const { host } = mountFor({
      activeHeat: heat({ status: 'scoring' }),
      standings: standingsOf(3),
      upNext,
      stage,
    });
    expect(text(host, '.stage-kicker')).toBe('Time is up');
    expect(text(host, '.stage-title')).toBe('Heat 3 is being scored');
    expect(text(host, '.stage-support')).toBe('Results appear here as soon as the judges confirm.');
    expect(text(host, '.stage-footer-start')).toBe('Up next: Heat 4');
  });

  it('follows the heat number through an update', () => {
    const payload = { activeHeat: heat({ status: 'scoring' }), standings: [], stage };
    const { host, handle } = mountFor(payload);
    handle.update({ ...payload, activeHeat: heat({ status: 'scoring', heatNumber: 5 }) });
    expect(text(host, '.stage-title')).toBe('Heat 5 is being scored');
  });
});

describe('idle screen', () => {
  const rowsOf = (host) => [...host.querySelectorAll('.stage-standing-row')];

  it('shows the up-next page first, listing the heat and who is on which station', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), upNext, stage });
    expect(text(host, '.stage-kicker')).toBe('Up next');
    expect(text(host, '.stage-title')).toBe('Heat 4 starts soon');
    expect([...host.querySelectorAll('.projector-station-name')].map((n) => n.textContent)).toEqual(
      ['Ayu', 'Bima'],
    );
    handle.destroy();
  });

  it('then pages the standings, eight rows a page, each held for the dwell, round and round', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), upNext, stage });
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(rowsOf(host)).toHaveLength(STANDINGS_PAGE_SIZE);
    expect(text(host, '.stage-title')).toBe('Preliminary standings');
    expect(text(host, '.stage-range')).toBe('1 to 8 of 17');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-range')).toBe('9 to 16 of 17');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(rowsOf(host)).toHaveLength(1);
    expect(text(host, '.stage-range')).toBe('17 of 17'); // a one-row page says so plainly
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Heat 4 starts soon'); // back round to the start
    handle.destroy();
  });

  it('shows every cupper exactly once across the pages', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), stage });
    const seen = [];
    for (let page = 0; page < 3; page += 1) {
      seen.push(...rowsOf(host).map((r) => r.querySelector('.stage-standing-name').textContent));
      vi.advanceTimersByTime(PAGE_DWELL_MS);
    }
    expect(seen).toEqual(standingsOf(17).map((r) => r.displayName));
    handle.destroy();
  });

  it('counts the pages in the footer and draws the page-change ring, with who is next', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), upNext, stage });
    expect(text(host, '.stage-footer-start')).toBe('Up next');
    expect(host.querySelector('.stage-footer-end .stage-ring')).not.toBeNull();
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toBe('Standings · page 1 of 3 · Up next: Heat 4');
    expect(host.querySelector('.stage-footer-end .stage-ring')).not.toBeNull();
    handle.destroy();
  });

  it('the ring counts down the dwell of the page being shown', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), stage });
    expect(text(host, '.stage-ring-count')).toBe(String(PAGE_DWELL_MS / 1000));
    vi.advanceTimersByTime(4_000);
    expect(text(host, '.stage-ring-count')).toBe(String(PAGE_DWELL_MS / 1000 - 4));
    vi.advanceTimersByTime(PAGE_DWELL_MS - 4_000);
    expect(text(host, '.stage-ring-count')).toBe(String(PAGE_DWELL_MS / 1000)); // the next page began
    handle.destroy();
  });

  it('one page of standings with nothing up next stays put: no rotation, no ring, no timers', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(5), stage });
    expect(rowsOf(host)).toHaveLength(5);
    expect(text(host, '.stage-range')).toBe('5 cuppers');
    expect(host.querySelector('.stage-ring')).toBeNull();
    expect(text(host, '.stage-footer-start')).toBe('Standings');
    expect(vi.getTimerCount()).toBe(0);
    handle.destroy();
  });

  it('writes ties and advancing places in the row, not just in a colour', () => {
    vi.useFakeTimers();
    const standings = [
      row(1, 'Alex', { tieStatus: 'advancing' }),
      row(2, 'Jordan', { tieStatus: 'tied' }),
      row(2, 'Sam', { tieStatus: 'tied' }),
      row(4, 'Priya'),
    ];
    const { host, handle } = mountFor({ standings, stage });
    expect(rowsOf(host).map((r) => r.querySelector('.stage-standing-name').textContent)).toEqual([
      'Alex (advancing)',
      'Jordan (tied)',
      'Sam (tied)',
      'Priya',
    ]);
    handle.destroy();
  });

  it('puts the tie/advancing words in their own element, so a long name is cut with an ellipsis and never the words', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({
      standings: [row(1, 'A very long name indeed', { tieStatus: 'tied' }), row(2, 'Bo')],
      stage,
    });
    const first = rowsOf(host)[0];
    expect(text(first, '.stage-name-text')).toBe('A very long name indeed');
    expect(text(first, '.stage-name-suffix')).toBe(' (tied)');
    expect(rowsOf(host)[1].querySelector('.stage-name-suffix')).toBeNull();
    handle.destroy();
  });

  it('keeps a tie together: a group straddling the page boundary moves to the next page whole', () => {
    vi.useFakeTimers();
    const standings = [
      ...Array.from({ length: 6 }, (_, i) => row(i + 1, `Cupper ${i + 1}`)),
      row(7, 'Tied A'),
      row(7, 'Tied B'),
      row(7, 'Tied C'),
      row(10, 'Last'),
    ];
    const { host, handle } = mountFor({ standings, stage });
    expect(rowsOf(host)).toHaveLength(6);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(rowsOf(host).map((r) => r.querySelector('.stage-standing-name').textContent)).toEqual([
      'Tied A',
      'Tied B',
      'Tied C',
      'Last',
    ]);
    handle.destroy();
  });

  it('gives the score and time columns their widths, so the name column takes the rest', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: [row(1, 'Alex')], stage });
    const cells = [...rowsOf(host)[0].querySelectorAll('.stage-standing-cell')];
    expect(cells.map((cell) => cell.style.width)).toEqual(['12vw', '14vw']);
    handle.destroy();
  });

  it('shows a time with a spoken form, and a dash for no time', () => {
    vi.useFakeTimers();
    const standings = [
      row(1, 'Alex', { totalElapsedSecs: 195 }),
      row(2, 'Bo', { totalElapsedSecs: null }),
    ];
    const { host, handle } = mountFor({ standings, stage });
    const times = rowsOf(host).map(
      (r) => r.querySelectorAll('.stage-standing-cell')[1].textContent,
    );
    expect(times[0]).toContain('3:15');
    expect(times[0]).toMatch(/3 minutes/);
    expect(times[1]).toBe('—');
    handle.destroy();
  });

  it('a republish with nothing changed does not send the room back to the first page', () => {
    vi.useFakeTimers();
    const payload = { standings: standingsOf(17), upNext, stage };
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-range')).toBe('1 to 8 of 17');
    handle.update({ ...payload, standings: [...payload.standings] });
    expect(text(host, '.stage-range')).toBe('1 to 8 of 17');
    handle.destroy();
  });

  it('new standings restart the loop from the first page with the new data', () => {
    vi.useFakeTimers();
    const payload = { standings: standingsOf(17), stage };
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    handle.update({ ...payload, standings: standingsOf(12) });
    expect(text(host, '.stage-range')).toBe('1 to 8 of 12');
    expect(vi.getTimerCount()).toBe(2); // one page timer and one ring tick — nothing doubled, nothing lost
    handle.destroy();
  });

  it('repaints when only the up-next heat changes', () => {
    vi.useFakeTimers();
    const payload = { standings: standingsOf(3), upNext, stage };
    const { host, handle } = mountFor(payload);
    handle.update({ ...payload, upNext: { ...upNext, heatNumber: 5 } });
    expect(text(host, '.stage-title')).toBe('Heat 5 starts soon');
    handle.destroy();
  });

  it('repaints when only the stage changes (nothing else in the payload does)', () => {
    vi.useFakeTimers();
    const standings = standingsOf(3);
    const { host, handle } = mountFor({ standings, stage });
    expect(text(host, '.stage-title')).toBe('Preliminary standings');
    handle.update({ standings, stage: { ...stage, kind: 'finals' } });
    expect(text(host, '.stage-title')).toBe('Finals standings');
    handle.destroy();
  });

  it('writes the standings score as correct/total, or just the count when the stage has no set count, and the positions as ranked', () => {
    vi.useFakeTimers();
    const standings = [row(1, 'A'), row(2, 'B'), row(2, 'C'), row(4, 'D')];
    const withCount = mountFor({ standings, stage });
    const cell = (host, i) =>
      rowsOf(host).map((r) => r.querySelectorAll('.stage-standing-cell')[0 + i].textContent);
    expect(cell(withCount.host, 0)).toEqual(['3/7', '3/7', '3/7', '3/7']);
    expect(
      rowsOf(withCount.host).map((r) => r.querySelector('.stage-standing-pos').textContent),
    ).toEqual(['1', '2', '2', '4']);
    withCount.handle.destroy();
    const noCount = mountFor({ standings, stage: { kind: 'prelims', ordinal: 1 } });
    expect(cell(noCount.host, 0)).toEqual(['3', '3', '3', '3']);
    noCount.handle.destroy();
  });

  it('labels every page in the footer, with who is next, and the count of pages', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(17), upNext, stage });
    const footers = [];
    for (let page = 0; page < 4; page += 1) {
      footers.push(text(host, '.stage-footer-start'));
      vi.advanceTimersByTime(PAGE_DWELL_MS);
    }
    expect(footers).toEqual([
      'Up next',
      'Standings · page 1 of 3 · Up next: Heat 4',
      'Standings · page 2 of 3 · Up next: Heat 4',
      'Standings · page 3 of 3 · Up next: Heat 4',
    ]);
    handle.destroy();
  });

  it('says "page 2 of 2" for two pages (12 rows), and follows a change of the up-next heat in the footer', () => {
    vi.useFakeTimers();
    const payload = { standings: standingsOf(12), upNext, stage };
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS * 2);
    expect(text(host, '.stage-footer-start')).toBe('Standings · page 2 of 2 · Up next: Heat 4');
    handle.update({ ...payload, upNext: { ...upNext, heatNumber: 5 } });
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toBe('Standings · page 1 of 2 · Up next: Heat 5');
    handle.destroy();
  });

  it('uses the compact layout only for an up-next page of MORE than four stations', () => {
    vi.useFakeTimers();
    const upNextOf = (n) => ({
      ...upNext,
      cuppers: Array.from({ length: n }, (_, i) => ({
        displayName: `Cupper ${i + 1}`,
        station: String.fromCharCode(65 + i),
      })),
    });
    const classOf = (n) => {
      const { host, handle } = mountFor({ standings: standingsOf(3), upNext: upNextOf(n), stage });
      const compact = host.querySelector('.stage-main').classList.contains('projector-many');
      handle.destroy();
      return compact;
    };
    expect(classOf(2)).toBe(false);
    expect(classOf(4)).toBe(false);
    expect(classOf(5)).toBe(true);
    expect(classOf(6)).toBe(true);
  });

  it('calls the standings page "Standings" when the payload names no stage', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ standings: standingsOf(3) });
    expect(text(host, '.stage-title')).toBe('Standings');
    handle.destroy();
  });

  it('destroy() stops both the page loop and the ring', () => {
    vi.useFakeTimers();
    const { handle } = mountFor({ standings: standingsOf(17), upNext, stage });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copes with an up-next heat and no standings at all', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor({ upNext, standings: [], stage });
    expect(text(host, '.stage-title')).toBe('Heat 4 starts soon');
    expect(host.querySelector('.stage-ring')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    handle.destroy();
  });
});

describe('champion screen', () => {
  const finals = { kind: 'finals', ordinal: 3, setCount: 7 };
  const standings = [
    row(1, 'Wilky Derikson Gultom', { numCorrect: 3, totalElapsedSecs: 235 }),
    row(2, 'Taufiq Manan'),
    row(3, 'Hazman Husin'),
  ];

  it('shows the champion full screen with their score and time, and the podium', () => {
    const { host } = mountFor({ champion: 'Wilky Derikson Gultom', standings, stage: finals });
    expect(text(host, '.stage-champion-label')).toBe('Champion');
    expect(text(host, '.stage-champion-name')).toBe('Wilky Derikson Gultom');
    expect(text(host, '.stage-champion-score')).toBe('3/7 · 3:55');
    expect(text(host, '.stage-podium')).toBe('2nd Taufiq Manan   ·   3rd Hazman Husin');
    expect(text(host, '.stage-footer-start')).toBe('Finals complete');
    expect(text(host, '.stage-footer-end')).toBe('Final standings stay on screen');
  });

  it('says the stage is "Final" complete when the payload names none, and a dash for a champion with no time', () => {
    const { host } = mountFor({
      champion: 'Ann',
      standings: [row(1, 'Ann', { totalElapsedSecs: null })],
    });
    expect(text(host, '.stage-footer-start')).toBe('Final complete');
    expect(text(host, '.stage-champion-score')).toBe('3 · —');
  });

  it('shows no podium when two cuppers share 1st and the champion is the FIRST listed of them (a tie guard of its own, not just the name check)', () => {
    const { host } = mountFor({
      champion: 'Alex',
      standings: [row(1, 'Alex'), row(1, 'Bailey'), row(3, 'Casey')],
      stage: finals,
    });
    expect(text(host, '.stage-champion-name')).toBe('Alex');
    expect(host.querySelector('.stage-podium')).toBeNull();
    expect(host.textContent).not.toContain('Casey');
  });

  it('never prints the word "null": with no podium, no standings or an unmatched name the missing lines are simply left out', () => {
    for (const payload of [
      { champion: 'Ann', standings: [row(1, 'Ann')], stage: finals },
      { champion: 'Ann', standings: [], stage: finals },
      { champion: 'Ann', stage: finals },
      { champion: 'Ann', standings: [row(1, 'Someone else')], stage: finals },
    ]) {
      const { host } = mountFor(payload);
      expect(host.textContent).not.toMatch(/null|undefined/);
      expect(text(host, '.stage-champion-name')).toBe('Ann');
    }
  });

  it('leaves the score line out when no standings row is the champion’s (never another cupper’s score under their name)', () => {
    const { host } = mountFor({
      champion: 'Ann',
      standings: [row(1, 'Someone else', { numCorrect: 7 })],
      stage: finals,
    });
    expect(host.querySelector('.stage-champion-score')).toBeNull();
  });

  it('shows no podium after a tiebreak, when two cuppers both read 1st and the places could be wrong', () => {
    const { host } = mountFor({
      champion: 'Bailey',
      standings: [row(1, 'Alex'), row(1, 'Bailey'), row(3, 'Casey')],
      stage: finals,
    });
    expect(host.querySelector('.stage-podium')).toBeNull();
  });

  it('takes the score line from the champion’s OWN row even when another row sorts first with a different tally', () => {
    const { host } = mountFor({
      champion: 'Bailey',
      standings: [
        row(1, 'Alex', { numCorrect: 6, totalElapsedSecs: 100 }),
        row(2, 'Bailey', { numCorrect: 4, totalElapsedSecs: 201 }),
      ],
      stage: finals,
    });
    expect(text(host, '.stage-champion-score')).toBe('4/7 · 3:21');
  });

  it('with two cuppers of the same name, shows the tally of the champion at 1st, not the lower one', () => {
    const { host } = mountFor({
      champion: 'Ahmad',
      standings: [
        row(1, 'Ahmad', { numCorrect: 6, totalElapsedSecs: 150 }),
        row(2, 'Bo'),
        row(3, 'Ahmad', { numCorrect: 2, totalElapsedSecs: 400 }),
      ],
      stage: finals,
    });
    expect(text(host, '.stage-champion-score')).toBe('6/7 · 2:30');
  });

  it('after a tie for 2nd there is no 2nd and no 3rd: the cupper at position 4 is never called 3rd', () => {
    const { host } = mountFor({
      champion: 'Ann',
      standings: [row(1, 'Ann'), row(2, 'Bo'), row(2, 'Cy'), row(4, 'Di')],
      stage: finals,
    });
    expect(host.querySelector('.stage-podium')).toBeNull();
    expect(host.textContent).not.toContain('3rd');
    expect(host.textContent).not.toContain('Di');
  });

  it('shows no podium when 1st is not the champion named', () => {
    const { host } = mountFor({
      champion: 'Bailey',
      standings: [row(1, 'Alex'), row(2, 'Bailey'), row(3, 'Casey')],
      stage: finals,
    });
    expect(host.querySelector('.stage-podium')).toBeNull();
  });

  it('names a place only if exactly one cupper holds it: a champion with a unique 2nd but a tied 3rd shows just the 2nd', () => {
    const { host } = mountFor({
      champion: 'Ann',
      standings: [row(1, 'Ann'), row(2, 'Bo'), row(3, 'Cy'), row(3, 'Di')],
      stage: finals,
    });
    expect(text(host, '.stage-podium')).toBe('2nd Bo');
  });

  it('updates in place', () => {
    const payload = { champion: 'Wilky Derikson Gultom', standings, stage: finals };
    const { host, handle } = mountFor(payload);
    handle.update({ ...payload, champion: 'Taufiq Manan' });
    expect(text(host, '.stage-champion-name')).toBe('Taufiq Manan');
  });
});
