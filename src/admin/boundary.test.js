import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// The admin console is a sibling surface (src/admin/CLAUDE.md), held to the same boundary as src/tools/ and
// src/community/: it may import src/core/, never a format, and nothing outside src/admin/ may import it. A
// static rule cannot say this (the shared eslint rule only knows core -> formats), so this reads the files.
//
// "Nothing may import it" is the load-bearing half: the organiser console and the audience surfaces ship to
// people who must never receive admin code, and a stray import from main.js would put it in their bundle.
//
// This is a source scan with known limits: an import whose path is computed at run time from a variable it
// cannot see (it flags the template and concatenation shapes that mention "admin") and code that builds the
// words "local" + "Storage" by hand. The shipped build is checked separately by hand (module-boundary-checker
// reads dist/); keep this test's job to the shapes people actually write.

const REPO = process.cwd();
const SRC = join(REPO, 'src');

function walk(dir, accept, skip = () => false) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (skip(full, name)) continue;
    if (statSync(full).isDirectory()) files.push(...walk(full, accept, skip));
    else if (accept(name)) files.push(full);
  }
  return files;
}

// Every module path a file refers to, from every shape Vite resolves: static and re-exporting imports in any
// spacing, dynamic imports with a literal, import.meta.glob patterns, new URL(..., import.meta.url), CSS
// @import (quoted or not), and HTML script/link attributes.
export function specifiers(source) {
  const found = [];
  const add = (value) => value && found.push(value);
  for (const m of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) add(m[1]);
  for (const m of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) add(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) add(m[1]);
  for (const m of source.matchAll(/import\.meta\.glob(?:Eager)?\s*\(([^)]*)\)/g)) {
    for (const quoted of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) add(quoted[1]);
  }
  for (const m of source.matchAll(/new\s+URL\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url/g)) {
    add(m[1]);
  }
  for (const m of source.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)) add(m[1]);
  for (const m of source.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) add(m[1]);
  return found;
}

