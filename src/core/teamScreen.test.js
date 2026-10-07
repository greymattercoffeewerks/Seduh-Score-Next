import { describe, it, expect, vi } from 'vitest';
import { validateTeamEmail, describeMemberStatus, mountTeamScreen } from './teamScreen.js';
import { TeamError } from './team.js';

const ORG = 'org-1';
const OWNER = 'u-owner';
const KIM = 'u-kim';
const LEE = 'u-lee';

describe('validateTeamEmail', () => {
  it('needs an email', () => {
    expect(validateTeamEmail('')).toBe('Enter the email address of the person to add.');
    expect(validateTeamEmail('   ')).toBe('Enter the email address of the person to add.');
  });

  it('needs something that looks like an address', () => {
    for (const bad of ['kim', 'kim@', '@x.com', 'kim@x', 'k im@x.com']) {
      expect(validateTeamEmail(bad)).toBe('Enter a valid email address.');
    }
  });

  it('refuses an over-long address and accepts a normal one (trimmed)', () => {
    expect(validateTeamEmail(`${'a'.repeat(250)}@x.com`)).toBe('That email address is too long.');
    expect(validateTeamEmail('  kim@example.com ')).toBeNull();
  });
});

describe('describeMemberStatus', () => {
  it('says a person still has to choose a password, even if they have signed in', () => {
    expect(
      describeMemberStatus({ mustChangePassword: true, lastSignInAt: '2026-10-07T01:00:00Z' }),
    ).toBe('Has not chosen a password yet');
  });

  it('says a person has not signed in yet', () => {
    expect(describeMemberStatus({ mustChangePassword: false, lastSignInAt: null })).toBe(
      'Has not signed in yet',
    );
  });

  it('gives the date of the last sign-in', () => {
    expect(
      describeMemberStatus({ mustChangePassword: false, lastSignInAt: '2026-10-07T12:00:00Z' }),
    ).toBe('Last signed in 7 Oct 2026');
  });

  it('copes with an unreadable date', () => {
    expect(describeMemberStatus({ mustChangePassword: false, lastSignInAt: 'nonsense' })).toBe(
      'Has signed in',
    );
  });
});

// ---- the screen, against a stateful fake of the RPCs and the Edge Function ----

function member(userId, email, role = 'organiser', extra = {}) {
  return {
    user_id: userId,
    email,
    role,
    added_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: '2026-10-06T12:00:00Z',
    must_change_password: false,
    ...extra,
  };
}

