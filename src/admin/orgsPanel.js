// The Organisations panel (spec section 5, D2): the list of every organisation, and one organisation's detail
// with its members and its recent audit entries. READ ONLY: nothing here creates or changes anything (Batches
// 10 and 11 add that).
//
// What it shows is exactly what the database function returns and no more (spec D-A4): names, link names,
// dates, member emails and roles, and counts of events. Never an event name, a score, an entry or a person
// who is not a member: the functions do not return them (test 048), and this panel renders only the fields
// named below, so a field added to a function later would not appear here by accident.
//
// Routes inside the panel are `#/orgs` (the list) and `#/orgs/<organisation id>` (the detail). The shell
// routes by the first segment (and rewrites a hash that names no panel to the first panel's own address); this
// panel listens for hash changes itself to move between its two views. Every request goes through
// ctx.callAdmin, so a gate refusal (second factor stale, session ended) sends the whole console back through
// the access check instead of showing up here as an error.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { formatDate, formatDateTime, plural } from './format.js';
import { feedbackRegion, setFeedback } from './screenParts.js';

import { UUID } from './ids.js';
import { ask as askAdmin, mayTakeFocus as focusAllowed } from './panelRequest.js';
const AUDIT_LIMIT = 20;

const ROLE_LABEL = Object.freeze({ owner: 'Owner', organiser: 'Organiser' });
const roleLabel = (role) =>
  Object.hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role] : String(role ?? '');

// One audit action in words. Only the keys each action is documented to carry (migration 20261014130000) are
// read from `detail`; an action this panel does not know is shown by its name, never dropped.
export function describeAuditEntry(entry) {
  const detail = entry?.detail ?? {};
  switch (entry?.action) {
    case 'org.create':
      return 'Organisation created';
    case 'member.add':
      return detail.role ? `Member added as ${roleLabel(detail.role)}` : 'Member added';
    case 'member.role_set':
      return `Role changed from ${roleLabel(detail.from)} to ${roleLabel(detail.to)}`;
    case 'account.create':
      return 'Login created';
    default:
      return String(entry?.action ?? 'Change');
  }
}

// Where in the panel the URL points: the list, one organisation, an id that cannot be one, or another panel.
export function parseOrgsRoute(hash) {
  const parts = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/');
  if (parts[0] !== 'orgs') return { view: 'other' };
  if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) return { view: 'list' };
  if (parts.length === 2 && UUID.test(parts[1]))
    return { view: 'detail', id: parts[1].toLowerCase() };
  return { view: 'missing' };
}

// The view a route shows, as a key. `other` (a hash for another panel) reads as the list: the shell rewrites such
// a hash to this panel's own address, and the list is what that address shows.
const viewKey = (route) =>
  route.view === 'detail' ? `detail:${route.id}` : route.view === 'missing' ? 'missing' : 'list';

function heading(text) {
  return el('h1', { text, attrs: { tabindex: '-1', 'data-heading': 'true' } });
}

