import { describe, it, expect } from 'vitest';
import {
  normalisePhases,
  progressSegments,
  deriveNextStep,
  buildRunSheet,
  STATUS_LABELS,
} from './runSheet.js';

// Phases as two different formats would derive them (the kit never sees an event, only these).
const btcMidRoundOne = [
  {
    id: 'setup',
    label: 'Setup',
    status: 'done',
    count: '20 teams · 9 judges',
    nextAction: { label: 'Edit setup', href: '#/events/e1/btc/setup' },
  },
  {
    id: 'round_1',
    label: 'Round 1',
    status: 'in_progress',
    count: '7 of 10 confirmed',
    progress: { done: 7, active: 1, total: 10 },
    nextAction: { label: 'Score next', href: '#/events/e1/btc/matches' },
  },
  {
    id: 'round_2',
    label: 'Round 2',
    status: 'blocked',
    count: '0 of 10 confirmed',
    blockedReason: 'Round 2 waits for round 1: 3 matches not confirmed.',
    nextAction: { label: 'Draw round 2', href: '#/events/e1/btc/matches' },
  },
  { id: 'cut', label: 'The cut', status: 'not_started' },
];

const cupTasterStages = [
  { id: 'qualifier', label: 'Qualifier', status: 'done', count: '3 heats' },
  {
    id: 'semi',
    label: 'Semi-final',
    status: 'waiting',
    count: '0 of 2 heats',
    blockedReason: 'Waiting for the judges to sign the qualifier sheet.',
  },
  { id: 'final', label: 'Final', status: 'not_started' },
];

describe('progressSegments', () => {
  it('gives bar widths as shares of the whole bar', () => {
    expect(progressSegments({ done: 7, active: 1, total: 10 })).toEqual({
      done: 7,
      active: 1,
      total: 10,
      donePct: 70,
      activePct: 10,
    });
  });

  it('clamps so the bar can never overflow or go negative', () => {
    expect(progressSegments({ done: 12, active: 5, total: 10 })).toMatchObject({
      done: 10,
      active: 0,
    });
    expect(progressSegments({ done: 8, active: 5, total: 10 })).toMatchObject({
      done: 8,
      active: 2,
    });
    expect(progressSegments({ done: -3, active: -1, total: 4 })).toMatchObject({
      done: 0,
      active: 0,
    });
    expect(progressSegments({ done: 'x', total: 4 })).toMatchObject({ done: 0, active: 0 });
  });

  it('draws no bar without a usable total', () => {
    for (const bad of [undefined, null, {}, { total: 0 }, { total: -2 }, { total: 'n' }]) {
      expect(progressSegments(bad)).toBeNull();
    }
  });
});

describe('normalisePhases', () => {
  it('keeps order, cleans text and reads an unknown status as not started', () => {
    const [phase] = normalisePhases([{ id: ' a ', label: ' A ', status: 'sideways', count: '  ' }]);
    expect(phase).toMatchObject({ id: 'a', label: 'A', status: 'not_started', count: null });
  });

  it('drops anything that is not a phase and a repeated id', () => {
    const out = normalisePhases([
      null,
      'x',
      { id: '', label: 'No id' },
      { id: 'a' },
      { id: 'a', label: 'First' },
      { id: 'a', label: 'Again' },
    ]);
    expect(out.map((phase) => phase.label)).toEqual(['First']);
    expect(normalisePhases(undefined)).toEqual([]);
  });

  it('drops an action whose link is not safe, rather than drawing a dead or dangerous link', () => {
    const [phase] = normalisePhases([
      { id: 'a', label: 'A', nextAction: { label: 'Go', href: 'javascript:alert(1)' } },
    ]);
    expect(phase.nextAction).toBeNull();
  });
});

describe('deriveNextStep', () => {
  it('picks the first phase not done that has an action (a blocked phase action is the fix)', () => {
    const next = deriveNextStep(btcMidRoundOne);
    expect(next.kind).toBe('action');
    expect(next.phase.id).toBe('round_1');
    expect(next.action).toEqual({ label: 'Score next', href: '#/events/e1/btc/matches' });
  });

  it('offers a blocked phase action when it is the first thing left', () => {
    const next = deriveNextStep([
      { id: 'a', label: 'A', status: 'done' },
      {
        id: 'b',
        label: 'B',
        status: 'blocked',
        blockedReason: 'Set the countries first.',
        nextAction: { label: 'Set countries', href: '#/setup' },
      },
    ]);
    expect(next).toMatchObject({ kind: 'action', phase: { id: 'b' } });
  });

  it('skips a waiting phase (nothing to press) and reports waiting when only waiting is left', () => {
    expect(deriveNextStep(cupTasterStages)).toMatchObject({
      kind: 'waiting',
      phase: { id: 'semi' },
    });
    const withLater = [
      { id: 'w', label: 'W', status: 'waiting', nextAction: { label: 'Nope', href: '#/x' } },
      { id: 'n', label: 'N', status: 'not_started', nextAction: { label: 'Start', href: '#/n' } },
    ];
    expect(deriveNextStep(withLater)).toMatchObject({ kind: 'action', phase: { id: 'n' } });
  });

  it('is complete when every phase is done, and none with no phases or no action anywhere', () => {
    expect(deriveNextStep([{ id: 'a', label: 'A', status: 'done' }])).toEqual({ kind: 'complete' });
    expect(deriveNextStep([])).toEqual({ kind: 'none' });
    expect(deriveNextStep(undefined)).toEqual({ kind: 'none' });
    expect(deriveNextStep([{ id: 'a', label: 'A', status: 'in_progress' }])).toEqual({
      kind: 'none',
    });
  });
});

