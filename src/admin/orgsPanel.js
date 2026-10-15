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
// routes by the first segment; this panel listens for hash changes itself to move between its two views.
// Every request goes through ctx.callAdmin, so a gate refusal (second factor stale, session ended) sends the
// whole console back through the access check instead of showing up here as an error.
import { el, setBusyDisabled } from '../core/dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal } from './gate.js';
import { formatDate, formatDateTime, plural } from './format.js';
import { setFeedback } from './screenParts.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_LIMIT = 20;
const SLOW = 'This is taking longer than expected. Check your connection and retry.';
const FAILED = 'Something went wrong. Nothing was changed. Try again.';

const ROLE_LABEL = Object.freeze({ owner: 'Owner', organiser: 'Organiser' });
const roleLabel = (role) => ROLE_LABEL[role] ?? String(role ?? '');

// One audit action in words. Only the keys each action is documented to carry (migration 20261014130000) are
// read from `detail`; an action this panel does not know is shown by its name, never dropped.
export function describeAuditEntry(entry) {
  const detail = entry?.detail ?? {};
  switch (entry?.action) {
    case 'org.create':
      return 'Organisation created';
    case 'member.add':
      return `Member added as ${roleLabel(detail.role)}`;
    case 'member.role_set':
      return `Role changed from ${roleLabel(detail.from)} to ${roleLabel(detail.to)}`;
    case 'account.create':
      return 'Login created';
    default:
      return String(entry?.action ?? 'Change');
  }
}

// Where in the panel the URL points: the list, one organisation, or an id that cannot be one.
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

function heading(text) {
  return el('h1', { text, attrs: { tabindex: '-1', 'data-heading': 'true' } });
}

