import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INK,
  SURFACES,
  WHITE,
  brandCssVariables,
  contrastRatio,
  deriveBrandColors,
  hexToOklch,
  isBrandHex,
  oklchToHex,
  relativeLuminance,
} from './brandColor.js';

// vitest runs from the repo root
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

// A tiny seeded generator, so the property tests are the same on every run and a failure can be reproduced.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex2 = (n) => n.toString(16).padStart(2, '0');
const rgb = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return rgb(f(0), f(8), f(4));
}

// Every colour the property tests run over: seeded random, every grey (step 5), a full hue sweep at several
// saturations and lightnesses, the primaries, and the extremes.
function sampleColours() {
  const random = mulberry32(20261017);
  const colours = new Set([
    '#000000',
    '#ffffff',
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffff00',
    '#00ffff',
    '#ff00ff',
  ]);
  for (let i = 0; i < 3000; i += 1) {
    colours.add(
      rgb(Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)),
    );
  }
  for (let v = 0; v <= 255; v += 5) colours.add(rgb(v, v, v));
  for (let h = 0; h < 360; h += 6) {
    for (const s of [0.15, 0.5, 1]) {
      for (const l of [0.08, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) colours.add(hslToHex(h, s, l));
    }
  }
  return [...colours];
}
const SAMPLE = sampleColours();

// The rules, restated independently of the module so the module is not graded by its own helper.
const surfacesOf = (surface) => Object.values(SURFACES[surface]);
const worst = (colour, surface) =>
  Math.min(...surfacesOf(surface).map((s) => contrastRatio(colour, s)));
const bestTextOf = (colour) =>
  contrastRatio(colour, INK) >= contrastRatio(colour, WHITE) ? INK : WHITE;
const passes = (colour, surface) =>
  worst(colour, surface) >= 4.5 && contrastRatio(colour, bestTextOf(colour)) >= 4.5;

describe('isBrandHex', () => {
  it('accepts exactly a six-digit hex, in either case', () => {
    for (const ok of ['#000000', '#ffffff', '#2dd4c0', '#2DD4C0', '#aBcDeF'])
      expect(isBrandHex(ok)).toBe(true);
  });

  it('refuses everything else: shorthand, no hash, spaces, wrong length, non-strings', () => {
    const bad = [
      '',
      '#',
      '#fff',
      '#ffff',
      '#fffff',
      '#fffffff',
      '2dd4c0',
      ' #2dd4c0',
      '#2dd4c0 ',
      '#2dd4c0\n',
      '#gggggg',
      '#２dd4c0',
      'red',
      'rgb(1,2,3)',
      '#2dd4c0;',
      '#2dd4c0"',
      '<script>',
      'x'.repeat(10000),
      null,
      undefined,
      0,
      1,
      true,
      {},
      [],
      ['#2dd4c0'],
      () => '#2dd4c0',
      Symbol('x'),
      12345678,
    ];
    for (const value of bad)
      expect(isBrandHex(value), String(typeof value === 'symbol' ? 'symbol' : value)).toBe(false);
  });
});

