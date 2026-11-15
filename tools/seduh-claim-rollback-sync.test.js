// The pgTAP test 082 runs a COPY of the claim migration's `-- rollback:` block (it cannot read the migration file). This
// test pins the two together, as seduh-accounts-rollback-sync.test.js does for 20261115120000.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261118100000_seduh_claim.sql', 'utf8');
const pgtap = readFileSync('supabase/tests/082_seduh_claim.sql', 'utf8');

const lines = (text) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

describe('seduh claim rollback block', () => {
  it('is the same in the migration and in pgTAP 082', () => {
    const from = migration.indexOf('-- rollback:') + '-- rollback:'.length;
    const to = migration.indexOf('-- ============ the audit table');
    const fromMigration = lines(migration.slice(from, to)).map((l) => l.replace(/^--\s*/, ''));
    const start = pgtap.indexOf('savepoint rollback_block;') + 'savepoint rollback_block;'.length;
    const end = pgtap.indexOf(
      'select is((select count(*)::int from pg_proc where proname in',
      start,
    );
    const fromTest = lines(pgtap.slice(start, end));
    expect(fromMigration.length).toBeGreaterThan(10);
    expect(fromTest).toEqual(fromMigration);
  });
});
