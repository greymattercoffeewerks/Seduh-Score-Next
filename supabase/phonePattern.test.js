// @vitest-environment node
// The E.164 shape is written in three places that must be the SAME string: the client (src/core/phone.js), the
// database function app.is_e164 and the people_phone_e164 CHECK. The database never interprets input (PHONE-CHECKER-
// DESIGN.md section 3), so the only way it can drift is by someone editing one of the three. pgTAP cannot read src/,
// so this reads all three as text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const clientMatch = read('src/core/phone.js').match(/const E164_PATTERN = \/(.+)\/;/);
const shapeSql = read('supabase/migrations/20261030100000_phone_e164_shape.sql');
const checkSql = read('supabase/migrations/20261030110000_people_phone_e164_check.sql');
const identitySql = read('supabase/migrations/20261030120000_seduh_identity_tables.sql');
// Every quoted string in the SQL that starts '^\+ is a phone pattern; there must be no variant of it.
const sqlPatterns = (sql) =>
  [...sql.replace(/--[^\n]*/g, '').matchAll(/'(\^\\\+[^']*)'/g)].map((m) => m[1]);

describe('the E.164 pattern is one string', () => {
  it('is found in the client', () => {
    expect(clientMatch).not.toBeNull();
  });

  it('is textually identical in app.is_e164 (the only phone pattern in that migration)', () => {
    const found = sqlPatterns(shapeSql);
    expect(found.length).toBe(1);
    expect(found[0]).toBe(clientMatch[1]);
  });

  it('is textually identical in the people_phone_e164 CHECK and its guard', () => {
    const found = sqlPatterns(checkSql);
    expect(found.length).toBe(2);
    for (const p of found) expect(p).toBe(clientMatch[1]);
  });

  it('is textually identical in the seduh_identities phone check (the only phone pattern in that migration)', () => {
    const found = sqlPatterns(identitySql);
    expect(found).toEqual([clientMatch[1]]);
  });
});
