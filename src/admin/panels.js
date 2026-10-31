// The console's panel registry: the ONE list the shell renders its navigation and routes from. A new panel
// (and later gating's Plan panel) is an entry here plus a screen module; nothing in shell.js
// changes. Each entry is { id, label, route, mount(host, ctx) } and mount returns { unmount() }, and optionally
// `leaveWarning()`: a sentence when the panel holds something that exists only on its screen (a one-time
// password), which makes the shell ask before another panel or a sign-out replaces it. The shell routes by the FIRST segment of the URL hash (`#/orgs/<id>` is the `orgs` panel), and a
// panel with more than one view listens for hash changes itself (see orgsPanel.js). The first entry is the one
// shown when the hash names no panel.
//
// `ctx` carries { client, callAdmin, callFunction, onGateRefused }. A panel calls admin functions through
// ctx.callAdmin(name, args) (and Edge Functions through ctx.callFunction(name, body)), never client.rpc: a gate refusal in the answer (the second factor went stale, the
// session ended) then sends the whole console back through the access check, so no panel has to remember to
// look for it. Translate any other refusal with describeAdminError (adminErrors.js).
import { mountOrgsPanel } from './orgsPanel.js';
import { mountCreateOrgPanel } from './createOrgPanel.js';
import { mountAuditPanel } from './auditPanel.js';
import { mountPlanPanel } from './planPanel.js';
import { mountSeduhIdPanel } from './seduhIdPanel.js';
import { mountPasswordPanel } from './passwordPanel.js';

export const PANELS = Object.freeze([
  Object.freeze({
    id: 'orgs',
    label: 'Organisations',
    route: 'orgs',
    mount: mountOrgsPanel,
  }),
  Object.freeze({
    id: 'create-org',
    label: 'New organisation',
    route: 'new-org',
    mount: mountCreateOrgPanel,
  }),
  Object.freeze({
    id: 'plan',
    label: 'Plans and keys',
    route: 'plan',
    mount: mountPlanPanel,
  }),
  Object.freeze({
    id: 'seduh-id',
    label: 'Seduh ID',
    route: 'seduh-id',
    mount: mountSeduhIdPanel,
  }),
  Object.freeze({
    id: 'audit',
    label: 'Audit log',
    route: 'audit',
    mount: mountAuditPanel,
  }),
  Object.freeze({
    id: 'password',
    label: 'Change password',
    route: 'password',
    mount: mountPasswordPanel,
  }),
]);
