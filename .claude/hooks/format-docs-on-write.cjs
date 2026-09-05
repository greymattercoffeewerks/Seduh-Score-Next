#!/usr/bin/env node
// PostToolUse hook (Write|Edit): auto-formats CHANGELOG.md/ROADMAP.md/CONVENTIONS.md
// with Prettier right after any edit, instead of leaving a formatting mismatch to be
// caught by CI's `format:check` (prettier --check .) — the "Lint, test, build" job
// failed on exactly this twice in one session (2026-09-05, PRs #56 and #57), both
// times because kb-sync's own CHANGELOG.md entry didn't match Prettier's exact
// markdown formatting and nothing caught it locally before push. kb-sync's own
// instructions (.claude/agents/kb-sync.md) now also say to run this by hand, but that
// depends on a smaller model reliably following a manual step every single time; this
// hook is the mechanical backstop that works regardless of which agent (or session)
// touches these files, matching lint-on-write.cjs's own precedent for src/**/*.jsx?.
//
// Deliberately `--write`, not `--check` + exit 2 (unlike lint-on-write.cjs) — a
// formatting mismatch here is silently fixable and shouldn't block the agent's flow
// the way a real lint error does; this hook always exits 0.
const { spawnSync } = require('node:child_process');

const WATCHED_BASENAMES = ['CHANGELOG.md', 'ROADMAP.md', 'CONVENTIONS.md'];

let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    process.exit(0);
  }

  const filePath =
    (payload.tool_response && payload.tool_response.filePath) ||
    (payload.tool_input && payload.tool_input.file_path) ||
    '';

  const basename = filePath.replace(/\\/g, '/').split('/').pop();
  if (!WATCHED_BASENAMES.includes(basename)) {
    process.exit(0);
  }

  spawnSync('npx', ['prettier', '--write', filePath], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  process.exit(0);
});
