// Timer — a standalone, free, general-purpose tool (no auth, no Supabase,
// no console/router). Same spirit as the legacy Seduh-Score site: usable
// for anything you're timing — a cupping round, a brew, a competition heat
// — not wired into any Cup Taster event/heat. See src/tools/CLAUDE.md for
// why this lives outside the core/formats module boundary entirely, same
// reasoning as src/marketing/. Deliberately not scoped to "cupping" in
// naming or copy (user decision, 2026-09-12 rebrand) — the original build
// used cupping-specific wording throughout and that read as narrower than
// intended.
import { el, labeledField, brandMark } from '../../core/dom.js';
import { formatDuration, formatDurationLong } from '../../core/duration.js';
import {
  PRESETS,
  URGENT_THRESHOLD_SECS,
  createInitialState,
  getStatus,
  computeRemaining,
  isRunExpired,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  markExpired,
  setSoundEnabled,
  parseCustomDuration,
  loadState,
  saveState,
} from './timer.js';

const APP_TITLE = 'Seduh Timer';
const MAX_CUSTOM_MINUTES = 99; // bounds the display string width at any viewport (DESIGN.md's own --text-5xl/6xl guidance)

// Three short rising beeps via WebAudio — no audio asset to ship/host. Built
// lazily and only from a real click handler (Start), since AudioContext
// creation is subject to browser autoplay-gesture policies; reused for the
// end-of-timer beep, which then plays with no additional gesture needed
// because the context is already unlocked. Sound is never the only signal
// time is up — see the expiry banner/announcement in mountTimer.
function createBeeper() {
  let ctx = null;
  function ensureContext() {
    if (!ctx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      ctx = new AudioContextCtor();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function beep(frequency, startOffset, durationSecs) {
    try {
      const audioCtx = ensureContext();
      if (!audioCtx) return;
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + startOffset + durationSecs,
      );
      oscillator.connect(gain).connect(audioCtx.destination);
      oscillator.start(audioCtx.currentTime + startOffset);
      oscillator.stop(audioCtx.currentTime + startOffset + durationSecs + 0.05);
    } catch {
      // WebAudio unsupported/blocked in this context — degrade silently,
      // same as the Wake Lock/storage fallbacks elsewhere in this file.
    }
  }
  return {
    unlock: ensureContext,
    playExpiry() {
      beep(880, 0, 0.18);
      beep(880, 0.25, 0.18);
      beep(1175, 0.5, 0.35);
    },
  };
}

// The Wake Lock API releases its own sentinel automatically the instant the
// document goes hidden (spec behavior, not a bug) — this wrapper re-requests
// on the next visibilitychange back to visible so a screen that locked mid-
// heat un-sleeps again once the organiser looks at it, matching this
// module's existing "resync on visible" philosophy rather than fighting the
// platform. Unsupported browsers (feature-detected) simply get no wake lock,
// same graceful-degradation shape as loadState()'s storage fallback.
//
// Every enable()/disable()/reacquireIfVisible() call is serialized through
// one `chain` promise rather than allowed to run concurrently — found in
// review (code-reviewer): an `acquire()` awaiting `navigator.wakeLock.request()`
// could resolve AFTER a `disable()` fired (e.g. tab foregrounded right as an
// already-expired timer's tick() calls disable()), unconditionally
// assigning `sentinel` to a lock nothing would ever release again. Chaining
// through one promise means a `disable()` requested while an `acquire()` is
// still in flight always runs strictly after it, and vice versa, so the two
// can never race.
function createWakeLockController() {
  let sentinel = null;
  let wanted = false;
  let chain = Promise.resolve();

  function enqueue(fn) {
    chain = chain.then(fn, fn);
    return chain;
  }

  async function acquire() {
    if (!wanted || sentinel || !('wakeLock' in navigator)) return;
    try {
      const newSentinel = await navigator.wakeLock.request('screen');
      // `wanted` may have flipped to false while this request was in
      // flight — release immediately rather than holding a lock nobody
      // wants anymore.
      if (!wanted) {
        newSentinel.release().catch(() => {});
        return;
      }
      sentinel = newSentinel;
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      // Denied/unsupported in this context — degrade silently, the countdown
      // logic itself is unaffected either way.
    }
  }

  async function release() {
    if (!sentinel) return;
    const current = sentinel;
    sentinel = null;
    await current.release().catch(() => {});
  }

  return {
    enable() {
      wanted = true;
      return enqueue(acquire);
    },
    disable() {
      wanted = false;
      return enqueue(release);
    },
    reacquireIfVisible() {
      if (wanted && document.visibilityState === 'visible') return enqueue(acquire);
      return chain;
    },
  };
}

export function mountTimer(root, { storage = window.localStorage, now = Date.now } = {}) {
  let state = loadState(storage) ?? createInitialState();
  let tickHandle = null;
  let visibilityHandler = null;
  let focusAfterRender = null;
  // Recomputed at the top of each render() while a run is active, mirroring
  // formats/cup-taster/timingScreen.js's own `urgentAnnounced` — idempotent
  // across repeated renders of the same run (Resume, or a page load that
  // lands mid-run already past the threshold), rather than a bit that must
  // be threaded through persisted state.
  let urgentAnnounced = false;
  const beeper = createBeeper();
  const wakeLock = createWakeLockController();
  const originalTitle = document.title;

  let countdownValueEl = null;
  let countdownSrEl = null;
  let countdownEl = null;
  let urgentStatusEl = null;
  let expiredBannerEl = null;

  function persist() {
    saveState(state, storage);
  }

  function stopTicking() {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function announceUrgent() {
    if (urgentStatusEl) urgentStatusEl.textContent = 'Less than 10 seconds remaining.';
  }

  function tick() {
    if (getStatus(state) !== 'running') return;
    const remaining = computeRemaining(state, now());
    if (!urgentAnnounced && remaining <= URGENT_THRESHOLD_SECS && remaining > 0) {
      urgentAnnounced = true;
      announceUrgent();
    }
    if (isRunExpired(state, now())) {
      state = markExpired(state, now());
      persist();
      wakeLock.disable();
      if (state.soundEnabled) beeper.playExpiry();
      render();
      return;
    }
    updateDisplay();
  }

  // Sizes the running countdown to fill whatever space `.timer-display`
  // (a `flex: 1` box) actually has left after its siblings, once the
  // header is shrunk and the controls/sound-toggle below it are laid out —
  // NOT a CSS-only vw/vh formula, which reasons about the whole viewport
  // and can't know how much of it the fixed-height chrome around this box
  // has already consumed (found in review, ui-accessibility-reviewer: on a
  // short/landscape viewport that chrome can eat most of the height, and a
  // vh-sized numeral doesn't shrink to match, visually overlapping the
  // Pause/Reset/sound-toggle controls that come after it). A CSS
  // `container-type: size` + `cqh`/`cqw` attempt was tried first and
  // measurably failed in real testing — `cqh` resolved to a valid non-zero
  // value on a plain explicitly-sized test element, but to 0 specifically
  // on this `flex: 1`-sized box, a genuine browser limitation around
  // container query units on flex-grow-sized (not explicitly-sized) items,
  // not something to paper over with a fallback that only works
  // sometimes. Measuring the real box directly sidesteps that entirely.
  //
  // 3.0 (WORST_CASE_CHAR_RATIO) and the 0.9/0.85 fill fractions mirror the
  // same reasoning the earlier CSS-only version documented: the widest
  // string this display can ever show is "99:59" (MAX_CUSTOM_MINUTES=99 in
  // timer.js), whose advance width in this tabular-nums mono font runs
  // ~3em for 5 characters — sizing off that worst case, not the common
  // shorter one, since a single font-size can't grow with string length.
  const WORST_CASE_CHAR_RATIO = 3.0;
  function fitCountdownFont() {
    if (!countdownEl || !countdownValueEl) return;
    const { clientWidth, clientHeight } = countdownEl;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    const byWidth = (clientWidth * 0.9) / WORST_CASE_CHAR_RATIO;
    const byHeight = clientHeight * 0.85;
    countdownValueEl.style.fontSize = `${Math.max(16, Math.min(byWidth, byHeight))}px`;
  }

  // The countdown's own numeral is plain, always-present text — readable on
  // demand like formats/cup-taster/timingScreen.js's own countdown, not an
  // aria-live region (a value changing every second would spam screen-reader
  // announcements, the same reasoning that file's own module comment gives).
  // Real state changes — crossing the urgent threshold, expiry — go through
  // `urgentStatusEl`/`expiredBannerEl` instead, each updated at most once per
  // transition, never on every tick.
  function updateDisplay() {
    const status = getStatus(state);
    const remaining = computeRemaining(state, now());
    const urgent = status === 'running' && remaining <= URGENT_THRESHOLD_SECS;
    if (countdownValueEl) countdownValueEl.textContent = formatDuration(remaining);
    if (countdownSrEl) countdownSrEl.textContent = formatDurationLong(remaining);
    if (countdownEl) {
      countdownEl.dataset.urgent = urgent ? 'true' : 'false';
      countdownEl.dataset.status = status;
    }
    if (expiredBannerEl) {
      expiredBannerEl.hidden = status !== 'expired';
      if (status === 'expired') {
        expiredBannerEl.textContent = `Time's up${state.title ? ` — ${state.title}` : ''}.`;
      }
    }
    // Found in review (ui-accessibility-reviewer): this was gated on
    // `status === 'running'` alone, so the tab title reverted the INSTANT
    // the timer expired — dropping the one non-auditory cue a Deaf/hard-of-
    // hearing user watching another tab would have. Now it stays overridden
    // through 'expired' too, until Reset starts a fresh idle state.
    if (document.visibilityState === 'hidden' && (status === 'running' || status === 'expired')) {
      document.title =
        status === 'expired'
          ? `Time's up — ${state.title || APP_TITLE}`
          : `${formatDuration(remaining)} — ${state.title || APP_TITLE}`;
    } else {
      document.title = originalTitle;
    }
  }

  function render() {
    stopTicking();
    root.innerHTML = '';

    const status = getStatus(state);
    const container = el('main', { className: 'timer' });
    // Once a countdown is actually running/paused/expired, the number is
    // the ONE thing that matters — competitors need to read it from across
    // a room (user feedback, 2026-09-15). 'focus' mode (styled in
    // timer.css) drops the page's comfortable reading-width cap and lets
    // the countdown claim as much of the viewport as it can; 'setup' keeps
    // the normal boxed form layout, which needs the narrower width to stay
    // readable.
    container.dataset.mode = status === 'idle' ? 'setup' : 'focus';

    // Branding, prominent — this is a free tool given away by Seduh Score
    // (user decision, 2026-09-12), linking back to the marketing home page.
    // brandMark() is hidden from assistive tech since it sits right next to
    // the visible "Seduh Score" text (same reasoning as
    // src/marketing/landingScreen.js's own nav brand, to avoid a doubled
    // announcement).
    const brandMarkEl = brandMark();
    brandMarkEl.classList.add('timer-brand-mark');
    brandMarkEl.setAttribute('aria-hidden', 'true');
    container.appendChild(
      el('a', { className: 'timer-brand-link', attrs: { href: '/' } }, [
        brandMarkEl,
        el('span', { className: 'timer-brand-name', text: 'Seduh Score' }),
      ]),
    );

    container.appendChild(el('h1', { className: 'timer-heading', text: APP_TITLE }));
    // Only shown before a run starts (user feedback, 2026-09-12) — once
    // there's a countdown on screen, the description has done its job and
    // just pushes the number further down/adds noise to a view someone is
    // now glancing at repeatedly, not reading.
    if (status === 'idle') {
      container.appendChild(
        el('p', {
          className: 'timer-tagline',
          text: 'A free, general-purpose timer for anything you time — brewing, competitions, cupping rounds, anything. Runs in this tab, keeps counting through a tab switch or screen sleep, blinks and beeps when time is up.',
        }),
      );
    }

    if (state.title) {
      container.appendChild(el('h2', { className: 'timer-title', text: state.title }));
    }

    countdownValueEl = el('span', { className: 'timer-display-value' });
    countdownSrEl = el('span', { className: 'sr-only' });
    countdownEl = el('div', { className: 'timer-display' }, [countdownValueEl, countdownSrEl]);
    container.appendChild(countdownEl);

    // Two distinct live regions, not one shared with the ticking numeral
    // above: `urgentStatusEl` (polite) carries the one-shot "10 seconds
    // remaining" notice; `expiredBannerEl` (role="alert", visible — not
    // sr-only) is both the persistent on-screen "Time's up" text AND the
    // assertive announcement, matching this codebase's own established
    // "role=alert for the one message that must interrupt" precedent
    // (formats/cup-taster/timingScreen.js's manual-time-local-error).
    urgentStatusEl = el('p', {
      className: 'sr-only',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    expiredBannerEl = el('p', {
      className: 'timer-expired-banner',
      attrs: { role: 'alert', id: 'timer-expired-banner', tabindex: '-1' },
    });
    expiredBannerEl.hidden = true;
    container.appendChild(urgentStatusEl);
    container.appendChild(expiredBannerEl);

    if (status === 'idle') {
      container.appendChild(buildSetupForm());
    } else {
      container.appendChild(buildRunningControls(status));
    }

    container.appendChild(buildSoundToggle());

    root.appendChild(container);
    updateDisplay();
    if (status !== 'idle') fitCountdownFont();

    if (status === 'running') {
      urgentAnnounced = computeRemaining(state, now()) <= URGENT_THRESHOLD_SECS;
      tickHandle = setInterval(tick, 250);
      wakeLock.enable();
    }

    // Rebuild-then-refocus, same convention formats/cup-taster/timingScreen.js
    // already establishes for this codebase — found in review
    // (ui-accessibility-reviewer): without this, root.innerHTML = '' above
    // drops focus to <body> on every Start/Pause/Resume/Reset/expiry,
    // forcing a keyboard user to tab from the top of the page each time.
    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (status === 'expired') {
      expiredBannerEl.focus?.();
    }
  }

  function buildSetupForm() {
    const titleInput = el('input', {
      className: 'timer-input',
      id: 'timer-title-input',
      attrs: { type: 'text', maxlength: '60', 'aria-label': 'Timer label (optional)' },
    });
    titleInput.value = state.title;

    const presetButtons = PRESETS.map((preset) => {
      const button = el('button', {
        className: 'timer-preset',
        text: preset.label,
        attrs: {
          type: 'button',
          'aria-pressed': preset.secs === state.durationSecs ? 'true' : 'false',
        },
      });
      button.addEventListener('click', () => {
        minutesInput.value = String(Math.floor(preset.secs / 60));
        secondsInput.value = String(preset.secs % 60);
        for (const btn of presetButtons) {
          btn.setAttribute('aria-pressed', btn === button ? 'true' : 'false');
        }
      });
      return button;
    });

    const minutesInput = el('input', {
      className: 'timer-input timer-input-narrow',
      attrs: {
        type: 'number',
        min: '0',
        max: String(MAX_CUSTOM_MINUTES),
        inputmode: 'numeric',
        'aria-label': 'Custom duration: minutes',
        value: String(Math.floor(state.durationSecs / 60)),
      },
    });
    const secondsInput = el('input', {
      className: 'timer-input timer-input-narrow',
      attrs: {
        type: 'number',
        min: '0',
        max: '59',
        inputmode: 'numeric',
        'aria-label': 'Custom duration: seconds',
        value: String(state.durationSecs % 60),
      },
    });
    // Typing a custom value should deselect the presets rather than silently
    // ignoring it or fighting the preset the user just clicked.
    const clearPresetSelection = () => {
      for (const btn of presetButtons) btn.setAttribute('aria-pressed', 'false');
    };
    minutesInput.addEventListener('input', clearPresetSelection);
    secondsInput.addEventListener('input', clearPresetSelection);

    const errorEl = el('p', { className: 'timer-error', attrs: { role: 'alert' } });

    const startButton = el('button', {
      className: 'timer-btn timer-btn-primary',
      id: 'timer-start-button',
      text: 'Start',
      attrs: { type: 'button' },
    });
    startButton.addEventListener('click', () => {
      const durationSecs = parseCustomDuration(minutesInput.value, secondsInput.value);
      if (durationSecs == null) {
        errorEl.textContent = 'Enter a duration greater than zero.';
        return;
      }
      errorEl.textContent = '';
      beeper.unlock(); // unlock audio autoplay policy from this real click
      state = startTimer(state, { title: titleInput.value.trim(), durationSecs, now: now() });
      persist();
      focusAfterRender = '#timer-pause-button';
      render();
    });

    const titleField = labeledField('Label this timer (optional)', titleInput);
    // .timer-setup's own align-items: center shrink-wraps every direct
    // child to its own content width by default — fine for the narrow
    // preset/duration rows and buttons, but it left this one field's
    // 100%-width input resolving against its own shrunk-to-fit wrapper
    // rather than the row's real width, rendering visibly narrower than
    // the presets row directly beneath it (found in review,
    // ui-accessibility-reviewer, while verifying an unrelated spacing fix —
    // pre-existing, not introduced by that fix, just newly visible once the
    // label above it had real height). align-self here overrides the
    // parent's align-items for just this one child.
    titleField.classList.add('timer-title-field');

    return el('form', { className: 'timer-setup' }, [
      titleField,
      el('div', { className: 'timer-presets' }, presetButtons),
      el('div', { className: 'timer-custom-duration' }, [
        labeledField('Minutes', minutesInput),
        el('span', { className: 'timer-duration-separator', text: ':' }),
        labeledField('Seconds', secondsInput),
      ]),
      errorEl,
      startButton,
    ]);
  }

  function buildRunningControls(status) {
    const pauseResumeButton = el('button', {
      className: 'timer-btn timer-btn-primary',
      id: 'timer-pause-button',
      text: status === 'paused' ? 'Resume' : 'Pause',
      attrs: { type: 'button' },
    });
    pauseResumeButton.addEventListener('click', () => {
      state = status === 'paused' ? resumeTimer(state, now()) : pauseTimer(state, now());
      persist();
      // Deliberately NOT calling wakeLock.disable() on pause (unlike expiry
      // and Reset, which do) — a pause is a short in-session break, not the
      // end of this run, and the organiser is still looking at this same
      // screen; there's no reason to let it sleep out from under them.
      focusAfterRender = '#timer-pause-button';
      render();
    });

    const resetButton = el('button', {
      className: 'timer-btn timer-btn-outline',
      id: 'timer-reset-button',
      text: 'Reset',
      attrs: { type: 'button' },
    });
    resetButton.addEventListener('click', () => {
      state = resetTimer(state);
      persist();
      wakeLock.disable();
      focusAfterRender = '#timer-title-input';
      render();
    });

    const buttons = [resetButton];
    if (status !== 'expired') buttons.unshift(pauseResumeButton);

    return el('div', { className: 'timer-controls' }, buttons);
  }

  function buildSoundToggle() {
    const checkbox = el('input', {
      attrs: { type: 'checkbox', id: 'timer-sound' },
    });
    checkbox.checked = state.soundEnabled;
    checkbox.addEventListener('change', () => {
      state = setSoundEnabled(state, checkbox.checked);
      persist();
    });
    const label = el('label', {
      className: 'timer-sound-label',
      attrs: { for: 'timer-sound' },
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' Sound when time is up'));
    return label;
  }

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      wakeLock.reacquireIfVisible();
      tick(); // catch up immediately rather than waiting for the next interval tick
    } else {
      updateDisplay(); // reflect the "hidden" tab-title state right away
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Keeps the countdown correctly sized across a window resize or device
  // rotation without waiting for the next Start/Pause/Resume/Reset —
  // `fitCountdownFont()` only measures/applies while actually running
  // (idle mode has its own CSS-only clamp() and no per-frame measuring
  // need).
  const resizeHandler = () => {
    if (getStatus(state) !== 'idle') fitCountdownFont();
  };
  window.addEventListener('resize', resizeHandler);

  render();

  return {
    unmount() {
      stopTicking();
      if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
      }
      window.removeEventListener('resize', resizeHandler);
      wakeLock.disable();
      document.title = originalTitle;
    },
  };
}
