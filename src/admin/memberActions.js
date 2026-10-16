// What the operator can do to an organisation's membership from its detail (spec D4): attach an EXISTING account
// with a role, and change a member's role. Both go through the database's admin functions (admin_add_member,
// admin_set_role), which refuse the cases that matter (the last owner, the operator's own account, an account whose
// password someone else may know without the operator's confirmation) with stable hints; this file only translates
// them (adminErrors.js) and never decides any of it itself.
//
// Shared guarantees, as in the New organisation panel:
// - A request that may have been carried out is never reported as "nothing changed": an error with no hint (a
//   dropped connection, a timeout, a server error), or a hint this console has no words for, says it may have
//   happened and to look at the list; only an error the database raised with a known hint is "refused".
// - One change at a time on a detail: `writes.begin()` is taken for the whole page, so two role changes (or a role
//   change and an add) never run at once; the second is told to wait instead of being dropped when the first one
//   redraws the page.
// - A control is taken once: it stops while its request is out.
// - A gate refusal is not drawn here (`onGateRefused`): the console is checking access again.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError, ADMIN_ERROR_COPY } from './adminErrors.js';
import { isGateRefusal } from './gate.js';
import { ask } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { field } from './formParts.js';
import { UUID } from './ids.js';
import { createAccountLookup } from './accountLookup.js';
import { ROLES, roleLabel, otherRole } from './roles.js';

export const ADD_STATE_UNKNOWN =
  'We could not confirm whether the member was added. Reload the page and check the member list before trying again.';
export const ROLE_STATE_UNKNOWN =
  'We could not confirm whether the role was changed. Reload the page to see the current role.';
export const WRITE_IN_FLIGHT =
  'Another change is still being made. Wait for it to finish, then try again.';

// A failure with no hint, or a hint this console has no words for, leaves it unknown whether the change was made.
const failureMessage = (error, unknown) =>
  error?.timedOut || !error?.hint || !Object.hasOwn(ADMIN_ERROR_COPY, error.hint)
    ? unknown
    : describeAdminError(error);

// One change at a time per detail: the default (a lone control, in a test) always allows it.
const ALWAYS = Object.freeze({ begin: () => true, end: () => {} });

// ---- add a member ----

// The "Add a member" section: lookup, a role, a button. `onAdded({ email, role })` runs once it is done (the caller
// reloads the detail, so the new member is drawn from the database's own answer).
export function addMemberSection({
  ctx,
  orgId,
  onAdded,
  mayTakeFocus,
  onGateRefused,
  writes = ALWAYS,
}) {
  let busy = false;
  const feedback = feedbackRegion();
  const lookup = createAccountLookup({
    ctx,
    idPrefix: 'adm-member',
    cannotUse: 'This account is disabled or deleted, so it cannot be added.',
    mayTakeFocus,
    onGateRefused,
  });

  const roleSelect = el(
    'select',
    { className: 'field-input', id: 'adm-member-role' },
    ROLES.map((role) => el('option', { text: roleLabel(role), attrs: { value: role } })),
  );
  const roleField = field({
    id: 'adm-member-role',
    label: 'Role',
    hint: 'An owner can manage the team and everything an organiser can.',
    input: roleSelect,
  });

  const submit = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Add member',
    attrs: { type: 'submit' },
  });
  const form = el('form', { className: 'adm-form', attrs: { novalidate: 'novalidate' } }, [
    lookup.node,
    roleField.wrapper,
    submit,
  ]);

  function lock(isBusy) {
    busy = isBusy;
    lookup.lock(isBusy);
    // natively disabled: aria-disabled would still let the role be changed after it was read
    roleSelect.disabled = isBusy;
    setBusyDisabled(submit, isBusy);
    submit.textContent = isBusy ? 'Adding…' : 'Add member';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const checked = lookup.check();
    if (!checked.account) {
      // A problem the email field already says is not said twice.
      setFeedback(feedback, checked.inField ? '' : checked.message, 'error', { focus: false });
      checked.focus?.focus();
      return;
    }
    if (!writes.begin()) {
      setFeedback(feedback, WRITE_IN_FLIGHT, 'error', { focus: false });
      return;
    }
    setFeedback(feedback, '');
    const { account } = checked;
    const role = roleSelect.value;
    lock(true);
    const answer = await ask(ctx, 'admin_add_member', {
      p_org_id: orgId,
      p_user_id: account.userId,
      p_role: role,
      p_attest_own_password: account.attest,
    });
    if (!form.isConnected) return;
    if (answer.error) {
      if (isGateRefusal(answer.error)) return onGateRefused();
      writes.end();
      lock(false);
      setFeedback(feedback, failureMessage(answer.error, ADD_STATE_UNKNOWN), 'error', {
        focus: mayTakeFocus(),
      });
      // The account gained a membership since it was looked up: look again, so the box to tick appears.
      if (answer.error.hint === 'member_password_unset') await lookup.refresh();
      return;
    }
    onAdded({ email: account.email, role });
  });

  return {
    node: el('section', { className: 'adm-section' }, [
      el('h2', { text: 'Add a member' }),
      el('p', {
        className: 'adm-muted',
        text: 'Attach an account that already exists. To make a new login, create an organisation instead.',
      }),
      feedback,
      form,
    ]),
    dispose: () => lookup.dispose(),
  };
}

