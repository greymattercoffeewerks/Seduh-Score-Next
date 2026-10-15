import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

// src/ui/tokens/components.css is the ONE copy of the shared screen-chrome shapes (.screen-container, .card,
// .btn*, .form-field*, .field-input, .screen-feedback). Four stylesheets used to carry their own copy and
// drifted (one label colour differed, and source order decided which one rendered). This keeps it to one:
//  - no other stylesheet, and no inline <style>, may define a selector that components.css defines, except the
//    listed, reasoned exceptions;
//  - a page that links a stylesheet which RELIES on the shapes (its selectors mention their classes) must link
//    components.css, BEFORE it, so a screen's own rules still win on source order;
//  - the pages that must NOT get it (they have their own look for these classes) do not link it;
//  - the file is not part of tokens/index.css (that is loaded by every page).
// The reader below sees nested at-rules (@media, @supports), any link attribute order and quoting, and @import.

const REPO = process.cwd();
const CANONICAL = 'src/ui/tokens/components.css';
const SKIP_DIRS = [
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  'android',
  'supabase',
  'test-results',
];

function walk(dir, accept) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.includes(name) || name.startsWith('.')) continue;
      found.push(...walk(full, accept));
    } else if (accept(name)) found.push(full);
  }
  return found;
}

const rel = (file) => relative(REPO, file).split(sep).join('/');
const read = (file) => readFileSync(file, 'utf8');

// ---- CSS reading ----

const normalise = (selector) =>
  selector
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .trim();

// Every selector a stylesheet defines, with comments removed, selector lists split, and the rules inside
// @media / @supports / @layer blocks included. Declaration blocks, @font-face and @keyframes are skipped.
export function selectors(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  let i = 0;
  let start = 0;
  const skipBlock = () => {
    let depth = 1;
    i += 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
  };
  while (i < text.length) {
    const char = text[i];
    if (char === ';') {
      start = i + 1;
      i += 1;
    } else if (char === '}') {
      start = i + 1;
      i += 1;
    } else if (char === '{') {
      const prelude = text.slice(start, i).trim();
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container|scope)\b/.test(prelude)) {
          // descend: the rules inside are ordinary rules
          i += 1;
          start = i;
        } else {
          skipBlock();
          start = i;
        }
      } else {
        for (const part of prelude.split(',')) {
          const selector = normalise(part);
          if (selector) found.push(selector);
        }
        skipBlock();
        start = i;
      }
    } else i += 1;
  }
  return found;
}

// The class names the canonical file defines (".card", ".btn-primary", ...), for "relies on" detection.
const classesOf = (selectorList) =>
  new Set(selectorList.flatMap((s) => [...s.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1])));

// ---- HTML reading ----

function attributes(tag) {
  const found = {};
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return found;
}

// Stylesheet files a page links, in order, as repo-relative paths (a root path or a path from the page).
export function linkedStylesheets(html, pageFile) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(m[0]);
    if (!/(^|\s)stylesheet(\s|$)/i.test(attrs.rel ?? '') || !attrs.href) continue;
    if (/^[a-z]+:\/\//i.test(attrs.href)) continue;
    const href = attrs.href.split('#')[0].split('?')[0];
    out.push(
      href.startsWith('/')
        ? href.slice(1)
        : relative(REPO, join(dirname(pageFile), href))
            .split(sep)
            .join('/'),
    );
  }
  return out;
}

// What the page ends up loading, in cascade order: each linked sheet after the sheets it @imports.
function effectiveSheets(page, html) {
  const order = [];
  const visit = (sheet) => {
    if (order.includes(sheet)) return;
    let css = '';
    try {
      css = read(join(REPO, sheet));
    } catch {
      order.push(sheet);
      return;
    }
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)) {
      const target = m[1].startsWith('/')
        ? m[1].slice(1)
        : relative(REPO, join(dirname(join(REPO, sheet)), m[1]))
            .split(sep)
            .join('/');
      visit(target);
    }
    order.push(sheet);
  };
  for (const sheet of linkedStylesheets(html, page)) visit(sheet);
  return order;
}

function inlineStyles(html) {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

// ---- policy ----

// Stylesheets that legitimately define a selector the canonical file also defines, and why.
const EXCEPTIONS = {
  // The console overrides two shapes on top of the shared ones (see its "where the admin console differs").
  'src/admin/admin.css': ["'.btn[aria-disabled='true']'", '.field-input'].map((s) =>
    s.replace(/^'|'$/g, ''),
  ),
  // Different design on purpose: these two surfaces never load components.css and style their own form field.
  'src/tools/timer/timer.css': ['.form-field', '.form-field-label'],
  'src/community/guess-the-bean/shared.css': ['.form-field', '.form-field-label'],
};
const exceptionSelectors = (name) => new Set((EXCEPTIONS[name] ?? []).map(normalise));

// Surfaces whose CSS is self-contained and which must never get the shared file.
const MUST_NOT_LINK = (name) =>
  name === 'index.html' ||
  /^(tools|guess-the-bean|community|results|tour|about|contact|privacy|terms|neutrality)\//.test(
    name,
  );

