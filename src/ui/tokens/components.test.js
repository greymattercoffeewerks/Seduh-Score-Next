import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// src/ui/tokens/components.css is the ONE copy of the shared screen-chrome shapes (.card, .btn*, .form-field*,
// .field-input, .screen-feedback). Four stylesheets used to carry their own copy and drifted (one label colour
// differed, and it was source order that decided which one rendered). This keeps it to one:
//  - no other stylesheet may define one of those shapes, except the listed, reasoned exceptions;
//  - a page that links a stylesheet which relies on the shapes must link components.css, BEFORE it, so a
//    screen's own rules still win on source order;
//  - the file is not part of tokens/index.css (that is loaded by every page, including ones with their own
//    .form-field or .screen-feedback styling).

const REPO = process.cwd();
const SRC = join(REPO, 'src');
const CANONICAL = 'src/ui/tokens/components.css';

const SHAPE =
  /^\.(card|btn|btn-primary|btn-outline|form-field|form-field-label|form-field-hint|field-input|screen-feedback)(\[[^\]]*\]|:[a-z-]+(\([^)]*\))*)*$/;

function walk(dir, accept) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'dist', '.git', '.wrangler', 'android', 'supabase'].includes(name))
        continue;
      if (name.startsWith('.')) continue;
      found.push(...walk(full, accept));
    } else if (accept(name)) found.push(full);
  }
  return found;
}

const rel = (file) => relative(REPO, file).split(sep).join('/');

// Every selector a stylesheet defines (comments removed, selector lists split, at-rule blocks flattened).
function selectors(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  for (const block of text.split('}')) {
    const head = block.slice(block.lastIndexOf('{') === -1 ? 0 : 0).split('{')[0];
    const selectorText = head
      .split(';')
      .pop()
      .replace(/^[\s\S]*@media[^{]*$/, '');
    for (const part of selectorText.split(',')) {
      const selector = part.trim();
      if (selector && !selector.startsWith('@')) found.push(selector);
    }
  }
  return found;
}

// Stylesheets that legitimately define one of the shapes OTHER than the canonical file, and why.
const EXCEPTIONS = {
  // The console overrides three shapes on top of the shared ones (see its "where the admin console differs").
  'src/admin/admin.css': [".btn[aria-disabled='true']", '.field-input', '.screen-feedback:empty'],
  // Different design on purpose: these two surfaces never load components.css and style their own form field.
  'src/tools/timer/timer.css': ['.form-field', '.form-field-label'],
  'src/community/guess-the-bean/shared.css': ['.form-field', '.form-field-label'],
};

describe('the shared component shapes', () => {
  const stylesheets = walk(SRC, (name) => name.endsWith('.css'));

  it('are defined in components.css, once each', () => {
    const own = selectors(readFileSync(join(REPO, CANONICAL), 'utf8')).filter((s) => SHAPE.test(s));
    for (const required of [
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
      expect(own.filter((selector) => selector === required)).toHaveLength(1);
    }
  });

  it('are defined nowhere else, apart from the listed exceptions', () => {
    const offenders = [];
    for (const file of stylesheets) {
      const name = rel(file);
      if (name === CANONICAL) continue;
      const allowed = new Set(EXCEPTIONS[name] ?? []);
      for (const selector of selectors(readFileSync(file, 'utf8'))) {
        if (SHAPE.test(selector) && !allowed.has(selector)) offenders.push(`${name}: ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every listed exception still exists (a stale exception is a hole)', () => {
    for (const [name, wanted] of Object.entries(EXCEPTIONS)) {
      const found = selectors(readFileSync(join(REPO, name), 'utf8'));
      for (const selector of wanted) expect(found, `${name} ${selector}`).toContain(selector);
    }
  });

  it('keeps the files it must not touch out of reach: it is not part of tokens/index.css', () => {
    const index = readFileSync(join(REPO, 'src/ui/tokens/index.css'), 'utf8');
    expect(index).not.toMatch(/components\.css/);
  });

  it('the selector reader sees a plain rule, a list, and ignores comments and compound selectors', () => {
    const found = selectors(`
      /* .card { } */
      .btn, .btn-primary:hover:not(:disabled) { color: red; }
      .card.stage-row { margin: 0; }
      .btn-stop { color: red; }
    `);
    expect(found).toContain('.btn');
    expect(found.filter((s) => SHAPE.test(s))).toEqual([
      '.btn',
      '.btn-primary:hover:not(:disabled)',
    ]);
  });
});

describe('the pages that need the shapes link them first', () => {
  const pages = walk(REPO, (name) => name.endsWith('.html'));
  // Stylesheets that rely on the shared shapes being present (they style around them, or draw their markup).
  const RELIES_ON = [
    'src/formats/cup-taster/heatsScreen.css',
    'src/formats/btc/shared.css',
    'src/core/loginScreen.css',
    'src/admin/admin.css',
  ];
  const linksOf = (html) =>
    [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) =>
      m[1].replace(/^\//, ''),
    );

  it('finds the pages it is meant to police', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it('a page linking one of them also links components.css, earlier', () => {
    const offenders = [];
    let checked = 0;
    for (const page of pages) {
      const links = linksOf(readFileSync(page, 'utf8'));
      const reliant = links.filter((href) => RELIES_ON.includes(href));
      if (reliant.length === 0) continue;
      checked += 1;
      const at = links.indexOf(CANONICAL);
      const firstReliant = Math.min(...reliant.map((href) => links.indexOf(href)));
      if (at === -1 || at > firstReliant) offenders.push(rel(page));
    }
    expect(checked).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });

  it('pages that define their own form field (timer, Guess the Bean) and public pages do not link it', () => {
    for (const page of pages) {
      const name = rel(page);
      const links = linksOf(readFileSync(page, 'utf8'));
      if (
        name.startsWith('tools/') ||
        name.startsWith('guess-the-bean/') ||
        name === 'index.html' ||
        name.startsWith('results/') ||
        name.startsWith('community/')
      ) {
        expect(links, name).not.toContain(CANONICAL);
      }
    }
  });
});
