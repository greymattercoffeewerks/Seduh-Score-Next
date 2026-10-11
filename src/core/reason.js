// Validation mechanics shared by format-specific reason fields. Callers own the
// wording and decide whether an invalid result is returned or thrown.
export const REASON_MAX = 120;

// Pure. A reason is text that remains after trimming and fits within the caller's
// limit. JavaScript's trim removes NBSP, which keeps this client check at least as
// strict as the database constraint.
export function checkReason(raw, { max = REASON_MAX } = {}) {
  if (typeof raw !== 'string') return { ok: false, kind: 'empty', max };

  const reason = raw.trim();
  if (reason === '') return { ok: false, kind: 'empty', max };
  if (reason.length > max) return { ok: false, kind: 'too_long', max };
  return { ok: true, reason };
}