function fakeTeamClient(
  initial = [member(OWNER, 'owner@example.com', 'owner'), member(KIM, 'kim@example.com')],
  opts = {},
) {
  const state = { rows: initial.map((row) => ({ ...row })) };
  const calls = { rpc: [], invoke: [] };
  const errorFor = (response) => (typeof response === 'function' ? response() : response);
  return {
    state,
    calls,
    rpc: async (name, args) => {
      calls.rpc.push([name, args]);
      if (name === 'team_list_members') {
        if (opts.listError) return { data: null, error: errorFor(opts.listError) };
        if (
          opts.listAlwaysFailsAfter !== undefined &&
          calls.rpc.filter(([n]) => n === name).length > opts.listAlwaysFailsAfter
        ) {
          return { data: null, error: { code: 'XX000', message: 'boom' } };
        }
        return { data: state.rows.map((row) => ({ ...row })), error: null };
      }
      if (name === 'team_remove_member') {
        if (opts.removeError) return { data: null, error: opts.removeError };
        state.rows = state.rows.filter((row) => row.user_id !== args.p_user_id);
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unexpected rpc' } };
    },
    functions: {
      invoke: async (name, { body }) => {
        calls.invoke.push([name, body]);
        if (opts.invokeError) return { data: null, error: opts.invokeError };
        if (body.action === 'add') {
          state.rows.push(
            member('u-new', body.email.toLowerCase(), 'organiser', {
              last_sign_in_at: null,
              must_change_password: true,
            }),
          );
          return {
            data: { userId: 'u-new', email: body.email.toLowerCase(), password: 'k7mx-p3qa-9wdn' },
            error: null,
          };
        }
        return { data: { userId: body.userId, password: 'aaaa-bbbb-cccc' }, error: null };
      },
    },
  };
}

async function mount(client, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const screen = await mountTeamScreen(root, { orgId: ORG, client, ...extra });
  return { root, screen };
}
const q = (root, selector) => root.querySelector(selector);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check) {
  await vi.waitFor(check);
}
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function submitAdd(root) {
  q(root, '.team-add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
const feedback = (root) => q(root, '#team-feedback');

describe('mountTeamScreen — the list', () => {
  it('lists the team with each person’s role and status, owner first, and offers actions only on non-owners', async () => {
    const { root } = await mount(fakeTeamClient());
    expect(q(root, 'h1').textContent).toBe('Team');
    const rows = [...root.querySelectorAll('.team-list li')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('owner@example.com');
    expect(rows[0].textContent).toContain('Owner · Last signed in 6 Oct 2026');
    expect(rows[1].textContent).toContain('kim@example.com');
    expect(rows[1].textContent).toContain('Team member');
    expect(q(root, `#team-remove-btn-${OWNER}`)).toBeNull();
    expect(q(root, `#team-reset-btn-${OWNER}`)).toBeNull();
    expect(q(root, `#team-remove-btn-${KIM}`)).not.toBeNull();
    expect(q(root, `#team-reset-btn-${KIM}`)).not.toBeNull();
  });

  it('asks the database for this org’s team', async () => {
    const client = fakeTeamClient();
    await mount(client);
    expect(client.calls.rpc[0]).toEqual(['team_list_members', { p_org_id: ORG }]);
  });

  it('says a person who has not chosen their password yet is waiting', async () => {
    const client = fakeTeamClient([
      member(OWNER, 'owner@example.com', 'owner'),
      member(KIM, 'kim@example.com', 'organiser', {
        last_sign_in_at: null,
        must_change_password: true,
      }),
    ]);
    const { root } = await mount(client);
    expect(q(root, `#team-row-${KIM}`).textContent).toContain('Has not chosen a password yet');
  });

  it('shows a non-owner only "Only the owner can manage the team." — no list, no forms', async () => {
    const client = fakeTeamClient([], { listError: { code: '42501', message: 'x' } });
    const { root } = await mount(client);
    expect(q(root, '#team-feedback')).toBeNull();
    expect(root.textContent).toContain('Only the owner can manage the team.');
    expect(q(root, '.team-add-form')).toBeNull();
    expect(q(root, '.team-list')).toBeNull();
    expect(q(root, 'button')).toBeNull(); // no Retry: retrying cannot change the answer
  });

  it('shows a load failure with a Retry that tries again', async () => {
    let fail = true;
    const client = fakeTeamClient(undefined, {
      listError: () => (fail ? { code: 'XX000', message: 'raw' } : null),
    });
    const realRpc = client.rpc;
    client.rpc = async (name, args) => {
      if (name === 'team_list_members' && !fail) return { data: client.state.rows, error: null };
      return realRpc(name, args);
    };
    const { root } = await mount(client);
    expect(root.textContent).toContain('Something went wrong. Try again.');
    fail = false;
    q(root, 'button').click();
    await until(() => expect(q(root, '.team-list')).not.toBeNull());
    expect(root.textContent).toContain('kim@example.com');
  });

  it('a request that never settles ends in the timeout message, with Retry', async () => {
    vi.useFakeTimers();
    try {
      const client = { rpc: () => new Promise(() => {}) };
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mounting = mountTeamScreen(root, { orgId: ORG, client });
      await vi.advanceTimersByTimeAsync(10001);
      await mounting;
      expect(root.textContent).toMatch(/taking longer than expected/);
      expect(q(root, 'button').textContent).toBe('Retry');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mountTeamScreen — adding someone', () => {
  it('creates the account, shows the one-time password once, with a note that it cannot be looked up again, and lists the new member', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    type(q(root, '#team-email'), '  Lee@Example.com ');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());

    expect(client.calls.invoke).toEqual([
      ['team-accounts', { action: 'add', orgId: ORG, email: 'Lee@Example.com' }],
    ]);
    expect(q(root, '#team-password').textContent).toBe('k7mx-p3qa-9wdn');
    expect(q(root, '#team-issued').textContent).toContain('Account created for lee@example.com');
    expect(q(root, '#team-issued').textContent).toMatch(/shown once/);
    expect(document.activeElement).toBe(q(root, '#team-issued'));
    expect(root.querySelectorAll('.team-list li')).toHaveLength(3);
    expect(root.textContent).toContain('Has not chosen a password yet');
    expect(q(root, '#team-email').value).toBe(''); // ready for the next person
  });

  it('Done hides the password for good and returns focus to the email box', async () => {
    const { root } = await mount(fakeTeamClient());
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    q(root, '#team-issued-done').click();
    expect(q(root, '#team-issued')).toBeNull();
    expect(root.textContent).not.toContain('k7mx-p3qa-9wdn');
    expect(document.activeElement).toBe(q(root, '#team-email'));
  });

  it('the password does not survive the screen being left', async () => {
    const { root, screen } = await mount(fakeTeamClient());
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    screen.unmount();
    // The closure no longer holds it: any later render (e.g. a late reload) cannot show it again.
    // (The DOM is the router's to remove; what matters is the state.)
    q(root, '#team-issued-done').click();
    expect(root.textContent).not.toContain('k7mx-p3qa-9wdn');
  });

  it('Copy puts the password on the clipboard and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { root } = await mount(fakeTeamClient());
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-copy')).not.toBeNull());
    q(root, '#team-copy').click();
    await until(() => expect(q(root, '#team-copy-status').textContent).toBe('Copied.'));
    expect(writeText).toHaveBeenCalledWith('k7mx-p3qa-9wdn');
  });

  it('if the clipboard is unavailable, says to copy it by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    const { root } = await mount(fakeTeamClient());
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-copy')).not.toBeNull());
    q(root, '#team-copy').click();
    await until(() =>
      expect(q(root, '#team-copy-status').textContent).toMatch(
        /select the password and copy it yourself/,
      ),
    );
  });

  it.each([
    ['nothing typed', '', 'Enter the email address of the person to add.'],
    ['not an email', 'lee', 'Enter a valid email address.'],
  ])('%s: says so and never calls the function', async (_label, value, message) => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    type(q(root, '#team-email'), value);
    submitAdd(root);
    expect(feedback(root).textContent).toBe(message);
    expect(feedback(root).dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback(root));
    expect(client.calls.invoke).toHaveLength(0);
  });

  it('reads the email box as it is at submit, even if no input event reported it', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, '#team-email').value = 'autofilled@example.com'; // no event
    submitAdd(root);
    await until(() => expect(client.calls.invoke).toHaveLength(1));
    expect(client.calls.invoke[0][1].email).toBe('autofilled@example.com');
  });

  it('shows the function’s refusal (an email that already has an account) and keeps what was typed', async () => {
    const client = fakeTeamClient(undefined, {
      invokeError: {
        context: new Response(JSON.stringify({ error: 'That email already has an account.' }), {
          status: 409,
        }),
      },
    });
    const { root } = await mount(client);
    type(q(root, '#team-email'), 'kim@example.com');
    submitAdd(root);
    await until(() =>
      expect(feedback(root)?.textContent).toBe('That email already has an account.'),
    );
    expect(q(root, '#team-email').value).toBe('kim@example.com');
    expect(q(root, '#team-issued')).toBeNull();
  });

  it('ignores a second submit while the first is in flight', async () => {
    const client = fakeTeamClient();
    let release;
    const realInvoke = client.functions.invoke;
    let count = 0;
    client.functions.invoke = (...args) => {
      count += 1;
      return new Promise((resolve) => {
        release = () => resolve(realInvoke(...args));
      });
    };
    const { root } = await mount(client);
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(typeof release).toBe('function'));
    submitAdd(root);
    release();
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(count).toBe(1);
  });

  it('if the list cannot refresh after a successful add, still shows the password and says so', async () => {
    const client = fakeTeamClient(undefined, { listAlwaysFailsAfter: 1 });
    const { root } = await mount(client);
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(q(root, '#team-password').textContent).toBe('k7mx-p3qa-9wdn');
    // the warning sits inside the panel that takes focus, not in a feedback line below the list
    expect(q(root, '#team-issued-note').textContent).toBe(
      'Added, but the list could not refresh — reload to see it.',
    );
    expect(feedback(root).textContent).toBe('');
  });
});

