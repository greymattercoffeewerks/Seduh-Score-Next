import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeThrowdownError } from './words.js';

const DIR = join(import.meta.dirname, '../../../supabase/migrations');

// every `hint = 'td_...'` a Throwdown function can raise (comments stripped)
function throwdownHints() {
  const found = new Set();
  for (const f of readdirSync(DIR).filter(
    (n) => n.includes('throwdown') && !n.includes('entitlement'),
  )) {
    const sql = readFileSync(join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/hint\s*=\s*'([a-z_]+)'/g)) found.add(m[1]);
  }
  return [...found];
}

describe('Throwdown refusal wording', () => {
  const hints = throwdownHints();
  it('reads a believable set of hints from the migrations', () => {
    expect(hints.length).toBeGreaterThan(15);
    expect(hints).toContain('td_votes_level');
  });
  it('gives every hint the database can raise its own words, never the generic sentence', () => {
    const generic = describeThrowdownError({ hint: 'not_a_hint', message: 'x', code: '23001' });
    const missing = hints
      .filter((h) => !h.startsWith('entitlement_'))
      .filter((h) => describeThrowdownError({ hint: h, code: '23001' }) === generic);
    expect(missing).toEqual([]);
  });
});
