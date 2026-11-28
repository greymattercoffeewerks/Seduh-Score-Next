import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountTimer } from './timerScreen.js';
import { readFileSync } from 'node:fs';
import { STORAGE_KEY } from './timer.js';
import { answerFeedback, feedbackButton, openFeedbackText } from '../../core/feedbackTestKit.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

function startTimer(root, { minutes = '0', seconds = '3' } = {}) {
  root.querySelector('[aria-label="Custom duration: minutes"]').value = minutes;
  root.querySelector('[aria-label="Custom duration: seconds"]').value = seconds;
  root.querySelector('#timer-start-button').click();
}

describe('mountTimer', () => {
  let root;
  let storage;
  let nowMs;
  let now;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    storage = fakeStorage();
    nowMs = 1_000_000_000;
    now = () => nowMs;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    root.remove();
  });

  it('renders the idle setup form on first mount', () => {
    mountTimer(root, { storage, now });
    expect(root.querySelector('#timer-start-button')).not.toBeNull();
    expect(root.querySelector('#timer-pause-button')).toBeNull();
  });

  it('sits in the shared community frame and hides all of it while a countdown is on screen', async () => {
    mountTimer(root, { storage, now });
    expect(root.querySelector('.public-header')).not.toBeNull();
    expect(root.querySelector('.ct-crumb-current').textContent).toBe('Competition Timer');
    expect(root.querySelectorAll('.ct-tool-title')).toHaveLength(4);
    expect(root.querySelector('.timer-brand-link')).toBeNull();
    const header = root.querySelector('.ct-header');
    const strip = root.querySelector('.ct-strip');
    const bar = root.querySelector('.ct-bar');
    expect([header.hidden, strip.hidden, bar.hidden]).toEqual([false, false, false]);

    startTimer(root, { minutes: '1', seconds: '0' });
    // The frame is the same nodes, hidden; the countdown keeps the screen and its corner brand link.
    expect(root.querySelector('.ct-header')).toBe(header);
    expect([header.hidden, strip.hidden, bar.hidden]).toEqual([true, true, true]);
    expect(root.querySelector('.timer-brand-link')).not.toBeNull();

    root.querySelector('#timer-reset-button').click();
    answerFeedback('confirm');
    await Promise.resolve();
    await Promise.resolve();
    expect([header.hidden, strip.hidden, bar.hidden]).toEqual([false, false, false]);
  });

  it('Start swaps to running controls and moves focus to Pause', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    const pauseButton = root.querySelector('#timer-pause-button');
    expect(pauseButton).not.toBeNull();
    expect(pauseButton.textContent).toBe('Pause');
    expect(document.activeElement).toBe(pauseButton);
  });

  it('rejects a zero duration without starting', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { seconds: '0' });
    expect(root.querySelector('#timer-pause-button')).toBeNull();
    expect(root.querySelector('.timer-error').textContent).not.toBe('');
  });

  it('Pause freezes the display and Resume continues from the same value', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });

    nowMs += 10_000; // 10s elapsed
    root.querySelector('#timer-pause-button').click(); // Pause
    expect(document.activeElement.id).toBe('timer-pause-button');
    const displayAfterPause = root.querySelector('.timer-display-value').textContent;
    expect(displayAfterPause).toBe('7:50');

    root.querySelector('#timer-pause-button').click(); // Resume
    expect(root.querySelector('.timer-display-value').textContent).toBe('7:50');
    expect(document.activeElement.id).toBe('timer-pause-button');
  });

  it('Reset returns to the setup form and moves focus to the title input, once a running timer is confirmed', async () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    root.querySelector('#timer-reset-button').click();
    expect(openFeedbackText()).toContain('Reset the timer?');
    answerFeedback('confirm');
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('#timer-start-button')).not.toBeNull();
    expect(document.activeElement.id).toBe('timer-title-input');
  });

  it('Reset on a running or paused timer asks first, and Cancel keeps the run going', async () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    nowMs += 10_000;
    root.querySelector('#timer-pause-button').click();
    root.querySelector('#timer-reset-button').click();
    expect(feedbackButton('confirm')).not.toBeNull();
    answerFeedback('cancel');
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('.timer-display-value').textContent).toBe('7:50');
    expect(root.querySelector('#timer-start-button')).toBeNull();
  });

  it('Reset on an expired timer asks nothing: there is no run left to lose', async () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '0', seconds: '3' });
    nowMs += 5_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(root.querySelector('#timer-pause-button')).toBeNull(); // expired
    root.querySelector('#timer-reset-button').click();
    expect(feedbackButton('confirm')).toBeNull();
    await Promise.resolve();
    expect(root.querySelector('#timer-start-button')).not.toBeNull();
  });

  it('Cancel on a RUNNING timer keeps it counting', async () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    root.querySelector('#timer-reset-button').click();
    answerFeedback('cancel');
    await Promise.resolve();
    await Promise.resolve();
    nowMs += 5_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(root.querySelector('#timer-start-button')).toBeNull();
    expect(root.querySelector('#timer-pause-button').textContent).toBe('Pause');
  });

  it('keeps Reset out of the Pause row, on a 44px tap floor', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    const pauseRow = root.querySelector('#timer-pause-button').closest('.timer-controls');
    expect(pauseRow.contains(root.querySelector('#timer-reset-button'))).toBe(false);
    const css = readFileSync('src/tools/timer/timer.css', 'utf8');
    expect(css).toMatch(/\.timer-controls-group\s*\{[^}]*gap:\s*var\(--space-6\)/);
    expect(css).toMatch(/\.timer-btn\s*\{[^}]*min-height:\s*var\(--tap-target-min\)/);
  });

  it('announces the urgent threshold exactly once via the polite live region, right at the <= 10s boundary', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { seconds: '12' }); // starts above the 10s threshold

    const urgentStatus = () => root.querySelector('[role="status"]').textContent;
    expect(urgentStatus()).toBe('');

    nowMs += 2_000; // now at exactly 10s remaining — the boundary value itself (<=, not <)
    vi.advanceTimersByTime(250);
    expect(urgentStatus()).toBe('Less than 10 seconds remaining.');

    // Stays announced (not re-cleared/re-fired) on subsequent ticks.
    nowMs += 1_000;
    vi.advanceTimersByTime(250);
    expect(urgentStatus()).toBe('Less than 10 seconds remaining.');
  });

  it('expiry shows a persistent visible, role="alert" banner AND moves focus to it — not just a beep', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { seconds: '3' });

    nowMs += 3_000;
    vi.advanceTimersByTime(250);

    const banner = root.querySelector('#timer-expired-banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Time's up");
    // role="alert" is what makes this an assertive, interrupting
    // announcement rather than plain visible text a sighted user has to
    // happen to notice — the specific mechanism the earlier accessibility
    // review required (see timerScreen.js's own comment on this
    // element).
    expect(banner.getAttribute('role')).toBe('alert');
    // Expiry is the one transition triggered by the system, not a click —
    // an organiser looking away from the screen has no keyboard action to
    // "tab back" to the result, so this focus move (timerScreen.js's
    // `else if (status === 'expired')` branch, separate from the generic
    // focusAfterRender path every button click uses) is the only thing that
    // gets a keyboard/screen-reader user to the message at all.
    expect(document.activeElement).toBe(banner);
    expect(root.querySelector('.timer-display').dataset.status).toBe('expired');
    // Only Reset remains once expired — no Pause/Resume for a finished run.
    expect(root.querySelector('#timer-pause-button')).toBeNull();
  });

  it('reloading mid-run (fresh mount against the same storage) resumes without drift', () => {
    const first = mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    first.unmount();
    root.innerHTML = '';

    nowMs += 60_000; // simulate 60s having passed, e.g. across a page reload
    mountTimer(root, { storage, now });
    expect(root.querySelector('.timer-display-value').textContent).toBe('7:00');
  });

  it('degrades to a fresh idle state when storage holds corrupted JSON', () => {
    storage.setItem(STORAGE_KEY, '{not json');
    expect(() => mountTimer(root, { storage, now })).not.toThrow();
    expect(root.querySelector('#timer-start-button')).not.toBeNull();
  });

  it('unmount clears the ticking interval and restores the original document title', () => {
    const originalTitle = document.title;
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const handle = mountTimer(root, { storage, now });
    startTimer(root, { minutes: '8', seconds: '0' });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const tickHandle = setIntervalSpy.mock.results[0].value;

    handle.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(tickHandle);
    expect(document.title).toBe(originalTitle);
  });

  it('degrades gracefully (not just non-throwing) with Wake Lock / WebAudio APIs unavailable (jsdom has neither) — the timer still actually reaches expiry', () => {
    mountTimer(root, { storage, now });
    startTimer(root, { seconds: '3' });
    nowMs += 3_000;
    vi.advanceTimersByTime(250);

    // Not just "didn't throw" — the missing browser APIs must not silently
    // swallow the expiry transition itself. jsdom implements neither
    // navigator.wakeLock nor AudioContext, so this is the real environment
    // both are feature-detected against.
    const banner = root.querySelector('#timer-expired-banner');
    expect(banner.hidden).toBe(false);
    expect(root.querySelector('.timer-display').dataset.status).toBe('expired');
  });
});
