import { describe, expect, it } from 'vitest';
import { drawResultsStoryCard } from './resultsStoryCard.js';
import { STORY_HEIGHT, STORY_WIDTH } from './storyCard.js';

function recordingContext() {
  const texts = [];
  const rects = [];
  const ctx = {
    font: '',
    fillStyle: '',
    globalAlpha: 1,
    measureText: (value) => ({ width: String(value).length * 10 }),
    fillRect: (...args) => rects.push({ fill: ctx.fillStyle, args }),
    strokeRect: () => {},
    fillText: (text, x, y) => texts.push({ text, x, y }),
  };
  return { ctx, texts, rects };
}

const SPEC = {
  eyebrow: 'Fictional · Final result',
  title: 'Fictional Throwdown Vol. 9',
  winner: { name: 'Ada Winner', detail: 'Alpha Roasters' },
  places: [
    { place: 2, name: 'Bo Second', detail: 'Beta' },
    { place: 3, name: 'Cy Third' },
  ],
  venue: 'Test Café, Testville',
  date: '27 Nov 2026',
  address: 'seduhscore.com/results',
};

describe('drawResultsStoryCard', () => {
  it('draws the winner, the places, the venue and date on lines of their own, and the address', () => {
    const { ctx, texts } = recordingContext();
    drawResultsStoryCard(ctx, SPEC);
    const said = texts.map((t) => t.text);
    for (const word of [
      'Ada Winner',
      'Bo Second',
      'Cy Third',
      'Test Café, Testville',
      '27 Nov 2026',
      'seduhscore.com/results',
      'CHAMPION',
      'VENUE',
      'DATE',
    ])
      expect(said).toContain(word);
    const at = (text) => texts.find((t) => t.text === text).y;
    expect(at('27 Nov 2026')).toBeGreaterThan(at('Test Café, Testville'));
  });
  it('keeps every line inside the card, however many places and however long the names', () => {
    const { ctx, texts } = recordingContext();
    drawResultsStoryCard(ctx, {
      ...SPEC,
      title: 'A very long competition name that needs two lines at the smallest size to fit',
      winner: {
        name: 'An extremely long winner name that must wrap',
        detail: 'A long cafe name here',
      },
      places: [1, 2, 3, 4, 5].map((n) => ({ place: n + 1, name: `Place ${n}`, detail: 'Cafe' })),
    });
    for (const t of texts) {
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThanOrEqual(STORY_HEIGHT);
      expect(t.x).toBeLessThan(STORY_WIDTH);
    }
    // Only three places under the winner are drawn.
    expect(texts.filter((t) => /^Place \d$/.test(t.text))).toHaveLength(3);
    // The venue block stays clear of the address in the footer.
    const venueY = texts.find((t) => t.text === 'VENUE').y;
    const addressY = texts.find((t) => t.text === 'seduhscore.com/results').y;
    expect(addressY - venueY).toBeGreaterThan(150);
  });
  it('draws no QR code and no cut corner: only the page address, as text', () => {
    const { ctx, rects } = recordingContext();
    drawResultsStoryCard(ctx, SPEC);
    expect(rects.some((r) => r.fill === '#ffffff' && r.args[2] === 260)).toBe(false);
  });
  it('leaves out venue and date when none is given', () => {
    const { ctx, texts } = recordingContext();
    drawResultsStoryCard(ctx, { ...SPEC, venue: undefined, date: undefined });
    const said = texts.map((t) => t.text);
    expect(said).not.toContain('VENUE');
    expect(said).not.toContain('DATE');
  });
});
