import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TOKEN_FILES,
  contextMap,
  customProps,
  readText,
  resolve,
  rules,
  stripComments,
} from './tokenResolver.testkit.js';

// Petrol Kaizen P6: the role layer (src/ui/tokens/roles.css) is a RENAMING layer on top of the semantic one. Moving a
// component from `var(--color-accent)` to `var(--btn-primary-bg)` must not change a pixel, in either surface mode, or
// under an organiser's brand colour. This resolves every role token through the ramp the way the browser does and
// holds three things:
//   1. each role resolves to exactly what the semantic token it names resolves to, in paper AND stage (so the
//      renaming is value-neutral), and the radius roles to the literal Hybrid values;
//   2. a role holds no literal and is declared on every element that can re-point a semantic colour (:root, every
//      [data-surface], every [data-brand]): declared on :root alone, a stage subtree would keep the paper value,
//      because a custom property that is a var() is resolved where it is declared;
//   3. the parts really read the roles (no dead role), and the file that holds them is loaded by every page.
// The same rename was also checked in a real browser (computed style of 160,000 properties across the token preview
// and a synthetic page covering every part, paper, stage and a branded subtree, old tokens against new: no
// difference); see CHANGELOG.md.

const css = TOKEN_FILES.map(readText);
const paper = contextMap(css, 'paper');
const stage = contextMap(css, 'stage');

const COLOUR_ROLES = {
  '--btn-primary-bg': '--color-accent',
  '--btn-primary-fg': '--color-accent-contrast',
  '--btn-primary-hover': '--color-accent-hover',
  '--btn-danger-bg': '--color-danger',
  '--btn-danger-fg': '--color-danger-contrast',
  '--btn-outline-edge': '--color-border-strong',
  '--field-edge': '--color-border-input',
  '--field-edge-error': '--color-danger',
  '--box-edge': '--color-border-card',
  '--selected-bg': '--color-accent-tint',
  '--selected-fg': '--color-accent-tint-text',
  '--selected-edge': '--color-accent',
};
const RADIUS_ROLES = {
  '--radius-field': ['--radius-sm', '3px'],
  '--radius-selector': ['--radius-sm', '3px'],
  '--radius-box': ['--radius-md', '6px'],
  '--radius-dialog': ['--radius-lg', '10px'],
};

const valueOf = (map, name) => resolve(`var(${name})`, map);

