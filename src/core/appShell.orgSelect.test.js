import { describe, it, expect, vi, afterEach } from 'vitest';

// The organisation select must not die if the caller's check never answers. This needs fake timers, which
// do not mix with the real IndexedDB-backed outbox appShell.test.js uses (see that file's notes), so the
// outbox is mocked here, as main.test.js does.
vi.mock('./outbox.js', () => ({
  listPendingOperations: () => Promise.resolve([]),
  listOtherOperations: () => Promise.resolve({ otherOrg: [], otherAccount: [] }),
  listAccountOperations: () => Promise.resolve([]),
  payloadOrgId: () => null,
  partitionOperations: () => Promise.resolve({ own: [], otherOrg: [], otherAccount: [] }),
  getOutboxOwner: () => undefined,
  isFlushInProgress: () => false,
  onOperationDropped: () => () => {},
}));

const { mountAppShell } = await import('./appShell.js');
const { DEFAULT_LOAD_TIMEOUT_MS } = await import('./timeout.js');

const ORG_A = { id: 'org-a', name: 'Alpha Coffee', slug: 'alpha-coffee' };
const ORG_B = { id: 'org-b', name: 'Bravo Roasters', slug: 'bravo-roasters' };

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the organisation select when the switch never answers', () => {
  it('gives up at the shared timeout, says so, puts the select back, and works again', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const shell = mountAppShell(root, {
      client: {
        auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
        from: () => ({}),
      },
    });
    const onSelect = vi.fn(() => new Promise(() => {}));
    shell.setOrganisation({ orgs: [ORG_A, ORG_B], activeOrgId: 'org-a', onSelect });
    const select = root.querySelector('.app-shell-org-select');
    const notice = root.querySelector('#app-shell-org-notice');

    select.value = 'org-b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(notice.textContent).toBe('');
    expect(select.getAttribute('aria-disabled')).toBe('true');

    await vi.advanceTimersByTimeAsync(2);
    expect(notice.textContent).toBe('Could not switch organisation. Try again.');
    expect(select.value).toBe('org-a');
    expect(select.hasAttribute('aria-disabled')).toBe(false);

    // Not dead: another choice is accepted.
    select.value = 'org-b';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe('Sign out when the outbox read never answers (T-TEN.C6)', () => {
  it('gives up at the shared timeout and says it could not check, instead of leaving the button stuck', async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    mountAppShell(root, {
      client: {
        auth: {
          signOut,
          onAuthStateChange: (cb) => {
            cb('SIGNED_IN', { user: { id: 'u1', email: 'a@test.com' } });
            return { data: { subscription: { unsubscribe: () => {} } } };
          },
        },
        from: () => ({}),
      },
      accountOperations: () => new Promise(() => {}),
    });
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out');
    button.dispatchEvent(new Event('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS + 1);
    expect(root.querySelector('.app-shell-org-notice').textContent).toBe(
      'Could not check whether everything has synced. To sign out now, press Sign out again; anything not sent stays on this device.',
    );
    expect(signOut).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Sign out');
  });
});
