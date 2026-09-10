#!/usr/bin/env node
// PostToolUse hook (Write|Edit): mechanical half of state.json's reset contract
// (CLAUDE.md "Session state" section). Fires only on writes to state.json itself.
//
// Checks exactly one invariant, the one a static rule can actually verify: if
// task.status is "done", review.open_findings must contain zero entries with
// severity == "blocking". This mirrors lint-on-write.cjs's own exit-2-to-block
// pattern — a task should not be able to close itself out while a blocking finding
// is still on record, the same way CHANGELOG.md's own "Blocking (agent): ..."
// language has always meant "must close before done" in every session so far, just
// enforced by a person's attention rather than by anything mechanical.
//
// Deliberately narrow. It does NOT check that deferred findings were actually copied
// into ROADMAP.md's "Known open items" (that requires cross-file, judgment-level
// verification — kb-sync.md's own instructions carry that half) and it does NOT know
// which agent performed the write, so it cannot enforce "only kb-sync may set
// status: done" (no caller identity is available in the PostToolUse payload). Both
// gaps are intentional, matching the project's existing mechanical/judgment split
// (module-boundary-checker catching what no-core-format-import's static rule can't).
//
// Known coverage gap, undocumented until now: this only fires for writes made via
// the Write/Edit tools that PostToolUse's matcher catches. A Bash heredoc write to
// state.json bypasses it entirely — untested either way before this hook existed,
// and still not closed by this hook; only a read-time backstop (CLAUDE.md's
// "Session state" section) can catch that path, by re-validating on next read.
const fs = require('node:fs');

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
  if (basename !== 'state.json') {
    process.exit(0);
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    // Not valid JSON right after a write is itself suspicious, but this hook's job
    // is the done/blocking invariant specifically — leave malformed-JSON detection
    // to whichever agent next reads the file (the read-time backstop).
    process.exit(0);
  }

  const status = state && state.task && state.task.status;
  if (status !== 'done') {
    process.exit(0);
  }

  const findings = (state.review && state.review.open_findings) || [];
  const blocking = findings.filter((f) => f && f.severity === 'blocking');

  if (blocking.length > 0) {
    process.stderr.write(
      `state.json sets task.status = "done" but review.open_findings still has ` +
        `${blocking.length} entry(ies) with severity == "blocking":\n` +
        blocking.map((f) => `  - ${f.summary || JSON.stringify(f)}`).join('\n') +
        `\n\nPer the reset contract (CLAUDE.md "Session state"), a task cannot close ` +
        `while a blocking finding is still open. Resolve it first, then re-set ` +
        `status to "done" — or leave status as "fixing" if it's still in progress.\n`,
    );
    process.exit(2);
  }

  process.exit(0);
});
