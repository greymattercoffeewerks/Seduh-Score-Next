import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// The rule for reusing a format's competition logic outside the format (owner, 2026-11-28; CONVENTIONS.md, "The module
// boundary"): a tool or another surface under src/tools, src/community or src/marketing MAY import a format's PURE logic
// module (read-only calculation: no database, network, auth, storage or other side effects), never its data-writing,
// RPC or screen code. The server stays the only authority on scores and results; a pure module here only predicts or
// explains. src/core still never imports a format (the eslint rule `no-core-format-import`).
//
// This test holds both halves: (1) outside code reaches into src/formats only through the allowlist below, and (2) every
// allowlisted module, and everything it imports, is free of anything that could read or change live data. To share
// another format module, add it here in the same PR; it fails until its whole import chain is pure.

const REPO = process.cwd();

// Modules outside a format may import. Each must stay pure; the second check below proves it.
const SHARED_PURE_MODULES = [
  'src/formats/throwdown/bracketPreview.js',
  'src/formats/throwdown/bracketPreviewCard.js',
  'src/formats/throwdown/redemption.js',
];

// Surfaces held to the rule. src/admin has its own stricter test (it may import no format at all).
const OUTSIDE_ROOTS = ['src/tools', 'src/community', 'src/marketing'];

// Anything in a shared module's import chain that could touch live data or the network.
const FORBIDDEN_SPECIFIER =
  /supabase|outbox|\/data\.js|\/auth|router|publish|idb|liveSession|sync|storage|\/api/i;
const FORBIDDEN_CALL =
  /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|\.rpc\s*\(|navigator\.sendBeacon/;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.js$/.test(name) && !/\.test\.js$/.test(name)) files.push(full);
  }
  return files;
}

function specifiers(source) {
  const found = [];
  for (const m of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) found.push(m[1]);
  return found;
}

const rel = (file) => relative(REPO, file).split(sep).join('/');

describe('reusing a format’s pure logic outside the format', () => {
  it('outside code imports from src/formats only through the allowlist', () => {
    const offenders = [];
    for (const root of OUTSIDE_ROOTS) {
      for (const file of walk(join(REPO, root))) {
        for (const spec of specifiers(readFileSync(file, 'utf8'))) {
          if (!spec.startsWith('.')) continue;
          const target = rel(resolve(dirname(file), spec));
          if (target.startsWith('src/formats/') && !SHARED_PURE_MODULES.includes(target)) {
            offenders.push(`${rel(file)} imports ${target}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the allowlisted modules exist', () => {
    for (const file of SHARED_PURE_MODULES) expect(existsSync(join(REPO, file)), file).toBe(true);
  });

  it('every allowlisted module and everything it imports is pure (no data, network, auth or storage)', () => {
    const seen = new Set();
    const problems = [];
    const visit = (file) => {
      const key = rel(file);
      if (seen.has(key)) return;
      seen.add(key);
      const source = readFileSync(file, 'utf8');
      if (FORBIDDEN_CALL.test(source)) problems.push(`${key} calls a network or storage API`);
      for (const spec of specifiers(source)) {
        if (!spec.startsWith('.')) {
          problems.push(`${key} imports the package '${spec}'`);
          continue;
        }
        if (FORBIDDEN_SPECIFIER.test(spec)) problems.push(`${key} imports '${spec}'`);
        const target = resolve(dirname(file), spec);
        if (/\.js$/.test(target) && existsSync(target)) visit(target);
      }
    };
    for (const file of SHARED_PURE_MODULES) visit(join(REPO, file));
    expect(problems).toEqual([]);
    // Nothing from another format, and nothing in src/formats beyond the allowlist, is in the chain.
    const formatFiles = [...seen].filter((f) => f.startsWith('src/formats/'));
    expect(formatFiles.sort()).toEqual([...SHARED_PURE_MODULES].sort());
  });
});
