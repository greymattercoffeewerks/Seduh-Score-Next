// The Seduh ID screen (T-ID.C3, owner decision 7a): how big the Seduh ID directory is, as NUMBERS ONLY. It calls the one
// read-only function `admin_seduh_id_counts` and draws the ten integers it returns, in plain words. It never shows, and
// the function never returns, a name, a phone number, an id, an email or an organisation's own figure (D-A4: the console
// shows metadata and counts, never participant data; a per-organisation count could identify who is in the directory).
// Merges and unlinks are the owner's, in SQL: there is deliberately nothing to click here but "Refresh numbers".
//
// Every request goes through ctx.callAdmin (panelRequest.js `ask`): a gate refusal draws nothing here (the console is
// checking access again and replaces the panel); any other failure is translated by describeAdminError from its stable
// hint, never from its text. The answer is validated BEFORE anything is drawn: a row that is not ten whole, non-negative
// numbers draws none of them, never half. Text only (`el()`), never innerHTML.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { formatDateTime } from './format.js';
import { ask as askAdmin, mayTakeFocus as focusAllowed } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';

export const READ_FAILED = 'The Seduh ID numbers could not be read. Try again.';
export const EXPLANATION =
  'Numbers only: this screen never shows a name, a phone number or an organisation. Merges and unlinks are done by the owner in SQL.';
export const NO_IDENTITIES = 'There are no Seduh ID identities yet.';

// The ten figures, in the order the function documents them.
export const COUNT_KEYS = Object.freeze([
  'identities_total',
  'identities_active',
  'identities_opted_out',
  'identities_merged',
  'identities_from_roster',
  'identities_from_archive',
  'identities_orphan',
  'people_total',
  'people_linked',
  'people_blocked',
]);

// The row as ten whole non-negative numbers, or null when it is anything else (extra keys are ignored, not drawn).
export function readCounts(data) {
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (row === null || typeof row !== 'object') return null;
  const counts = {};
  for (const key of COUNT_KEYS) {
    const value = row[key];
    if (!Number.isSafeInteger(value) || value < 0) return null;
    counts[key] = value;
  }
  return counts;
}

function group(title, rows, note) {
  const id = `adm-seduh-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const heading = el('h2', { text: title, attrs: { id } });
  const list = el(
    'dl',
    { className: 'adm-facts' },
    rows.map(([label, value]) =>
      el('div', { className: 'adm-fact' }, [
        el('dt', { text: label }),
        el('dd', { className: 'adm-count', text: String(value) }),
      ]),
    ),
  );
  const children = [heading, list];
  if (note) children.push(el('p', { className: 'adm-muted', text: note }));
  return el('section', { className: 'adm-section', attrs: { 'aria-labelledby': id } }, children);
}

// What is drawn for a set of counts: the identity groups only when there are identities (an empty directory says so
// instead of a wall of zeros), the people group always (people exist without any identity).
export function countGroups(counts) {
  const groups = [];
  if (counts.identities_total === 0) {
    groups.push(el('p', { text: NO_IDENTITIES, attrs: { 'data-empty': 'true' } }));
  } else {
    groups.push(
      group('Identities', [
        ['Identities in total', counts.identities_total],
        ['Active', counts.identities_active],
        ['Opted out (name removed)', counts.identities_opted_out],
        ['Merged into another identity', counts.identities_merged],
      ]),
      group('Where they came from', [
        ['From organiser rosters', counts.identities_from_roster],
        ['From published results (archive)', counts.identities_from_archive],
      ]),
      group(
        'Needs a look',
        [['Identities with no linked person', counts.identities_orphan]],
        'An identity that no person in any organisation is linked to. Merged identities are not counted.',
      ),
    );
  }
  groups.push(
    group('People in organisations', [
      ['People in all organisations', counts.people_total],
      ['Linked to an identity', counts.people_linked],
      ['Not linked', Math.max(0, counts.people_total - counts.people_linked)],
      ['Blocked from linking by the owner', counts.people_blocked],
    ]),
  );
  return groups;
}

export function mountSeduhIdPanel(host, ctx) {
  let disposed = false;
  let loading = false;
  let loadedOnce = false;

  const title = el('h1', {
    text: 'Seduh ID',
    attrs: { tabindex: '-1', 'data-heading': 'true' },
  });
  const intro = el('p', { className: 'adm-muted', text: EXPLANATION });
  const feedback = feedbackRegion();
  // Said to a screen reader and never shown: that the numbers arrived.
  const status = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const content = el('div', { className: 'adm-panel-body' });
  const footer = el('div', { className: 'adm-panel-body' });
  const refresh = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Refresh numbers',
    attrs: { type: 'button' },
  });
  refresh.addEventListener('click', () => load());
  const body = el('div', { className: 'adm-panel-body' }, [content, footer]);
  host.replaceChildren(title, intro, feedback, status, body);

  const mayTakeFocus = () => focusAllowed(host);
  const messageFor = (error) => (error?.timedOut ? SLOW_MESSAGE : describeAdminError(error));

  function stepAside() {
    host.replaceChildren();
  }

  function showFailure(message) {
    setFeedback(feedback, message, 'error', { focus: false });
    const retry = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retry.addEventListener('click', () => {
      setBusyDisabled(retry, true);
      load();
    });
    footer.replaceChildren(retry);
    // The message is read by its live region; the Retry is what the person needs next.
    if (!loadedOnce || mayTakeFocus()) retry.focus();
  }

  async function load() {
    if (loading) return;
    loading = true;
    setFeedback(feedback, '');
    setBusyDisabled(refresh, true);
    // Numbers already on screen stay until the new ones arrive, and are said to be old while they do.
    footer.replaceChildren(el('p', { className: 'adm-muted', text: 'Loading…' }));
    const answer = await askAdmin(ctx, 'admin_seduh_id_counts', {});
    if (disposed) return;
    loading = false;
    footer.replaceChildren();
    setBusyDisabled(refresh, false);
    if (answer.error) {
      if (isGateRefusal(answer.error)) return stepAside();
      showFailure(messageFor(answer.error));
      return;
    }
    const counts = readCounts(answer.data);
    if (counts === null) {
      showFailure(READ_FAILED);
      return;
    }
    content.replaceChildren(...countGroups(counts));
    footer.replaceChildren(
      el('p', { className: 'adm-muted', text: `Counted at ${formatDateTime(new Date())}.` }),
      refresh,
    );
    status.textContent = `Seduh ID numbers loaded: ${counts.identities_total} identities, ${counts.people_total} people.`;
    // After a Refresh press the control the person used is the one they are on; a first load leaves focus on the heading.
    if (loadedOnce && mayTakeFocus()) refresh.focus();
    loadedOnce = true;
  }

  load();

  return {
    unmount() {
      disposed = true;
      host.replaceChildren();
    },
  };
}
