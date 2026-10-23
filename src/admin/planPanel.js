// The Plan panel (gating plan, step 3; spec GATING-SPEC.md D-G9, D-G10, D-G14): what each organisation is allowed to do and
// the switch for each capability. `#/plan` is the Keys section and the list of organisations with their plan now,
// `#/plan/<organisation id>` is one organisation's plan (grants, events, keys). The shell routes by the FIRST segment of the
// hash; this panel listens for hash changes itself to move between its two views (as orgsPanel.js does).
//
// Everything is an EXISTING audited admin function reached through ctx.callAdmin (grant create / extend / revoke, key
// preview and flip, event re-snapshot and release) plus the Plan reads and the manual payment confirmation
// (migration 20261023150000). A gate refusal draws nothing of its own: the console re-checks access and replaces the panel.
// Metadata only (spec D-A4): organisation names, tiers, grants and events as label / date / format / state; no participant data.
// Billing stays manual: "payment received" is a note the operator writes when they give a plan.
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError } from './adminErrors.js';
import { isGateRefusal, SLOW_MESSAGE } from './gate.js';
import { UUID } from './ids.js';
import { plural } from './format.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { ask as askAdmin, mayTakeFocus as focusAllowed } from './panelRequest.js';
import { tierLabel } from './planFormat.js';
import { keysSection } from './planKeys.js';
import { orgPlanView } from './planOrg.js';

// Where in the panel the URL points: the overview, one organisation, an id that cannot be one, or another panel.
export function parsePlanRoute(hash) {
  const parts = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/');
  if (parts[0] !== 'plan') return { view: 'other' };
  if (parts.length === 1 || (parts.length === 2 && parts[1] === '')) return { view: 'overview' };
  if (parts.length === 2 && UUID.test(parts[1])) return { view: 'org', id: parts[1].toLowerCase() };
  return { view: 'missing' };
}

const viewKey = (route) =>
  route.view === 'org' ? `org:${route.id}` : route.view === 'missing' ? 'missing' : 'overview';

function heading(text) {
  return el('h1', { text, attrs: { tabindex: '-1', 'data-heading': 'true' } });
}

function announcer() {
  return el('div', { className: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite' } });
}

function retryButton(onRetry) {
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
    onRetry();
  });
  return button;
}

