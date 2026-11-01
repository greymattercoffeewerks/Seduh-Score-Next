import { describe, it, expect } from 'vitest';
import {
  BYPASS_LABEL,
  decideVersionCheck,
  isHigherVersion,
  isShippedFile,
  wantsBypass,
} from './check-version-bump.mjs';

// The release gate's decision, as a table. The CLI reads git and feeds this; CI runs it on PRs into main.

const check = (overrides) =>
  decideVersionCheck({
    changedFiles: ['src/core/ranking.js'],
    baseVersion: '3.4.1',
    headVersion: '3.5.0',
    lockVersions: ['3.5.0', '3.5.0'],
    ...overrides,
  });

describe('isShippedFile', () => {
  it.each([
    'src/core/ranking.js',
    'public/marketing/photo.jpg',
    'index.html',
    'tools/timer/index.html',
    'supabase/migrations/20261101000000_x.sql',
    'supabase/functions/admin-accounts/index.ts',
    'vite.config.js',
    'wrangler.jsonc',
  ])('%s is part of the deployed app', (file) => {
    expect(isShippedFile(file)).toBe(true);
  });

  it.each([
    'CHANGELOG.md',
    'ROADMAP.md',
    'Handoffs and Specs/SEDUH-NEXT-HANDOFF.md',
    'src/core/CLAUDE.md',
    'src/core/ranking.test.js',
    'tests/e2e/smoke.spec.js',
    'supabase/tests/001_x.sql',
    '.github/workflows/ci.yml',
    '.claude/agents/kb-sync.md',
    'package.json',
    'tools/check-version-bump.mjs',
  ])('%s is not', (file) => {
    expect(isShippedFile(file)).toBe(false);
  });
});

describe('isHigherVersion', () => {
  it('compares numerically, not as text', () => {
    expect(isHigherVersion('3.10.0', '3.9.9')).toBe(true);
    expect(isHigherVersion('3.5.0', '3.4.1')).toBe(true);
    expect(isHigherVersion('4.0.0', '3.99.99')).toBe(true);
    expect(isHigherVersion('3.4.2', '3.4.1')).toBe(true);
    expect(isHigherVersion('3.4.1', '3.4.2')).toBe(false);
  });
  it('is false for equal, lower and unparseable versions', () => {
    expect(isHigherVersion('3.4.1', '3.4.1')).toBe(false);
    expect(isHigherVersion('3.4.0', '3.4.1')).toBe(false);
    expect(isHigherVersion('3.5.0-beta', '3.4.1')).toBe(false);
    expect(isHigherVersion(undefined, '3.4.1')).toBe(false);
  });
});

describe('decideVersionCheck', () => {
  it('passes when shipped code changed and the version went up', () => {
    expect(check({}).ok).toBe(true);
  });

  it('fails when shipped code changed and the version did not move (the 3.4.1 drift)', () => {
    const result = check({ headVersion: '3.4.1', lockVersions: ['3.4.1', '3.4.1'] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('npm version');
    expect(result.reasons[0]).toContain(BYPASS_LABEL);
  });

  it('fails when the version went down', () => {
    const result = check({ headVersion: '3.4.0', lockVersions: ['3.4.0', '3.4.0'] });
    expect(result.ok).toBe(false);
  });

  it('fails for a migration-only release with no bump', () => {
    const result = check({
      changedFiles: ['supabase/migrations/20261101000000_x.sql', 'CHANGELOG.md'],
      headVersion: '3.4.1',
      lockVersions: ['3.4.1', '3.4.1'],
    });
    expect(result.ok).toBe(false);
  });

  it('passes a docs-only release with no bump', () => {
    const result = check({
      changedFiles: ['CHANGELOG.md', 'ROADMAP.md', 'src/core/CLAUDE.md'],
      headVersion: '3.4.1',
      lockVersions: ['3.4.1', '3.4.1'],
    });
    expect(result.ok).toBe(true);
    expect(result.shipped).toEqual([]);
  });

  it('passes shipped code with no bump when the bypass is set', () => {
    const result = check({
      headVersion: '3.4.1',
      lockVersions: ['3.4.1', '3.4.1'],
      bypass: true,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when the lockfile disagrees with package.json, bypass or not', () => {
    for (const bypass of [false, true]) {
      const result = check({ lockVersions: ['3.4.1', '3.5.0'], bypass });
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toContain('package-lock.json says 3.4.1');
    }
  });

  it('fails a lockfile mismatch even on a docs-only release', () => {
    const result = check({
      changedFiles: ['CHANGELOG.md'],
      headVersion: '3.4.1',
      lockVersions: ['3.4.1', '3.3.0'],
    });
    expect(result.ok).toBe(false);
  });

  it('reports both problems at once', () => {
    const result = check({ headVersion: '3.4.1', lockVersions: ['3.3.0'] });
    expect(result.reasons).toHaveLength(2);
  });
});

describe('wantsBypass', () => {
  it('is off for the empty string CI passes when the label is absent', () => {
    expect(wantsBypass([], { VERSION_CHECK_BYPASS: '' })).toBe(false);
    expect(wantsBypass([], {})).toBe(false);
  });
  it('is on for the label (env 1) or the flag', () => {
    expect(wantsBypass([], { VERSION_CHECK_BYPASS: '1' })).toBe(true);
    expect(wantsBypass(['--bypass'], {})).toBe(true);
  });
});
