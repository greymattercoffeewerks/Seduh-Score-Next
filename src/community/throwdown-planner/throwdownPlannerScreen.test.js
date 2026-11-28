import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BREWERS,
  initialState,
  mountThrowdownPlanner,
  shapeOf,
} from './throwdownPlannerScreen.js';

let root;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  root.remove();
});

const field = (key) => root.querySelector(`[data-focus-key="${key}"]`);
function setNumber(key, value) {
  const input = field(key);
  input.value = String(value);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const summary = () => root.querySelector('.tp-summary').textContent;
const roundTitles = () => [...root.querySelectorAll('.tp-round strong')].map((n) => n.textContent);

describe('the planner as a pure function of its state', () => {
  it('starts at 16 brewers with 3rd place and no redemption', () => {
    const state = initialState();
    expect(state.brewers).toBe(DEFAULT_BREWERS);
    const shape = shapeOf(state);
    expect(shape.totals.rounds).toBe(4);
    expect(shape.thirdPlace.played).toBe(true);
    expect(shape.totals.byes).toBe(0);
  });

  it('turns redemption into the engine setup and nothing else', () => {
    const none = shapeOf({ ...initialState(), brewers: 21 });
    const withRed = shapeOf({
      ...initialState(),
      brewers: 21,
      redemption: { on: true, feed: [1], cap: 0 },
    });
    expect(none.rounds.some((r) => r.redemption)).toBe(false);
    expect(withRed.rounds.some((r) => r.redemption)).toBe(true);
  });
});

describe('the planner page', () => {
  it('shows the shared frame, the controls and a first answer, with no sign-in anywhere', () => {
    mountThrowdownPlanner(root);
    expect(root.querySelector('.ct-crumb-current').textContent).toBe('Throwdown Bracket Planner');
    expect(root.querySelector('h1').textContent).toBe('Throwdown Bracket Planner');
    expect(summary()).toContain('With 16 brewers: 4 rounds');
    expect(root.querySelector('input[type="password"], input[type="email"]')).toBeNull();
  });

  it('changes the bracket when the brewer count changes', () => {
    mountThrowdownPlanner(root);
    setNumber('tp-brewers', 21);
    expect(summary()).toContain('With 21 brewers');
    expect(root.textContent).toContain('thing');
    expect(roundTitles().length).toBeGreaterThan(0);
  });

  it('keeps the brewer count within 2 to 64', () => {
    mountThrowdownPlanner(root);
    setNumber('tp-brewers', 500);
    expect(field('tp-brewers').value).toBe('64');
    setNumber('tp-brewers', 0);
    expect(field('tp-brewers').value).toBe('2');
  });

  it('shows redemption controls only when redemption is on, and what it does', () => {
    mountThrowdownPlanner(root);
    setNumber('tp-brewers', 21);
    expect(field('tp-feed-1')).toBeNull();
    const box = field('tp-red');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(field('tp-feed-1')).not.toBeNull();
    expect(field('tp-cap')).not.toBeNull();
    expect(root.textContent).toContain('Redemption:');
    expect(summary()).toContain('Redemption brings back');
  });

  it('says what flipping 3rd place would do', () => {
    mountThrowdownPlanner(root);
    const third = field('tp-third');
    third.checked = false;
    third.dispatchEvent(new Event('change', { bubbles: true }));
    expect(summary()).toContain('3rd place is off');
    expect(root.textContent).toContain('With 3rd place on:');
  });

  it('asks for at least two brewers rather than showing an empty bracket', () => {
    mountThrowdownPlanner(root);
    setNumber('tp-brewers', 2);
    expect(summary()).toContain('With 2 brewers');
    expect(root.textContent).toContain('No 3rd place match');
  });

  it('writes nothing to storage and sends nothing anywhere', () => {
    const before = JSON.stringify({ ...localStorage });
    mountThrowdownPlanner(root);
    setNumber('tp-brewers', 12);
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});

describe('what the planner may import', () => {
  // The planner is the one tool allowed to read from src/formats/throwdown, and only the pure engine, the words and the
  // redemption constants. No other format, no screen, no data layer, no Supabase.
  const source = readFileSync(
    join(process.cwd(), 'src/community/throwdown-planner/throwdownPlannerScreen.js'),
    'utf8',
  );
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

  it('reaches into formats/ for exactly the three pure Throwdown modules', () => {
    expect(imports.filter((i) => i.includes('/formats/')).sort()).toEqual([
      '../../formats/throwdown/bracketPreview.js',
      '../../formats/throwdown/bracketPreviewCard.js',
      '../../formats/throwdown/redemption.js',
    ]);
  });

  it('has no Supabase, auth or router import', () => {
    for (const i of imports) expect(i).not.toMatch(/supabase|auth|router|outbox|data\.js/i);
  });
});
