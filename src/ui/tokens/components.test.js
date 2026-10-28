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
//  - the exact set of pages that link it is pinned, so one dropping out is a visible edit, not a silent one;
//  - the file is not part of tokens/index.css (that is loaded by every page).
//
// The readers FAIL CLOSED: CSS they cannot read faithfully (nested rules, an unbalanced block) throws instead of
// being skipped, because a skipped rule is a copy of a shape this test would never see. They see nested at-rules
// (@media, @supports, @layer, @starting-style, ...), selector lists with commas inside :is()/:where(), strings
// containing braces, any link attribute order and quoting, @import chains, and ignore commented-out CSS/HTML.

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
  // Gitignored local scratch, never in CI: rendered films/scenes that link the app's stylesheets in their own
  // order. Scanned, they fail the "links components.css first" check on any machine that has run them.
  'brag-output',
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
const fileCache = new Map();
const read = (file) => {
  if (!fileCache.has(file)) fileCache.set(file, readFileSync(file, 'utf8'));
  return fileCache.get(file);
};
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// ---- CSS reading ----

// One spelling per selector: single quotes, one space, spaced combinators, quoted attribute values.
export const normalise = (selector) =>
  selector
    .replace(
      /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/g,
      (_all, name, op, a, b, c) => (op ? `[${name}${op}'${a ?? b ?? c}']` : `[${name}]`),
    )
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .trim();

// A selector list split on the commas that separate selectors, not the ones inside :is(.a, .b), :where(...),
// :not(...) or an attribute value.
export function splitSelectorList(prelude) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const char of prelude) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// A selector that is only a :is(...) or :where(...) list is those selectors in disguise: `:where(.btn-primary, .x)`
// styles `.btn-primary` exactly as `.btn-primary` does, so it is read as the alternatives (recursively).
function flatten(selector) {
  const m = /^:(?:is|where|matches)\((.*)\)$/s.exec(selector);
  if (!m) return [selector];
  // the closing parenthesis must be the one that matches the opening one (not `:is(.a) .b:is(.c)`)
  let depth = 0;
  for (let k = 0; k < selector.length; k += 1) {
    if (selector[k] === '(') depth += 1;
    else if (selector[k] === ')') {
      depth -= 1;
      if (depth === 0 && k !== selector.length - 1) return [selector];
    }
  }
  return splitSelectorList(m[1]).flatMap((part) => flatten(normalise(part)));
}

// At-rules whose block is NOT a list of style rules.
const OPAQUE_AT_RULES =
  /^@(font-face|keyframes|-webkit-keyframes|page|property|counter-style|font-feature-values|font-palette-values|view-transition)\b/;

// Every selector a stylesheet defines, comments removed, lists split, and the rules inside any other at-rule
// block (@media, @supports, @layer, @container, @starting-style, ...) included. Throws on CSS it cannot read
// faithfully: a rule nested inside another rule (`&`, nested selectors), or a block that is never closed.
export function selectors(css) {
  const text = stripCssComments(css);
  const found = [];
  let i = 0;
  let start = 0;
  // Advances past a string (so a `{` or `}` inside it is not structure).
  const skipString = () => {
    const quote = text[i];
    i += 1;
    while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    i += 1;
  };
  // Advances past the block whose `{` is at text[i]. `allowNested` is for @keyframes and the like.
  const skipBlock = (allowNested) => {
    let depth = 1;
    i += 1;
    while (i < text.length && depth > 0) {
      const char = text[i];
      if (char === '"' || char === "'") {
        skipString();
        continue;
      }
      if (char === '{') {
        if (!allowNested) {
          throw new Error(
            `nested CSS near "${text.slice(Math.max(0, i - 40), i).trim()}": flatten it`,
          );
        }
        depth += 1;
      } else if (char === '}') depth -= 1;
      i += 1;
    }
    if (depth !== 0) throw new Error('a CSS block is never closed');
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") skipString();
    else if (char === ';' || char === '}') {
      i += 1;
      start = i;
    } else if (char === '{') {
      const prelude = text.slice(start, i).trim();
      if (prelude.startsWith('@')) {
        if (OPAQUE_AT_RULES.test(prelude)) {
          skipBlock(true);
          start = i;
        } else {
          // descend: the rules inside are ordinary rules
          i += 1;
          start = i;
        }
      } else {
        for (const part of splitSelectorList(prelude)) {
          const selector = normalise(part);
          if (selector) found.push(...flatten(selector));
        }
        skipBlock(false);
        start = i;
      }
    } else i += 1;
  }
  return found;
}

