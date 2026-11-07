// Keeps the orientation docs short and the moved history findable (CLAUDE.md, "Read STATUS.md first").
//
// The hot files a session may load (root CLAUDE.md, STATUS.md, CHANGELOG.md, ROADMAP.md) have a size budget; past it,
// move the oldest material verbatim to docs/ (CHANGELOG.md -> docs/archive/changelog/, ROADMAP.md open items ->
// docs/backlog/) instead of letting the file grow back. The second check keeps the archive honest: every heading
// CHANGELOG-INDEX.md lists must exist in the archive file it points at, and every relative link in the orientation
// docs and docs/ must resolve, so a move can never silently lose an entry.
//
//   node tools/check-doc-budgets.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bytes. Set just above the size at the time of the split (2026-11-07) so growth is noticed, not so tight that one
// entry fails CI: about 4 characters per token, so CLAUDE.md is ~9k tokens and CHANGELOG.md ~50k at the limit.
export const BUDGETS = Object.freeze({
  'CLAUDE.md': 36_000,
  'STATUS.md': 8_000,
  'CHANGELOG.md': 200_000,
  'ROADMAP.md': 160_000,
});

export function overBudget(sizes, budgets = BUDGETS) {
  return Object.entries(budgets)
    .filter(([file, max]) => (sizes[file] ?? 0) > max)
    .map(
      ([file, max]) =>
        `${file} is ${sizes[file]} bytes, over its ${max} budget. Move the oldest material to docs/ (see kb-sync.md).`,
    );
}

const LINK = /\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]*)?\)/g;

// Relative links in `text` (the file's own path is `file`) that point at nothing.
export function brokenLinks(file, text, exists = existsSync) {
  const out = [];
  for (const m of text.matchAll(LINK)) {
    const target = resolve(dirname(file), decodeURIComponent(m[1]));
    if (!exists(target)) out.push(`${file}: broken link ${m[1]}`);
  }
  return out;
}

// CHANGELOG-INDEX.md lines look like: "- <heading> → [`file`](docs/archive/changelog/file.md)".
export function missingIndexedHeadings(indexText, readArchive) {
  const out = [];
  for (const line of indexText.split('\n')) {
    const m = line.match(/^- (.+) → \[`[^`]+`\]\(([^)]+)\)$/);
    if (!m) continue;
    const body = readArchive(m[2]);
    if (
      body === null ||
      !body.split('\n').some((l) => l.replace(/^#+\s*/, '').trim() === m[1].trim())
    ) {
      out.push(`CHANGELOG-INDEX.md: "${m[1].slice(0, 80)}" is not in ${m[2]}`);
    }
  }
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

export function run(root) {
  const problems = [];
  const sizes = {};
  for (const file of Object.keys(BUDGETS)) {
    const p = join(root, file);
    sizes[file] = existsSync(p) ? statSync(p).size : 0;
    if (!existsSync(p)) problems.push(`${file} is missing`);
  }
  problems.push(...overBudget(sizes));
  const docs = [...Object.keys(BUDGETS), 'CHANGELOG-INDEX.md']
    .map((f) => join(root, f))
    .filter(existsSync);
  for (const f of walk(join(root, 'docs'))) docs.push(f);
  for (const f of docs) problems.push(...brokenLinks(f, readFileSync(f, 'utf8')));
  const indexPath = join(root, 'CHANGELOG-INDEX.md');
  if (existsSync(indexPath)) {
    const readArchive = (rel) => {
      const p = join(root, rel);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    problems.push(...missingIndexedHeadings(readFileSync(indexPath, 'utf8'), readArchive));
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = run(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('docs: budgets and links OK');
}
