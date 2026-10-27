import { describe, it, expect } from 'vitest';
import { describeError, describeGatingError, SEDUH_SCORE_CONTACT } from './errors.js';

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

describe('describeGatingError', () => {
  it.each([
    [
      'entitlement_cap_reached',
      'cup_taster_participants',
      'This event has reached its entry limit.',
    ],
    [
      'entitlement_cap_reached',
      'events_open',
      'You already have an open event, and your plan allows one at a time. If it is a test event, delete it to make room.',
    ],
    ['entitlement_required', 'btc_format', 'This format needs a plan that includes it.'],
  ])('describes %s for %s without exposing database vocabulary', (hint, key, expected) => {
    const result = describeGatingError({ code: '42501', hint, details: key });
    expect(result).toEqual({
      hint,
      key,
      message: `${expected} Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
    });
  });

  it('tells the organiser how to reach the team: the phone number and the email, in every gating message', () => {
    expect(SEDUH_SCORE_CONTACT).toBe(
      'Contact the Seduh Score team on +673\u00a0835\u00a01231 or greymatter.cw@outlook.com',
    );
    for (const key of ['cup_taster_participants', 'events_open', 'btc_format', 'future_key']) {
      const { message } = describeGatingError({
        code: '42501',
        hint: 'entitlement_required',
        details: key,
      });
      expect(message, key).toContain('+673\u00a0835\u00a01231');
      expect(message, key).toContain('greymatter.cw@outlook.com');
    }
  });

  it('uses calm fallback copy for an unknown gated key', () => {
    expect(
      describeGatingError({ code: '42501', hint: 'entitlement_required', detail: 'future_key' }),
    ).toEqual({
      hint: 'entitlement_required',
      key: 'future_key',
      message: `This action is not available with this plan. Nothing already saved has been lost. ${SEDUH_SCORE_CONTACT}`,
    });
  });

  it('leaves unknown errors on the existing generic path', () => {
    const error = { code: '42501', hint: 'org_member_required', details: 'anything' };
    expect(describeGatingError(error)).toBeNull();
    expect(describeError(error)).toBe('Something went wrong saving that — try again.');
  });

  it('leaves an ordinary 42501 with no hint (a row-level-security denial, finish_event refusing) on the generic path', () => {
    for (const error of [
      {
        code: '42501',
        hint: null,
        details: null,
        message: 'new row violates row-level security policy',
      },
      { code: '42501', message: 'finish_event: event not found' },
      { code: '42501', hint: '', details: 'cup_taster_participants' },
    ]) {
      expect(describeGatingError(error)).toBeNull();
      expect(describeError(error)).toBe('Something went wrong saving that — try again.');
    }
  });

  it('does not treat non-42501 errors as plan gating', () => {
    expect(
      describeError({ code: '23505', hint: 'entitlement_required', details: 'btc_format' }),
    ).toMatch(/^Something went wrong saving that/);
  });
});
