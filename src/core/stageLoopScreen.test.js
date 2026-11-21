import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLoopScreen } from './stageLoopScreen.js';
import { el } from './dom.js';

afterEach(() => vi.useRealTimers());

const page = (label) => ({ label, render: () => [el('p', { text: label })] });
function setup(extra = {}) {
  vi.useFakeTimers();
  const pagesFor = vi.fn((p) => p.pages.map(page));
  const screen = createLoopScreen({
    key: 'loop',
    pagesFor,
    signatureOf: (p) => p.pages.join('|'),
    dwellMs: 10_000,
    ...extra,
  });
  const host = document.createElement('div');
  return { screen, pagesFor, host };
}

describe('createLoopScreen', () => {
  it('is a director screen: key, not urgent, no hold of its own', () => {
    const { screen } = setup();
    expect(screen).toMatchObject({ key: 'loop', urgent: false, minDwellMs: 0 });
  });

  it('shows the first page with its label in the footer, then rotates with a ring', () => {
    const { screen, host } = setup();
    const handle = screen.mount(host, { pages: ['One', 'Two'] });
    expect(host.querySelector('.stage-main').textContent).toBe('One');
    expect(host.querySelector('.stage-footer-start').textContent).toBe('One');
    expect(host.querySelector('.stage-footer-end *')).not.toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(host.querySelector('.stage-main').textContent).toBe('Two');
    vi.advanceTimersByTime(10_000);
    expect(host.querySelector('.stage-main').textContent).toBe('One');
    handle.destroy();
  });

  it('does not rebuild or restart on an unchanged signature, and restarts from page one on a real change', () => {
    const { screen, pagesFor, host } = setup();
    const handle = screen.mount(host, { pages: ['One', 'Two'] });
    vi.advanceTimersByTime(10_000);
    expect(pagesFor).toHaveBeenCalledTimes(1);
    handle.update({ pages: ['One', 'Two'], other: 'republish' });
    expect(pagesFor).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.stage-main').textContent).toBe('Two');
    handle.update({ pages: ['New', 'Two'] });
    expect(pagesFor).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.stage-main').textContent).toBe('New');
    handle.destroy();
  });

  it('uses footerFor with the page, its index and the payload', () => {
    const { screen, host } = setup({
      footerFor: (p, i, payload) => `${p.label} #${i} of ${payload.pages.length}`,
    });
    const handle = screen.mount(host, { pages: ['One', 'Two'] });
    expect(host.querySelector('.stage-footer-start').textContent).toBe('One #0 of 2');
    handle.destroy();
  });

  it('no pages empties the frame; a single page has no ring and never rotates', () => {
    const { screen, host } = setup();
    const handle = screen.mount(host, { pages: ['Only'] });
    expect(host.querySelector('.stage-footer-end').children).toHaveLength(0);
    handle.update({ pages: [] });
    expect(host.querySelector('.stage-main').children).toHaveLength(0);
    handle.destroy();
  });

  it('destroy stops the rotation timers', () => {
    const { screen, host } = setup();
    const handle = screen.mount(host, { pages: ['One', 'Two'] });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('defaults the signature to the whole payload', () => {
    vi.useFakeTimers();
    const pagesFor = vi.fn(() => [page('x')]);
    const screen = createLoopScreen({ key: 'k', pagesFor, dwellMs: 1000 });
    const handle = screen.mount(document.createElement('div'), { a: 1 });
    handle.update({ a: 1 });
    expect(pagesFor).toHaveBeenCalledTimes(1);
    handle.update({ a: 2 });
    expect(pagesFor).toHaveBeenCalledTimes(2);
    handle.destroy();
  });
});
