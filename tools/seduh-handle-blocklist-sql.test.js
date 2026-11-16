import { describe, expect, it } from 'vitest';
import { parseProfanityCsv, profanitySql } from './seduh-handle-blocklist-sql.mjs';

// Fictional placeholder words only: the real list is never in the repository.
const OK =
  'term,match_mode,language,note\n# a comment\nzork,exact,xx,placeholder\nquuxfrob,contains,xx\n\n';

describe('the profanity loader', () => {
  it('parses rows, skipping comments and blank lines', () => {
    const rows = parseProfanityCsv(OK);
    expect(rows.map((r) => [r.term, r.mode, r.language])).toEqual([
      ['zork', 'exact', 'xx'],
      ['quuxfrob', 'contains', 'xx'],
    ]);
    expect(rows[0].note).toBe('lang xx; placeholder');
  });
  it('accepts a BOM and CRLF', () => {
    expect(parseProfanityCsv('\uFEFFterm,match_mode\r\nzork,exact\r\n')).toHaveLength(1);
  });
  it('refuses every shape the table would refuse, naming the line', () => {
    const bad = [
      ['Zork,exact', /line 2.*lowercase/],
      ['zo,exact', /line 2/],
      ['zo-rk,exact', /line 2/],
      ['zork,starts', /line 2.*match_mode/],
      ['abc,contains', /line 2.*4 or more/],
      ['zork,exact\nzork,contains', /line 3.*twice/],
      ['zork,exact,Toolong', /line 2.*language/],
    ];
    for (const [row, message] of bad) {
      expect(() => parseProfanityCsv(`term,match_mode,language\n${row}`), row).toThrow(message);
    }
  });
  it('refuses a missing header or an empty file', () => {
    expect(() => parseProfanityCsv('zork,exact')).toThrow(/header/);
    expect(() => parseProfanityCsv('term,match_mode\n')).toThrow(/no rows/);
    expect(() => parseProfanityCsv('')).toThrow(/no header/);
  });
  it('prints one transaction that upserts, escaping quotes', () => {
    const sql = profanitySql([
      { term: 'zork', mode: 'exact', language: 'xx', note: "it's a test" },
    ]);
    expect(sql.startsWith('begin;')).toBe(true);
    expect(sql).toMatch(/commit;\n$/);
    expect(sql).toContain("('zork', 'profanity', 'exact', 'it''s a test')");
    expect(sql).toContain('on conflict (term, kind) do update');
  });
});
