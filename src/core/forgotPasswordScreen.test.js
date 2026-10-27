import { describe, it, expect, vi } from 'vitest';
import {
  mountForgotPasswordScreen,
  FORGOT_ADDRESS_MESSAGE,
  FORGOT_UNREACHABLE_MESSAGE,
  FORGOT_BUSY_MESSAGE,
} from './forgotPasswordScreen.js';
import { RESET_REQUESTED_MESSAGE } from './passwordRecovery.js';

const NO_WAIT = { minAnswerMs: 0 };

function clientAnswering(answer) {
  const calls = [];
  return {
    calls,
    auth: {
      resetPasswordForEmail: vi.fn((email, options) => {
        calls.push({ email, options });
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      }),
    },
  };
}
const OK = { data: {}, error: null };

async function mount(client, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const screen = await mountForgotPasswordScreen(root, {
    client,
    requestOptions: NO_WAIT,
    redirectTo: 'https://example.test/app/',
    ...extra,
  });
  return { root, screen };
}
function typeEmail(root, value) {
  const input = root.querySelector('[data-field="email"]');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
const feedback = (root) => root.querySelector('.screen-feedback');

describe('mountForgotPasswordScreen', () => {
  it('has a heading that takes focus, one email field, and a way back to sign in', async () => {
    const { root } = await mount(clientAnswering(OK));
    const heading = root.querySelector('h1');
    expect(heading.textContent).toBe('Forgot your password?');
    expect(document.activeElement).toBe(heading);
    const input = root.querySelector('[data-field="email"]');
    expect(input.type).toBe('email');
    expect(input.getAttribute('aria-label')).toBe('Email');
    expect(root.querySelectorAll('input')).toHaveLength(1);
    expect(root.querySelector('a[href="#/events"]').textContent).toBe('Back to sign in');
    expect(root.querySelector('button[type="submit"]').textContent).toBe('Send link');
  });

  it('asks for a link to the typed address (trimmed) with this console as the redirect', async () => {
    const client = clientAnswering(OK);
    const { root } = await mount(client);
    typeEmail(root, '  person@example.com ');
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Check your email'));
    expect(client.calls).toEqual([
      { email: 'person@example.com', options: { redirectTo: 'https://example.test/app/' } },
    ]);
  });

  it('reads the box at submit even when no input event reported it (autofill)', async () => {
    const client = clientAnswering(OK);
    const { root } = await mount(client);
    root.querySelector('[data-field="email"]').value = 'filled@example.com';
    submit(root);
    await vi.waitFor(() => expect(client.calls).toHaveLength(1));
    expect(client.calls[0].email).toBe('filled@example.com');
  });

  it.each([
    ['nothing', ''],
    ['no @', 'person'],
    ['no dot', 'a@b'],
    ['spaces inside', 'a b@c.de'],
  ])('%s typed: says so, focuses the message, and sends nothing', async (_label, value) => {
    const client = clientAnswering(OK);
    const { root } = await mount(client);
    typeEmail(root, value);
    submit(root);
    expect(feedback(root).textContent).toBe(FORGOT_ADDRESS_MESSAGE);
    expect(feedback(root).dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback(root));
    expect(client.calls).toHaveLength(0);
  });

  describe('the answer does not depend on whether the address has an account', () => {
    // Every outcome of the request the server could give for a real address, an unknown one, or a refusal
    // that only a real account would meet: the page must come out IDENTICAL.
    const equalOutcomes = [
      ['an address with an account', OK],
      ['an address with no account (the server says the same)', OK],
      [
        'the once-a-minute limit per address',
        {
          data: null,
          error: { code: 'over_email_send_rate_limit', status: 429, message: 'wait 56 seconds' },
        },
      ],
      [
        'the mail server rejecting the message',
        {
          data: null,
          error: {
            code: 'unexpected_failure',
            status: 500,
            message: 'Error sending recovery email',
          },
        },
      ],
      [
        'an explicit "no such user"',
        { data: null, error: { code: 'user_not_found', status: 404, message: 'x' } },
      ],
      [
        'a 429 without a code',
        { data: null, error: { status: 429, message: 'Too Many Requests' } },
      ],
    ];

    it('shows the same words, markup and focus for every one of them', async () => {
      const pages = [];
      for (const [, answer] of equalOutcomes) {
        const { root } = await mount(clientAnswering(answer));
        typeEmail(root, 'someone@example.com');
        submit(root);
        await vi.waitFor(() =>
          expect(root.querySelector('h1').textContent).toBe('Check your email'),
        );
        pages.push({
          html: root.innerHTML,
          focus: document.activeElement === feedback(root),
        });
      }
      for (const page of pages) expect(page).toEqual(pages[0]);
      expect(pages[0].focus).toBe(true);
    });

    it('and the words are exactly the agreed ones, in a polite status region', async () => {
      const { root } = await mount(clientAnswering(OK));
      typeEmail(root, 'someone@example.com');
      submit(root);
      await vi.waitFor(() => expect(feedback(root).textContent).toBe(RESET_REQUESTED_MESSAGE));
      expect(feedback(root).textContent).toBe('If that address has an account, we sent a link.');
      expect(feedback(root).getAttribute('role')).toBe('status');
      expect(feedback(root).getAttribute('aria-live')).toBe('polite');
    });

    it('never repeats the address back, so the page says nothing about it', async () => {
      const { root } = await mount(clientAnswering(OK));
      typeEmail(root, 'someone@example.com');
      submit(root);
      await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Check your email'));
      expect(root.textContent).not.toContain('someone@example.com');
    });

    it('does not answer sooner for one outcome than another (the default minimum applies to all)', async () => {
      vi.useFakeTimers();
      try {
        for (const answer of [OK, equalOutcomes[2][1], equalOutcomes[3][1]]) {
          const root = document.createElement('div');
          document.body.appendChild(root);
          await mountForgotPasswordScreen(root, {
            client: clientAnswering(answer),
            redirectTo: 'https://example.test/app/',
          });
          typeEmail(root, 'someone@example.com');
          submit(root);
          await vi.advanceTimersByTimeAsync(1000);
          expect(root.querySelector('h1').textContent, 'still waiting at 1s').toBe(
            'Forgot your password?',
          );
          await vi.advanceTimersByTimeAsync(300);
          expect(root.querySelector('h1').textContent, 'answered by 1.3s').toBe('Check your email');
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('outcomes that say nothing about the address', () => {
    it('no connection: says so in words that mention no account, and keeps the address for a retry', async () => {
      const { root } = await mount(clientAnswering(new TypeError('Failed to fetch')));
      typeEmail(root, 'someone@example.com');
      submit(root);
      await vi.waitFor(() => expect(feedback(root).textContent).toBe(FORGOT_UNREACHABLE_MESSAGE));
      expect(feedback(root).dataset.tone).toBe('error');
      expect(document.activeElement).toBe(feedback(root));
      expect(root.querySelector('[data-field="email"]').value).toBe('someone@example.com');
      expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
      expect(feedback(root).textContent).not.toMatch(/account/i);
    });

    it('too many requests from this connection', async () => {
      const { root } = await mount(
        clientAnswering({
          data: null,
          error: { code: 'over_request_rate_limit', status: 429, message: 'x' },
        }),
      );
      typeEmail(root, 'someone@example.com');
      submit(root);
      await vi.waitFor(() => expect(feedback(root).textContent).toBe(FORGOT_BUSY_MESSAGE));
      expect(feedback(root).textContent).not.toMatch(/account/i);
    });

    it('a request that never settles ends in a message, not "Sending…" forever', async () => {
      vi.useFakeTimers();
      try {
        const client = { auth: { resetPasswordForEmail: () => new Promise(() => {}) } };
        const root = document.createElement('div');
        document.body.appendChild(root);
        await mountForgotPasswordScreen(root, { client, redirectTo: 'https://example.test/app/' });
        typeEmail(root, 'someone@example.com');
        submit(root);
        expect(root.querySelector('button[type="submit"]').textContent).toBe('Sending…');
        await vi.advanceTimersByTimeAsync(10001);
        expect(feedback(root).textContent).toBe(FORGOT_UNREACHABLE_MESSAGE);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('while the request is in flight', () => {
    function slowClient() {
      let release;
      const calls = [];
      return {
        calls,
        release: () => release(),
        auth: {
          resetPasswordForEmail: (email) => {
            calls.push(email);
            return new Promise((resolve) => {
              release = () => resolve(OK);
            });
          },
        },
      };
    }

    it('shows a busy state (aria-disabled, not native) and ignores a second submit', async () => {
      const client = slowClient();
      const { root } = await mount(client);
      typeEmail(root, 'someone@example.com');
      submit(root);
      const button = root.querySelector('button[type="submit"]');
      expect(button.textContent).toBe('Sending…');
      for (const node of [button, root.querySelector('[data-field="email"]')]) {
        expect(node.getAttribute('aria-disabled')).toBe('true');
        expect(node.getAttribute('aria-busy')).toBe('true');
        expect(node.disabled).toBe(false);
      }
      submit(root);
      submit(root);
      client.release();
      await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Check your email'));
      expect(client.calls).toHaveLength(1);
    });

    it('sends the address that was submitted, not what was typed since', async () => {
      const client = slowClient();
      const { root } = await mount(client);
      typeEmail(root, 'first@example.com');
      submit(root);
      typeEmail(root, 'second@example.com');
      client.release();
      await vi.waitFor(() => expect(root.querySelector('h1').textContent).toBe('Check your email'));
      expect(client.calls).toEqual(['first@example.com']);
    });

    it('never writes to the page again once unmounted', async () => {
      const client = slowClient();
      const { root, screen } = await mount(client);
      typeEmail(root, 'someone@example.com');
      submit(root);
      const before = root.innerHTML;
      screen.unmount();
      client.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(root.innerHTML).toBe(before);
    });

    it('never writes to the page again once its signal is aborted', async () => {
      const client = slowClient();
      const controller = new AbortController();
      const { root } = await mount(client, { signal: controller.signal });
      typeEmail(root, 'someone@example.com');
      submit(root);
      const before = root.innerHTML;
      controller.abort();
      client.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(root.innerHTML).toBe(before);
    });
  });

  describe('after the link was asked for', () => {
    async function sent() {
      const mounted = await mount(clientAnswering(OK));
      typeEmail(mounted.root, 'someone@example.com');
      submit(mounted.root);
      await vi.waitFor(() =>
        expect(mounted.root.querySelector('h1').textContent).toBe('Check your email'),
      );
      return mounted;
    }

    it('says what to do if nothing arrives, without saying anything about the account', async () => {
      const { root } = await sent();
      expect(root.textContent).toMatch(/spam folder/);
      expect(root.textContent).toMatch(/owner of your organisation or the Seduh Score team/);
      expect(root.querySelector('a[href="#/events"]').textContent).toBe('Back to sign in');
    });

    it('lets the person use a different address, with an empty form and focus on its heading', async () => {
      const { root } = await sent();
      [...root.querySelectorAll('button')]
        .find((b) => b.textContent === 'Use a different address')
        .click();
      expect(root.querySelector('h1').textContent).toBe('Forgot your password?');
      expect(root.querySelector('[data-field="email"]').value).toBe('');
      expect(document.activeElement).toBe(root.querySelector('h1'));
    });
  });

  it('resolves to an object with a callable unmount()', async () => {
    const { screen } = await mount(clientAnswering(OK));
    expect(() => screen.unmount()).not.toThrow();
  });
});
