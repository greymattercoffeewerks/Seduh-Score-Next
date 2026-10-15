// The console frame once the gate says `ready`: header (who, "Verified (AAL2)", Sign out, Sign out
// everywhere), navigation drawn from the panel registry, and the host the current panel mounts into. Panel
// routes live in the URL hash (`#/overview`), one panel at a time.
import { el, brandLockup, setBusyDisabled } from '../core/dom.js';
import { setFeedback, SIGN_OUT_FAILED } from './screenParts.js';

// The panel a hash names: by its FIRST segment, so `#/orgs/<id>` is still the `orgs` panel (which then reads the
// rest itself). Anything that names no panel is the first one.
export function routeOf(hash, panels) {
  const wanted = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')[0];
  return panels.find((panel) => panel.route === wanted) ?? panels[0];
}

export function mountShell(root, { panels, email, ctx, onSignOut, onSignOutEverywhere }) {
  const feedback = el('div', {
    className: 'screen-feedback adm-header-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  const nav = el('nav', { className: 'adm-nav', attrs: { 'aria-label': 'Admin console' } });
  const host = el('main', { className: 'adm-main', attrs: { id: 'admin-main', tabindex: '-1' } });

  // One flag for the whole header: while either sign-out is in flight the other is out too (two overlapping
  // sign-outs could each report on a feedback region the first one's success has already removed).
  const signOutButtons = [];
  let busy = false;
  function signOutButton(label, handler) {
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: label,
      attrs: { type: 'button' },
    });
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      for (const other of signOutButtons) setBusyDisabled(other, true);
      setFeedback(feedback, '');
      const result = await handler();
      // A successful sign-out replaces this whole console; only a failure comes back here.
      if (!result?.ok) {
        busy = false;
        for (const other of signOutButtons) setBusyDisabled(other, false);
        setFeedback(feedback, SIGN_OUT_FAILED, 'error');
      }
    });
    signOutButtons.push(button);
    return button;
  }

  const header = el('header', { className: 'adm-header' }, [
    el('div', { className: 'adm-brand' }, [
      brandLockup({ name: 'Seduh Score' }),
      el('span', { className: 'adm-brand-tag', text: 'Admin' }),
    ]),
    el('div', { className: 'adm-who' }, [
      el('span', { className: 'adm-who-email', text: email }),
      el('span', { className: 'adm-badge', text: 'Verified (AAL2)' }),
    ]),
    el('div', { className: 'adm-actions' }, [
      signOutButton('Sign out', () => onSignOut()),
      signOutButton('Sign out everywhere', () => onSignOutEverywhere()),
    ]),
  ]);

  // A keyboard user reaches the page's content without tabbing through the header and the navigation each time. A
  // button, not a link to #admin-main: this page routes by the URL hash, and a link to another hash would navigate.
  const skip = el('button', {
    className: 'adm-skip',
    text: 'Skip to content',
    attrs: { type: 'button' },
  });
  skip.addEventListener('click', () => host.focus());

  root.append(skip, header, feedback, nav, host);

  let mounted = null;
  let mountedPanel = null;

  function showPanel() {
    const panel = routeOf(window.location.hash, panels);
    if (panel === mountedPanel) return;
    mounted?.unmount?.();
    mountedPanel = panel;
    host.replaceChildren();
    mounted = panel.mount(host, ctx);
    for (const link of nav.querySelectorAll('a')) {
      if (link.dataset.route === panel.route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    host.querySelector('[data-heading]')?.focus();
  }

  for (const panel of panels) {
    nav.appendChild(
      el('a', {
        className: 'adm-nav-link tap-target',
        text: panel.label,
        attrs: { href: `#/${panel.route}`, 'data-route': panel.route },
      }),
    );
  }

  window.addEventListener('hashchange', showPanel);
  showPanel();

  return {
    unmount() {
      window.removeEventListener('hashchange', showPanel);
      mounted?.unmount?.();
    },
  };
}