function liveRegion() {
  return el('div', {
    className: 'screen-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
}

function link(text, href, className = 'adm-link') {
  return el('a', { className: `${className} tap-target`, text, attrs: { href } });
}

export function mountOrgsPanel(host, ctx) {
  let view = 0; // each render takes a number; an answer for an older view is thrown away
  let disposed = false;
  const isCurrent = (mine) => !disposed && mine === view;

  // One admin call, never rejecting: { data } or { error } (`error.timedOut` when it never answered).
  async function ask(name, args) {
    try {
      const { data, error } = await raceTimeout(ctx.callAdmin(name, args), DEFAULT_LOAD_TIMEOUT_MS);
      return error ? { error } : { data };
    } catch (thrown) {
      return { error: { timedOut: Boolean(thrown?.timedOut) } };
    }
  }

  function messageFor(error) {
    if (error?.timedOut) return SLOW;
    return error?.hint ? describeAdminError(error) : FAILED;
  }

  // A failed load: the message, and a Retry that asks again (not offered when the organisation is gone).
  function showFailure(container, feedback, error, retry) {
    setFeedback(feedback, messageFor(error), 'error');
    if (error?.hint === 'org_not_found' || !retry) return;
    const button = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    let retrying = false;
    button.addEventListener('click', () => {
      if (retrying) return;
      retrying = true;
      setBusyDisabled(button, true);
      retry();
    });
    container.appendChild(button);
  }

  // ---- the list ----

  function orgCard(org) {
    const href = `#/orgs/${org.org_id}`;
    return el('li', { className: 'card adm-org' }, [
      link(String(org.name ?? ''), href, 'adm-org-name'),
      el('p', { className: 'adm-org-slug', text: 'Link name: ' }, [
        el('code', { text: String(org.slug ?? '') }),
      ]),
      el('p', {
        className: 'adm-muted',
        text: `${plural(org.member_count, 'member')} · ${plural(org.event_count, 'event')} · last event ${formatDate(org.last_event_date)} · created ${formatDate(org.created_at)}`,
      }),
    ]);
  }

  async function showList() {
    const mine = ++view;
    const title = heading('Organisations');
    const feedback = liveRegion();
    const body = el('div', { className: 'adm-panel-body' });
    host.replaceChildren(title, feedback, body);
    body.appendChild(el('p', { className: 'adm-muted', text: 'Loading organisations…' }));

    const { data, error } = await ask('admin_list_orgs');
    if (!isCurrent(mine)) return;
    body.replaceChildren();
    if (error) {
      if (isGateRefusal(error)) return; // the console is re-checking access and will replace this
      showFailure(body, feedback, error, showList);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      body.appendChild(el('p', { text: 'There are no organisations yet.' }));
      return;
    }
    body.append(
      el('p', { className: 'adm-muted', text: plural(rows.length, 'organisation') }),
      el('ul', { className: 'adm-org-list' }, rows.map(orgCard)),
    );
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

  async function showDetail(id) {
    const mine = ++view;
    const back = link('← Organisations', '#/orgs', 'adm-back');
    const title = heading('Organisation');
    const feedback = liveRegion();
    const body = el('div', { className: 'adm-panel-body' });
    host.replaceChildren(back, title, feedback, body);
    body.appendChild(el('p', { className: 'adm-muted', text: 'Loading the organisation…' }));

    // Both requests go out together; the page needs only the first to draw, and the second may fail on its own.
    const [detail, audit] = await Promise.all([
      ask('admin_org_detail', { p_org_id: id }),
      ask('admin_list_audit', { p_limit: AUDIT_LIMIT, p_org_id: id }),
    ]);
    if (!isCurrent(mine)) return;
    body.replaceChildren();
    if (detail.error) {
      if (isGateRefusal(detail.error)) return;
      showFailure(body, feedback, detail.error, () => showDetail(id));
      return;
    }
    const org = detail.data?.org ?? {};
    const members = Array.isArray(detail.data?.members) ? detail.data.members : [];
    title.textContent = String(org.name ?? 'Organisation');

    const changes = el('section', { className: 'adm-section' }, [
      el('h2', { text: 'Recent changes' }),
    ]);
    if (audit.error) {
      if (isGateRefusal(audit.error)) return;
      changes.appendChild(
        el('p', {
          className: 'adm-muted',
          text: `Recent changes could not be loaded. ${messageFor(audit.error)}`,
        }),
      );
    } else if (!Array.isArray(audit.data) || audit.data.length === 0) {
      changes.appendChild(
        el('p', {
          className: 'adm-muted',
          text: 'No changes have been made here through the console yet.',
        }),
      );
    } else {
      changes.appendChild(el('ol', { className: 'adm-audit' }, audit.data.map(auditItem)));
    }

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
          : el('ul', { className: 'adm-members' }, members.map(memberItem)),
      ]),
      changes,
    );
  }

  function showMissing() {
    view += 1;
    const feedback = liveRegion();
    host.replaceChildren(
      link('← Organisations', '#/orgs', 'adm-back'),
      heading('Organisation not found'),
      feedback,
    );
    setFeedback(feedback, describeAdminError({ hint: 'org_not_found' }), 'error', { focus: false });
  }

  // ---- routing inside the panel ----

  // What is on screen, as a key (`list`, `missing` or `detail:<id>`). A hash change that names the view already
  // shown (the event can arrive for a hash set just before this panel mounted, or twice) neither refetches nor
  // redraws it; only a different view does. Retry redraws directly and does not go through here.
  let shown = null;

  function render() {
    const route = parseOrgsRoute(window.location.hash);
    shown =
      route.view === 'detail'
        ? `detail:${route.id}`
        : route.view === 'missing'
          ? 'missing'
          : 'list';
    if (route.view === 'detail') showDetail(route.id);
    else if (route.view === 'missing') showMissing();
    else showList();
  }

  function onHashChange() {
    // the shell unmounts this panel for any other first segment; do nothing for it meanwhile
    const route = parseOrgsRoute(window.location.hash);
    if (route.view === 'other') return;
    const key =
      route.view === 'detail'
        ? `detail:${route.id}`
        : route.view === 'missing'
          ? 'missing'
          : 'list';
    if (key === shown) return;
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
