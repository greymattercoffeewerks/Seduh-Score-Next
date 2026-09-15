import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCreateDraft, findWinnerContact, mountSetupScreen } from './setupScreen.js';

describe('validateCreateDraft', () => {
  it('requires a non-blank name', () => {
    expect(validateCreateDraft({ name: '', beanCount: '10' }).name).toBe(
      'Session name is required.',
    );
  });

  it('requires a positive integer bean count', () => {
    expect(validateCreateDraft({ name: 'x', beanCount: '' }).beanCount).toMatch(/greater than 0/);
    expect(validateCreateDraft({ name: 'x', beanCount: '0' }).beanCount).toMatch(/greater than 0/);
    expect(validateCreateDraft({ name: 'x', beanCount: 'abc' }).beanCount).toMatch(
      /greater than 0/,
    );
  });

  it('is satisfied by a valid draft', () => {
    expect(validateCreateDraft({ name: 'My Session', beanCount: '428' })).toEqual({});
  });
});

// `failOn` injects a Supabase-shaped `{ error }` failure for one named
// operation ('load' | 'update' | 'delete' | 'rpc') — used to exercise
// setupScreen.js's five separate catch blocks, none of which any test
// covered before (test-auditor): a regression that swallowed an error
// silently, crashed instead of catching, or left `state.busy` stuck true
// would have passed every one of this file's original tests.
function fakeClient({ sessions = [], failOn = null, exportRows = [] } = {}) {
  let rows = [...sessions];
  const auth = {
    getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
  };
  const sessionsTable = {
    select: () => sessionsTable,
    order: () =>
      failOn === 'load'
        ? Promise.resolve({ data: null, error: new Error('could not load sessions') })
        : Promise.resolve({ data: rows, error: null }),
    insert: (row) => {
      const created = {
        id: `s${rows.length + 1}`,
        guess_enabled: true,
        revealed: false,
        orientation: 'landscape',
        ...row,
      };
      rows = [created, ...rows];
      return {
        select: () => ({ single: () => Promise.resolve({ data: created, error: null }) }),
      };
    },
    update: (patch) => ({
      eq: (col, val) => ({
        select: () => ({
          single: () => {
            if (failOn === 'update') {
              return Promise.resolve({
                data: null,
                error: new Error('could not save that change'),
              });
            }
            rows = rows.map((r) => (r[col] === val ? { ...r, ...patch } : r));
            return Promise.resolve({ data: rows.find((r) => r[col] === val), error: null });
          },
        }),
      }),
    }),
    delete: () => ({
      eq: (col, val) => {
        if (failOn === 'delete') {
          return Promise.resolve({ error: new Error('could not end that session') });
        }
        rows = rows.filter((r) => r[col] !== val);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return {
    auth,
    from: (table) => {
      if (table === 'sessions') return sessionsTable;
      if (table === 'guesses') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: exportRows.map(({ id, name, guess, created_at }) => ({
                  id,
                  name,
                  guess,
                  created_at,
                })),
                error: null,
              }),
          }),
        };
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: exportRows.map(({ id, phone, instagram }) => ({
                  guess_id: id,
                  phone,
                  instagram,
                })),
                error: null,
              }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: vi.fn(() =>
      failOn === 'rpc'
        ? Promise.resolve({ error: new Error('not the session creator') })
        : Promise.resolve({ error: null }),
    ),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  if (!global.URL.createObjectURL) global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = vi.fn();
});

describe('findWinnerContact', () => {
  it('uses the earliest arrival when two guesses are equally close', () => {
    const first = { name: 'First', guess: 420, phone: '111' };
    const later = { name: 'Later', guess: 436, phone: '222' };
    expect(findWinnerContact([first, later], 428)).toBe(first);
  });
});

