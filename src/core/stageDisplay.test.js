import { describe, it, expect, vi } from 'vitest';
import { createStageDisplay, renderScreenFrame } from './stageDisplay.js';

function makeScreen(key, log, extra = {}) {
  return {
    key,
    ...extra,
    mount(host, payload) {
      log.push(`mount:${key}`);
      const frame = renderScreenFrame();
      frame.main.textContent = `${key}:${payload.n}`;
      host.append(frame.el);
      return {
        update: (next) => {
          frame.main.textContent = `${key}:${next.n}`;
        },
        destroy: () => log.push(`destroy:${key}`),
      };
    },
  };
}

describe('renderScreenFrame', () => {
  it('has a main area and a footer with a start side and an end side', () => {
    const frame = renderScreenFrame();
    expect(frame.el.contains(frame.main)).toBe(true);
    expect(frame.el.querySelector('footer')).not.toBeNull();
    expect(frame.el.querySelector('footer').contains(frame.footerStart)).toBe(true);
    expect(frame.el.querySelector('footer').contains(frame.footerEnd)).toBe(true);
  });
});

describe('createStageDisplay', () => {
  function setUp({ band } = {}) {
    const log = [];
    const screens = { a: makeScreen('a', log), b: makeScreen('b', log) };
    const display = createStageDisplay({
      selectScreen: (payload) => screens[payload.screen] ?? null,
      bandFor:
        band ?? ((payload) => ({ eventName: payload.eventName ?? null, sectionLabel: 'Final' })),
    });
    return { display, log };
  }

  it('keeps the screen area out of the live region, so a republish or page change is not read aloud again', () => {
    const { display } = setUp();
    expect(display.el.querySelector('.stage-screen-host').getAttribute('aria-live')).toBe('off');
  });

  it('shows the band above the screen the payload asks for', () => {
    const { display } = setUp();
    display.update({ screen: 'a', n: 1, eventName: 'Cup 2026' });
    const parts = [...display.el.children].map((c) => c.className);
    expect(parts).toEqual(['stage-band-host', 'stage-screen-host']);
    expect(display.el.querySelector('.stage-band-event').textContent).toBe('Cup 2026');
    expect(display.el.querySelector('.stage-main').textContent).toBe('a:1');
    expect(display.currentKey()).toBe('a');
  });

  it('updates the same screen in place when the payload changes but wants the same screen', () => {
    const { display, log } = setUp();
    display.update({ screen: 'a', n: 1 });
    display.update({ screen: 'a', n: 2 });
    expect(log).toEqual(['mount:a']);
    expect(display.el.querySelector('.stage-main').textContent).toBe('a:2');
  });

  it('changes screen when the payload wants a different one', () => {
    const { display, log } = setUp();
    display.update({ screen: 'a', n: 1 });
    display.update({ screen: 'b', n: 2 });
    expect(log).toEqual(['mount:a', 'destroy:a', 'mount:b']);
    expect(display.el.querySelector('.stage-main').textContent).toBe('b:2');
  });

  it('leaves the band element alone while what it says is unchanged (it is on screen all event)', () => {
    const { display } = setUp();
    display.update({ screen: 'a', n: 1, eventName: 'Cup 2026' });
    const band = display.el.querySelector('.stage-band');
    display.update({ screen: 'a', n: 2, eventName: 'Cup 2026' });
    expect(display.el.querySelector('.stage-band')).toBe(band);
  });

  it('rebuilds the band when its words change, and removes it when there is none', () => {
    const { display } = setUp();
    display.update({ screen: 'a', n: 1, eventName: 'Cup 2026' });
    display.update({ screen: 'a', n: 2, eventName: 'Cup 2027' });
    expect(display.el.querySelector('.stage-band-event').textContent).toBe('Cup 2027');
    const noBand = setUp({ band: () => null });
    noBand.display.update({ screen: 'a', n: 1 });
    expect(noBand.display.el.querySelector('.stage-band')).toBeNull();
  });

  it('the band follows the screen that is ON SHOW: a held screen keeps its own band until it is replaced', () => {
    vi.useFakeTimers();
    try {
      const log = [];
      const display = createStageDisplay({
        selectScreen: (payload) =>
          makeScreen(payload.screen, log, { minDwellMs: payload.screen === 'a' ? 5_000 : 0 }),
        bandFor: (payload) => ({ eventName: payload.eventName, sectionLabel: null }),
      });
      display.update({ screen: 'a', n: 1, eventName: 'Stage one' });
      display.update({ screen: 'b', n: 2, eventName: 'Stage two' });
      // 'a' is held for its 5s: the band must not have raced ahead to the next payload's words
      expect(display.el.querySelector('.stage-band-event').textContent).toBe('Stage one');
      vi.advanceTimersByTime(5_000);
      expect(display.el.querySelector('.stage-band-event').textContent).toBe('Stage two');
      display.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds the band when only its section label changes (the real case: one phase to the next)', () => {
    const log = [];
    const display = createStageDisplay({
      selectScreen: () => makeScreen('a', log),
      bandFor: (payload) => ({ eventName: 'Same event', sectionLabel: payload.section }),
    });
    display.update({ n: 1, section: 'Round 1' });
    expect(display.el.querySelector('.stage-band-section').textContent).toBe('Round 1');
    display.update({ n: 2, section: 'Final' });
    expect(display.el.querySelector('.stage-band-section').textContent).toBe('Final');
    display.destroy();
  });

  it('still tells a caller’s own onShown what was shown, as well as driving the band', () => {
    const onShown = vi.fn();
    const log = [];
    const display = createStageDisplay({
      selectScreen: () => makeScreen('a', log),
      bandFor: () => ({ eventName: 'E' }),
      onShown,
    });
    const payload = { n: 1 };
    display.update(payload);
    expect(onShown).toHaveBeenCalledWith(payload);
    expect(display.el.querySelector('.stage-band-event').textContent).toBe('E');
    display.destroy();
  });

  it('passes director options (its clock and timers) through, so a format can inject its own', () => {
    const log = [];
    const setTimer = vi.fn(() => 7);
    const clearTimer = vi.fn();
    let t = 1_000;
    const display = createStageDisplay({
      selectScreen: (payload) => makeScreen(payload.screen, log, { minDwellMs: 5_000 }),
      bandFor: () => null,
      now: () => t,
      setTimer,
      clearTimer,
    });
    display.update({ screen: 'a', n: 1 });
    t = 2_000; // held for 1s of a 5s minimum
    display.update({ screen: 'b', n: 2 });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 4_000);
    display.destroy();
    expect(clearTimer).toHaveBeenCalled();
  });

  it('removes the band when there is no screen to show', () => {
    const { display } = setUp();
    display.update({ screen: 'a', n: 1, eventName: 'Cup 2026' });
    expect(display.el.querySelector('.stage-band')).not.toBeNull();
    display.update({ screen: 'nothing', n: 2 });
    expect(display.el.querySelector('.stage-band')).toBeNull();
  });

  it('shows no screen when the payload wants none', () => {
    const { display, log } = setUp();
    display.update({ screen: 'a', n: 1 });
    display.update({ screen: 'nothing', n: 2 });
    expect(display.el.querySelector('.stage-screen')).toBeNull();
    expect(log).toContain('destroy:a');
  });

  it('passes director options through (so a second format can tune dwell and clocks)', () => {
    vi.useFakeTimers();
    try {
      const log = [];
      const display = createStageDisplay({
        selectScreen: (payload) =>
          makeScreen(payload.screen, log, { minDwellMs: payload.screen === 'a' ? 5_000 : 0 }),
        bandFor: () => null,
      });
      display.update({ screen: 'a', n: 1 });
      display.update({ screen: 'b', n: 2 });
      expect(display.currentKey()).toBe('a'); // 'a' holds for its 5s
      vi.advanceTimersByTime(5_000);
      expect(display.currentKey()).toBe('b');
      display.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroy() destroys the current screen and clears pending timers', () => {
    vi.useFakeTimers();
    try {
      const log = [];
      const display = createStageDisplay({
        selectScreen: (payload) => makeScreen(payload.screen, log, { minDwellMs: 5_000 }),
        bandFor: () => null,
      });
      display.update({ screen: 'a', n: 1 });
      display.update({ screen: 'b', n: 2 });
      display.destroy();
      expect(log).toContain('destroy:a');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