// The class names a list of selectors mentions (quoted attribute values excluded), for "relies on" detection.
const classesIn = (selector) =>
  [...selector.replace(/(["']).*?\1/g, '').matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]);
const classesOf = (selectorList) => new Set(selectorList.flatMap(classesIn));

// The declarations of the FIRST rule whose selector list contains `selector`, as property -> value.
export function declarationsOf(css, selector) {
  const text = stripCssComments(css);
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (splitSelectorList(m[1]).map(normalise).includes(normalise(selector))) {
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

// ---- HTML reading ----

function attributes(tag) {
  const found = {};
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return found;
}

// Stylesheet files a page links, in order, as repo-relative paths (a root path or a path from the page).
// A link inside an HTML comment does not load anything, so it is not seen.
export function linkedStylesheets(html, pageFile) {
  const out = [];
  for (const m of stripHtmlComments(html).matchAll(/<link\b[^>]*>/gi)) {
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

// What the page ends up loading, in cascade order: each linked sheet after the sheets it @imports (an @import
// inside a CSS comment imports nothing).
export function effectiveSheets(page, html, readSheet = (sheet) => read(join(REPO, sheet))) {
  // one shared walk per page: the sheets a page loads in cascade order
  const order = [];
  const visit = (sheet) => {
    if (order.includes(sheet)) return;
    let css = '';
    try {
      css = readSheet(sheet);
    } catch {
      order.push(sheet);
      return;
    }
    for (const m of stripCssComments(css).matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)) {
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
  return [...stripHtmlComments(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (m) => m[1],
  );
}

// ---- policy ----

// Stylesheets that legitimately define a selector the canonical file also defines, and why.
const EXCEPTIONS = {
  // The console overrides two shapes on top of the shared ones (see its "where the admin console differs").
  'src/admin/admin.css': [".btn[aria-disabled='true']", '.field-input'],
  // Different design on purpose: these two surfaces never load components.css and style their own form field.
  'src/tools/timer/timer.css': ['.form-field', '.form-field-label'],
  'src/community/guess-the-bean/shared.css': ['.form-field', '.form-field-label'],
};
const exceptionSelectors = (name) => new Set((EXCEPTIONS[name] ?? []).map(normalise));

// Surfaces whose CSS is self-contained and which must never get the shared file.
const MUST_NOT_LINK = (name) =>
  name === 'index.html' ||
  /^(tools|guess-the-bean|community|results|tour|about|contact|privacy|terms|neutrality|public|design)\//.test(
    name,
  );

// Stylesheets in these places style their own markup and are not "relying" on the shared shapes.
const SELF_CONTAINED = (name) => /^src\/(tools|community|marketing)\//.test(name);

// EVERY page that links components.css. Adding a page that renders the shapes means adding it here (and a page
// dropping out of this list, by accident, fails the test instead of passing quietly).
const PAGES_THAT_LINK_IT = [
  'admin/index.html',
  'app/index.html',
  'src/core/brandSlot.preview.html',
  'src/core/viewer-shell.preview.html',
  'src/formats/btc/bracketScreen.preview.html',
  'src/formats/btc/eventDashboardScreen.preview.html',
  'src/formats/btc/matchesScreen.preview.html',
  'src/formats/btc/projectorSurface.preview.html',
  'src/formats/btc/scoringScreen.preview.html',
  'src/formats/btc/setupScreen.preview.html',
  'src/formats/btc/standingsScreen.preview.html',
  'src/formats/btc/viewerBody.preview.html',
  'src/formats/cup-taster/heatsScreen.preview.html',
  'src/formats/cup-taster/phoneSummary.preview.html',
  'src/formats/cup-taster/projectorSurface.preview.html',
  'src/formats/cup-taster/reportScreen.preview.html',
  'src/formats/cup-taster/rosterScreen.preview.html',
  'src/formats/cup-taster/scoringScreen.preview.html',
  'src/formats/cup-taster/setupScreen.preview.html',
  'src/formats/cup-taster/standingsScreen.preview.html',
  'src/formats/cup-taster/timingManualScreen.preview.html',
  'src/formats/cup-taster/timingScreen.preview.html',
  'src/ui/tokens/preview.html',
];

const selectorCache = new Map();
const selectorsOfFile = (file) => {
  if (!selectorCache.has(file)) selectorCache.set(file, selectors(read(file)));
  return selectorCache.get(file);
};

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

  it('sees EVERY rule inside @media, @supports, @layer and @starting-style, and skips @font-face and @keyframes', () => {
    const found = selectors(`
      .a { x: y }
      @media (min-width: 600px) { .btn { color: red; } .card { margin: 0 } }
      @supports (display: grid) { .field-input { color: red } }
      @layer base { .form-field { color: red } }
      @starting-style { .screen-feedback { opacity: 0 } }
      @font-face { font-family: x; src: url(y) }
      @keyframes spin { from { transform: none } to { transform: none } }
      .z { x: y }
    `);
    expect(found).toEqual([
      '.a',
      '.btn',
      '.card',
      '.field-input',
      '.form-field',
      '.screen-feedback',
      '.z',
    ]);
  });

  it('does not split a selector on the commas inside :is(), :where(), :not() or an attribute value', () => {
    expect(selectors('.a:is(.b, .c) .d, .e[title="x,y"] { x: y }')).toEqual([
      '.a:is(.b, .c) .d',
      ".e[title='x,y']",
    ]);
  });

  it('reads a selector that IS an :is()/:where() list as its alternatives (it styles them exactly as they would be)', () => {
    expect(selectors(':where(.btn-primary, .x) { color: red }')).toEqual(['.btn-primary', '.x']);
    expect(selectors(':is(.a, :where(.b, .c)) { x: y }')).toEqual(['.a', '.b', '.c']);
    // but a list inside a larger selector is left alone
    expect(selectors(':is(.a) .b:is(.c, .d) { x: y }')).toEqual([':is(.a) .b:is(.c, .d)']);
  });

  it('is not fooled by a brace or a semicolon inside a string', () => {
    expect(selectors('.probe { content: "{"; } .card { x: y }')).toEqual(['.probe', '.card']);
    expect(selectors(".probe { content: '}'; } .btn { x: y }")).toEqual(['.probe', '.btn']);
    expect(selectors('.a[data-x="{"] { y: z } .card { x: y }')).toEqual([
      ".a[data-x='{']",
      '.card',
    ]);
  });

  it('normalises quotes, attribute spelling, spacing and combinators so two spellings compare equal', () => {
    const spellings = [
      `.screen-feedback[data-tone="error"]{x:y}`,
      `.screen-feedback[data-tone='error']  { x: y }`,
      `.screen-feedback[data-tone=error] { x: y }`,
      `.screen-feedback[ data-tone = "error" ] { x: y }`,
    ].map(selectors);
    for (const spelling of spellings)
      expect(spelling).toEqual([".screen-feedback[data-tone='error']"]);
    expect(selectors('.card>.btn{x:y}')).toEqual(['.card > .btn']);
    expect(selectors('.card[hidden]{x:y}')).toEqual(['.card[hidden]']);
  });

  it('FAILS CLOSED on CSS it cannot read faithfully, instead of skipping the rule', () => {
    expect(() => selectors('.timing-screen { & .card { color: red } }')).toThrow(/nested CSS/);
    expect(() => selectors('.timing-screen { .card { color: red } }')).toThrow(/nested CSS/);
    expect(() => selectors('.a { color: red ')).toThrow(/never closed/);
  });
});

describe('the declaration reader', () => {
  it('reads a rule found by any selector in its list, including inside :is()', () => {
    expect(declarationsOf('.a,\n.b { color: red; margin: 0 auto; }', '.b')).toEqual({
      color: 'red',
      margin: '0 auto',
    });
    expect(declarationsOf(':is(.a, .b), .c { x: y }', '.c')).toEqual({ x: 'y' });
    expect(declarationsOf('.a { x: y }', '.zzz')).toBeNull();
  });
});

describe('the empty message region', () => {
  const rule = declarationsOf(canonicalText, '.screen-feedback:empty');

  it('stays in the accessibility tree: not display:none, not visibility:hidden, not hidden by content-visibility', () => {
    expect(rule).not.toBeNull();
    expect(rule.display).toBe('block');
    expect(rule.visibility ?? 'visible').not.toBe('hidden');
    expect(rule['content-visibility'] ?? 'visible').not.toBe('hidden');
    expect(rule.opacity ?? '1').not.toBe('0');
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

  it('ignores a link inside an HTML comment (it loads nothing)', () => {
    const html = `
      <!-- <link rel="stylesheet" href="/src/old.css"> -->
      <link rel="stylesheet" href="/src/real.css">
      <!--
        <link rel="stylesheet" href="/src/also-old.css">
      -->
    `;
    expect(linkedStylesheets(html, page)).toEqual(['src/real.css']);
  });

  it('follows @import so a shape pulled in through another sheet is still seen, and ignores a commented one', () => {
    const sheets = {
      'src/x/index.css': "@import './a.css'; /* @import './commented.css'; */\n.x { y: z }",
      'src/x/a.css': '.a { b: c }',
    };
    const order = effectiveSheets(
      join(REPO, 'admin', 'index.html'),
      '<link rel="stylesheet" href="/src/x/index.css">',
      (sheet) => {
        if (!(sheet in sheets)) throw new Error('missing');
        return sheets[sheet];
      },
    );
    expect(order).toEqual(['src/x/a.css', 'src/x/index.css']);
  });

  it('on the real repository, the tokens entry pulls in its base sheet first', () => {
    const order = effectiveSheets(
      join(REPO, 'admin', 'index.html'),
      '<link rel="stylesheet" href="/src/ui/tokens/index.css">',
    );
    expect(order.indexOf('src/ui/tokens/base.css')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('src/ui/tokens/base.css')).toBeLessThan(
      order.indexOf('src/ui/tokens/index.css'),
    );
  });

  it('reads <style> blocks, and not a commented-out one', () => {
    expect(inlineStyles('<style>.a{b:c}</style><!-- <style>.d{e:f}</style> -->')).toEqual([
      '.a{b:c}',
    ]);
  });
});

describe('the shared component shapes', { timeout: 30000 }, () => {
  // Every stylesheet in the repository, wherever it lives.
  const stylesheets = walk(REPO, (name) => name.endsWith('.css'));
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
      for (const selector of selectorsOfFile(file)) {
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

  it('every listed exception still exists in its file AND is still something components.css defines (a stale exception is a hole)', () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      const found = selectors(read(join(REPO, name)));
      for (const selector of exceptionSelectors(name)) {
        expect(found, `${name} ${selector}`).toContain(selector);
        expect(
          canonicalSet.has(selector),
          `${name} ${selector} is not in components.css any more`,
        ).toBe(true);
      }
    }
  });

  it('are not part of tokens/index.css', () => {
    expect(read(join(REPO, 'src/ui/tokens/index.css'))).not.toMatch(/components\.css/);
  });
});

describe('the pages that rely on the shapes link them first', { timeout: 30000 }, () => {
  const pages = walk(REPO, (name) => name.endsWith('.html'));
  // Which stylesheets rely on the shapes: any whose selectors mention a class the canonical file defines
  // (a compound or descendant rule such as `.card.stage-row`, `.timing-screen .btn`, counts), apart from the
  // self-contained surfaces and the canonical file itself.
  const sheets = walk(REPO, (name) => name.endsWith('.css')).map(rel);
  const relies = new Set(
    sheets.filter((name) => {
      if (name === CANONICAL || SELF_CONTAINED(name)) return false;
      return selectorsOfFile(join(REPO, name)).some((selector) =>
        classesIn(selector).some((cls) => canonicalClasses.has(cls)),
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
      'src/core/viewer-shell.css',
      'src/admin/admin.css',
    ]) {
      expect(relies.has(known), known).toBe(true);
    }
  });

  it('a page loading one of them links components.css, earlier', () => {
    const offenders = [];
    for (const page of pages) {
      const name = rel(page);
      if (MUST_NOT_LINK(name)) continue;
      const order = effectiveSheets(page, read(page));
      const reliant = order.filter((sheet) => relies.has(sheet));
      if (reliant.length === 0) continue;
      const at = order.indexOf(CANONICAL);
      const firstReliant = Math.min(...reliant.map((sheet) => order.indexOf(sheet)));
      if (at === -1 || at > firstReliant)
        offenders.push(`${name} (first reliant: ${order[firstReliant]})`);
    }
    expect(offenders).toEqual([]);
  });

  it('exactly these pages link it (update PAGES_THAT_LINK_IT in this file when a page that renders the shapes is added or removed)', () => {
    const linking = pages
      .filter((page) => effectiveSheets(page, read(page)).includes(CANONICAL))
      .map(rel)
      .sort();
    expect(linking).toEqual([...PAGES_THAT_LINK_IT].sort());
  });

  it('the token preview page links it (it renders the shapes with no stylesheet of its own to prove it)', () => {
    const page = join(REPO, 'src/ui/tokens/preview.html');
    expect(linkedStylesheets(read(page), page)).toContain(CANONICAL);
  });

  it('the pages with their own look (and every public or design page) do not link it', () => {
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
