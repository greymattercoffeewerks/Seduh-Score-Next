// The console's panel registry: the ONE list the shell renders its navigation and routes from. A new panel
// (create organisation, the audit log, and later gating's Plan panel) is an entry here plus a screen module;
// nothing in shell.js changes. Each entry is { id, label, route, mount(host, ctx) } and mount returns
// { unmount() }. The shell routes by the FIRST segment of the URL hash (`#/orgs/<id>` is the `orgs` panel), and a
// panel with more than one view listens for hash changes itself (see orgsPanel.js). The first entry is the one
// shown when the hash names no panel.
//
// `ctx` carries { client, callAdmin, onGateRefused }. A panel calls admin functions through
// ctx.callAdmin(name, args), never client.rpc: a gate refusal in the answer (the second factor went stale, the
// session ended) then sends the whole console back through the access check, so no panel has to remember to
// look for it. Translate any other refusal with describeAdminError (adminErrors.js).
import { mountOrgsPanel } from './orgsPanel.js';
import { mountCreateOrgPanel } from './createOrgPanel.js';

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
]);
