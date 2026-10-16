// The one-time password, shown once: the heading names the login it belongs to, then the label, the password, the
// caller's own paragraphs (what to do with it, the warning that it will not be shown again), a Copy button, an
// optional Done button and a line that says whether Copy worked. For any screen that hands a person a password that
// exists nowhere else.
//
// The password lives only in this node (never an attribute, a label, a log or storage) and goes when the node does.
// What each screen does differently is the caller's, by parameter: the ids their own tests and focus code rely
// on (`ids`), which button is the main one (`classes`), the words, and the rest of their own markup around it.
import { el } from './dom.js';
import { copyText } from './clipboard.js';

const COPIED = 'Copied.';

// The ids a card gets from a prefix. A caller whose ids already exist elsewhere (the Team screen's `team-issued`,
// `team-password`, ...) passes `ids` to override any of them.
function oneTimePasswordIds(idPrefix) {
  return {
    card: `${idPrefix}-card`,
    heading: `${idPrefix}-heading`,
    password: `${idPrefix}-password`,
    copy: `${idPrefix}-copy`,
    copyStatus: `${idPrefix}-copy-status`,
    done: `${idPrefix}-done`,
  };
}

/**
 * @param {object} options
 * @param {string} options.heading what the card is for, naming the login ("Account created for ...")
 * @param {string} options.password the one-time password
 * @param {string} options.copyFailedText said when the clipboard refused, in the caller's own voice
 * @param {string} options.idPrefix gives the ids below (`<prefix>-card`, `-heading`, `-password`, `-copy`, `-copy-status`, `-done`)
 * @param {Partial<ReturnType<typeof oneTimePasswordIds>>} [options.ids] overrides for any single id
 * @param {{ id?: string, text: string, className?: string, describes?: boolean }[]} [options.paragraphs]
 *   under the password, in order; `describes` (with an `id`) adds the paragraph to the card's accessible description
 * @param {() => boolean} [options.isStillShown] asked at each Copy press: a screen that is gone (its node may outlive
 *   it in the page) answers false and the press copies nothing, saying `copyFailedText` instead
 * @param {() => void} [options.onDone] adds a Done button that calls it; omit for a card with no Done button
 * @param {string} [options.doneLabel] the Done button's accessible name
 * @param {boolean} [options.focusable] lets the caller move focus to the card (tabindex -1)
 * @param {{ card?: string, muted?: string, password?: string, actions?: string, copy?: string, done?: string }} [options.classes]
 *   extra classes by part; `copy` and `done` are the buttons' WHOLE class lists (which one is the main button is the caller's choice)
 */
export function oneTimePasswordCard({
  heading,
  password,
  copyFailedText,
  idPrefix,
  ids: idOverrides = {},
  paragraphs = [],
  isStillShown = () => true,
  onDone,
  doneLabel = 'Done: hide the one-time password',
  focusable = false,
  classes = {},
}) {
  const ids = { ...oneTimePasswordIds(idPrefix), ...idOverrides };
  const status = el('span', {
    className: classes.muted,
    id: ids.copyStatus,
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const copy = el('button', {
    className: classes.copy ?? 'btn btn-primary tap-target',
    text: 'Copy',
    id: ids.copy,
    attrs: { type: 'button', 'aria-label': 'Copy the one-time password' },
  });
  copy.addEventListener('click', async () => {
    status.textContent = isStillShown() && (await copyText(password)) ? COPIED : copyFailedText;
  });
  const actions = el('div', { className: classes.actions }, [copy]);
  if (onDone) {
    const done = el('button', {
      className: classes.done ?? 'btn btn-outline tap-target',
      text: 'Done',
      id: ids.done,
      attrs: { type: 'button', 'aria-label': doneLabel },
    });
    done.addEventListener('click', onDone);
    actions.appendChild(done);
  }
  const described = [
    ids.password,
    ...paragraphs.filter((p) => p.describes && p.id).map((p) => p.id),
  ];
  return el(
    'section',
    {
      className: `card one-time-card${classes.card ? ` ${classes.card}` : ''}`,
      id: ids.card,
      attrs: {
        ...(focusable ? { tabindex: '-1' } : {}),
        'aria-labelledby': ids.heading,
        'aria-describedby': described.join(' '),
      },
    },
    [
      el('h2', { id: ids.heading, text: heading }),
      el('p', { className: classes.muted, text: 'One-time password:' }),
      el('code', {
        id: ids.password,
        className: `one-time-password${classes.password ? ` ${classes.password}` : ''}`,
        text: password,
      }),
      ...paragraphs.map((p) => el('p', { id: p.id, className: p.className, text: p.text })),
      actions,
      status,
    ],
  );
}
