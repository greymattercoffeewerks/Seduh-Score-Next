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
