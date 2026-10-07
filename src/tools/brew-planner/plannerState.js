// Saved setup and ticks for the Brew Planner. Everything here is the person's own input —
// nothing derived is stored (the plan is recomputed from the setup every time), so a saved
// setup can never disagree with the schedule shown from it.
import { EXAMPLE_CONFIG } from './planner.js';

export const STORAGE_KEY = 'seduh-brew-planner-v1';
export const STEPS = ['Heats', 'Coffees', 'Machines', 'Timing', 'Cheat sheet'];
export const VIEWS = ['check', 'runsheet', 'timeline', 'heats', 'supplies'];
export const MAX_COFFEES = 4;

export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

export function createInitialState() {
  return {
    config: cloneConfig(EXAMPLE_CONFIG),
    done: {},
    step: 0,
    view: 'check',
  };
}

// "4, 4, 3" -> [4, 4, 3]. Anything that is not a whole number above zero becomes NaN, so
// validateConfig() reports it instead of the parser guessing.
export function parseCuppers(text) {
  return String(text)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
}

export function nextId(prefix, existingIds) {
  let n = existingIds.length + 1;
  while (existingIds.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Saved data is only trusted if it has the shape the planner needs; otherwise the example
// setup is used, so a stale or hand-edited save never breaks the page.
function looksLikeConfig(config) {
  return (
    isPlainObject(config) &&
    config.version === 1 &&
    Array.isArray(config.coffees) &&
    Array.isArray(config.machines) &&
    Array.isArray(config.stages) &&
    config.stages.every((stage) => isPlainObject(stage) && Array.isArray(stage.heats)) &&
    config.stages.every((stage) => isPlainObject(stage.mix))
  );
}

export function loadState(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed) || !looksLikeConfig(parsed.config)) return null;
    const initial = createInitialState();
    return {
      config: parsed.config,
      done: isPlainObject(parsed.done) ? parsed.done : {},
      step:
        Number.isInteger(parsed.step) && parsed.step >= 0 && parsed.step < STEPS.length
          ? parsed.step
          : initial.step,
      view: VIEWS.includes(parsed.view) ? parsed.view : initial.view,
    };
  } catch {
    return null;
  }
}

export function saveState(state, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort: private windows and blocked storage just mean nothing is remembered.
  }
}

export function minutesToTimeValue(mins) {
  const hours = Math.floor(mins / 60) % 24;
  const minutes = Math.round(mins % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeValueToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}
