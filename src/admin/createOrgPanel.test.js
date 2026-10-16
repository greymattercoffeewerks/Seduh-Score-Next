import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mountCreateOrgPanel, ORG_STATE_UNKNOWN, forgetLostPassword } from './createOrgPanel.js';
import { SLOW_MESSAGE } from './gate.js';
import { ADMIN_ERROR_COPY, GENERIC_ERROR } from './adminErrors.js';
import { flush } from './consoleHarness.js';

// The New organisation panel against a fake ctx: what it asks for and in what order, what it shows, and above all
// what it does when a step fails half way (a login that exists must not be made twice, and its password must not
// be lost or kept).

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';
const PASSWORD = 'Pw-7Zk2-Qm9x-Lr4t';
const PASSWORD_HELP =
  'Send this to them now. They choose their own password when they first sign in. It cannot be looked up again.';

const ok = (data) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });
const loginOk = (over = {}) =>
  ok({ userId: USER_ID, email: 'owner@alpha.test', password: PASSWORD, ...over });
const accountRow = (over = {}) => ({
  user_id: OTHER_ID,
  email: 'staff@alpha.test',
  banned: false,
  deleted: false,
  org_count: 1,
  must_change_password: false,
  needs_attestation: false,
  ...over,
});

let host;
let handle;
let writeText;

function mount({ admin = {}, login = loginOk() } = {}) {
  const callAdmin = vi.fn(async (name, args) => {
    const answer = admin[name];
    if (answer === undefined) throw new Error(`unexpected call ${name}`);
    return typeof answer === 'function' ? answer(args) : answer;
  });
  const callFunction = vi.fn(async (name, body) =>
    typeof login === 'function' ? login(name, body) : login,
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountCreateOrgPanel(host, { callAdmin, callFunction });
  return { callAdmin, callFunction };
}

const $ = (selector) => host.querySelector(selector);
const text = () => host.textContent;
const feedback = () => $('.screen-feedback').textContent;
const buttonNamed = (label) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label);

