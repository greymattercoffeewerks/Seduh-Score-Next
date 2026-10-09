import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStagePageLoop } from './stagePageLoop.js';
import { renderScreenFrame } from './stageDisplay.js';

afterEach(() => {
  vi.useRealTimers();
});

const page = (label, render = () => [document.createTextNode(`body of ${label}`)]) => ({
  label,
  render,
});

function setup(options = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T10:00:00.000Z'));
  const frame = renderScreenFrame();
  const loop = createStagePageLoop(frame, { dwellMs: 10_000, ...options });
  return { frame, loop };
}

describe('createStagePageLoop', () => {
  it('paints the first page at once: its content, its label in the footer, and the ring counting down', () => {
    const { frame, loop } = setup();
    loop.show([page('Up next'), page('Standings')]);
    expect(frame.main.textContent).toBe('body of Up next');
    expect(frame.footerStart.textContent).toBe('Up next');
    expect(frame.footerEnd.querySelector('svg')).not.toBeNull();
    loop.destroy();
  });

  it('moves to the next page after the dwell, and wraps round to the first', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B'), page('C')]);
    vi.advanceTimersByTime(10_000);
    expect(frame.main.textContent).toBe('body of B');
    vi.advanceTimersByTime(10_000);
    expect(frame.main.textContent).toBe('body of C');
    vi.advanceTimersByTime(10_000);
    expect(frame.main.textContent).toBe('body of A');
    expect(frame.footerStart.textContent).toBe('A');
    loop.destroy();
  });

  it('does not move on before the dwell has passed', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    vi.advanceTimersByTime(9_999);
    expect(frame.main.textContent).toBe('body of A');
    loop.destroy();
  });

  it('a single page does not rotate, has no ring and sets no timer', () => {
    const { frame, loop } = setup();
    loop.show([page('Only')]);
    expect(frame.footerEnd.querySelector('svg')).toBeNull();
    expect(frame.footerEnd.childNodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(frame.main.textContent).toBe('body of Only');
    loop.destroy();
  });

  it('removes the ring when new pages leave only one', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    expect(frame.footerEnd.querySelector('svg')).not.toBeNull();
    loop.show([page('Only')]);
    expect(frame.footerEnd.querySelector('svg')).toBeNull();
    // the ring's own tick and the old page timer are both stopped, not just detached
    expect(vi.getTimerCount()).toBe(0);
    loop.destroy();
  });

  it('draws the ring over the dwell the loop was built with, counting down as time passes', () => {
    const { frame, loop } = setup({ dwellMs: 2_000 });
    loop.show([page('A'), page('B')]);
    expect(frame.footerEnd.querySelector('.stage-ring-count').textContent).toBe('2');
    vi.advanceTimersByTime(1_000);
    expect(frame.footerEnd.querySelector('.stage-ring-count').textContent).toBe('1');
    loop.destroy();
  });

  it('shows the footer text and page labels as text, never markup', () => {
    const { frame, loop } = setup();
    loop.show([page('<b>x</b>')], { footerFor: () => '<i>y</i>' });
    expect(frame.footerStart.querySelector('i, b')).toBeNull();
    expect(frame.footerStart.textContent).toBe('<i>y</i>');
    loop.destroy();
  });

  it('showing no pages empties the frame and stops everything, so an old page is never left up', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    expect(frame.main.textContent).toBe('body of A');
    loop.show([]);
    expect(frame.main.childNodes).toHaveLength(0);
    expect(frame.footerStart.textContent).toBe('');
    expect(frame.footerEnd.childNodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(frame.main.childNodes).toHaveLength(0);
    // and a loop can start again afterwards
    loop.show([page('Z')]);
    expect(frame.main.textContent).toBe('body of Z');
    loop.destroy();
  });

  it('can be destroyed before it ever shows anything', () => {
    const { loop } = setup();
    expect(() => loop.destroy()).not.toThrow();
  });

  it('runs onPage before each page is painted, with the page and its index', () => {
    const { frame, loop } = setup();
    const seen = [];
    loop.show([page('A'), page('B')], {
      onPage(p, index) {
        seen.push([p.label, index, frame.main.textContent]);
      },
    });
    vi.advanceTimersByTime(10_000);
    // each call saw the PREVIOUS content: it runs first, then the page is painted
    expect(seen).toEqual([
      ['A', 0, ''],
      ['B', 1, 'body of A'],
    ]);
    loop.destroy();
  });

  it("takes the footer text from the caller's footerFor, which sees the page and index", () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')], {
      footerFor: (p, index) => `${p.label} #${index + 1} · who is next`,
    });
    expect(frame.footerStart.textContent).toBe('A #1 · who is next');
    vi.advanceTimersByTime(10_000);
    expect(frame.footerStart.textContent).toBe('B #2 · who is next');
    loop.destroy();
  });

  it('restarts from the first page when shown new pages', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    vi.advanceTimersByTime(10_000);
    expect(frame.main.textContent).toBe('body of B');
    loop.show([page('X'), page('Y')]);
    expect(frame.main.textContent).toBe('body of X');
    vi.advanceTimersByTime(10_000);
    expect(frame.main.textContent).toBe('body of Y');
    loop.destroy();
  });

  it('stops the OLD rotator when shown new pages: shown mid-dwell, the old timer must not repaint over the new page', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    vi.advanceTimersByTime(1_000);
    loop.show([page('X'), page('Y')]);
    // one page timer and one ring tick: nothing doubled
    expect(vi.getTimerCount()).toBe(2);
    // the old rotator would fire 9 s after this point and paint B over X; the new one is not due until 10 s
    vi.advanceTimersByTime(9_000);
    expect(frame.main.textContent).toBe('body of X');
    vi.advanceTimersByTime(1_000);
    expect(frame.main.textContent).toBe('body of Y');
    loop.destroy();
  });

  it('destroy() stops everything: no timer is left to touch the frame afterwards', () => {
    const { frame, loop } = setup();
    loop.show([page('A'), page('B')]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    loop.destroy();
    expect(vi.getTimerCount()).toBe(0);
    const before = frame.main.textContent;
    vi.advanceTimersByTime(60_000);
    expect(frame.main.textContent).toBe(before);
  });

  it('renders a page only when it is shown, not when the loop is built', () => {
    const { loop } = setup();
    const renders = [];
    loop.show([
      page('A', () => {
        renders.push('A');
        return [];
      }),
      page('B', () => {
        renders.push('B');
        return [];
      }),
    ]);
    expect(renders).toEqual(['A']);
    vi.advanceTimersByTime(10_000);
    expect(renders).toEqual(['A', 'B']);
    loop.destroy();
  });

  it('holds each page for the dwell it was built with', () => {
    const { frame, loop } = setup({ dwellMs: 2_000 });
    loop.show([page('A'), page('B')]);
    vi.advanceTimersByTime(2_000);
    expect(frame.main.textContent).toBe('body of B');
    loop.destroy();
  });
});