// Stylesheets in these places style their own markup and are not "relying" on the shared shapes.
const SELF_CONTAINED = (name) => /^src\/(tools|community|marketing)\//.test(name);

const canonicalText = read(join(REPO, CANONICAL));
const canonicalSelectors = selectors(canonicalText);
const canonicalSet = new Set(canonicalSelectors);
const canonicalClasses = classesOf(canonicalSelectors);

describe('the selector reader', () => {
  it('sees a plain rule, a list across lines, and ignores comments and declaration text', () => {
    const found = selectors(`
      /* .card { } */
      .btn,
      .btn-primary:hover:not(:disabled) { color: red; background: url("a{b}c"); }
      .card.stage-row { margin: 0; }
    `);
    expect(found).toEqual(['.btn', '.btn-primary:hover:not(:disabled)', '.card.stage-row']);
  });

  it('sees EVERY rule inside @media and @supports, including the first, and skips @font-face and @keyframes', () => {
    const found = selectors(`
      .a { x: y }
      @media (min-width: 600px) { .btn { color: red; } .card { margin: 0 } }
      @supports (display: grid) { .field-input { color: red } }
      @font-face { font-family: x; src: url(y) }
      @keyframes spin { from { transform: none } to { transform: none } }
      .z { x: y }
    `);
    expect(found).toEqual(['.a', '.btn', '.card', '.field-input', '.z']);
  });

  it('normalises quotes, spacing and combinators so two spellings compare equal', () => {
    expect(selectors(`.screen-feedback[data-tone="error"]{x:y}`)).toEqual(
      selectors(`.screen-feedback[data-tone='error']  { x: y }`),
    );
    expect(selectors('.card>.btn{x:y}')).toEqual(['.card > .btn']);
  });
});

// The declarations of the FIRST rule whose selector list contains `selector`, as 'property: value' pairs.
function declarationsOf(css, selector) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(normalise).includes(normalise(selector))) {
      return Object.fromEntries(
        m[2]
          .split(';')
          .map((d) => d.split(/:(.*)/s))
          .filter(([k, v]) => k?.trim() && v?.trim())
          .map(([k, v]) => [k.trim(), v.trim().replace(/\s+/g, ' ')]),
      );
    }
  }
  return null;
}

describe('the declaration reader', () => {
  it('reads a rule found by any selector in its list', () => {
    expect(declarationsOf('.a,\n.b { color: red; margin: 0 auto; }', '.b')).toEqual({
      color: 'red',
      margin: '0 auto',
    });
    expect(declarationsOf('.a { x: y }', '.zzz')).toBeNull();
  });
});

describe('the empty message region', () => {
  const rule = declarationsOf(canonicalText, '.screen-feedback:empty');

  it('is NOT display:none (a live region that is not in the accessibility tree while empty may stay silent)', () => {
    expect(rule).not.toBeNull();
    expect(rule.display).toBe('block');
  });

  it('takes no room: out of the flow, one pixel, clipped, no padding or border', () => {
    expect(rule.position).toBe('absolute');
    expect(rule.width).toBe('1px');
    expect(rule.height).toBe('1px');
    expect(rule.padding).toBe('0');
    expect(rule.border).toBe('0');
    expect(rule.overflow).toBe('hidden');
    expect(rule.clip).toMatch(/^rect\(0, ?0, ?0, ?0\)$/);
  });
});

describe('the link reader', () => {
  const page = join(REPO, 'app', 'index.html');
  it('sees any attribute order and quoting, absolute and relative paths, and ignores non-stylesheets', () => {
    const html = `
      <link rel="stylesheet" href="/src/a.css" />
      <link href="/src/b.css" rel="stylesheet">
      <link rel='stylesheet' href='/src/c.css'>
      <LINK REL=stylesheet HREF=/src/d.css>
      <link rel="stylesheet" href="../src/e.css?v=1">
      <link rel="icon" href="/favicon.svg">
      <link rel="stylesheet" href="https://example.test/x.css">
    `;
    expect(linkedStylesheets(html, page)).toEqual([
      'src/a.css',
      'src/b.css',
      'src/c.css',
      'src/d.css',
      'src/e.css',
    ]);
  });

  it('follows @import so a shape pulled in through another sheet is still seen', () => {
    const order = effectiveSheets(
      join(REPO, 'admin', 'index.html'),
      '<link rel="stylesheet" href="/src/ui/tokens/index.css">',
    );
    expect(order).toContain('src/ui/tokens/base.css');
    expect(order.indexOf('src/ui/tokens/base.css')).toBeLessThan(
      order.indexOf('src/ui/tokens/index.css'),
    );
  });
});

