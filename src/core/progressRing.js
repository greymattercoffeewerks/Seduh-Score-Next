// A small ring that fills while a page is held, with the seconds left in its middle — the room's cue that the
// screen is about to change, so nobody is mid-read (or mid-photo) when it does. Format-agnostic: it knows
// durations, not what is being shown.
//
// Progress is computed from the wall clock (startedAt + durationMs), never accumulated per frame, and written
// by a timer rather than a CSS animation: the stage display re-attaches its DOM whenever a new live payload
// arrives, which would restart a CSS animation and make the ring lie about how long is left. A re-attached
// ring simply paints the right value on its next tick. The ring is decorative (aria-hidden); the page counter
// text beside it carries the information for anyone who can't see it.
import { svgEl, el } from './dom.js';
import { remainingSecs } from './countdown.js';

const RADIUS = 15.9155; // circumference 100: the dash maths below is then a plain percentage
const CIRCUMFERENCE = 100;

// 0 at the start, 1 once `durationMs` has passed; never outside that range or NaN.
export function ringProgress(now, startedAt, durationMs) {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / durationMs));
}

// The arc is drawn as a dash: `visible` of CIRCUMFERENCE, so a progress of 0.25 shows a quarter ring.
export function ringDashArray(progress) {
  const visible = Math.round(Math.min(1, Math.max(0, progress)) * CIRCUMFERENCE * 10) / 10;
  return `${visible} ${CIRCUMFERENCE}`;
}

// Whole seconds left, by the same rule every countdown here uses (core/countdown.js), never a second copy of it.
export function secondsLeft(now, startedAt, durationMs) {
  return remainingSecs(startedAt, Math.ceil(durationMs / 1000), now);
}

// Returns { el, run, stop, destroy }. `run({ durationMs, startedAt })` (re)starts the ring from `startedAt`.
// Under prefers-reduced-motion it repaints once a second (a stepped ring) instead of ten times a second.
export function createProgressRing({
  now = Date.now,
  setTick = setInterval,
  clearTick = clearInterval,
  reducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
} = {}) {
  const arc = svgEl('circle', {
    class: 'stage-ring-arc',
    cx: '18',
    cy: '18',
    r: String(RADIUS),
    fill: 'none',
    'stroke-width': '3',
    'stroke-linecap': 'round',
    transform: 'rotate(-90 18 18)',
    'stroke-dasharray': ringDashArray(0),
  });
  const svg = svgEl('svg', {
    viewBox: '0 0 36 36',
    class: 'stage-ring-svg',
    'aria-hidden': 'true',
  });
  svg.append(
    svgEl('circle', {
      class: 'stage-ring-track',
      cx: '18',
      cy: '18',
      r: String(RADIUS),
      fill: 'none',
      'stroke-width': '3',
    }),
    arc,
  );
  const count = el('span', { className: 'stage-ring-count' });
  const root = el('span', { className: 'stage-ring', attrs: { 'aria-hidden': 'true' } }, [
    svg,
    count,
  ]);

  let tick = null;
  let lastDash = null;
  let lastCount = null;

  function stop() {
    if (tick !== null) clearTick(tick);
    tick = null;
  }

  function run({ durationMs, startedAt = now() }) {
    stop();
    function paint() {
      const t = now();
      // Written only when the value changed: repainting the same text ten times a second is pure DOM churn.
      const dash = ringDashArray(ringProgress(t, startedAt, durationMs));
      if (dash !== lastDash) {
        arc.setAttribute('stroke-dasharray', dash);
        lastDash = dash;
      }
      const left = String(secondsLeft(t, startedAt, durationMs));
      if (left !== lastCount) {
        count.textContent = left;
        lastCount = left;
      }
    }
    paint();
    tick = setTick(paint, reducedMotion() ? 1000 : 100);
  }

  return { el: root, run, stop, destroy: stop };
}
