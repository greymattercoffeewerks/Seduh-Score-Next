import { describe, it, expect } from 'vitest';
import { highlightFactFor, organiserNoteFor } from './resultsFacts.js';

describe('highlightFactFor', () => {
  it('Cup Taster shows the winning time', () => {
    expect(highlightFactFor({ format: 'cup_taster', winningTimeSecs: 102 })).toMatchObject({
      value: '1:42',
      label: 'winning time',
    });
  });

  it('Throwdown shows nothing, even if a time is present', () => {
    expect(highlightFactFor({ format: 'throwdown', winningTimeSecs: 102 })).toBeNull();
    expect(highlightFactFor({ format: 'throwdown' })).toBeNull();
  });

  it('BTC shows the score between the two final teams', () => {
    const fact = highlightFactFor({
      format: 'btc',
      finalScore: [{ score: 142.5 }, { score: 139 }],
    });
    expect(fact).toMatchObject({ value: '142.5 – 139', label: 'final score' });
  });

  it('BTC shows nothing unless there are exactly two real scores', () => {
    expect(highlightFactFor({ format: 'btc' })).toBeNull();
    expect(highlightFactFor({ format: 'btc', finalScore: [{ score: 1 }] })).toBeNull();
    expect(
      highlightFactFor({ format: 'btc', finalScore: [{ score: 1 }, { score: 'x' }] }),
    ).toBeNull();
  });

  it.each([undefined, null, NaN, 'fast', Infinity])(
    'never draws a winning time for %s (the "NaN:NaN" bug)',
    (bad) => {
      expect(highlightFactFor({ format: 'cup_taster', winningTimeSecs: bad })).toBeNull();
      expect(highlightFactFor({ winningTimeSecs: bad })).toBeNull();
    },
  );

  it('a row with no format keeps the old winning-time behaviour', () => {
    expect(highlightFactFor({ winningTimeSecs: 60 })?.value).toBe('1:00');
  });
});

describe('organiserNoteFor', () => {
  it('returns trimmed text, and nothing for anything that is not text', () => {
    expect(organiserNoteFor({ organiserNote: '  Final played as a 3-way.  ' })).toBe(
      'Final played as a 3-way.',
    );
    for (const bad of [undefined, null, '', '   ', 5, {}, ['x']]) {
      expect(organiserNoteFor({ organiserNote: bad })).toBeNull();
    }
  });

  it('cuts a very long note', () => {
    expect(organiserNoteFor({ organiserNote: 'a'.repeat(1000) })).toHaveLength(300);
  });
});
