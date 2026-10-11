import { describe, expect, it } from 'vitest';
import { checkReason, REASON_MAX } from './reason.js';

describe('checkReason', () => {
  it('returns the trimmed text when it is present and within the default limit', () => {
    expect(checkReason('  Sudden-death cup  ')).toEqual({ ok: true, reason: 'Sudden-death cup' });
  });

  it('treats empty, whitespace-only, NBSP-only, and non-text values as empty', () => {
    for (const raw of ['', ' \t\n ', '\u00a0', null, undefined, 42]) {
      expect(checkReason(raw)).toEqual({ ok: false, kind: 'empty', max: REASON_MAX });
    }
  });

  it('accepts exactly the default maximum and refuses one UTF-16 unit beyond it', () => {
    expect(checkReason('x'.repeat(REASON_MAX))).toEqual({
      ok: true,
      reason: 'x'.repeat(REASON_MAX),
    });
    expect(checkReason('x'.repeat(REASON_MAX + 1))).toEqual({
      ok: false,
      kind: 'too_long',
      max: REASON_MAX,
    });
  });

  it('uses a caller-supplied maximum', () => {
    expect(checkReason('abc', { max: 3 })).toEqual({ ok: true, reason: 'abc' });
    expect(checkReason('abcd', { max: 3 })).toEqual({ ok: false, kind: 'too_long', max: 3 });
  });
});
