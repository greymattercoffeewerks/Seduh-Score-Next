// "Live now": whether this event is on the audience displays, the links to those displays (copy, a QR code on the
// phone one) and a "Show this event" control that puts it there. Format-agnostic: the caller supplies the
// event's live state, the three links and a `takeOver()` callback (the format's own publish), and this never
// publishes, reads a session or names a format.
//
// States (`isLive`): true is "Live now on Projector / Phone" (the surfaces the caller names), false is "Not
// showing", null is "could not check" and claims nothing either way. "Show this event" is offered only when
// the event is not already live and a `takeOver` exists.
//
// `takeOver()` may resolve `{ ok: false, message }` (a refusal the format words) or throw; both are shown, in
// words, and the button comes back for a retry. On success the card moves to the live state by itself
// (`setLive(true)` is also exposed for a caller that learns it another way).
//
// Styled in components.css (`.ok-live*`).
import { el, setBusyDisabled } from './dom.js';
import { kitId, safeHref } from './kitLink.js';
import { copyText } from './clipboard.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { loadQrFactory, qrSvg } from './audienceLinksCard.js';

const LINKS = [
  { key: 'phone', label: 'Phone', qr: true },
  { key: 'projector', label: 'Projector', qr: false },
  { key: 'splash', label: 'Splash', qr: false },
];

// Pure. What the card's headline says for a live state: { state, headline }. `surfaces` are the names to list
// when live (default Projector and Phone).
export function describeLive(isLive, surfaces = ['Projector', 'Phone']) {
  if (isLive === true) {
    const names = (surfaces ?? []).filter((name) => typeof name === 'string' && name.trim() !== '');
    return {
      state: 'live',
      headline: names.length ? `Live now on ${names.join(' / ')}` : 'Live now',
    };
  }
  if (isLive === false) return { state: 'not_showing', headline: 'Not showing' };
  return { state: 'unknown', headline: 'Live status unavailable' };
}

// Pure. The links to draw, in a fixed order: [{ key, label, url, qr }], leaving out any the caller did not
// supply (or supplied as anything but a non-empty string).
export function liveLinks(urls) {
  return LINKS.filter((link) => safeHref(urls?.[link.key]) !== null).map((link) => ({
    ...link,
    url: safeHref(urls[link.key]),
  }));
}

/**
 * @param {{
 *   isLive: boolean|null, surfaces?: string[],
 *   urls?: { phone?: string, projector?: string, splash?: string },
 *   takeOver?: (() => Promise<{ ok?: boolean, message?: string }|void>)|null
 * }} input
 * @param {{ heading?: string, loadQr?: () => Promise<Function>, copy?: (text: string) => Promise<void> }} [options]
 * @returns {{ element: HTMLElement, setLive: (isLive: boolean|null) => void }}
 */
export function buildLiveCard(
  { isLive, surfaces, urls, takeOver = null },
  { heading = 'Live now', loadQr = loadQrFactory, copy } = {},
) {
  const writeToClipboard =
    copy ??
    (async (text) => {
      if (!(await copyText(text))) throw new Error('no clipboard');
    });

  let current = isLive;
  const headline = el('p', { className: 'ok-live-headline', attrs: { tabindex: '-1' } });
  const marker = el('span', { className: 'ok-live-marker', attrs: { 'aria-hidden': 'true' } });
  // One polite status line for copies and take-over results, kept in place.
  const status = el('p', {
    className: 'ok-live-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const setStatus = (message, tone) => {
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const showButton = el('button', {
    className: 'btn btn-outline tap-target ok-live-show',
    text: 'Show this event',
    attrs: { type: 'button' },
  });
  let taking = false;
  showButton.addEventListener('click', async () => {
    if (taking || typeof takeOver !== 'function') return;
    taking = true;
    setBusyDisabled(showButton, true);
    setStatus('Putting this event on the displays…');
    try {
      const result = await raceTimeout(Promise.resolve().then(takeOver), DEFAULT_LOAD_TIMEOUT_MS);
      if (result && result.ok === false) {
        setStatus(result.message || 'Could not show this event. Try again.', 'error');
      } else {
        setLive(true);
        // The button hides itself on success while it holds focus: keep the keyboard user's place.
        // (Only when focus is still there or has been lost: never pull it from somewhere the user moved to.)
        if (document.activeElement === showButton || document.activeElement === document.body) {
          headline.focus();
        }
        setStatus(result?.message || 'This event is now on the displays.', 'success');
      }
    } catch {
      setStatus('Could not show this event. Check the connection and try again.', 'error');
    } finally {
      taking = false;
      setBusyDisabled(showButton, false);
    }
  });

  function setLive(next) {
    current = next;
    const { state, headline: words } = describeLive(next, surfaces);
    headline.textContent = words;
    wrapper.dataset.state = state;
    // The take-over control only exists for an event that is not already on the displays.
    showButton.hidden = !(typeof takeOver === 'function' && state !== 'live');
  }

  let copyTimer = null;
  const headingId = kitId('ok-live-heading');
  const links = liveLinks(urls);
  let qrHost = null;
  const rows = links.map((link) => {
    const labelId = kitId(`ok-live-link-${link.key}`);
    const copyButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Copy',
      attrs: { type: 'button', 'aria-describedby': labelId },
    });
    copyButton.addEventListener('click', async () => {
      clearTimeout(copyTimer);
      try {
        await writeToClipboard(link.url);
        setStatus(`${link.label} link copied.`, 'success');
      } catch {
        setStatus('Could not copy the link. Select it and copy it by hand.', 'error');
      }
      const said = status.textContent;
      copyTimer = setTimeout(() => {
        if (status.textContent === said) setStatus('');
      }, 6000);
    });
    const open = el('a', {
      className: 'btn btn-outline tap-target',
      text: 'Open',
      attrs: {
        href: link.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-describedby': labelId,
      },
    });
    open.appendChild(el('span', { className: 'sr-only', text: ' (opens in a new tab)' }));
    if (link.qr) {
      qrHost = el('div', { className: 'ok-live-qr', attrs: { 'aria-hidden': 'true' } });
    }
    return el('li', { className: 'ok-live-link' }, [
      el('span', { className: 'ok-live-link-label', id: labelId, text: link.label }),
      el('code', { className: 'ok-live-url', text: link.url }),
      el('span', { className: 'ok-live-link-actions' }, [copyButton, open]),
    ]);
  });

  // The QR is made from the phone link alone (never from typed text), loaded on demand; the link above it is
  // the real thing, so a failure only hides the picture.
  const phone = links.find((link) => link.qr);
  if (phone && qrHost) {
    Promise.resolve()
      .then(loadQr)
      .then((qrcode) => {
        const svg = qrSvg(qrcode, phone.url);
        // Library-generated SVG made from the link, the one deliberate innerHTML use (as in
        // audienceLinksCard.js).
        if (svg) qrHost.innerHTML = svg;
        else qrHost.hidden = true;
      })
      .catch(() => {
        qrHost.hidden = true;
      });
  }

  const wrapper = el(
    'section',
    { className: 'ok-card ok-live', attrs: { 'aria-labelledby': headingId } },
    [
      el('h2', { className: 'ok-card-heading', id: headingId, text: heading }),
      el('div', { className: 'ok-live-state' }, [marker, headline]),
      showButton,
      ...(rows.length
        ? [el('ul', { className: 'ok-live-links', attrs: { role: 'list' } }, rows)]
        : []),
      ...(qrHost ? [qrHost] : []),
      status,
    ],
  );
  setLive(current);

  return { element: wrapper, setLive };
}