// ---- change a role ----

// One member's role control: a button that says what it would do, then a question to confirm (both roles are
// consequential: an owner manages the team), then the change. `onChanged({ email, to })` runs when it is done.
export function roleControl({
  ctx,
  orgId,
  member,
  onChanged,
  mayTakeFocus,
  onGateRefused,
  writes = ALWAYS,
}) {
  const to = otherRole(member.role);
  const email = String(member.email ?? '');
  const holder = el('div', { className: 'adm-role-control' });
  // a role this console does not know, or a member whose id is not one: no button
  if (!to || !UUID.test(String(member.user_id ?? ''))) return holder;

  // Read aloud when it fills; focus goes to it after a refusal, because it is what the operator needs to hear.
  const message = el('p', {
    className: 'adm-field-error',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  let busy = false;

  function showButton({ focus = false } = {}) {
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: `Make ${to}`,
      // The visible words come first, so a person who says what they see ("Make owner") reaches the right one.
      attrs: { type: 'button', 'aria-label': `Make ${to}: ${email}` },
    });
    button.addEventListener('click', showQuestion);
    holder.replaceChildren(button, message);
    if (focus) button.focus();
  }

  function showQuestion() {
    const question = el('p', {
      text: `Change ${email} from ${roleLabel(member.role)} to ${roleLabel(to)}?`,
      attrs: { tabindex: '-1' },
    });
    const confirm = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Confirm',
      attrs: { type: 'button', 'aria-label': `Confirm: change ${email} to ${roleLabel(to)}` },
    });
    const cancel = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    cancel.addEventListener('click', () => {
      if (busy) return;
      message.textContent = '';
      showButton({ focus: true });
    });
    confirm.addEventListener('click', async () => {
      if (busy) return;
      if (!writes.begin()) {
        message.textContent = WRITE_IN_FLIGHT;
        return;
      }
      busy = true;
      message.textContent = '';
      for (const control of [confirm, cancel]) setBusyDisabled(control, true);
      confirm.textContent = 'Changing…';
      const answer = await ask(ctx, 'admin_set_role', {
        p_org_id: orgId,
        p_user_id: member.user_id,
        p_role: to,
      });
      if (!holder.isConnected) return;
      if (answer.error) {
        if (isGateRefusal(answer.error)) return onGateRefused();
        busy = false;
        writes.end();
        for (const control of [confirm, cancel]) setBusyDisabled(control, false);
        confirm.textContent = 'Confirm';
        message.textContent = failureMessage(answer.error, ROLE_STATE_UNKNOWN);
        if (mayTakeFocus()) message.focus();
        return;
      }
      onChanged({ email, to });
    });
    holder.replaceChildren(
      question,
      el('div', { className: 'adm-actions' }, [confirm, cancel]),
      message,
    );
    question.focus();
  }

  showButton();
  return holder;
}