describe('the role layer renames, it does not restyle', () => {
  it('the resolver is not vacuous: the semantic accent is a real colour that differs between paper and stage', () => {
    expect(valueOf(paper, '--color-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueOf(stage, '--color-accent')).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueOf(paper, '--color-accent')).not.toBe(valueOf(stage, '--color-accent'));
  });

  for (const [role, semantic] of Object.entries(COLOUR_ROLES)) {
    it(`${role} computes to ${semantic}, in paper and in stage`, () => {
      expect(valueOf(paper, role)).toBe(valueOf(paper, semantic));
      expect(valueOf(stage, role)).toBe(valueOf(stage, semantic));
    });
  }

  it('a role that carries the surface really flips: the primary button fill differs between paper and stage', () => {
    for (const role of ['--btn-primary-bg', '--selected-edge', '--field-edge-error']) {
      expect(valueOf(paper, role), role).not.toBe(valueOf(stage, role));
    }
  });

  for (const [role, [semantic, literal]] of Object.entries(RADIUS_ROLES)) {
    it(`${role} is ${literal} (${semantic}), the Hybrid value it replaces`, () => {
      expect(valueOf(paper, role)).toBe(literal);
      expect(valueOf(stage, role)).toBe(literal);
      expect(valueOf(paper, semantic)).toBe(literal);
    });
  }
});

describe('the role layer is declared where it can be resolved', () => {
  const roleRules = rules(readText('src/ui/tokens/roles.css'));
  const declared = roleRules.flatMap((r) =>
    customProps(r.body).map(([name, value]) => ({ ...r, name, value })),
  );

  it('holds every role in the tables above, and nothing else', () => {
    expect(declared.map((d) => d.name).sort()).toEqual(
      [...Object.keys(COLOUR_ROLES), ...Object.keys(RADIUS_ROLES)].sort(),
    );
  });

  it('a role is a bare var() of a semantic token: no literal, no calc, no second role', () => {
    for (const d of declared) {
      expect(d.value, d.name).toMatch(/^var\(--[\w-]+\)$/);
      // by NAME, not only by value: two semantic tokens can resolve to the same colour today
      expect(d.value, d.name).toBe(`var(${COLOUR_ROLES[d.name] ?? RADIUS_ROLES[d.name][0]})`);
      const target = /var\((--[\w-]+)\)/.exec(d.value)[1];
      expect(
        Object.keys({ ...COLOUR_ROLES, ...RADIUS_ROLES }),
        `${d.name} aliases another role`,
      ).not.toContain(target);
    }
  });

  it('the colour roles are declared on :root, every [data-surface] and every [data-brand] (a stage or branded subtree must re-resolve them)', () => {
    const colourRule = roleRules.find((r) => r.body.includes('--btn-primary-bg'));
    const selectors = colourRule.selector.split(',').map((s) => s.trim());
    expect(selectors).toEqual([':root', '[data-surface]', '[data-brand]']);
    for (const name of Object.keys(COLOUR_ROLES)) expect(colourRule.body).toContain(`${name}:`);
  });

  it('the radius roles are on :root only (no surface changes a radius)', () => {
    const radiusRule = roleRules.find((r) => r.body.includes('--radius-field'));
    expect(radiusRule.selector).toBe(':root');
  });

  it('brandSlot marks a branded node with data-brand, the hook the colour roles key on', () => {
    expect(readText('src/core/brandSlot.js')).toContain("setAttribute('data-brand', '')");
  });

  it('every page that loads the tokens gets the roles: index.css imports roles.css before base.css', () => {
    const index = readText('src/ui/tokens/index.css');
    expect(index).toContain("@import './roles.css'");
    expect(index.indexOf('roles.css')).toBeLessThan(index.indexOf('base.css'));
    expect(index.indexOf('colors.css')).toBeLessThan(index.indexOf('roles.css'));
  });
});

describe('the 44px floor is declared on the controls', () => {
  it('.btn, .field-input and .fb-btn each set min-height to --tap-target-min', () => {
    const body = (file, sel) =>
      stripComments(readFileSync(`src/ui/tokens/${file}.css`, 'utf8')).match(
        new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')} \\{([^}]*)\\}`),
      )?.[1] ?? '';
    for (const [file, sel] of [
      ['components', '.btn'],
      ['components', '.field-input'],
      ['feedback', '.fb-btn'],
    ])
      expect(body(file, sel), sel).toContain('min-height: var(--tap-target-min)');
  });
});

describe('the parts read the roles', () => {
  const PARTS = ['components', 'base', 'feedback', 'vocabulary'].map((n) => ({
    name: n,
    css: stripComments(readFileSync(`src/ui/tokens/${n}.css`, 'utf8')),
  }));
  const all = PARTS.map((p) => p.css).join('\n');

  it('no role is dead: every one is read by at least one part', () => {
    const dead = [...Object.keys(COLOUR_ROLES), ...Object.keys(RADIUS_ROLES)].filter(
      (name) => !all.includes(`var(${name})`),
    );
    expect(dead).toEqual([]);
  });

  it('a button reads the primary role in every part that paints one (console .btn, public .action, the parts .fb-btn)', () => {
    for (const name of ['components', 'base', 'feedback']) {
      const part = PARTS.find((p) => p.name === name).css;
      expect(part, name).toContain('var(--btn-primary-bg)');
      expect(part, name).toContain('var(--btn-primary-hover)');
    }
  });

  it('.card, .panel and the confirm panel share the box role, so a card and a pricing card cannot drift apart', () => {
    const body = (file, selector) =>
      PARTS.find((p) => p.name === file).css.match(
        new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`),
      )[1];
    expect(body('components', '.card')).toContain('border-radius: var(--radius-box)');
    expect(body('base', '.panel')).toContain('border-radius: var(--radius-box)');
    expect(body('components', '.card')).toContain('solid var(--box-edge)');
    expect(body('base', '.panel')).toContain('solid var(--box-edge)');
  });
});