function typeInto(id, value) {
  const input = $(`#${id}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}
const leave = (id) => $(`#${id}`).dispatchEvent(new Event('blur'));
const fillOrg = (name = 'Alpha Roasters', slug = 'alpha-roasters') => {
  typeInto('adm-org-name-input', name);
  typeInto('adm-org-slug-input', slug);
};
const chooseExisting = () => {
  const radio = $('#adm-owner-existing');
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
};
async function submit() {
  $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}
async function lookUp(email) {
  typeInto('adm-owner-email-input', email);
  buttonNamed('Look up account').click();
  await flush();
}

beforeEach(() => {
  forgetLostPassword();
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  handle?.unmount();
  host?.remove();
  host = undefined;
  handle = undefined;
  vi.useRealTimers();
});

describe('the form', () => {
  it('has a heading, labelled fields, and the new-login owner chosen by default', () => {
    mount();
    expect($('h1').textContent).toBe('New organisation');
    expect($('label[for="adm-org-name-input"]').textContent).toBe('Organisation name');
    expect($('label[for="adm-org-slug-input"]').textContent).toBe('Link name');
    expect($('label[for="adm-owner-email-input"]').textContent).toBe('Owner’s email');
    expect($('#adm-owner-new').checked).toBe(true);
    expect($('#adm-owner-existing').checked).toBe(false);
    expect($('legend').textContent).toBe('Owner');
    expect(buttonNamed('Create organisation').type).toBe('submit');
    // the existing-account controls are not offered until that owner is chosen
    expect(buttonNamed('Look up account').closest('[hidden]')).not.toBeNull();
  });

  it('says what a link name is for, in a hint the field is described by', () => {
    mount();
    const slug = $('#adm-org-slug-input');
    expect($('#adm-org-slug-input-hint').textContent).toMatch(/can never be changed/);
    expect(slug.getAttribute('aria-describedby')).toContain('adm-org-slug-input-hint');
    expect(slug.getAttribute('aria-describedby')).toContain('adm-org-slug-input-error');
  });

  it('judges a field when it is left, then on every keystroke until it is right', () => {
    mount();
    typeInto('adm-org-slug-input', 'ab');
    expect($('#adm-org-slug-input-error').textContent).toBe('');
    leave('adm-org-slug-input');
    expect($('#adm-org-slug-input-error').textContent).toBe(ADMIN_ERROR_COPY.org_slug_invalid);
    expect($('#adm-org-slug-input').getAttribute('aria-invalid')).toBe('true');
    typeInto('adm-org-slug-input', 'abc');
    expect($('#adm-org-slug-input-error').textContent).toBe('');
    expect($('#adm-org-slug-input').hasAttribute('aria-invalid')).toBe(false);
    typeInto('adm-org-slug-input', 'admin');
    expect($('#adm-org-slug-input-error').textContent).toBe(ADMIN_ERROR_COPY.org_slug_reserved);
  });

  it('marks the three fields required and the name field invalid once it has a problem', () => {
    mount();
    for (const id of ['adm-org-name-input', 'adm-org-slug-input', 'adm-owner-email-input']) {
      expect($(`#${id}`).getAttribute('aria-required'), id).toBe('true');
    }
    typeInto('adm-org-name-input', '');
    leave('adm-org-name-input');
    expect($('#adm-org-name-input').getAttribute('aria-invalid')).toBe('true');
    expect($('#adm-org-slug-input').getAttribute('aria-describedby')).toContain(
      'adm-org-slug-input-preview',
    );
  });

  it('judges the owner email when it is left, and stops when it is fixed', () => {
    mount();
    typeInto('adm-owner-email-input', 'bad');
    leave('adm-owner-email-input');
    expect($('#adm-owner-email-input-error').textContent).toBe('Enter a valid email address.');
    typeInto('adm-owner-email-input', 'good@alpha.test');
    expect($('#adm-owner-email-input-error').textContent).toBe('');
  });

  it('sends what the form shows even when a field was filled without an input event (autofill)', async () => {
    const { callAdmin } = mount({ admin: { admin_create_org: ok(ORG_ID) } });
    $('#adm-org-name-input').value = 'Autofilled Roasters';
    $('#adm-org-slug-input').value = 'autofilled';
    $('#adm-owner-email-input').value = 'owner@alpha.test';
    await submit();
    expect(callAdmin).toHaveBeenCalledWith(
      'admin_create_org',
      expect.objectContaining({ p_name: 'Autofilled Roasters', p_slug: 'autofilled' }),
    );
  });

  it('judges the name the same way', () => {
    mount();
    typeInto('adm-org-name-input', '   ');
    leave('adm-org-name-input');
    expect($('#adm-org-name-input-error').textContent).toBe(ADMIN_ERROR_COPY.org_name_invalid);
    typeInto('adm-org-name-input', 'Alpha');
    expect($('#adm-org-name-input-error').textContent).toBe('');
  });

  it('shows how a link name will be saved when that is not how it was typed', () => {
    mount();
    typeInto('adm-org-slug-input', ' Alpha-Roasters ');
    expect($('#adm-org-slug-input-preview').textContent).toBe(
      'It will be saved as alpha-roasters.',
    );
    typeInto('adm-org-slug-input', 'alpha-roasters');
    expect($('#adm-org-slug-input-preview').textContent).toBe('');
    typeInto('adm-org-slug-input', 'Ad');
    expect($('#adm-org-slug-input-preview').textContent).toBe('');
  });

  it('a form with a problem asks for nothing, says so in the live region and focuses the first problem', async () => {
    const { callAdmin, callFunction } = mount();
    typeInto('adm-owner-email-input', 'not an email');
    await submit();
    expect(callAdmin).not.toHaveBeenCalled();
    expect(callFunction).not.toHaveBeenCalled();
    expect(feedback()).toBe('Check the highlighted fields and try again.');
    expect(document.activeElement).toBe($('#adm-org-name-input'));
    expect($('#adm-org-name-input-error').textContent).not.toBe('');
    expect($('#adm-org-slug-input-error').textContent).not.toBe('');
    expect($('#adm-owner-email-input-error').textContent).toBe('Enter a valid email address.');
  });

  it('when only the owner is wrong it focuses the owner field and names that problem', async () => {
    const { callFunction } = mount();
    fillOrg();
    await submit();
    expect(callFunction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe($('#adm-owner-email-input'));
    expect(feedback()).toBe('Enter a valid email address.');
  });

  it('choosing the other owner kind keeps the radio that has focus (a keyboard user keeps their place)', () => {
    mount();
    const before = $('#adm-owner-existing');
    chooseExisting();
    expect($('#adm-owner-existing')).toBe(before);
    expect(buttonNamed('Look up account').closest('[hidden]')).toBeNull();
    const radio = $('#adm-owner-new');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(buttonNamed('Look up account').closest('[hidden]')).not.toBeNull();
  });
});

describe('a new login as the owner', () => {
  async function createWithNewLogin(options) {
    const m = mount(options);
    fillOrg('  Alpha Roasters ', ' Alpha-Roasters ');
    typeInto('adm-owner-email-input', ' owner@alpha.test ');
    await submit();
    return m;
  }

  it('makes the login first, then the organisation for THAT login, with the values as the database will take them', async () => {
    const { callAdmin, callFunction } = await createWithNewLogin({
      admin: { admin_create_org: ok(ORG_ID) },
    });
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(callFunction).toHaveBeenCalledWith('admin-accounts', {
      action: 'create_owner',
      email: 'owner@alpha.test',
    });
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(callAdmin).toHaveBeenCalledWith('admin_create_org', {
      p_name: 'Alpha Roasters',
      p_slug: 'alpha-roasters',
      p_owner_user_id: USER_ID,
      p_attest_own_password: false,
    });
    expect(callFunction.mock.invocationCallOrder[0]).toBeLessThan(
      callAdmin.mock.invocationCallOrder[0],
    );
  });

  it('then shows the organisation, its owner and the password once, with the warning and a Copy button', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    expect($('h1').textContent).toBe('Organisation created');
    expect(document.activeElement).toBe($('h1'));
    expect(text()).toContain('Alpha Roasters was created. Its link name is alpha-roasters.');
    expect(text()).toContain('owner@alpha.test is its owner.');
    expect($('#adm-issued-password').textContent).toBe(PASSWORD);
    expect($('#adm-issued-warning').textContent).toBe(
      'This is the only time this password is shown.',
    );
    // the card's look and names: Copy is the main button, Done the quieter one and set apart
    const card = $('#adm-issued-card');
    expect(card.className).toBe('card one-time-card adm-password-card');
    expect(card.getAttribute('aria-labelledby')).toBe('adm-issued-heading');
    expect(card.getAttribute('aria-describedby')).toBe('adm-issued-password adm-issued-warning');
    expect($('#adm-issued-password').className).toBe('one-time-password adm-password');
    expect(buttonNamed('Copy').className).toBe('btn btn-primary tap-target');
    expect(buttonNamed('Copy').getAttribute('aria-label')).toBe('Copy the one-time password');
    expect(buttonNamed('Done').className).toBe('btn btn-outline tap-target adm-done');
    expect(buttonNamed('Done').getAttribute('aria-label')).toBe('Done: hide the one-time password');
    expect(card.querySelector('.adm-actions')).not.toBeNull();
    expect(card.textContent).toContain(`${PASSWORD_HELP} Press Done when you have passed it on.`);
    // nothing else is offered until the password has been dealt with
    expect($('a[href^="#/orgs/"]')).toBeNull();
    expect(buttonNamed('Create another')).toBeUndefined();
  });

  it('keeps the password in exactly one place: the node that shows it', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    expect(host.innerHTML.split(PASSWORD)).toHaveLength(2);
    for (const element of host.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value, `${element.tagName} ${attribute.name}`).not.toContain(PASSWORD);
      }
    }
    expect(JSON.stringify({ ...localStorage })).not.toContain(PASSWORD);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PASSWORD);
    expect(window.location.href).not.toContain(PASSWORD);
  });

  it('Copy puts the password on the clipboard and says so; a clipboard that refuses is said too', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    buttonNamed('Copy').click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(PASSWORD);
    expect($('#adm-issued-copy-status').textContent).toBe('Copied.');
    writeText.mockRejectedValueOnce(new Error('denied'));
    buttonNamed('Copy').click();
    await flush();
    expect($('#adm-issued-copy-status').textContent).toBe(
      'Could not copy. Select the password and copy it yourself.',
    );
  });

  it('Done removes the password from the page, and only then offers the way on', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    buttonNamed('Done').click();
    expect(host.innerHTML).not.toContain(PASSWORD);
    expect($('a[href^="#/orgs/"]').getAttribute('href')).toBe(`#/orgs/${ORG_ID}`);
    expect($('a[href^="#/orgs/"]').textContent).toBe('View organisation');
    expect(buttonNamed('Create another')).toBeDefined();
    expect(document.activeElement).toBe($('h1'));
  });

  it('Create another starts a clean form: nothing of the last organisation or its owner remains', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    buttonNamed('Done').click();
    buttonNamed('Create another').click();
    expect($('h1').textContent).toBe('New organisation');
    expect($('#adm-org-name-input').value).toBe('');
    expect($('#adm-org-slug-input').value).toBe('');
    expect($('#adm-owner-email-input').value).toBe('');
    expect($('#adm-owner-new').checked).toBe(true);
    expect(host.innerHTML).not.toContain(PASSWORD);
    expect(document.activeElement).toBe($('h1'));
  });

  it('takes a submit once: a second press while the first is out does nothing', async () => {
    let finish;
    const { callFunction } = mount({
      login: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      admin: { admin_create_org: ok(ORG_ID) },
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    await submit();
    await submit();
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(buttonNamed('Creating…').getAttribute('aria-disabled')).toBe('true');
    finish(loginOk());
    await flush();
    expect(callFunction).toHaveBeenCalledTimes(1);
  });

  it('tells a screen reader which step a long request is on', async () => {
    let finish;
    mount({
      login: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      admin: { admin_create_org: () => new Promise(() => {}) },
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect($('.sr-only[role="status"]').textContent).toBe('Creating the login…');
    finish(loginOk());
    await flush();
    expect($('.sr-only[role="status"]').textContent).toBe('Creating the organisation…');
  });

  describe('when making the login fails', () => {
    async function failWith(login) {
      const m = mount({ login, admin: { admin_create_org: ok(ORG_ID) } });
      fillOrg();
      typeInto('adm-owner-email-input', 'owner@alpha.test');
      await submit();
      return m;
    }

    it('an email that already has an account says so and offers the existing-account path', async () => {
      const { callAdmin } = await failWith(refused('email_taken', { status: 409 }));
      expect(feedback()).toContain(ADMIN_ERROR_COPY.email_taken);
      expect(callAdmin).not.toHaveBeenCalled();
      buttonNamed('Use an existing account instead').click();
      expect($('#adm-owner-existing').checked).toBe(true);
      expect(document.activeElement).toBe(buttonNamed('Look up account'));
      // the email stays where it was typed
      expect($('#adm-owner-email-input').value).toBe('owner@alpha.test');
    });

    it('says in words what each documented refusal means, and never creates an organisation after one', async () => {
      for (const [error, copy] of [
        [{ hint: 'account_record_failed', status: 500 }, ADMIN_ERROR_COPY.account_record_failed],
        [{ hint: 'account_stranded', status: 500 }, ADMIN_ERROR_COPY.account_stranded],
        [{ hint: 'account_state_unknown', status: 500 }, ADMIN_ERROR_COPY.account_state_unknown],
        // a hint the console does not know: the database refused, so nothing was made
        [{ hint: 'something_new', status: 400 }, GENERIC_ERROR],
        // a request the function refused before doing anything
        [{ status: 400 }, GENERIC_ERROR],
        [{ status: 405 }, GENERIC_ERROR],
      ]) {
        const { callAdmin } = await failWith({ data: null, error });
        expect(feedback(), JSON.stringify(error)).toBe(copy);
        expect(callAdmin, JSON.stringify(error)).not.toHaveBeenCalled();
        handle.unmount();
        host.remove();
      }
    });

    it('a server error that names nothing (a gateway giving up) says the login may exist: it does not claim nothing changed', async () => {
      for (const error of [{ status: 500 }, { status: 502 }, { status: 504 }, {}]) {
        await failWith({ data: null, error });
        expect(feedback(), JSON.stringify(error)).toBe(ADMIN_ERROR_COPY.account_state_unknown);
        handle.unmount();
        host.remove();
      }
    });

    it('a request that timed out or never got an answer says the login may exist', async () => {
      for (const error of [{ timedOut: true, offline: false }, { offline: true }]) {
        await failWith({ data: null, error });
        expect(feedback()).toBe(ADMIN_ERROR_COPY.account_state_unknown);
        handle.unmount();
        host.remove();
      }
    });

    it('the form is usable again afterwards, with what was typed still in it', async () => {
      await failWith(refused('something_new', { status: 400 }));
      expect($('#adm-org-name-input').value).toBe('Alpha Roasters');
      expect(buttonNamed('Create organisation').getAttribute('aria-disabled')).not.toBe('true');
      expect($('#adm-org-name-input').readOnly).toBe(false);
      expect($('#adm-owner-email-input').readOnly).toBe(false);
      // nothing is still "in progress" for a screen reader
      expect($('.sr-only[role="status"]').textContent).toBe('');
      expect(document.activeElement).toBe($('.screen-feedback'));
    });

    it('an answer that is not what the function documents is treated as "the login may exist"', async () => {
      for (const data of [null, {}, { userId: 'nope', password: PASSWORD }, { userId: USER_ID }]) {
        const { callAdmin } = await failWith(ok(data));
        expect(feedback()).toBe(ADMIN_ERROR_COPY.account_state_unknown);
        expect(callAdmin).not.toHaveBeenCalled();
        handle.unmount();
        host.remove();
      }
    });

    it('a gate refusal or a rejected token clears the panel: the console is checking access again', async () => {
      for (const error of [
        { hint: 'admin_mfa_required', status: 403 },
        { hint: 'admin_session_ended', status: 401 },
        { status: 401 },
      ]) {
        await failWith({ data: null, error });
        expect(host.innerHTML, JSON.stringify(error)).toBe('');
        handle.unmount();
        host.remove();
      }
    });
  });

  describe('when the login was made but the organisation was refused', () => {
    // The refusal is announced with the fact that matters most after it: a login now exists, and where it is.
    const LOGIN_NOTE =
      ' The login for owner@alpha.test was created and is kept below, with its password.';
    async function orgRefused(hint, extra = {}) {
      let first = true;
      const m = mount({
        admin: {
          admin_create_org: () => {
            if (first) {
              first = false;
              return refused(hint, extra);
            }
            return ok(ORG_ID);
          },
        },
      });
      fillOrg();
      typeInto('adm-owner-email-input', 'owner@alpha.test');
      await submit();
      return m;
    }

    it('says why in words and keeps the login and its password on screen', async () => {
      await orgRefused('org_slug_taken');
      expect(feedback()).toBe(ADMIN_ERROR_COPY.org_slug_taken + LOGIN_NOTE);
      expect($('#adm-created-password').textContent).toBe(PASSWORD);
      // it is on screen, not merely in the DOM
      expect($('#adm-created-password').closest('[hidden]')).toBeNull();
      expect(text()).toContain(
        'The login for owner@alpha.test was created. The organisation was not.',
      );
      // the owner choices are not offered again: the login is the owner now
      expect($('#adm-owner-new').closest('[hidden]')).not.toBeNull();
    });

    it('the next try attaches THAT login: it is never made twice, and the fixed values are sent', async () => {
      const { callAdmin, callFunction } = await orgRefused('org_slug_taken');
      typeInto('adm-org-slug-input', 'alpha-two');
      await submit();
      expect(callFunction).toHaveBeenCalledTimes(1);
      expect(callAdmin).toHaveBeenCalledTimes(2);
      expect(callAdmin).toHaveBeenLastCalledWith('admin_create_org', {
        p_name: 'Alpha Roasters',
        p_slug: 'alpha-two',
        p_owner_user_id: USER_ID,
        p_attest_own_password: false,
      });
      expect($('h1').textContent).toBe('Organisation created');
      expect($('#adm-issued-password').textContent).toBe(PASSWORD);
    });

    it('every refusal of the organisation step has words, and an unknown one the generic sentence', async () => {
      for (const hint of [
        'org_name_invalid',
        'org_slug_invalid',
        'org_slug_reserved',
        'org_slug_taken',
        'org_owner_not_found',
        'admin_self_target',
        'member_password_unset',
      ]) {
        await orgRefused(hint);
        expect(feedback(), hint).toBe(ADMIN_ERROR_COPY[hint] + LOGIN_NOTE);
        handle.unmount();
        host.remove();
      }
      await orgRefused('something_new');
      expect(feedback()).toBe(GENERIC_ERROR + LOGIN_NOTE);
    });

    it('an error with no hint (a dropped connection, a server error) says the organisation may exist, not that nothing changed', async () => {
      await orgRefused(undefined, { message: 'Failed to fetch' });
      expect(feedback()).toBe(ORG_STATE_UNKNOWN + LOGIN_NOTE);
    });

    it('a timeout says the organisation may exist, and still keeps the login', async () => {
      vi.useFakeTimers();
      mount({ admin: { admin_create_org: () => new Promise(() => {}) } });
      fillOrg();
      typeInto('adm-owner-email-input', 'owner@alpha.test');
      // (the fake clock also stops the test helper's own wait, so the submit is sent and the clock advanced)
      $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10001);
      expect(feedback()).toBe(ORG_STATE_UNKNOWN + LOGIN_NOTE);
      expect($('#adm-created-password').textContent).toBe(PASSWORD);
    });

    it('a gate refusal clears everything, password included', async () => {
      await orgRefused('admin_mfa_required');
      expect(host.innerHTML).toBe('');
      // and nothing is left to protect, so the browser is not asked to keep the page open
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });

    it('asks the browser before the page is closed or reloaded while the password is only on this screen', async () => {
      await orgRefused('org_slug_taken');
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('stops asking once the screen is left', async () => {
      await orgRefused('org_slug_taken');
      handle.unmount();
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('a call that throws at the organisation step says the organisation may exist, and frees the form', async () => {
    const { callAdmin } = mount({
      admin: {
        admin_create_org: () => {
          throw new Error('boom');
        },
      },
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect(callAdmin).toHaveBeenCalledTimes(1);
    expect(feedback()).toContain(ORG_STATE_UNKNOWN);
    expect($('#adm-org-name-input').readOnly).toBe(false);
  });

  it('does not ask the browser anything while there is no password to lose', async () => {
    mount();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('asks while the password is on the result, and stops when Done hides it', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    let event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    buttonNamed('Done').click();
    event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaving the screen drops the password from the page and from memory', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    expect(host.innerHTML).toContain(PASSWORD);
    handle.unmount();
    expect(host.innerHTML).not.toContain(PASSWORD);
    expect(host.innerHTML).toBe('');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('says the next time it opens that a password was lost, naming the login and never the password', async () => {
    await createWithNewLogin({ admin: { admin_create_org: ok(ORG_ID) } });
    handle.unmount();
    host.remove();
    mount();
    expect(feedback()).toContain('owner@alpha.test');
    expect(feedback()).toContain('has been lost');
    expect(feedback()).toContain('The organisation was created');
    expect(host.innerHTML).not.toContain(PASSWORD);
    // said once
    handle.unmount();
    host.remove();
    mount();
    expect(feedback()).toBe('');
  });

  it('says a login that was never attached was lost, with how to attach it', async () => {
    const { callAdmin } = mount({ admin: { admin_create_org: refused('org_slug_taken') } });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect(callAdmin).toHaveBeenCalledTimes(1);
    handle.unmount();
    host.remove();
    mount();
    expect(feedback()).toContain(
      'A login for owner@alpha.test was created earlier, but its organisation was not',
    );
    expect(feedback()).toContain('Use an existing account');
    expect(document.activeElement).not.toBe($('.screen-feedback'));
  });

  it('nothing is said when no password was on screen', async () => {
    mount();
    handle.unmount();
    host.remove();
    mount();
    expect(feedback()).toBe('');
  });

  it('tells the shell there is something to lose while a password is on screen, and not otherwise', async () => {
    mount({ admin: { admin_create_org: ok(ORG_ID) } });
    expect(handle.leaveWarning()).toBeNull();
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect(handle.leaveWarning()).toMatch(/one-time password/);
    buttonNamed('Done').click();
    expect(handle.leaveWarning()).toBeNull();
  });

  it('tells the shell while an unattached login and its password are on screen', async () => {
    mount({ admin: { admin_create_org: refused('org_slug_taken') } });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect(handle.leaveWarning()).toMatch(/one-time password/);
  });

  it('a form that is submitted a second time after Create another works: nothing is left marked busy', async () => {
    const { callFunction, callAdmin } = mount({ admin: { admin_create_org: ok(ORG_ID) } });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    buttonNamed('Done').click();
    buttonNamed('Create another').click();
    fillOrg('Second Roasters', 'second-roasters');
    typeInto('adm-owner-email-input', 'second@alpha.test');
    expect(buttonNamed('Create organisation').getAttribute('aria-disabled')).not.toBe('true');
    await submit();
    expect(callFunction).toHaveBeenCalledTimes(2);
    expect(callAdmin).toHaveBeenLastCalledWith(
      'admin_create_org',
      expect.objectContaining({ p_name: 'Second Roasters', p_slug: 'second-roasters' }),
    );
    expect($('h1').textContent).toBe('Organisation created');
  });

  it('a late answer after the screen is left draws nothing', async () => {
    let finish;
    mount({
      login: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      admin: { admin_create_org: ok(ORG_ID) },
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    handle.unmount();
    const before = host.innerHTML;
    finish(loginOk());
    await flush();
    expect(host.innerHTML).toBe(before);
    expect(host.innerHTML).not.toContain(PASSWORD);
  });
});

describe('an existing account as the owner', () => {
  const found = (over = {}) => ok([accountRow(over)]);

  it('looks the account up by the email as typed (trimmed) and says what it found', async () => {
    const { callAdmin } = mount({ admin: { admin_find_user: found({ org_count: 2 }) } });
    chooseExisting();
    await lookUp('  staff@alpha.test ');
    expect(callAdmin).toHaveBeenCalledWith('admin_find_user', { p_email: 'staff@alpha.test' });
    expect(text()).toContain('Found: staff@alpha.test');
    expect(text()).toContain('This account is already in 2 organisations.');
  });

  it('says so for an account that is in no organisation, and offers no confirmation box', async () => {
    mount({ admin: { admin_find_user: found({ org_count: 0 }) } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect(text()).toContain('This account is not in any organisation yet.');
    expect($('#adm-attest')).toBeNull();
  });

  it('says "1 organisation" for one', async () => {
    mount({ admin: { admin_find_user: found({ org_count: 1 }) } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect(text()).toContain('already in 1 organisation.');
    expect(text()).not.toContain('1 organisations');
  });

  it('no match says so; the form stays as it was', async () => {
    mount({ admin: { admin_find_user: ok([]) } });
    chooseExisting();
    await lookUp('nobody@alpha.test');
    expect($('#adm-owner-email-input-error').textContent).toBe(
      'No active account matches that. Check the email.',
    );
    expect($('#adm-owner-email-input').getAttribute('aria-invalid')).toBe('true');
    // said where the person is working, with focus there: not in the region above the name field
    expect(document.activeElement).toBe($('#adm-owner-email-input'));
    expect(feedback()).toBe('');
    expect(text()).not.toContain('Found:');
  });

  it('a refusal has words: an ambiguous email, a failure, a slow answer', async () => {
    mount({ admin: { admin_find_user: refused('email_ambiguous') } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect($('#adm-owner-email-input-error').textContent).toBe(ADMIN_ERROR_COPY.email_ambiguous);
    handle.unmount();
    host.remove();
    mount({ admin: { admin_find_user: refused(undefined) } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect($('#adm-owner-email-input-error').textContent).toBe(GENERIC_ERROR);
  });

  it('a lookup that never answers ends in the slow message, at the email field', async () => {
    mount({
      admin: {
        admin_find_user: () => Promise.reject(Object.assign(new Error('t'), { timedOut: true })),
      },
    });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect($('#adm-owner-email-input-error').textContent).toBe(SLOW_MESSAGE);
  });

  it('a lookup answer whose account id is not an id is not used', async () => {
    mount({ admin: { admin_find_user: ok([accountRow({ user_id: 'not-an-id' })]) } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect(text()).not.toContain('Found:');
    expect($('#adm-owner-email-input-error').textContent).toBe(GENERIC_ERROR);
  });

  it('an answer for an owner kind that is no longer chosen is thrown away', async () => {
    let answer;
    mount({
      admin: {
        admin_find_user: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    chooseExisting();
    typeInto('adm-owner-email-input', 'staff@alpha.test');
    buttonNamed('Look up account').click();
    const back = $('#adm-owner-new');
    back.checked = true;
    back.dispatchEvent(new Event('change', { bubbles: true }));
    answer(ok([accountRow()]));
    await flush();
    chooseExisting();
    expect(text()).not.toContain('Found:');
    // and the button is not stuck on "Looking up…"
    expect(buttonNamed('Look up account')).toBeDefined();
  });

  it('a lookup still out when the form is sent changes nothing when it answers: the ticked box stays ticked', async () => {
    let answerSecond;
    let lookups = 0;
    let finishCreate;
    mount({
      admin: {
        admin_find_user: () => {
          lookups += 1;
          if (lookups === 1) return ok([accountRow({ needs_attestation: true })]);
          return new Promise((resolve) => {
            answerSecond = resolve;
          });
        },
        admin_create_org: () =>
          new Promise((resolve) => {
            finishCreate = resolve;
          }),
      },
    });
    chooseExisting();
    fillOrg();
    await lookUp('staff@alpha.test');
    const box = $('#adm-attest');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    // a second look is asked for, and is still out when the form is sent
    buttonNamed('Look up account').click();
    await submit();
    // it answers while the organisation is being made: it must not untick the box under the request
    answerSecond(ok([accountRow({ needs_attestation: true })]));
    await flush();
    expect($('#adm-attest').checked).toBe(true);
    expect(buttonNamed('Look up account').getAttribute('aria-disabled')).toBe('true');
    finishCreate(ok(ORG_ID));
    await flush();
    expect($('h1').textContent).toBe('Organisation created');
  });

  it('while a request is out the lookup button and the radios do nothing, and the text fields cannot be typed in', async () => {
    const { callAdmin } = mount({
      login: () => new Promise(() => {}),
      admin: { admin_find_user: ok([accountRow()]) },
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    expect($('#adm-org-name-input').readOnly).toBe(true);
    expect($('#adm-org-slug-input').readOnly).toBe(true);
    expect($('#adm-owner-email-input').readOnly).toBe(true);
    buttonNamed('Look up account').click();
    await flush();
    expect(callAdmin).not.toHaveBeenCalled();
    const other = $('#adm-owner-existing');
    other.checked = true;
    other.dispatchEvent(new Event('change', { bubbles: true }));
    expect(other.checked).toBe(false);
    expect($('#adm-owner-new').checked).toBe(true);
  });

  it('a gate refusal during a lookup clears the panel', async () => {
    mount({ admin: { admin_find_user: refused('admin_session_ended') } });
    chooseExisting();
    await lookUp('staff@alpha.test');
    expect(host.innerHTML).toBe('');
  });

  it('refuses to look up something that is not an email, without asking', async () => {
    const { callAdmin } = mount();
    chooseExisting();
    await lookUp('staff');
    expect(callAdmin).not.toHaveBeenCalled();
    expect($('#adm-owner-email-input-error').textContent).toBe('Enter a valid email address.');
  });

  it('creating without a lookup is refused with a reason, and asks for nothing', async () => {
    const { callAdmin } = mount();
    chooseExisting();
    fillOrg();
    typeInto('adm-owner-email-input', 'staff@alpha.test');
    await submit();
    expect(callAdmin).not.toHaveBeenCalled();
    expect(feedback()).toBe('Look up the account first.');
    expect(document.activeElement).toBe(buttonNamed('Look up account'));
  });

  it('changing the email after a lookup throws the lookup away: it answered for another address', async () => {
    const { callAdmin } = mount({ admin: { admin_find_user: found() } });
    chooseExisting();
    fillOrg();
    await lookUp('staff@alpha.test');
    typeInto('adm-owner-email-input', 'someone-else@alpha.test');
    expect(text()).not.toContain('Found:');
    await submit();
    expect(callAdmin).toHaveBeenCalledTimes(1); // only the lookup
    expect(feedback()).toBe('Look up the account first.');
  });

  it('a lookup that answers after the email changed is thrown away', async () => {
    let answer;
    mount({
      admin: {
        admin_find_user: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    });
    chooseExisting();
    typeInto('adm-owner-email-input', 'staff@alpha.test');
    buttonNamed('Look up account').click();
    typeInto('adm-owner-email-input', 'other@alpha.test');
    answer(found());
    await flush();
    expect(text()).not.toContain('Found:');
  });

  it('an account that is disabled or deleted cannot be made an owner, and nothing is asked', async () => {
    for (const flag of ['banned', 'deleted']) {
      const { callAdmin } = mount({ admin: { admin_find_user: found({ [flag]: true }) } });
      chooseExisting();
      fillOrg();
      await lookUp('staff@alpha.test');
      expect(text(), flag).toContain('disabled or deleted');
      await submit();
      expect(callAdmin, flag).toHaveBeenCalledTimes(1);
      expect(feedback(), flag).toBe(
        'This account is disabled or deleted, so it cannot own an organisation.',
      );
      handle.unmount();
      host.remove();
    }
  });

  it('attaches the account that was found, as its owner, without making a login', async () => {
    const { callAdmin, callFunction } = mount({
      admin: { admin_find_user: found(), admin_create_org: ok(ORG_ID) },
    });
    chooseExisting();
    fillOrg('Alpha Roasters', 'alpha-roasters');
    await lookUp('staff@alpha.test');
    await submit();
    expect(callFunction).not.toHaveBeenCalled();
    expect(callAdmin).toHaveBeenLastCalledWith('admin_create_org', {
      p_name: 'Alpha Roasters',
      p_slug: 'alpha-roasters',
      p_owner_user_id: OTHER_ID,
      p_attest_own_password: false,
    });
    expect($('h1').textContent).toBe('Organisation created');
    // no password exists for this owner: the way on is offered at once
    expect(text()).not.toContain('One-time password');
    expect($('a[href^="#/orgs/"]').getAttribute('href')).toBe(`#/orgs/${ORG_ID}`);
    expect(buttonNamed('Create another')).toBeDefined();
  });

  describe('an account whose password someone else may know', () => {
    const needs = () => found({ needs_attestation: true, org_count: 1 });

    it('shows the reason and a box to tick, unticked', async () => {
      mount({ admin: { admin_find_user: needs() } });
      chooseExisting();
      await lookUp('staff@alpha.test');
      const box = $('#adm-attest');
      expect(box.type).toBe('checkbox');
      expect(box.checked).toBe(false);
      expect($('label[for="adm-attest"]').textContent).toBe(
        'I have confirmed that this person set their own password.',
      );
      expect(text()).toContain(ADMIN_ERROR_COPY.member_password_unset);
    });

    it('is not created until the box is ticked, and asks for nothing meanwhile', async () => {
      const { callAdmin } = mount({
        admin: { admin_find_user: needs(), admin_create_org: ok(ORG_ID) },
      });
      chooseExisting();
      fillOrg();
      await lookUp('staff@alpha.test');
      await submit();
      expect(callAdmin).toHaveBeenCalledTimes(1);
      expect(feedback()).toBe('Tick the box to confirm that this person set their own password.');
      expect(document.activeElement).toBe($('#adm-attest'));
    });

    it('ticked, it says so to the database', async () => {
      const { callAdmin } = mount({
        admin: { admin_find_user: needs(), admin_create_org: ok(ORG_ID) },
      });
      chooseExisting();
      fillOrg();
      await lookUp('staff@alpha.test');
      const box = $('#adm-attest');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await submit();
      expect(callAdmin).toHaveBeenLastCalledWith(
        'admin_create_org',
        expect.objectContaining({ p_attest_own_password: true, p_owner_user_id: OTHER_ID }),
      );
    });

    it('a new lookup unticks it: the confirmation was for the account looked up before', async () => {
      mount({ admin: { admin_find_user: needs() } });
      chooseExisting();
      await lookUp('staff@alpha.test');
      const box = $('#adm-attest');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      buttonNamed('Look up account').click();
      await flush();
      expect($('#adm-attest').checked).toBe(false);
    });

    it('an account that only became one after the lookup is refused by the database, and the box appears', async () => {
      let lookups = 0;
      mount({
        admin: {
          admin_find_user: () => {
            lookups += 1;
            return lookups === 1 ? found({ needs_attestation: false }) : needs();
          },
          admin_create_org: refused('member_password_unset'),
        },
      });
      chooseExisting();
      fillOrg();
      await lookUp('staff@alpha.test');
      expect($('#adm-attest')).toBeNull();
      await submit();
      expect(feedback()).toBe(ADMIN_ERROR_COPY.member_password_unset);
      expect(lookups).toBe(2);
      expect($('#adm-attest')).not.toBeNull();
    });
  });

  it('a refusal of the organisation step has words and leaves the lookup in place', async () => {
    const { callAdmin } = mount({
      admin: { admin_find_user: found(), admin_create_org: refused('org_slug_taken') },
    });
    chooseExisting();
    fillOrg();
    await lookUp('staff@alpha.test');
    await submit();
    expect(feedback()).toBe(ADMIN_ERROR_COPY.org_slug_taken);
    expect(text()).toContain('Found: staff@alpha.test');
    typeInto('adm-org-slug-input', 'alpha-two');
    await submit();
    expect(callAdmin).toHaveBeenLastCalledWith(
      'admin_create_org',
      expect.objectContaining({ p_slug: 'alpha-two', p_owner_user_id: OTHER_ID }),
    );
  });

  it('does not ask the browser before unload: no password is on screen', async () => {
    mount({ admin: { admin_find_user: found(), admin_create_org: ok(ORG_ID) } });
    chooseExisting();
    fillOrg();
    await lookUp('staff@alpha.test');
    await submit();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('what the result links to', () => {
  it('an id that is not a UUID gets no link, not a broken one', async () => {
    mount({ admin: { admin_find_user: ok([accountRow()]), admin_create_org: ok('not-an-id') } });
    chooseExisting();
    fillOrg();
    await lookUp('staff@alpha.test');
    await submit();
    expect($('h1').textContent).toBe('Organisation created');
    expect($('a')).toBeNull();
  });

  it('writes names and emails as text, never as markup', async () => {
    mount({
      admin: {
        admin_find_user: ok([accountRow({ email: '<img src=x>@a.test' })]),
        admin_create_org: ok(ORG_ID),
      },
    });
    chooseExisting();
    fillOrg('<script>x()</script>', 'alpha-roasters');
    await lookUp('staff@alpha.test');
    expect(host.querySelector('img')).toBeNull();
    await submit();
    expect(host.querySelector('script, img')).toBeNull();
    expect(text()).toContain('<script>x()</script> was created.');
  });
});

describe('focus', () => {
  it('an error that arrives late does not take focus from where the person has since moved', async () => {
    let fail;
    mount({
      login: () =>
        new Promise((resolve) => {
          fail = resolve;
        }),
    });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    await submit();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fail(refused('something_new', { status: 400 }));
    await flush();
    expect(feedback()).toBe(GENERIC_ERROR);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('an error takes focus when focus is on the panel, so it is announced', async () => {
    mount({ login: refused('something_new', { status: 400 }) });
    fillOrg();
    typeInto('adm-owner-email-input', 'owner@alpha.test');
    $('#adm-org-name-input').focus();
    await submit();
    expect(document.activeElement).toBe($('.screen-feedback'));
  });

  it('mounting does not move focus by itself (the shell moves it to the heading when the panel opens)', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    mount();
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
