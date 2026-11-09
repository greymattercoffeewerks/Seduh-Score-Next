// A loading placeholder shaped like a standings board (Petrol V2 P3): a heading bar and a few rows of position,
// name and value, so a phone or projector that is still connecting does not jump when the real board arrives on
// slow venue wifi. Format-agnostic: it draws no names, numbers or format words.
//
// Rules this keeps (all of them are about never being mistaken for live data):
//   - hollow dashed outlines, not filled bars, and not animated (no shimmer, no pulse), so it cannot read as
//     numbers changing;
//   - aria-hidden: the words "Connecting…" in the holding card above it are what is announced;
//   - it is only drawn by core/viewer-shell.js for the `connecting` phase, so it is never shown beside a live
//     display, and it sits below the shell's TEST banner host, which is unaffected (D9).
// Styled in core/viewer-shell.css (`.skeleton-board`), token-only.
import { el } from './dom.js';

export const SKELETON_ROWS = 5;

export function renderSkeletonBoard({ rows = SKELETON_ROWS } = {}) {
  const row = () =>
    el('div', { className: 'skeleton-row' }, [
      el('span', { className: 'skeleton-block skeleton-pos' }),
      el('span', { className: 'skeleton-block skeleton-name' }),
      el('span', { className: 'skeleton-block skeleton-value' }),
    ]);
  return el(
    'div',
    { className: 'skeleton-board', attrs: { 'aria-hidden': 'true', 'data-skeleton': 'board' } },
    [
      el('span', { className: 'skeleton-block skeleton-heading' }),
      ...Array.from({ length: rows }, row),
    ],
  );
}
