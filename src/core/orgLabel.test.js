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
});
