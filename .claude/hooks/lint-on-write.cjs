#!/usr/bin/env node
// PostToolUse hook (Write|Edit): runs ESLint on the written/edited file if it's JS.
// Handoff/SEDUH-NEXT-HANDOFF.md §10: "PostToolUse hook ... reads the tool payload,
// filters to .jsx?, shells to eslint, exits 2 to block."
// Exit 2 signals a blocking error back to Claude (stderr is shown as the reason).
const { spawnSync } = require('node:child_process');

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

  if (!/\.jsx?$/.test(filePath)) {
    process.exit(0);
  }

  const result = spawnSync('npx', ['eslint', '--no-warn-ignored', filePath], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status) {
    process.stderr.write(output);
    process.exit(2);
  }
  process.exit(0);
});
