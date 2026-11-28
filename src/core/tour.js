// A guided tour: dim the page, spotlight one area with a short tip, Next / Back / Skip. Any screen declares its steps
// and starts the tour; nothing here knows which screen or format it is on (module boundary: no format imports).
//
//   const tour = startTour({ id: 'example-tour', steps: [{ target: '[data-tour="x"]', title, body }, ...] });
//
// A step is { target?, title, body }. `target` is a CSS selector, looked up again every time the page changes, so a
// screen that re-renders does not leave the spotlight on a deleted node. A step with no `target` is a centred card (a
// welcome or a goodbye). A step whose target is not on the page right now is skipped, so a tour can name a control that
// only some events have.
//
// First run is remembered per device (localStorage, every read and write wrapped: a private window or blocked storage
// just means the tour offers itself again). `shouldAutoStart` says whether to start it on its own; `tourHelpButton`
// is the button that brings it back by hand.
//
// Accessibility: the tip is a dialog that takes focus on every step and names its title and text; the rest of the page
// is `inert` while the tour runs (so Tab stays in the tip and a screen reader reads nothing behind it); Escape skips;
// Left and Right arrows go back and on; focus goes back to where it was; entrance motion is off under
// prefers-reduced-motion (tour.css). Look: src/ui/tokens/tour.css.
import { el } from './dom.js';

const KEY_PREFIX = 'seduh.tour.seen.';
const PAD = 6; // px of air around the spotlighted control
const GAP = 12; // px between the spotlight and the tip
const GUTTER = 16; // px kept clear at the screen edge (360px first)

// ---- first run ----

function store(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // some browsers throw when storage is blocked
  }
}

