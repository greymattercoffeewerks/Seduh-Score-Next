import { describe, it, expect, vi } from 'vitest';
import { validateEntry, renderEntryForm, mountEntryScreen } from './entryScreen.js';

describe('validateEntry', () => {
  it('requires a non-blank name, max 80 chars', () => {
    expect(validateEntry({ name: '', guess: '1', phone: '1', instagram: '' }).name).toBe(
      'Name is required.',
    );
    expect(
      validateEntry({ name: 'x'.repeat(81), guess: '1', phone: '1', instagram: '' }).name,
    ).toMatch(/too long/);
  });

  it('requires a positive whole number guess, at most 100,000,000', () => {
    expect(validateEntry({ name: 'x', guess: '', phone: '1', instagram: '' }).guess).toMatch(
      /positive whole number/,
    );
    expect(validateEntry({ name: 'x', guess: '0', phone: '1', instagram: '' }).guess).toMatch(
      /positive whole number/,
    );
    expect(validateEntry({ name: 'x', guess: '-5', phone: '1', instagram: '' }).guess).toMatch(
      /positive whole number/,
    );
    expect(validateEntry({ name: 'x', guess: '3.5', phone: '1', instagram: '' }).guess).toMatch(
      /positive whole number/,
    );
    expect(
      validateEntry({ name: 'x', guess: '100000001', phone: '1', instagram: '' }).guess,
    ).toMatch(/too many beans/);
    expect(
      validateEntry({ name: 'x', guess: '100000000', phone: '1', instagram: '' }).guess,
    ).toBeUndefined();
  });

  it('requires phone or instagram, with their own length caps', () => {
    expect(validateEntry({ name: 'x', guess: '1', phone: '', instagram: '' }).contact).toMatch(
      /Enter a phone/,
    );
    expect(
      validateEntry({ name: 'x', guess: '1', phone: '1'.repeat(31), instagram: '' }).contact,
    ).toMatch(/too long/);
    expect(
      validateEntry({ name: 'x', guess: '1', phone: '', instagram: '@'.repeat(51) }).contact,
    ).toMatch(/too long/);
  });

  it('is satisfied by a valid draft with only phone, or only instagram', () => {
    expect(validateEntry({ name: 'Alice', guess: '428', phone: '555-1234', instagram: '' })).toEqual(
      {},
    );
    expect(validateEntry({ name: 'Alice', guess: '428', phone: '', instagram: '@alice' })).toEqual(
      {},
    );
  });
});

describe('renderEntryForm', () => {
  it('renders guess/name/phone/instagram fields and a submit button', () => {
    const form = renderEntryForm(
      { name: '', guess: '', phone: '', instagram: '' },
      { errors: {}, submitting: false, submitError: null },
    );
    expect(form.querySelector('[data-field="guess"]')).not.toBeNull();
    expect(form.querySelector('[data-field="name"]')).not.toBeNull();
    expect(form.querySelector('[data-field="phone"]')).not.toBeNull();
    expect(form.querySelector('[data-field="instagram"]')).not.toBeNull();
    const button = form.querySelector('button[type="submit"]');
    expect(button.textContent).toBe('Lock in my guess 🫘');
    expect(button.disabled).toBe(false);
  });

  it('shows field errors when present', () => {
    const form = renderEntryForm(
      { name: '', guess: '', phone: '', instagram: '' },
      {
        errors: { name: 'Name is required.', guess: 'Enter a positive whole number.' },
        submitting: false,
        submitError: null,
      },
    );
    expect(form.textContent).toContain('Name is required.');
    expect(form.textContent).toContain('Enter a positive whole number.');
  });

  it('disabled shows "Locking it in…" and marks every field aria-disabled/aria-busy, not native-disabled', () => {
    // Native `disabled` would drop focus from whichever field the
    // participant was just typing in the instant a submit starts —
    // aria-disabled/aria-busy convey the same state without doing that.
    // Found in review (ui-accessibility-reviewer).
    const form = renderEntryForm(
      { name: '', guess: '', phone: '', instagram: '' },
      { errors: {}, submitting: true, submitError: null },
    );
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Locking it in…');
    for (const field of ['guess', 'name', 'phone', 'instagram']) {
      const node = form.querySelector(`[data-field="${field}"]`);
      expect(node.disabled).toBe(false);
      expect(node.getAttribute('aria-disabled')).toBe('true');
      expect(node.getAttribute('aria-busy')).toBe('true');
    }
  });

  it('shows a submit error when present', () => {
    const form = renderEntryForm(
      { name: '', guess: '', phone: '', instagram: '' },
      { errors: {}, submitting: false, submitError: "Couldn't submit — check your connection." },
    );
    expect(form.textContent).toContain("Couldn't submit");
  });
});

