// The pgTAP test 079 runs a COPY of the migration's `-- rollback:` block (it cannot read the migration file). This test
// pins the two together: the statements in the migration's rollback comment must equal the ones in the test's
// "rollback block" section, so editing one without the other fails CI.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Paths are relative to the repository root (vitest's working directory), as the other migration-reading tests do.
const migration = readFileSync('supabase/migrations/20261115120000_seduh_accounts.sql', 'utf8');
const pgtap = readFileSync('supabase/tests/079_seduh_accounts.sql', 'utf8');

const lines = (text) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

describe('seduh accounts rollback block', () => {
  it('is the same in the migration and in pgTAP 079', () => {
    const from = migration.indexOf('-- rollback:') + '-- rollback:'.length;
    const to = migration.indexOf('-- ============ ISO country');
    const fromMigration = lines(migration.slice(from, to)).map((l) => l.replace(/^--\s*/, ''));
    const start = pgtap.indexOf('savepoint rollback_block;') + 'savepoint rollback_block;'.length;
    const end = pgtap.indexOf('select is((select count(*)::int from pg_class where relnamespace', start);
    const fromTest = lines(pgtap.slice(start, end));
    expect(fromMigration.length).toBeGreaterThan(5);
    expect(fromTest).toEqual(fromMigration);
  });
});
