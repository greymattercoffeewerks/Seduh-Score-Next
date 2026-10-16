// The Audit log screen (spec D5): every change made through the console, newest first, paged by `p_before` (the id
// of the oldest entry already shown). READ ONLY. It draws only the fields auditView.js names, so a field the
// function starts returning later does not appear by accident (detail never holds a password, token or email:
// D-A13, and it is not drawn beyond the documented keys either).
//
// Every request goes through ctx.callAdmin: a gate refusal draws nothing here (the console is checking access
// again and will replace the panel). A page that fails offers Retry for THAT page and keeps what is already shown.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { plural } from './format.js';
import { ask as askAdmin, mayTakeFocus as focusAllowed } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { auditItem } from './auditView.js';

export const PAGE_SIZE = 50;

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

  async function loadPage({ first = false } = {}) {
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
      setFeedback(feedback, messageFor(answer.error), 'error', { focus: mayTakeFocus() });
      const retry = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Retry',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', () => {
        setBusyDisabled(retry, true);
        loadPage({ first });
      });
      footer.appendChild(retry);
      return;
    }
    let rows;
    try {
      rows = Array.isArray(answer.data) ? answer.data : [];
      const items = rows.map((entry) => auditItem(entry, { withOrg: true }));
      list.append(...items);
      // The person asked for older changes: take them to the first of them (the button they pressed is gone).
      if (!first && items[0] && mayTakeFocus()) {
        items[0].setAttribute('tabindex', '-1');
        items[0].focus();
      }
    } catch {
      // a row that is not what the function documents: say so rather than draw half a page
      setFeedback(feedback, describeAdminError({}), 'error', { focus: mayTakeFocus() });
      return;
    }
    shown += rows.length;
    // The ids are the database's own and only ever fall; the next page is asked for from the smallest seen.
    const ids = rows.map((r) => r?.id).filter((id) => Number.isSafeInteger(id));
    if (ids.length) oldest = Math.min(...ids);
    if (shown === 0) {
      footer.appendChild(el('p', { text: 'Nothing has been changed through the console yet.' }));
      status.textContent = 'Nothing has been changed through the console yet.';
      return;
    }
    status.textContent = `${plural(rows.length, 'change')} loaded. ${plural(shown, 'change')} shown.`;
    if (rows.length >= PAGE_SIZE && ids.length) {
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
      footer.appendChild(
        el('p', {
          className: 'adm-muted',
          text: `That is everything: ${plural(shown, 'change')}.`,
        }),
      );
    }
  }

  loadPage({ first: true });

  return {
    unmount() {
      disposed = true;
      host.replaceChildren();
    },
  };
}
