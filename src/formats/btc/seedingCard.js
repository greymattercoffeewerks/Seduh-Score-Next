// The "teams level in the standings" card of BTC's bracket screen: each group of teams level on points and
// wins, whether the organiser has put them in order, and the form to do it. Pure rendering of the state the
// screen passes in (bracketScreen.js owns the state, the saves, the focus and the announcements); the data and
// the rules are seeding.js's. Meaning is in words, never colour alone: a group says "Not ordered yet" or
// "Ordered", and the one that decides who qualifies says so.
import { el, labeledField, setBusyDisabled } from '../../core/dom.js';
import { ordinalLabel } from '../../core/ordinal.js';
import { winsText } from './words.js';
import { SEEDING_REASON_MAX, blockingGroups } from './seeding.js';

function groupTitle(group) {
  const places =
    group.firstSeed === group.lastSeed
      ? ordinalLabel(group.firstSeed)
      : `${ordinalLabel(group.firstSeed)} to ${ordinalLabel(group.lastSeed)}`;
  return `Level for ${places} · ${group.points} pts, ${winsText(group.wins)}`;
}

// An end-of-list move button is inert but must stay focusable (a disabled button would drop keyboard focus
// when pressed), so it is marked with aria-disabled only: it is not "busy".
function markInert(button) {
  button.setAttribute('aria-disabled', 'true');
}

