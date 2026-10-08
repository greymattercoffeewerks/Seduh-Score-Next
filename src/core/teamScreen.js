// Team — the owner's screen for who has a login to this org (migration 20261007120000, the
// `team-accounts` Edge Function, core/team.js). Lives in core/: nothing here is format-specific.
//
// What it does: lists the team; adds a person (an account is created and a ONE-TIME password is
// shown to the owner once, to pass on); resets a member's password (a new one-time password);
// removes a member (their access ends at once — every policy asks membership live); lists the people
// removed earlier, under the team, and restores one (their login was kept, so they come back with a
// new one-time password; adding the same email again is refused, which is why this exists). Owners
// cannot be removed or reset, and nobody removes themselves; the database enforces that, the screen
// only doesn't offer it. The removed list is a courtesy: if it cannot load (e.g. the database is a
// step behind this page) the team itself still works and the section says so.
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
  listRemovedTeamMembers,
  addTeamMember,
  resetTeamMemberPassword,
  removeTeamMember,
  restoreTeamMember,
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

// Pure. One line about when a person was removed.
export function describeRemoved(person) {
  if (!person.removedAt) return 'Removed from the team';
  const when = new Date(person.removedAt);
  if (Number.isNaN(when.getTime())) return 'Removed from the team';
  return `Removed ${when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

// A request that timed out may still have reached the server: say so rather than "it failed".
const NO_ANSWER_MESSAGE =
  'No answer from the server. It may or may not have gone through — check the team and removed lists above, and use Reset password if someone needs a new one-time password.';

function roleLabel(role) {
  return role === 'owner' ? 'Owner' : 'Team member';
}

export async function mountTeamScreen(root, { orgId, client = getSupabase(), signal } = {}) {
  let members = [];
  let removed = [];
  let removedLoaded = false; // has the removed list loaded at least once?
  let removedLoadFailed = false; // ...and, if not, did it fail?
  let notOwner = false;
  let loadFailedMessage = null;
  let loading = false;
  let busy = false;
  let draft = { email: '' };
  let confirming = null; // { userId, action: 'remove' | 'reset' | 'restore' }
  // The password on screen right now, if any: { kind: 'add' | 'reset' | 'restore', email, password, note }.
  let issued = null;
  let pendingError = null;
  let pendingSuccess = null;
  // What is being done right now ("Restoring x…"), shown in the status line so a request that takes
  // a while is seen and announced, wherever on the page the button that started it was.
  let working = null;
  let focusAfterRender = null;

  async function loadMembers() {
    // The team must load; the removed list is best-effort (it never blocks the screen).
    const [team, removedPeople] = await Promise.all([
      listTeamMembers(orgId, client),
      listRemovedTeamMembers(orgId, client).catch(() => null),
    ]);
    members = team;
    if (removedPeople !== null) {
      removed = removedPeople;
      removedLoaded = true;
      removedLoadFailed = false;
    } else if (!removedLoaded) {
      removedLoadFailed = true;
    }
    // (A refresh that fails after the list has loaded once keeps the last list rather than replacing
    // it with an error: the person's next action re-reads it anyway.)
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

  // One inline confirm: the question, then Confirm / Cancel; Escape backs out, as it does everywhere
  // else in the console. Shared by every row that asks before it acts.
  function confirmBox(target, { text, confirmText, confirmLabel, onConfirm }) {
    const textId = `team-confirm-text-${target.userId}`;
    const box = el(
      'div',
      { className: 'team-confirm', attrs: { role: 'group', 'aria-labelledby': textId } },
      [
        el('p', { id: textId, className: 'team-confirm-text', text }),
        el('div', { className: 'team-actions' }, [
          actionButton(
            `team-confirm-${target.userId}`,
            confirmText,
            confirmLabel,
            onConfirm,
            'btn btn-primary tap-target',
            textId,
          ),
          actionButton(
            `team-cancel-${target.userId}`,
            'Cancel',
            `Cancel for ${target.email}`,
            () => handleCancelConfirm(target),
            'btn btn-outline tap-target',
            textId,
          ),
        ]),
      ],
    );
    box.addEventListener('keydown', (domEvent) => {
      if (domEvent.key === 'Escape') handleCancelConfirm(target);
    });
    return box;
  }

  function memberRow(member) {
    const isOwner = member.role === 'owner';
    const action = confirming?.userId === member.userId ? confirming.action : null;

    const info = el('div', { className: 'team-member-info' }, [
      el('span', { className: 'team-member-email', text: member.email }),
      el('span', {
        className: 'stage-meta',
        text: `${roleLabel(member.role)} · ${describeMemberStatus(member)}`,
      }),
    ]);

    const children = [info];
    if (!isOwner) {
      if (action === 'remove') {
        children.push(
          confirmBox(member, {
            text: `Remove ${member.email}? They lose access straight away.`,
            confirmText: 'Remove',
            confirmLabel: `Confirm remove ${member.email}`,
            onConfirm: () => handleRemove(member),
          }),
        );
      } else if (action === 'reset') {
        children.push(
          confirmBox(member, {
            text: `Reset the password for ${member.email}? Their current password stops working.`,
            confirmText: 'Reset password',
            confirmLabel: `Confirm reset password for ${member.email}`,
            onConfirm: () => handleReset(member),
          }),
        );
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
        : issued.kind === 'restore'
          ? `${issued.email} is back on the team — new one-time password`
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

  function removedRow(person) {
    const confirmingThis = confirming?.userId === person.userId && confirming.action === 'restore';
    const children = [
      el('div', { className: 'team-member-info' }, [
        el('span', { className: 'team-member-email', text: person.email }),
        el('span', { className: 'stage-meta', text: describeRemoved(person) }),
      ]),
    ];
    if (confirmingThis) {
      children.push(
        confirmBox(person, {
          text: `Restore ${person.email}? They get access to your events again, with a new one-time password. Their old password stops working.`,
          confirmText: 'Restore',
          confirmLabel: `Confirm restore ${person.email}`,
          onConfirm: () => handleRestore(person),
        }),
      );
    } else {
      children.push(
        el('div', { className: 'team-actions' }, [
          actionButton(
            `team-restore-btn-${person.userId}`,
            'Restore',
            `Restore ${person.email}`,
            () => handleAskConfirm(person, 'restore'),
          ),
        ]),
      );
    }
    return el('li', { attrs: { id: `team-removed-row-${person.userId}` } }, children);
  }

  function removedSection() {
    const children = [el('h2', { id: 'team-removed-heading', text: 'Removed members' })];
    if (!removedLoadFailed) {
      children.push(
        el('p', {
          className: 'stage-meta',
          text: 'People you removed keep their login but can see nothing. Restore puts one back on the team with a new one-time password.',
        }),
      );
    }
    if (removedLoadFailed) {
      children.push(
        el('p', {
          id: 'team-removed-failed',
          className: 'stage-meta',
          text: 'The list of removed members could not be loaded. Reload the page to try again.',
        }),
      );
    } else if (removed.length === 0) {
      children.push(
        el('p', {
          id: 'team-removed-empty',
          className: 'stage-meta',
          text: 'No one has been removed.',
        }),
      );
    } else {
      children.push(
        el(
          'ul',
          { className: 'team-list', attrs: { 'aria-labelledby': 'team-removed-heading' } },
          removed.map(removedRow),
        ),
      );
    }
    return el('section', { className: 'team-removed' }, children);
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
    if (working) {
      feedback.textContent = working;
    } else if (pendingError) {
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
    // Right under the team and the form they act on, ahead of the removed list.
    container.appendChild(feedback);
    container.appendChild(removedSection());
    root.appendChild(container);

    if (focusAfterRender) {
      root.querySelector(focusAfterRender)?.focus();
      focusAfterRender = null;
    } else if (working) {
      // The button that started the request has just been re-rendered away; keep focus on the status
      // line, which announces it, rather than letting it fall to the page.
      feedback.focus();
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
    const email = draft.email.trim();
    working = `Adding ${email}…`;
    render();
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
    working = null;
    render();
  }

  function handleAskConfirm(target, action) {
    if (busy || issued) return;
    confirming = { userId: target.userId, action };
    focusAfterRender = `#team-cancel-${target.userId}`;
    render();
  }

  function handleCancelConfirm(target) {
    if (busy) return;
    const action = confirming?.action;
    confirming = null;
    // The action's own name is in its button's id: team-reset-btn-, team-remove-btn-, team-restore-btn-.
    focusAfterRender = `#team-${action}-btn-${target.userId}`;
    render();
  }

  async function handleReset(member) {
    if (busy || issued) return;
    busy = true;
    working = `Resetting the password for ${member.email}…`;
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
    working = null;
    render();
  }

  async function handleRestore(person) {
    if (busy || issued) return;
    busy = true;
    working = `Restoring ${person.email}…`;
    render();
    try {
      const restored = await raceTimeout(
        restoreTeamMember(orgId, person.userId, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      issued = { kind: 'restore', email: person.email, password: restored.password };
      confirming = null;
      // On the team now, whether or not the refresh below works: never keep offering Restore.
      removed = removed.filter((other) => other.userId !== person.userId);
      const refreshed = await reloadAfterChange();
      if (!refreshed) issued.note = 'Restored, but the list could not refresh — reload to see it.';
      focusAfterRender = '#team-issued';
    } catch (err) {
      confirming = null;
      pendingError = err?.timedOut ? NO_ANSWER_MESSAGE : describeTeamError(err);
      // Whatever went wrong, the server's state is the truth: a refusal usually means the person is
      // no longer restorable (or already restored), and the row must not keep offering Restore.
      await reloadAfterChange();
    }
    busy = false;
    working = null;
    render();
  }

  async function handleRemove(member) {
    if (busy || issued) return;
    busy = true;
    working = `Removing ${member.email}…`;
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
    working = null;
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
