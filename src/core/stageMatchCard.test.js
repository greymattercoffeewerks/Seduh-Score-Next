import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderSide, renderVs } from './stageMatchCard.js';

const all = (node, selector) => [...node.querySelectorAll(selector)].map((n) => n.textContent);

describe('stageMatchCard', () => {
  it('a side: label, name, optional points and chips; a winner flag only when there is one', () => {
    const side = renderSide({
      label: 'Goes through',
      name: 'Ana',
      winner: true,
      points: 2,
      chips: [{ text: 'Walkover' }, { text: 'Tie-break', kind: 'tiebreak' }],
    });
    expect(side.getAttribute('data-winner')).toBe('true');
    expect(all(side, '.stage-side-label')).toEqual(['Goes through']);
    expect(all(side, '.stage-side-name')).toEqual(['Ana']);
    expect(all(side, '.stage-points')).toEqual(['2']);
    expect(all(side, '.stage-chip')).toEqual(['Walkover', 'Tie-break']);
    expect(side.querySelectorAll('.stage-chip')[1].getAttribute('data-kind')).toBe('tiebreak');
    expect(renderSide({ name: 'X', winner: false }).getAttribute('data-winner')).toBe('false');
    const plain = renderSide({ name: 'X' });
    expect(plain.hasAttribute('data-winner')).toBe(false);
    expect(plain.querySelector('.stage-side-label, .stage-points, .stage-chips')).toBeNull();
  });

  it('puts a country on its own line above the name, and sets everything as text, never markup', () => {
    const side = renderSide({ name: '<i>n</i>', country: { code: 'BN', name: '<b>Brunei</b>' } });
    expect(side.querySelector('i, b')).toBeNull();
    const kids = [...side.children].map((n) => n.className);
    expect(kids.indexOf('stage-side-country')).toBeLessThan(kids.indexOf('stage-side-name'));
  });

  it('a VS row: two sides with a decorative VS mark between them', () => {
    const vs = renderVs(renderSide({ name: 'A' }), renderSide({ name: 'B' }));
    expect([...vs.children].map((n) => n.className)).toEqual([
      'stage-side',
      'stage-vs-mark',
      'stage-side',
    ]);
    expect(vs.querySelector('.stage-vs-mark').getAttribute('aria-hidden')).toBe('true');
  });

  it('its stylesheet is format-neutral and token-only, sized from --stage-fit, and linked by the app', () => {
    const css = readFileSync('src/core/stageMatchCard.css', 'utf8');
    expect(css).not.toMatch(/\b(btc|td|ct)-/);
    expect(css).toMatch(/--stage-fit/);
    expect(css).not.toMatch(/\d(dvh|vh|cqh)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const html = readFileSync('app/index.html', 'utf8');
    expect(html).toContain('/src/core/stageMatchCard.css');
    expect(html.indexOf('stageMatchCard.css')).toBeGreaterThan(html.indexOf('stageVocabulary.css'));
  });
});
