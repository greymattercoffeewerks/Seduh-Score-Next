import { describe, it, expect } from 'vitest';
import { renderMovementRows, describeMovement } from './rankMovementRows.js';

const row = (position, label, change, places = 0, extra = {}) => ({
  position,
  label,
  change,
  places,
  tied: false,
  ...extra,
});
const all = (node, selector) => [...node.querySelectorAll(selector)].map((n) => n.textContent);

describe('describeMovement', () => {
  it('says each kind of movement in words', () => {
    expect(describeMovement(row(1, 'A', 'entered'))).toBe('New');
    expect(describeMovement(row(1, 'A', 'up', 3))).toBe('Up 3');
    expect(describeMovement(row(1, 'A', 'down', 2))).toBe('Down 2');
    expect(describeMovement(row(1, 'A', 'same'))).toBe('Holds');
  });
});

describe('renderMovementRows', () => {
  it('draws a row per entry: place, name and the movement in words', () => {
    const list = renderMovementRows([row(1, 'Ayu', 'up', 2), row(2, 'Bima', 'same')]);
    expect(list.tagName).toBe('UL');
    expect(all(list, '.stage-move-pos')).toEqual(['1', '2']);
    expect(all(list, '.stage-move-name-text')).toEqual(['Ayu', 'Bima']);
    expect(all(list, '.stage-move-change')).toEqual(['Up 2', 'Holds']);
  });

  it('marks the kind of change on the row, for the stylesheet', () => {
    const list = renderMovementRows([row(1, 'A', 'entered'), row(2, 'B', 'down', 1)]);
    expect([...list.children].map((li) => li.getAttribute('data-change'))).toEqual([
      'entered',
      'down',
    ]);
  });

  it('opts each row into the rise-in', () => {
    const list = renderMovementRows([row(1, 'A', 'same'), row(2, 'B', 'same')]);
    expect(list.querySelectorAll('.stage-move.stage-reveal-item')).toHaveLength(2);
  });

  it('writes "(tied)" in its own element, only for a tied row', () => {
    const list = renderMovementRows([
      row(1, 'Ayu', 'same', 0, { tied: true }),
      row(2, 'Bima', 'same'),
    ]);
    expect(all(list, '.stage-move-name-suffix')).toEqual([' (tied)']);
    expect(list.children[0].querySelector('.stage-move-name-suffix')).not.toBeNull();
    expect(list.children[1].querySelector('.stage-move-name-suffix')).toBeNull();
  });

  it('says how many rows were left out, as a last line, and nothing when none were', () => {
    const cut = renderMovementRows([row(1, 'A', 'same')], { more: 3 });
    expect(cut.lastElementChild.className).toBe('stage-move-more');
    expect(cut.lastElementChild.textContent).toBe('+3 more');
    const whole = renderMovementRows([row(1, 'A', 'same')]);
    expect(whole.querySelector('.stage-move-more')).toBeNull();
    const none = renderMovementRows([row(1, 'A', 'same')], { more: 0 });
    expect(none.querySelector('.stage-move-more')).toBeNull();
  });

  it('renders names as text, never as markup', () => {
    const list = renderMovementRows([row(1, '<img src=x onerror=alert(1)>', 'same')]);
    expect(list.querySelector('img')).toBeNull();
    expect(all(list, '.stage-move-name-text')).toEqual(['<img src=x onerror=alert(1)>']);
  });

  it('draws an empty list for no rows', () => {
    expect(renderMovementRows([]).children).toHaveLength(0);
  });
});