// teamName(teamId) is the screen's own roster lookup.
// handlers: { onOpen(group), onMove(teamId, delta), onReasonInput(value), onSubmit(domEvent, group), onCancel(), onRetry() }
// form: null | { groupKey, orderedTeamIds, reason, error: { field, message } | null }
// readFailed: the last read of the seed order failed (what is shown, if anything, may be out of date).
export function renderSeedingTies({ groups, form, busy, teamName, readFailed, handlers }) {
  if (groups.length === 0 && !readFailed) return null;
  const heading = el('h2', { text: 'Teams level in the standings' });

  function renderRetry() {
    const retry = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Check again',
      attrs: { type: 'button', 'data-focus-key': 'seeding-retry' },
    });
    setBusyDisabled(retry, busy);
    retry.addEventListener('click', () => handlers.onRetry());
    return retry;
  }

  if (groups.length === 0) {
    return el('div', { className: 'card btc-seeding-card' }, [
      heading,
      el('p', {
        className: 'btc-field-error',
        text: 'We could not check for teams that are level just now. If any are level across the 8th and 9th places, the bracket cannot be generated until they are put in order.',
        attrs: { role: 'status' },
      }),
      renderRetry(),
    ]);
  }

  // While the list may be out of date (the last read failed) it does not claim the bracket is blocked.
  const mustOrder = !readFailed && blockingGroups(groups).length > 0;

  // `firstSeed` is the seed of the first team listed: a group's seeds are consecutive, so while the order is
  // being changed each row shows the seed that team WOULD get. A group nobody has ordered shows the seeds it
  // has by default, and says they are provisional.
  function renderOrderList(group, teams, { editable, provisional }) {
    return el(
      'ol',
      {
        className: 'btc-seeding-order',
        attrs: { role: 'list', 'aria-labelledby': `btc-seeding-title-${group.key}` },
      },
      teams.map((team, index) => {
        const seed = group.firstSeed + index;
        const children = [
          el('span', {
            className: 'btc-seeding-seed',
            text: provisional ? `Seed ${seed} (provisional)` : `Seed ${seed}`,
          }),
          el('span', { className: 'btc-seeding-team', text: teamName(team.teamId) }),
        ];
        if (editable) {
          const name = teamName(team.teamId);
          const makeMove = (label, ariaLabel, key) =>
            el('button', {
              className: 'btn btn-outline btc-seeding-move',
              text: label,
              attrs: {
                type: 'button',
                'aria-label': ariaLabel,
                'data-focus-key': `${key}-${team.teamId}`,
              },
            });
          const up = makeMove('Move up', `Move up: ${name}`, 'seeding-up');
          const down = makeMove('Move down', `Move down: ${name}`, 'seeding-down');
          if (busy) {
            setBusyDisabled(up, true);
            setBusyDisabled(down, true);
          } else {
            if (index === 0) markInert(up);
            if (index === teams.length - 1) markInert(down);
          }
          up.addEventListener('click', () => handlers.onMove(team.teamId, -1));
          down.addEventListener('click', () => handlers.onMove(team.teamId, 1));
          children.push(el('span', { className: 'btc-seeding-moves' }, [up, down]));
        }
        return el('li', {}, children);
      }),
    );
  }

  function renderForm(group) {
    const { error } = form;
    const errorId = `btc-seeding-error-${group.key}`;
    const hintId = `btc-seeding-hint-${group.key}`;
    const byId = new Map(group.teams.map((team) => [team.teamId, team]));
    const ordered = form.orderedTeamIds.map((id) => byId.get(id));

    const reasonInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        maxlength: String(SEEDING_REASON_MAX),
        'aria-label': 'Reason (required)',
        'aria-required': 'true',
        placeholder: 'e.g. won the head-to-head',
        'data-field': `seeding-reason-${group.key}`,
        autocomplete: 'off',
        'aria-describedby': [error?.field === 'reason' ? errorId : null, hintId]
          .filter(Boolean)
          .join(' '),
        ...(error?.field === 'reason' ? { 'aria-invalid': 'true' } : {}),
      },
    });
    reasonInput.value = form.reason;
    setBusyDisabled(reasonInput, busy);
    reasonInput.addEventListener('input', () => {
      if (busy) {
        reasonInput.value = form.reason;
        return;
      }
      handlers.onReasonInput(reasonInput.value);
    });

    const submit = el('button', {
      className: 'btn btn-primary tap-target',
      text: busy ? 'Saving…' : 'Save order',
      attrs: {
        type: 'submit',
        'data-focus-key': `seeding-submit-${group.key}`,
        ...(error?.field === 'form' ? { 'aria-describedby': errorId } : {}),
      },
    });
    setBusyDisabled(submit, busy);
    const cancel = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': `seeding-cancel-${group.key}` },
    });
    setBusyDisabled(cancel, busy);
    cancel.addEventListener('click', () => handlers.onCancel());

    // Next to the reason field, so the message is read (and focused) beside the control it is about.
    const errorNode = error
      ? el('p', {
          id: errorId,
          className: 'btc-field-error',
          text: error.message,
          attrs: {
            role: 'alert',
            tabindex: '-1',
            'data-focus-key': `seeding-error-${group.key}`,
          },
        })
      : null;

    const formNode = el(
      'form',
      {
        className: 'btc-bracket-create-form btc-seeding-form',
        attrs: { 'aria-labelledby': `btc-seeding-title-${group.key}` },
      },
      [
        el('p', {
          className: 'stage-meta',
          text: 'Best seed first. Use the buttons to move a team up or down.',
          attrs: { tabindex: '-1', 'data-focus-key': `seeding-form-heading-${group.key}` },
        }),
        renderOrderList(group, ordered, { editable: true, provisional: false }),
        errorNode,
        labeledField('Reason (required)', reasonInput),
        el('p', {
          id: hintId,
          className: 'stage-meta btc-tiebreak-hint',
          text: 'Say how it was decided (a head-to-head, a cup-off, the head judge). This is kept with the event but is not shown on the live display.',
        }),
        el('div', { className: 'btc-bracket-form-actions' }, [submit, cancel]),
      ].filter(Boolean),
    );
    formNode.addEventListener('submit', (domEvent) => handlers.onSubmit(domEvent, group));
    return formNode;
  }

  function renderGroup(group) {
    const editing = form?.groupKey === group.key;
    const otherFormOpen = Boolean(form) && !editing;
    const status = group.resolved
      ? `Ordered${group.reason ? `: ${group.reason}` : ''}`
      : 'Not ordered yet';
    const open = el('button', {
      className: 'btn btn-outline tap-target',
      text: group.resolved ? 'Change order' : 'Order these teams',
      attrs: {
        type: 'button',
        'aria-label': `${group.resolved ? 'Change order' : 'Order these teams'}: ${groupTitle(group)}`,
        'data-focus-key': `seeding-open-${group.key}`,
      },
    });
    // While another group's form is open this one is inert: opening it would silently drop that draft.
    if (busy) setBusyDisabled(open, true);
    else if (otherFormOpen) markInert(open);
    open.addEventListener('click', () => handlers.onOpen(group));

    return el(
      'div',
      { className: 'btc-seeding-group' },
      [
        el('h3', { id: `btc-seeding-title-${group.key}`, text: groupTitle(group) }),
        group.decidesQualifying
          ? el('p', {
              className: 'stage-meta',
              text: 'These teams are level across the cut-off: their order decides who qualifies for the quarterfinals.',
            })
          : null,
        el('p', { className: 'stage-meta', text: status }),
        editing
          ? renderForm(group)
          : renderOrderList(group, group.teams, { editable: false, provisional: !group.resolved }),
        editing ? null : open,
      ].filter(Boolean),
    );
  }

  return el(
    'div',
    { className: 'card btc-seeding-card' },
    [
      heading,
      el('p', {
        className: 'stage-meta',
        text: 'Seeds decide who plays whom. Where teams are level on points and wins, put them in the order you decided.',
      }),
      readFailed
        ? el('div', { className: 'btc-seeding-stale' }, [
            el('p', {
              className: 'btc-field-error',
              text: 'We could not refresh this list, so it may be out of date.',
              attrs: { role: 'status' },
            }),
            renderRetry(),
          ])
        : null,
      mustOrder
        ? el('p', {
            id: 'btc-seeding-blocking',
            className: 'btc-field-error',
            text: 'The bracket cannot be generated until the teams level across the cut-off are put in order.',
            attrs: { role: 'status' },
          })
        : null,
      ...groups.map(renderGroup),
    ].filter(Boolean),
  );
}