// Said to a screen reader and never shown: what has just finished loading. The heading is focused before its
// text is known (the detail's is renamed once the organisation arrives), and the loading line is not announced,
// so this is how the arrival of the content is heard.
function announcer() {
  return el('div', { className: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
}

function link(text, href, className, attrs = {}) {
  return el('a', { className: `${className} tap-target`, text, attrs: { href, ...attrs } });
}

// The arrow is decoration: a screen reader says "Organisations", not "left arrow Organisations".
function backLink() {
  return el('a', { className: 'adm-back tap-target', attrs: { href: '#/orgs' } }, [
    el('span', { text: '←', attrs: { 'aria-hidden': 'true' } }),
    document.createTextNode(' Organisations'),
  ]);
}

function retryButton(onRetry, className = 'btn btn-primary tap-target') {
  const button = el('button', { className, text: 'Retry', attrs: { type: 'button' } });
  let retrying = false;
  button.addEventListener('click', () => {
    if (retrying) return;
    retrying = true;
    setBusyDisabled(button, true);
    onRetry();
  });
  return button;
}

export function mountOrgsPanel(host, ctx) {
  let view = 0; // each render takes a number; an answer for an older view is thrown away
  let disposed = false;
  const isCurrent = (mine) => !disposed && mine === view;

  const ask = (name, args) => askAdmin(ctx, name, args);

  const messageFor = (error) => (error?.timedOut ? SLOW_MESSAGE : describeAdminError(error));

  // A refusal that means the gate is closed: the console is re-checking access and will replace the panel. Draw
  // nothing of the data meanwhile, not even what had already arrived.
  function stepAside() {
    host.replaceChildren();
  }

  const mayTakeFocus = () => focusAllowed(host);

  // A failed load: the message, and a Retry that asks again (not offered when the organisation is gone). The
  // retried view takes focus back to its heading, because the button that had it is replaced.
  function showFailure(container, feedback, error, retry) {
    setFeedback(feedback, messageFor(error), 'error', { focus: mayTakeFocus() });
    if (error?.hint === 'org_not_found' || !retry) return;
    container.appendChild(retryButton(() => retry({ focusHeading: true })));
  }

  // ---- the list ----

  function orgCard(org) {
    const slugId = `adm-org-slug-${org.org_id}`;
    return el('li', { className: 'card adm-org' }, [
      // The link name is its description: two organisations may share a name, only the link name is unique.
      link(String(org.name ?? ''), `#/orgs/${org.org_id}`, 'adm-org-name', {
        'aria-describedby': slugId,
      }),
      el('p', { className: 'adm-org-slug', text: 'Link name: ', id: slugId }, [
        el('code', { text: String(org.slug ?? '') }),
      ]),
      el('p', {
        className: 'adm-muted',
        text: `${plural(org.member_count, 'member')} · ${plural(org.event_count, 'event')} · last event ${formatDate(org.last_event_date)} · created ${formatDate(org.created_at)}`,
      }),
    ]);
  }

  async function showList({ focusHeading = false } = {}) {
    const mine = ++view;
    const title = heading('Organisations');
    const feedback = feedbackRegion();
    const status = announcer();
    const body = el('div', { className: 'adm-panel-body' });
    host.replaceChildren(title, feedback, status, body);
    if (focusHeading) title.focus();
    body.appendChild(el('p', { className: 'adm-muted', text: 'Loading organisations…' }));

    const { data, error } = await ask('admin_list_orgs');
    if (!isCurrent(mine)) return;
    body.replaceChildren();
    if (error) {
      if (isGateRefusal(error)) return stepAside();
      showFailure(body, feedback, error, showList);
      return;
    }
    try {
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        body.appendChild(el('p', { text: 'There are no organisations yet.' }));
        status.textContent = 'There are no organisations yet.';
        return;
      }
      body.append(
        el('p', { className: 'adm-muted', text: plural(rows.length, 'organisation') }),
        el('ul', { className: 'adm-org-list', attrs: { role: 'list' } }, rows.map(orgCard)),
      );
      status.textContent = `${plural(rows.length, 'organisation')} loaded.`;
    } catch {
      // a row that is not what the function documents: say so rather than leave the page blank
      body.replaceChildren();
      showFailure(body, feedback, {}, showList);
    }
  }

  // ---- one organisation ----

  function memberItem(member) {
    return el('li', { className: 'adm-member' }, [
      el('span', { className: 'adm-member-email', text: String(member.email ?? '') }),
      el('span', { className: 'adm-role', text: roleLabel(member.role) }),
      el('span', { className: 'adm-muted', text: `joined ${formatDate(member.joined_at)}` }),
    ]);
  }

  function auditItem(entry) {
    const by = entry.actor_email
      ? `by ${entry.actor_email}`
      : 'by an account that no longer exists';
    const target = entry.target_user_email ? ` · ${entry.target_user_email}` : '';
    return el('li', { className: 'adm-audit-item' }, [
      el('span', { className: 'adm-audit-what', text: describeAuditEntry(entry) }),
      el('span', { className: 'adm-muted', text: `${formatDateTime(entry.at)} · ${by}${target}` }),
    ]);
  }

  function fact(label, value) {
    return el('div', { className: 'adm-fact' }, [
      el('dt', { text: label }),
      el('dd', { text: value }),
    ]);
  }

  // The recent changes, in their own region: they load, fail and retry on their own, so a slow or failing change
  // log never holds the organisation back. `pending` is the request already on its way (the first time).
  async function loadChanges(mine, region, id, pending) {
    region.replaceChildren(el('p', { className: 'adm-muted', text: 'Loading recent changes…' }));
    const audit = await (pending ??
      ask('admin_list_audit', { p_limit: AUDIT_LIMIT, p_org_id: id }));
    if (!isCurrent(mine)) return;
    region.replaceChildren();
    if (audit.error) {
      if (isGateRefusal(audit.error)) return stepAside();
      region.append(
        el('p', {
          className: 'adm-muted',
          text: `Recent changes could not be loaded. ${messageFor(audit.error)}`,
        }),
        retryButton(() => loadChanges(mine, region, id), 'btn btn-outline tap-target'),
      );
      return;
    }
    const rows = Array.isArray(audit.data) ? audit.data : [];
    if (rows.length === 0) {
      region.appendChild(
        el('p', {
          className: 'adm-muted',
          text: 'No changes have been made here through the console yet.',
        }),
      );
      return;
    }
    region.appendChild(
      el('ol', { className: 'adm-audit', attrs: { role: 'list' } }, rows.map(auditItem)),
    );
    // Said when the list is cut: at exactly the limit the operator cannot otherwise tell.
    if (rows.length >= AUDIT_LIMIT) {
      region.appendChild(
        el('p', { className: 'adm-muted', text: `Showing the latest ${AUDIT_LIMIT} changes.` }),
      );
    }
  }

  async function showDetail(id, { focusHeading = false } = {}) {
    const mine = ++view;
    const title = heading('Organisation');
    const feedback = feedbackRegion();
    const status = announcer();
    const body = el('div', { className: 'adm-panel-body' });
    host.replaceChildren(backLink(), title, feedback, status, body);
    if (focusHeading) title.focus();
    body.appendChild(el('p', { className: 'adm-muted', text: 'Loading the organisation…' }));

    // Both requests go out together. The organisation is drawn as soon as ITS answer arrives; the changes follow
    // when theirs does (and may fail on their own).
    const detailRequest = ask('admin_org_detail', { p_org_id: id });
    const auditRequest = ask('admin_list_audit', { p_limit: AUDIT_LIMIT, p_org_id: id });
    const detail = await detailRequest;
    if (!isCurrent(mine)) return;
    body.replaceChildren();
    if (detail.error) {
      if (isGateRefusal(detail.error)) return stepAside();
      showFailure(body, feedback, detail.error, (options) => showDetail(id, options));
      return;
    }
    const changes = el('div', { className: 'adm-changes' });
    try {
      const org = detail.data?.org ?? {};
      const members = Array.isArray(detail.data?.members) ? detail.data.members : [];
      title.textContent = String(org.name ?? 'Organisation');
      body.append(
        el('dl', { className: 'adm-facts' }, [
          fact('Link name', String(org.slug ?? '')),
          fact('Created', formatDate(org.created_at)),
          fact('Events', plural(detail.data?.event_count, 'event')),
          fact('Last event', formatDate(detail.data?.last_event_date)),
        ]),
        el('section', { className: 'adm-section' }, [
          el('h2', { text: `Members (${members.length})` }),
          members.length === 0
            ? el('p', { className: 'adm-muted', text: 'This organisation has no members.' })
            : el(
                'ul',
                { className: 'adm-members', attrs: { role: 'list' } },
                members.map(memberItem),
              ),
        ]),
        el('section', { className: 'adm-section' }, [
          el('h2', { text: 'Recent changes' }),
          changes,
        ]),
      );
      status.textContent = `${title.textContent} loaded.`;
    } catch {
      body.replaceChildren();
      title.textContent = 'Organisation';
      showFailure(body, feedback, {}, (options) => showDetail(id, options));
      return;
    }
    await loadChanges(mine, changes, id, auditRequest);
  }

  function showMissing() {
    view += 1;
    // Static text, not a live region: focus is on the heading, so it is read next.
    host.replaceChildren(
      backLink(),
      heading('Organisation not found'),
      el('p', {
        className: 'screen-feedback',
        text: describeAdminError({ hint: 'org_not_found' }),
        attrs: { 'data-tone': 'error' },
      }),
    );
  }

  // ---- routing inside the panel ----

  // What is on screen, as a key. A hash change that names the view already shown (the event can arrive for a hash
  // set just before this panel mounted, since a browser queues it as a task) neither refetches nor redraws it;
  // only a different view does. Retry redraws directly and does not go through here.
  let shown = null;

  function render() {
    const route = parseOrgsRoute(window.location.hash);
    shown = viewKey(route);
    if (route.view === 'detail') showDetail(route.id);
    else if (route.view === 'missing') showMissing();
    else showList();
  }

  function onHashChange() {
    const route = parseOrgsRoute(window.location.hash);
    // a hash for another panel: the shell is about to swap this panel out, so do nothing meanwhile
    if (route.view === 'other') return;
    if (viewKey(route) === shown) return;
    render();
    host.querySelector('[data-heading]')?.focus();
  }

  window.addEventListener('hashchange', onHashChange);
  render();

  return {
    unmount() {
      disposed = true;
      window.removeEventListener('hashchange', onHashChange);
    },
  };
}
