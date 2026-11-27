// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createBracketPreviewCard,
  flagWords,
  summaryWords,
  diffWords,
} from './bracketPreviewCard.js';
import { previewShape } from './bracketPreview.js';

const closed = { open: false, entrants: null, thirdPlace: null };
const card = (over = {}) => {
  const calls = [];
  const node = createBracketPreviewCard({
    rosterCount: 21,
    thirdPlace: true,
    plan: closed,
    onChange: (p) => calls.push(p),
    ...over,
  });
  return { node, calls };
};

describe('the words', () => {
  it('summarises the Vol 3 field in one line', () => {
    expect(summaryWords(previewShape({ entrants: 21 }))).toBe(
      'With 21 brewers: 5 rounds, 20 matches, 3 byes. No 3rd place match.',
    );
    expect(summaryWords(previewShape({ entrants: 16 }))).toBe(
      'With 16 brewers: 4 rounds, 16 matches, no byes. A 3rd place match is played.',
    );
    expect(summaryWords(previewShape({ entrants: 8, thirdPlace: false }))).toContain(
      '3rd place is off.',
    );
    expect(summaryWords(previewShape({ entrants: 1 }))).toContain('at least two competitors');
  });
  it('says a repeat bye plainly, certain or not', () => {
    const flags = previewShape({ entrants: 21 }).flags.filter((f) => f.code === 'repeat_bye');
    expect(flagWords(flags[0]).title).toBe('Round 2: the brewer who rested in Round 1 rests again');
    expect(flagWords(flags[1]).text).toContain('About 1 in 2');
  });
  it('names a 3rd place that cannot happen, with the reason', () => {
    const f = previewShape({ entrants: 12 }).flags.find((x) => x.code === 'third_place_skipped');
    expect(flagWords(f).text).toContain('has a bye');
  });
  it('words a comparison from only what changed', () => {
    expect(
      diffWords([
        { key: 'matches', from: 20, to: 21 },
        { key: 'thirdPlace', from: false, to: true },
      ]),
    ).toEqual(['matches 20 to 21', '3rd place match played']);
  });
});

describe('the card', () => {
  it('closed: a summary and a Plan the event button, and no plan panel', () => {
    const { node } = card();
    expect(node.textContent).toContain('With 21 brewers');
    expect(node.textContent).toContain('3 things to check.');
    expect(node.querySelector('#td-plan')).toBeNull();
    expect(node.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('false');
  });
  it('open: every round, the flags, and the other choice for 3rd place', () => {
    const { node } = card({ rosterCount: 16, plan: { ...closed, open: true } });
    expect(node.querySelectorAll('.td-plan-round')).toHaveLength(4);
    expect(node.textContent).toContain(
      'If 3rd place were off: matches 16 to 15, no 3rd place match.',
    );
    expect(node.querySelector('[aria-expanded]').getAttribute('aria-expanded')).toBe('true');
  });
  it('names the rounds as the console does, a match plus a bye being a semi-final round', () => {
    const { node } = card({ plan: { ...closed, open: true } });
    expect([...node.querySelectorAll('.td-plan-round strong')].map((n) => n.textContent)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Semi-finals',
      'Final',
    ]);
    expect(node.querySelectorAll('.td-plan-flag')).toHaveLength(3);
  });
  it('a clean field has no flags and no repeat-bye wording', () => {
    const { node } = card({ rosterCount: 16, plan: { ...closed, open: true } });
    expect(node.querySelectorAll('.td-plan-flag')).toHaveLength(0);
    expect(node.textContent).not.toContain('things to check');
  });
  it('the what-if brewer count and 3rd place choice drive the plan, not the setup', () => {
    const { node } = card({ plan: { open: true, entrants: 12, thirdPlace: false } });
    expect(node.textContent).toContain('With 12 brewers');
    expect(node.textContent).toContain('3rd place is off.'.replace('is off.', 'is off.'));
  });
  it('asks the screen to change the plan, and forgets the what-if on close', () => {
    const open = card();
    open.node.querySelector('[aria-expanded]').click();
    expect(open.calls).toEqual([{ open: true }]);
    const shown = card({ plan: { open: true, entrants: 12, thirdPlace: null } });
    shown.node.querySelector('[aria-expanded]').click();
    expect(shown.calls).toEqual([{ open: false, entrants: null, thirdPlace: null }]);
    const count = shown.node.querySelector('[data-focus-key="td-plan-count"]');
    count.value = '99';
    count.dispatchEvent(new Event('change'));
    expect(shown.calls[1]).toEqual({ entrants: 64 });
    count.value = '';
    count.dispatchEvent(new Event('change'));
    expect(shown.calls[2]).toEqual({ entrants: null });
  });
  it('under two brewers it says so instead of a plan', () => {
    const { node } = card({ rosterCount: 1, plan: { ...closed, open: true } });
    expect(node.querySelectorAll('.td-plan-round')).toHaveLength(0);
    expect(node.textContent).toContain('at least two competitors');
  });
});
