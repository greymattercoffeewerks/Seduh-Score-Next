import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUT, buildTokens, declarations, render } from './export-figma-tokens.mjs';

const css = (f) => readFileSync(join(process.cwd(), 'src/ui/tokens', f), 'utf8');
const leaves = (o, path = []) =>
  Object.entries(o).flatMap(([k, v]) =>
    v.$value === undefined ? leaves(v, [...path, k]) : [[[...path, k].join('.'), v]],
  );
const tokens = JSON.parse(render());

describe('Figma token export', () => {
  it('is committed and current (run `npm run tokens:figma` after changing a token)', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(render());
  });

  it('exports every colour ramp step and semantic colour in the CSS', () => {
    const root = declarations(css('colors.css'), ':root');
    const ramp = Object.keys(root).filter((n) => /^--clr-/.test(n));
    const semantic = Object.keys(root).filter((n) => /^--color-/.test(n));
    expect(ramp.length).toBeGreaterThan(30);
    expect(leaves(tokens.core).filter(([k]) => k.startsWith('color.')).length).toBe(ramp.length);
    expect(leaves(tokens.paper).length).toBe(semantic.length);
  });

  it('gives paper and stage the same semantic names, so one variable has two modes', () => {
    expect(leaves(tokens.stage).map(([k]) => k)).toEqual(leaves(tokens.paper).map(([k]) => k));
  });

  it('resolves every alias to a token that exists', () => {
    const known = new Set(
      [tokens.core, tokens.paper, tokens.stage].flatMap((s) => leaves(s).map(([k]) => k)),
    );
    for (const [name, t] of [tokens.paper, tokens.stage].flatMap((s) => leaves(s))) {
      const m = /^\{(.+)\}$/.exec(String(t.$value));
      if (m) expect(known.has(m[1]), `${name} -> ${m[1]}`).toBe(true);
    }
  });

  it('carries the stage values, not the paper ones', () => {
    expect(tokens.paper.color.accent.$value).toBe('{color.teal.700}');
    expect(tokens.stage.color.accent.$value).toBe('{color.teal.300}');
    expect(tokens.stage.color.canvas.$value).toBe('{color.petrol.950}');
  });

  it('converts rem to px and keeps units honest', () => {
    expect(tokens.core.space['4'].$value).toBe('16px');
    expect(tokens.core.font.size.base.$value).toBe('16px');
    expect(tokens.core.motion.easing.out.$value).toEqual([0.2, 0.8, 0.2, 1]);
  });

  it('refuses a var() that points at nothing', () => {
    expect(() =>
      buildTokens({
        colors: ':root { --color-x: var(--nope); }',
        spacing: '',
        typography: '',
        motion: '',
      }),
    ).toThrow(/not an exported token/);
  });
});
