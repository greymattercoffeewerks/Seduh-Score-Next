import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  addMemberSection,
  roleControl,
  ADD_STATE_UNKNOWN,
  ROLE_STATE_UNKNOWN,
  WRITE_IN_FLIGHT,
} from './memberActions.js';
import { ADMIN_ERROR_COPY, GENERIC_ERROR } from './adminErrors.js';
import { SLOW_MESSAGE } from './gate.js';
import { flush } from './consoleHarness.js';

// The two things the operator can do to an organisation's membership, and the account lookup the first one uses,
// against a fake ctx.callAdmin: what is asked and in what shape, what is said when the database refuses (by hint),
// and above all that a request that may have been carried out is never reported as "nothing changed".

const ORG = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

const ok = (data = null) => ({ data, error: null });
const refused = (hint, extra = {}) => ({ data: null, error: { hint, ...extra } });
const account = (over = {}) => ({
  user_id: OTHER,
  email: 'staff@alpha.test',
  banned: false,
  deleted: false,
  org_count: 0,
  must_change_password: false,
  needs_attestation: false,
  ...over,
});

let root;
let handle;
const calls = [];
const unexpected = [];
function ctxOf(answers) {
  const callAdmin = vi.fn(async (name, args) => {
    calls.push([name, args]);
    const answer = answers[name];
    if (answer === undefined) {
      unexpected.push(name);
      throw new Error(`unexpected call ${name}`);
    }
    return typeof answer === 'function' ? answer(args) : answer;
  });
  return { callAdmin };
}
const $ = (selector) => root.querySelector(selector);
const text = () => root.textContent;
const buttonNamed = (label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

function typeEmail(value) {
  const input = $('#adm-member-email');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function lookUp(email = 'staff@alpha.test') {
  typeEmail(email);
  buttonNamed('Look up account').click();
  await flush();
}
const submit = async () => {
  $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};
const tick = (selector) => {
  const box = $(selector);
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

afterEach(() => {
  expect(unexpected, 'a call the test did not expect').toEqual([]);
  handle?.dispose?.();
  root?.remove();
  root = handle = undefined;
  calls.length = 0;
  vi.useRealTimers();
});

describe('Add a member', () => {
  function mount(answers, extra = {}) {
    const ctx = ctxOf(answers);
    const onAdded = vi.fn();
    const onGateRefused = vi.fn();
    handle = addMemberSection({
      ctx,
      orgId: ORG,
      onAdded,
      onGateRefused,
      mayTakeFocus: () => true,
      ...extra,
    });
    root = document.createElement('div');
    root.appendChild(handle.node);
    document.body.appendChild(root);
    return { ctx, onAdded, onGateRefused };
  }

  it('has a heading, a labelled email and role, and says what it is for', () => {
    mount({});
    expect($('h2').textContent).toBe('Add a member');
    expect($('label[for="adm-member-email"]').textContent).toBe('Account email');
    expect($('label[for="adm-member-role"]').textContent).toBe('Role');
    expect([...$('#adm-member-role').options].map((o) => o.value)).toEqual(['organiser', 'owner']);
    expect($('#adm-member-role').value).toBe('organiser');
    expect(text()).toContain('To make a new login, create an organisation instead.');
  });

  it('looks the account up by the email as typed (trimmed) and says what it found', async () => {
    const { ctx } = mount({ admin_find_user: ok([account({ org_count: 2 })]) });
    await lookUp('  staff@alpha.test ');
    expect(ctx.callAdmin).toHaveBeenCalledWith('admin_find_user', { p_email: 'staff@alpha.test' });
    expect(text()).toContain('Found: staff@alpha.test');
    expect(text()).toContain('This account is already in 2 organisations.');
    expect($('#adm-member-attest')).toBeNull();
  });

  it('attaches the account that was found, with the chosen role, for THIS organisation', async () => {
    const { ctx, onAdded } = mount({
      admin_find_user: ok([account()]),
      admin_add_member: ok(),
    });
    await lookUp();
    $('#adm-member-role').value = 'owner';
    await submit();
    expect(ctx.callAdmin).toHaveBeenLastCalledWith('admin_add_member', {
      p_org_id: ORG,
      p_user_id: OTHER,
      p_role: 'owner',
      p_attest_own_password: false,
    });
    expect(onAdded).toHaveBeenCalledWith({ email: 'staff@alpha.test', role: 'owner' });
  });

  it('asks nothing without a lookup, and says why', async () => {
    const { ctx } = mount({});
    typeEmail('staff@alpha.test');
    await submit();
    expect(ctx.callAdmin).not.toHaveBeenCalled();
    expect($('.screen-feedback').textContent).toBe('Look up the account first.');
    expect(document.activeElement).toBe(buttonNamed('Look up account'));
  });

  it('refuses something that is not an email without asking', async () => {
    const { ctx } = mount({});
    await lookUp('staff');
    expect(ctx.callAdmin).not.toHaveBeenCalled();
    expect($('#adm-member-email-error').textContent).toBe('Enter a valid email address.');
    await submit();
    // said once, at the field (not again in the message region above it), and focus goes there
    expect($('.screen-feedback').textContent).toBe('');
    expect(document.activeElement).toBe($('#adm-member-email'));
  });

  it('no match is said at the email field, with focus there', async () => {
    mount({ admin_find_user: ok([]) });
    await lookUp('nobody@alpha.test');
    expect($('#adm-member-email-error').textContent).toBe(
      'No active account matches that. Check the email.',
    );
    expect($('#adm-member-email').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe($('#adm-member-email'));
    expect(text()).not.toContain('Found:');
  });

  it('a failed or slow lookup has words, and a lookup answer with a bad id is not used', async () => {
    mount({ admin_find_user: refused('email_ambiguous') });
    await lookUp();
    expect($('#adm-member-email-error').textContent).toBe(ADMIN_ERROR_COPY.email_ambiguous);
    handle.dispose();
    root.remove();
    mount({ admin_find_user: refused(undefined) });
    await lookUp();
    expect($('#adm-member-email-error').textContent).toBe(GENERIC_ERROR);
    handle.dispose();
    root.remove();
    mount({
      admin_find_user: () => Promise.reject(Object.assign(new Error('t'), { timedOut: true })),
    });
    await lookUp();
    expect($('#adm-member-email-error').textContent).toBe(SLOW_MESSAGE);
    handle.dispose();
    root.remove();
    mount({ admin_find_user: ok([account({ user_id: 'not-an-id' })]) });
    await lookUp();
    expect(text()).not.toContain('Found:');
    expect($('#adm-member-email-error').textContent).toBe(GENERIC_ERROR);
  });

  it('an account that is disabled or deleted cannot be added, and nothing is asked', async () => {
    for (const flag of ['banned', 'deleted']) {
      const { ctx } = mount({ admin_find_user: ok([account({ [flag]: true })]) });
      await lookUp();
      expect(text(), flag).toContain('disabled or deleted');
      await submit();
      expect(ctx.callAdmin, flag).toHaveBeenCalledTimes(1);
      expect($('.screen-feedback').textContent, flag).toBe(
        'This account is disabled or deleted, so it cannot be added.',
      );
      handle.dispose();
      root.remove();
    }
  });

  it('changing the email after a lookup throws the lookup away', async () => {
    const { ctx } = mount({ admin_find_user: ok([account()]), admin_add_member: ok() });
    await lookUp();
    typeEmail('other@alpha.test');
    expect(text()).not.toContain('Found:');
    await submit();
    expect(ctx.callAdmin).toHaveBeenCalledTimes(1);
    expect($('.screen-feedback').textContent).toBe('Look up the account first.');
  });

  it('a lookup that answers after the email changed is thrown away', async () => {
    let answer;
    mount({
      admin_find_user: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    typeEmail('staff@alpha.test');
    buttonNamed('Look up account').click();
    typeEmail('other@alpha.test');
    answer(ok([account()]));
    await flush();
    expect(text()).not.toContain('Found:');
    expect(buttonNamed('Look up account').getAttribute('aria-disabled')).not.toBe('true');
  });

  describe('an account whose password someone else may know', () => {
    const needs = () => ok([account({ needs_attestation: true, org_count: 1 })]);

    it('shows the reason and an unticked box, and is not attached until it is ticked', async () => {
      const { ctx } = mount({ admin_find_user: needs(), admin_add_member: ok() });
      await lookUp();
      expect($('#adm-member-attest').checked).toBe(false);
      expect(text()).toContain(ADMIN_ERROR_COPY.member_password_unset);
      await submit();
      expect(ctx.callAdmin).toHaveBeenCalledTimes(1);
      expect($('.screen-feedback').textContent).toBe(
        'Tick the box to confirm that this person set their own password.',
      );
      expect(document.activeElement).toBe($('#adm-member-attest'));
    });

    it('ticked, it says so to the database', async () => {
      const { ctx } = mount({ admin_find_user: needs(), admin_add_member: ok() });
      await lookUp();
      tick('#adm-member-attest');
      await submit();
      expect(ctx.callAdmin).toHaveBeenLastCalledWith(
        'admin_add_member',
        expect.objectContaining({ p_attest_own_password: true, p_user_id: OTHER }),
      );
    });

    it('a new lookup unticks it', async () => {
      mount({ admin_find_user: needs() });
      await lookUp();
      tick('#adm-member-attest');
      buttonNamed('Look up account').click();
      await flush();
      expect($('#adm-member-attest').checked).toBe(false);
    });

    it('an account that only became one after the lookup is refused by the database, and the box appears', async () => {
      let lookups = 0;
      mount({
        admin_find_user: () => {
          lookups += 1;
          return lookups === 1 ? ok([account({ needs_attestation: false })]) : needs();
        },
        admin_add_member: refused('member_password_unset'),
      });
      await lookUp();
      expect($('#adm-member-attest')).toBeNull();
      await submit();
      expect($('.screen-feedback').textContent).toBe(ADMIN_ERROR_COPY.member_password_unset);
      expect(lookups).toBe(2);
      expect($('#adm-member-attest')).not.toBeNull();
    });
  });

  describe('when the database refuses', () => {
    async function refuse(error) {
      const m = mount({ admin_find_user: ok([account()]), admin_add_member: error });
      await lookUp();
      await submit();
      return m;
    }

    it('says each documented refusal in words, and does not report it as added', async () => {
      for (const hint of [
        'member_exists',
        'org_not_found',
        'admin_self_target',
        'member_role_invalid',
        'member_user_not_found',
      ]) {
        const { onAdded } = await refuse(refused(hint));
        expect($('.screen-feedback').textContent, hint).toBe(ADMIN_ERROR_COPY[hint]);
        expect(onAdded, hint).not.toHaveBeenCalled();
        handle.dispose();
        root.remove();
      }
      // a hint this console has no words for: the database did raise it, but what it means is unknown
      await refuse(refused('something_new'));
      expect($('.screen-feedback').textContent).toBe(ADD_STATE_UNKNOWN);
    });

    it('an error with no hint (a dropped connection, a server error) says the member may have been added', async () => {
      await refuse({ data: null, error: { message: 'Failed to fetch' } });
      expect($('.screen-feedback').textContent).toBe(ADD_STATE_UNKNOWN);
    });

    it('a request that never answers says the member may have been added', async () => {
      vi.useFakeTimers();
      mount({ admin_find_user: ok([account()]), admin_add_member: () => new Promise(() => {}) });
      typeEmail('staff@alpha.test');
      buttonNamed('Look up account').click();
      await vi.advanceTimersByTimeAsync(10);
      $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10001);
      expect($('.screen-feedback').textContent).toBe(ADD_STATE_UNKNOWN);
      expect($('#adm-member-email').readOnly).toBe(false);
    });

    it('a gate refusal is left to the console: nothing is drawn, onAdded is not called', async () => {
      const { onGateRefused, onAdded } = await refuse(refused('admin_mfa_required'));
      expect(onGateRefused).toHaveBeenCalledTimes(1);
      expect(onAdded).not.toHaveBeenCalled();
      expect($('.screen-feedback').textContent).toBe('');
    });

    it('the form is usable again afterwards', async () => {
      await refuse(refused('member_exists'));
      expect($('#adm-member-email').readOnly).toBe(false);
      expect(buttonNamed('Add member').getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  it('takes a submit once, and stops the other controls while a request is out', async () => {
    let finish;
    const { ctx } = mount({
      admin_find_user: ok([account()]),
      admin_add_member: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await lookUp();
    await submit();
    await submit();
    await submit();
    expect(ctx.callAdmin.mock.calls.filter(([n]) => n === 'admin_add_member')).toHaveLength(1);
    expect(buttonNamed('Adding…').getAttribute('aria-disabled')).toBe('true');
    expect($('#adm-member-email').readOnly).toBe(true);
    expect($('#adm-member-role').disabled).toBe(true);
    buttonNamed('Look up account').click();
    await flush();
    expect(ctx.callAdmin.mock.calls.filter(([n]) => n === 'admin_find_user')).toHaveLength(1);
    finish(ok());
    await flush();
  });

  it('a lookup still out when the form is sent changes nothing when it answers: the ticked box stays', async () => {
    let lookups = 0;
    let answerSecond;
    let finish;
    mount({
      admin_find_user: () => {
        lookups += 1;
        if (lookups === 1) return ok([account({ needs_attestation: true })]);
        return new Promise((resolve) => {
          answerSecond = resolve;
        });
      },
      admin_add_member: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await lookUp();
    tick('#adm-member-attest');
    buttonNamed('Look up account').click();
    await submit();
    answerSecond(ok([account({ needs_attestation: true })]));
    await flush();
    expect($('#adm-member-attest').checked).toBe(true);
    finish(ok());
    await flush();
  });

  it('after dispose a late lookup answer draws nothing', async () => {
    let answer;
    mount({
      admin_find_user: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    typeEmail('staff@alpha.test');
    buttonNamed('Look up account').click();
    handle.dispose();
    answer(ok([account()]));
    await flush();
    expect(text()).not.toContain('Found:');
  });

  it('writes an email as text, never as markup', async () => {
    mount({ admin_find_user: ok([account({ email: '<img src=x>@a.test' })]) });
    await lookUp();
    expect(root.querySelector('img')).toBeNull();
    expect(text()).toContain('<img src=x>@a.test');
  });
});

describe('Change a role', () => {
  const member = (over = {}) => ({
    user_id: USER,
    email: 'staff@alpha.test',
    role: 'organiser',
    joined_at: '2026-10-03T08:00:00Z',
    ...over,
  });
  function mount(answers, who = member()) {
    const ctx = ctxOf(answers);
    const onChanged = vi.fn();
    const onGateRefused = vi.fn();
    root = document.createElement('div');
    root.appendChild(
      roleControl({
        ctx,
        orgId: ORG,
        member: who,
        onChanged,
        onGateRefused,
        mayTakeFocus: () => true,
      }),
    );
    document.body.appendChild(root);
    return { ctx, onChanged, onGateRefused };
  }

  it('offers the other role, named for the member it is about', () => {
    mount({});
    const b = buttonNamed('Make owner');
    // the visible words come first in the name (WCAG 2.5.3: "Make owner" said aloud reaches this button)
    expect(b.getAttribute('aria-label')).toBe('Make owner: staff@alpha.test');
    root.remove();
    mount({}, member({ role: 'owner' }));
    const demote = buttonNamed('Make organiser');
    expect(demote.getAttribute('aria-label')).toBe('Make organiser: staff@alpha.test');
  });

  it('offers nothing for a role it does not know, or a member with no id', () => {
    mount({}, member({ role: 'steward' }));
    expect(root.querySelector('button')).toBeNull();
    root.remove();
    mount({}, member({ role: 'constructor' }));
    expect(root.querySelector('button')).toBeNull();
    root.remove();
    mount({}, member({ user_id: undefined }));
    expect(root.querySelector('button')).toBeNull();
  });

  it('asks before changing anything, naming both roles, and Cancel puts the button back with focus', async () => {
    const { ctx } = mount({ admin_set_role: ok() });
    buttonNamed('Make owner').click();
    expect(text()).toContain('Change staff@alpha.test from Organiser to Owner?');
    expect(document.activeElement.textContent).toContain('Change staff@alpha.test');
    expect(ctx.callAdmin).not.toHaveBeenCalled();
    buttonNamed('Cancel').click();
    expect(document.activeElement).toBe(buttonNamed('Make owner'));
    expect(ctx.callAdmin).not.toHaveBeenCalled();
  });

  it('Confirm changes THIS member of THIS organisation to the other role, and reports it', async () => {
    const { ctx, onChanged } = mount({ admin_set_role: ok() });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(ctx.callAdmin).toHaveBeenCalledWith('admin_set_role', {
      p_org_id: ORG,
      p_user_id: USER,
      p_role: 'owner',
    });
    expect(onChanged).toHaveBeenCalledWith({ email: 'staff@alpha.test', to: 'owner' });
  });

  it('an owner is demoted to organiser', async () => {
    const { ctx } = mount({ admin_set_role: ok() }, member({ role: 'owner' }));
    buttonNamed('Make organiser').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(ctx.callAdmin).toHaveBeenCalledWith(
      'admin_set_role',
      expect.objectContaining({ p_role: 'organiser' }),
    );
  });

  it('takes a confirmation once', async () => {
    let finish;
    const { ctx } = mount({
      admin_set_role: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    buttonNamed('Make owner').click();
    const confirm = buttonNamed('Confirm');
    confirm.click();
    confirm.click();
    buttonNamed('Cancel').click();
    expect(ctx.callAdmin).toHaveBeenCalledTimes(1);
    expect(buttonNamed('Changing…').getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('Change staff@alpha.test'); // Cancel did nothing while the request was out
    finish(ok());
    await flush();
  });

  it('the last owner is refused in words, and nothing is reported as changed', async () => {
    const { onChanged } = mount(
      { admin_set_role: refused('last_owner') },
      member({ role: 'owner' }),
    );
    buttonNamed('Make organiser').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(text()).toContain(ADMIN_ERROR_COPY.last_owner);
    expect(onChanged).not.toHaveBeenCalled();
    // and it can be tried again, or cancelled
    expect(buttonNamed('Confirm').getAttribute('aria-disabled')).not.toBe('true');
    // focus goes to the refusal itself, which is what the person needs to hear (not back to the button that failed)
    expect(document.activeElement).toBe(root.querySelector('.adm-field-error'));
  });

  it('says each other documented refusal in words', async () => {
    for (const hint of [
      'admin_self_target',
      'member_not_found',
      'member_role_invalid',
      'org_not_found',
    ]) {
      mount({ admin_set_role: refused(hint) });
      buttonNamed('Make owner').click();
      buttonNamed('Confirm').click();
      await flush();
      expect(text(), hint).toContain(ADMIN_ERROR_COPY[hint]);
      root.remove();
    }
  });

  it('an error with no hint says the role may have changed, not that nothing did', async () => {
    mount({ admin_set_role: { data: null, error: { message: 'Failed to fetch' } } });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(text()).toContain(ROLE_STATE_UNKNOWN);
  });

  it('a timeout says the same', async () => {
    vi.useFakeTimers();
    mount({ admin_set_role: () => new Promise(() => {}) });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await vi.advanceTimersByTimeAsync(10001);
    expect(text()).toContain(ROLE_STATE_UNKNOWN);
  });

  it('a gate refusal is left to the console', async () => {
    const { onGateRefused, onChanged } = mount({ admin_set_role: refused('admin_session_ended') });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(onGateRefused).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('writes the email as text, never as markup', () => {
    mount({}, member({ email: '<img src=x>@a.test' }));
    buttonNamed('Make owner').click();
    expect(root.querySelector('img')).toBeNull();
  });
});

describe('Add a member: more of what it promises', () => {
  function mount(answers, extra = {}) {
    const ctx = ctxOf(answers);
    const onAdded = vi.fn();
    handle = addMemberSection({
      ctx,
      orgId: ORG,
      onAdded,
      onGateRefused: vi.fn(),
      mayTakeFocus: () => true,
      ...extra,
    });
    root = document.createElement('div');
    root.appendChild(handle.node);
    document.body.appendChild(root);
    return { ctx, onAdded };
  }

  it('pressing Enter in the email field looks the account up, and does not send the form', async () => {
    const { ctx } = mount({ admin_find_user: ok([account()]), admin_add_member: ok() });
    const input = $('#adm-member-email');
    input.value = 'staff@alpha.test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await flush();
    expect(ctx.callAdmin).toHaveBeenCalledWith('admin_find_user', { p_email: 'staff@alpha.test' });
    expect(text()).toContain('Found: staff@alpha.test');
    expect(ctx.callAdmin.mock.calls.some(([name]) => name === 'admin_add_member')).toBe(false);
  });

  it('a double click on Look up asks once', async () => {
    const { ctx } = mount({ admin_find_user: ok([account()]) });
    typeEmail('staff@alpha.test');
    const look = buttonNamed('Look up account');
    look.click();
    look.click();
    await flush();
    expect(ctx.callAdmin.mock.calls.filter(([name]) => name === 'admin_find_user')).toHaveLength(1);
  });

  it('sends nothing for an address changed without an input event (autofill): the lookup was for another', async () => {
    const { ctx } = mount({ admin_find_user: ok([account()]), admin_add_member: ok() });
    await lookUp('staff@alpha.test');
    $('#adm-member-email').value = 'other@alpha.test'; // no event
    await submit();
    expect(ctx.callAdmin.mock.calls.filter(([name]) => name === 'admin_add_member')).toHaveLength(
      0,
    );
    expect($('.screen-feedback').textContent).toBe('Look up the account first.');
  });

  it('puts focus on the email field for a problem with the account', async () => {
    mount({ admin_find_user: ok([account({ banned: true })]) });
    await lookUp();
    document.activeElement.blur();
    await submit();
    expect(document.activeElement).toBe($('#adm-member-email'));
  });

  it('does not take focus from where the person has moved when a refusal or a lookup problem arrives', async () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    mount(
      { admin_find_user: ok([account()]), admin_add_member: refused('member_exists') },
      { mayTakeFocus: () => false },
    );
    await lookUp();
    elsewhere.focus();
    await submit();
    expect($('.screen-feedback').textContent).toBe(ADMIN_ERROR_COPY.member_exists);
    expect(document.activeElement).toBe(elsewhere);
    handle.dispose();
    root.remove();
    mount({ admin_find_user: ok([]) }, { mayTakeFocus: () => false });
    elsewhere.focus();
    await lookUp('nobody@alpha.test');
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('an error message is marked as an error, and the fields carry their required and described-by wiring', async () => {
    mount({ admin_find_user: ok([account()]), admin_add_member: refused('member_exists') });
    await lookUp();
    await submit();
    expect($('.screen-feedback').dataset.tone).toBe('error');
    expect($('#adm-member-email').getAttribute('aria-required')).toBe('true');
    expect($('#adm-member-email').getAttribute('aria-describedby')).toContain(
      'adm-member-email-error',
    );
    expect($('#adm-member-role').getAttribute('aria-describedby')).toBe(
      'adm-member-role-hint adm-member-role-error',
    );
  });

  it('while another change on the page is under way it is told to wait, and sends nothing', async () => {
    const writes = { begin: () => false, end: () => {} };
    const { ctx } = mount({ admin_find_user: ok([account()]), admin_add_member: ok() }, { writes });
    await lookUp();
    await submit();
    expect(ctx.callAdmin.mock.calls.filter(([name]) => name === 'admin_add_member')).toHaveLength(
      0,
    );
    expect($('.screen-feedback').textContent).toBe(WRITE_IN_FLIGHT);
  });

  it('gives the page its claim back when it fails', async () => {
    const writes = { begin: vi.fn(() => true), end: vi.fn() };
    mount(
      { admin_find_user: ok([account()]), admin_add_member: refused('member_exists') },
      { writes },
    );
    await lookUp();
    await submit();
    expect(writes.begin).toHaveBeenCalledTimes(1);
    expect(writes.end).toHaveBeenCalledTimes(1);
  });
});

describe('Change a role: more of what it promises', () => {
  const member = (over = {}) => ({
    user_id: USER,
    email: 'staff@alpha.test',
    role: 'organiser',
    joined_at: null,
    ...over,
  });
  function mount(answers, extra = {}, who = member()) {
    const ctx = ctxOf(answers);
    const onChanged = vi.fn();
    root = document.createElement('div');
    root.appendChild(
      roleControl({
        ctx,
        orgId: ORG,
        member: who,
        onChanged,
        onGateRefused: vi.fn(),
        mayTakeFocus: () => true,
        ...extra,
      }),
    );
    document.body.appendChild(root);
    return { ctx, onChanged };
  }

  it('offers no button for a member whose id is not an id', () => {
    mount({}, {}, member({ user_id: 'not-an-id' }));
    expect(root.querySelector('button')).toBeNull();
  });

  it('the message region is a live region that exists from the start, so a refusal is announced', () => {
    mount({});
    const message = root.querySelector('.adm-field-error');
    expect(message.getAttribute('role')).toBe('status');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(message.textContent).toBe('');
  });

  it('a hint this console has no words for says the role may have changed', async () => {
    mount({ admin_set_role: refused('something_new') });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(text()).toContain(ROLE_STATE_UNKNOWN);
  });

  it('Cancel stops too while the request is out', async () => {
    mount({ admin_set_role: () => new Promise(() => {}) });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    expect(buttonNamed('Cancel').getAttribute('aria-disabled')).toBe('true');
  });

  it('does not take focus from where the person has moved when a refusal arrives', async () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    mount({ admin_set_role: refused('last_owner') }, { mayTakeFocus: () => false });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    elsewhere.focus();
    await flush();
    expect(text()).toContain(ADMIN_ERROR_COPY.last_owner);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('while another change on the page is under way it is told to wait, and sends nothing', async () => {
    const writes = { begin: () => false, end: () => {} };
    const { ctx } = mount({ admin_set_role: ok() }, { writes });
    buttonNamed('Make owner').click();
    buttonNamed('Confirm').click();
    await flush();
    expect(ctx.callAdmin).not.toHaveBeenCalled();
    expect(text()).toContain(WRITE_IN_FLIGHT);
    // and it can try again once the other is done
    expect(buttonNamed('Confirm').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('two controls on one page share one write: the second waits for the first', async () => {
    let writing = false;
    const writes = {
      begin: () => (writing ? false : (writing = true)),
      end: () => {
        writing = false;
      },
    };
    let finish;
    const ctx = ctxOf({
      admin_set_role: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    root = document.createElement('div');
    for (const email of ['a@alpha.test', 'b@alpha.test']) {
      root.appendChild(
        roleControl({
          ctx,
          orgId: ORG,
          member: member({ email, user_id: email === 'a@alpha.test' ? USER : OTHER }),
          onChanged: vi.fn(),
          onGateRefused: vi.fn(),
          mayTakeFocus: () => true,
          writes,
        }),
      );
    }
    document.body.appendChild(root);
    const [first, second] = root.querySelectorAll('.adm-role-control');
    first.querySelector('button').click();
    first.querySelector('button.btn-primary').click();
    second.querySelector('button').click();
    second.querySelector('button.btn-primary').click();
    await flush();
    expect(ctx.callAdmin).toHaveBeenCalledTimes(1);
    expect(second.textContent).toContain(WRITE_IN_FLIGHT);
    finish(ok());
    await flush();
  });
});

describe('Change a role: the page-wide claim after a failure', () => {
  it('a refused change gives the claim back, so another control can then make its change', async () => {
    let writing = false;
    const writes = {
      begin: () => (writing ? false : (writing = true)),
      end: () => {
        writing = false;
      },
    };
    let answers = 0;
    const ctx = ctxOf({
      admin_set_role: () => {
        answers += 1;
        return answers === 1 ? refused('last_owner') : ok();
      },
    });
    root = document.createElement('div');
    for (const [email, id] of [
      ['a@alpha.test', USER],
      ['b@alpha.test', OTHER],
    ]) {
      root.appendChild(
        roleControl({
          ctx,
          orgId: ORG,
          member: { user_id: id, email, role: 'owner', joined_at: null },
          onChanged: vi.fn(),
          onGateRefused: vi.fn(),
          mayTakeFocus: () => true,
          writes,
        }),
      );
    }
    document.body.appendChild(root);
    const [first, second] = root.querySelectorAll('.adm-role-control');
    first.querySelector('button').click();
    first.querySelector('button.btn-primary').click();
    await flush();
    expect(first.textContent).toContain(ADMIN_ERROR_COPY.last_owner);
    second.querySelector('button').click();
    second.querySelector('button.btn-primary').click();
    await flush();
    expect(ctx.callAdmin).toHaveBeenCalledTimes(2);
    expect(second.textContent).not.toContain(WRITE_IN_FLIGHT);
  });
});