describe('the shared component shapes', () => {
  const stylesheets = walk(join(REPO, 'src'), (name) => name.endsWith('.css'));
  const pages = walk(REPO, (name) => name.endsWith('.html'));

  it('are defined in components.css, once each', () => {
    for (const required of [
      '.screen-container',
      '.screen-container h1',
      '.screen-container h2',
      '.card',
      '.card:focus-visible',
      '.btn',
      '.btn-primary',
      '.btn-outline',
      '.form-field',
      '.form-field-label',
      '.form-field-hint',
      '.field-input',
      '.screen-feedback',
      '.screen-feedback:empty',
      ".screen-feedback[data-tone='error']",
      ".screen-feedback[data-tone='success']",
      ".screen-feedback[data-tone='pending']",
      ".screen-feedback[data-tone='urgent']",
    ]) {
      expect(
        canonicalSelectors.filter((selector) => selector === required),
        required,
      ).toHaveLength(1);
    }
  });

  it('are defined in no other stylesheet, apart from the listed exceptions', () => {
    const offenders = [];
    for (const file of stylesheets) {
      const name = rel(file);
      if (name === CANONICAL) continue;
      const allowed = exceptionSelectors(name);
      for (const selector of selectors(read(file))) {
        if (canonicalSet.has(selector) && !allowed.has(selector))
          offenders.push(`${name}: ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('are defined in no inline <style> of a page that links them (standalone pages with their own look, design/ mockups and public/bts, are out of scope)', () => {
    const offenders = [];
    for (const page of pages) {
      const html = read(page);
      if (!effectiveSheets(page, html).includes(CANONICAL)) continue;
      for (const css of inlineStyles(html)) {
        for (const selector of selectors(css)) {
          if (canonicalSet.has(selector)) offenders.push(`${rel(page)}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every listed exception still exists (a stale exception is a hole)', () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      const found = selectors(read(join(REPO, name)));
      for (const selector of exceptionSelectors(name))
        expect(found, `${name} ${selector}`).toContain(selector);
    }
  });

  it('are not part of tokens/index.css', () => {
    expect(read(join(REPO, 'src/ui/tokens/index.css'))).not.toMatch(/components\.css/);
  });
});

describe('the pages that rely on the shapes link them first', () => {
  const pages = walk(REPO, (name) => name.endsWith('.html'));
  // Which stylesheets rely on the shapes: any whose selectors mention a class the canonical file defines
  // (a compound or descendant rule such as `.card.stage-row`, `.timing-screen .btn`, counts), apart from the
  // self-contained surfaces and the canonical file itself.
  const sheets = walk(join(REPO, 'src'), (name) => name.endsWith('.css')).map(rel);
  const relies = new Set(
    sheets.filter((name) => {
      if (name === CANONICAL || SELF_CONTAINED(name)) return false;
      return selectors(read(join(REPO, name))).some((selector) =>
        [...selector.matchAll(/\.([a-z][a-z0-9-]*)/gi)].some((m) => canonicalClasses.has(m[1])),
      );
    }),
  );

  it('finds the pages and the reliant stylesheets it is meant to police', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(relies.size).toBeGreaterThan(10);
    for (const known of [
      'src/formats/cup-taster/heatsScreen.css',
      'src/formats/btc/scoringScreen.css',
      'src/core/loginScreen.css',
      'src/core/eventsScreen.css',
      'src/admin/admin.css',
    ]) {
      expect(relies.has(known), known).toBe(true);
    }
  });

  it('a page loading one of them links components.css, earlier', () => {
    const offenders = [];
    let checked = 0;
    for (const page of pages) {
      const name = rel(page);
      if (MUST_NOT_LINK(name)) continue;
      const order = effectiveSheets(page, read(page));
      const reliant = order.filter((sheet) => relies.has(sheet));
      if (reliant.length === 0) continue;
      checked += 1;
      const at = order.indexOf(CANONICAL);
      const firstReliant = Math.min(...reliant.map((sheet) => order.indexOf(sheet)));
      if (at === -1 || at > firstReliant)
        offenders.push(`${name} (first reliant: ${order[firstReliant]})`);
    }
    expect(checked).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });

  it('the token preview page links it (it renders the shapes with no stylesheet of its own to prove it)', () => {
    const page = join(REPO, 'src/ui/tokens/preview.html');
    expect(linkedStylesheets(read(page), page)).toContain(CANONICAL);
  });

  it('the pages with their own look (and every public page) do not link it', () => {
    let checked = 0;
    for (const page of pages) {
      const name = rel(page);
      if (!MUST_NOT_LINK(name)) continue;
      checked += 1;
      expect(effectiveSheets(page, read(page)), name).not.toContain(CANONICAL);
    }
    expect(checked).toBeGreaterThan(10);
  });
});
