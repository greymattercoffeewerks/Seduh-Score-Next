// @vitest-environment node
// Explicit table grants (Supabase change of 2026-10-30): from that date a table created in `public`
// receives NO automatic privileges for anon / authenticated / service_role, so a migration that
// creates one and says nothing about access ships a table the API answers "permission denied" on.
// Until the Supabase CLI used by CI/local catches up, a fresh database still hands every new table
// broad privileges, so a pgTAP privilege check cannot see the omission. This reads the migrations
// instead: every `public` table must have a `grant ... on <table>` somewhere in the migrations, or
// be listed below as deliberately closed to every API role (reached only through SECURITY DEFINER
// functions). Adding a table here is a decision: say why.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, 'migrations');

// Closed to every API role on purpose (no grant, no policy a role could use).
const DENY_ALL = new Map([
  ['score_change_counts', 'trigger-maintained counters; read through the score-change RPCs only'],
  [
    'team_removed_members',
    'restore list; written and read only by the team_* SECURITY DEFINER functions',
  ],
]);

// Strip `-- ...` comments (rollback blocks live in them) and quoted-identifier noise.
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ name: f, sql: stripComments(readFileSync(join(DIR, f), 'utf8')) }));

// `create table [if not exists] [public.]name (` ; a table in another schema (`app.x`) is not exposed.
const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
// `grant <privs> on [table] [public.]name[, name2] to ...` (privilege lists may carry column lists).
const GRANT = /grant\s+[^;]*?\s+on\s+(?:table\s+)?([^;]*?)\s+to\s/gi;

const created = new Set();
for (const { sql } of files) {
  for (const m of sql.matchAll(CREATE)) created.add(m[1].toLowerCase());
}

const granted = new Set();
for (const { sql } of files) {
  for (const m of sql.matchAll(GRANT)) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .trim()
        .replace(/^public\./i, '')
        .toLowerCase();
      if (/^[a-z_][a-z0-9_]*$/.test(name)) granted.add(name);
    }
  }
}

describe('migrations: explicit table grants', () => {
  it('finds the tables (guards against the regexes silently matching nothing)', () => {
    expect(created.size).toBeGreaterThan(25);
    expect(granted.size).toBeGreaterThan(20);
  });

  it('every public table has a grant in the migrations, or is listed as deny-all', () => {
    const missing = [...created].filter((t) => !granted.has(t) && !DENY_ALL.has(t)).sort();
    expect(
      missing,
      `table(s) with no grant: ${missing.join(', ')}. Add "grant select, insert, update, delete on <table> to authenticated;" ` +
        '(only the privileges that role uses) in the migration that creates it, or list it in DENY_ALL with the reason.',
    ).toEqual([]);
  });

  it('a deny-all table really has no grant, and every deny-all entry is still a table', () => {
    for (const t of DENY_ALL.keys()) {
      expect(created.has(t), `${t} is listed in DENY_ALL but no migration creates it`).toBe(true);
      expect(
        granted.has(t),
        `${t} is listed as deny-all but a migration grants on it; remove it from DENY_ALL`,
      ).toBe(false);
    }
  });
});
