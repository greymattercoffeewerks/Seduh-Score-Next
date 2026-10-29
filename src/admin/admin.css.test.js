import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src', 'admin', 'admin.css'), 'utf8');
const tokens = readFileSync(join(process.cwd(), 'src', 'ui', 'tokens', 'colors.css'), 'utf8');

describe('admin badges', () => {
  it('uses semantic tokens rather than colour literals for every badge state', () => {
    const rules = [...css.matchAll(/\.adm-badge(?:--[a-z]+)?\s*\{([^}]*)\}/g)].map(
      (match) => match[1],
    );
    expect(rules).toHaveLength(5);
    for (const rule of rules) {
      const token = rule.match(/color:\s*var\((--color-[a-z0-9-]+)\)/)?.[1];
      expect(token).toBeTruthy();
      // a typo'd token would silently render the inherited colour
      expect(tokens).toContain(`${token}:`);
      expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(rule).not.toMatch(/\brgb(?:a)?\(/i);
    }
  });
});

describe('admin .stage-meta', () => {
  it('is styled with tokens (core/passwordForm.js emits it and the console loads no stylesheet that defines it)', () => {
    const rule = css.match(/(?:^|\n)\.stage-meta\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/color:\s*var\(--color-text-secondary\)/);
    expect(rule).toMatch(/font-size:\s*var\(--text-sm\)/);
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    // a typo'd token would silently inherit
    const typography = readFileSync(
      join(process.cwd(), 'src', 'ui', 'tokens', 'typography.css'),
      'utf8',
    );
    expect(tokens).toContain('--color-text-secondary:');
    expect(typography).toContain('--text-sm:');
  });
});
