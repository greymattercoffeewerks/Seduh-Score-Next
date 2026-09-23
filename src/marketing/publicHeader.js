// Shared public-site header for standalone marketing surfaces. It intentionally
// stays independent of the landing screen so Tour and Community can share the
// same familiar sticky navigation without importing a whole page.
import { brandMark, el, svgEl } from '../core/dom.js';

function menuIcon(close = false) {
  const lines = close
    ? [
        { x1: '1', y1: '1', x2: '15', y2: '15' },
        { x1: '15', y1: '1', x2: '1', y2: '15' },
      ]
    : [
        { x1: '0', y1: '1', x2: '18', y2: '1' },
        { x1: '0', y1: '6', x2: '18', y2: '6' },
        { x1: '0', y1: '11', x2: '18', y2: '11' },
      ];
  const icon = svgEl('svg', {
    class: `public-header-toggle-icon${close ? ' public-header-toggle-icon-close' : ''}`,
    viewBox: close ? '0 0 16 16' : '0 0 18 12',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'aria-hidden': 'true',
  });
  lines.forEach((line) => icon.append(svgEl('line', line)));
  return icon;
}

function navLink(text, href, active = false) {
  return el('a', {
    className: `public-header-link${active ? ' public-header-link-active' : ''}`,
    text,
    attrs: active ? { href, 'aria-current': 'page' } : { href },
  });
}

export function buildPublicHeader({ active }) {
  const mark = brandMark();
  mark.classList.add('public-header-brand-mark');
  mark.setAttribute('aria-hidden', 'true');

  const links = [
    navLink('Formats', '/tour/', active === 'tour'),
    navLink('Pricing', '/#pricing'),
    navLink('Community Tools', '/community/', active === 'community'),
    navLink('Org login', '/#'),
  ];
  const mobileLinks = links.map((link) => link.cloneNode(true));
  const panelId = `public-header-menu-${active}`;
  const panel = el('div', { className: 'public-header-mobile-panel', id: panelId }, [
    el('div', { className: 'public-header-mobile-links' }, [
      ...mobileLinks,
      el('a', {
        className: 'public-header-action cut-sm',
        text: 'Start free',
        attrs: { href: '/#' },
      }),
    ]),
  ]);
  const toggle = el(
    'button',
    {
      className: 'public-header-toggle',
      attrs: {
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': panelId,
        'aria-label': 'Menu',
      },
    },
    [menuIcon(), menuIcon(true)],
  );

  function closeMenu() {
    panel.classList.remove('public-header-mobile-panel-open');
    toggle.classList.remove('public-header-toggle-open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('public-header-mobile-panel-open');
    toggle.classList.toggle('public-header-toggle-open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      toggle.focus();
    }
  });
  panel.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  return el('header', { className: 'public-header' }, [
    el('div', { className: 'public-header-bar' }, [
      el(
        'a',
        {
          className: 'public-header-brand',
          attrs: { href: '/', 'aria-label': 'Seduh Score home' },
        },
        [mark, el('span', { text: 'Seduh Score' })],
      ),
      el('span', { className: 'public-header-live' }, [
        el('span', { className: 'public-header-live-dot', attrs: { 'aria-hidden': 'true' } }),
        document.createTextNode('Live — Cup Taster'),
      ]),
      el('span', { className: 'public-header-secondary', text: 'No install · no wifi dependency' }),
      el('div', { className: 'public-header-desktop' }, [
        el('div', { className: 'public-header-links' }, links),
        el('a', {
          className: 'public-header-action cut-sm',
          text: 'Start free',
          attrs: { href: '/#' },
        }),
      ]),
      toggle,
    ]),
    panel,
  ]);
}
