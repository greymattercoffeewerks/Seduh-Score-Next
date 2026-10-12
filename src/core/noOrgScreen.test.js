import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountNoOrgScreen, NO_ORG_HEADING } from './noOrgScreen.js';
import { SIGN_OUT_FAILED_MESSAGE, SIGN_OUT_SLOW_MESSAGE } from './signOut.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

function clientWith(signOut) {
  return { auth: { signOut: vi.fn(signOut) } };
}

function mount(options = {}) {
  const outlet = options.outlet ?? document.createElement('div');
  if (!outlet.isConnected) document.body.appendChild(outlet);
  const client = options.client ?? clientWith(async () => ({ error: null }));
  const screen = mountNoOrgScreen(outlet, {
    client,
    // Nothing waiting to sync, answered at once: these tests are about the button, not the outbox read.
    accountOperations: () => Promise.resolve([]),
    ...options,
  });
  return { outlet, client, screen };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('mountNoOrgScreen', () => {
  it('says plainly that the account is in no organisation, under a real heading', () => {
    const { outlet } = mount({ email: 'sam@example.com' });
    expect(outlet.querySelector('h1').textContent).toBe(NO_ORG_HEADING);
    const [status, action] = [...outlet.querySelectorAll('p')].map((p) => p.textContent);
    expect(status).toBe(
      'You are signed in as sam@example.com. This account is not a member of any organisation, so there are no events to show.',
    );
    expect(action).toContain('ask its owner to add you, then sign out and sign in again');
    expect(action).toContain('If you meant to use a different account');
  });

  it('puts keyboard and screen-reader focus on the heading on arrival', () => {
    const { outlet } = mount();
    const heading = outlet.querySelector('h1');
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('does not take focus when the navigation was already abandoned', () => {
    const controller = new AbortController();
    controller.abort();
    const { outlet } = mount({ signal: controller.signal });
    expect(document.activeElement).not.toBe(outlet.querySelector('h1'));
  });

  it('works without an email, and never prints "null" or "undefined"', () => {
    const { outlet } = mount({ email: null });
    const text = outlet.textContent;
    expect(text).toContain('This account is not a member of any organisation');
    expect(text).not.toMatch(/null|undefined/);
    expect(text).not.toContain('signed in as');
  });

  it('shows the email as text, never as markup', () => {
    const { outlet } = mount({ email: '<img src=x onerror=alert(1)>@evil.test' });
    expect(outlet.querySelector('img')).toBeNull();
    expect(outlet.querySelector('p').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('styles both paragraphs with the class that wraps a long email at 360px', () => {
    const { outlet } = mount({ email: 'a-very-long-address@example.com' });
    const paragraphs = [...outlet.querySelectorAll('p')];
    expect(paragraphs).toHaveLength(2);
    for (const p of paragraphs) expect(p.classList.contains('no-org-message')).toBe(true);
  });

  it('shows no events list and no create form, only a Sign out button', () => {
    const { outlet } = mount();
    expect(outlet.querySelector('ul, form, input')).toBeNull();
    expect(outlet.querySelectorAll('button')).toHaveLength(1);
    expect(outlet.querySelector('button').textContent).toBe('Sign out');
  });

  it('has a polite status region ready for a sign-out failure', () => {
    const { outlet } = mount();
    const region = outlet.querySelector('[role="status"]');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('mounting again into the same outlet replaces the screen rather than stacking a second', () => {
    const outlet = document.createElement('div');
    mount({ outlet });
    mount({ outlet });
    expect(outlet.querySelectorAll('h1')).toHaveLength(1);
    expect(outlet.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('signing out', () => {
  it('signs out, then tells the caller so it can show the sign-in screen', async () => {
    const onSignedOut = vi.fn();
    const { outlet, client } = mount({ onSignedOut });
    outlet.querySelector('button').click();
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('shows "Signing out…" while it works, and stays busy once it has worked', async () => {
    let finish;
    const client = clientWith(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut });
    const button = outlet.querySelector('button');
    button.click();
    await tick(); // the outbox is asked first, then the sign-out starts
    expect(button.textContent).toBe('Signing out…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    // aria-disabled, not native disabled: focus must not fall to <body> mid-click.
    expect(button.disabled).toBe(false);

    finish();
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    // Signed out: nothing re-enables it while the caller swaps the screen.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.textContent).toBe('Signing out…');
  });

  it('ignores a second click while the first is still in flight', async () => {
    let finish;
    const client = clientWith(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut });
    const button = outlet.querySelector('button');
    button.click();
    button.click();
    await tick();
    finish();
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('a sign-out the server refuses says so, keeps focus on the button, and does not claim success', async () => {
    const client = clientWith(async () => ({ error: { message: 'network' } }));
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut });
    const button = outlet.querySelector('button');
    button.focus();
    button.click();
    const region = outlet.querySelector('[role="status"]');
    await vi.waitFor(() => expect(region.textContent).toBe(SIGN_OUT_FAILED_MESSAGE));
    expect(region.dataset.tone).toBe('error');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.textContent).toBe('Sign out');
    expect(onSignedOut).not.toHaveBeenCalled();
    // The live region announces it; the keyboard user can press Enter again without tabbing back.
    expect(document.activeElement).toBe(button);
  });

  it('a sign-out that throws is handled the same way, and a retry can succeed', async () => {
    let attempt = 0;
    const client = clientWith(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return { error: null };
    });
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut });
    const region = outlet.querySelector('[role="status"]');
    outlet.querySelector('button').click();
    await vi.waitFor(() => expect(region.textContent).toBe(SIGN_OUT_FAILED_MESSAGE));

    outlet.querySelector('button').click();
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
    expect(region.textContent).toBe('');
    expect(region.dataset.tone).toBeUndefined();
  });

  it('a sign-out that never answers times out, at the shared limit, with its own message', async () => {
    vi.useFakeTimers();
    const client = clientWith(() => new Promise(() => {}));
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut });
    const region = outlet.querySelector('[role="status"]');
    const button = outlet.querySelector('button');
    button.click();

    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    expect(region.textContent).toBe('');
    expect(button.getAttribute('aria-disabled')).toBe('true');

    await vi.advanceTimersByTimeAsync(2);
    expect(region.textContent).toBe(SIGN_OUT_SLOW_MESSAGE);
    expect(region.dataset.tone).toBe('error');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.textContent).toBe('Sign out');
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('does nothing when the screen was unmounted while the sign-out was in flight', async () => {
    let finish;
    const client = clientWith(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: { message: 'late failure' } });
        }),
    );
    const { outlet, screen } = mount({ client });
    const region = outlet.querySelector('[role="status"]');
    outlet.querySelector('button').click();
    await tick();
    screen.unmount();
    finish();
    await tick();
    expect(region.textContent).toBe('');
  });

  it('does not tell the caller after an unmount, even when the sign-out worked', async () => {
    let finish;
    const client = clientWith(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    const onSignedOut = vi.fn();
    const { outlet, screen } = mount({ client, onSignedOut });
    outlet.querySelector('button').click();
    await tick();
    screen.unmount();
    finish();
    await tick();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('does nothing when the router aborted this navigation while the sign-out was in flight', async () => {
    let finish;
    const client = clientWith(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    const controller = new AbortController();
    const onSignedOut = vi.fn();
    const { outlet } = mount({ client, onSignedOut, signal: controller.signal });
    outlet.querySelector('button').click();
    await tick();
    controller.abort();
    finish();
    await tick();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('a successful sign-out with no callback given does not error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { outlet, client } = mount({ onSignedOut: undefined });
    outlet.querySelector('button').click();
    await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
    await tick();
    expect(outlet.querySelector('h1')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a callback that throws is reported, not left as an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSignedOut = vi.fn(() => {
      throw new Error('router bug');
    });
    const { outlet } = mount({ onSignedOut });
    outlet.querySelector('button').click();
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith('noOrgScreen: onSignedOut threw', expect.any(Error)),
    );
  });
});

describe('mountNoOrgScreen — changes that have not synced (T-TEN.C6)', () => {
  const waiting = (n) => () =>
    Promise.resolve(Array.from({ length: n }, (_, i) => ({ id: `op${i}` })));

  it('first says how many are waiting, and signs out only on the second press', async () => {
    const { outlet, client } = mount({
      email: 'sam@example.com',
      accountOperations: waiting(2),
      armGraceMs: 0,
    });
    const button = outlet.querySelector('button');
    button.click();
    await vi.waitFor(() =>
      expect(outlet.querySelector('[role="status"]').textContent).toBe(
        '2 changes have not been sent yet. They stay on this device and are sent once sam@example.com is signed in. To sign out now, press Sign out again.',
      ),
    );
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Sign out');
    button.click();
    await vi.waitFor(() => expect(client.auth.signOut).toHaveBeenCalledTimes(1));
  });

  it('ignores a press that follows at once', async () => {
    const { outlet, client } = mount({ accountOperations: waiting(1) });
    const button = outlet.querySelector('button');
    button.click();
    await vi.waitFor(() =>
      expect(outlet.querySelector('[role="status"]').textContent).not.toBe(''),
    );
    button.click();
    await tick();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('when it cannot tell, says so and lets the person decide', async () => {
    const { outlet, client } = mount({
      accountOperations: () => Promise.reject(new Error('idb down')),
      armGraceMs: 0,
    });
    const button = outlet.querySelector('button');
    button.click();
    await vi.waitFor(() =>
      expect(outlet.querySelector('[role="status"]').textContent).not.toBe(''),
    );
    expect(outlet.querySelector('[role="status"]').textContent).toContain('Could not check');
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the warning armed when the sign-out then fails', async () => {
    const { outlet } = mount({
      client: clientWith(async () => ({ error: { message: 'network' } })),
      accountOperations: waiting(1),
      armGraceMs: 0,
    });
    const button = outlet.querySelector('button');
    button.click();
    await vi.waitFor(() =>
      expect(outlet.querySelector('[role="status"]').textContent).not.toBe(''),
    );
    button.click();
    await vi.waitFor(() =>
      expect(outlet.querySelector('[role="status"]').textContent).toBe(SIGN_OUT_FAILED_MESSAGE),
    );
    expect(button.textContent).toBe('Sign out');
  });
});
