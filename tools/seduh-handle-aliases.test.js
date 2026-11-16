// Every owner alias in worker/idRoute.js (HANDLE_ALIASES) must also be a `system` row of the handle watch list in the database, or
// a stranger could claim the alias and the Worker's redirect would hide their page. The system rows are read from the migrations
// (the seeding insert of app.seduh_handle_blocklist, plus any later `values ('word', 'system', ...)` row), the way the
// rollback-sync tests read migrations. A migration that DELETES a system row is not modelled: it would have to be added here on
// purpose, which is the point of the check.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HANDLE_ALIASES } from '../worker/idRoute.js';

const DIR = 'supabase/migrations';

function systemWords() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const words = new Map(); // word -> migration file that seeds it
  for (const file of files) {
    const sql = readFileSync(`${DIR}/${file}`, 'utf8').replace(/\r/g, '');
    // Executable text only: the `-- rollback:` comment lines must not count.
    const code = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    for (const stmt of code.split(';')) {
      if (!/insert into app\.seduh_handle_blocklist/.test(stmt)) continue;
      // shape 1: select w, 'system', 'exact', ... from unnest(array['a', 'b', ...]) w
      if (/select\s+w\s*,\s*'system'/.test(stmt)) {
        const arr = /array\[([\s\S]*?)\]/.exec(stmt);
        if (arr) for (const m of arr[1].matchAll(/'([a-z0-9-]+)'/g)) words.set(m[1], file);
      }
      // shape 2: values ('word', 'system', 'exact', ...)
      for (const m of stmt.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'system'/g)) words.set(m[1], file);
    }
  }
  return words;
}

describe('owner handle aliases', () => {
  const system = systemWords();

  it('finds the system words in the migrations', () => {
    expect(system.has('admin')).toBe(true);
    expect(system.has('claim')).toBe(true);
    expect(system.size).toBeGreaterThan(50);
  });

  it('has every alias seeded as a system row, so nobody can claim it', () => {
    expect(Object.keys(HANDLE_ALIASES).length).toBeGreaterThan(0);
    for (const alias of Object.keys(HANDLE_ALIASES)) {
      expect(
        system.has(alias),
        `${alias} must be a 'system' row of app.seduh_handle_blocklist (seeded by a migration)`,
      ).toBe(true);
    }
  });

  it("does not make the alias TARGET a system word (it is the owner's own, claimable handle)", () => {
    for (const target of Object.values(HANDLE_ALIASES)) {
      expect(system.has(target)).toBe(false);
    }
  });
});
