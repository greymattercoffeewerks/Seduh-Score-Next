// Fails a release PR (a pull request whose base is `main`) that ships code without raising `package.json`'s `version`.
//
// The footer names the deployed build (CONVENTIONS.md, "Versioning"), but the bump belongs to the closing task of a
// phase and sessions that stop at a PR never run it: the version sat at 3.4.1 from 2026-10-23 to 2026-11-02. This
// makes the miss a red check instead of a memory.
//
// The rule (the narrowest reading of CONVENTIONS.md):
//   1. `package.json` and `package-lock.json` must agree on the version (the lock's root and its "" package).
//   2. If any changed file is one the deployed app is built from (SHIPPED_PATTERNS), the head version must be
//      strictly higher than the base version. A release that changes only docs, tests, tooling or CI passes as is.
//   3. The `skip-version-check` label on the PR (or --bypass) turns rule 2 off, for the cases a path list cannot
//      judge (a comment-only change in src/, say). Rule 1 still applies: a bypass never excuses a broken lock.
//
//   node tools/check-version-bump.mjs --base origin/main [--head HEAD] [--bypass]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BYPASS_LABEL = 'skip-version-check';

// What the deployed app is built from: the frontend source, static assets, every HTML entry, the database
// migrations and Edge Functions the cloud project is brought up to, and the build/deploy config.
export const SHIPPED_PATTERNS = Object.freeze([
  /^src\//,
  /^public\//,
  /\.html$/,
  /^supabase\/migrations\//,
  /^supabase\/functions\//,
  /^vite\.config\.js$/,
  /^wrangler\.jsonc$/,
]);

// Notes (src/**/CLAUDE.md) and unit tests live beside the source but are not part of the build.
const NOT_SHIPPED = /(\.md|\.test\.js)$/;

export const isShippedFile = (file) =>
  SHIPPED_PATTERNS.some((pattern) => pattern.test(file)) && !NOT_SHIPPED.test(file);

// True when `a` is a higher x.y.z than `b`. Anything that is not plain x.y.z (a pre-release suffix included) is not
// comparable here and counts as not higher, so the check fails loudly instead of guessing.
export function isHigherVersion(a, b) {
  const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v ?? '') ? v.split('.').map(Number) : null);
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

// The pure decision. `lockVersions` is every version the lockfile states for the root package.
export function decideVersionCheck({
  changedFiles,
  baseVersion,
  headVersion,
  lockVersions,
  bypass = false,
}) {
  const reasons = [];
  const disagreeing = lockVersions.filter((v) => v !== headVersion);
  if (disagreeing.length > 0) {
    reasons.push(
      `package-lock.json says ${[...new Set(disagreeing)].join(', ')} but package.json says ${headVersion}. ` +
        'Run `npm version <x.y.z> --no-git-tag-version` (it updates both) instead of editing one by hand.',
    );
  }
  const shipped = changedFiles.filter(isShippedFile);
  if (!bypass && shipped.length > 0 && !isHigherVersion(headVersion, baseVersion)) {
    const sample = shipped.slice(0, 3).join(', ') + (shipped.length > 3 ? ', ...' : '');
    reasons.push(
      `This release changes ${shipped.length} shipped file(s) (${sample}) but package.json is at ${headVersion}, ` +
        `not above the base's ${baseVersion}. Run \`npm version minor|patch --no-git-tag-version\` and note ` +
        `what the number covers in CHANGELOG.md. If no bump is right (a comment-only change, say), add the ` +
        `"${BYPASS_LABEL}" label to the PR and re-run this job.`,
    );
  }
  return { ok: reasons.length === 0, reasons, shipped };
}

// CI sets VERSION_CHECK_BYPASS to '1' when the label is present and to '' when it is not.
export const wantsBypass = (args, env) =>
  args.includes('--bypass') || env.VERSION_CHECK_BYPASS === '1';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

export function readVersionsAt(ref) {
  const pkg = JSON.parse(git('show', `${ref}:package.json`));
  let lock = null;
  try {
    lock = JSON.parse(git('show', `${ref}:package-lock.json`));
  } catch {
    // no lockfile at that ref
  }
  const lockVersions = lock ? [lock.version, lock.packages?.['']?.version] : [];
  return { version: pkg.version, lockVersions: lockVersions.filter((v) => v !== undefined) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at === -1 ? fallback : args[at + 1];
  };
  const base = option('--base');
  const head = option('--head', 'HEAD');
  if (!base) {
    console.error(
      'Usage: node tools/check-version-bump.mjs --base <ref> [--head <ref>] [--bypass]',
    );
    process.exit(2);
  }
  let result;
  try {
    const changedFiles = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
    const baseVersions = readVersionsAt(base);
    const headVersions = readVersionsAt(head);
    result = decideVersionCheck({
      changedFiles,
      baseVersion: baseVersions.version,
      headVersion: headVersions.version,
      lockVersions: headVersions.lockVersions,
      bypass: wantsBypass(args, process.env),
    });
    console.log(
      `base ${baseVersions.version} -> head ${headVersions.version}; ${changedFiles.length} files changed`,
    );
  } catch (error) {
    console.error(`Could not compare ${base} with ${head}: ${error.message}`);
    process.exit(2);
  }
  if (!result.ok) {
    for (const reason of result.reasons) console.error(`Version check failed: ${reason}`);
    process.exit(1);
  }
  console.log(
    result.shipped.length > 0
      ? 'Version check passed (shipped files changed and the version went up, or the bypass label is set).'
      : 'Version check passed (no shipped files changed).',
  );
}
