// The Keys section of the Plan panel (spec 3.5, D-G11): every capability the platform can gate, whether it is dark or
// enforced, what turning it on would do BEFORE it is turned on (admin_gating_preview), and the flip itself
// (admin_set_key_enforced, audited). Turning a key on is only offered after its preview and needs the preview's count, so
// it cannot be done blind; turning it off is one confirmed step. This file never flips anything by itself.
import { el, setBusyDisabled } from '../core/dom.js';
import { isGateRefusal } from './gate.js';
import { SLOW_MESSAGE } from './gate.js';
import { describeAdminError } from './adminErrors.js';
import { plural } from './format.js';
import { tierLabel, keyRuleText } from './planFormat.js';
import { ask, confirmAction, failureMessage, ALWAYS } from './planParts.js';
import { feedbackRegion, setFeedback } from './screenParts.js';

const PREVIEW_ROWS = 20;
const FLIP_UNKNOWN =
  'We could not confirm whether the key was changed. Reload the page to see its state before trying again.';

function previewList(preview) {
  const orgs = Array.isArray(preview?.organisations) ? preview.organisations : [];
  if (orgs.length === 0) return null;
  const shown = orgs.slice(0, PREVIEW_ROWS);
  const list = el(
    'ul',
    { className: 'adm-members', attrs: { role: 'list' } },
    shown.map((org) =>
      el('li', { className: 'adm-member' }, [
        el('span', { className: 'adm-member-email', text: String(org.name ?? '') }),
        el('span', { className: 'adm-role', text: tierLabel(org.tier) }),
        el('span', { className: 'adm-muted', text: detailText(org.detail) }),
      ]),
    ),
  );
  const more =
    preview.would_lose > shown.length
      ? el('p', {
          className: 'adm-muted',
          text: `Showing ${shown.length} of ${preview.would_lose}.`,
        })
      : null;
  return el('div', {}, [list, more].filter(Boolean));
}

// The documented extras of a preview row, in words; anything else in `detail` is not drawn.
function detailText(detail) {
  const bits = [];
  if (Number.isInteger(detail?.event_grants) && detail.event_grants > 0)
    bits.push(`${plural(detail.event_grants, 'event plan')}, not counted`);
  if (Number.isInteger(detail?.over_limit_events) && detail.over_limit_events > 0)
    bits.push(`${plural(detail.over_limit_events, 'event')} over the limit`);
  if (Number.isInteger(detail?.open_events))
    bits.push(`${plural(detail.open_events, 'open event')}`);
  if (Number.isInteger(detail?.locked_events))
    bits.push(`${plural(detail.locked_events, 'locked event')}`);
  return bits.join(' · ');
}

