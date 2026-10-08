import { describe, it, expect, vi } from 'vitest';
import { createStageBody } from './stageBody.js';
import { renderScreenFrame } from './stageDisplay.js';

function setUp() {
  const log = [];
  const screen = {
    key: 'one',
    mount(host, payload) {
      log.push('mount');
      const frame = renderScreenFrame();
      frame.main.textContent = `n:${payload.n}`;
      host.append(frame.el);
      return {
        update: (next) => {
          frame.main.textContent = `n:${next.n}`;
        },
        destroy: () => log.push('destroy'),
      };
    },
  };
  const hasContent = (payload) => Boolean(payload?.n);
  const stage = createStageBody({
    selectScreen: (payload) => (payload?.n ? screen : null),
    bandFor: () => null,
    hasContent,
  });
  return { stage, log, hasContent };
}

// What viewer-shell does on every live payload: clear the body, then call renderBody again.
function shellRender(body, stage, payload) {
  body.replaceChildren();
  stage.renderBody(body, payload);
}

describe('createStageBody', () => {
  it('hands the shell the caller’s own hasContent test, unchanged', () => {
    const { stage, hasContent } = setUp();
    expect(stage.hasContent).toBe(hasContent);
  });

  it('mounts the display into the shell body and shows the screen the payload wants', () => {
    const { stage } = setUp();
    const body = document.createElement('div');
    shellRender(body, stage, { n: 1 });
    expect(body.querySelector('.stage-display')).not.toBeNull();
    expect(body.querySelector('.stage-main').textContent).toBe('n:1');
    stage.destroy();
  });

  it('re-attaches the SAME display on every payload, updating its screen in place instead of remounting it', () => {
    const { stage, log } = setUp();
    const body = document.createElement('div');
    shellRender(body, stage, { n: 1 });
    const display = body.querySelector('.stage-display');
    shellRender(body, stage, { n: 2 });
    expect(body.querySelector('.stage-display')).toBe(display);
    expect(body.querySelector('.stage-main').textContent).toBe('n:2');
    expect(log).toEqual(['mount']);
    stage.destroy();
  });

  it('destroy() destroys the current screen and ends any pending timer', () => {
    vi.useFakeTimers();
    try {
      const { stage, log } = setUp();
      const body = document.createElement('div');
      shellRender(body, stage, { n: 1 });
      stage.destroy();
      expect(log).toEqual(['mount', 'destroy']);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes display options through: an injected timer is the one the director uses', () => {
    const setTimer = vi.fn(() => 1);
    let t = 0;
    const slow = { key: 'slow', minDwellMs: 5_000, mount: () => ({ destroy() {} }) };
    const next = { key: 'next', mount: () => ({ destroy() {} }) };
    const stage = createStageBody({
      selectScreen: (payload) => (payload.n === 1 ? slow : next),
      bandFor: () => null,
      hasContent: () => true,
      now: () => t,
      setTimer,
      clearTimer: () => {},
    });
    const body = document.createElement('div');
    stage.renderBody(body, { n: 1 });
    t = 1_000;
    stage.renderBody(body, { n: 2 });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 4_000);
    stage.destroy();
  });
});
