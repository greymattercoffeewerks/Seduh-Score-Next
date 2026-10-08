import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProjectorBody } from './projectorBody.js';
import { PAGE_DWELL_MS } from './projectorScreens.js';

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
    expect(body.querySelectorAll('.projector-standing-row')).toHaveLength(8);
    projector.destroy();
  });

  it('re-attaches the SAME display on every payload, so the page loop and ring keep their place', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    const first = body.querySelector('.stage-display');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(body.querySelector('.projector-range').textContent).toBe('9 to 16 of 17');
    // an identical republish: the shell clears the body and renders again
    shellRender(body, projector, payload());
    expect(body.querySelector('.stage-display')).toBe(first);
    expect(body.querySelector('.projector-range').textContent).toBe('9 to 16 of 17');
    projector.destroy();
  });

  it('changes screen when the payload changes what it wants', () => {
    vi.useFakeTimers();
    const projector = createProjectorBody();
    const body = document.createElement('div');
    shellRender(body, projector, payload());
    expect(body.querySelector('.projector-standings')).not.toBeNull();
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
    expect(body.querySelector('.projector-standings')).toBeNull();
    expect(body.querySelector('.projector-title').textContent).toBe('Heat 1');
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
      scoring: body.querySelector('.projector-title')?.textContent?.includes('being scored'),
      standings: body.querySelector('.projector-standings') !== null,
      champion: body.querySelector('.projector-champion-name') !== null,
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
