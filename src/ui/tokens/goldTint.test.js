import { describe, expect, it } from 'vitest';
import { TOKEN_FILES, contextMap, readText, resolve } from './tokenResolver.testkit.js';

// The gold tint (the country page's best finish card): its text pairs must reach 4.5:1 in BOTH surface modes, and the
// colours must come from the ramp, not literals (DESIGN.md "Gold tint").
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

describe.each(['paper', 'stage'])('--color-gold-tint (%s)', (mode) => {
  const map = contextMap(files, mode);
  const colour = (name) => resolve(`var(${name})`, map);

  it('is a ramp colour, and differs from the canvas', () => {
    expect(map.get('--color-gold-tint')).toMatch(/^var\(--clr-gold-(100|900)\)$/);
    expect(colour('--color-gold-tint')).not.toBe(colour('--color-canvas'));
  });
  it.each(['--color-gold', '--color-text', '--color-text-secondary'])(
    'has %s text at 4.5:1 or better on it',
    (token) => {
      expect(ratio(colour(token), colour('--color-gold-tint')), token).toBeGreaterThanOrEqual(4.5);
    },
  );
});
