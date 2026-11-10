// The run sheet: one card per phase of an event, in order, each with a status, a count and (when it has one) an
// action, plus ONE primary "next step" card on top. `core/` renders, orders and announces; the format decides what
// a phase is, when it is done and what the next action means: it hands over
//
//   [{ id, label, status, count, progress, nextAction: { label, href }, blockedReason }]
//
// (BTC: setup, round 1, round 2, the cut, knockout, podium; Cup Taster: its stages; Throwdown: its rounds). This
// module names none of them and never branches on a format.
//
//  - `status`: not_started | in_progress | done | blocked | waiting. Anything else is read as not_started.
//  - `count`: the phase's own words for where it stands ("7 of 10 confirmed"), drawn in the mono face.
//  - `progress`: optional `{ done, active, total }` for the bar: `done` confirmed units, `active` units under way
//    (drawn hatched after the confirmed part), `total` all units. Numbers are clamped; no total, no bar.
//  - `nextAction`: where to go to move the phase on. `href` must pass core/kitLink.js's `safeHref`.
//  - `blockedReason`: one sentence naming the fix, shown on a blocked (and a waiting) phase.
//
// The next-step card is chosen by `deriveNextStep` (below). Every state is said in words as well as colour.
// Styled in components.css (`.ok-run*`, `.ok-next*`, `.ok-phase*`).
import { el } from './dom.js';
import { safeHref } from './kitLink.js';

export const PHASE_STATUSES = ['not_started', 'in_progress', 'done', 'blocked', 'waiting'];

export const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  blocked: 'Blocked',
  waiting: 'Waiting',
};

function cleanText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function cleanAction(action) {
  const label = cleanText(action?.label);
  const href = safeHref(action?.href);
  return label && href ? { label, href } : null;
}

// Pure. A phase's progress as bar widths: { done, active, total, donePct, activePct } with the numbers made whole
// and clamped (done <= total, done + active <= total), or null when there is no usable total. Percentages are
// of the whole bar.
export function progressSegments(progress) {
  const total = Math.floor(Number(progress?.total));
  if (!Number.isFinite(total) || total <= 0) return null;
  const done = Math.min(total, Math.max(0, Math.floor(Number(progress?.done)) || 0));
  const active = Math.min(total - done, Math.max(0, Math.floor(Number(progress?.active)) || 0));
  return {
    done,
    active,
    total,
    donePct: (done / total) * 100,
    activePct: (active / total) * 100,
  };
}

// Pure. The phases a sheet can draw, in the order given: each with a non-empty id and label (a repeated id keeps
// the first), a known status (else not_started), clean text, a usable action (or null) and its progress
// segments (or null). Anything that is not a phase is dropped.
export function normalisePhases(phases) {
  if (!Array.isArray(phases)) return [];
  const seen = new Set();
  const out = [];
  for (const phase of phases) {
    const id = cleanText(phase?.id);
    const label = cleanText(phase?.label);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      status: PHASE_STATUSES.includes(phase.status) ? phase.status : 'not_started',
      count: cleanText(phase.count),
      progress: progressSegments(phase.progress),
      nextAction: cleanAction(phase.nextAction),
      blockedReason: cleanText(phase.blockedReason),
    });
  }
  return out;
}

// Pure. What the primary card shows. The first phase, in order, that is not done and that has an action to take
// (status in_progress, not_started or blocked: a blocked phase's action is the fix) is the next step:
// `{ kind: 'action', phase, action }`. A phase that is `waiting` has nothing for the organiser to press, so it
// is skipped for an action; if nothing else is left but waiting phases the answer is
// `{ kind: 'waiting', phase }` (the first one), if every phase is done it is `{ kind: 'complete' }`, and with no
// phases or nothing actionable `{ kind: 'none' }`.
export function deriveNextStep(phases) {
  const list = normalisePhases(phases);
  if (list.length === 0) return { kind: 'none' };
  if (list.every((phase) => phase.status === 'done')) return { kind: 'complete' };
  const actionable = list.find(
    (phase) => phase.status !== 'done' && phase.status !== 'waiting' && phase.nextAction,
  );
  if (actionable) return { kind: 'action', phase: actionable, action: actionable.nextAction };
  const waiting = list.find((phase) => phase.status === 'waiting');
  if (waiting) return { kind: 'waiting', phase: waiting };
  return { kind: 'none' };
}

