// Builders for the Petrol Kaizen P5 vocabulary parts that carry meaning a screen could get wrong by hand
// (`src/ui/tokens/vocabulary.css`, DESIGN.md "Vocabulary"). Format-agnostic: a format passes a state and words.
import { el } from './dom.js';

export const STATUS_STATES = ['live', 'queued', 'done', 'attention', 'failed', 'offline', 'test'];

// How the organiser kit's own words map onto a mark. A phase or row that is not started is hollow, one in progress is
// the live blip, done is a check, blocked is a cross; "waiting" (nothing for the organiser to press) is dashed.
// A warning's severity: a problem is a cross, a check is a bang, a note is hollow.
const KIT_STATES = {
  not_started: 'queued',
  in_progress: 'live',
  done: 'done',
  blocked: 'failed',
  waiting: 'offline',
  error: 'failed',
  warning: 'attention',
  info: 'queued',
};
export function kitState(word) {
  return KIT_STATES[word] ?? 'queued';
}

/**
 * One status mark with its label. The state decides the shape (filled, hollow, check, bang, cross, dashed, stripes),
 * the label is the accessible name, so colour and shape are cues and never the only ones.
 * @param {string} state one of STATUS_STATES
 * @param {string} label
 * @param {{ light?: boolean, tag?: string, className?: string }} [options] `light` is the quiet tinted variant
 */
export function statusMark(state, label, { light = false, tag = 'span', className = '' } = {}) {
  if (!STATUS_STATES.includes(state)) throw new Error(`unknown status state: ${state}`);
  const classes = ['status', light ? 'status--light' : '', className].filter(Boolean).join(' ');
  return el(tag, { className: classes, text: label, attrs: { 'data-state': state } });
}

// Pure. The meter's bar: `done` (solid) then `active` (hatched) out of `total`, in whole percent, never past 100 and
// never negative. A zero or missing total is an empty bar.
export function meterSegments(done, total, active = 0) {
  if (!Number.isFinite(total) || total <= 0) return { donePct: 0, activePct: 0 };
  const pct = (n) => {
    const value = Number.isFinite(n) ? n : 0;
    return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
  };
  const donePct = pct(done);
  return { donePct, activePct: Math.min(pct(active), 100 - donePct) };
}

/**
 * A `.meter` (role="meter"): aria-valuenow is the done count of `total`, and `valueText` is the sentence a screen
 * reader says ("7 of 10 done, 1 in progress"), so the numbers are in words as well as in the bar.
 * @param {{ label: string, done: number, total: number, active?: number, valueText?: string }} options
 */
export function buildMeter({ label, done, total, active = 0, valueText }) {
  const { donePct, activePct } = meterSegments(done, total, active);
  const fill = el('span', { className: 'meter-fill' });
  const hatched = el('span', { className: 'meter-active' });
  fill.style.width = `${donePct}%`;
  hatched.style.width = `${activePct}%`;
  return el(
    'div',
    {
      className: 'meter',
      attrs: {
        role: 'meter',
        'aria-label': label,
        'aria-valuemin': '0',
        'aria-valuemax': String(total),
        'aria-valuenow': String(done),
        'aria-valuetext': valueText ?? `${done} of ${total}`,
      },
    },
    [fill, hatched],
  );
}

/**
 * A `.stat` tile: a label, a figure in mono with tabular digits, an optional unit and sub-line.
 * @param {{ label: string, value: string, unit?: string, sub?: string, tone?: 'ok'|'warn'|null, className?: string }} o
 */
export function buildStat({ label, value, unit, sub, tone = null, className = '' }) {
  const figure = el('div', { className: 'stat-value tabular-nums', text: value });
  if (unit) figure.append(el('span', { className: 'stat-unit', text: ` ${unit}` }));
  const tile = el(
    'div',
    {
      className: ['stat', className].filter(Boolean).join(' '),
      attrs: tone ? { 'data-tone': tone } : {},
    },
    [el('div', { className: 'stat-label', text: label }), figure],
  );
  if (sub) tile.append(el('div', { className: 'stat-sub', text: sub }));
  return tile;
}
