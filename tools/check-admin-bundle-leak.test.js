import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ADMIN_ONLY_STRINGS,
  findAdminLeaks,
  isAdminChunk,
  missingFromAdminChunk,
} from './check-admin-bundle-leak.mjs';

// The check itself, against a pretend build. The real one runs on the real dist/ after `npm run build`
// (`npm run check:admin-leak`, in CI); this proves it would notice.

const ADMIN = 'admin-abcd1234.js';
const EVERY_STRING = ADMIN_ONLY_STRINGS.join(' ; ');

let dist;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'seduh-dist-'));
  mkdirSync(join(dist, 'assets'));
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

const put = (name, text) => writeFileSync(join(dist, 'assets', name), text);

describe('the admin bundle-leak check', () => {
  it('names the strings only the admin console contains', () => {
    for (const string of ['admin-accounts', 'admin_create_org', 'New organisation']) {
      expect(ADMIN_ONLY_STRINGS).toContain(string);
    }
  });

  it('recognises the admin entry chunk and nothing that merely starts like it', () => {
    expect(isAdminChunk('admin-cOynf02s.js')).toBe(true);
    expect(isAdminChunk('admin-B2TLxIU4.css')).toBe(false);
    expect(isAdminChunk('adminHelper-cOynf02s.js')).toBe(false);
    expect(isAdminChunk('admin-helper-cOynf02s.js')).toBe(false);
    expect(isAdminChunk('admin-shared-x1.js')).toBe(false);
    expect(isAdminChunk('app-admin-cOynf02s.js')).toBe(false);
    expect(isAdminChunk('main-admin.js.js')).toBe(false);
  });

  it('is quiet when only the admin chunk holds admin text', () => {
    put(ADMIN, EVERY_STRING);
    put('app-def45678.js', 'console.log("organiser")');
    expect(findAdminLeaks(dist)).toEqual({ scanned: 2, leaks: [] });
  });

  it('finds each admin-only string in any other bundle, and says which', () => {
    put(ADMIN, EVERY_STRING);
    put('app-def45678.js', 'x.rpc("admin_create_org")');
    put('shared-aaa11111.js', 'invoke("admin-accounts"); h("New organisation")');
    put('clean-bbb22222.js', 'nothing here');
    const { leaks } = findAdminLeaks(dist);
    expect(leaks).toEqual(
      expect.arrayContaining([
        { file: 'app-def45678.js', string: 'admin_create_org' },
        { file: 'shared-aaa11111.js', string: 'admin-accounts' },
        { file: 'shared-aaa11111.js', string: 'New organisation' },
      ]),
    );
    expect(leaks).toHaveLength(3);
  });

  it('does not let a file named like an admin chunk but not the entry hide a leak', () => {
    put('admin-shared-abc123.js', 'admin_create_org');
    expect(findAdminLeaks(dist).leaks).toEqual([
      { file: 'admin-shared-abc123.js', string: 'admin_create_org' },
    ]);
  });

  it('reads JavaScript only', () => {
    put(ADMIN, '');
    put('other.css', 'admin_create_org');
    expect(findAdminLeaks(dist)).toEqual({ scanned: 1, leaks: [] });
  });

  describe('the canary: every listed string must still be in the admin chunk', () => {
    it('lists the ones that are not', () => {
      put(ADMIN, ADMIN_ONLY_STRINGS.filter((s) => s !== 'admin_find_user').join(' ; '));
      expect(missingFromAdminChunk(dist)).toEqual(['admin_find_user']);
    });

    it('is empty when all are there, and null when there is no admin chunk to ask', () => {
      put(ADMIN, EVERY_STRING);
      expect(missingFromAdminChunk(dist)).toEqual([]);
      rmSync(join(dist, 'assets', ADMIN));
      expect(missingFromAdminChunk(dist)).toBeNull();
    });
  });

  // The script as CI runs it. A guard that exits 0 whatever it saw (a main-guard that evaluates false, say) would
  // turn the whole gate into a no-op, and nothing above would notice.
  describe('the command', () => {
    const run = () =>
      spawnSync(process.execPath, [resolve('tools/check-admin-bundle-leak.mjs'), dist], {
        encoding: 'utf8',
      });

    it('exits 0 on a clean build', () => {
      put(ADMIN, EVERY_STRING);
      put('app-def45678.js', 'organiser');
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/No admin-only text/);
    });

    it('exits 1, naming the file and the text, on a leak', () => {
      put(ADMIN, EVERY_STRING);
      put('app-def45678.js', 'rpc("admin_create_org")');
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('"admin_create_org" found in assets/app-def45678.js');
    });

    it('exits 2 when there is no admin chunk, or the admin chunk lost a listed string, or no build', () => {
      put('app-def45678.js', 'organiser');
      expect(run().status).toBe(2);
      put(ADMIN, 'admin_create_org');
      const stale = run();
      expect(stale.status).toBe(2);
      expect(stale.stderr).toContain('no longer contains');
      rmSync(join(dist, 'assets'), { recursive: true });
      expect(run().status).toBe(2);
    });
  });
});
