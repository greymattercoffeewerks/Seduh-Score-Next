// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderSkeletonBoard, SKELETON_ROWS } from './skeletonBoard.js';
import { renderHoldingState } from './viewer-shell.js';

describe('skeletonBoard', () => {
  it('is hidden from assistive tech and carries no text, so it can never read as data', () => {
    const board = renderSkeletonBoard();
    expect(board.getAttribute('aria-hidden')).toBe('true');
    expect(board.textContent).toBe('');
    expect(board.querySelectorAll('.skeleton-row')).toHaveLength(SKELETON_ROWS);
  });

  it('is never animated by its stylesheet (a moving placeholder could pass for live numbers)', () => {
    const css = readFileSync('src/core/viewer-shell.css', 'utf8');
    const start = css.indexOf('loading placeholder');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start);
    expect(block).not.toMatch(/animation|transition/);
  });

  it('the connecting words stay in the holding card, which is what is announced', () => {
    expect(renderHoldingState('connecting').textContent).toContain('Connecting');
  });
});
