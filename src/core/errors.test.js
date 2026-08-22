import { describe, it, expect } from 'vitest';
import { describeError } from './errors.js';

describe('describeError', () => {
  it("returns the message verbatim for a module's own thrown errors (a plain Error, no .code)", () => {
    const err = new Error('heat 1 already exists with a different configuration');
    expect(describeError(err)).toBe('heat 1 already exists with a different configuration');
  });

  it('falls back to a generic message for an Error carrying a .code (a raw Postgrest/DB error)', () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    expect(describeError(err)).toBe('Something went wrong saving that — try again.');
  });

  it('falls back to a generic message for a non-Error rejection value', () => {
    expect(describeError({ message: 'weird raw failure', code: '55000' })).toBe(
      'Something went wrong saving that — try again.',
    );
  });
});