export function keysSection({ ctx, onGateRefused, mayTakeFocus, reload, writes = ALWAYS }) {
  const feedback = feedbackRegion();
  const body = el('div', { className: 'adm-panel-body' });
  const node = el('section', { className: 'adm-section' }, [
    el('h2', { text: 'Keys' }),
    el('p', {
      className: 'adm-muted',
      text: 'A key is dark until you turn it on: while it is dark everyone keeps today’s behaviour. Preview first, then turn it on.',
    }),
    feedback,
    body,
  ]);

  function keyCard(key) {
    const enforced = key.enforced === true;
    const status = el('p', { className: 'adm-key-status' }, [
      el('span', { className: 'adm-badge', text: enforced ? 'Enforced' : 'Dark (not enforced)' }),
      el('span', { className: 'adm-muted', text: keyRuleText(key) }),
    ]);
    const preview = el('div', { className: 'adm-key-preview', attrs: { 'aria-live': 'polite' } });
    const actions = el('div', { className: 'adm-actions' });
    const card = el(
      'li',
      { className: 'card adm-key' },
      [
        el('h3', { text: String(key.key ?? '') }),
        status,
        key.note ? el('p', { className: 'adm-muted', text: String(key.note) }) : null,
        actions,
        preview,
      ].filter(Boolean),
    );

    const flip = (enforcedNext, count) =>
      ask(ctx, 'admin_set_key_enforced', {
        p_key: key.key,
        p_enforced: enforcedNext,
        p_confirm: count,
      });

    if (enforced) {
      actions.appendChild(
        confirmAction({
          label: 'Turn off',
          ariaLabel: `Turn off ${key.key}`,
          question: `Turn ${key.key} off? Everyone keeps today’s behaviour again at once.`,
          confirmLabel: 'Turn off',
          workingLabel: 'Turning off…',
          unknown: FLIP_UNKNOWN,
          run: () => flip(false, null),
          onDone: reload,
          onGateRefused,
          mayTakeFocus,
          writes,
          successMessage: `${key.key} is turned off.`,
        }),
      );
      return card;
    }

    const previewButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Preview turning it on',
      attrs: { type: 'button', 'aria-label': `Preview turning on ${key.key}` },
    });
    let busy = false;
    previewButton.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusyDisabled(previewButton, true);
      previewButton.textContent = 'Checking…';
      const answer = await ask(ctx, 'admin_gating_preview', { p_key: key.key });
      if (!card.isConnected) return;
      busy = false;
      setBusyDisabled(previewButton, false);
      previewButton.textContent = 'Preview turning it on';
      if (answer.error) {
        if (isGateRefusal(answer.error)) return onGateRefused();
        preview.replaceChildren(
          el('p', {
            className: 'adm-field-error',
            text: answer.error.timedOut ? SLOW_MESSAGE : describeAdminError(answer.error),
          }),
        );
        return;
      }
      const count = Number.isInteger(answer.data?.would_lose) ? answer.data.would_lose : null;
      if (count === null) {
        preview.replaceChildren(
          el('p', { className: 'adm-field-error', text: describeAdminError({}) }),
        );
        return;
      }
      const summary = el('p', {
        text:
          count === 0
            ? `Turning ${key.key} on would take it away from no organisation today.`
            : `Turning ${key.key} on would take it away from ${plural(count, 'organisation')} today.`,
        attrs: { tabindex: '-1' },
      });
      const turnOn = confirmAction({
        label: 'Turn on…',
        ariaLabel: `Turn on ${key.key}`,
        question: `Turn ${key.key} on now? ${count === 0 ? 'No organisation loses it today.' : `${plural(count, 'organisation')} lose it today.`}`,
        confirmLabel: 'Turn on',
        workingLabel: 'Turning on…',
        unknown: FLIP_UNKNOWN,
        // the count is the one the preview showed: if the world moved since, the database refuses (confirm_mismatch)
        run: () => flip(true, count),
        onDone: reload,
        onGateRefused,
        mayTakeFocus,
        writes,
        successMessage: `${key.key} is turned on.`,
        className: 'btn btn-primary tap-target',
      });
      preview.replaceChildren(
        summary,
        previewList(answer.data) ?? document.createDocumentFragment(),
        turnOn,
      );
      summary.focus();
    });
    actions.appendChild(previewButton);
    return card;
  }

  async function load() {
    setFeedback(feedback, '');
    body.replaceChildren(el('p', { className: 'adm-muted', text: 'Loading the keys…' }));
    const answer = await ask(ctx, 'admin_list_keys');
    if (!node.isConnected && !body.isConnected) return;
    if (answer.error) {
      if (isGateRefusal(answer.error)) return onGateRefused();
      body.replaceChildren();
      setFeedback(
        feedback,
        failureMessage(answer.error, answer.error.timedOut ? SLOW_MESSAGE : describeAdminError({})),
        'error',
        {
          focus: false,
        },
      );
      return;
    }
    const keys = Array.isArray(answer.data) ? answer.data : [];
    body.replaceChildren(
      el('ul', { className: 'adm-org-list', attrs: { role: 'list' } }, keys.map(keyCard)),
    );
  }

  return { node, load };
}
