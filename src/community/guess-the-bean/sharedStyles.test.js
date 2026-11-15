import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs from the repo root. Guess the Bean does not load src/ui/tokens/components.css, so its inputs need
// their own copy of the kit's field error edge, or a field marked aria-invalid looks exactly like a valid one.
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const gtb = read('src/community/guess-the-bean/shared.css');
const kit = read('src/ui/tokens/components.css');
const borderOf = (css, selector) => {
  const escaped = selector.replace(/[.[\]']/g, (c) => `\\${c}`);
  const body = new RegExp(String.raw`${escaped}\s*\{([^}]*)\}`).exec(css)?.[1];
  return body?.match(/border:\s*([^;]+);/)?.[1].trim() ?? null;
};

describe('Guess the Bean shared styles', () => {
  it('gives an invalid .gtb-input the same error edge as the kit field, so the two cannot drift apart', () => {
    const kitEdge = borderOf(kit, ".field-input[aria-invalid='true']");
    expect(kitEdge, 'kit rule in components.css').toBe(
      'var(--border-strong) solid var(--field-edge-error)',
    );
    // The 2px edge takes 1px more each side than the 1px base edge, so the side padding gives 1px back.
    expect(gtb).toMatch(
      /\.gtb-input\[aria-invalid='true'\]\s*\{[^}]*padding:\s*0 calc\(var\(--space-3\) - 1px\);/,
    );
    expect(borderOf(gtb, ".gtb-input[aria-invalid='true']"), 'GTB rule in shared.css').toBe(
      kitEdge,
    );
  });
});
