// Night or day for the organiser console (Petrol: the console at night is `data-surface="stage"`, not a third mode).
// The choice is a per-device convenience kept in localStorage; every read and write is wrapped, because storage can
// be blocked or throw (private window, cleared site data) and the page must work without it. Absent or unreadable
// means day, so nothing changes for anyone who never touches the switch.
// Format-agnostic: it knows a node and two words, nothing about any format.
import { el } from './dom.js';

export const SURFACE_KEY = 'seduh.consoleSurface';
export const SURFACES = ['day', 'night'];

// 'day' | 'night'. Anything else, or storage that throws, is 'day'.
export function readSurfacePreference(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(SURFACE_KEY);
    return value === 'night' ? 'night' : 'day';
  } catch {
    return 'day';
  }
}

// Best effort: a failed write only means the choice is not remembered.
export function writeSurfacePreference(surface, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SURFACE_KEY, surface === 'night' ? 'night' : 'day');
  } catch {
    /* not remembered; the switch still works for this visit */
  }
}

// Sets (night) or clears (day) `data-surface` on a node. Returns the node's previous attribute value, so a screen
// can put things back exactly as it found them when it unmounts.
export function applyConsoleSurface(node, surface) {
  if (!node) return null;
  const previous = node.getAttribute('data-surface');
  if (surface === 'night') node.setAttribute('data-surface', 'stage');
  else node.removeAttribute('data-surface');
  return previous;
}

export function restoreSurface(node, previous) {
  if (!node) return;
  if (previous == null) node.removeAttribute('data-surface');
  else node.setAttribute('data-surface', previous);
}

/**
 * DOM. A toggle button: "Night mode", pressed when night. It writes the preference, applies it to `target`, and
 * calls `onChange(surface)`.
 * @param {{ target: HTMLElement, initial?: 'day'|'night', onChange?: Function, storage?: Storage }} options
 */
export function buildSurfaceSwitch({
  target,
  initial = readSurfacePreference(),
  onChange,
  storage,
}) {
  let current = initial === 'night' ? 'night' : 'day';
  const button = el('button', {
    className: 'btn btn-outline tap-target console-surface-switch',
    text: current === 'night' ? 'Night mode: on' : 'Night mode: off',
    attrs: { type: 'button', 'aria-pressed': String(current === 'night') },
  });
  button.addEventListener('click', () => {
    current = current === 'night' ? 'day' : 'night';
    button.setAttribute('aria-pressed', String(current === 'night'));
    button.textContent = current === 'night' ? 'Night mode: on' : 'Night mode: off';
    writeSurfacePreference(current, storage);
    applyConsoleSurface(target, current);
    onChange?.(current);
  });
  return button;
}