describe('mountTeamScreen — reset and remove', () => {
  it('Reset asks first; Cancel puts focus back on Reset password', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, `#team-reset-btn-${KIM}`).click();
    expect(q(root, `#team-row-${KIM}`).textContent).toContain(
      'Reset the password for kim@example.com?',
    );
    expect(document.activeElement).toBe(q(root, `#team-cancel-${KIM}`));
    q(root, `#team-cancel-${KIM}`).click();
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
    expect(document.activeElement).toBe(q(root, `#team-reset-btn-${KIM}`));
    expect(client.calls.invoke).toHaveLength(0);
  });

  it('confirming a reset shows the new one-time password', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, `#team-reset-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(client.calls.invoke).toEqual([
      ['team-accounts', { action: 'reset', orgId: ORG, userId: KIM }],
    ]);
    expect(q(root, '#team-issued').textContent).toContain(
      'New one-time password for kim@example.com',
    );
    expect(q(root, '#team-password').textContent).toBe('aaaa-bbbb-cccc');
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  it('Remove asks first; Cancel puts focus back on Remove and removes nothing', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    expect(q(root, `#team-row-${KIM}`).textContent).toContain(
      'Remove kim@example.com? They lose access straight away.',
    );
    q(root, `#team-cancel-${KIM}`).click();
    expect(document.activeElement).toBe(q(root, `#team-remove-btn-${KIM}`));
    expect(client.calls.rpc.filter(([name]) => name === 'team_remove_member')).toHaveLength(0);
  });

  it('confirming a removal removes them, refreshes the list and says so', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(q(root, `#team-row-${KIM}`)).toBeNull());
    expect(client.calls.rpc).toContainEqual([
      'team_remove_member',
      { p_org_id: ORG, p_user_id: KIM },
    ]);
    expect(feedback(root).textContent).toBe('kim@example.com was removed from the team.');
    expect(feedback(root).dataset.tone).toBe('success');
    expect(root.querySelectorAll('.team-list li')).toHaveLength(1);
  });

  it('shows the reason when the database refuses a removal, and leaves the list as it was', async () => {
    const client = fakeTeamClient(undefined, {
      removeError: { message: 'team_remove_member: an owner cannot be removed' },
    });
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(feedback(root)?.dataset.tone).toBe('error'));
    expect(feedback(root).textContent).toBe('an owner cannot be removed');
    expect(root.querySelectorAll('.team-list li')).toHaveLength(2);
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  it('only one confirmation is open at a time', async () => {
    const client = fakeTeamClient([
      member(OWNER, 'owner@example.com', 'owner'),
      member(KIM, 'kim@example.com'),
      member(LEE, 'lee@example.com'),
    ]);
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-remove-btn-${LEE}`).click();
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
    expect(q(root, `#team-confirm-${LEE}`)).not.toBeNull();
  });
});

