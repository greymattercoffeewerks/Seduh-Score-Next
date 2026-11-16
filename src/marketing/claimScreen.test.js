// Every step of the claim page, driven with a fake `api` (the real calls are proven in tests/e2e/seduh-claim-ui-live.spec.js).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountClaimScreen } from './claimScreen.js';
import { describeClaimHint } from './claimFlow.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-';

function fakeApi(overrides = {}) {
  return {
    sendCode: vi.fn(async () => ({ ok: true, displayName: 'Aisha Rahman' })),
    verifyCode: vi.fn(async () => ({ ok: true })),
    handleAvailability: vi.fn(async () => 'available'),
    claim: vi.fn(async (_t, handle) => ({ ok: true, handle, foundingNumber: 42 })),
    leave: vi.fn(async () => {}),
    ...overrides,
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function mount(api, token = TOKEN, options = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const screen = mountClaimScreen(root, { api, token, checkDelayMs: 0, ...options });
  return { root, screen, api };
}

const click = async (root, selector) => {
  root.querySelector(selector).click();
  await flush();
};
const type = (root, selector, value) => {
  const input = root.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = async (root) => {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const h1 = (root) => root.querySelector('h1').textContent;
const text = (root, selector) => root.querySelector(selector)?.textContent ?? '';

async function toEmail(m) {
  await click(m.root, '#claim-start');
}
async function toCode(m, email = 'aisha@example.com') {
  await toEmail(m);
  type(m.root, '#claim-email', email);
  await submit(m.root);
}
async function toHandle(m) {
  await toCode(m);
  type(m.root, '#claim-code', '123456');
  await submit(m.root);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('step 1, welcome', () => {
  it('explains what claiming does, names no one yet and has one h1 with header and footer outside <main>', () => {
    const { root } = mount(fakeApi());
    expect(h1(root)).toBe('Claim your Seduh ID');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main').textContent).toMatch(/can never be changed/);
    expect(root.querySelector('main').textContent).toMatch(/18 or over/);
    expect(root.querySelector('main').textContent).toMatch(/never shown/);
    expect(root.querySelector('.page-hero-kicker').textContent).toBe('Seduh ID · Step 1 of 4');
    expect(root.querySelector('main header, main footer')).toBeNull();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('footer')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });
  it('makes no call until the person moves on', () => {
    const { api } = mount(fakeApi());
    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
  });
  it('shows a card, not the steps, when there is no token', () => {
    const { root } = mount(fakeApi(), null);
    expect(h1(root)).toBe('This link is incomplete');
    expect(root.querySelector('#claim-start')).toBeNull();
    expect(root.querySelector('form')).toBeNull();
  });
});

describe('step 2, email', () => {
  it('refuses a malformed address in words, without a call, and keeps focus on the field', async () => {
    const m = mount(fakeApi());
    await toEmail(m);
    expect(h1(m.root)).toBe('Your email address');
    type(m.root, '#claim-email', 'nope');
    await submit(m.root);
    expect(text(m.root, '#claim-email-status')).toBe(describeClaimHint('bad_email'));
    expect(m.root.querySelector('#claim-email-status').getAttribute('role')).toBe('status');
    expect(m.root.querySelector('#claim-email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(m.root.querySelector('#claim-email'));
    expect(m.api.sendCode).not.toHaveBeenCalled();
  });
  it('sends the normalised email with the token and moves to the code, remembering the name', async () => {
    const m = mount(fakeApi());
    await toCode(m, '  Aisha@Example.COM ');
    expect(m.api.sendCode).toHaveBeenCalledWith(TOKEN, 'aisha@example.com');
    expect(h1(m.root)).toBe('Enter your code');
    expect(m.root.textContent).toContain('We sent a code to aisha@example.com');
  });
  it('maps each function refusal to its words, and a link-level one ends the flow', async () => {
    for (const hint of [
      'bad_email',
      'too_many_codes',
      'email_rate_limited',
      'email_send_failed',
      'offline',
      'timeout',
      'server_error',
    ]) {
      const m = mount(fakeApi({ sendCode: vi.fn(async () => ({ ok: false, hint })) }));
      await toCode(m);
      expect(text(m.root, '#claim-email-status'), hint).toBe(describeClaimHint(hint));
      expect(m.root.querySelector('#claim-send').disabled, hint).toBe(false);
      document.body.replaceChildren();
    }
    for (const hint of [
      'link_invalid',
      'link_used',
      'link_revoked',
      'link_expired',
      'identity_unavailable',
    ]) {
      const m = mount(fakeApi({ sendCode: vi.fn(async () => ({ ok: false, hint })) }));
      await toCode(m);
      expect(h1(m.root), hint).toBe('This link cannot be used');
      expect(text(m.root, '#claim-end-message'), hint).toBe(describeClaimHint(hint));
      expect(m.root.querySelector('form'), hint).toBeNull();
      document.body.replaceChildren();
    }
  });
  it('disables its button while sending, so a double tap sends once', async () => {
    let release;
    const m = mount(fakeApi({ sendCode: vi.fn(() => new Promise((r) => (release = r))) }));
    await toEmail(m);
    type(m.root, '#claim-email', 'aisha@example.com');
    await submit(m.root);
    expect(m.root.querySelector('#claim-send').disabled).toBe(true);
    expect(m.root.querySelector('#claim-send').getAttribute('aria-busy')).toBe('true');
    release({ ok: true, displayName: null });
    await flush();
    expect(m.api.sendCode).toHaveBeenCalledTimes(1);
  });
});

describe('step 3, the code', () => {
  it('refuses anything but six digits without a call', async () => {
    const m = mount(fakeApi());
    await toCode(m);
    type(m.root, '#claim-code', '12ab');
    await submit(m.root);
    expect(text(m.root, '#claim-code-status')).toBe('Enter the 6 digits from the email.');
    expect(m.api.verifyCode).not.toHaveBeenCalled();
  });
  it('verifies a code typed with spaces and moves on', async () => {
    const m = mount(fakeApi());
    await toCode(m);
    type(m.root, '#claim-code', '123 456');
    await submit(m.root);
    expect(m.api.verifyCode).toHaveBeenCalledWith('aisha@example.com', '123456');
    expect(h1(m.root)).toBe('Choose your handle');
  });
  it('says a wrong or expired code is wrong, and each other failure in its own words', async () => {
    for (const hint of [
      'otp_invalid',
      'too_many_attempts',
      'offline',
      'timeout',
      'server_error',
      'bad_request',
    ]) {
      const m = mount(fakeApi({ verifyCode: vi.fn(async () => ({ ok: false, hint })) }));
      await toCode(m);
      type(m.root, '#claim-code', '123456');
      await submit(m.root);
      expect(text(m.root, '#claim-code-status'), hint).toBe(describeClaimHint(hint));
      expect(h1(m.root), hint).toBe('Enter your code');
      document.body.replaceChildren();
    }
  });
  it('can send a new code, and says so', async () => {
    const m = mount(fakeApi());
    await toCode(m);
    await click(m.root, '#claim-resend');
    expect(m.api.sendCode).toHaveBeenCalledTimes(2);
    expect(text(m.root, '#claim-code-status')).toMatch(/new code is on its way/);
  });
  it('shows the limit when new codes are refused, and ends the flow if the link died meanwhile', async () => {
    const sendCode = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, displayName: null })
      .mockResolvedValueOnce({ ok: false, hint: 'too_many_codes' });
    const m = mount(fakeApi({ sendCode }));
    await toCode(m);
    await click(m.root, '#claim-resend');
    expect(text(m.root, '#claim-code-status')).toBe(describeClaimHint('too_many_codes'));
    const dying = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, displayName: null })
      .mockResolvedValueOnce({ ok: false, hint: 'link_revoked' });
    const m2 = mount(fakeApi({ sendCode: dying }));
    await toCode(m2);
    await click(m2.root, '#claim-resend');
    expect(h1(m2.root)).toBe('This link cannot be used');
  });
  it('lets the person go back to use a different email, keeping what they typed', async () => {
    const m = mount(fakeApi());
    await toCode(m);
    await click(m.root, '#claim-change-email');
    expect(h1(m.root)).toBe('Your email address');
    expect(m.root.querySelector('#claim-email').value).toBe('aisha@example.com');
  });
  it('asks for a one-time code with the right input hints', async () => {
    const m = mount(fakeApi());
    await toCode(m);
    const input = m.root.querySelector('#claim-code');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });
});

describe('step 4, handle, 18+ and claim', () => {
  it('names the person the link is for, and says the handle can never change', async () => {
    const m = mount(fakeApi());
    await toHandle(m);
    expect(h1(m.root)).toBe('Choose your handle');
    expect(m.root.querySelector('.page-hero-intro').textContent).toBe(
      'You are claiming the Seduh ID of Aisha Rahman.',
    );
    expect(m.root.textContent).toMatch(/can never be changed/);
  });
  it('shows the live address and checks availability once typing stops, ignoring a stale answer', async () => {
    const answers = { aisha: 'taken', 'aisha-2': 'available' };
    let releaseFirst;
    const handleAvailability = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = () => r(answers.aisha))))
      .mockImplementationOnce(async () => answers['aisha-2']);
    const m = mount(fakeApi({ handleAvailability }));
    await toHandle(m);
    type(m.root, '#claim-handle', 'Aisha');
    expect(text(m.root, '#claim-address')).toBe('seduhscore.com/id/aisha');
    await new Promise((r) => setTimeout(r, 5));
    type(m.root, '#claim-handle', 'aisha-2');
    await new Promise((r) => setTimeout(r, 5));
    await flush();
    expect(text(m.root, '#claim-handle-check')).toBe('Available.');
    releaseFirst();
    await flush();
    expect(text(m.root, '#claim-handle-check')).toBe('Available.');
    expect(handleAvailability.mock.calls.map((c) => c[0])).toEqual(['aisha', 'aisha-2']);
  });
  it('words each check answer, and does not ask the database about a shape it already knows is wrong', async () => {
    const expected = {
      taken: 'Already taken',
      reserved: 'reserved',
      invalid: '3 to 30',
      failed: 'Could not check',
    };
    for (const [answer, words] of Object.entries(expected)) {
      const m = mount(fakeApi({ handleAvailability: vi.fn(async () => answer) }));
      await toHandle(m);
      type(m.root, '#claim-handle', 'abcdef');
      await new Promise((r) => setTimeout(r, 5));
      await flush();
      expect(text(m.root, '#claim-handle-check'), answer).toContain(words);
      document.body.replaceChildren();
    }
    const m = mount(fakeApi());
    await toHandle(m);
    type(m.root, '#claim-handle', 'a');
    await new Promise((r) => setTimeout(r, 5));
    expect(text(m.root, '#claim-handle-check')).toContain('3 to 30');
    expect(m.api.handleAvailability).not.toHaveBeenCalled();
  });
  it('refuses an unticked 18+ box in words and claims nothing', async () => {
    const m = mount(fakeApi());
    await toHandle(m);
    type(m.root, '#claim-handle', 'aisha-r');
    await submit(m.root);
    expect(text(m.root, '#claim-form-status')).toBe(describeClaimHint('adult_required'));
    expect(m.api.claim).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(m.root.querySelector('#claim-adult'));
  });
  it('refuses a handle of the wrong shape in words and claims nothing', async () => {
    const m = mount(fakeApi());
    await toHandle(m);
    m.root.querySelector('#claim-adult').checked = true;
    type(m.root, '#claim-handle', 'no good');
    await submit(m.root);
    expect(text(m.root, '#claim-form-status')).toBe(describeClaimHint('handle_invalid'));
    expect(m.api.claim).not.toHaveBeenCalled();
  });
  it('claims with the normalised handle, adult true, then signs the competitor session out and shows the number', async () => {
    const m = mount(fakeApi());
    await toHandle(m);
    m.root.querySelector('#claim-adult').checked = true;
    type(m.root, '#claim-handle', '  Aisha-R ');
    await submit(m.root);
    expect(m.api.claim).toHaveBeenCalledWith(TOKEN, 'aisha-r', true);
    expect(m.api.leave).toHaveBeenCalledTimes(1);
    expect(h1(m.root)).toBe('Seduh ID #0042');
    const link = m.root.querySelector('#claim-see-page');
    expect(link.getAttribute('href')).toBe('/id/aisha-r/');
    expect(m.root.querySelector('main').textContent).toContain('seduhscore.com/id/aisha-r');
    expect(m.root.querySelector('main').textContent).toMatch(
      /Settings to hide parts of it arrive soon/,
    );
    expect(m.root.querySelector('main').textContent).toMatch(/hello@seduhscore\.com/);
    expect(m.root.querySelector('form')).toBeNull();
  });
  it('keeps the person on the form for a handle refusal, and the box and handle they typed', async () => {
    for (const hint of ['handle_taken', 'handle_reserved', 'handle_invalid']) {
      const m = mount(fakeApi({ claim: vi.fn(async () => ({ ok: false, hint })) }));
      await toHandle(m);
      m.root.querySelector('#claim-adult').checked = true;
      type(m.root, '#claim-handle', 'abcdef');
      await submit(m.root);
      expect(text(m.root, '#claim-form-status'), hint).toBe(describeClaimHint(hint));
      expect(m.root.querySelector('#claim-handle').value, hint).toBe('abcdef');
      expect(m.root.querySelector('#claim-adult').checked, hint).toBe(true);
      expect(m.root.querySelector('#claim-submit').disabled, hint).toBe(false);
      expect(m.api.leave, hint).not.toHaveBeenCalled();
      document.body.replaceChildren();
    }
  });
  it('sends the person back to the email step when the login cannot claim, with the words', async () => {
    for (const hint of ['account_exists', 'admin_cannot_claim', 'signed_out']) {
      const m = mount(fakeApi({ claim: vi.fn(async () => ({ ok: false, hint })) }));
      await toHandle(m);
      m.root.querySelector('#claim-adult').checked = true;
      type(m.root, '#claim-handle', 'abcdef');
      await submit(m.root);
      expect(h1(m.root), hint).toBe('Your email address');
      expect(text(m.root, '#claim-email-status'), hint).toBe(describeClaimHint(hint));
      document.body.replaceChildren();
    }
  });
  it('ends the flow when the link dies between the code and the claim', async () => {
    for (const hint of [
      'link_used',
      'link_revoked',
      'link_expired',
      'identity_claimed',
      'identity_unavailable',
      'link_invalid',
    ]) {
      const m = mount(fakeApi({ claim: vi.fn(async () => ({ ok: false, hint })) }));
      await toHandle(m);
      m.root.querySelector('#claim-adult').checked = true;
      type(m.root, '#claim-handle', 'abcdef');
      await submit(m.root);
      expect(h1(m.root), hint).toBe('This link cannot be used');
      expect(text(m.root, '#claim-end-message'), hint).toBe(describeClaimHint(hint));
      document.body.replaceChildren();
    }
  });
  it('after a lost connection says the claim may already have gone through', async () => {
    for (const hint of ['offline', 'timeout']) {
      const m = mount(fakeApi({ claim: vi.fn(async () => ({ ok: false, hint })) }));
      await toHandle(m);
      m.root.querySelector('#claim-adult').checked = true;
      type(m.root, '#claim-handle', 'abcdef');
      await submit(m.root);
      expect(text(m.root, '#claim-form-status'), hint).toContain('may already have gone through');
      document.body.replaceChildren();
    }
  });
  it('words a server fault on the claim step in its own sentence', async () => {
    for (const hint of ['server_error', 'bad_request']) {
      const m = mount(fakeApi({ claim: vi.fn(async () => ({ ok: false, hint })) }));
      await toHandle(m);
      m.root.querySelector('#claim-adult').checked = true;
      type(m.root, '#claim-handle', 'abcdef');
      await submit(m.root);
      expect(text(m.root, '#claim-form-status'), hint).toBe(describeClaimHint(hint));
      expect(m.root.querySelector('#claim-submit').disabled, hint).toBe(false);
      document.body.replaceChildren();
    }
  });
  it('never puts the token, the email or the code in the page', async () => {
    const m = mount(fakeApi());
    await toHandle(m);
    const html = m.root.innerHTML;
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain('123456');
  });
});

describe('unmount', () => {
  it('stops a pending handle check and writes nothing afterwards', async () => {
    let release;
    const m = mount(
      fakeApi({ handleAvailability: vi.fn(() => new Promise((r) => (release = r))) }),
    );
    await toHandle(m);
    type(m.root, '#claim-handle', 'abcdef');
    await new Promise((r) => setTimeout(r, 5));
    m.screen.unmount();
    release('available');
    await flush();
    expect(text(m.root, '#claim-handle-check')).toBe('Checking…');
  });
});
