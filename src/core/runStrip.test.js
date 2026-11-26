// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildRunStrip } from './runStrip.js';

const phases = [
  { id: 'setup', label: 'Setup', status: 'done', count: '16 teams' },
  { id: 'r1', label: 'Round 1', status: 'in_progress', progress: { done: 3, active: 1, total: 8 } },
  { id: 'cut', label: 'The cut', status: 'waiting' },
];

describe('buildRunStrip', () => {
  it('marks the first phase not done as the current step and says each state in words', () => {
    const strip = buildRunStrip(phases);
    const cells = [...strip.querySelectorAll('li')];
    expect(cells.map((c) => c.hasAttribute('aria-current'))).toEqual([false, true, false]);
    expect(cells[0].dataset.state).toBe('done');
    expect(cells[1].dataset.state).toBe('upcoming');
    expect(cells[0].querySelector('.eyebrow').textContent).toBe('01 · Done');
    expect(cells[2].querySelector('.eyebrow').textContent).toBe('03 · Waiting');
  });

  it('draws a meter only for a phase with progress, and nothing for no phases', () => {
    const cells = [...buildRunStrip(phases).querySelectorAll('li')];
    const meter = cells[1].querySelector('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter.getAttribute('aria-valuetext')).toBe('3 of 8 done');
    expect(cells[0].querySelector('[role="meter"]')).toBeNull();
    expect(buildRunStrip([])).toBeNull();
  });

  it('has no current step once every phase is done', () => {
    const strip = buildRunStrip([{ id: 'a', label: 'A', status: 'done' }]);
    expect(strip.querySelector('[aria-current]')).toBeNull();
  });
});
