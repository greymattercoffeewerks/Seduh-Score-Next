// The Audit log screen (spec D5): every change made through the console, newest first, paged by `p_before` (the id
// of the oldest entry already shown). READ ONLY. It draws only the fields auditView.js names, so a field the
// function starts returning later does not appear by accident (detail never holds a password, token or email:
// D-A13, and it is not drawn beyond the documented keys either).
//
// Every request goes through ctx.callAdmin: a gate refusal draws nothing here (the console is checking access
// again and will replace the panel). A page that fails offers Retry for THAT page and keeps what is already shown.
//
// Focus: on opening it stays where the shell put it (the heading). After the person asks for something (Show older
// changes, Retry) the control they pressed is gone, so focus goes to the first change that arrived, or, when none
// did, to the line that says where the log ends; a failed request takes focus to its Retry, which is otherwise
// below up to fifty links.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { plural } from './format.js';
import { ask as askAdmin, mayTakeFocus as focusAllowed } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { auditItem } from './auditView.js';

export const PAGE_SIZE = 50;
export const READ_FAILED = 'The audit log could not be read. Try again.';

export function mountAuditPanel(host, ctx) {
  let disposed = false;
  let loading = false;
  let oldest = null; // the id of the oldest entry shown: the next page is everything before it
  let shown = 0;

  const title = el('h1', {
    text: 'Audit log',
    attrs: { tabindex: '-1', 'data-heading': 'true' },
  });
  const feedback = feedbackRegion();
  // Said to a screen reader and never shown: how many entries have arrived.
  const status = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const list = el('ol', { className: 'adm-audit adm-audit-log', attrs: { role: 'list' } });
  const footer = el('div', { className: 'adm-panel-body' });
  const body = el('div', { className: 'adm-panel-body' }, [list, footer]);
  host.replaceChildren(title, feedback, status, body);

  const mayTakeFocus = () => focusAllowed(host);

  function stepAside() {
    host.replaceChildren();
  }

  const messageFor = (error) => (error?.timedOut ? SLOW_MESSAGE : describeAdminError(error));

  function showRetry(message, { initial }) {
    setFeedback(feedback, message, 'error', { focus: false });
    const retry = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retry.addEventListener('click', () => {
      setBusyDisabled(retry, true);
      loadPage();
    });
    footer.replaceChildren(retry);
    // The message is read by its live region; the Retry is what the person needs next, and it is below the list.
    if (!initial || mayTakeFocus()) retry.focus();
  }

  // `initial` is the load the screen starts with; every other load was asked for by the person, who pressed a
  // control that is now gone.
  async function loadPage({ initial = false } = {}) {
    if (loading) return;
    loading = true;
    setFeedback(feedback, '');
    footer.replaceChildren(el('p', { className: 'adm-muted', text: 'Loading…' }));
    const args =
      oldest === null ? { p_limit: PAGE_SIZE } : { p_limit: PAGE_SIZE, p_before: oldest };
    const answer = await askAdmin(ctx, 'admin_list_audit', args);
    if (disposed) return;
    loading = false;
    footer.replaceChildren();
    if (answer.error) {
      if (isGateRefusal(answer.error)) return stepAside();
      showRetry(messageFor(answer.error), { initial });
      return;
    }

    // Everything is read and checked BEFORE anything is drawn: a page that is not what the function documents
    // draws none of its rows, never half.
    let items;
    let ids;
    try {
      if (!Array.isArray(answer.data)) throw new TypeError('not a list');
      items = answer.data.map((entry) => auditItem(entry, { withOrg: true }));
      ids = answer.data.map((entry) => entry.id);
      if (!ids.every((id) => Number.isSafeInteger(id))) throw new TypeError('not an id');
    } catch {
      showRetry(READ_FAILED, { initial });
      return;
    }

    list.append(...items);
    shown += items.length;
    // The ids are the database's own and only ever fall; the next page is asked for from the smallest seen.
    if (ids.length) oldest = Math.min(...ids);

    let end = null;
    if (shown === 0) {
      end = el('p', {
        text: 'Nothing has been changed through the console yet.',
        attrs: { tabindex: '-1' },
      });
      status.textContent = 'Nothing has been changed through the console yet.';
    } else {
      status.textContent = `${plural(items.length, 'change')} loaded. ${plural(shown, 'change')} shown.`;
      if (items.length >= PAGE_SIZE) {
        const more = el('button', {
          className: 'btn btn-outline tap-target',
          text: 'Show older changes',
          attrs: { type: 'button' },
        });
        more.addEventListener('click', () => {
          setBusyDisabled(more, true);
          loadPage();
        });
        footer.appendChild(more);
      } else {
        end = el('p', {
          className: 'adm-muted',
          text: `That is everything: ${plural(shown, 'change')}.`,
          attrs: { tabindex: '-1' },
        });
      }
    }
    if (end) footer.appendChild(end);

    if (!initial && mayTakeFocus()) {
      const target = items[0] ?? end;
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus();
      }
    }
  }

  loadPage({ initial: true });

  return {
    unmount() {
      disposed = true;
      host.replaceChildren();
    },
  };
}
