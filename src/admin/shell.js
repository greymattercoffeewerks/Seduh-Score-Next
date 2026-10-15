// The console frame once the gate says `ready`: header (who, "Verified (AAL2)", Sign out, Sign out
// everywhere), navigation drawn from the panel registry, and the host the current panel mounts into. Panel
// routes live in the URL hash (`#/overview`), one panel at a time.
import { el, brandLockup, setBusyDisabled } from '../core/dom.js';
import { setFeedback, SIGN_OUT_FAILED } from './screenParts.js';

export function routeOf(hash, panels) {
  const wanted = String(hash ?? '').replace(/^#\/?/, '');
  return panels.find((panel) => panel.route === wanted) ?? panels[0];
}

export function mountShell(root, { panels, email, ctx, onSignOut, onSignOutEverywhere }) {
  const feedback = el('div', {
    className: 'screen-feedback adm-header-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  const nav = el('nav', { className: 'adm-nav', attrs: { 'aria-label': 'Admin console' } });
  const host = el('main', { className: 'adm-main', attrs: { id: 'admin-main', tabindex: '-1' } });

  function signOutButton(label, handler) {
    const button = el('button', {
      className: 'btn btn-outline tap-target',
      text: label,
      attrs: { type: 'button' },
    });
    let busy = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusyDisabled(button, true);
      setFeedback(feedback, '');
      const result = await handler();
      // A successful sign-out replaces this whole console; only a failure comes back here.
      if (!result?.ok) {
        busy = false;
        setBusyDisabled(button, false);
        setFeedback(feedback, SIGN_OUT_FAILED, 'error');
      }
    });
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

  root.append(header, feedback, nav, host);

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