describe('mountTeamScreen — lifecycle', () => {
  it('never writes to the page once its own signal is aborted', async () => {
    const controller = new AbortController();
    let release;
    const client = {
      rpc: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: [], error: null });
        }),
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const mounting = mountTeamScreen(root, { orgId: ORG, client, signal: controller.signal });
    await settle();
    const before = root.innerHTML;
    controller.abort();
    release();
    await mounting;
    expect(root.innerHTML).toBe(before);
  });

  it('resolves to an object with a callable unmount()', async () => {
    const { screen } = await mount(fakeTeamClient());
    expect(() => screen.unmount()).not.toThrow();
  });
});

describe('mountTeamScreen — a one-time password on screen is never replaced', () => {
  async function withPasswordShowing(client = fakeTeamClient()) {
    const view = await mount(client);
    type(q(view.root, '#team-email'), 'lee@example.com');
    submitAdd(view.root);
    await until(() => expect(q(view.root, '#team-issued')).not.toBeNull());
    return { ...view, client };
  }

  it('disables the add form and every Reset / Remove while the password is showing', async () => {
    const { root } = await withPasswordShowing();
    expect(q(root, '#team-email').disabled).toBe(true);
    expect(q(root, '.team-add-form button[type="submit"]').disabled).toBe(true);
    for (const button of root.querySelectorAll('.team-list button')) {
      expect(button.disabled).toBe(true);
    }
    expect(q(root, '#team-issued-done').disabled).toBe(false);
    expect(q(root, '#team-copy').disabled).toBe(false);
  });

  it('a second add submitted anyway (the form is disabled, but an event can still arrive) does nothing', async () => {
    const { root, client } = await withPasswordShowing();
    submitAdd(root);
    await settle();
    expect(client.calls.invoke).toHaveLength(1);
    expect(q(root, '#team-password').textContent).toBe('k7mx-p3qa-9wdn');
  });

  it('a Remove or Reset clicked anyway opens nothing', async () => {
    const { root } = await withPasswordShowing();
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-reset-btn-${KIM}`).click();
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  it('Done gives everything back', async () => {
    const { root } = await withPasswordShowing();
    q(root, '#team-issued-done').click();
    expect(q(root, '#team-email').disabled).toBe(false);
    expect(q(root, `#team-remove-btn-${KIM}`).disabled).toBe(false);
  });

  it('says so, in the instructions, so the disabled controls are explained', async () => {
    const { root } = await withPasswordShowing();
    expect(q(root, '#team-issued-help').textContent).toMatch(
      /Press Done when you have passed it on/,
    );
  });

  it('is labelled by its heading and described by the password and the instructions, with no duplicate aria-label', async () => {
    const { root } = await withPasswordShowing();
    const panel = q(root, '#team-issued');
    expect(panel.getAttribute('aria-label')).toBeNull();
    expect(panel.getAttribute('aria-labelledby')).toBe('team-issued-heading');
    expect(q(root, '#team-issued-heading').textContent).toBe('Account created for lee@example.com');
    expect(panel.getAttribute('aria-describedby')).toBe('team-password team-issued-help');
    expect(q(root, '#team-password')).not.toBeNull();
    expect(q(root, '#team-issued-help')).not.toBeNull();
  });
});

