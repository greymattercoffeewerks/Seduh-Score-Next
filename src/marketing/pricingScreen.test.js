import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLandingScreen } from './landingScreen.js';
import { FAQ, FEATURE_GROUPS, STATE_WORDS, TIERS } from './pricingContent.js';
import { mountPricingScreen } from './pricingScreen.js';

// vitest runs from the repo root
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

const ALL_ROWS = FEATURE_GROUPS.flatMap((group) => group.rows);

function mount() {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountPricingScreen(root);
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pricing content', () => {
  it('has groups, rows and exactly one cell per tier in every feature row', () => {
    expect(FEATURE_GROUPS.length).toBeGreaterThan(0);
    for (const group of FEATURE_GROUPS) {
      expect(group.rows.length, `rows in "${group.title}"`).toBeGreaterThan(0);
    }
    for (const [name, , cells] of ALL_ROWS) {
      expect(cells, `cells for "${name}"`).toHaveLength(TIERS.length);
    }
  });

  it('only uses states the page can say in words', () => {
    for (const [name, , cells] of ALL_ROWS) {
      for (const cell of cells) {
        if (cell.state === 'text') {
          expect(cell.text, `text cell in "${name}"`).toBeTruthy();
        } else {
          expect(STATE_WORDS, `state in "${name}"`).toHaveProperty(cell.state);
        }
      }
    }
  });
});

describe('mountPricingScreen', () => {
  let root;
  beforeEach(() => {
    root = mount();
  });

  it('keeps the header and footer outside <main>, so they are real landmarks', () => {
    const main = root.querySelector('main');
    expect(root.querySelectorAll('main')).toHaveLength(1);
    expect(main.querySelector('header, footer')).toBeNull();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
  });

  it('never skips a heading level: h1, then h2 sections, then h3 inside them', () => {
    const levels = [...root.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);
    });
  });

  it('has one h1 and puts the current-page mark on the Pricing link only', () => {
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    const current = [...root.querySelectorAll('.public-header-links [aria-current="page"]')];
    expect(current.map((link) => link.textContent)).toEqual(['Pricing']);
  });

  it('shows all three tiers with their price and the call to action the content names', () => {
    const cards = [...root.querySelectorAll('.pricing-card')];
    expect(cards.map((card) => card.querySelector('.pricing-tier-name').textContent)).toEqual(
      TIERS.map((tier) => tier.name),
    );
    expect(cards.map((card) => card.querySelector('.pricing-tier-price').textContent)).toEqual(
      TIERS.map((tier) => `${tier.price}${tier.suffix ? ` ${tier.suffix}` : ''}`),
    );
    expect(cards.map((card) => card.querySelector('a.pricing-cta').getAttribute('href'))).toEqual(
      TIERS.map((tier) => tier.cta.href),
    );
  });

  it('sends every tier to contact, never to a checkout or a sign-up we do not have', () => {
    expect(TIERS.map((tier) => tier.cta.href)).toEqual(['/contact/', '/contact/', '/contact/']);
  });

  it('does not name BTC on rows that only Cup Taster supports without saying Cup Taster', () => {
    for (const name of [
      'Public results page',
      'Printable report and CSV export',
      'Per-cupper and per-set analytics',
    ]) {
      const [, description] = ALL_ROWS.find(([rowName]) => rowName === name);
      expect(description, name).toMatch(/^Cup Taster:/);
    }
  });

  it('gives each tier call to action a distinct accessible name', () => {
    const names = [...root.querySelectorAll('.pricing-card a.pricing-cta')].map(
      (link) => link.textContent,
    );
    expect(names).toHaveLength(TIERS.length);
    expect(new Set(names).size).toBe(TIERS.length);
  });

  it('builds a table with a header for each tier and a row for each feature', () => {
    const headers = [...root.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Feature', ...TIERS.map((tier) => tier.name)]);
    const rows = [...root.querySelectorAll('tbody .pricing-row')];
    expect(rows).toHaveLength(ALL_ROWS.length);
    for (const row of rows) {
      expect(row.querySelectorAll('th[scope="row"]')).toHaveLength(1);
      expect(row.querySelectorAll('td')).toHaveLength(TIERS.length);
    }
  });

  it('puts the right word in every cell: each state in its own word, a symbol never alone', () => {
    const rows = [...root.querySelectorAll('tbody .pricing-row')];
    rows.forEach((row, r) => {
      const [name, , cells] = ALL_ROWS[r];
      expect(row.querySelector('.pricing-feature-name').textContent).toBe(name);
      [...row.querySelectorAll('td')].forEach((td, t) => {
        const cell = cells[t];
        const where = `"${name}" / ${TIERS[t].name}`;
        expect(td.classList.contains(`pricing-cell-${cell.state}`), where).toBe(true);
        if (cell.state === 'text') {
          expect(td.querySelector('.pricing-cell-text').textContent, where).toBe(cell.text);
          expect(td.querySelector('.pricing-glyph'), where).toBeNull();
        } else {
          expect(td.querySelector('.pricing-cell-word').textContent, where).toBe(
            STATE_WORDS[cell.state],
          );
          expect(td.querySelector('.pricing-glyph').getAttribute('aria-hidden'), where).toBe(
            'true',
          );
        }
      });
    });
  });

  it('never labels a planned feature Included, nor an included one Planned', () => {
    const planned = [...root.querySelectorAll('td.pricing-cell-soon')];
    const included = [...root.querySelectorAll('td.pricing-cell-yes')];
    expect(planned.length).toBeGreaterThan(0);
    expect(included.length).toBeGreaterThan(0);
    for (const cell of planned) {
      expect(cell.querySelector('.pricing-cell-word').textContent).toBe('Planned');
    }
    for (const cell of included) {
      expect(cell.querySelector('.pricing-cell-word').textContent).toBe('Included');
    }
  });

  it('labels every cell with its tier, for the stacked mobile layout', () => {
    for (const row of root.querySelectorAll('tbody .pricing-row')) {
      expect([...row.querySelectorAll('td')].map((td) => td.getAttribute('data-label'))).toEqual(
        TIERS.map((tier) => tier.name),
      );
    }
  });

  it('lists every FAQ question with its answer', () => {
    const items = [...root.querySelectorAll('.pricing-faq-item')];
    expect(items.map((item) => item.querySelector('h3').textContent)).toEqual(
      FAQ.map((entry) => entry.question),
    );
    expect(items.map((item) => item.querySelector('p').textContent)).toEqual(
      FAQ.map((entry) => entry.answer),
    );
  });

  it('never renders a review marker or a contact address of its own', () => {
    const text = root.textContent;
    expect(text).not.toMatch(/\[(OWNER TO CONFIRM|VERIFY|TEMPORARY)\]|UNCONFIRMED|TODO/);
    expect(text).not.toMatch(/@/);
  });
});

