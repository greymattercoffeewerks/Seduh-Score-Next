// What the operator can do to an organisation's membership from its detail (spec D4): attach an EXISTING account
// with a role, and change a member's role. Both go through the database's admin functions (admin_add_member,
// admin_set_role), which refuse the cases that matter (the last owner, the operator's own account, an account whose
// password someone else may know without the operator's confirmation) with stable hints; this file only translates
// them (adminErrors.js) and never decides any of it itself.
//
// Shared guarantees, as in the New organisation panel:
// - A request that may have been carried out is never reported as "nothing changed": an error with NO hint (a
//   dropped connection, a timeout, a server error) says it may have happened and to look at the list; only an error
//   the database raised (it has a hint) is "refused".
// - A control is taken once: it stops while its request is out.
// - A gate refusal is not drawn here (`onGateRefused`): the console is checking access again.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal } from './gate.js';
import { ask } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { field } from './formParts.js';
import { createAccountLookup } from './accountLookup.js';
import { roleLabel } from './auditView.js';

export const ADD_STATE_UNKNOWN =
  'We could not confirm whether the member was added. Reload the page and check the member list before trying again.';
export const ROLE_STATE_UNKNOWN =
  'We could not confirm whether the role was changed. Reload the page to see the current role.';

// A failure with no hint leaves it unknown whether the change was made.
const failureMessage = (error, unknown) =>
  error?.timedOut || !error?.hint ? unknown : describeAdminError(error);

const OTHER_ROLE = Object.freeze({ owner: 'organiser', organiser: 'owner' });

// ---- add a member ----

// The "Add a member" section: lookup, a role, a button. `onAdded({ email, role })` runs once it is done (the caller
// reloads the detail, so the new member is drawn from the database's own answer).
export function addMemberSection({ ctx, orgId, onAdded, mayTakeFocus, onGateRefused }) {
  let busy = false;
  const feedback = feedbackRegion();
  const lookup = createAccountLookup({
    ctx,
    idPrefix: 'adm-member',
    cannotUse: 'This account is disabled or deleted, so it cannot be added.',
    mayTakeFocus,
    onGateRefused,
  });

  const roleSelect = el('select', { className: 'field-input', id: 'adm-member-role' }, [
    el('option', { text: 'Organiser', attrs: { value: 'organiser' } }),
    el('option', { text: 'Owner', attrs: { value: 'owner' } }),
  ]);
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
    setBusyDisabled(roleSelect, isBusy);
    setBusyDisabled(submit, isBusy);
    submit.textContent = isBusy ? 'Adding…' : 'Add member';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const checked = lookup.check();
    if (!checked.account) {
      setFeedback(feedback, checked.message, 'error', { focus: false });
      checked.focus?.focus();
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
export function roleControl({ ctx, orgId, member, onChanged, mayTakeFocus, onGateRefused }) {
  // (own properties only: a role named `constructor` must not find Object's)
  const to = Object.hasOwn(OTHER_ROLE, member.role) ? OTHER_ROLE[member.role] : undefined;
  const email = String(member.email ?? '');
  const holder = el('div', { className: 'adm-role-control' });
  if (!to || typeof member.user_id !== 'string') return holder; // a role this console does not know: no button

  const message = el('p', {
    className: 'adm-field-error',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  let busy = false;

  function showButton({ focus = false } = {}) {
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: to === 'owner' ? 'Make owner' : 'Make organiser',
      attrs: {
        type: 'button',
        'aria-label': `Make ${email} ${to === 'owner' ? 'an owner' : 'an organiser'}`,
      },
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
        for (const control of [confirm, cancel]) setBusyDisabled(control, false);
        confirm.textContent = 'Confirm';
        message.textContent = failureMessage(answer.error, ROLE_STATE_UNKNOWN);
        if (mayTakeFocus()) confirm.focus();
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