describe('buildRunSheet', () => {
  const text = (node, selector) => node.querySelector(selector)?.textContent ?? null;

  it('draws one card per phase in order, each with a status in words, for a BTC-shaped event', () => {
    const sheet = buildRunSheet(btcMidRoundOne);
    const cards = [...sheet.querySelectorAll('.ok-phase')];
    expect(cards.map((card) => card.dataset.phase)).toEqual(['setup', 'round_1', 'round_2', 'cut']);
    expect(cards.map((card) => text(card, '.status'))).toEqual([
      'Done',
      'In progress',
      'Blocked',
      'Not started',
    ]);
    expect(Object.values(STATUS_LABELS)).toHaveLength(5);
    expect(text(cards[1], '.ok-phase-count')).toBe('7 of 10 confirmed');
    expect(text(cards[2], '.ok-phase-reason')).toBe(
      'Round 2 waits for round 1: 3 matches not confirmed.',
    );
  });

  it('draws the same way for a Cup Taster-shaped event (waiting phase, no actions, no progress)', () => {
    const sheet = buildRunSheet(cupTasterStages);
    const cards = [...sheet.querySelectorAll('.ok-phase')];
    expect(cards.map((card) => text(card, '.status'))).toEqual(['Done', 'Waiting', 'Not started']);
    expect(sheet.querySelector('.meter')).toBeNull();
    expect(sheet.querySelector('.ok-next-action')).toBeNull();
    expect(text(sheet, '.ok-next-title')).toBe('Semi-final');
    expect(text(sheet, '.ok-next-detail')).toBe(
      'Waiting for the judges to sign the qualifier sheet.',
    );
  });

  it('has exactly one primary (cut-corner) button: the next action', () => {
    const sheet = buildRunSheet(btcMidRoundOne);
    const primaries = sheet.querySelectorAll('.btn-primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].className).toContain('btn-lg');
    expect(primaries[0].tagName).toBe('A');
    expect(primaries[0].textContent).toBe('Score next');
    expect(primaries[0].getAttribute('href')).toBe('#/events/e1/btc/matches');
  });

  it('marks the featured phase as the current step and does not repeat its action on the card', () => {
    const sheet = buildRunSheet(btcMidRoundOne);
    const featured = sheet.querySelector('[aria-current="step"]');
    expect(featured.dataset.phase).toBe('round_1');
    expect(featured.querySelector('a')).toBeNull();
    // A later phase keeps its own link as a secondary button; a done phase offers none.
    const round2 = sheet.querySelector('[data-phase="round_2"] a');
    expect(round2.className).toContain('btn-outline');
    expect(sheet.querySelector('[data-phase="setup"] a')).toBeNull();
  });

  it('draws progress as a meter whose value text says it in words', () => {
    const sheet = buildRunSheet(btcMidRoundOne);
    const card = sheet.querySelector('[data-phase="round_1"]');
    const bar = card.querySelector('.meter');
    expect(bar.getAttribute('role')).toBe('meter');
    expect(bar.getAttribute('aria-valuenow')).toBe('7');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.getAttribute('aria-valuetext')).toBe('7 of 10 done, 1 in progress');
    expect(bar.querySelector('.meter-fill').style.width).toBe('70%');
    expect(bar.querySelector('.meter-active').style.width).toBe('10%');
  });

  it('says a finished and an empty sheet in words', () => {
    expect(text(buildRunSheet([{ id: 'a', label: 'A', status: 'done' }]), '.ok-next-title')).toBe(
      'Every phase is done',
    );
    const empty = buildRunSheet([]);
    expect(text(empty, '.ok-next-title')).toBe('Nothing to do right now');
    expect(empty.querySelectorAll('.ok-phase')).toHaveLength(0);
  });

  it('sets every string as text, never markup', () => {
    const sheet = buildRunSheet([
      {
        id: 'x',
        label: '<img src=x onerror=alert(1)>',
        status: 'in_progress',
        count: '<b>9</b>',
        nextAction: { label: '<i>Go</i>', href: '#/go' },
      },
    ]);
    expect(sheet.querySelector('img')).toBeNull();
    expect(sheet.querySelector('b, i')).toBeNull();
    expect(text(sheet, '.ok-next-title')).toBe('<img src=x onerror=alert(1)>');
  });

  it('draws no primary button when there is nothing to press (waiting, complete, none)', () => {
    for (const phases of [cupTasterStages, [{ id: 'a', label: 'A', status: 'done' }], []]) {
      expect(buildRunSheet(phases).querySelectorAll('.btn-primary')).toHaveLength(0);
    }
  });
});
