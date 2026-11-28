// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dimClip,
  endActiveTour,
  hasSeenTour,
  isTourRunning,
  placeTip,
  scheduleTour,
  shouldAutoStart,
  spotBox,
  startTour,
} from './tour.js';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

const STEPS = [
  { title: 'Welcome', body: 'Hello.' },
  { target: '[data-tour="a"]', title: 'A', body: 'About A.' },
  { target: '[data-tour="missing"]', title: 'Missing', body: 'Never shown.' },
  { target: '[data-tour="b"]', title: 'B', body: 'About B.' },
];

function page() {
  document.body.innerHTML =
    '<main id="app"><button data-tour="a">A</button><button data-tour="b">B</button></main>';
}

const tipText = () => document.querySelector('.tour-title')?.textContent;

afterEach(() => {
  endActiveTour();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('placeTip (the tip never leaves the screen)', () => {
  const view = { width: 360, height: 640 };
  const size = { width: 328, height: 160 };
  it('centres a step with no target', () => {
    const p = placeTip({ target: null, view, size });
    expect(p.side).toBe('center');
    expect(p.left).toBeGreaterThanOrEqual(16);
  });
  it('goes below a target near the top, above one near the bottom', () => {
    expect(
      placeTip({ target: { top: 40, left: 20, width: 100, height: 40 }, view, size }).side,
    ).toBe('below');
    expect(
      placeTip({ target: { top: 560, left: 20, width: 100, height: 40 }, view, size }).side,
    ).toBe('above');
  });
  it('docks on the far edge for a target that fills the screen, and stays inside it', () => {
    const p = placeTip({ target: { top: 0, left: 0, width: 360, height: 640 }, view, size });
    expect(p.side).toBe('dock');
    expect(p.top + size.height).toBeLessThanOrEqual(view.height);
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.left + size.width).toBeLessThanOrEqual(view.width - 16);
  });
});

describe('spotBox and dimClip', () => {
  it('pads the target and clips it to the screen', () => {
    const view = { width: 360, height: 640 };
    expect(spotBox({ top: 2, left: 2, width: 400, height: 50 }, view)).toEqual({
      top: 0,
      left: 0,
      width: 360,
      height: 58,
    });
  });
  it('makes an even-odd shape with a hole', () => {
    expect(
      dimClip({ top: 10, left: 20, width: 30, height: 40 }, { width: 100, height: 200 }),
    ).toMatch(/^polygon\(evenodd/);
  });
});

describe('startTour', () => {
  it('skips a step whose target is not on the page and counts only the rest', () => {
    page();
    startTour({ id: 't', steps: STEPS, storage: memory() });
    expect(tipText()).toBe('Welcome');
    expect(document.querySelector('.tour-count').textContent).toBe('Step 1 of 3');
    document.querySelector('[data-tour-action="next"]').click();
    expect(tipText()).toBe('A');
    document.querySelector('[data-tour-action="next"]').click();
    expect(tipText()).toBe('B');
    expect(document.querySelector('[data-tour-action="next"]').textContent).toBe('Done');
    expect(document.querySelector('[data-tour-action="skip"]').hidden).toBe(true);
  });

  it('Back returns, and is hidden on the first step', () => {
    page();
    startTour({ id: 't', steps: STEPS, storage: memory() });
    expect(document.querySelector('[data-tour-action="back"]').hidden).toBe(true);
    document.querySelector('[data-tour-action="next"]').click();
    document.querySelector('[data-tour-action="back"]').click();
    expect(tipText()).toBe('Welcome');
  });

  it('is a labelled modal dialog that takes focus, and makes the page inert while it runs', () => {
    page();
    startTour({ id: 't', steps: STEPS, storage: memory() });
    const tip = document.querySelector('.tour-tip');
    expect(tip.getAttribute('role')).toBe('dialog');
    expect(tip.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(tip.getAttribute('aria-labelledby')).textContent).toBe(
      'Welcome',
    );
    expect(document.activeElement).toBe(tip);
    expect(document.getElementById('app').hasAttribute('inert')).toBe(true);
  });

  it('Skip, Escape and the last Done all end it, restore the page and report how', () => {
    for (const [close, how] of [
      [() => document.querySelector('[data-tour-action="skip"]').click(), 'skipped'],
      [
        () =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        'skipped',
      ],
    ]) {
      page();
      const onEnd = vi.fn();
      startTour({ id: 't', steps: STEPS, storage: memory(), onEnd });
      close();
      expect(isTourRunning()).toBe(false);
      expect(document.querySelector('.tour')).toBeNull();
      expect(document.getElementById('app').hasAttribute('inert')).toBe(false);
      expect(onEnd).toHaveBeenCalledWith(how);
    }
    page();
    const onEnd = vi.fn();
    startTour({ id: 't', steps: [STEPS[0]], storage: memory(), onEnd });
    document.querySelector('[data-tour-action="next"]').click();
    expect(onEnd).toHaveBeenCalledWith('done');
  });

  it('arrow keys move, and focus goes back to where it was', () => {
    page();
    const a = document.querySelector('[data-tour="a"]');
    a.focus();
    startTour({ id: 't', steps: STEPS, storage: memory() });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tipText()).toBe('A');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tipText()).toBe('Welcome');
    endActiveTour();
    expect(document.activeElement).toBe(a);
  });

  it('ends when the screen that started it is left (its signal aborts), and restores the page', () => {
    page();
    const ctl = new AbortController();
    startTour({ id: 't', steps: STEPS, storage: memory(), signal: ctl.signal });
    expect(isTourRunning()).toBe(true);
    ctl.abort();
    expect(isTourRunning()).toBe(false);
    expect(document.querySelector('.tour')).toBeNull();
    expect(document.getElementById('app').hasAttribute('inert')).toBe(false);
    // a signal that is already aborted never starts one
    startTour({ id: 't', steps: STEPS, storage: memory(), signal: ctl.signal });
    expect(document.querySelector('.tour')).toBeNull();
  });

  it('starts nothing when no step applies, and replaces a running tour', () => {
    page();
    startTour({ id: 't', steps: [STEPS[2]], storage: memory() });
    expect(isTourRunning()).toBe(false);
    startTour({ id: 't', steps: STEPS, storage: memory() });
    startTour({ id: 'u', steps: [STEPS[0]], storage: memory() });
    expect(document.querySelectorAll('.tour')).toHaveLength(1);
  });

  it('writes step text as text, never markup', () => {
    page();
    startTour({ id: 't', steps: [{ title: '<img src=x>', body: '<b>hi</b>' }], storage: memory() });
    expect(document.querySelector('.tour img')).toBeNull();
    expect(document.querySelector('.tour-body').textContent).toBe('<b>hi</b>');
  });
});

