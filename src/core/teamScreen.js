// Team — the owner's screen for who has a login to this org (migration 20261007120000, the
// `team-accounts` Edge Function, core/team.js). Lives in core/: nothing here is format-specific.
//
// What it does: lists the team; adds a person (an account is created and a ONE-TIME password is
// shown to the owner once, to pass on); resets a member's password (a new one-time password);
// removes a member (their access ends at once — every policy asks membership live). Owners cannot be
// removed or reset, and nobody removes themselves; the database enforces that, the screen only
// doesn't offer it.
//
// The one-time password exists only in this screen's closure while it is on screen: never stored,
// never logged, dropped on Done and on unmount. While it is showing, everything else that could
// replace it (adding or resetting someone else) is disabled until Done — a second password would
// silently overwrite the first, whose account would then exist with nobody told its password.
// Destructive actions take an inline confirm (the roster's pattern), not window.confirm. Every
// request is raced against a timeout; a timed-out add/reset may have gone through, and the message
// says so (Reset password issues a fresh one-time password).
//
// Rebuild-then-refocus, like every screen here: each action re-renders from state and names the
// element that should end up focused.
import { getSupabase } from './supabaseClient.js';
import { el, labeledField } from './dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import {
  listTeamMembers,
  addTeamMember,
  resetTeamMemberPassword,
  removeTeamMember,
  describeTeamError,
} from './team.js';

// Pure. The email to add, trimmed, or a message about what is wrong with it. The Edge Function and
// the Auth server check it again; this only saves a round trip for an obvious slip.
export function validateTeamEmail(email) {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter the email address of the person to add.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.';
  if (trimmed.length > 254) return 'That email address is too long.';
  return null;
}

