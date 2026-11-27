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

/**
 * A decided match as a scoreboard (`.result-row`, 2026-11-27): the winner is a tinted band with the winner's score as
 * a big number, the loser sits below in a plain row with theirs. Full names wrap, never cut. The words "Winner" and the
 * two numbers carry the result as well as the tint. A walkover or a bye has no scores: pass `note` ("Walkover") and
 * it stands where the numbers would.
 * @param {{ winner: { name: string, score?: string|number|null }, loser?: { name: string, score?: string|number|null }|null, note?: string|null, className?: string }} o
 */
export function buildResultRow({ winner, loser, note = null, className = '' }) {
  const score = (value, fallback) => {
    const text = value ?? fallback;
    if (text === null || text === undefined) return null;
    // a word ("Walkover") stands in the number's place, smaller so a long name keeps its room
    return el('span', {
      className: 'result-row-score tabular-nums',
      text: String(text),
      attrs: value === null || value === undefined ? { 'data-word': 'true' } : {},
    });
  };
  const winnerLine = el(
    'div',
    { className: 'result-row-line result-row-win' },
    [
      el('span', { className: 'result-row-name' }, [
        el('span', { className: 'eyebrow', text: 'Winner' }),
        el('span', { className: 'result-row-text', text: winner.name }),
      ]),
      score(winner.score, note),
    ].filter(Boolean),
  );
  // a bye has no opponent: the winner band says so ("Bye" in the score's place) and there is no loser row
  if (!loser) {
    return el('div', { className: ['result-row', className].filter(Boolean).join(' ') }, [
      winnerLine,
    ]);
  }
  const loserLine = el(
    'div',
    { className: 'result-row-line result-row-lose' },
    [
      el('span', { className: 'result-row-name', text: loser.name }),
      note ? null : score(loser.score, null),
    ].filter(Boolean),
  );
  return el('div', { className: ['result-row', className].filter(Boolean).join(' ') }, [
    winnerLine,
    loserLine,
  ]);
}

/**
 * A match that has no result yet (`.match-block`): one competitor per line with "vs" between, then a note in words
 * ("Being decided", "Judges scoring"). Names wrap in full.
 * @param {{ names: string[], note?: string|null, className?: string }} o
 */
export function buildMatchBlock({ names, note = null, className = '' }) {
  const children = [];
  names.forEach((name, i) => {
    if (i > 0) children.push(el('p', { className: 'match-block-vs', text: 'vs' }));
    children.push(el('p', { className: 'match-block-name', text: name }));
  });
  if (note) children.push(el('p', { className: 'match-block-note', text: note }));
  return el('div', { className: ['match-block', className].filter(Boolean).join(' ') }, children);
}

/**
 * A collapsible section with a header that tells one round (or stage, or day) from the next (`.round`). A native
 * <details>, so the keyboard, a screen reader and the browser's own find-in-page all work with no script. The summary
 * is the header: a mono eyebrow ("Round 2 · Done"), the title, and a count on the right.
 * `onToggle(open)` lets a live screen that rebuilds itself on every update remember what the person closed.
 * @param {{ eyebrow: string, title: string, count?: string|null, open?: boolean, onToggle?: (open: boolean) => void, children: (Node|null)[], className?: string }} o
 */
export function buildRound({
  eyebrow,
  title,
  count = null,
  open = true,
  onToggle,
  children,
  className = '',
}) {
  const head = el(
    'summary',
    { className: 'round-head' },
    [
      el('span', { className: 'round-head-text' }, [
        el('span', { className: 'eyebrow', text: eyebrow }),
        el('span', { className: 'round-title', text: title }),
      ]),
      count ? el('span', { className: 'round-count tabular-nums', text: count }) : null,
    ].filter(Boolean),
  );
  const section = el('details', { className: ['round', className].filter(Boolean).join(' ') }, [
    head,
    el('div', { className: 'round-body' }, children.filter(Boolean)),
  ]);
  if (open) section.open = true;
  // Setting `open` here queues a `toggle` event of its own; report only a real change, so a default is never taken for the
  // person's choice.
  let last = section.open;
  if (onToggle)
    section.addEventListener('toggle', () => {
      if (section.open === last) return;
      last = section.open;
      onToggle(section.open);
    });
  return section;
}
