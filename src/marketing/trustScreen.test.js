import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mountTourScreen } from './tourScreen.js';
import { CONTACT_EMAIL, TRUST_LINKS, TRUST_PAGES } from './trustContent.js';
import { mountTrustScreen, renderInline } from './trustScreen.js';

// vitest runs from the repo root
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

function mount(slug) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountTrustScreen(root, slug);
  return root;
}

describe('renderInline', () => {
  const html = (text) => {
    const box = document.createElement('div');
    box.append(...renderInline(text));
    return box.innerHTML;
  };

  it('renders bold and same-site links', () => {
    expect(html('a **b** [c](/contact/)')).toBe(
      'a <strong>b</strong> <a class="trust-link" href="/contact/">c</a>',
    );
  });

  it('lets bold wrap a link', () => {
    expect(html('**[Behind](/bts/)** page')).toBe(
      '<strong><a class="trust-link" href="/bts/">Behind</a></strong> page',
    );
  });

  it('renders a mailto: link', () => {
    expect(html('[me](mailto:a@b.co)')).toContain('href="mailto:a@b.co"');
  });

  it('never turns a link to another scheme into a link, and never parses markup', () => {
    expect(html('[x](javascript:alert)')).toBe('x');
    expect(html('[x](//evil.example/)')).toBe('x');
    expect(html('[x](https://evil.example/)')).toBe('x');
    const out = html('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});

describe('mountTrustScreen', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it.each(TRUST_PAGES.map((page) => [page.slug, page]))(
    'renders the %s page with its title, lede and sections',
    (slug, page) => {
      const root = mount(slug);
      expect(root.querySelector('main.trust-article')).not.toBeNull();
      expect(root.querySelector('h1').textContent).toBe(page.name);
      expect(root.querySelector('.trust-lede').textContent).toBe(page.lede);
      expect(document.title).toBe(page.title);
      expect(root.querySelectorAll('main h2')).toHaveLength(
        page.blocks.filter((block) => block.type === 'h2').length,
      );
    },
  );

  it('throws for a page that does not exist', () => {
    expect(() => mount('nope')).toThrow(/unknown trust page/);
  });

  it('never publishes a review marker or leftover markup, anywhere on any page', () => {
    for (const { slug } of TRUST_PAGES) {
      const text = mount(slug).querySelector('main').textContent;
      // any [ALL CAPS NOTE] or [ALL CAPS: note], and the usual to-do words
      expect(text, slug).not.toMatch(/\[[A-Z][A-Z ]+[:\]]/);
      expect(text, slug).not.toMatch(/\b(TODO|FIXME|TBD|CONFIRM|VERIFY)\b/);
      // link markup that failed to render as a link would show as "](".
      expect(text, slug).not.toContain('](');
      expect(text, slug).not.toContain('**');
    }
  });

  it('uses the one contact address everywhere, as a working mailto link', () => {
    const contact = mount('contact');
    const mail = contact.querySelector('a[href^="mailto:"]');
    expect(mail.getAttribute('href')).toBe(`mailto:${CONTACT_EMAIL}`);
    expect(mail.textContent).toBe(CONTACT_EMAIL);

    for (const { slug } of TRUST_PAGES) {
      const root = mount(slug);
      // every mailto link, on every page, goes to the one address
      for (const link of root.querySelectorAll('a[href^="mailto:"]')) {
        expect(link.getAttribute('href'), slug).toBe(`mailto:${CONTACT_EMAIL}`);
      }
      // and no other address appears as text, in headings and ledes included; scanned
      // per element because textContent of the whole page would run words together
      const found = [...root.querySelectorAll('main h1, main h2, main p, main li')].flatMap(
        (node) => node.textContent.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [],
      );
      for (const address of found) expect(address, slug).toBe(CONTACT_EMAIL);
    }
  });

  it('every in-page link goes somewhere that exists', () => {
    const allowed = new Set([
      ...TRUST_LINKS.map((link) => link.href),
      '/community/',
      '/bts/',
      '/#pricing',
    ]);
    for (const { slug } of TRUST_PAGES) {
      const links = [...mount(slug).querySelectorAll('.trust-article a')];
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href.startsWith('mailto:')) continue;
        expect(allowed.has(href), `${slug} links to ${href}`).toBe(true);
      }
    }
  });

  it('shows the privacy page date, and states the two commitments the same way wherever they appear', () => {
    expect(mount('privacy').querySelector('.trust-updated').textContent).toMatch(
      /^Last updated \d+ \w+ 20\d\d$/,
    );
    // The 14-working-day deletion promise is stated on Privacy and repeated on
    // Neutrality; they must not drift apart.
    expect(mount('privacy').textContent).toContain('within 14 working days');
    expect(mount('neutrality').textContent).toContain('within 14 working days');
    expect(mount('contact').textContent).toContain('within 3 working days');
  });

  it('does not put a pricing figure or claim in the Terms', () => {
    const text = mount('terms').textContent;
    expect(text).toContain('not part of these terms');
    expect(text).not.toMatch(/\$|B\$|BND|USD|per month|free forever/i);
  });

  it('links every trust page from the footer and marks the current one', () => {
    const root = mount('privacy');
    const links = [...root.querySelectorAll('.public-footer-legal a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      TRUST_LINKS.map((link) => link.href),
    );
    const current = root.querySelectorAll('.public-footer-legal [aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/privacy/');
    expect(root.querySelector('nav[aria-label="About and legal"]')).not.toBeNull();
  });

  it('the other public pages link to the trust pages too, with none marked current', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountTourScreen(root);
    const links = root.querySelectorAll('.public-footer-legal a');
    expect(links).toHaveLength(TRUST_PAGES.length);
    expect(root.querySelector('.public-footer-legal [aria-current]')).toBeNull();
  });
});

describe('public trust pages are wired into the build', () => {
  it.each(TRUST_PAGES.map((page) => [page.slug]))(
    '%s has its HTML entry, build input, sitemap URL and prerender route',
    (slug) => {
      const html = read(`${slug}/index.html`);
      expect(html).toContain(`data-page="${slug}"`);
      expect(html).toContain(`href="https://www.seduhscore.com/${slug}/"`);
      expect(html).not.toContain('noindex');
      expect(read('vite.config.js')).toContain(`./${slug}/index.html`);
      expect(read('public/sitemap.xml')).toContain(
        `<loc>https://www.seduhscore.com/${slug}/</loc>`,
      );
      expect(read('tools/prerender-public-pages.mjs')).toContain(`['${slug}',`);
      expect(read('tests/e2e/smoke.spec.js')).toContain(`'/${slug}/'`);

      // the markers the prerender step and the e2e smoke test look for must really be in
      // the rendered page, or those checks fail only at build/CI time
      const rendered = mount(slug).innerHTML;
      const smoke = read('tests/e2e/smoke.spec.js').match(
        new RegExp(`\\['/${slug}/', '([^']+)', '([^']+)'\\]`),
      );
      expect(smoke, `smoke spec entry for ${slug}`).not.toBeNull();
      expect(rendered).toContain(smoke[1]);
      expect(rendered).toContain(smoke[2]);
      const prerender = read('tools/prerender-public-pages.mjs').match(
        new RegExp(`\\['${slug}', '([^']+)'\\]`),
      );
      expect(prerender, `prerender entry for ${slug}`).not.toBeNull();
      expect(rendered).toContain(prerender[1]);
    },
  );
});
