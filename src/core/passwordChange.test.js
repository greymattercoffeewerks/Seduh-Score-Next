import { describe, it, expect, vi } from 'vitest';
import {
  savePasswordAndEndOtherSessions,
  endOtherSessions,
  passwordChangeBlockedByAuthenticator,
} from './passwordChange.js';

function client({ updateUser, signOut, aal } = {}) {
  return {
    auth: {
      updateUser: vi.fn(updateUser ?? (() => Promise.resolve({ data: {}, error: null }))),
      signOut: vi.fn(signOut ?? (() => Promise.resolve({ error: null }))),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(
          aal ?? (() => Promise.resolve({ data: {}, error: null })),
        ),
      },
    },
  };
}

describe('savePasswordAndEndOtherSessions', () => {
  it('saves the password with the one-time flag cleared, then ends the OTHER sessions (never this one)', async () => {
    const c = client();
    const result = await savePasswordAndEndOtherSessions(c, 'correct-horse');
    expect(result).toEqual({ error: null, othersSignedOut: true });
    expect(c.auth.updateUser).toHaveBeenCalledWith({
      password: 'correct-horse',
      data: { must_change_password: false },
    });
    expect(c.auth.signOut).toHaveBeenCalledTimes(1);
    expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('sends current_password only when one is given', async () => {
    const withCurrent = client();
    await savePasswordAndEndOtherSessions(withCurrent, 'new-password-1', {
      currentPassword: 'old',
    });
    expect(withCurrent.auth.updateUser).toHaveBeenCalledWith({
      password: 'new-password-1',
      current_password: 'old',
      data: { must_change_password: false },
    });
    const without = client();
    await savePasswordAndEndOtherSessions(without, 'new-password-1', { currentPassword: '' });
    expect(without.auth.updateUser.mock.calls[0][0]).not.toHaveProperty('current_password');
  });

  it('a refusal is returned and ends no session', async () => {
    const c = client({
      updateUser: () => Promise.resolve({ data: null, error: { code: 'weak_password' } }),
    });
    const result = await savePasswordAndEndOtherSessions(c, 'correct-horse');
    expect(result.error.code).toBe('weak_password');
    expect(c.auth.signOut).not.toHaveBeenCalled();
  });

  it('a save that throws throws (the form words it), and ends no session', async () => {
    const c = client({ updateUser: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(savePasswordAndEndOtherSessions(c, 'correct-horse')).rejects.toThrow(
      'Failed to fetch',
    );
    expect(c.auth.signOut).not.toHaveBeenCalled();
  });

  it('a save that never settles throws a timeout', async () => {
    vi.useFakeTimers();
    try {
      const c = client({ updateUser: () => new Promise(() => {}) });
      const pending = savePasswordAndEndOtherSessions(c, 'correct-horse');
      const assertion = expect(pending).rejects.toMatchObject({ timedOut: true });
      await vi.advanceTimersByTimeAsync(10001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('endOtherSessions', () => {
  it.each([
    ['a refusal', () => Promise.resolve({ error: { message: 'x' } })],
    ['a throw', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('%s is reported as not done, never thrown', async (_label, signOut) => {
    expect(await endOtherSessions(client({ signOut }))).toBe(false);
  });

  it('a sign-out that never settles is reported as not done', async () => {
    vi.useFakeTimers();
    try {
      const pending = endOtherSessions(client({ signOut: () => new Promise(() => {}) }));
      await vi.advanceTimersByTimeAsync(10001);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('passwordChangeBlockedByAuthenticator', () => {
  it.each([
    [
      'signed in at level 1 with a verified factor',
      { currentLevel: 'aal1', nextLevel: 'aal2' },
      true,
    ],
    ['no factor', { currentLevel: 'aal1', nextLevel: 'aal1' }, false],
    ['a factor already used this session', { currentLevel: 'aal2', nextLevel: 'aal2' }, false],
    ['nothing known', undefined, false],
  ])('%s', async (_label, data, blocked) => {
    const c = client({ aal: () => Promise.resolve({ data, error: null }) });
    expect(await passwordChangeBlockedByAuthenticator(c)).toBe(blocked);
  });

  it('if it cannot be answered, the form is not hidden (the server’s refusal is the backstop)', async () => {
    const c = client({ aal: () => Promise.reject(new Error('boom')) });
    expect(await passwordChangeBlockedByAuthenticator(c)).toBe(false);
  });
});
