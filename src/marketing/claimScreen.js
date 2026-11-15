// The claim page (T-ID2.B3b): /id/claim/#<token>. A person an organiser has on their roster opens the link, proves an email
// with a 6-digit code, chooses a handle, says they are 18 or over, and claims their Seduh ID.
//
//   welcome -> email -> code -> handle (with the 18+ box and the claim button) -> done
//
// The calls are behind `api` (claimApi.js) so tests drive every step with a fake. The page decides nothing: the database
// refuses or allows, and every refusal arrives as a hint that claimFlow.js turns into words. Text goes in through
// textContent only (el()). The token is held in memory only; claimMain.js has already taken it out of the address bar.
//
// Accessibility: one h1 per step that takes focus when the step appears; errors and the handle check go to PERSISTENT live
// regions (never display:none), so a screen reader hears them without the form being rebuilt; every control is 44px or more.
import { el } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { CONTACT_EMAIL } from './trustContent.js';
import {
  HANDLE_CHECK_TEXT,
  describeClaimHint,
  formatFoundingNumber,
  isEmailHint,
  isHandleShape,
  isTerminalHint,
  normaliseCode,
  normaliseEmail,
  normaliseHandle,
  stepLabel,
} from './claimFlow.js';

const HANDLE_CHECK_DELAY_MS = 400;
const SITE = 'seduhscore.com';