export function hasSeenTour(id, storage) {
  try {
    return store(storage)?.getItem(KEY_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(id, storage) {
  try {
    store(storage)?.setItem(KEY_PREFIX + id, '1');
  } catch {
    // storage full or blocked: the tour just offers itself again next time
  }
}

export function forgetTourSeen(id, storage) {
  try {
    store(storage)?.removeItem(KEY_PREFIX + id);
  } catch {
    // nothing to forget
  }
}

// Bump the id (`example-tour.v2`) when a tour changes enough that people who saw the old one should see it again.
export const shouldAutoStart = (id, storage) => !hasSeenTour(id, storage);

// ---- geometry (pure, so a test can check it without a layout engine) ----

// Where the tip goes. `target` is the spotlight's box ({ top, left, width, height } in viewport px) or null for a
// centred card; `size` is the tip's own box. Below the target if it fits, else above, else docked to the screen edge
// that is farther from the target (the tip may then cover part of a very tall target; the spotlight still shows it).
export function placeTip({ target, view, size, gap = GAP, gutter = GUTTER }) {
  const maxLeft = Math.max(gutter, view.width - size.width - gutter);
  const clampLeft = (x) => Math.min(Math.max(x, gutter), maxLeft);
  if (!target) {
    return {
      side: 'center',
      top: Math.max(gutter, (view.height - size.height) / 2),
      left: clampLeft((view.width - size.width) / 2),
    };
  }
  const left = clampLeft(target.left + target.width / 2 - size.width / 2);
  const below = target.top + target.height + gap;
  if (below + size.height + gutter <= view.height) return { side: 'below', top: below, left };
  const above = target.top - gap - size.height;
  if (above >= gutter) return { side: 'above', top: above, left };
  const inLowerHalf = target.top + target.height / 2 > view.height / 2;
  return {
    side: 'dock',
    top: inLowerHalf ? gutter : Math.max(gutter, view.height - size.height - gutter),
    left,
  };
}

// The target's box, padded and kept inside the screen.
export function spotBox(rect, view, pad = PAD) {
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const bottom = Math.min(view.height, rect.top + rect.height + pad);
  const right = Math.min(view.width, rect.left + rect.width + pad);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// A full-screen shape with a hole where the spotlight is (even-odd fill), used as the dim layer's clip-path. A
// clip-path, not a huge box-shadow: the design system has no shadows.
export function dimClip(box, view) {
  const { top, left, width, height } = box;
  const r = left + width;
  const b = top + height;
  const px = (n) => `${Math.round(n * 10) / 10}px`;
  return (
    `polygon(evenodd, 0 0, ${view.width}px 0, ${view.width}px ${view.height}px, 0 ${view.height}px, 0 0, ` +
    `${px(left)} ${px(top)}, ${px(left)} ${px(b)}, ${px(r)} ${px(b)}, ${px(r)} ${px(top)}, ${px(left)} ${px(top)})`
  );
}

// ---- the running tour ----

let active = null;

const TARGET_HIDDEN = '[hidden]'; // not [inert]: the tour makes the page inert itself

function findTarget(step) {
  if (!step.target) return null;
  let node = null;
  try {
    node = document.querySelector(step.target);
  } catch {
    return null; // a bad selector is a skipped step, not a crash
  }
  return node && !node.closest(TARGET_HIDDEN) ? node : null;
}

const applies = (step) => !step.target || findTarget(step) !== null;

export function isTourRunning() {
  return active !== null;
}

export function endActiveTour() {
  active?.end('closed');
}

// Starts a tour (ending any other one first). Pass the screen's `signal`: the tour ends when the screen is left. Returns { end, next, back, isActive }. Marks the tour as seen at once,
// so closing the tab part-way does not bring it back at the next visit.
export function startTour({
  id,
  steps,
  storage,
  onEnd = () => {},
  labels = {},
  returnFocusTo = null,
  signal,
} = {}) {
  endActiveTour();
  const words = {
    next: 'Next',
    back: 'Back',
    skip: 'Skip tour',
    done: 'Done',
    ...labels,
  };
  if (!Array.isArray(steps) || !steps.some(applies))
    return { end() {}, next() {}, back() {}, isActive: () => false };
  if (id) markTourSeen(id, storage);

  const uid = `tour-${id ?? 'x'}`;
  const returnTo = returnFocusTo ?? document.activeElement;
  const dim = el('div', { className: 'tour-dim', attrs: { 'aria-hidden': 'true' } });
  const ring = el('div', { className: 'tour-ring', attrs: { 'aria-hidden': 'true' } });
  const count = el('p', { className: 'tour-count', id: `${uid}-count` });
  const title = el('h2', { className: 'tour-title', id: `${uid}-title` });
  const body = el('p', { className: 'tour-body', id: `${uid}-body` });
  const backBtn = el('button', {
    className: 'fb-btn',
    text: words.back,
    attrs: { type: 'button', 'data-tour-action': 'back' },
  });
  const skipBtn = el('button', {
    className: 'fb-btn tour-skip',
    text: words.skip,
    attrs: { type: 'button', 'data-tour-action': 'skip' },
  });
  const nextBtn = el('button', {
    className: 'fb-btn fb-btn--primary',
    text: words.next,
    attrs: { type: 'button', 'data-tour-action': 'next' },
  });
  const tip = el(
    'div',
    {
      className: 'tour-tip',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': `${uid}-title`,
        'aria-describedby': `${uid}-body`,
        tabindex: '-1',
      },
    },
    [
      count,
      title,
      body,
      el('div', { className: 'fb-actions tour-actions' }, [backBtn, nextBtn, skipBtn]),
    ],
  );
  const root = el('div', { className: 'tour', attrs: { 'data-tour-root': '' } }, [dim, ring, tip]);

  let current = null; // the step now showing (an object from `steps`, so it survives a changing list)
  let ended = false;
  let frame = 0;

  const list = () => steps.filter(applies);

  function layout() {
    frame = 0;
    if (ended || !current) return;
    const view = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    };
    const node = findTarget(current);
    const rect = node?.getBoundingClientRect();
    const box = rect && (rect.width || rect.height) ? spotBox(rect, view) : null;
    if (box) {
      ring.hidden = false;
      Object.assign(ring.style, {
        top: `${box.top}px`,
        left: `${box.left}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      dim.style.clipPath = dimClip(box, view);
    } else {
      ring.hidden = true;
      dim.style.clipPath = '';
    }
    const size = { width: tip.offsetWidth, height: tip.offsetHeight };
    const spot = placeTip({ target: box, view, size });
    tip.dataset.side = spot.side;
    tip.style.top = `${spot.top}px`;
    tip.style.left = `${spot.left}px`;
  }

  function schedule() {
    if (frame || ended) return;
    frame = requestAnimationFrame(layout);
  }

  function show(step) {
    current = step;
    const steps2 = list();
    const at = Math.max(0, steps2.indexOf(step));
    const last = at === steps2.length - 1;
    count.textContent = steps2.length > 1 ? `Step ${at + 1} of ${steps2.length}` : '';
    count.hidden = steps2.length <= 1;
    title.textContent = step.title;
    body.textContent = step.body;
    backBtn.hidden = at === 0;
    nextBtn.textContent = last ? words.done : words.next;
    skipBtn.hidden = last;
    const node = findTarget(step);
    if (node) bringIntoView(node);
    layout();
    tip.focus({ preventScroll: true });
    schedule();
  }

  function bringIntoView(node) {
    const rect = node.getBoundingClientRect();
    const tall = rect.height > window.innerHeight * 0.6;
    const prior = node.style.scrollMarginTop;
    node.style.scrollMarginTop = '5rem'; // clear a sticky header
    try {
      node.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
    } catch {
      // an engine without scrollIntoView options: the target is already roughly in place
    }
    node.style.scrollMarginTop = prior;
  }

  function move(delta) {
    const steps2 = list();
    const at = steps2.indexOf(current);
    const nextStep = steps2[(at === -1 ? 0 : at) + delta];
    if (!nextStep) {
      if (delta > 0) end('done');
      return;
    }
    show(nextStep);
  }

  const inerted = [];
  const mutations = new MutationObserver(schedule);

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      end('skipped');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Tab') {
      // inert keeps focus in the tip in a real browser; this keeps it there where inert is missing
      const focusable = [...tip.querySelectorAll('button:not([hidden])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const lastOne = focusable[focusable.length - 1];
      if (!tip.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        lastOne.focus();
      } else if (!event.shiftKey && document.activeElement === lastOne) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const onAbort = () => end('closed');

  function end(how) {
    if (ended) return;
    ended = true;
    if (frame) cancelAnimationFrame(frame);
    mutations.disconnect();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
    signal?.removeEventListener('abort', onAbort);
    for (const node of inerted) node.removeAttribute('inert');
    root.remove();
    if (active === handle) active = null;
    if (returnTo?.isConnected && typeof returnTo.focus === 'function') returnTo.focus();
    onEnd(how);
  }

  backBtn.addEventListener('click', () => move(-1));
  nextBtn.addEventListener('click', () => move(1));
  skipBtn.addEventListener('click', () => end('skipped'));

  const handle = {
    next: () => move(1),
    back: () => move(-1),
    end: (how = 'closed') => end(how),
    isActive: () => !ended,
  };
  active = handle;

  for (const child of [...document.body.children]) {
    if (!child.hasAttribute('inert')) {
      child.setAttribute('inert', '');
      inerted.push(child);
    }
  }
  document.body.appendChild(root);
  if (signal?.aborted) {
    end('closed');
    return handle;
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  mutations.observe(document.body, { childList: true, subtree: true });
  show(list()[0]);
  return handle;
}

// The button that brings a tour back by hand. The screen decides where it sits.
export function tourHelpButton({ onClick, label = 'Take the tour' } = {}) {
  const button = el('button', {
    className: 'btn btn-outline tap-target tour-help',
    text: label,
    attrs: { type: 'button', 'data-tour-help': '' },
  });
  button.addEventListener('click', () => onClick?.());
  return button;
}

// Offers a tour on its own, once per device, a moment after a screen has drawn (so the layout has settled). Does
// nothing for a person who has seen it, in an automated browser (a Playwright run's page would be locked behind the
// tour) or in a unit test, unless `force` is set. Cancelled by the screen's `signal` or the returned function.
export function scheduleTour({ id, steps, signal, storage, delayMs = 500, force = false } = {}) {
  const automated = globalThis.navigator?.webdriver === true || import.meta.env?.MODE === 'test';
  if (!force && (automated || !shouldAutoStart(id, storage))) return () => {};
  const timer = setTimeout(() => {
    if (signal?.aborted || isTourRunning()) return;
    startTour({ id, steps, storage, signal });
  }, delayMs);
  const cancel = () => clearTimeout(timer);
  signal?.addEventListener('abort', cancel, { once: true });
  return cancel;
}