describe('mountSetupScreen', () => {
  it('shows the create form directly when the creator has no sessions yet', async () => {
    const root = document.createElement('div');
    await mountSetupScreen(root, { client: fakeClient({ sessions: [] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('h1').textContent).toBe('Create a session');
    expect(root.querySelector('form.gtb-setup-form')).not.toBeNull();
  });

  it('shows the session list when sessions already exist', async () => {
    const root = document.createElement('div');
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [{ id: 's1', name: 'Existing Session', guess_enabled: true, revealed: false }],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('h1').textContent).toBe('Your sessions');
    expect(root.textContent).toContain('Existing Session');
  });

  it('creating a session with a valid draft moves straight to its detail view', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, { client: fakeClient({ sessions: [] }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    root.querySelector('[data-field="name"]').value = 'Pop-up Session';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="beanCount"]').value = '428';
    root
      .querySelector('[data-field="beanCount"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Pop-up Session');
    expect(root.textContent).toContain('/guess-the-bean/play/?session=s1');
    expect(root.textContent).toContain('/guess-the-bean/display/?session=s1');
  });

  it('a blank create submit never calls the API and shows validation errors', async () => {
    const client = fakeClient({ sessions: [] });
    const insertSpy = vi.spyOn(client.from('sessions'), 'insert');
    const root = document.createElement('div');
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertSpy).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Session name is required.');
  });

  it('toggling "Guessing open" persists the change via updateSession', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggle = root.querySelector('#gtb-guess-enabled-toggle');
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('#gtb-guess-enabled-toggle').checked).toBe(false);
  });

  it('shows the revealed winner contact without needing the Supabase dashboard', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Results',
            bean_count: 428,
            guess_enabled: true,
            revealed: true,
            orientation: 'landscape',
          },
        ],
        exportRows: [
          { id: 'g1', name: 'Near', guess: 431, phone: '111', instagram: null, created_at: '1' },
          {
            id: 'g2',
            name: 'Winner',
            guess: 428,
            phone: null,
            instagram: '@winner',
            created_at: '2',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Show winner contact')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).toContain('Winner');
    expect(root.textContent).toContain('Instagram: @winner');
  });

  it('does not compute a winner from a click on a still-open session', async () => {
    // The button is only aria-disabled pre-reveal (never native `disabled`,
    // so it stays focusable) — aria-disabled doesn't itself block a click,
    // same reason every other danger-zone/toggle handler re-checks state
    // explicitly rather than trusting the attribute alone.
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Still open',
            bean_count: 428,
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
        exportRows: [
          { id: 'g1', name: 'Near', guess: 431, phone: '111', instagram: null, created_at: '1' },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    [...root.querySelectorAll('button')]
      .find((button) => button.textContent === 'Show winner contact')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.textContent).not.toContain('Near');
    expect(root.textContent).toContain('Available after you reveal the result.');
  });

  it('reverts a native toggle flipped while a previous toggle is still in flight, rather than leaving it stuck wrong', async () => {
    // The checkbox is aria-disabled (not native disabled) while busy —
    // found in review (code-reviewer): unlike a <button>, the browser
    // flips a checkbox's own `checked` as part of default handling before
    // the change listener even runs, and aria-disabled doesn't suppress
    // that. Without handleToggle's own re-render on its early-return path,
    // a second toggle during the first request's flight would leave the
    // control showing the user's stray click, silently wrong, until the
    // FIRST request resolves and corrects it later.
    let resolveUpdate;
    const client = fakeClient({
      sessions: [
        {
          id: 's1',
          name: 'Session One',
          guess_enabled: true,
          revealed: false,
          orientation: 'landscape',
        },
      ],
    });
    const baseFrom = client.from;
    client.from = (table) => {
      if (table !== 'sessions') return baseFrom(table);
      return {
        ...baseFrom(table),
        update: (patch) => ({
          eq: () => ({
            select: () => ({
              single: () =>
                new Promise((resolve) => {
                  resolveUpdate = () =>
                    resolve({
                      data: {
                        id: 's1',
                        name: 'Session One',
                        revealed: false,
                        orientation: 'landscape',
                        guess_enabled: true,
                        ...patch,
                      },
                      error: null,
                    });
                }),
            }),
          }),
        }),
      };
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    root.querySelector('#gtb-guess-enabled-toggle').checked = false;
    root
      .querySelector('#gtb-guess-enabled-toggle')
      .dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveUpdate).toBeDefined();

    // A stray second toggle while the first request is still in flight —
    // the browser would have already flipped `.checked` back to `true`
    // itself before this dispatch, same as it would for a real click.
    root.querySelector('#gtb-guess-enabled-toggle').checked = true;
    root
      .querySelector('#gtb-guess-enabled-toggle')
      .dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Snapped back to the real, still-unconfirmed server value (true) —
    // not left showing the stray click.
    expect(root.querySelector('#gtb-guess-enabled-toggle').checked).toBe(true);

    resolveUpdate();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps focus on the toggle checkbox across the re-render its own change triggers', async () => {
    // The broader gap this task closes beyond the busy-disable case: EVERY
    // render() here does a full root.innerHTML='' teardown, not just the
    // busy-gated ones — a plain toggle change, with no busy state involved
    // at all, would still drop focus to <body> without
    // withFocusPreservation restoring it by the checkbox's stable id.
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggle = root.querySelector('#gtb-guess-enabled-toggle');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(root.querySelector('#gtb-guess-enabled-toggle'));
  });

  it('Reveal is aria-disabled (not native-disabled) once the session is already revealed', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: true,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const revealButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Revealed',
    );
    expect(revealButton).not.toBeUndefined();
    // Native `disabled` is deliberately NOT used here — it would remove a
    // focused Reveal button from the focus order mid-interaction with no
    // way back (ui-accessibility-reviewer). aria-disabled conveys the same
    // state to assistive tech while staying focusable.
    expect(revealButton.disabled).toBe(false);
    expect(revealButton.getAttribute('aria-disabled')).toBe('true');

    // Prove the click is still suppressed — not by the (removed) native
    // disabled attribute, but by handleReveal's own explicit re-check
    // (test-auditor: this test previously never clicked the button, so it
    // would pass identically even if the click listener were deleted).
    revealButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('.gtb-toast')).toBeNull();
    expect(
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Revealed'),
    ).not.toBeUndefined();
  });

  it('End Session asks for confirmation, then removes the session and returns to the create view', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const endButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'End session',
    );
    endButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.confirm).toHaveBeenCalled();
    expect(root.querySelector('h1').textContent).toBe('Create a session');
  });

  it('declining the End Session confirmation leaves the session untouched', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const endButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'End session',
    );
    endButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Session One');
  });

  it('Reset Data calls the RPC and shows a confirmation toast', async () => {
    const client = fakeClient({
      sessions: [
        {
          id: 's1',
          name: 'Session One',
          guess_enabled: true,
          revealed: true,
          orientation: 'landscape',
        },
      ],
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resetButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset data',
    );
    resetButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.rpc).toHaveBeenCalledWith('reset_guess_session_data', { p_session_id: 's1' });
    expect(root.querySelector('.gtb-toast').textContent).toMatch(/cleared/i);
  });

  it('double-clicking Export data only fetches the export once', async () => {
    // Same race code-reviewer flagged for the danger-zone handlers (see
    // "double-clicking End Session..." below), but for handleExport
    // specifically: it used to rely entirely on the button's native
    // `disabled` attribute for accidental double-click protection — gone
    // now that the button is aria-disabled instead (setBusyDisabled),
    // which doesn't block clicks — so handleExport gained its own explicit
    // `state.busy` re-check. This proves that guard actually suppresses
    // the second concurrent fetch, not merely that the button's attribute
    // changed.
    let resolveGuesses;
    let guessesFetchCount = 0;
    const client = fakeClient({
      sessions: [
        {
          id: 's1',
          name: 'Session One',
          guess_enabled: true,
          revealed: false,
          orientation: 'landscape',
        },
      ],
    });
    const baseFrom = client.from;
    client.from = (table) => {
      if (table === 'guesses') {
        return {
          select: () => ({
            eq: () => {
              guessesFetchCount += 1;
              return new Promise((resolve) => {
                resolveGuesses = () => resolve({ data: [], error: null });
              });
            },
          }),
        };
      }
      return baseFrom(table);
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const exportButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Export data',
    );
    exportButton.click();
    exportButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(guessesFetchCount).toBe(1);

    resolveGuesses();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('.gtb-toast').textContent).toMatch(/exported/i);
  });

  it('renders a QR code SVG pointing at the participant URL', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-qr svg')).not.toBeNull();
  });

  it('unmount() clears the pending toast timer, not just a no-throw call', async () => {
    // test-auditor: the original version of this test only checked
    // `typeof handle.unmount === 'function'` and that calling it didn't
    // throw — deleting `clearTimeout(toastTimer)` from unmount() would not
    // have been caught. This proves the timer is genuinely cleared: without
    // the clear, the pending toast-dismiss render() would still fire after
    // the delay and mutate `root` again.
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const handle = await mountSetupScreen(root, {
        client: fakeClient({
          sessions: [
            {
              id: 's1',
              name: 'Session One',
              guess_enabled: true,
              revealed: false,
              orientation: 'landscape',
            },
          ],
        }),
      });
      await vi.advanceTimersByTimeAsync(0);
      root.querySelector('.gtb-session-row').click();
      await vi.advanceTimersByTimeAsync(0);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      });
      const copyButton = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy');
      copyButton.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('.gtb-toast')).not.toBeNull();

      handle.unmount();
      root.innerHTML = '<div id="marker"></div>';
      await vi.advanceTimersByTimeAsync(2000);

      // If the timer weren't cleared, its render() would have wiped this
      // marker out (render() always does root.innerHTML = '' first).
      expect(root.querySelector('#marker')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed initial load shows a toast (not a permanent banner) and does not crash', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, { client: fakeClient({ sessions: [], failOn: 'load' }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-toast').textContent).toMatch(/could not load sessions/i);
    expect(root.querySelector('h1').textContent).toBe('Your sessions');
  });

  it('a failed toggle shows an error toast and re-enables the control', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
        failOn: 'update',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggle = root.querySelector('#gtb-guess-enabled-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-toast').textContent).toMatch(/could not save that change/i);
    expect(
      root.querySelector('#gtb-guess-enabled-toggle').getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('a failed Reset Data shows an error toast and re-enables the buttons', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: true,
            orientation: 'landscape',
          },
        ],
        failOn: 'rpc',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resetButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset data',
    );
    resetButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-toast').textContent).toMatch(/not the session creator/i);
    expect(
      [...root.querySelectorAll('button')]
        .find((b) => b.textContent === 'Reset data')
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('a failed End Session shows an error toast and stays on the detail view', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountSetupScreen(root, {
      client: fakeClient({
        sessions: [
          {
            id: 's1',
            name: 'Session One',
            guess_enabled: true,
            revealed: false,
            orientation: 'landscape',
          },
        ],
        failOn: 'delete',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const endButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'End session',
    );
    endButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-toast').textContent).toMatch(/could not end that session/i);
    expect(root.querySelector('h1').textContent).toBe('Session One');
  });

  it('a failed create shows the error inline and never leaves the create view', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ sessions: [] });
    client.from('sessions').insert = () => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: new Error('name already taken') }),
      }),
    });
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    root.querySelector('[data-field="name"]').value = 'Pop-up Session';
    root.querySelector('[data-field="name"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="beanCount"]').value = '428';
    root
      .querySelector('[data-field="beanCount"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('h1').textContent).toBe('Create a session');
    expect(root.textContent).toContain('name already taken');
  });

  it('double-clicking End Session only asks for confirmation and deletes once', async () => {
    // Guards against the race code-reviewer flagged: render() fully
    // replaces the DOM on every state change, so a click already queued
    // against the PREVIOUS (about-to-be-detached) button node still fires
    // regardless of that stale node's own disabled attribute — only a
    // live re-check of state.busy inside the handler itself prevents a
    // second confirm()/delete from firing concurrently with the first.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const deleteSpy = vi.fn(() => Promise.resolve({ error: null }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({
      sessions: [
        {
          id: 's1',
          name: 'Session One',
          guess_enabled: true,
          revealed: false,
          orientation: 'landscape',
        },
      ],
    });
    client.from('sessions').delete = () => ({ eq: deleteSpy });
    await mountSetupScreen(root, { client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector('.gtb-session-row').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const endButton = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'End session',
    );
    endButton.click();
    endButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('never writes to root again once its own signal is aborted mid-load', async () => {
    const controller = new AbortController();
    const client = fakeClient({ sessions: [] });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountSetupScreen(root, { client, signal: controller.signal });
    controller.abort();
    await mountPromise;
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
  });
});
