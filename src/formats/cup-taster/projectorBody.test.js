import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProjectorBody } from './projectorBody.js';
import { PAGE_DWELL_MS } from './projectorScreens.js';
import { RESULT_HOLD_MS, RANK_HOLD_MS } from './projectorMoments.js';

afterEach(() => {
  vi.useRealTimers();
});

const standingsOf = (n) =>
  Array.from({ length: n }, (_, i) => ({
    position: i + 1,
    displayName: `Cupper ${i + 1}`,
    numCorrect: 3,
    totalElapsedSecs: 200 + i,
  }));
const payload = (extra = {}) => ({
  eventName: 'Cup 2026',
  stage: { kind: 'prelims', setCount: 7 },
  standings: standingsOf(17),
  ...extra,
});

const scoringHeat = () => ({
  heatNumber: 3,
  stageKind: 'prelims',
  status: 'scoring',
  timingMode: 'app',
  startedAt: new Date().toISOString(),
  durationSecs: 480,
  cuppers: [{ displayName: 'Wilky', station: 'A', totalElapsedSecs: 200, maxed: false }],
});

// What viewer-shell does on every live payload: clear the body, then call renderBody again.
function shellRender(body, projector, next) {
  body.replaceChildren();
  projector.renderBody(body, next);
}

describe('createProjectorBody', () => {
  it('mounts the stage display (band and screen) into the shell body', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    expect(body.querySelector('.stage-display')).not.toBeNull();
    expect(body.querySelector('.stage-band-event').textContent).toBe('Cup 2026');
    expect(body.querySelectorAll('.stage-standing-row')).toHaveLength(8);
    projector.destroy();
  });

  it('re-attaches the SAME display on every payload, so the page loop and ring keep their place', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    const first = body.querySelector('.stage-display');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(body.querySelector('.stage-range').textContent).toBe('9 to 16 of 17');
    // an identical republish: the shell clears the body and renders again
    shellRender(body, projector, payload());
    expect(body.querySelector('.stage-display')).toBe(first);
    expect(body.querySelector('.stage-range').textContent).toBe('9 to 16 of 17');
    projector.destroy();
  });

  it('changes screen when the payload changes what it wants', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    expect(body.querySelector('.stage-standings')).not.toBeNull();
    shellRender(
      body,
      projector,
      payload({
        activeHeat: {
          heatNumber: 1,
          stageKind: 'prelims',
          status: 'timing',
          timingMode: 'app',
          startedAt: new Date().toISOString(),
          durationSecs: 480,
          cuppers: [{ displayName: 'Wilky', station: 'A', totalElapsedSecs: null, maxed: false }],
        },
      }),
    );
    expect(body.querySelector('.stage-standings')).toBeNull();
    expect(body.querySelector('.stage-title').textContent).toBe('Heat 1');
    projector.destroy();
  });

  it('shares the shell’s hasContent contract: standings, a heat, an up-next heat or a champion count', () => {
    const projector = createProjectorBody();
    expect(projector.hasContent(payload())).toBe(true);
    expect(projector.hasContent({ standings: [] })).toBe(false);
    expect(projector.hasContent({ champion: 'Wilky' })).toBe(true);
    projector.destroy();
  });

  it('destroy() ends every timer it started', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    projector.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes options through to the display: an injected timer is the one the director uses', () => {
    const setTimer = vi.fn(() => 1);
    let t = 0;
    const projector = createProjectorBody({ now: () => t, setTimer, clearTimer: () => {} });
    const body = document.createElement('div');
    shellRender(body, projector, payload({ activeHeat: scoringHeat() }));
    t = 3_000;
    shellRender(body, projector, payload()); // idle wanted, scoring held for its 8s minimum
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 5_000);
    projector.destroy();
  });

  describe('result and rank moments, through the real player and director', () => {
    const rows = (names) =>
      names.map((displayName, i) => ({
        position: i + 1,
        displayName,
        numCorrect: 5,
        totalElapsedSecs: 200 + i,
        tieStatus: null,
      }));
    const confirmed = (heatNumber, name) => ({
      heatNumber,
      kind: 'normal',
      stageKind: 'prelims',
      results: [{ displayName: name, numCorrect: 6, totalElapsedSecs: 190 }],
    });
    const before = () => payload({ standings: rows(['Ayu', 'Bima']), recentHeats: [] });
    const after = () =>
      payload({
        standings: rows(['Cleo', 'Ayu', 'Bima']),
        recentHeats: [confirmed(3, 'Cleo')],
      });
    const kicker = (body) => body.querySelector('.stage-kicker')?.textContent ?? null;

    it('shows the result, then the rank impact, then the loop again, each for its hold time', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      expect(body.querySelector('.stage-standings')).not.toBeNull();
      shellRender(body, projector, after());
      expect(kicker(body)).toBe('Result recorded');
      vi.advanceTimersByTime(RESULT_HOLD_MS);
      expect(kicker(body)).toBe('Rank impact');
      vi.advanceTimersByTime(RANK_HOLD_MS);
      expect(body.querySelector('.stage-standings')).not.toBeNull();
      expect(body.querySelector('.stage-standing-name').textContent).toContain('Cleo');
      projector.destroy();
    });

    it('holds the result for 6 seconds and the rank impact for 8, the real times', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      shellRender(body, projector, after());
      vi.advanceTimersByTime(5_999);
      expect(kicker(body)).toBe('Result recorded');
      vi.advanceTimersByTime(1);
      expect(kicker(body)).toBe('Rank impact');
      vi.advanceTimersByTime(7_999);
      expect(kicker(body)).toBe('Rank impact');
      vi.advanceTimersByTime(1);
      expect(body.querySelector('.stage-standings')).not.toBeNull();
      projector.destroy();
    });

    it('a display opened after the result was recorded does not replay it', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, after());
      expect(body.querySelector('.stage-standings')).not.toBeNull();
      projector.destroy();
    });

    it('the shell re-rendering the same payload mid-moment does not restart or repeat it', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      shellRender(body, projector, after());
      vi.advanceTimersByTime(2_000);
      shellRender(body, projector, after());
      vi.advanceTimersByTime(RESULT_HOLD_MS - 2_000);
      expect(kicker(body)).toBe('Rank impact');
      projector.destroy();
    });

    it('a heat starting cuts the moment short and the rest is not replayed', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      shellRender(body, projector, after());
      vi.advanceTimersByTime(1_000);
      shellRender(body, projector, { ...after(), activeHeat: scoringHeat(), upNext: null });
      // "being scored" is not urgent, so the moment is not cut by it...
      expect(kicker(body)).toBe('Result recorded');
      shellRender(body, projector, {
        ...after(),
        activeHeat: { ...scoringHeat(), status: 'timing' },
      });
      expect(body.querySelector('.viewer-countdown')).not.toBeNull();
      vi.advanceTimersByTime(RESULT_HOLD_MS + RANK_HOLD_MS);
      expect(body.querySelector('.viewer-countdown')).not.toBeNull();
      expect(kicker(body)).not.toBe('Rank impact');
      projector.destroy();
    });

    it('a payload whose recent heat is malformed costs the moment only: the ordinary screen still shows', () => {
      vi.useFakeTimers();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      // a result with no name: the screen cannot be drawn for it
      shellRender(
        body,
        projector,
        payload({
          standings: rows(['Ayu', 'Bima']),
          recentHeats: [
            {
              heatNumber: 3,
              kind: 'normal',
              stageKind: 'prelims',
              results: [null],
            },
          ],
        }),
      );
      expect(body.querySelector('.stage-standings')).not.toBeNull();
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
      projector.destroy();
    });

    it('destroy() ends a moment’s timers', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, before());
      shellRender(body, projector, after());
      projector.destroy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('the real hold times, through the real director', () => {
    const heatHeat = () => ({
      heatNumber: 1,
      stageKind: 'prelims',
      status: 'timing',
      timingMode: 'app',
      startedAt: new Date().toISOString(),
      durationSecs: 480,
      cuppers: [{ displayName: 'Wilky', station: 'A', totalElapsedSecs: null, maxed: false }],
    });
    const shows = (body) => ({
      scoring: body.querySelector('.stage-title')?.textContent?.includes('being scored'),
      standings: body.querySelector('.stage-standings') !== null,
      champion: body.querySelector('.stage-champion-name') !== null,
      heat: body.querySelector('.viewer-countdown') !== null,
    });

    it('holds "being scored" for 8 seconds against the standings, then shows them', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, payload({ activeHeat: scoringHeat() }));
      vi.advanceTimersByTime(3_000);
      shellRender(body, projector, payload());
      expect(shows(body).scoring).toBe(true);
      vi.advanceTimersByTime(4_999);
      expect(shows(body).scoring).toBe(true);
      vi.advanceTimersByTime(1);
      expect(shows(body).standings).toBe(true);
      projector.destroy();
    });

    it('holds the champion against the standings for a long time, but a running heat cuts in at once and stays', () => {
      vi.useFakeTimers();
      const projector = createProjectorBody();
      const body = document.createElement('div');
      shellRender(body, projector, payload({ champion: 'Wilky' }));
      vi.advanceTimersByTime(20_000);
      shellRender(body, projector, payload());
      expect(shows(body).champion).toBe(true); // still held
      shellRender(body, projector, payload({ activeHeat: heatHeat() }));
      expect(shows(body).heat).toBe(true); // a running heat is urgent
      vi.advanceTimersByTime(PAGE_DWELL_MS * 10);
      expect(shows(body).heat).toBe(true); // and the held request does not come back for it
      projector.destroy();
    });
  });
});
