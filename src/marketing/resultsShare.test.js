import { describe, expect, it, vi } from 'vitest';
import { buildResultsShareControl } from './resultsShare.js';

const words = { formatLabel: () => 'Throwdown', formatDate: () => '27 Nov 2026' };
const event = {
  format: 'throwdown',
  eventName: 'Fictional Throwdown Vol. 9',
  podium: [{ rank: 1, name: 'Ada Winner' }],
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('buildResultsShareControl', () => {
  it('is no control for a result with no winner', () => {
    expect(buildResultsShareControl({ eventName: 'X', podium: [] }, words)).toBeNull();
  });
  it('draws on opening and shares the same picture on the tap, with the results address in the text', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const render = vi.fn().mockResolvedValue(blob);
    const share = vi.fn().mockResolvedValue('shared');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const control = buildResultsShareControl(event, { ...words, render, share });
    document.body.append(control);
    control.querySelector('button').click();
    await tick();
    expect(render).toHaveBeenCalledTimes(1);
    const shareButton = [...control.querySelectorAll('button')].find(
      (b) => b.textContent === 'Share picture',
    );
    expect(shareButton.disabled).toBe(false);
    shareButton.click();
    await tick();
    expect(render).toHaveBeenCalledTimes(1); // the tap never draws
    expect(share.mock.calls[0][0]).toBe(blob);
    expect(share.mock.calls[0][1].filename).toBe('seduh-score-fictional-throwdown-vol-9-story.png');
    expect(share.mock.calls[0][1].text).toContain('seduhscore.com/results');
    control.remove();
  });
  it('says so and offers Try again when the picture cannot be made', async () => {
    const render = vi.fn().mockRejectedValue(new Error('no canvas'));
    const control = buildResultsShareControl(event, { ...words, render, share: vi.fn() });
    document.body.append(control);
    control.querySelector('button').click();
    await tick();
    expect(control.querySelector('[role=status]').textContent).toContain(
      'Could not make the picture',
    );
    expect([...control.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(
      true,
    );
    control.remove();
  });
});
