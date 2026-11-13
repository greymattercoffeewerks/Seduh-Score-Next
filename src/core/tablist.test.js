// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildTablist, nextTabIndex } from './tablist.js';

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

function mount() {
  const onSelect = vi.fn();
  const panel = document.createElement('div');
  const api = buildTablist({
    idBase: 't',
    label: 'Views',
    tabs: TABS,
    selected: 'b',
    onSelect,
    panel,
  });
  document.body.replaceChildren(api.list, panel);
  return { ...api, onSelect, panel, tabs: [...api.list.querySelectorAll('[role=tab]')] };
}
const press = (node, key, extra = {}) =>
  node.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
  );

describe('nextTabIndex', () => {
  it('wraps the arrows and jumps with Home and End', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
    expect(nextTabIndex('x', 0, 3)).toBe(-1);
    expect(nextTabIndex('Home', 0, 0)).toBe(-1);
  });
});

describe('buildTablist', () => {
  it('has the tablist roles, one selected tab in the tab order and a labelled panel', () => {
    const { list, tabs, panel } = mount();
    expect(list.getAttribute('role')).toBe('tablist');
    expect(list.getAttribute('aria-label')).toBe('Views');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1].id);
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
  });
  it('moves with the arrow keys, wraps, and moves focus and the roving tabindex', () => {
    const { tabs, onSelect, panel } = mount();
    tabs[1].focus();
    press(tabs[1], 'ArrowRight');
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[2].id);
    press(tabs[2], 'ArrowRight');
    expect(document.activeElement).toBe(tabs[0]);
    press(tabs[0], 'End');
    expect(document.activeElement).toBe(tabs[2]);
    press(tabs[2], 'Home');
    expect(document.activeElement).toBe(tabs[0]);
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(['c', 'a', 'c', 'a']);
  });
  it('selects on click and ignores keys with a modifier', () => {
    const { tabs, onSelect } = mount();
    tabs[2].click();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(onSelect).toHaveBeenLastCalledWith('c');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    press(tabs[2], 'ArrowLeft', { altKey: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
