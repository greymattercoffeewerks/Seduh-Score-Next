import { describe, it, expect } from 'vitest';
import { normaliseWarnings, countBySeverity, buildEventWarnings } from './eventWarnings.js';

// Warnings as two different formats would derive them.
const btcWarnings = [
  {
    id: 'no-times',
    severity: 'warning',
    text: '3 matches have no finish times.',
    href: '#/events/e1/btc/matches',
    actionLabel: 'Add times',
  },
  {
    id: 'unsent',
    severity: 'error',
    text: '2 writes are queued and not yet sent.',
    href: '#/events/e1/btc/matches',
  },
  { id: 'judge-country', severity: 'info', text: 'A judge-country conflict was ticked through.' },
];

const cupTasterWarnings = [
  { id: 'heat-unscored', severity: 'warning', text: 'Heat 2 has no scores.', href: '#/h/2' },
];

describe('normaliseWarnings', () => {
  it('orders by severity (error, warning, info) and keeps the format order inside one', () => {
    const out = normaliseWarnings([
      { id: 'i1', severity: 'info', text: 'i1' },
      { id: 'w1', severity: 'warning', text: 'w1' },
      { id: 'e1', severity: 'error', text: 'e1' },
      { id: 'w2', severity: 'warning', text: 'w2' },
      { id: 'e2', severity: 'error', text: 'e2' },
    ]);
    expect(out.map((w) => w.id)).toEqual(['e1', 'e2', 'w1', 'w2', 'i1']);
  });

  it('reads an unknown or missing severity as a note, and gives a default action label', () => {
    const [w] = normaliseWarnings([
      { id: 'a', text: 'Hello', severity: 'catastrophe', href: '#/a' },
    ]);
    expect(w.severity).toBe('info');
    expect(w.actionLabel).toBe('Fix this');
  });

  it('drops entries with no id or text and repeated ids, and unsafe links (the text stays)', () => {
    const out = normaliseWarnings([
      null,
      { id: 'a' },
      { text: 'no id' },
      { id: 'b', text: 'First' },
      { id: 'b', text: 'Again' },
      { id: 'c', text: 'Bad link', href: 'javascript:alert(1)' },
    ]);
    expect(out.map((w) => w.id)).toEqual(['b', 'c']);
    expect(out[1].href).toBeNull();
    expect(normaliseWarnings('nope')).toEqual([]);
  });
});

describe('countBySeverity', () => {
  it('counts each severity and the total', () => {
    expect(countBySeverity(btcWarnings)).toEqual({ error: 1, warning: 1, info: 1, total: 3 });
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0, total: 0 });
  });
});

describe('buildEventWarnings', () => {
  const textOf = (node) => [...node.querySelectorAll('.ok-warn-item')].map((li) => li.textContent);

  it('lists a BTC-shaped event warnings worst first, each severity in a word, each with its fix link', () => {
    const card = buildEventWarnings(btcWarnings);
    const items = [...card.querySelectorAll('.ok-warn-item')];
    expect(items.map((li) => li.querySelector('.status').textContent)).toEqual([
      'Problem',
      'Check',
      'Note',
    ]);
    expect(card.querySelector('h2').textContent).toContain('Needs attention');
    expect(card.querySelector('.ok-warn-count').textContent).toBe('3');
    const links = [...card.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Fix this', 'Add times']);
    expect(links[1].getAttribute('href')).toBe('#/events/e1/btc/matches');
    // The note has no link, and still shows as text.
    expect(items[2].querySelector('a')).toBeNull();
    expect(textOf(card)[2]).toContain('judge-country conflict');
  });

  it('draws a Cup Taster-shaped event the same way, with its own words', () => {
    const card = buildEventWarnings(cupTasterWarnings, { heading: 'Check before the heat' });
    expect(card.querySelector('h2').textContent).toContain('Check before the heat');
    expect(card.querySelectorAll('.ok-warn-item')).toHaveLength(1);
  });

  it('says so when there is nothing, instead of drawing nothing', () => {
    const card = buildEventWarnings([]);
    expect(card.querySelector('.empty[data-kind="done"]').textContent).toBe(
      'Nothing needs attention.',
    );
    expect(card.querySelector('.ok-warn-list')).toBeNull();
    expect(card.querySelector('.ok-warn-count')).toBeNull();
    expect(buildEventWarnings(undefined, { emptyText: 'All clear.' }).textContent).toContain(
      'All clear.',
    );
  });

  it('sets every string as text, never markup', () => {
    const card = buildEventWarnings([
      {
        id: 'x',
        severity: 'error',
        text: '<img src=x onerror=alert(1)>',
        actionLabel: '<b>go</b>',
        href: '#/x',
      },
    ]);
    expect(card.querySelector('img, b')).toBeNull();
    expect(card.querySelector('.ok-warn-text').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