describe('contrast maths', () => {
  it('matches the WCAG definition at the known points', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    // #777777 on white is the classic 4.48:1 (just under AA), #767676 is 4.54:1 (just over).
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('pins WCAG luminance and contrast for the primaries (a channel-weight change must fail)', () => {
    // Greys cannot catch this: their luminance sums the weights, so a re-weighting that keeps the sum at 1 is invisible.
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(3.9985, 3);
    expect(contrastRatio('#00ff00', '#ffffff')).toBeCloseTo(1.3722, 3);
    expect(contrastRatio('#0000ff', '#ffffff')).toBeCloseTo(8.5925, 3);
  });

  it('does not depend on the order of the two colours', () => {
    expect(contrastRatio('#2dd4c0', '#0b0e10')).toBe(contrastRatio('#0b0e10', '#2dd4c0'));
  });

  it('round-trips every sample colour through OKLCH to within one 8-bit step', () => {
    for (const colour of SAMPLE) {
      const { L, C, h } = hexToOklch(colour);
      const back = oklchToHex(L, C, h);
      for (let i = 1; i <= 5; i += 2) {
        expect(
          Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(colour.slice(i, i + 2), 16)),
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('deriveBrandColors: unusable input leaves the screen unbranded', () => {
  it('returns null for anything that is not a strict hex, and for an unknown surface', () => {
    for (const bad of ['', 'red', '#fff', null, undefined, {}, 12, '#zzzzzz', ' #2dd4c0']) {
      expect(deriveBrandColors(bad, 'stage')).toBeNull();
      expect(brandCssVariables(bad, 'paper')).toBeNull();
    }
    for (const surface of [
      '',
      'light',
      'dark',
      'STAGE',
      undefined,
      null,
      'toString',
      '__proto__',
      'constructor',
    ]) {
      expect(deriveBrandColors('#2dd4c0', surface)).toBeNull();
      expect(brandCssVariables('#2dd4c0', surface)).toBeNull();
    }
  });
});

describe('deriveBrandColors: known colours', () => {
  it("keeps Seduh Score's own teal exactly as it is on the stage surfaces", () => {
    const stage = deriveBrandColors('#2dd4c0', 'stage');
    expect(stage.adjusted).toBe(false);
    expect(stage.accent).toBe('#2dd4c0');
    expect(stage.accentContrast).toBe(INK);
  });

  it('darkens the same teal on paper, because it is too light to read on the light surfaces', () => {
    const paper = deriveBrandColors('#2dd4c0', 'paper');
    expect(paper.adjusted).toBe(true);
    expect(relativeLuminance(paper.accent)).toBeLessThan(relativeLuminance('#2dd4c0'));
    expect(paper.accentContrast).toBe(WHITE);
    expect(passes(paper.accent, 'paper')).toBe(true);
  });

  it('lightens black on the stage and darkens white on paper, never the other way', () => {
    const black = deriveBrandColors('#000000', 'stage');
    expect(black.adjusted).toBe(true);
    expect(relativeLuminance(black.accent)).toBeGreaterThan(0);
    const white = deriveBrandColors('#ffffff', 'paper');
    expect(white.adjusted).toBe(true);
    expect(relativeLuminance(white.accent)).toBeLessThan(1);
  });

  it('normalises the case of what it was given and reports the request', () => {
    const upper = deriveBrandColors('#2DD4C0', 'stage');
    expect(upper.requested).toBe('#2dd4c0');
    expect(upper.accent).toBe('#2dd4c0');
  });

  it('is exact about the boundary on paper: a colour just under 4.5:1 moves, one just over does not', () => {
    // On paper, the darkest surface is #c3cac8; find the lightest grey that still reads, then test either side of it.
    let edge = 255;
    while (edge > 0 && !passes(rgb(edge, edge, edge), 'paper')) edge -= 1;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    const justOver = rgb(edge, edge, edge);
    const justUnder = rgb(edge + 1, edge + 1, edge + 1);
    expect(deriveBrandColors(justOver, 'paper').adjusted).toBe(false);
    expect(deriveBrandColors(justUnder, 'paper').adjusted).toBe(true);
  });

  it('is exact about the boundary on the stage too', () => {
    // On the stage, the lightest surface is #1a2124; find the darkest grey that still reads, then test either side.
    let edge = 0;
    while (edge < 255 && !passes(rgb(edge, edge, edge), 'stage')) edge += 1;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(deriveBrandColors(rgb(edge, edge, edge), 'stage').adjusted).toBe(false);
    expect(deriveBrandColors(rgb(edge - 1, edge - 1, edge - 1), 'stage').adjusted).toBe(true);
  });

  it('pins the engine output for real colours, so a rounding change shows up', () => {
    expect(deriveBrandColors('#2dd4c0', 'paper').accent).toBe('#005f55');
    expect(deriveBrandColors('#e91e63', 'stage').accent).toBe('#fa3570');
    expect(deriveBrandColors('#e91e63', 'paper').accent).toBe('#aa0044');
    expect(deriveBrandColors('#000000', 'stage').accent).toBe('#878787');
    expect(deriveBrandColors('#ffffff', 'paper').accent).toBe('#545454');
    expect(deriveBrandColors('#767676', 'paper').accent).toBe('#545454');
  });
});

describe.each(['stage', 'paper'])('deriveBrandColors properties on the %s surface', (surface) => {
  const results = SAMPLE.map((colour) => [colour, deriveBrandColors(colour, surface)]);

  it(`ran over a large, varied sample (${SAMPLE.length} colours)`, () => {
    expect(SAMPLE.length).toBeGreaterThan(3000);
    expect(results.every(([, derived]) => derived !== null)).toBe(true);
  });

  it('always returns colours that are readable on every surface, whatever the request was', () => {
    for (const [colour, d] of results) {
      const where = `${surface} ${colour} -> ${d.accent}`;
      expect(worst(d.accent, surface), where).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(d.accent, d.accentContrast), where).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(d.accentHover, d.accentContrast),
        `${where} hover`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(worst(d.accentHover, surface), `${where} hover`).toBeGreaterThanOrEqual(3);
    }
  });

  it('measures its own ratios on the colours it actually returns', () => {
    for (const [colour, d] of results) {
      expect(d.ratios.accentOnWorstSurface, colour).toBeCloseTo(worst(d.accent, surface), 10);
      expect(d.ratios.textOnAccent, colour).toBeCloseTo(
        contrastRatio(d.accent, d.accentContrast),
        10,
      );
      expect(d.ratios.textOnHover, colour).toBeCloseTo(
        contrastRatio(d.accentHover, d.accentContrast),
        10,
      );
      expect(d.ratios.hoverOnWorstSurface, colour).toBeCloseTo(worst(d.accentHover, surface), 10);
    }
  });

  it('returns lowercase six-digit hex for all three colours', () => {
    for (const [, d] of results) {
      for (const value of [d.accent, d.accentHover, d.accentContrast])
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('never touches a colour that already reads, and moves one that does not', () => {
    for (const [colour, d] of results) {
      if (passes(colour, surface)) {
        expect(d.adjusted, colour).toBe(false);
        expect(d.accent, colour).toBe(colour);
      } else {
        expect(d.adjusted, colour).toBe(true);
        expect(d.accent, colour).not.toBe(colour);
      }
    }
  });

  it('only ever lightens on the stage and only ever darkens on paper', () => {
    const moved = results.filter(([, r]) => r.adjusted);
    expect(moved.length).toBeGreaterThan(500); // the property really ran, not vacuously
    for (const [colour, d] of moved) {
      const before = relativeLuminance(colour);
      const after = relativeLuminance(d.accent);
      if (surface === 'stage') expect(after, colour).toBeGreaterThan(before);
      else expect(after, colour).toBeLessThan(before);
    }
  });

  it('keeps the hue of a colour that has one', () => {
    let checked = 0;
    for (const [colour, d] of results.filter(([, r]) => r.adjusted)) {
      const before = hexToOklch(colour);
      const after = hexToOklch(d.accent);
      // Only where both ends are clearly coloured: a near-grey has no stable hue, and 8-bit rounding swings it.
      if (before.C < 0.06 || after.C < 0.04) continue;
      let delta = Math.abs(before.h - after.h) * (180 / Math.PI);
      if (delta > 180) delta = 360 - delta;
      // Measured worst case is about 1.6 degrees (8-bit rounding); 2.5 leaves room without hiding a real drift.
      expect(delta, `${colour} -> ${d.accent}`).toBeLessThanOrEqual(2.5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('moves a failing colour the smallest amount, to within 8-bit rounding: a step back toward the request fails', () => {
    // A step of 0.003 in OKLab lightness is the smallest that is reliably more than one 8-bit step apart (near black
    // and white a tinier step returns the same 8-bit colour), and it is tight enough to catch a search that overshoots.
    let checked = 0;
    for (const [colour, d] of results.filter(([, r]) => r.adjusted)) {
      const request = hexToOklch(colour);
      const result = hexToOklch(d.accent);
      const gap = result.L - request.L;
      const stepBack = oklchToHex(result.L - Math.sign(gap) * 0.003, request.C, request.h);
      expect(passes(stepBack, surface), `${colour} -> ${d.accent}, step back ${stepBack}`).toBe(
        false,
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('gives every colour a hover state the eye can tell from the accent (contrast of at least 1.15)', () => {
    for (const [colour, d] of results) {
      expect(
        contrastRatio(d.accent, d.accentHover),
        `${colour} -> ${d.accent} / ${d.accentHover}`,
      ).toBeGreaterThanOrEqual(1.15);
    }
  });

  it('is deterministic and does not mutate or depend on anything outside its arguments', () => {
    for (const [colour, d] of results.slice(0, 500)) {
      expect(deriveBrandColors(colour, surface)).toEqual(d);
    }
  });
});

describe('the readability guarantee cannot be changed by an importer', () => {
  it('freezes the surface colours all the way down, so an assignment throws instead of weakening the rules', () => {
    expect(Object.isFrozen(SURFACES)).toBe(true);
    for (const surface of Object.values(SURFACES)) expect(Object.isFrozen(surface)).toBe(true);
    expect(() => {
      SURFACES.stage.canvas = '#ffffff';
    }).toThrow(TypeError);
    expect(() => {
      SURFACES.extra = {};
    }).toThrow(TypeError);
    expect(SURFACES.stage.canvas).toBe('#0b0e10');
  });
});

describe('greys stay grey', () => {
  it('returns an exactly achromatic accent, hover and text for every grey, on both surfaces', () => {
    for (let v = 0; v <= 255; v += 1) {
      const grey = rgb(v, v, v);
      for (const surface of ['stage', 'paper']) {
        const d = deriveBrandColors(grey, surface);
        for (const colour of [d.accent, d.accentHover]) {
          expect(colour.slice(1, 3), `${grey} on ${surface} -> ${colour}`).toBe(colour.slice(3, 5));
          expect(colour.slice(3, 5), `${grey} on ${surface} -> ${colour}`).toBe(colour.slice(5, 7));
        }
      }
    }
  });
});

describe('brandCssVariables: exactly three properties, never anything else', () => {
  it('returns the accent, its hover and its contrast text and nothing more', () => {
    for (const surface of ['stage', 'paper']) {
      for (const colour of SAMPLE.slice(0, 600)) {
        const vars = brandCssVariables(colour, surface);
        expect(Object.keys(vars).sort()).toEqual([
          '--color-accent',
          '--color-accent-contrast',
          '--color-accent-hover',
        ]);
        for (const value of Object.values(vars)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("matches deriveBrandColors' answer", () => {
    const d = deriveBrandColors('#e91e63', 'stage');
    expect(brandCssVariables('#e91e63', 'stage')).toEqual({
      '--color-accent': d.accent,
      '--color-accent-hover': d.accentHover,
      '--color-accent-contrast': d.accentContrast,
    });
  });
});

describe('the surface colours match the design tokens (a module cannot read CSS, so this test does)', () => {
  const css = read('src/ui/tokens/colors.css');
  const ramp = Object.fromEntries(
    [...css.matchAll(/--clr-petrol-(\d+):\s*(#[0-9a-fA-F]{6});/g)].map(([, step, value]) => [
      step,
      value.toLowerCase(),
    ]),
  );
  const stageStart = css.indexOf("[data-surface='stage']");
  const paperPart = css.slice(0, stageStart);
  const stagePart = css.slice(stageStart);
  const ref = (part, token) => {
    const m = part.match(
      new RegExp(`--color-${token}:\\s*(?:var\\(--clr-petrol-(\\d+)\\)|(#[0-9a-fA-F]{6}))`),
    );
    expect(
      m,
      `--color-${token} in the ${part === stagePart ? 'stage' : 'paper'} block`,
    ).not.toBeNull();
    return m[2] ? m[2].toLowerCase() : ramp[m[1]];
  };

  it('finds each token where it is read: one stage block and two declarations per token', () => {
    // Slicing at the stage block reads only what comes before it; an override appended after it would be invisible.
    expect(css.split("[data-surface='stage']").length - 1).toBe(1);
    for (const token of ['canvas', 'surface', 'surface-sunken', 'accent-contrast']) {
      expect(css.match(new RegExp(`--color-${token}\\s*:`, 'g')), token).toHaveLength(2);
    }
  });

  it('finds the stage block and the petrol ramp it needs', () => {
    expect(stageStart).toBeGreaterThan(0);
    expect(Object.keys(ramp)).toEqual(
      expect.arrayContaining(['50', '100', '200', '800', '900', '950']),
    );
  });

  it('uses the same canvas, card and sunken colours on the stage', () => {
    expect(SURFACES.stage).toEqual({
      canvas: ref(stagePart, 'canvas'),
      surface: ref(stagePart, 'surface'),
      sunken: ref(stagePart, 'surface-sunken'),
    });
  });

  it('uses the same canvas, card and sunken colours on paper', () => {
    expect(SURFACES.paper).toEqual({
      canvas: ref(paperPart, 'canvas'),
      surface: ref(paperPart, 'surface'),
      sunken: ref(paperPart, 'surface-sunken'),
    });
  });

  it('offers the two text colours the tokens use on an accent: dark ink on the stage, white on paper', () => {
    expect(ref(stagePart, 'accent-contrast')).toBe(INK);
    expect(ref(paperPart, 'accent-contrast')).toBe(WHITE);
  });
});

describe('the module is pure', () => {
  const source = read('src/core/brandColor.js');
  // Comments removed (block comments, then trailing // ones) so a word in prose cannot trip the check. Strings are
  // not stripped: a forbidden word inside a string is a false alarm worth seeing, never a way to hide a call.
  const noComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  it('imports nothing, statically or dynamically', () => {
    for (const pattern of [
      /^\s*import\s/m,
      /\bimport\s*\(/,
      /\bimport\.meta\b/,
      /\bexport\s[^;]*\sfrom\s/,
      /\brequire\s*\(/,
    ]) {
      expect(noComments, String(pattern)).not.toMatch(pattern);
    }
  });

  it('touches no clock, randomness, DOM, network, storage or timer', () => {
    expect(noComments).not.toMatch(
      /\b(document|window|globalThis|Date|performance|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|navigator|crypto|setTimeout|setInterval|setImmediate|requestAnimationFrame|process|Intl|Temporal)\b|Math\.random/,
    );
  });
});