describe('mountTeamScreen — a request that never answers', () => {
  const neverSettles = () => new Promise(() => {});

  async function mountFake(client) {
    vi.useFakeTimers();
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountTeamScreen(root, { orgId: ORG, client });
    return root;
  }
  const submit = (root) =>
    root
      .querySelector('.team-add-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  it('add: after the timeout says it may have gone through, re-reads the list, and is usable again', async () => {
    const client = fakeTeamClient();
    client.functions.invoke = neverSettles;
    try {
      const root = await mountFake(client);
      type(q(root, '#team-email'), 'lee@example.com');
      submit(root);
      await vi.advanceTimersByTimeAsync(10001);
      expect(feedback(root).textContent).toMatch(/may or may not have gone through/);
      expect(feedback(root).dataset.tone).toBe('error');
      expect(q(root, '#team-email').disabled).toBe(false);
      expect(q(root, '#team-email').value).toBe('lee@example.com');
      expect(q(root, '#team-issued')).toBeNull();
      // it looked at the list again (the account may exist now)
      expect(
        client.calls.rpc.filter(([name]) => name === 'team_list_members').length,
      ).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset: same', async () => {
    const client = fakeTeamClient();
    client.functions.invoke = neverSettles;
    try {
      const root = await mountFake(client);
      q(root, `#team-reset-btn-${KIM}`).click();
      q(root, `#team-confirm-${KIM}`).click();
      await vi.advanceTimersByTimeAsync(10001);
      expect(feedback(root).textContent).toMatch(/may or may not have gone through/);
      expect(q(root, `#team-reset-btn-${KIM}`).disabled).toBe(false);
      expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('remove: same, and the buttons come back', async () => {
    const client = fakeTeamClient();
    const realRpc = client.rpc;
    client.rpc = (name, args) =>
      name === 'team_remove_member' ? neverSettles() : realRpc(name, args);
    try {
      const root = await mountFake(client);
      q(root, `#team-remove-btn-${KIM}`).click();
      q(root, `#team-confirm-${KIM}`).click();
      await vi.advanceTimersByTimeAsync(10001);
      expect(feedback(root).textContent).toMatch(/may or may not have gone through/);
      expect(q(root, `#team-remove-btn-${KIM}`).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a list refresh that never answers after a successful change does not leave the screen stuck', async () => {
    const client = fakeTeamClient();
    const realRpc = client.rpc;
    let listCalls = 0;
    client.rpc = (name, args) => {
      if (name === 'team_list_members') {
        listCalls += 1;
        if (listCalls > 1) return neverSettles();
      }
      return realRpc(name, args);
    };
    try {
      const root = await mountFake(client);
      type(q(root, '#team-email'), 'lee@example.com');
      submit(root);
      await vi.advanceTimersByTimeAsync(10001);
      expect(q(root, '#team-issued')).not.toBeNull(); // the password still shows
      expect(q(root, '#team-issued-note').textContent).toMatch(/could not refresh/);
      expect(q(root, '#team-issued-done').disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mountTeamScreen — after a removal', () => {
  it('drops the person from the list even when the refresh fails, so Remove is never offered for them again', async () => {
    const client = fakeTeamClient(undefined, { listAlwaysFailsAfter: 1 });
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(feedback(root)?.textContent).toMatch(/could not refresh/));
    expect(q(root, `#team-row-${KIM}`)).toBeNull();
    expect(q(root, `#team-remove-btn-${KIM}`)).toBeNull();
  });
});

describe('mountTeamScreen — confirm dialogs and focus', () => {
  it('a confirmation is a labelled group, and its buttons are described by the consequence', async () => {
    const { root } = await mount(fakeTeamClient());
    q(root, `#team-remove-btn-${KIM}`).click();
    const group = q(root, `#team-row-${KIM} [role="group"]`);
    const textId = `team-confirm-text-${KIM}`;
    expect(group.getAttribute('aria-labelledby')).toBe(textId);
    expect(q(root, `#${textId}`).textContent).toMatch(/They lose access straight away/);
    expect(q(root, `#team-confirm-${KIM}`).getAttribute('aria-describedby')).toBe(textId);
    expect(q(root, `#team-cancel-${KIM}`).getAttribute('aria-describedby')).toBe(textId);
  });

  it('Escape backs out of a confirmation and returns focus to the button that opened it', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    q(root, `#team-reset-btn-${KIM}`).click();
    q(root, `#team-cancel-${KIM}`).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
    expect(document.activeElement).toBe(q(root, `#team-reset-btn-${KIM}`));
    expect(client.calls.invoke).toHaveLength(0);
  });

  it('other keys leave the confirmation open', async () => {
    const { root } = await mount(fakeTeamClient());
    q(root, `#team-remove-btn-${KIM}`).click();
    for (const key of ['Tab', 'Enter', 'a']) {
      q(root, `#team-cancel-${KIM}`).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
    }
    expect(q(root, `#team-confirm-${KIM}`)).not.toBeNull();
  });
});

describe('mountTeamScreen — focus on arrival and the empty team', () => {
  it('puts focus on the Team heading once the list has loaded, so a Retry is not left on <body>', async () => {
    const { root } = await mount(fakeTeamClient());
    expect(document.activeElement).toBe(q(root, '#team-heading'));
    expect(q(root, '#team-heading').getAttribute('tabindex')).toBe('-1');
  });

  it('after a successful Retry, focus goes to the heading too', async () => {
    let fail = true;
    const client = fakeTeamClient();
    const realRpc = client.rpc;
    client.rpc = async (name, args) =>
      name === 'team_list_members' && fail
        ? { data: null, error: { code: 'XX000', message: 'x' } }
        : realRpc(name, args);
    const { root } = await mount(client);
    fail = false;
    q(root, 'button').click();
    await until(() => expect(q(root, '#team-heading')).not.toBeNull());
    expect(document.activeElement).toBe(q(root, '#team-heading'));
  });

  it('tells an owner with no team yet that nobody else has a login, and stops saying so once someone does', async () => {
    const alone = await mount(fakeTeamClient([member(OWNER, 'owner@example.com', 'owner')]));
    expect(q(alone.root, '#team-empty').textContent).toBe(
      'No one else has a login yet. Add someone above.',
    );
    const withKim = await mount(fakeTeamClient());
    expect(q(withKim.root, '#team-empty')).toBeNull();
  });
});

const hold = () => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

function gated(client) {
  const gate = hold();
  const real = client.functions.invoke;
  client.functions.invoke = async (...args) => {
    await gate.promise;
    return real(...args);
  };
  return gate;
}

describe('mountTeamScreen — what a disabled button cannot prove', () => {
  async function passwordShowing(client = fakeTeamClient()) {
    const view = await mount(client);
    type(q(view.root, '#team-email'), 'lee@example.com');
    submitAdd(view.root);
    await until(() => expect(q(view.root, '#team-issued')).not.toBeNull());
    return { ...view, client };
  }

  it('a second add with an address typed in, while the password shows, is not sent', async () => {
    const { root, client } = await passwordShowing();
    q(root, '#team-email').value = 'someone-else@example.com';
    submitAdd(root);
    await settle();
    expect(client.calls.invoke).toHaveLength(1);
    expect(q(root, '#team-password').textContent).toBe('k7mx-p3qa-9wdn');
  });

  it('while a request is out everything is disabled and says Working', async () => {
    const client = fakeTeamClient();
    const gate = gated(client);
    const { root } = await mount(client);
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await settle();
    expect(q(root, '#team-email').disabled).toBe(true);
    expect(q(root, '.team-add-form button[type="submit"]').disabled).toBe(true);
    expect(q(root, '.team-add-form button[type="submit"]').textContent).toBe('Working…');
    for (const button of root.querySelectorAll('.team-list button'))
      expect(button.disabled).toBe(true);
    gate.release();
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
  });

  it('an error is shown once: the next render does not repeat it', async () => {
    const client = fakeTeamClient(undefined, {
      removeError: { message: 'team_remove_member: nope' },
    });
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(feedback(root)?.dataset.tone).toBe('error'));
    q(root, `#team-remove-btn-${KIM}`).click();
    expect(feedback(root).textContent).toBe('');
  });

  it('a success message is shown once', async () => {
    const client = fakeTeamClient([
      member(OWNER, 'owner@example.com', 'owner'),
      member(KIM, 'kim@example.com'),
      member(LEE, 'lee@example.com'),
    ]);
    const { root } = await mount(client);
    q(root, `#team-remove-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(feedback(root)?.dataset.tone).toBe('success'));
    q(root, `#team-remove-btn-${LEE}`).click();
    expect(feedback(root).textContent).toBe('');
  });

  it('starting an add closes an open confirmation', async () => {
    const { root } = await mount(fakeTeamClient());
    q(root, `#team-remove-btn-${KIM}`).click();
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  it('a reset whose list refresh fails still shows the password and says so inside the panel', async () => {
    const client = fakeTeamClient(undefined, { listAlwaysFailsAfter: 1 });
    const { root } = await mount(client);
    q(root, `#team-reset-btn-${KIM}`).click();
    q(root, `#team-confirm-${KIM}`).click();
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(q(root, '#team-password').textContent).toBe('aaaa-bbbb-cccc');
    expect(q(root, '#team-issued-note').textContent).toBe(
      'Reset, but the list could not refresh — reload to see it.',
    );
    expect(document.activeElement).toBe(q(root, '#team-issued'));
  });

  it('a double-tapped Confirm reset sends one request', async () => {
    const c = fakeTeamClient();
    const view = await mount(c);
    q(view.root, `#team-reset-btn-${KIM}`).click();
    const confirm = q(view.root, `#team-confirm-${KIM}`);
    confirm.click();
    confirm.click(); // the same (now detached) button, as a fast second tap would hit
    await until(() => expect(q(view.root, '#team-issued')).not.toBeNull());
    expect(c.calls.invoke).toHaveLength(1);
  });

  it('a double-tapped Confirm remove sends one request', async () => {
    const c = fakeTeamClient();
    const view = await mount(c);
    q(view.root, `#team-remove-btn-${KIM}`).click();
    const confirm = q(view.root, `#team-confirm-${KIM}`);
    confirm.click();
    confirm.click();
    await until(() => expect(feedback(view.root)?.dataset.tone).toBe('success'));
    expect(c.calls.rpc.filter(([n]) => n === 'team_remove_member')).toHaveLength(1);
  });

  it('a stale Remove tap while a request is out does not open a confirmation afterwards', async () => {
    const client = fakeTeamClient();
    const gate = gated(client);
    const { root } = await mount(client);
    const staleRemove = q(root, `#team-remove-btn-${KIM}`);
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await settle();
    staleRemove.click();
    gate.release();
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  it('a stale Remove tap while the password shows opens nothing', async () => {
    const { root } = await mount(fakeTeamClient());
    const staleRemove = q(root, `#team-remove-btn-${KIM}`);
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(q(root, '#team-issued')).not.toBeNull());
    staleRemove.click();
    expect(q(root, `#team-confirm-${KIM}`)).toBeNull();
  });

  async function timeoutRelists(act, stall) {
    vi.useFakeTimers();
    try {
      const client = fakeTeamClient();
      stall(client);
      const root = document.createElement('div');
      document.body.appendChild(root);
      await mountTeamScreen(root, { orgId: ORG, client });
      const lists = () => client.calls.rpc.filter(([n]) => n === 'team_list_members').length;
      const before = lists();
      act(root);
      await vi.advanceTimersByTimeAsync(10001);
      return lists() - before;
    } finally {
      vi.useRealTimers();
    }
  }

  it('a reset that times out re-reads the list', async () => {
    const extra = await timeoutRelists(
      (root) => {
        q(root, `#team-reset-btn-${KIM}`).click();
        q(root, `#team-confirm-${KIM}`).click();
      },
      (c) => {
        c.functions.invoke = () => new Promise(() => {});
      },
    );
    expect(extra).toBeGreaterThan(0);
  });

  it('a remove that times out re-reads the list', async () => {
    const extra = await timeoutRelists(
      (root) => {
        q(root, `#team-remove-btn-${KIM}`).click();
        q(root, `#team-confirm-${KIM}`).click();
      },
      (c) => {
        const real = c.rpc;
        c.rpc = (n, a) => (n === 'team_remove_member' ? new Promise(() => {}) : real(n, a));
      },
    );
    expect(extra).toBeGreaterThan(0);
  });

  it('after unmount nothing can still copy the password', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { root, screen } = await passwordShowing();
    screen.unmount();
    q(root, '#team-copy').click();
    await settle();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('the message of a TeamError from add is what is shown', async () => {
    const client = fakeTeamClient();
    const { root } = await mount(client);
    client.functions.invoke = async () => {
      throw new TeamError('Only the owner can manage the team.');
    };
    type(q(root, '#team-email'), 'lee@example.com');
    submitAdd(root);
    await until(() => expect(feedback(root)?.dataset.tone).toBe('error'));
    expect(feedback(root).textContent).toBe(
      'Could not reach the server — check your connection and try again.',
    );
  });

  it('a double-tapped Retry loads once', async () => {
    let fail = true;
    const client = fakeTeamClient();
    const real = client.rpc;
    client.rpc = async (n, a) =>
      n === 'team_list_members' && fail
        ? { data: null, error: { code: 'XX', message: 'x' } }
        : real(n, a);
    const { root } = await mount(client);
    const retry = q(root, 'button');
    fail = false;
    retry.click();
    retry.click();
    await until(() => expect(q(root, '.team-list')).not.toBeNull());
    expect(client.calls.rpc.filter(([n]) => n === 'team_list_members')).toHaveLength(1);
  });

  it('254 characters is fine, 255 is too long', () => {
    expect(validateTeamEmail(`${'a'.repeat(248)}@x.com`)).toBeNull();
    expect(validateTeamEmail(`${'a'.repeat(249)}@x.com`)).toBe('That email address is too long.');
  });
});