function statusTag(status) {
  return el('span', {
    className: 'ok-tag',
    text: STATUS_LABELS[status],
    attrs: { 'data-status': status },
  });
}

function progressBar(progress) {
  const bar = el('div', { className: 'ok-bar', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'ok-bar-done' }),
    el('span', { className: 'ok-bar-active' }),
  ]);
  bar.children[0].style.width = `${progress.donePct}%`;
  bar.children[1].style.width = `${progress.activePct}%`;
  const words = [`${progress.done} of ${progress.total} done`];
  if (progress.active > 0) words.push(`${progress.active} in progress`);
  return [bar, el('span', { className: 'sr-only', text: `${words.join(', ')}.` })];
}

function nextStepCard(next) {
  const heading = el('h2', {
    className: 'ok-next-kicker',
    id: 'ok-next-heading',
    text: 'Next step',
  });
  const body = [];
  let tone = next.kind;
  if (next.kind === 'action') {
    body.push(el('p', { className: 'ok-next-title', text: next.phase.label }));
    const detail = next.phase.blockedReason ?? next.phase.count;
    if (detail) body.push(el('p', { className: 'ok-next-detail', text: detail }));
    body.push(
      el('a', {
        className: 'btn btn-primary btn-lg ok-next-action',
        text: next.action.label,
        attrs: { href: next.action.href },
      }),
    );
  } else if (next.kind === 'waiting') {
    body.push(el('p', { className: 'ok-next-title', text: next.phase.label }));
    body.push(
      el('p', {
        className: 'ok-next-detail',
        text: next.phase.blockedReason ?? 'Waiting. Nothing to do right now.',
      }),
    );
  } else if (next.kind === 'complete') {
    body.push(el('p', { className: 'ok-next-title', text: 'Every phase is done' }));
  } else {
    tone = 'none';
    body.push(el('p', { className: 'ok-next-title', text: 'Nothing to do right now' }));
  }
  return el(
    'section',
    { className: 'ok-next', attrs: { 'aria-labelledby': 'ok-next-heading', 'data-kind': tone } },
    [heading, ...body],
  );
}

function phaseCard(phase, isNext) {
  const reason = phase.blockedReason && (phase.status === 'blocked' || phase.status === 'waiting');
  const parts = [
    el('div', { className: 'ok-phase-head' }, [
      el('h3', { className: 'ok-phase-title', text: phase.label }),
      statusTag(phase.status),
    ]),
  ];
  if (phase.count) parts.push(el('p', { className: 'ok-phase-count', text: phase.count }));
  if (phase.progress) parts.push(...progressBar(phase.progress));
  if (reason) parts.push(el('p', { className: 'ok-phase-reason', text: phase.blockedReason }));
  // The featured phase's action is the big button above; the other cards keep their own, as a plain link-button.
  if (phase.nextAction && !isNext && phase.status !== 'done') {
    parts.push(
      el('a', {
        className: 'btn btn-outline tap-target ok-phase-action',
        text: phase.nextAction.label,
        attrs: { href: phase.nextAction.href },
      }),
    );
  }
  const attrs = { 'data-status': phase.status, 'data-phase': phase.id };
  if (isNext) attrs['aria-current'] = 'step';
  return el('li', { className: 'ok-phase', attrs }, parts);
}

/**
 * DOM. The next-step card and the phase cards, as one fragment-like wrapper.
 * @param {object[]} phases the format's phases (see the file comment)
 * @param {{ heading?: string }} [options]
 * @returns {HTMLElement}
 */
export function buildRunSheet(phases, { heading = 'Run sheet' } = {}) {
  const list = normalisePhases(phases);
  const next = deriveNextStep(list);
  const nextId = next.kind === 'action' ? next.phase.id : null;
  const cards = list.map((phase) => phaseCard(phase, phase.id === nextId));
  const section = el(
    'section',
    { className: 'ok-run', attrs: { 'aria-labelledby': 'ok-run-heading' } },
    [
      el('h2', { className: 'ok-run-heading', id: 'ok-run-heading', text: heading }),
      el('ol', { className: 'ok-phases', attrs: { role: 'list' } }, cards),
    ],
  );
  return el('div', { className: 'ok-run-sheet' }, [nextStepCard(next), section]);
}
