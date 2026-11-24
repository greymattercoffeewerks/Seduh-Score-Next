import { describe, expect, it } from 'vitest';
import { TOKEN_FILES, contextMap, readText, resolve } from './tokenResolver.testkit.js';

// Stage muted text (the projector and audience surface) must reach WCAG AA 4.5:1 on every stage background it is
// set on, including the gold highlight (DESIGN.md "Figma review fixes"). It was petrol-400 (4.46:1 on the canvas,
// 4.16:1 on the surface); an outside design review caught it. It must also stay quieter than secondary text, so the
// hierarchy survives. Borders are held to the 3:1 non-text floor, not this one.
const files = TOKEN_FILES.map(readText);
const channel = (hex, i) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const stage = contextMap(files, 'stage');
const colour = (name) => resolve(`var(${name})`, stage);

describe('stage --color-text-muted', () => {
  it.each(['--color-canvas', '--color-surface', '--color-surface-sunken', '--color-gold-tint'])(
    'is at 4.5:1 or better on %s',
    (bg) => {
      expect(ratio(colour('--color-text-muted'), colour(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );
  it('keeps about 5:1 of margin on canvas and surface, for a projector', () => {
    expect(ratio(colour('--color-text-muted'), colour('--color-canvas'))).toBeGreaterThanOrEqual(5);
    expect(ratio(colour('--color-text-muted'), colour('--color-surface'))).toBeGreaterThanOrEqual(
      5,
    );
  });
  it('stays quieter than secondary and body text', () => {
    const canvas = colour('--color-canvas');
    const muted = ratio(colour('--color-text-muted'), canvas);
    expect(muted).toBeLessThan(ratio(colour('--color-text-secondary'), canvas));
    expect(ratio(colour('--color-text-secondary'), canvas)).toBeLessThan(
      ratio(colour('--color-text'), canvas),
    );
  });
  it('leaves the card and input edges on the 3:1 non-text floor', () => {
    for (const edge of ['--color-border-card', '--color-border-input']) {
      expect(ratio(colour(edge), colour('--color-canvas')), edge).toBeGreaterThanOrEqual(3);
    }
  });
});
