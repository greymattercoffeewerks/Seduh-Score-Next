// The run sheet as one strip (Petrol `.runsheet`): a cell per phase with its state in words, a title, a meter when
// the phase has progress, and its count. The current cell (the first phase not done) is `aria-current="step"`.
// Takes the same phase list as `runSheet.js`; names no format and branches on none.
import { el } from './dom.js';
import { buildMeter } from './vocabulary.js';
import { progressSegments, STATUS_LABELS } from './runSheet.js';

/**
 * @param {object[]} phases `[{ id, label, status, count, progress }]`, as for `buildRunSheet`
 * @param {{ label?: string }} [options]
 * @returns {HTMLElement|null} null when there are no phases
 */
export function buildRunStrip(phases, { label = 'Run sheet' } = {}) {
  const list = (Array.isArray(phases) ? phases : []).filter((p) => p && p.id && p.label);
  if (list.length === 0) return null;
  const current = list.findIndex((phase) => phase.status !== 'done');
  const cells = list.map((phase, index) => {
    const done = phase.status === 'done';
    const status = STATUS_LABELS[phase.status] ?? STATUS_LABELS.not_started;
    const seg = progressSegments(phase.progress);
    const parts = [
      el('span', {
        className: 'eyebrow',
        text: `${String(index + 1).padStart(2, '0')} · ${status}`,
      }),
      el('span', { className: 'runsheet-title', text: phase.label }),
    ];
    if (seg) {
      parts.push(
        buildMeter({
          label: `${phase.label} progress`,
          done: seg.done,
          total: seg.total,
          active: seg.active,
          valueText: `${seg.done} of ${seg.total} done`,
        }),
      );
    }
    if (phase.count) parts.push(el('span', { className: 'runsheet-detail', text: phase.count }));
    const attrs = { 'data-state': done ? 'done' : 'upcoming' };
    if (index === current) attrs['aria-current'] = 'step';
    return el('li', { attrs }, parts);
  });
  return el('ol', { className: 'runsheet', attrs: { 'aria-label': label } }, cells);
}
