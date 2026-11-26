// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  SURFACE_KEY,
  applyConsoleSurface,
  buildSurfaceSwitch,
  readSurfacePreference,
  restoreSurface,
  writeSurfacePreference,
} from './consoleSurface.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}
const blocked = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('console surface', () => {
  it('defaults to day, reads night, and treats junk as day', () => {
    expect(readSurfacePreference(memoryStorage())).toBe('day');
    expect(readSurfacePreference(memoryStorage({ [SURFACE_KEY]: 'night' }))).toBe('night');
    expect(readSurfacePreference(memoryStorage({ [SURFACE_KEY]: 'purple' }))).toBe('day');
  });

  it('works with storage that throws', () => {
    expect(readSurfacePreference(blocked)).toBe('day');
    expect(() => writeSurfacePreference('night', blocked)).not.toThrow();
  });

  it('night sets data-surface=stage, day clears it, restore puts back what was there', () => {
    const node = document.createElement('div');
    expect(applyConsoleSurface(node, 'night')).toBeNull();
    expect(node.getAttribute('data-surface')).toBe('stage');
    const previous = applyConsoleSurface(node, 'day');
    expect(previous).toBe('stage');
    expect(node.hasAttribute('data-surface')).toBe(false);
    restoreSurface(node, 'stage');
    expect(node.getAttribute('data-surface')).toBe('stage');
    restoreSurface(node, null);
    expect(node.hasAttribute('data-surface')).toBe(false);
  });

  it('the switch toggles aria-pressed, the node and the stored choice, even with storage blocked', () => {
    const node = document.createElement('div');
    const storage = memoryStorage();
    const onChange = vi.fn();
    const button = buildSurfaceSwitch({ target: node, initial: 'day', onChange, storage });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(node.getAttribute('data-surface')).toBe('stage');
    expect(storage.getItem(SURFACE_KEY)).toBe('night');
    expect(onChange).toHaveBeenCalledWith('night');
    const b2 = buildSurfaceSwitch({ target: node, initial: 'night', storage: blocked });
    expect(() => b2.click()).not.toThrow();
    expect(node.hasAttribute('data-surface')).toBe(false);
  });
});
