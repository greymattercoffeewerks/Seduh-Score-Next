import { describe, it, expect } from 'vitest';
import { orgLabel } from './orgLabel.js';

const A = { id: 'a', name: 'Alpha Coffee', slug: 'alpha-coffee' };
const B = { id: 'b', name: 'Bravo Roasters', slug: 'bravo-roasters' };

describe('orgLabel', () => {
  it('is just the name when the name is not shared', () => {
    expect(orgLabel(A, [A, B])).toBe('Alpha Coffee');
    expect(orgLabel(A, [A])).toBe('Alpha Coffee');
  });

  it('adds the slug when another organisation has the same name, to each of them', () => {
    const twin = { id: 'c', name: 'Alpha Coffee', slug: 'alpha-coffee-nz' };
    expect(orgLabel(A, [A, twin, B])).toBe('Alpha Coffee (alpha-coffee)');
    expect(orgLabel(twin, [A, twin, B])).toBe('Alpha Coffee (alpha-coffee-nz)');
    expect(orgLabel(B, [A, twin, B])).toBe('Bravo Roasters');
  });

  it('falls back to the slug for an organisation with no name, and never prints empty brackets', () => {
    const unnamed = { id: 'd', name: '', slug: 'no-name-co' };
    expect(orgLabel(unnamed, [unnamed, A])).toBe('no-name-co');
    const twinUnnamed = { id: 'e', name: '', slug: 'no-name-co' };
    expect(orgLabel(unnamed, [unnamed, twinUnnamed])).toBe('no-name-co');
    const noSlug = { id: 'f', name: 'Alpha Coffee', slug: '' };
    expect(orgLabel(noSlug, [A, noSlug])).toBe('Alpha Coffee');
    expect(orgLabel(A, [A, noSlug])).toBe('Alpha Coffee (alpha-coffee)');
  });

  it('is never blank, even with neither a name nor a slug', () => {
    expect(orgLabel({ id: 'g', name: '', slug: '' }, [])).toBe('Unnamed organisation');
  });

  it('treats a name of only spaces as no name, and trims the rest', () => {
    const spaces = { id: 'h', name: '   ', slug: 'spaced-out' };
    expect(orgLabel(spaces, [spaces, A])).toBe('spaced-out');
    const padded = { id: 'i', name: '  Alpha Coffee ', slug: 'alpha-coffee-2' };
    expect(orgLabel(padded, [padded, B])).toBe('Alpha Coffee');
    expect(orgLabel({ id: 'j', name: ' ', slug: ' ' }, [])).toBe('Unnamed organisation');
  });

  it('removes invisible text-direction controls, which would scramble a sentence the name sits in', () => {
    const hostile = { id: 'k', name: 'Alpha\u202E Coffee\u2067\u200F', slug: 'alpha-bidi' };
    expect(orgLabel(hostile, [hostile, B])).toBe('Alpha Coffee');
    // …in the slug used to tell two names apart, too.
    const twin = { id: 'l', name: 'Alpha Coffee', slug: 'alpha-\u202Etwin' };
    expect(orgLabel(twin, [hostile, twin])).toBe('Alpha Coffee (alpha-twin)');
    // A name that is ONLY such controls is no name.
    expect(orgLabel({ id: 'm', name: '\u202E\u202C', slug: 'only-controls' }, [])).toBe(
      'only-controls',
    );
  });

  it('compares cleaned names, so a name that differs only by padding still counts as shared', () => {
    const plain = { id: 'n', name: 'Alpha Coffee', slug: 'one' };
    const padded = { id: 'o', name: ' Alpha Coffee ', slug: 'two' };
    expect(orgLabel(plain, [plain, padded])).toBe('Alpha Coffee (one)');
    expect(orgLabel(padded, [plain, padded])).toBe('Alpha Coffee (two)');
  });
});
