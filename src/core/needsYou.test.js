// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildNeedsYou } from './needsYou.js';

describe('buildNeedsYou', () => {
  it('orders errors before warnings before notes, and says urgency in words, not just the edge', () => {
    const node = buildNeedsYou([
      { id: 'a', severity: 'info', text: 'A note' },
      { id: 'b', severity: 'warning', text: 'A check', href: '#/x', actionLabel: 'Open' },
      { id: 'c', severity: 'error', text: 'A problem' },
    ]);
    const items = [...node.querySelectorAll('.queue > li')];
    expect(items.map((li) => li.querySelector('.queue-title').textContent)).toEqual([
      'Problem A problem',
      'Check A check',
      'A note',
    ]);
    expect(items[0].dataset.severity).toBe('attention');
    expect(items[0].querySelector('.status').textContent).toBe('Problem');
    expect(items[2].hasAttribute('data-severity')).toBe(false);
    expect(items[1].querySelector('a').getAttribute('href')).toBe('#/x');
  });

  it('says so in words when nothing needs you, and drops a javascript: link', () => {
    expect(buildNeedsYou([]).textContent).toContain('Nothing needs you right now.');
    const node = buildNeedsYou([
      { id: 'x', severity: 'warning', text: 'T', href: 'javascript:alert(1)' },
    ]);
    expect(node.querySelector('a')).toBeNull();
  });
});
