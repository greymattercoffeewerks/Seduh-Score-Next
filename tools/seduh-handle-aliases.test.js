// Every owner alias in worker/idRoute.js (HANDLE_ALIASES) must also be a RESERVED handle in the database, or a stranger could
// claim the alias and the Worker's redirect would hide their page. The reserved list is read from the LATEST migration that
// defines app.seduh_handle_reserved (a later `create or replace` wins), the way the rollback-sync tests read migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HANDLE_ALIASES } from '../worker/idRoute.js';

const DIR = 'supabase/migrations';

function latestReservedList() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let found = null;
  for (const file of files) {
    const sql = readFileSync(`${DIR}/${file}`, 'utf8').replace(/\r/g, '');
    // Executable text only: the `-- rollback:` comment lines hold the PREVIOUS definition and must not count.
    const code = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    const at = code.search(/create (or replace )?function app\.seduh_handle_reserved\(/);
    if (at === -1) continue;
    const arr = /array\[([\s\S]*?)\]/.exec(code.slice(at));
    if (arr) found = { file, words: [...arr[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]) };
  }
  return found;
}

describe('owner handle aliases', () => {
  const latest = latestReservedList();

  it('finds the reserved list in the migrations', () => {
    expect(latest).not.toBeNull();
    expect(latest.words).toContain('admin');
    expect(latest.words.length).toBeGreaterThan(50);
  });

  it('has every alias reserved in the database, so nobody can claim it', () => {
    expect(Object.keys(HANDLE_ALIASES).length).toBeGreaterThan(0);
    for (const alias of Object.keys(HANDLE_ALIASES)) {
      expect(
        latest.words,
        `${alias} must be in app.seduh_handle_reserved (${latest.file})`,
      ).toContain(alias);
    }
  });

  it("does not reserve the alias TARGET (it is the owner's own, claimable handle)", () => {
    for (const target of Object.values(HANDLE_ALIASES)) {
      expect(latest.words).not.toContain(target);
    }
  });
});