export function mountPlanPanel(host, ctx) {
  let view = 0; // each render takes a number; an answer for an older view is thrown away
  let disposed = false;
  const isCurrent = (mine) => !disposed && mine === view;
  const ask = (name, args) => askAdmin(ctx, name, args);
  const mayTakeFocus = () => focusAllowed(host);
  const messageFor = (error) => (error?.timedOut ? SLOW_MESSAGE : describeAdminError(error));
  const stepAside = () => host.replaceChildren();

  // One change at a time on a page: a second is told to wait, not dropped when the first redraws the page.
  let writing = false;
  const writes = {
    begin: () => (writing ? false : (writing = true)),
    end: () => {
      writing = false;
    },
  };

  function showFailure(container, feedback, error, retry) {
    setFeedback(feedback, messageFor(error), 'error', { focus: mayTakeFocus() });
    if (error?.hint === 'org_not_found' || !retry) return;
    container.appendChild(retryButton(() => retry({ focusHeading: true })));
  }

  // ---- the overview ----

  function orgCard(org) {
    return el('li', { className: 'card adm-org' }, [
      el('a', {
        className: 'adm-org-name tap-target',
        text: String(org.name ?? ''),
        attrs: { href: `#/plan/${org.org_id}` },
      }),
      el('p', { className: 'adm-org-slug' }, [
        document.createTextNode('Plan now: '),
        el('strong', { text: tierLabel(org.tier) }),
      ]),
      el('p', {
        className: 'adm-muted',
        text: `${plural(org.event_grants, 'event plan')} · ${plural(org.locked_events, 'event')} past ${org.locked_events === 1 ? 'its' : 'their'} Per-event window`,
      }),
    ]);
  }

  async function showOverview({ focusHeading = false, notice = null } = {}) {
    const mine = ++view;
    const title = heading('Plans and keys');
    const feedback = feedbackRegion();
    const status = announcer();
    const keys = keysSection({
      ctx,
      onGateRefused: stepAside,
      mayTakeFocus,
      writes,
      reload: (message) => {
        writes.end();
        showOverview({ focusHeading: true, notice: message });
      },
    });
    const orgsBody = el('div', { className: 'adm-panel-body' });
    host.replaceChildren(
      title,
      feedback,
      status,
      keys.node,
      el('section', { className: 'adm-section' }, [el('h2', { text: 'Organisations' }), orgsBody]),
    );
    if (notice) {
      setFeedback(feedback, notice, 'success', { focus: false });
      title.focus();
    } else if (focusHeading) title.focus();
    orgsBody.appendChild(el('p', { className: 'adm-muted', text: 'Loading organisations…' }));
    const keysLoaded = keys.load();

    const { data, error } = await ask('admin_plan_orgs');
    if (!isCurrent(mine)) return;
    orgsBody.replaceChildren();
    if (error) {
      if (isGateRefusal(error)) return stepAside();
      showFailure(orgsBody, feedback, error, showOverview);
    } else {
      try {
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0)
          orgsBody.appendChild(el('p', { text: 'There are no organisations yet.' }));
        else
          orgsBody.append(
            el('p', { className: 'adm-muted', text: plural(rows.length, 'organisation') }),
            el('ul', { className: 'adm-org-list', attrs: { role: 'list' } }, rows.map(orgCard)),
          );
        if (!notice) status.textContent = `${plural(rows.length, 'organisation')} loaded.`;
      } catch {
        orgsBody.replaceChildren();
        showFailure(orgsBody, feedback, {}, showOverview);
      }
    }
    await keysLoaded;
  }

  // ---- one organisation ----

  async function showOrg(id, { focusHeading = false, notice = null } = {}) {
    const mine = ++view;
    const title = heading('Plan');
    const feedback = feedbackRegion();
    const status = announcer();
    const body = el('div', { className: 'adm-panel-body' });
    const back = el('a', { className: 'adm-back tap-target', attrs: { href: '#/plan' } }, [
      el('span', { text: '←', attrs: { 'aria-hidden': 'true' } }),
      document.createTextNode(' Plans and keys'),
    ]);
    host.replaceChildren(back, title, feedback, status, body);
    if (focusHeading && !notice) title.focus();
    body.appendChild(el('p', { className: 'adm-muted', text: 'Loading the plan…' }));

    const { data, error } = await ask('admin_plan_org', { p_org_id: id });
    if (!isCurrent(mine)) return;
    body.replaceChildren();
    if (error) {
      if (isGateRefusal(error)) return stepAside();
      showFailure(body, feedback, error, (options) => showOrg(id, { ...options, notice }));
      return;
    }
    try {
      title.textContent = `Plan: ${String(data?.org?.name ?? 'Organisation')}`;
      body.append(
        ...orgPlanView({
          ctx,
          data,
          onGateRefused: stepAside,
          mayTakeFocus,
          writes,
          reload: (message) => {
            writes.end();
            showOrg(id, { focusHeading: true, notice: message });
          },
        }),
      );
      if (notice) {
        setFeedback(feedback, notice, 'success', { focus: false });
        title.focus();
      } else status.textContent = `${title.textContent} loaded.`;
    } catch {
      body.replaceChildren();
      title.textContent = 'Plan';
      showFailure(body, feedback, {}, (options) => showOrg(id, { ...options, notice }));
    }
  }

  function showMissing() {
    view += 1;
    host.replaceChildren(
      el('a', {
        className: 'adm-back tap-target',
        text: '← Plans and keys',
        attrs: { href: '#/plan' },
      }),
      heading('Organisation not found'),
      el('p', {
        className: 'screen-feedback',
        text: describeAdminError({ hint: 'org_not_found' }),
        attrs: { 'data-tone': 'error' },
      }),
    );
  }

  // ---- routing inside the panel ----

  let shown = null;

  function render() {
    const route = parsePlanRoute(window.location.hash);
    shown = viewKey(route);
    if (route.view === 'org') showOrg(route.id);
    else if (route.view === 'missing') showMissing();
    else showOverview();
  }

  function onHashChange() {
    const route = parsePlanRoute(window.location.hash);
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
      host.replaceChildren();
    },
  };
}