// A dynamic import whose path is built at run time and names "admin": flagged, because it cannot be resolved here.
export function computedAdminImports(source) {
  return [...source.matchAll(/\bimport\s*\(\s*(`[^`]*`|[^)]*\+[^)]*|[A-Za-z_$][^)]*)\)/g)]
    .map((m) => m[1])
    .filter((expression) => /admin/i.test(expression));
}

// Where a specifier points, as a path under src/ (null when it is a package or a URL). A leading slash is
// Vite's project root, so `/src/admin/x.js` is src/admin/x.js; anything else relative is from the file.
export function resolveUnderSrc(file, specifier) {
  let target;
  if (specifier.startsWith('/src/')) target = join(REPO, specifier);
  else if (specifier.startsWith('/'))
    return null; // another root path (e.g. /favicon.svg): not source
  else if (specifier.startsWith('.')) target = join(file, '..', specifier);
  else return null;
  const rel = relative(SRC, target).split(sep).join('/');
  return rel.startsWith('..') ? `outside/${rel}` : rel;
}

const inAdmin = (file) => relative(SRC, file).split(sep)[0] === 'admin';
const isTest = (file) => /\.test\.js$/.test(file);

describe('specifier extraction (the guard must see every shape it polices)', () => {
  const sees = (source, expected) => expect(specifiers(source)).toContain(expected);

  it('static and re-exporting imports in any spacing', () => {
    sees("import x from '../admin/a.js';", '../admin/a.js');
    sees("import{x}from'../admin/b.js'", '../admin/b.js');
    sees("export{x}from'../admin/c.js'", '../admin/c.js');
    sees("export * from '../admin/d.js'", '../admin/d.js');
    sees("import '../admin/e.js'", '../admin/e.js');
    sees("import {\n  a,\n  b,\n} from '../admin/f.js';", '../admin/f.js');
  });

  it('dynamic imports, globs, URLs, CSS imports and HTML attributes', () => {
    sees("await import('../admin/g.js')", '../admin/g.js');
    sees("import.meta.glob('../admin/*.js')", '../admin/*.js');
    sees("import.meta.glob(['../core/*.js', '../admin/*.js'], { eager: true })", '../admin/*.js');
    sees("new URL('../admin/worker.js', import.meta.url)", '../admin/worker.js');
    sees('@import "../admin/admin.css";', '../admin/admin.css');
    sees('@import url(../admin/admin.css);', '../admin/admin.css');
    sees('<script type="module" src="/src/admin/main.js"></script>', '/src/admin/main.js');
    sees('<link rel="stylesheet" href="/src/admin/admin.css" />', '/src/admin/admin.css');
  });

  it('flags a computed dynamic import that names admin', () => {
    expect(computedAdminImports('import(`../admin/${name}.js`)')).toHaveLength(1);
    expect(computedAdminImports("import('../' + 'admin/x.js')")).toHaveLength(1);
    expect(computedAdminImports('import(`../core/${name}.js`)')).toHaveLength(0);
    expect(computedAdminImports("import('../core/dom.js')")).toHaveLength(0);
  });

  it('resolves root-absolute and relative paths to the same place', () => {
    const file = join(SRC, 'core', 'x.js');
    expect(resolveUnderSrc(file, '/src/admin/console.js')).toBe('admin/console.js');
    expect(resolveUnderSrc(file, '../admin/console.js')).toBe('admin/console.js');
    expect(resolveUnderSrc(file, './dom.js')).toBe('core/dom.js');
    expect(resolveUnderSrc(file, '/favicon.svg')).toBeNull();
    expect(resolveUnderSrc(file, 'otplib')).toBeNull();
    expect(resolveUnderSrc(file, '../../admin/index.html')).toBe('outside/../admin/index.html');
  });
});

describe('the admin module boundary', { timeout: 30000 }, () => {
  const all = walk(SRC, (name) => /\.(js|mjs|css|html)$/.test(name));
  // Every HTML entry in the repo: they name their scripts and styles by root path.
  const htmlEntries = walk(
    REPO,
    (name) => name.endsWith('.html'),
    (full, name) =>
      ['node_modules', 'dist', '.git', '.wrangler', 'android', 'supabase', 'test-results'].includes(
        name,
      ) || name.startsWith('.'),
  );

  it('finds the files it is meant to police', () => {
    expect(all.filter(inAdmin).length).toBeGreaterThan(8);
    expect(all.filter((file) => !inAdmin(file)).length).toBeGreaterThan(100);
    expect(htmlEntries.length).toBeGreaterThan(10);
  });

  it('nothing outside src/admin/ refers to src/admin/ (source, styles or HTML)', () => {
    const offenders = [];
    const outsideSource = all.filter((file) => !inAdmin(file));
    const outsideHtml = htmlEntries.filter(
      (file) => relative(REPO, file).split(sep)[0] !== 'admin' && !all.includes(file),
    );
    for (const file of [...outsideSource, ...outsideHtml]) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of specifiers(source)) {
        const target = resolveUnderSrc(file, specifier);
        if (target !== null && (target === 'admin' || target.startsWith('admin/'))) {
          offenders.push(`${relative(REPO, file)} -> ${specifier}`);
        }
      }
      // The admin console's own HTML entry lives at the repo root (admin/index.html), not under src/.
      for (const specifier of specifiers(source)) {
        if (/^\.{1,2}\/(?:\.\.\/)*admin\/index\.html$/.test(specifier)) {
          offenders.push(`${relative(REPO, file)} -> ${specifier}`);
        }
      }
      if (isTest(file)) continue;
      for (const expression of computedAdminImports(source)) {
        offenders.push(`${relative(REPO, file)} -> computed import(${expression})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/admin/ imports src/core/ and itself, never a format or another surface', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of specifiers(source)) {
        const target = resolveUnderSrc(file, specifier);
        if (target === null) continue; // packages, URLs and /favicon.svg-style root files
        const top = target.split('/')[0];
        if (top !== 'admin' && top !== 'core')
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
      }
      if (!isTest(file)) {
        for (const expression of computedAdminImports(source)) {
          offenders.push(`${relative(SRC, file)} -> computed import(${expression})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only adminClient.js builds a Supabase client in src/admin/ (it has its own, spec D-A15)', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      if (isTest(file) || file.endsWith('adminClient.js')) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      if (/@supabase\/supabase-js|\bcreateClient\b|\bgetSupabase\b/.test(source)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/admin/ never reads or writes localStorage (the organiser session lives there)', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      if (isTest(file)) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      if (/\blocalStorage\b/.test(source)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
