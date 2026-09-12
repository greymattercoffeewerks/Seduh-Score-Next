// Pure state/logic for the standalone Timer tool (no DOM, no
// setInterval/setTimeout/Audio/WakeLock) — same "engine vs. surface" split
// as core/countdown.js, and this module is literally built on top of it:
// every remaining-time read goes through remainingSecs()/isExpired() so a
// backgrounded tab or a page reload recomputes from wall-clock time rather
// than drifting. Kept fully testable with injected `now`/storage, matching
// this codebase's established dependency-injection convention (`client`
// params elsewhere).
import { remainingSecs, isExpired } from '../../core/countdown.js';

export const STORAGE_KEY = 'seduh-timer-v1';

// General-purpose durations, not scoped to any one use — this tool is for
// anything you're timing (a cupping round, a brew, a competition heat),
// not just cupping (user decision, 2026-09-12 rebrand).
export const PRESETS = [
  { label: '8:00', secs: 480 },
  { label: '5:00', secs: 300 },
  { label: '3:00', secs: 180 },
  { label: '1:00', secs: 60 },
];

export const URGENT_THRESHOLD_SECS = 10;

export function createInitialState() {
  return {
    title: '',
    durationSecs: PRESETS[0].secs,
    startedAt: null, // epoch ms while running; null while idle/paused/expired
    pausedRemainingSecs: null, // set only while paused
    expiredAt: null, // set once, the first time this run's clock hits zero
    soundEnabled: true,
  };
}

export function getStatus(state) {
  if (state.expiredAt != null) return 'expired';
  if (state.startedAt != null) return 'running';
  if (state.pausedRemainingSecs != null) return 'paused';
  return 'idle';
}

export function computeRemaining(state, now) {
  switch (getStatus(state)) {
    case 'running':
      return remainingSecs(state.startedAt, state.durationSecs, now);
    case 'paused':
      return state.pausedRemainingSecs;
    case 'expired':
      return 0;
    default:
      return state.durationSecs;
  }
}

export function isRunExpired(state, now) {
  return getStatus(state) === 'running' && isExpired(state.startedAt, state.durationSecs, now);
}

export function startTimer(state, { title, durationSecs, now }) {
  return {
    ...state,
    title,
    durationSecs,
    startedAt: now,
    pausedRemainingSecs: null,
    expiredAt: null,
  };
}

export function pauseTimer(state, now) {
  if (getStatus(state) !== 'running') return state;
  return {
    ...state,
    startedAt: null,
    pausedRemainingSecs: remainingSecs(state.startedAt, state.durationSecs, now),
  };
}

// Resuming recomputes a virtual `startedAt` in the past so the SAME pure
// remainingSecs() call used everywhere else continues counting down from
// exactly where the pause left off, rather than this module needing its own
// separate "seconds already consumed" accumulator.
export function resumeTimer(state, now) {
  if (getStatus(state) !== 'paused') return state;
  return {
    ...state,
    startedAt: now - (state.durationSecs - state.pausedRemainingSecs) * 1000,
    pausedRemainingSecs: null,
  };
}

export function resetTimer(state) {
  return {
    ...state,
    startedAt: null,
    pausedRemainingSecs: null,
    expiredAt: null,
  };
}

export function markExpired(state, now) {
  if (state.expiredAt != null) return state;
  return { ...state, expiredAt: now };
}

export function setSoundEnabled(state, soundEnabled) {
  return { ...state, soundEnabled };
}

// Pure, so it lives here (not timerScreen.js) next to the other
// transitions and gets the same unit-test coverage — found in review
// (code-reviewer): this had no DOM/timer/audio dependency of its own and
// didn't belong in the impure screen file.
export function parseCustomDuration(minutesRaw, secondsRaw) {
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseInt(secondsRaw, 10);
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 && seconds < 60 ? seconds : 0;
  const total = safeMinutes * 60 + safeSeconds;
  return total > 0 ? total : null;
}

// Storage failures (private browsing, quota, disabled storage) degrade to
// "no persistence" rather than breaking the timer — this tool has no other
// state to lose. A parseable-but-non-object value (e.g. a stray `"foo"` or
// `42`) is treated the same as corrupted JSON — found in review
// (code-reviewer): without this check, spreading a non-object into
// createInitialState() silently added junk keys instead of failing closed.
export function loadState(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...createInitialState(), ...parsed };
  } catch {
    return null;
  }
}

export function saveState(state, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — see loadState()'s own comment.
  }
}