describe('the landing page and the pricing page agree on what each tier costs', () => {
  it("shows the landing page's three pricing columns with the pricing content's name, price and suffix", () => {
    // Only the reduced-motion queries answer true: the landing page's carousel starts a
    // timer when "no-preference" is true, and this test must not leave one running.
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce') }));
    const landing = document.createElement('div');
    mountLandingScreen(landing);

    const columns = [...landing.querySelectorAll('#pricing .petrol-plate-col')];
    const shown = columns.map((column) => [
      column.querySelector('.petrol-tier-label').textContent,
      column.querySelector('.petrol-tier-price').firstChild.textContent,
      column.querySelector('.petrol-price-suffix')?.textContent ?? null,
    ]);
    expect(shown).toEqual(TIERS.map((tier) => [tier.name, tier.price, tier.suffix]));
  });

  it('states the prices the owner set: Free, BND $18 once, BND $350 a year', () => {
    expect(TIERS.map((tier) => [tier.name, tier.price, tier.suffix])).toEqual([
      ['Community', 'Free', null],
      ['Per-event', 'BND $18', 'one-time'],
      ['Annual', 'BND $350', 'per year'],
    ]);
  });

  it("repeats the same prices in the page's search-result description", () => {
    const html = read('pricing/index.html');
    expect(html).toContain('BND $18');
    expect(html).toContain('BND $350');
  });
});

describe('the pricing page is wired into the build', () => {
  it('has its HTML entry, build input, sitemap URL and prerender route', () => {
    const html = read('pricing/index.html');
    expect(html).toContain('href="https://www.seduhscore.com/pricing/"');
    expect(html).toContain('/src/marketing/pricingMain.js');
    expect(html).not.toContain('noindex');
    expect(read('vite.config.js')).toMatch(
      /^\s*pricing: fileURLToPath\(new URL\('\.\/pricing\/index\.html'/m,
    );
    expect(read('public/sitemap.xml')).toContain('<loc>https://www.seduhscore.com/pricing/</loc>');

    // the markers the prerender step and the e2e smoke test look for must really be in
    // the rendered page, or those checks fail only at build/CI time
    const rendered = mount().parentElement.innerHTML;
    const smoke = read('tests/e2e/smoke.spec.js').match(/\['\/pricing\/', '([^']+)', '([^']+)'\]/);
    expect(smoke, 'smoke spec entry for /pricing/').not.toBeNull();
    expect(rendered).toContain(smoke[1]);
    expect(rendered).toContain(smoke[2]);
    const prerender = read('tools/prerender-public-pages.mjs');
    expect(prerender).toContain("output: 'pricing/index.html'");
    expect(prerender).toContain(`rootMarker: '${smoke[1]}'`);
    expect(prerender).toContain(`marker: '${smoke[2]}'`);
  });
});
