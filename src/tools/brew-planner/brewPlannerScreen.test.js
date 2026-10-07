// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountBrewPlanner } from './brewPlannerScreen.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function buttonWithText(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.includes(text));
}

describe('mountBrewPlanner', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector('#app');
    window.scrollTo = () => {};
  });

  it('starts on the first wizard step and offers the example', () => {
    mountBrewPlanner(root, { storage: memoryStorage() });
    expect(root.querySelector('h1')).not.toBeNull();
    expect(buttonWithText(root, 'Cup Taster 2026 example')).toBeDefined();
  });

  it('loads the example and reaches the cheat sheet with 76 batches', () => {
    mountBrewPlanner(root, { storage: memoryStorage() });
    buttonWithText(root, 'Cup Taster 2026 example').click();
    for (let i = 0; i < 5; i += 1) {
      const next = buttonWithText(root, 'Next') ?? buttonWithText(root, 'Cheat sheet');
      if (!next) break;
      next.click();
    }
    expect(root.textContent).toContain('76');
  });

  function openCheatSheet(storage) {
    mountBrewPlanner(root, { storage });
    buttonWithText(root, 'Cup Taster 2026 example').click();
    for (let i = 0; i < 4; i += 1)
      (buttonWithText(root, 'Next') ?? buttonWithText(root, 'Build my cheat sheet')).click();
  }

  it('ticks a run-sheet row and restores it from storage on a fresh mount', () => {
    const storage = memoryStorage();
    openCheatSheet(storage);
    buttonWithText(root, 'Run-sheet').click();
    const box = root.querySelector('input[type="checkbox"]');
    expect(box).not.toBeNull();
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(storage.getItem('seduh-brew-planner-v1')).toContain('"P1-1":true');

    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector('#app');
    mountBrewPlanner(root, { storage });
    expect(root.querySelector('tr.bp-row-done input[type="checkbox"]').checked).toBe(true);
    expect(root.querySelectorAll('tr.bp-row-done')).toHaveLength(1);
  });

  it('lists 76 paper filters and the three Cambro sizes on the supplies view', () => {
    openCheatSheet(memoryStorage());
    buttonWithText(root, 'Water, filters and Cambros').click();
    const tableByLabel = (label) => root.querySelector(`[aria-label="${label}"] table`);
    const column = (table, index) =>
      [...table.querySelectorAll('tbody tr')].map((tr) => Number(tr.children[index].textContent));
    const sum = (values) => values.reduce((a, b) => a + b, 0);
    expect(root.textContent).toContain('You need 76 paper filters');
    expect(sum(column(tableByLabel('Paper filters by stage'), 1))).toBe(76);
    expect(sum(column(tableByLabel('Paper filters by machine'), 1))).toBe(76);
    const sizes = [...tableByLabel('Cambro sizes').querySelectorAll('tbody tr')].map((tr) => [
      tr.children[0].textContent,
      tr.children[3].textContent,
    ]);
    expect(sizes).toEqual([
      ['1.5 gal', '8'],
      ['2.5 gal', '6'],
      ['4.75 gal', '4'],
    ]);
  });

  it('falls back to the example when saved data is corrupt', () => {
    const storage = memoryStorage();
    storage.setItem('seduh-brew-planner-v1', '{bad');
    mountBrewPlanner(root, { storage });
    expect(root.querySelector('h1')).not.toBeNull();
  });
});
