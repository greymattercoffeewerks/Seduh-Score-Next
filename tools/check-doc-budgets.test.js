import { describe, it, expect } from 'vitest';
import { BUDGETS, brokenLinks, missingIndexedHeadings, overBudget } from './check-doc-budgets.mjs';

describe('overBudget', () => {
  it('names every file past its limit and no other', () => {
    const sizes = {
      'CLAUDE.md': BUDGETS['CLAUDE.md'] + 1,
      'CHANGELOG.md': BUDGETS['CHANGELOG.md'],
    };
    const out = overBudget(sizes);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('CLAUDE.md');
  });
});

describe('brokenLinks', () => {
  const exists = (p) => p.endsWith('/real.md');
  it('flags a relative link to nothing and ignores urls, anchors and real files', () => {
    const text = '[a](real.md) [b](gone.md#x) [c](https://x.test/y) [d](#top) [e](mailto:a@b.c)';
    expect(brokenLinks('/r/CLAUDE.md', text, exists)).toEqual([
      '/r/CLAUDE.md: broken link gone.md',
    ]);
  });
});

describe('missingIndexedHeadings', () => {
  const index =
    '- Entry one · 2026-09-01 → [`a`](docs/a.md)\n- Entry two · 2026-09-02 → [`a`](docs/a.md)\nprose line';
  it('passes when the archive file has each heading', () => {
    const read = () => '## Entry one · 2026-09-01\n\nbody\n\n## Entry two · 2026-09-02\n';
    expect(missingIndexedHeadings(index, read)).toEqual([]);
  });
  it('reports a heading that is gone and a file that is gone', () => {
    expect(missingIndexedHeadings(index, () => '## Entry one · 2026-09-01\n')).toHaveLength(1);
    expect(missingIndexedHeadings(index, () => null)).toHaveLength(2);
  });
});
