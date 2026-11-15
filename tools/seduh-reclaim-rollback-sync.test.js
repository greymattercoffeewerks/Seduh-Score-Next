// The pgTAP test 083 runs a COPY of the re-claim migration's `-- rollback:` statements (inside a probe it then undoes). This
// pins the two together, as seduh-claim-rollback-sync.test.js does for 20261118100000.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261119100000_seduh_reclaim_after_close.sql',
  'utf8',
);
const pgtap = readFileSync('supabase/tests/083_seduh_reclaim_after_close.sql', 'utf8');

const normal = (text) => text.replace(/\r/g, '').replace(/\s+/g, ' ').trim();

describe('seduh reclaim rollback block', () => {
  it('is the same two statements in the migration and in pgTAP 083', () => {
    const from = migration.indexOf('-- rollback:') + '-- rollback:'.length;
    const to = migration.indexOf('alter table app.seduh_accounts drop constraint');
    const fromMigration = normal(
      migration
        .slice(from, to)
        .split('\n')
        .map((l) => l.replace(/^--\s*/, ''))
        .join('\n'),
    );
    expect(fromMigration).toBe(
      'drop index if exists app.seduh_accounts_identity_open_key; alter table app.seduh_accounts add constraint seduh_accounts_identity_id_key unique (identity_id);',
    );
    for (const statement of fromMigration.split(';').filter(Boolean)) {
      expect(normal(pgtap)).toContain(normal(statement));
    }
  });
});
