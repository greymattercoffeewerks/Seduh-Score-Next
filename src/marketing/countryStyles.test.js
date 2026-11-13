import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOKEN_FILES, contextMap, readText, resolve } from '../ui/tokens/tokenResolver.testkit.js';

// The country page's look is token-only (tokenDrift.test.js holds the general rule); these hold the specific decisions
// the owner asked for on 2026-11-14. The stylesheet is PARSED (jsdom's CSSOM), not pattern-matched, so selector lists,
// compound selectors, later duplicate rules and media queries are all seen.
const source = readFileSync('src/marketing/country.css', 'utf8');
const sheet = (() => {
  const style = document.createElement('style');
  style.textContent = source;
  document.head.append(style);
  return style.sheet;
})();

// Every style rule in the sheet, with its selectors (split on commas), declarations and whether it is inside @media.
function allRules() {
  const found = [];
  const walk = (list, inMedia) => {
    for (const rule of list) {
      if (rule.cssRules && rule.media) walk(rule.cssRules, true);
      else if (rule.selectorText) {
        found.push({
          selectors: rule.selectorText.split(',').map((x) => x.trim().replace(/\s+/g, ' ')),
          text: rule.cssText.slice(rule.cssText.indexOf('{') + 1, rule.cssText.lastIndexOf('}')),
          inMedia,
        });
      }
    }
  };
  walk(sheet.cssRules, false);
  return found;
}
const rulesFor = (selector) => allRules().filter((r) => r.selectors.includes(selector));
// The value of `property` in every rule for `selector` that sets it (top level and media alike).
const values = (selector, property) =>
  rulesFor(selector).flatMap((r) =>
    [...r.text.matchAll(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'g'))].map((m) =>
      m[1].trim(),
    ),
  );

describe('country.css', () => {
  it('parses: the helper sees the rules it is asked about', () => {
    expect(rulesFor('.country-stats').length).toBeGreaterThan(0);
    expect(allRules().some((r) => r.inMedia)).toBe(true);
  });

  it('draws the best finish on the gold tint token, in every rule that sets its background', () => {
    expect(values('.country-best', 'background')).toEqual(['var(--color-gold-tint)']);
  });

  it('colours the best-finish text only with tokens whose contrast on the tint is held (goldTint.test.js)', () => {
    const held = ['var(--color-gold)', 'var(--color-text)', 'var(--color-text-secondary)'];
    for (const selector of [
      '.country-best',
      '.country-best-label',
      '.country-best-finish',
      '.country-best-detail',
    ]) {
      for (const value of values(selector, 'color')) expect(held, selector).toContain(value);
    }
    expect(values('.country-best-label', 'color')).toEqual(['var(--color-gold)']);
  });

  it('holds no literal colour at all', () => {
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
  });

  it('keeps the prose under "Where this comes from" on the page column: no width or cap on it or an ancestor of its own', () => {
    expect(rulesFor('.country-source p').length).toBeGreaterThan(0);
    for (const selector of ['.country-source', '.country-source p']) {
      for (const property of ['max-inline-size', 'max-width', 'inline-size', 'width']) {
        expect(values(selector, property), `${selector} ${property}`).toEqual([]);
      }
    }
    // a compound selector on the same element counts too
    const capped = allRules().filter(
      (r) =>
        r.selectors.some((x) => x.includes('country-source')) &&
        /(^|[;\s])(max-)?(inline-size|width)\s*:/.test(r.text),
    );
    expect(capped).toEqual([]);
  });

  it('gives the disclosure row a real 44px target (the token resolves to 44px) and no default marker', () => {
    expect(values('.country-team-head', 'min-block-size')).toEqual(['var(--tap-target-min)']);
    const tap = resolve('var(--tap-target-min)', contextMap(TOKEN_FILES.map(readText), 'stage'));
    expect(['2.75rem', '44px']).toContain(tap);
    expect(values('.country-team-details > summary', 'list-style')).toEqual(['none']);
    expect(values('.country-team-details > summary::-webkit-details-marker', 'display')).toEqual([
      'none',
    ]);
  });

  it('shows the totals three across on a phone: one grid, three columns, never overridden by any rule or media query', () => {
    expect(values('.country-stats', 'display')).toEqual(['grid']);
    const columns = values('.country-stats', 'grid-template-columns');
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatch(/^repeat\(3,/);
    expect(rulesFor('.country-stats').filter((r) => r.inMedia)).toEqual([]);
  });
});
