// The results story card's content: only what the published payload says, and no card without a named winner.
// Fictional data.
import { describe, expect, it } from 'vitest';
import {
  canMakeResultsCard,
  resultsStoryFilename,
  resultsStorySpec,
  venueLine,
} from './resultsStory.js';

const words = {
  formatLabel: (f) => (f === 'throwdown' ? 'Throwdown' : 'Cup Taster'),
  formatDate: () => '27 Nov 2026',
};
const event = (over = {}) => ({
  format: 'throwdown',
  eventName: 'Fictional Throwdown Vol. 9',
  venue: 'Test Café',
  city: 'Testville',
  eventDate: '2026-11-27',
  podium: [
    { rank: 1, name: 'Ada Winner', cafe: 'Alpha Roasters' },
    { rank: 2, name: 'Bo Second', cafe: null },
    { rank: 3, name: 'Cy Third', cafe: 'Gamma Beans' },
  ],
  ...over,
});

describe('resultsStorySpec', () => {
  it('puts the winner first and the next places as rows, with venue and date on their own fields', () => {
    const spec = resultsStorySpec(event(), words);
    expect(spec.winner).toEqual({ name: 'Ada Winner', detail: 'Alpha Roasters' });
    expect(spec.places).toEqual([
      { place: 2, name: 'Bo Second', detail: undefined },
      { place: 3, name: 'Cy Third', detail: 'Gamma Beans' },
    ]);
    expect(spec.venue).toBe('Test Café, Testville');
    expect(spec.date).toBe('27 Nov 2026');
    expect(spec.eyebrow).toBe('Throwdown · Final result');
  });
  it('keeps a tie for third as two rows with the same rank', () => {
    const spec = resultsStorySpec(
      event({ podium: [...event().podium, { rank: 3, name: 'Di Third', cafe: null }] }),
      words,
    );
    expect(spec.places.map((p) => p.place)).toEqual([2, 3, 3]);
  });
  it('makes no card without an event name or a named winner', () => {
    expect(resultsStorySpec(event({ podium: [] }), words)).toBeNull();
    expect(resultsStorySpec(event({ podium: [{ rank: 1, name: '  ' }] }), words)).toBeNull();
    expect(resultsStorySpec(event({ eventName: '' }), words)).toBeNull();
    expect(canMakeResultsCard(null)).toBe(false);
  });
  it('leaves out a missing date and venue instead of drawing a blank line', () => {
    const spec = resultsStorySpec(event({ eventDate: null, venue: null, city: null }), words);
    expect(spec.date).toBeUndefined();
    expect(spec.venue).toBeUndefined();
  });
  it('calls a city with no venue a location', () => {
    expect(resultsStorySpec(event({ venue: null }), words).venueLabel).toBe('Location');
  });
});

describe('venueLine', () => {
  it('does not repeat a city the venue already names', () => {
    expect(venueLine({ venue: 'Testville Hall', city: 'Testville' })).toBe('Testville Hall');
  });
});

describe('resultsStoryFilename', () => {
  it('is a plain lower-case file name', () => {
    expect(resultsStoryFilename({ eventName: 'Fictional Throwdown Vol. 9!' })).toBe(
      'seduh-score-fictional-throwdown-vol-9-story.png',
    );
    expect(resultsStoryFilename({ eventName: '###' })).toBe('seduh-score-results-story.png');
  });
});