describe('first run', () => {
  it('is remembered once started, and blocked storage does not throw', () => {
    page();
    const storage = memory();
    expect(shouldAutoStart('t', storage)).toBe(true);
    startTour({ id: 't', steps: STEPS, storage });
    expect(hasSeenTour('t', storage)).toBe(true);
    expect(shouldAutoStart('t', storage)).toBe(false);
    const blocked = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(shouldAutoStart('t', blocked)).toBe(true);
    endActiveTour();
    expect(() => startTour({ id: 't', steps: STEPS, storage: blocked })).not.toThrow();
  });

  it('scheduleTour offers it once, never under test automation unless forced, and cancels on abort', () => {
    vi.useFakeTimers();
    page();
    const storage = memory();
    scheduleTour({ id: 't', steps: STEPS, storage, delayMs: 10 });
    vi.advanceTimersByTime(20);
    expect(isTourRunning()).toBe(false); // unit tests count as automation
    const ctl = new AbortController();
    scheduleTour({ id: 't', steps: STEPS, storage, delayMs: 10, force: true, signal: ctl.signal });
    ctl.abort();
    vi.advanceTimersByTime(20);
    expect(isTourRunning()).toBe(false);
    scheduleTour({ id: 't', steps: STEPS, storage, delayMs: 10, force: true });
    vi.advanceTimersByTime(20);
    expect(isTourRunning()).toBe(true);
  });
});
