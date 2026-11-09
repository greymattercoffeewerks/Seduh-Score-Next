// Rank slides and score ticks (Petrol V2 P3): when a standings list is redrawn, each row slides from where it was
// to where it is now (the FLIP technique) and a number that changed ticks in. ONE format-agnostic module for every
// format's phone view and venue display: it knows rows, keys and text, never what is ranked.
//
// A format marks what it draws:
//   - a row:   data-rank-key="<stable key, e.g. the name>"      (RANK_KEY_ATTR)
//   - a value: data-rank-value on the cell whose text may change (RANK_VALUE_ATTR)
// then redraws through `withRankMotion(container, () => redraw())`, or calls `captureRankState` before and
// `playRankMotion` after. Rows are matched by key, so a row that is new, gone, or whose key appears twice
// (two cuppers with one name) is simply left alone: no motion is ever better than motion on the wrong row.
//
// The motion is decoration. The new state is already in the DOM when the animation starts, so nothing waits on it
// and a screen reader or a script reads the final text immediately. With reduced motion (the OS setting) nothing
// is animated at all: the update is instant. Durations and easing are the Petrol V2 motion tokens
// (--dur-stage, --ease-out), applied by core/rankMotion.css.
export const RANK_KEY_ATTR = 'data-rank-key';
export const RANK_VALUE_ATTR = 'data-rank-value';
export const TICK_CLASS = 'rank-tick';

// Mark a drawn row for motion: its key, and the cells whose text may change. Returns the row.
export function markRankRow(row, key, valueCells = []) {
  row.setAttribute(RANK_KEY_ATTR, String(key));
  for (const cell of valueCells) cell.setAttribute(RANK_VALUE_ATTR, '');
  return row;
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// A row hidden with the `hidden` attribute (on itself or an ancestor) has no layout box, so it has no position to
// slide from or to: it is left out of both the capture and the play.
function rowsOf(root) {
  return Array.from(root.querySelectorAll(`[${RANK_KEY_ATTR}]`)).filter(
    (row) => !row.closest('[hidden]'),
  );
}

function valuesOf(row) {
  return Array.from(row.querySelectorAll(`[${RANK_VALUE_ATTR}]`)).map((cell) => cell.textContent);
}

// What is on screen now: key -> { top, values }, for every row whose key is unique. Call BEFORE redrawing.
export function captureRankState(root) {
  const state = new Map();
  const seen = new Set();
  for (const row of rowsOf(root)) {
    const key = row.getAttribute(RANK_KEY_ATTR);
    if (seen.has(key)) {
      state.delete(key);
      continue;
    }
    seen.add(key);
    state.set(key, { top: row.getBoundingClientRect().top, values: valuesOf(row) });
  }
  return state;
}

// Animate from `previous` (captureRankState) to what is in `root` now. Call AFTER redrawing. Returns the number of
// rows it moved or ticked (0 when reduced motion is on or nothing changed), which is what tests assert.
export function playRankMotion(root, previous, { reduced = reducedMotion() } = {}) {
  if (reduced || !previous || previous.size === 0) return 0;
  const moves = [];
  const ticks = [];
  const rows = rowsOf(root);
  const counts = new Map();
  for (const row of rows) {
    const key = row.getAttribute(RANK_KEY_ATTR);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    const key = row.getAttribute(RANK_KEY_ATTR);
    // A key that appears twice in the redrawn list is ambiguous: neither row is animated.
    if (counts.get(key) > 1) continue;
    const before = previous.get(key);
    if (!before) continue;
    const delta = before.top - row.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) moves.push({ row, delta });
    const cells = Array.from(row.querySelectorAll(`[${RANK_VALUE_ATTR}]`));
    cells.forEach((cell, i) => {
      if (before.values[i] !== undefined && before.values[i] !== cell.textContent) ticks.push(cell);
    });
  }
  // The row is a rank-moving element only for the length of the slide; clean up whatever happens.
  for (const { row, delta } of moves) {
    row.style.transition = 'none';
    row.style.transform = `translateY(${delta}px)`;
  }
  if (moves.length > 0) void root.getBoundingClientRect(); // commit the start position before releasing it
  for (const { row } of moves) {
    row.style.transition = '';
    row.style.transform = '';
    row.classList.add('rank-slide');
    row.addEventListener(
      'transitionend',
      () => {
        row.classList.remove('rank-slide');
      },
      { once: true },
    );
  }
  for (const cell of ticks) {
    cell.classList.remove(TICK_CLASS);
    void cell.offsetWidth; // restart the animation if one is still running
    cell.classList.add(TICK_CLASS);
    cell.addEventListener('animationend', () => cell.classList.remove(TICK_CLASS), { once: true });
  }
  return moves.length + ticks.length;
}

// Capture, redraw, play. `redraw` runs exactly once and its return value is passed back, so a caller can wrap an
// existing render call (a cleanup function, a node) without changing it. A throw from `redraw` propagates; the
// motion never runs on a half-drawn list.
export function withRankMotion(root, redraw) {
  const previous = captureRankState(root);
  const result = redraw();
  try {
    playRankMotion(root, previous);
  } catch (err) {
    console.error('rankMotion: could not animate', err);
  }
  return result;
}
