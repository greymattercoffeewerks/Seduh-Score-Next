// "This event's Per-event plan has ended" (G-B5): put in the outlet INSTEAD of an event's screen when the database
// says the event is locked. The database already closes the workspace (a locked event reads as empty and refuses
// writes), so this screen only explains it, rather than showing screens that would come up empty. Format-agnostic,
// like noOrgScreen.js. Styled by eventWindowScreen.css (loaded globally by app/index.html).
import { el } from './dom.js';
import { WINDOW_LOCKED_HEADING, windowLockedText } from './eventWindow.js';

export function mountEventWindowLockedScreen(outlet, { state, contactHref = '/contact/' } = {}) {
  outlet.innerHTML = '';
  const container = el('section', { className: 'screen-container' });
  // tabindex -1 so the heading can take focus: the router only does that itself when nothing has focus.
  container.appendChild(el('h1', { text: WINDOW_LOCKED_HEADING, attrs: { tabindex: '-1' } }));
  container.appendChild(
    el('p', { className: 'event-window-message', text: windowLockedText(state) }),
  );
  container.appendChild(
    el('p', {
      className: 'event-window-message',
      text: 'To open it again, ask Grey Matter Coffee Werks to extend the plan.',
    }),
  );
  container.appendChild(
    el('a', {
      className: 'btn btn-primary tap-target',
      text: 'Contact us',
      attrs: { href: contactHref },
    }),
  );
  container.appendChild(
    el('a', {
      className: 'btn btn-outline tap-target',
      text: 'Back to events',
      attrs: { href: '#/events' },
    }),
  );
  outlet.appendChild(container);
  return { unmount() {} };
}
