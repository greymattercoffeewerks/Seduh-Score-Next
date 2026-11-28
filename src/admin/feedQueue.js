// The Seduh ID queue on the Seduh ID screen: the published podiums waiting for the owner's review, with the NAMES and
// places on them (owner decision 2026-11-28, an amendment of D-A4: names and places, never a phone number, a cafe or a
// person's id), and a Reject button. It calls `admin_seduh_feed_queue` and `admin_seduh_feed_reject` through ctx.callAdmin
// (panelRequest.js `ask`): a gate refusal draws nothing (the console re-checks access); any other failure is translated
// from its stable hint, never its text.
//
// APPROVE IS BUILT AND NOT SHOWN. `approveQueued` below calls `admin_seduh_feed_approve`; no screen calls it, and the
// database refuses it for everyone until the owner sets `app.seduh_feed_mode.console_actions` in SQL (owner decision
// 2026-11-28: harden the console first). The answer carries that switch (`console_actions`) so the screen could show
// the button later; today it ignores it.
import { el, setBusyDisabled } from '../core/dom.js';
import { confirmDialog } from '../core/feedback.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { formatDateTime } from './format.js';
import { ask as askAdmin } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';

export const QUEUE_READ_FAILED = 'The queue could not be read. Try again.';
export const QUEUE_EMPTY = 'Nothing is waiting for review.';
export const QUEUE_NOTE =
  'Names and places only: never a phone number. Rejecting a podium creates nothing and takes it off this list. Running the feed is still done by the owner in SQL.';

// The rows as the screen draws them, or null when the answer is not what the function documents.
export function readQueue(data) {
  if (!Array.isArray(data)) return null;
  const rows = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object' || typeof row.result_id !== 'string') return null;
    if (!Array.isArray(row.podium)) return null;
    const podium = [];
    for (const place of row.podium) {
      if (!Number.isSafeInteger(place?.position) || typeof place?.name !== 'string') return null;
      podium.push({ position: place.position, name: place.name });
    }
    rows.push({
      resultId: row.result_id,
      orgName: String(row.org_name ?? ''),
      eventName: String(row.event_name ?? ''),
      eventDate: row.event_date ?? null,
      enqueuedAt: row.enqueued_at ?? null,
      podium,
    });
  }
  return rows;
}

// Built, not shown. Never called by the screen.
export async function approveQueued(ctx, resultId) {
  return askAdmin(ctx, 'admin_seduh_feed_approve', { p_result_id: resultId });
}

export function mountFeedQueue(ctx) {
  let disposed = false;
  let busy = false;
  const heading = el('h2', { text: 'Waiting for review', attrs: { id: 'adm-feed-queue-heading' } });
  const note = el('p', { className: 'adm-muted', text: QUEUE_NOTE });
  const feedback = feedbackRegion();
  const list = el('div', { className: 'adm-panel-body' });
  const element = el(
    'section',
    { className: 'adm-section', attrs: { 'aria-labelledby': 'adm-feed-queue-heading' } },
    [heading, note, feedback, list],
  );

  const messageFor = (error) => (error?.timedOut ? SLOW_MESSAGE : describeAdminError(error));

  function drawRow(row) {
    const reject = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Reject',
      attrs: {
        type: 'button',
        'aria-label': `Reject the podium of ${row.eventName || 'this event'}`,
      },
    });
    reject.addEventListener('click', () => handleReject(row, reject));
    const places = el(
      'ol',
      { className: 'adm-feed-podium' },
      row.podium.map((place) => el('li', { text: place.name })),
    );
    const when = row.enqueuedAt ? ` · queued ${formatDateTime(row.enqueuedAt)}` : '';
    return el('li', { className: 'adm-feed-row' }, [
      el('strong', { text: row.eventName || 'Untitled event' }),
      el('span', {
        className: 'adm-muted',
        text: `${row.orgName}${row.eventDate ? ` · ${row.eventDate}` : ''}${when}`,
      }),
      places,
      reject,
    ]);
  }

  function draw(rows) {
    if (rows.length === 0) {
      list.replaceChildren(el('p', { text: QUEUE_EMPTY, attrs: { 'data-empty': 'true' } }));
      return;
    }
    list.replaceChildren(
      el(
        'ul',
        { className: 'adm-feed-list', attrs: { 'aria-label': 'Podiums waiting for review' } },
        rows.map(drawRow),
      ),
    );
  }

  async function load() {
    if (disposed) return null;
    const answer = await askAdmin(ctx, 'admin_seduh_feed_queue', {});
    if (disposed) return null;
    if (answer.error) {
      if (isGateRefusal(answer.error)) return 'gate';
      list.replaceChildren();
      setFeedback(feedback, messageFor(answer.error), 'error', { focus: false });
      return 'failed';
    }
    const rows = readQueue(answer.data);
    if (rows === null) {
      list.replaceChildren();
      setFeedback(feedback, QUEUE_READ_FAILED, 'error', { focus: false });
      return 'failed';
    }
    setFeedback(feedback, '');
    draw(rows);
    return 'ok';
  }

  async function handleReject(row, button) {
    if (busy) return;
    const sure = await confirmDialog({
      title: 'Reject this podium?',
      body: `${row.eventName || 'This event'} will come off the list and no Seduh ID is made from it. This cannot be undone from here.`,
      confirmLabel: 'Reject',
    });
    if (!sure || disposed) return;
    busy = true;
    setBusyDisabled(button, true);
    const answer = await askAdmin(ctx, 'admin_seduh_feed_reject', { p_result_id: row.resultId });
    busy = false;
    if (disposed) return;
    if (answer.error) {
      if (isGateRefusal(answer.error)) return;
      setBusyDisabled(button, false);
      setFeedback(feedback, messageFor(answer.error), 'error');
      return;
    }
    const outcome = await load();
    if (outcome === 'ok') setFeedback(feedback, 'Podium rejected.', 'success', { focus: false });
  }

  return {
    element,
    load,
    unmount() {
      disposed = true;
    },
  };
}
