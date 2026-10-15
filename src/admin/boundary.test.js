import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// The admin console is a sibling surface (src/admin/CLAUDE.md), held to the same boundary as src/tools/ and
// src/community/: it may import src/core/, never a format, and nothing outside src/admin/ may import it. A
// static rule cannot say this (the shared eslint rule only knows core -> formats), so this reads the files.
//
// "Nothing may import it" is the load-bearing half: the organiser console and the audience surfaces ship to
// people who must never receive admin code, and a stray import from main.js would put it in their bundle.

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(js|mjs|css|html)$/.test(name)) files.push(full);
  }
  return files;
}

// Every module specifier a file imports: static imports, dynamic imports, and CSS @import.
function specifiers(source) {
  const found = [];
  const patterns = [
    /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function resolveInto(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  return relative(SRC, join(file, '..', specifier))
    .split(sep)
    .join('/');
}

describe('the admin module boundary', () => {
  const all = sourceFiles(SRC);
  const inAdmin = (file) => relative(SRC, file).split(sep)[0] === 'admin';

  it('finds the files it is meant to police', () => {
    expect(all.filter(inAdmin).length).toBeGreaterThan(8);
    expect(all.filter((file) => !inAdmin(file)).length).toBeGreaterThan(100);
  });

  it('nothing outside src/admin/ imports from src/admin/', () => {
    const offenders = [];
    for (const file of all.filter((f) => !inAdmin(f))) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        const target = resolveInto(file, specifier);
        if (target !== null && (target === 'admin' || target.startsWith('admin/'))) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/admin/ imports src/core/ and itself, never a format or another surface', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) continue; // packages and bare ids are not this rule's business
        const target = resolveInto(file, specifier);
        const top = target.split('/')[0];
        if (top !== 'admin' && top !== 'core')
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/admin/ never uses the shared Supabase client (it has its own, spec D-A15)', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      if (file.endsWith('.test.js')) continue;
      const source = readFileSync(file, 'utf8');
      if (/\bgetSupabase\b/.test(source.replace(/\/\/.*$/gm, '')))
        offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('src/admin/ never reads or writes localStorage (the organiser session lives there)', () => {
    const offenders = [];
    for (const file of all.filter(inAdmin)) {
      if (file.endsWith('.test.js')) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      if (/\blocalStorage\b/.test(source)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