// Pure. One line about where a member is at.
export function describeMemberStatus(member) {
  if (member.mustChangePassword) return 'Has not chosen a password yet';
  if (!member.lastSignInAt) return 'Has not signed in yet';
  const when = new Date(member.lastSignInAt);
  if (Number.isNaN(when.getTime())) return 'Has signed in';
  return `Last signed in ${when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

// A request that timed out may still have reached the server: say so rather than "it failed".
const NO_ANSWER_MESSAGE =
  'No answer from the server. It may or may not have gone through — check the list below, and use Reset password if someone needs a new one-time password.';

function roleLabel(role) {
  return role === 'owner' ? 'Owner' : 'Team member';
}

export async function mountTeamScreen(root, { orgId, client = getSupabase(), signal } = {}) {
  let members = [];
  let notOwner = false;
  let loadFailedMessage = null;
  let loading = false;
  let busy = false;
  let draft = { email: '' };
  let confirming = null; // { userId, action: 'remove' | 'reset' }
  // The password on screen right now, if any: { kind: 'add' | 'reset', email, password, note }.
  let issued = null;
  let pendingError = null;
  let pendingSuccess = null;
  let focusAfterRender = null;

  async function loadMembers() {
    members = await listTeamMembers(orgId, client);
  }

  function renderLoading() {
    if (signal?.aborted) return;
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container team-screen' });
    container.appendChild(el('h1', { text: 'Team' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading the team…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.focus();
  }

  function renderBlocked() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container team-screen' });
    container.appendChild(el('h1', { text: 'Team' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: notOwner ? 'Only the owner can manage the team.' : loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    if (!notOwner) {
      const retry = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Retry',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', () => {
        attemptLoad();
      });
      container.appendChild(retry);
    }
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      await raceTimeout(loadMembers(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
      notOwner = false;
      focusAfterRender = '#team-heading';
    } catch (err) {
      notOwner = err?.status === 403;
      loadFailedMessage = err?.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeTeamError(err);
    }
    loading = false;
    render();
  }

  // Refreshes the list after a change. The change itself already succeeded, so a failed refresh is
  // reported as such rather than as a failed change.
  async function reloadAfterChange() {
    try {
      await raceTimeout(loadMembers(), DEFAULT_LOAD_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  function memberRow(member) {
    const isOwner = member.role === 'owner';
    const confirmingThis = confirming?.userId === member.userId;

    const info = el('div', { className: 'team-member-info' }, [
      el('span', { className: 'team-member-email', text: member.email }),
      el('span', {
        className: 'stage-meta',
        text: `${roleLabel(member.role)} · ${describeMemberStatus(member)}`,
      }),
    ]);

    const children = [info];
    if (!isOwner) {
      if (confirmingThis) {
        const isRemove = confirming.action === 'remove';
        const textId = `team-confirm-text-${member.userId}`;
        const confirmBox = el(
          'div',
          { className: 'team-confirm', attrs: { role: 'group', 'aria-labelledby': textId } },
          [
            el('p', {
              id: textId,
              className: 'team-confirm-text',
              text: isRemove
                ? `Remove ${member.email}? They lose access straight away.`
                : `Reset the password for ${member.email}? Their current password stops working.`,
            }),
            el('div', { className: 'team-actions' }, [
              actionButton(
                `team-confirm-${member.userId}`,
                isRemove ? 'Remove' : 'Reset password',
                `${isRemove ? 'Confirm remove' : 'Confirm reset password for'} ${member.email}`,
                () => (isRemove ? handleRemove(member) : handleReset(member)),
                'btn btn-primary tap-target',
                textId,
              ),
              actionButton(
                `team-cancel-${member.userId}`,
                'Cancel',
                `Cancel for ${member.email}`,
                () => handleCancelConfirm(member),
                'btn btn-outline tap-target',
                textId,
              ),
            ]),
          ],
        );
        // Escape backs out of a confirmation, as it does everywhere else in the console.
        confirmBox.addEventListener('keydown', (domEvent) => {
          if (domEvent.key === 'Escape') handleCancelConfirm(member);
        });
        children.push(confirmBox);
      } else {
        children.push(
          el('div', { className: 'team-actions' }, [
            actionButton(
              `team-reset-btn-${member.userId}`,
              'Reset password',
              `Reset password for ${member.email}`,
              () => handleAskConfirm(member, 'reset'),
            ),
            actionButton(
              `team-remove-btn-${member.userId}`,
              'Remove',
              `Remove ${member.email}`,
              () => handleAskConfirm(member, 'remove'),
            ),
          ]),
        );
      }
    }
    return el('li', { attrs: { id: `team-row-${member.userId}` } }, children);
  }

  function actionButton(
    id,
    text,
    label,
    onClick,
    className = 'btn btn-outline tap-target',
    describedBy = null,
  ) {
    const button = el('button', {
      className,
      text,
      id,
      attrs: {
        type: 'button',
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
    });
    // Nothing else may be started while a request is out or a one-time password is on screen.
    button.disabled = busy || Boolean(issued);
    button.addEventListener('click', onClick);
    return button;
  }

  function issuedPanel() {
    const heading =
      issued.kind === 'add'
        ? `Account created for ${issued.email}`
        : `New one-time password for ${issued.email}`;
    const copyStatus = el('span', {
      id: 'team-copy-status',
      className: 'stage-meta',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const copyButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Copy',
      id: 'team-copy',
      attrs: { type: 'button', 'aria-label': 'Copy the one-time password' },
    });
    copyButton.addEventListener('click', async () => {
      let message;
      try {
        await navigator.clipboard.writeText(issued.password);
        message = 'Copied.';
      } catch {
        message = 'Could not copy — select the password and copy it yourself.';
      }
      copyStatus.textContent = message;
    });
    const doneButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Done',
      id: 'team-issued-done',
      attrs: { type: 'button', 'aria-label': 'Done — hide the one-time password' },
    });
    doneButton.addEventListener('click', () => {
      issued = null;
      focusAfterRender = '#team-email';
      render();
    });

    return el(
      'section',
      {
        id: 'team-issued',
        className: 'card team-issued',
        // Labelled by its heading and described by the password and the instructions, so arriving
        // here reads all three instead of just a region name.
        attrs: {
          tabindex: '-1',
          'aria-labelledby': 'team-issued-heading',
          'aria-describedby': 'team-password team-issued-help',
        },
      },
      [
        el('h2', { id: 'team-issued-heading', text: heading }),
        el('p', { className: 'stage-meta', text: 'One-time password:' }),
        el('code', { id: 'team-password', className: 'team-password', text: issued.password }),
        el('p', {
          id: 'team-issued-help',
          text: 'Send this to them now — it is shown once and cannot be looked up again. They choose their own password when they first sign in. Press Done when you have passed it on; adding or changing anyone else waits until then.',
        }),
        issued.note ? el('p', { id: 'team-issued-note', text: issued.note }) : null,
        el('div', { className: 'team-actions' }, [copyButton, doneButton]),
        copyStatus,
      ].filter(Boolean),
    );
  }

  function addForm() {
    const emailInput = el('input', {
      className: 'field-input',
      id: 'team-email',
      attrs: {
        type: 'email',
        autocomplete: 'off',
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': 'Email of the person to add',
        'data-field': 'email',
      },
    });
    emailInput.value = draft.email;
    emailInput.disabled = busy || Boolean(issued);
    for (const type of ['input', 'change']) {
      emailInput.addEventListener(type, () => {
        draft.email = emailInput.value;
      });
    }
    const submit = el('button', {
      className: 'btn btn-primary tap-target',
      text: busy ? 'Working…' : 'Add team member',
      attrs: { type: 'submit' },
    });
    submit.disabled = busy || Boolean(issued);
    const form = el(
      'form',
      { className: 'card team-add-form', attrs: { 'aria-label': 'Add a team member' } },
      [el('h2', { text: 'Add a team member' }), labeledField('Email', emailInput), submit],
    );
    form.addEventListener('submit', handleAdd);
    return form;
  }

  function render() {
    if (signal?.aborted) return;
    if (notOwner || loadFailedMessage) {
      renderBlocked();
      return;
    }

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container team-screen' });
    container.appendChild(
      el('h1', { id: 'team-heading', text: 'Team', attrs: { tabindex: '-1' } }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta',
        text: 'Everyone you add gets their own login with the same access to events as you, but cannot manage the team. You give them a one-time password; they choose their own when they first sign in.',
      }),
    );

    const feedback = el('div', {
      id: 'team-feedback',
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      feedback.textContent = pendingError;
      feedback.dataset.tone = 'error';
      pendingError = null;
    } else if (pendingSuccess) {
      feedback.textContent = pendingSuccess;
      feedback.dataset.tone = 'success';
      pendingSuccess = null;
    }

    if (issued) container.appendChild(issuedPanel());
    container.appendChild(addForm());
    container.appendChild(
      el(
        'ul',
        { className: 'team-list', attrs: { 'aria-label': 'Team members' } },
        members.map(memberRow),
      ),
    );
    if (members.every((member) => member.role === 'owner')) {
      container.appendChild(
        el('p', {
          id: 'team-empty',
          className: 'stage-meta',
          text: 'No one else has a login yet. Add someone above.',
        }),
      );
    }
    container.appendChild(feedback);
    root.appendChild(container);

    if (focusAfterRender) {
      root.querySelector(focusAfterRender)?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone) {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  async function handleAdd(domEvent) {
    domEvent.preventDefault();
    if (busy || issued) return;
    draft.email = domEvent.currentTarget.querySelector('[data-field="email"]').value;
    const invalid = validateTeamEmail(draft.email);
    if (invalid) {
      pendingError = invalid;
      render();
      return;
    }

    busy = true;
    confirming = null;
    render();
    const email = draft.email.trim();
    try {
      const created = await raceTimeout(
        addTeamMember(orgId, email, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      issued = { kind: 'add', email: created.email ?? email, password: created.password };
      draft = { email: '' };
      const refreshed = await reloadAfterChange();
      if (!refreshed) issued.note = 'Added, but the list could not refresh — reload to see it.';
      focusAfterRender = '#team-issued';
    } catch (err) {
      pendingError = err?.timedOut ? NO_ANSWER_MESSAGE : describeTeamError(err);
      if (err?.timedOut) await reloadAfterChange();
    }
    busy = false;
    render();
  }

  function handleAskConfirm(member, action) {
    if (busy || issued) return;
    confirming = { userId: member.userId, action };
    focusAfterRender = `#team-cancel-${member.userId}`;
    render();
  }

  function handleCancelConfirm(member) {
    if (busy) return;
    const action = confirming?.action;
    confirming = null;
    focusAfterRender = `#team-${action === 'remove' ? 'remove' : 'reset'}-btn-${member.userId}`;
    render();
  }

  async function handleReset(member) {
    if (busy || issued) return;
    busy = true;
    render();
    try {
      const reset = await raceTimeout(
        resetTeamMemberPassword(orgId, member.userId, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      issued = { kind: 'reset', email: member.email, password: reset.password };
      confirming = null;
      const refreshed = await reloadAfterChange();
      if (!refreshed) issued.note = 'Reset, but the list could not refresh — reload to see it.';
      focusAfterRender = '#team-issued';
    } catch (err) {
      confirming = null;
      pendingError = err?.timedOut ? NO_ANSWER_MESSAGE : describeTeamError(err);
      if (err?.timedOut) await reloadAfterChange();
    }
    busy = false;
    render();
  }

  async function handleRemove(member) {
    if (busy || issued) return;
    busy = true;
    render();
    try {
      await raceTimeout(removeTeamMember(orgId, member.userId, client), DEFAULT_LOAD_TIMEOUT_MS);
      confirming = null;
      // Gone now, whether or not the refresh below works: never keep offering Remove for them.
      members = members.filter((other) => other.userId !== member.userId);
      const refreshed = await reloadAfterChange();
      pendingSuccess = refreshed
        ? `${member.email} was removed from the team.`
        : 'Removed, but the list could not refresh — reload to see it.';
    } catch (err) {
      confirming = null;
      pendingError = err?.timedOut ? NO_ANSWER_MESSAGE : describeTeamError(err);
      if (err?.timedOut) await reloadAfterChange();
    }
    busy = false;
    render();
  }

  await attemptLoad();

  return {
    unmount() {
      // A one-time password must not outlive the screen it was shown on.
      issued = null;
    },
  };
}
