import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESERVED_SLUGS,
  nameProblem,
  slugProblem,
  normalisedSlug,
  nameMessage,
  slugMessage,
  isEmailShaped,
} from './orgRules.js';

// The page's rules are a copy of what create_org enforces. The database wins, so the copy must not drift.
describe('the reserved link names', () => {
  // The newest migration that defines the list is the one in force.
  function listInForce() {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    let words = null;
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      const match = text.match(/v_reserved\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/);
      if (match) words = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
    return words;
  }

  it('are exactly the words the database refuses, in the migration that is in force', () => {
    const fromDatabase = listInForce();
    expect(fromDatabase, 'the reserved list was not found in any migration').not.toBeNull();
    expect(fromDatabase.length).toBeGreaterThan(20);
    expect([...RESERVED_SLUGS].sort()).toEqual([...fromDatabase].sort());
  });

  it('every one is refused as reserved, whatever its case or surrounding space', () => {
    for (const word of RESERVED_SLUGS) {
      expect(slugProblem(word), word).toBe(
        word.length >= 3 ? 'org_slug_reserved' : 'org_slug_invalid',
      );
      expect(slugProblem(` ${word.toUpperCase()}\n`), word).toBe(
        word.length >= 3 ? 'org_slug_reserved' : 'org_slug_invalid',
      );
    }
  });
});

describe('slugProblem', () => {
  it('accepts 3 to 40 letters and digits with single hyphens between them', () => {
    for (const slug of ['abc', 'a-b', 'a1b', 'alpha-roasters', 'A-B-C', 'x'.repeat(40), '123']) {
      expect(slugProblem(slug), slug).toBeNull();
    }
  });

  it('refuses a link name that is too short, too long, or the wrong shape, as invalid', () => {
    for (const slug of [
      '',
      '  ',
      'ab',
      'x'.repeat(41),
      '-abc',
      'abc-',
      'a--b',
      'a b c',
      'a_b_c',
      'abc!',
      'cafés',
      'a/b/c',
    ]) {
      expect(slugProblem(slug), slug).toBe('org_slug_invalid');
    }
  });

  it('judges the trimmed value, as the database does, and the folded one for reserved words', () => {
    expect(slugProblem('  alpha  ')).toBeNull();
    expect(slugProblem('\talpha\r\n')).toBeNull();
    expect(slugProblem('ADMIN')).toBe('org_slug_reserved');
    expect(slugProblem(' Live ')).toBe('org_slug_reserved');
  });

  it('does not treat a word that merely contains a reserved word as reserved', () => {
    expect(slugProblem('admin-co')).toBeNull();
    expect(slugProblem('myapp')).toBeNull();
  });

  it('survives something that is not a string', () => {
    expect(slugProblem(null)).toBe('org_slug_invalid');
    expect(slugProblem(undefined)).toBe('org_slug_invalid');
  });
});

describe('normalisedSlug', () => {
  it('is the link name as it will be stored: trimmed and lower-cased', () => {
    expect(normalisedSlug('  Alpha-Roasters \n')).toBe('alpha-roasters');
  });
});

describe('nameProblem', () => {
  it('accepts 1 to 80 characters, counting a character as a character', () => {
    expect(nameProblem('A')).toBeNull();
    expect(nameProblem('x'.repeat(80))).toBeNull();
    expect(nameProblem('Café Roasters & Co.')).toBeNull();
    // 80 emoji are 160 UTF-16 units but 80 characters
    expect(nameProblem('\u{1F600}'.repeat(80))).toBeNull();
    expect(nameProblem('\u{1F600}'.repeat(81))).toBe('org_name_invalid');
  });

  it('refuses nothing, too long, and a name that is only space', () => {
    for (const name of ['', '   ', '\t\n', 'x'.repeat(81), null, undefined]) {
      expect(nameProblem(name), String(name)).toBe('org_name_invalid');
    }
  });

  it('refuses control characters, bidirectional overrides and invisible-only names', () => {
    const code = (...points) => String.fromCodePoint(...points);
    for (const name of [
      `a${code(0)}b`,
      `a${code(7)}b`,
      `a${code(0x7f)}b`,
      `a${code(0x85)}b`,
      `a${code(0x202e)}b`,
      `a${code(0x2066)}b`,
      `a${code(0x2069)}b`,
      code(0x200b, 0x200d, 0x2060, 0xfeff),
      code(0xa0, 0x20, 0xa0),
    ]) {
      expect(nameProblem(name), JSON.stringify(name)).toBe('org_name_invalid');
    }
  });

  it('keeps an inner tab or newline out (a control character), but trims one at the ends', () => {
    expect(nameProblem('a\tb')).toBe('org_name_invalid');
    expect(nameProblem('a\nb')).toBe('org_name_invalid');
    expect(nameProblem('\ta b\n')).toBeNull();
  });
});

describe('the messages', () => {
  it('are the console copy for the hint, and null when the value is fine', () => {
    expect(nameMessage('Alpha')).toBeNull();
    expect(nameMessage('')).toMatch(/1 to 80 characters/);
    expect(slugMessage('alpha')).toBeNull();
    expect(slugMessage('a')).toMatch(/3 to 40 letters and digits/);
    expect(slugMessage('admin')).toBe('That link name is reserved. Choose another.');
  });
});

describe('isEmailShaped', () => {
  it('accepts an address with an at sign and a dotted domain, ignoring surrounding space', () => {
    expect(isEmailShaped('a@b.test')).toBe(true);
    expect(isEmailShaped('  a.b+c@sub.example.test ')).toBe(true);
  });

  it('refuses what is clearly not one', () => {
    for (const value of ['', 'a', 'a@b', '@b.test', 'a@.test', 'a b@c.test', 'a@b@c.test', null]) {
      expect(isEmailShaped(value), String(value)).toBe(false);
    }
  });
});
