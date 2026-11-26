import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOKEN_FILES, contextMap, readText, resolve } from './tokenResolver.testkit.js';

// The night-console additions (2026-11-26, from the BTC dashboard concept): --color-chrome (with its ramp step
// --clr-petrol-975), --tracking-caps, and the parts .eyebrow, .queue, .runsheet and .cutline in vocabulary.css.
// What this holds: the chrome step is the outermost layer in stage (paper chrome is the surface step); every
// text pairing that can sit on it or on the new parts' grounds passes 4.5:1 in BOTH modes; the parts exist, are
// reachable from index.css, and take roles and tokens (no raw colour, no clip-path).
const files = TOKEN_FILES.map(readText);
const channel = (hex, i) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const modes = { paper: contextMap(files, 'paper'), stage: contextMap(files, 'stage') };
const colour = (mode, name) => resolve(`var(${name})`, modes[mode]);
const vocab = readFileSync('src/ui/tokens/vocabulary.css', 'utf8');

describe('--color-chrome', () => {
  it('is the ramp step 975 in stage (darker than the canvas) and the surface step in paper', () => {
    expect(colour('stage', '--color-chrome')).toBe('#070a0b');
    expect(lum(colour('stage', '--color-chrome'))).toBeLessThan(
      lum(colour('stage', '--color-canvas')),
    );
    expect(colour('paper', '--color-chrome')).toBe(colour('paper', '--color-surface'));
  });
  it('is declared in both modes, and 975 is used by nothing else', () => {
    for (const mode of ['paper', 'stage']) expect(modes[mode].has('--color-chrome')).toBe(true);
    const colors = readFileSync('src/ui/tokens/colors.css', 'utf8');
    const reads = files.flatMap((f) => f.match(/var\(--clr-petrol-975\)/g) ?? []);
    expect(colors).toContain('--clr-petrol-975: #070a0b');
    expect(reads).toHaveLength(1);
  });
  it.each(['paper', 'stage'])(
    'holds 4.5:1 for text, secondary, muted and accent on it (%s)',
    (mode) => {
      const bg = colour(mode, '--color-chrome');
      for (const fg of [
        '--color-text',
        '--color-text-secondary',
        '--color-text-muted',
        '--color-accent',
      ]) {
        expect(ratio(colour(mode, fg), bg), `${fg} on chrome`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it('keeps the chrome edge visible: the divider is distinct from the chrome in stage', () => {
    expect(
      ratio(colour('stage', '--color-border'), colour('stage', '--color-chrome')),
    ).toBeGreaterThan(1.15);
  });
});

describe('the parts', () => {
  it.each(['paper', 'stage'])(
    'muted detail text holds 4.5:1 on the surface and the selected tint (%s)',
    (mode) => {
      for (const bg of ['--color-surface', '--selected-bg', '--color-canvas']) {
        expect(
          ratio(colour(mode, '--color-text-muted'), colour(mode, bg)),
          bg,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        ratio(colour(mode, '--selected-fg'), colour(mode, '--selected-bg')),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
  it.each(['paper', 'stage'])(
    'the cut line label (accent) holds 4.5:1 on canvas and surface (%s)',
    (mode) => {
      for (const bg of ['--color-canvas', '--color-surface']) {
        expect(ratio(colour(mode, '--color-accent'), colour(mode, bg))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it('the queue edge rules set only the accent or the warning colour (the 3:1 pairing below covers them)', () => {
    const edges = [...vocab.matchAll(/--queue-edge:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(edges.sort()).toEqual(['var(--color-warning)', 'var(--selected-edge)']);
    for (const mode of ['paper', 'stage']) {
      expect(colour(mode, '--selected-edge')).toBe(colour(mode, '--color-accent'));
    }
  });
  it('the queue edge colours are 3:1 against the surface in both modes (WCAG 1.4.11)', () => {
    for (const mode of ['paper', 'stage']) {
      for (const edge of ['--color-warning', '--color-accent']) {
        expect(
          ratio(colour(mode, edge), colour(mode, '--color-surface')),
          `${mode} ${edge}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('defines the four parts and reaches every page through index.css', () => {
    for (const sel of ['.eyebrow {', '.queue {', '.runsheet {', '.cutline {'])
      expect(vocab).toContain(sel);
    expect(readFileSync('src/ui/tokens/index.css', 'utf8')).toContain("@import './vocabulary.css'");
    expect(readFileSync('src/ui/tokens/typography.css', 'utf8')).toContain(
      '--tracking-caps: 0.14em',
    );
  });
  it('they take tokens: no raw colour, no clip-path, no shadow in the new block', () => {
    const start = vocab.indexOf('Console parts from the night concept');
    expect(start).toBeGreaterThan(-1);
    const block = vocab.slice(start);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(block).not.toMatch(/:\s*(?:black|white|red|green|blue|gray|grey|gold|teal)\s*[;}]/i);
    expect(block).not.toMatch(/clip-path|box-shadow/);
  });
});
