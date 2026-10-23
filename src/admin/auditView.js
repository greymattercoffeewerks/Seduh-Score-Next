// How an audit entry reads: the action in words, and the line under it (when, by whom, about which account and
// organisation). Shared by the organisation detail (its recent changes) and the Audit log screen. It draws only the
// fields named here: a field the function starts returning later does not appear by accident.
import { el } from '../core/dom.js';
import { formatDateTime } from './format.js';
import { UUID } from './ids.js';
import { roleLabel } from './roles.js';

// One audit action in words. Only the keys each action is documented to carry (migration 20261014130000) are
// read from `detail`; an action this console does not know is shown by its name, never dropped.
export function describeAuditEntry(entry) {
  const detail = entry?.detail ?? {};
  switch (entry?.action) {
    case 'org.create':
      return 'Organisation created';
    case 'member.add': {
      const added = detail.role ? `Member added as ${roleLabel(detail.role)}` : 'Member added';
      // `attested` means "the database required it and the operator gave it": the account's password may have been
      // known to someone else, and the operator confirmed the person set their own.
      return detail.attested === true ? `${added}, after confirming their own password` : added;
    }
    case 'member.role_set':
      return `Role changed from ${roleLabel(detail.from)} to ${roleLabel(detail.to)}`;
    case 'account.create':
      return 'Login created';
    case 'grant.create':
      return 'Plan given';
    case 'grant.extend':
      return 'Plan extended';
    case 'grant.revoke':
      return 'Plan revoked';
    case 'payment.confirm':
      return 'Payment confirmed, plan given';
    case 'gating.key_enforced':
      return 'Key turned on';
    case 'gating.key_relaxed':
      return 'Key turned off';
    case 'event.resnapshot':
      return 'Frozen plan of an event raised';
    case 'event.release':
      return 'Open event released';
    default:
      return String(entry?.action ?? 'Change');
  }
}

// One entry as a list item. `withOrg` adds the organisation it was about (the Audit log screen; the organisation's
// own detail already says which it is). The organisation is a link only while it still exists (its link name is
// resolved when the log is read, and is null once the organisation is gone).
export function auditItem(entry, { withOrg = false } = {}) {
  const by = entry.actor_email ? `by ${entry.actor_email}` : 'by an account that no longer exists';
  const target = entry.target_user_email ? ` · ${entry.target_user_email}` : '';
  const meta = el('span', {
    className: 'adm-muted',
    text: `${formatDateTime(entry.at)} · ${by}${target}`,
  });
  const children = [
    el('span', { className: 'adm-audit-what', text: describeAuditEntry(entry) }),
    meta,
  ];
  if (withOrg && entry.target_org_id) {
    const exists = entry.target_org_slug && UUID.test(String(entry.target_org_id));
    children.push(
      exists
        ? el('span', { className: 'adm-muted' }, [
            document.createTextNode('Organisation: '),
            el('a', {
              className: 'adm-link-inline',
              text: String(entry.target_org_slug),
              attrs: {
                href: `#/orgs/${entry.target_org_id}`,
                'aria-label': `Organisation ${entry.target_org_slug}`,
              },
            }),
          ])
        : el('span', { className: 'adm-muted', text: 'An organisation that no longer exists' }),
    );
  }
  return el('li', { className: 'adm-audit-item' }, children);
}
