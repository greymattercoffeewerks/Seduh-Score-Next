// The console's panel registry: the ONE list the shell renders its navigation and routes from. A new panel
// (the organisation list, the audit log, and later gating's Plan panel) is an entry here plus a screen module;
// nothing in shell.js changes. Each entry is { id, label, route, mount(host, ctx) } and mount returns
// { unmount() }. `ctx` carries { client, onGateRefused }: a screen that gets a gate refusal from any admin
// call (see isGateRefusal in gate.js) calls onGateRefused() instead of showing it as an error, and the console
// runs the access check again.
import { el } from '../core/dom.js';

function mountOverviewPanel(host) {
  host.replaceChildren(
    el('h1', { text: 'Admin console', attrs: { tabindex: '-1', 'data-heading': 'true' } }),
    el('p', {
      text: 'You are signed in and verified. Organisations, members and the audit log are added here as they are built.',
    }),
  );
  return { unmount() {} };
}

export const PANELS = Object.freeze([
  Object.freeze({
    id: 'overview',
    label: 'Overview',
    route: 'overview',
    mount: mountOverviewPanel,
  }),
]);
