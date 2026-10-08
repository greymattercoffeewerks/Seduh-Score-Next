// A live, ticking countdown element for a read-only surface (the phone view, the projector). Format-agnostic:
// it needs only `startedAt` (an ISO string) and `durationSecs`, and uses core/countdown.js's own
// organiser/projector/phone-agnostic remainingSecs/isExpired — the cross-surface acceptance criterion
// ("prove organiser, projector and phone all agree on remaining time") only holds if every surface runs the
// exact same math, so no surface re-derives it.
//
// Ticks once a second and flags `data-urgent` in the final 10 seconds.
// `aria-live="off"` is set explicitly on the ticking digits: this content mounts inside a role="status"/
// aria-live="polite" region (viewer-shell's body), and without it a screen reader would announce every
// second. That silences the per-tick noise but also the two moments a non-visual user needs — crossing into
// the urgent window and the clock running out — so `announcementEl` is a separate sr-only node, left out of
// aria-live="off" so the ancestor polite region picks up its (rare, one-shot) text changes.
import { el } from './dom.js';
import { remainingSecs, isExpired } from './countdown.js';
import { formatDuration } from './duration.js';

export const URGENT_THRESHOLD_SECS = 10;

// Returns { elements: [digits, announcement], cleanup }. `className` lets a surface add its own sizing class
// next to the shared one; `viewer-countdown` is the hook the cross-surface Playwright check reads.
export function renderCountdown({ startedAt, durationSecs }, { className = '' } = {}) {
  const countdownEl = el('div', {
    className: `font-mono-score viewer-countdown${className ? ` ${className}` : ''}`,
    attrs: { 'aria-live': 'off' },
  });
  // Explicit aria-live="polite", not relying purely on inheriting the shell's ancestor live region —
  // defensive, and gives the property something concrete to assert on.
  const announcementEl = el('span', {
    className: 'sr-only',
    attrs: { 'aria-live': 'polite' },
  });
  const startedAtMs = new Date(startedAt).getTime();
  let urgentAnnounced = false;
  let expiredAnnounced = false;

  function paint() {
    const remaining = remainingSecs(startedAtMs, durationSecs, Date.now());
    countdownEl.textContent = formatDuration(remaining);
    const urgent = remaining <= URGENT_THRESHOLD_SECS;
    countdownEl.dataset.urgent = urgent ? 'true' : 'false';
    const expired = isExpired(startedAtMs, durationSecs, Date.now());
    if (expired && !expiredAnnounced) {
      expiredAnnounced = true;
      announcementEl.textContent = 'Time is up.';
    } else if (urgent && !expired && !urgentAnnounced) {
      urgentAnnounced = true;
      announcementEl.textContent = 'Less than 10 seconds remaining.';
    }
    return expired;
  }

  const elements = [countdownEl, announcementEl];
  if (paint()) {
    return { elements, cleanup: () => {} };
  }
  const intervalId = setInterval(() => {
    if (paint()) clearInterval(intervalId);
  }, 1000);
  return { elements, cleanup: () => clearInterval(intervalId) };
}
