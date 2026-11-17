// The in-page way around one event: a breadcrumb trail ("Events / <event name> / <this screen>") with real
// links, and the event's sibling sections as links, the current one marked aria-current. Format-agnostic by
// construction: it is handed plain data (names, hrefs, the section list) and knows no format, no route and no
// screen. Which sections an event has is the composition root's call (src/eventSections.js), never decided here.
//
// Pure DOM, no I/O: appShell.js mounts it between the header and the screen, so every event-keyed screen gets it
// without each one building its own (they used to have nothing, and moving between two work screens took two
// Back presses).
import { el } from './dom.js';

/**
 * @param {object} spec
 * @param {string} spec.eventsHref        where "Events" goes
 * @param {string} spec.eventName
 * @param {string} spec.eventHref         the event's own home
 * @param {string|null} [spec.currentLabel]  the screen being shown, when it is not the event home itself (a leaf
 *                                         with no link, e.g. "Timing"); null/'' when the event home is current
 * @param {{key: string, label: string, href: string}[]} [spec.sections]  the event's sibling sections
 * @param {string|null} [spec.currentKey] which section is current (aria-current="page"); null for a screen that
 *                                         is not one of the sections
 * @returns {HTMLElement}
 */
export function renderEventBar({
  eventsHref,
  eventName,
  eventHref,
  currentLabel = null,
  sections = [],
  currentKey = null,
}) {
  const atHome = !currentLabel;
  const crumbs = [
    el('li', { className: 'event-bar-crumb' }, [
      el('a', { className: 'event-bar-link', text: 'Events', attrs: { href: eventsHref } }),
    ]),
    el('li', { className: 'event-bar-crumb' }, [
      atHome
        ? el('span', {
            className: 'event-bar-here',
            text: eventName,
            attrs: { 'aria-current': 'page' },
          })
        : el('a', { className: 'event-bar-link', text: eventName, attrs: { href: eventHref } }),
    ]),
  ];
  if (!atHome) {
    crumbs.push(
      el('li', { className: 'event-bar-crumb' }, [
        el('span', {
          className: 'event-bar-here',
          text: currentLabel,
          attrs: { 'aria-current': 'page' },
        }),
      ]),
    );
  }

  const parts = [
    el('nav', { className: 'event-bar-trail', attrs: { 'aria-label': 'Breadcrumb' } }, [
      el('ol', { className: 'event-bar-list' }, crumbs),
    ]),
  ];
  if (sections.length > 0) {
    parts.push(
      el('nav', { className: 'event-bar-sections', attrs: { 'aria-label': 'Event sections' } }, [
        el(
          'ul',
          { className: 'event-bar-list' },
          sections.map((section) =>
            el('li', {}, [
              el('a', {
                className: 'event-bar-section',
                text: section.label,
                attrs: {
                  href: section.href,
                  ...(section.key === currentKey ? { 'aria-current': 'page' } : {}),
                },
              }),
            ]),
          ),
        ),
      ]),
    );
  }
  return el('div', { className: 'event-bar' }, parts);
}