export function mountClaimScreen(root, { api, token, checkDelayMs = HANDLE_CHECK_DELAY_MS } = {}) {
  let step = 'welcome';
  let email = '';
  let displayName = null;
  let checkTimer = null;
  let checkSeq = 0;
  let destroyed = false;

  const main = el('main', { attrs: { id: 'claim-main' } });
  const page = el('div', { className: 'claim-page', attrs: { 'data-surface': 'stage' } }, [
    buildPublicHeader({}),
    main,
    buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
  ]);
  root.replaceChildren(page);

  // ---- pieces ----

  function hero({ title, intro }) {
    const label = stepLabel(step);
    return el(
      'section',
      { className: 'claim-hero page-hero', attrs: { 'aria-labelledby': 'claim-title' } },
      [
        el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
        el('p', {
          className: 'page-hero-kicker',
          text: label ? `Seduh ID · ${label}` : 'Seduh ID',
        }),
        el('h1', { id: 'claim-title', text: title, attrs: { tabindex: '-1' } }),
        intro ? el('p', { className: 'page-hero-intro', text: intro }) : null,
      ].filter(Boolean),
    );
  }

  function body(children) {
    return el('section', { className: 'claim-body' }, [
      el('div', { className: 'claim-card panel' }, children),
    ]);
  }

  // One persistent status line: errors are announced as alerts, the rest politely.
  function statusLine(id) {
    return el('p', {
      className: 'claim-feedback',
      attrs: { id, role: 'status', 'aria-live': 'polite' },
    });
  }
  function setStatus(node, message, tone) {
    node.textContent = message ?? '';
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  function field({ id, label, input, hint, status }) {
    input.id = id;
    const described = [hint ? `${id}-hint` : null, status ? status.id : null].filter(Boolean);
    if (described.length) input.setAttribute('aria-describedby', described.join(' '));
    return el(
      'div',
      { className: 'claim-field' },
      [
        el('label', { className: 'claim-label', text: label, attrs: { for: id } }),
        hint ? el('p', { className: 'claim-hint', id: `${id}-hint`, text: hint }) : null,
        input,
        status ?? null,
      ].filter(Boolean),
    );
  }

  function button(text, { primary = false, onClick, id, type = 'button' }) {
    const b = el('button', {
      className: `action ${primary ? 'action-primary' : 'action-outline'} claim-button`,
      text,
      attrs: { type, ...(id ? { id } : {}) },
    });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function busy(buttons, isBusy, text) {
    for (const b of buttons) {
      b.disabled = isBusy;
      if (isBusy) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
    if (text && buttons[0]) buttons[0].textContent = text;
  }

  function show(children, focus = '#claim-title') {
    if (destroyed) return;
    main.replaceChildren(...children);
    main.querySelector(focus)?.focus();
  }

  // ---- states that end the flow ----

  function showEnd({ title, message, hint }) {
    step = 'end';
    cancelCheck();
    show([
      hero({ title }),
      body(
        [
          el('p', {
            className: 'claim-message',
            text: message,
            attrs: { id: 'claim-end-message', role: 'status' },
          }),
          el('p', { className: 'claim-hint' }, [
            el('span', { text: 'If this does not look right, write to ' }),
            el('a', {
              className: 'claim-link',
              text: CONTACT_EMAIL,
              attrs: { href: `mailto:${CONTACT_EMAIL}` },
            }),
            el('span', { text: '.' }),
          ]),
          hint ? el('p', { className: 'claim-hint', text: hint }) : null,
        ].filter(Boolean),
      ),
    ]);
  }

  function showTerminal(hint) {
    showEnd({ title: 'This link cannot be used', message: describeClaimHint(hint) });
  }

  // ---- 1. welcome ----

  function showWelcome() {
    step = 'welcome';
    show([
      hero({
        title: 'Claim your Seduh ID',
        intro:
          'An organiser sent you this link so you can claim the Seduh ID that goes with your competition results.',
      }),
      body([
        el('h2', { className: 'claim-h2', text: 'What claiming does' }),
        el('ul', { className: 'claim-list' }, [
          el('li', {
            text: `It gives you a public page at ${SITE}/id/your-handle, with your name, your country and the results already shown on public results pages. Your phone number and email address are never shown.`,
          }),
          el('li', {
            text: 'You choose the handle in that address. It can never be changed, by you or by us.',
          }),
          el('li', { text: 'You need to be 18 or over, and to be able to read an email.' }),
          el('li', {
            text: 'You get a founding number, an order of arrival that is never given to anyone else.',
          }),
        ]),
        el('p', { className: 'claim-hint' }, [
          el('span', {
            text: 'This link works once, for one person. If it is not meant for you, close this page. ',
          }),
          el('a', {
            className: 'claim-link',
            text: 'How we handle your data',
            attrs: { href: '/privacy/' },
          }),
          el('span', { text: '.' }),
        ]),
        el('div', { className: 'claim-actions' }, [
          button('Start', { primary: true, id: 'claim-start', onClick: () => showEmail() }),
        ]),
      ]),
    ]);
  }

  // ---- 2. email ----

  function showEmail(message) {
    step = 'email';
    const input = el('input', {
      className: 'claim-input',
      attrs: {
        type: 'email',
        name: 'email',
        autocomplete: 'email',
        inputmode: 'email',
        autocapitalize: 'none',
        spellcheck: 'false',
        maxlength: '254',
        required: '',
      },
    });
    input.value = email;
    const status = statusLine('claim-email-status');
    const submit = button('Send me a code', { primary: true, type: 'submit', id: 'claim-send' });
    const form = el('form', { className: 'claim-form', attrs: { novalidate: '' } }, [
      field({
        id: 'claim-email',
        label: 'Your email address',
        hint: 'We send a 6-digit code to this address, so you can sign in. We use it only for that, and it is never shown on your page.',
        input,
        status,
      }),
      el('div', { className: 'claim-actions' }, [submit]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const typed = normaliseEmail(input.value);
      if (!typed) {
        setStatus(status, describeClaimHint('bad_email'), 'error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      setStatus(status, 'Sending the code…');
      busy([submit], true);
      const result = await api.sendCode(token, typed);
      if (destroyed) return;
      if (result.ok) {
        email = typed;
        displayName = result.displayName ?? displayName;
        showCode();
        return;
      }
      if (isTerminalHint(result.hint)) {
        showTerminal(result.hint);
        return;
      }
      busy([submit], false);
      setStatus(status, describeClaimHint(result.hint), 'error');
    });
    show([hero({ title: 'Your email address' }), body([form])], '#claim-title');
    if (message) setStatus(main.querySelector('#claim-email-status'), message, 'error');
  }

  // ---- 3. the code ----

  function showCode() {
    step = 'code';
    const input = el('input', {
      className: 'claim-input claim-input-code',
      attrs: {
        type: 'text',
        name: 'code',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        maxlength: '12',
        spellcheck: 'false',
        required: '',
      },
    });
    const status = statusLine('claim-code-status');
    const confirm = button('Confirm the code', {
      primary: true,
      type: 'submit',
      id: 'claim-confirm',
    });
    const again = button('Send a new code', { id: 'claim-resend' });
    const change = button('Use a different email', { id: 'claim-change-email' });
    const form = el('form', { className: 'claim-form', attrs: { novalidate: '' } }, [
      field({
        id: 'claim-code',
        label: '6-digit code',
        hint: `We sent a code to ${email}. It can take a minute to arrive; check your junk folder.`,
        input,
        status,
      }),
      el('div', { className: 'claim-actions' }, [confirm, again, change]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = normaliseCode(input.value);
      if (!code) {
        setStatus(status, 'Enter the 6 digits from the email.', 'error');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      setStatus(status, 'Checking the code…');
      busy([confirm, again, change], true);
      const result = await api.verifyCode(email, code);
      if (destroyed) return;
      if (result.ok) {
        showHandle();
        return;
      }
      busy([confirm, again, change], false);
      setStatus(status, describeClaimHint(result.hint), 'error');
      input.focus();
    });
    again.addEventListener('click', async () => {
      setStatus(status, 'Sending a new code…');
      busy([confirm, again, change], true);
      const result = await api.sendCode(token, email);
      if (destroyed) return;
      if (!result.ok && isTerminalHint(result.hint)) {
        showTerminal(result.hint);
        return;
      }
      busy([confirm, again, change], false);
      if (result.ok) setStatus(status, 'A new code is on its way. Use the newest one.');
      else setStatus(status, describeClaimHint(result.hint), 'error');
    });
    change.addEventListener('click', () => showEmail());
    show([hero({ title: 'Enter your code' }), body([form])]);
  }

  // ---- 4. handle, 18+, claim ----

  function cancelCheck() {
    clearTimeout(checkTimer);
    checkSeq += 1;
  }

  function showHandle(message) {
    step = 'handle';
    const handleInput = el('input', {
      className: 'claim-input',
      attrs: {
        type: 'text',
        name: 'handle',
        autocomplete: 'off',
        autocapitalize: 'none',
        spellcheck: 'false',
        maxlength: '30',
        required: '',
      },
    });
    const checkStatus = statusLine('claim-handle-check');
    const address = el('p', { className: 'claim-address', attrs: { id: 'claim-address' } });
    const setAddress = (value) => {
      address.textContent = `${SITE}/id/${value || 'your-handle'}`;
    };
    setAddress('');
    const adult = el('input', {
      className: 'claim-checkbox',
      attrs: { type: 'checkbox', name: 'adult', id: 'claim-adult', required: '' },
    });
    const adultLabel = el('label', { className: 'claim-check', attrs: { for: 'claim-adult' } }, [
      adult,
      el('span', { text: 'I am 18 or over.' }),
    ]);
    const formStatus = statusLine('claim-form-status');
    const submit = button('Claim my Seduh ID', {
      primary: true,
      type: 'submit',
      id: 'claim-submit',
    });
    const form = el('form', { className: 'claim-form', attrs: { novalidate: '' } }, [
      field({
        id: 'claim-handle',
        label: 'Your handle',
        hint: 'The name in your page address. It can never be changed, so choose one you will be happy with for good. 3 to 30 lowercase letters, numbers or single hyphens.',
        input: handleInput,
        status: checkStatus,
      }),
      address,
      el('div', { className: 'claim-field' }, [adultLabel]),
      formStatus,
      el('div', { className: 'claim-actions' }, [submit]),
    ]);

    handleInput.addEventListener('input', () => {
      const handle = normaliseHandle(handleInput.value);
      setAddress(handle);
      cancelCheck();
      if (handle === '') {
        setStatus(checkStatus, '');
        return;
      }
      if (!isHandleShape(handle)) {
        // not worth a request: the shape rule is the database's own, restated
        setStatus(checkStatus, HANDLE_CHECK_TEXT.invalid, 'error');
        return;
      }
      setStatus(checkStatus, 'Checking…');
      const mine = checkSeq;
      checkTimer = setTimeout(async () => {
        const answer = await api.handleAvailability(handle);
        // a newer keystroke, or leaving the step, makes this answer stale
        if (destroyed || mine !== checkSeq) return;
        setStatus(
          checkStatus,
          HANDLE_CHECK_TEXT[answer] ?? HANDLE_CHECK_TEXT.failed,
          answer === 'available' || answer === 'failed' ? undefined : 'error',
        );
      }, checkDelayMs);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const handle = normaliseHandle(handleInput.value);
      if (!isHandleShape(handle)) {
        setStatus(formStatus, describeClaimHint('handle_invalid'), 'error');
        handleInput.setAttribute('aria-invalid', 'true');
        handleInput.focus();
        return;
      }
      if (!adult.checked) {
        setStatus(formStatus, describeClaimHint('adult_required'), 'error');
        adult.focus();
        return;
      }
      handleInput.removeAttribute('aria-invalid');
      cancelCheck();
      setStatus(formStatus, 'Claiming your Seduh ID…');
      busy([submit], true);
      const result = await api.claim(token, handle, true);
      if (destroyed) return;
      if (result.ok) {
        await api.leave();
        showDone(result);
        return;
      }
      if (isTerminalHint(result.hint)) {
        showTerminal(result.hint);
        return;
      }
      if (isEmailHint(result.hint)) {
        showEmail(describeClaimHint(result.hint));
        return;
      }
      busy([submit], false);
      let words = describeClaimHint(result.hint);
      if (result.hint === 'timeout' || result.hint === 'offline') {
        words += ' Your claim may already have gone through. If it says the link was used, it did.';
      }
      setStatus(formStatus, words, 'error');
      if (result.hint?.startsWith('handle_')) {
        handleInput.setAttribute('aria-invalid', 'true');
        handleInput.focus();
      }
    });

    show([
      hero({
        title: 'Choose your handle',
        intro: displayName ? `You are claiming the Seduh ID of ${displayName}.` : undefined,
      }),
      body([form]),
    ]);
    if (message) setStatus(formStatus, message, 'error');
  }

  // ---- 5. done ----

  function showDone({ handle, foundingNumber }) {
    step = 'done';
    cancelCheck();
    const number = formatFoundingNumber(foundingNumber);
    const path = `/id/${handle}/`;
    show([
      hero({ title: number ? `Seduh ID ${number}` : 'Your Seduh ID is claimed' }),
      body([
        el('p', { className: 'claim-message', attrs: { role: 'status' } }, [
          el('span', { text: 'Your page is at ' }),
          el('strong', { text: `${SITE}${path}` }),
          el('span', { text: '. Your handle can never be changed.' }),
        ]),
        el('div', { className: 'claim-actions' }, [
          el('a', {
            className: 'action action-primary claim-button',
            text: 'See your page',
            attrs: { href: path, id: 'claim-see-page' },
          }),
        ]),
        el('p', { className: 'claim-hint' }, [
          el('span', {
            text: 'Your page shows your name, your country and the results already shown on public results pages. Settings to hide parts of it arrive soon. Until then, to hide a part or close your Seduh ID, write to ',
          }),
          el('a', {
            className: 'claim-link',
            text: CONTACT_EMAIL,
            attrs: { href: `mailto:${CONTACT_EMAIL}` },
          }),
          el('span', { text: ' and we will do it.' }),
        ]),
      ]),
    ]);
  }

  // ---- start ----

  if (!token) {
    showEnd({
      title: 'This link is incomplete',
      message:
        'This page needs the claim link an organiser sent you. Open that link again, in full. If you reloaded this page, open the link from your message once more.',
    });
  } else {
    showWelcome();
  }

  return {
    unmount() {
      destroyed = true;
      cancelCheck();
    },
  };
}
