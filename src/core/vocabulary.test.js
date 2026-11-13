// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMeter,
  buildStat,
  kitState,
  meterSegments,
  STATUS_STATES,
  statusMark,
} from './vocabulary.js';

describe('statusMark', () => {
  it('draws a label with its state, stroke by default and light on request', () => {
    const mark = statusMark('done', 'Confirmed');
    expect(mark.className).toBe('status');
    expect(mark.dataset.state).toBe('done');
    expect(mark.textContent).toBe('Confirmed');
    expect(statusMark('live', 'Live', { light: true }).className).toBe('status status--light');
  });
  it('refuses a state the stylesheet has no shape for', () => {
    expect(() => statusMark('green', 'x')).toThrow();
  });
  it('maps every kit word to a known state, and an unknown word to queued', () => {
    const words = ['not_started', 'in_progress', 'done', 'blocked', 'waiting', 'error', 'warning'];
    for (const word of [...words, 'info']) expect(STATUS_STATES).toContain(kitState(word));
    expect(kitState('mystery')).toBe('queued');
  });
});

describe('the mapping and the stylesheet', () => {
  it('pins every kit word to its state (a blocked phase is a cross, never a check)', () => {
    expect(kitState('not_started')).toBe('queued');
    expect(kitState('in_progress')).toBe('live');
    expect(kitState('done')).toBe('done');
    expect(kitState('blocked')).toBe('failed');
    expect(kitState('waiting')).toBe('offline');
    expect(kitState('error')).toBe('failed');
    expect(kitState('warning')).toBe('attention');
    expect(kitState('info')).toBe('queued');
  });
  it('has a shape in vocabulary.css for every state, and for a done step', () => {
    const css = readFileSync('src/ui/tokens/vocabulary.css', 'utf8');
    for (const state of STATUS_STATES) {
      expect(css, state).toContain(`.status[data-state='${state}']`);
    }
    expect(css).toContain(".steps > li[data-state='done']");
    expect(css).toContain(".steps > li[aria-current='step']");
  });
});

describe('meter', () => {
  it('clamps the bar and never lets the hatched part pass the end', () => {
    expect(meterSegments(7, 10, 1)).toEqual({ donePct: 70, activePct: 10 });
    expect(meterSegments(9, 10, 5)).toEqual({ donePct: 90, activePct: 10 });
    expect(meterSegments(15, 10)).toEqual({ donePct: 100, activePct: 0 });
    expect(meterSegments(-2, 10)).toEqual({ donePct: 0, activePct: 0 });
    expect(meterSegments(3, 0)).toEqual({ donePct: 0, activePct: 0 });
    expect(meterSegments(NaN, 10)).toEqual({ donePct: 0, activePct: 0 });
  });
  it('is a role=meter with its numbers and a sentence', () => {
    const meter = buildMeter({ label: 'Heats', done: 5, total: 8 });
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('8');
    expect(meter.getAttribute('aria-valuenow')).toBe('5');
    expect(meter.getAttribute('aria-valuetext')).toBe('5 of 8');
    expect(meter.getAttribute('aria-label')).toBe('Heats');
  });
});

describe('buildStat', () => {
  it('puts the figure in mono tabular digits with its unit and sub-line, and a tone as data', () => {
    const tile = buildStat({
      label: 'Heats done',
      value: '5',
      unit: '/ 8',
      sub: '3 to go',
      tone: 'ok',
    });
    expect(tile.dataset.tone).toBe('ok');
    expect(tile.querySelector('.stat-label').textContent).toBe('Heats done');
    expect(tile.querySelector('.stat-value').className).toContain('tabular-nums');
    expect(tile.querySelector('.stat-unit').textContent.trim()).toBe('/ 8');
    expect(tile.querySelector('.stat-sub').textContent).toBe('3 to go');
    expect(buildStat({ label: 'a', value: '1' }).hasAttribute('data-tone')).toBe(false);
  });
});