// Covers the table-query shape (sessions.select().eq().maybeSingle()) and
// the RPC shape (rpc('submit_guess', ...)) — no realtime/channel shape
// needed. entryScreen.js polls fetchSessionStatus on a plain interval
// rather than subscribing to Supabase Realtime — see entryScreen.js's own
// module comment on `pollStatus` for why (a live-verified Realtime delivery
// failure on this project's local stack, plus an independently unresolved
// question about whether a working subscription would honor this table's
// column-scoped anon grant).
function fakeClient({ session = null, rpcError = null, statusReadError = null } = {}) {
  let currentSession = session ? { ...session } : null;
  let failNextRead = !!statusReadError;

  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (failNextRead) {
              failNextRead = false;
              return Promise.resolve({ data: null, error: statusReadError });
            }
            return Promise.resolve({ data: currentSession ? { ...currentSession } : null, error: null });
          },
        }),
      }),
    }),
    rpc: vi.fn(() =>
      rpcError ? Promise.resolve({ error: rpcError }) : Promise.resolve({ data: 'g1', error: null }),
    ),
    _setSession: (patch) => {
      currentSession = { ...currentSession, ...patch };
    },
  };
}

function search(params) {
  return '?' + new URLSearchParams(params).toString();
}

describe('mountEntryScreen', () => {
  it('shows "no-session" when there is no ?session= param at all', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, { client: fakeClient(), search: '' });
    expect(root.querySelector('h1').textContent).toBe('Missing session');
  });

  it('shows "not-found" when the session_id does not resolve to a real row', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, {
      client: fakeClient({ session: null }),
      search: search({ session: 'nonexistent' }),
    });
    expect(root.querySelector('h1').textContent).toBe('No active session found');
  });

  it('shows "not-active" when guess_enabled is false', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, {
      client: fakeClient({ session: { id: 's1', guess_enabled: false, revealed: false } }),
      search: search({ session: 's1' }),
    });
    expect(root.querySelector('h1').textContent).toBe("Guess the Bean isn't running right now");
  });

  it('shows "closed" when revealed is true', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountEntryScreen(root, {
      client: fakeClient({ session: { id: 's1', guess_enabled: true, revealed: true } }),
      search: search({ session: 's1' }),
    });
    expect(root.querySelector('h1').textContent).toBe('Guessing is closed');
    // test-auditor: none of this file's tests previously asserted on
    // document.activeElement at all — the entire isViewChange/focusHeading()
    // block could have been deleted with every test still passing. This
    // (and the two tests below) close that gap, matching the precedent
    // authScreen.test.js/setupScreen.test.js already set for the identical
    // ported pattern.
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });

  it('guess_enabled = false wins over revealed = true when both are set (legacy precedence, ported byte-for-byte)', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, {
      client: fakeClient({ session: { id: 's1', guess_enabled: false, revealed: true } }),
      search: search({ session: 's1' }),
    });
    expect(root.querySelector('h1').textContent).toBe("Guess the Bean isn't running right now");
  });

  it('shows the form when the session is open and not revealed', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, {
      client: fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } }),
      search: search({ session: 's1' }),
    });
    expect(root.querySelector('h1').textContent).toBe('Guess the Bean');
    expect(root.querySelector('form.gtb-entry-form')).not.toBeNull();
  });

  it('a network failure on the initial read shows "not-found", not a crash', async () => {
    const root = document.createElement('div');
    await mountEntryScreen(root, {
      client: fakeClient({ statusReadError: new Error('network unreachable') }),
      search: search({ session: 's1' }),
    });
    expect(root.querySelector('h1').textContent).toBe('No active session found');
  });

  it('?demo=1 skips the existence check and always shows the form, defaulting session id to "demo"', async () => {
    const root = document.createElement('div');
    const client = fakeClient();
    const fromSpy = vi.spyOn(client, 'from');
    await mountEntryScreen(root, { client, search: search({ demo: '1' }) });
    expect(root.querySelector('h1').textContent).toBe('Guess the Bean');
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('a poll tick against a still-open session leaves the form showing', async () => {
    // test-auditor: without the fetch-spy assertion, this test would pass
    // identically even if polling were deleted entirely (the form was
    // already showing before the advance, and nothing forced a fetch to
    // prove one happened). The spy proves a poll tick genuinely fired.
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
      const fromSpy = vi.spyOn(client, 'from');
      await mountEntryScreen(root, { client, search: search({ session: 's1' }) });
      expect(root.querySelector('form.gtb-entry-form')).not.toBeNull();
      const callsBeforePoll = fromSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(4000);
      expect(fromSpy.mock.calls.length).toBeGreaterThan(callsBeforePoll);
      expect(root.querySelector('form.gtb-entry-form')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a poll tick that finds revealed=true closes an open form without a page reload', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
      await mountEntryScreen(root, { client, search: search({ session: 's1' }) });
      expect(root.querySelector('form.gtb-entry-form')).not.toBeNull();

      client._setSession({ revealed: true });
      await vi.advanceTimersByTimeAsync(4000);

      expect(root.querySelector('h1').textContent).toBe('Guessing is closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a poll tick is ignored once the form is no longer showing (e.g. after a submit)', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
      await mountEntryScreen(root, { client, search: search({ session: 's1' }) });

      root.querySelector('[data-field="name"]').value = 'Alice';
      root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-field="guess"]').value = '428';
      root.querySelector('[data-field="guess"]').dispatchEvent(new Event('input', { bubbles: true }));
      root.querySelector('[data-field="phone"]').value = '555-1234';
      root.querySelector('[data-field="phone"]').dispatchEvent(new Event('input', { bubbles: true }));
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('h1').textContent).toBe("You're in, Alice!");

      client._setSession({ revealed: true });
      await vi.advanceTimersByTimeAsync(4000);

      // Must still show the confirmation, not flip to 'closed' — matches
      // legacy's own `if (state.view !== 'form') return;` guard exactly.
      expect(root.querySelector('h1').textContent).toBe("You're in, Alice!");
    } finally {
      vi.useRealTimers();
    }
  });

  it('a blank submit never calls submit_guess, shows validation errors, and moves focus to the first invalid field', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
    await mountEntryScreen(root, { client, search: search({ session: 's1' }) });

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Name is required.');
    // A blank submit fails guess/name/contact all at once — guess is
    // checked first, so focus lands there. test-auditor: no prior test
    // asserted WHERE focus goes on a validation error at all.
    expect(document.activeElement).toBe(root.querySelector('[data-field="guess"]'));
  });

  it('a successful submit calls submit_guess with the entered values and shows the confirmation with confetti', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
    await mountEntryScreen(root, { client, search: search({ session: 's1' }) });

    root.querySelector('[data-field="name"]').value = 'Alice';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="guess"]').value = '428';
    root.querySelector('[data-field="guess"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="instagram"]').value = '@alice';
    root
      .querySelector('[data-field="instagram"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.rpc).toHaveBeenCalledWith('submit_guess', {
      p_session_id: 's1',
      p_name: 'Alice',
      p_guess: 428,
      p_phone: null,
      p_instagram: '@alice',
    });
    expect(root.querySelector('h1').textContent).toBe("You're in, Alice!");
    expect(root.querySelector('.gtb-guess-pill').textContent).toBe('428');
    expect(root.querySelector('.gtb-burst')).not.toBeNull();
  });

  it('the reverse direction: phone provided, instagram omitted, submits p_instagram: null (not empty string)', async () => {
    // test-auditor: the only other exact-args test covers phone-omitted ->
    // null; without this, a regression that dropped sessions.js's own
    // `instagram || null` coercion (leaving a bare `instagram`, sending ''
    // instead of null) would pass every other test in this file undetected.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
    await mountEntryScreen(root, { client, search: search({ session: 's1' }) });

    root.querySelector('[data-field="name"]').value = 'Bob';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="guess"]').value = '200';
    root.querySelector('[data-field="guess"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="phone"]').value = '555-6789';
    root.querySelector('[data-field="phone"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.rpc).toHaveBeenCalledWith('submit_guess', {
      p_session_id: 's1',
      p_name: 'Bob',
      p_guess: 200,
      p_phone: '555-6789',
      p_instagram: null,
    });
  });

  it('?demo=1 never calls submit_guess on submit, but still shows the confirmation', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient();
    await mountEntryScreen(root, { client, search: search({ demo: '1' }) });

    root.querySelector('[data-field="name"]').value = 'Demo Alice';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="guess"]').value = '100';
    root.querySelector('[data-field="guess"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="phone"]').value = '555-1234';
    root.querySelector('[data-field="phone"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.rpc).not.toHaveBeenCalled();
    expect(root.querySelector('h1').textContent).toBe("You're in, Demo Alice!");
  });

  it('a failed submit_guess call shows the error and stays on the form (never fakes a confirmation)', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      session: { id: 's1', guess_enabled: true, revealed: false },
      rpcError: new Error('submit_guess: session is not open for guessing'),
    });
    await mountEntryScreen(root, { client, search: search({ session: 's1' }) });

    root.querySelector('[data-field="name"]').value = 'Alice';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="guess"]').value = '428';
    root.querySelector('[data-field="guess"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="phone"]').value = '555-1234';
    root.querySelector('[data-field="phone"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Guess the Bean');
    expect(root.textContent).toContain('session is not open for guessing');
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    // test-auditor: no prior test asserted focus moves to the submit-error
    // region specifically.
    expect(document.activeElement).toBe(root.querySelector('#gtb-submit-error'));
  });

  it('unmount() stops the status poll — no further fetchSessionStatus calls after it', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      const client = fakeClient({ session: { id: 's1', guess_enabled: true, revealed: false } });
      const fromSpy = vi.spyOn(client, 'from');
      const handle = await mountEntryScreen(root, { client, search: search({ session: 's1' }) });
      expect(typeof handle.unmount).toBe('function');
      const callsBeforeUnmount = fromSpy.mock.calls.length;

      handle.unmount();
      await vi.advanceTimersByTimeAsync(20000);

      // If clearInterval(pollTimer) were deleted from unmount(), several
      // more poll ticks would have fired in that 20s window.
      expect(fromSpy.mock.calls.length).toBe(callsBeforeUnmount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmount() on a no-session/demo mount (no poll ever started) does not throw', async () => {
    const root = document.createElement('div');
    const handle = await mountEntryScreen(root, { client: fakeClient(), search: '' });
    expect(() => handle.unmount()).not.toThrow();
  });

  it('never writes to root again once its own signal is aborted mid-load', async () => {
    // The mount()-then-immediately-abort()-then-await shape doesn't actually
    // prove anything (test-auditor): if boot()'s own fetch resolves before
    // the marker line runs, the abort makes no observable difference either
    // way. This holds the initial fetch open PAST the abort call and PAST
    // the marker being written, then resolves it — only a genuine
    // `signal?.aborted` guard in render() stops the late-resolving boot()
    // from clobbering the marker. Same shape as authScreen.test.js's own
    // equivalent test.
    let resolveStatus;
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              new Promise((resolve) => {
                resolveStatus = () =>
                  resolve({ data: { id: 's1', guess_enabled: true, revealed: false }, error: null });
              }),
          }),
        }),
      }),
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountEntryScreen(root, {
      client,
      search: search({ session: 's1' }),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveStatus).toBeDefined();

    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';
    controller.abort();
    resolveStatus();
    await mountPromise;

    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Guess the Bean');
  });
});
