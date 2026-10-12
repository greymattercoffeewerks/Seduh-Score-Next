// "Share with your audience" (T-TEN.D4): the links an organiser hands to the people watching, for ONE
// organisation, with a QR code on the phone view so an audience can join by pointing a camera at the screen.
// Format-agnostic: the caller (main.js, which knows the route pattern) builds the three URLs; this only
// shows them.
//
// The three links are slug-qualified (#/live/<organiser-slug>/projector ...), so they name the organiser and
// work for any organisation. Nobody needs to sign in to open them. The QR is library-generated SVG made from
// the URL alone (never from anything a person typed into the page), and it is hidden from assistive technology:
// the link it encodes is shown beside it as selectable text with its own Copy and Open buttons, so nothing is
// only reachable by scanning.
import { el } from './dom.js';

const SURFACES = [
  {
    key: 'phone',
    label: 'Phone view',
    hint: 'For the audience’s phones: scan the code or send the link.',
    qr: true,
  },
  {
    key: 'projector',
    label: 'Projector view',
    hint: 'For a screen or projector facing the room.',
    qr: false,
  },
  {
    key: 'splash',
    label: 'Splash screen',
    hint: 'A welcome screen for before the event starts.',
    qr: false,
  },
];

// The QR library is only needed here, and only once the card is on screen: loaded on demand so it is not
// part of every page load. A failure to load it leaves the link, which is the real thing, on screen.
async function loadQrFactory() {
  const module = await import('qrcode-generator');
  return module.default;
}

// Renders the code for `url` as an SVG string, or null when it cannot be made (the library missing or the
// text too long for any code size).
function qrSvg(qrcode, url) {
  try {
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    return code.createSvgTag(4);
  } catch {
    return null;
  }
}

/**
 * @param {{ phone: string, projector: string, splash: string }} urls absolute links, by surface
 * @param {{ orgName?: string|null, loadQr?: () => Promise<Function>, copy?: (text: string) => Promise<void> }} [options]
 *   `loadQr` and `copy` are injectable (a test need not load the library or touch the clipboard).
 */
export function buildAudienceLinksCard(
  urls,
  { orgName = null, loadQr = loadQrFactory, copy } = {},
) {
  const writeToClipboard =
    copy ??
    ((text) =>
      navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error('no clipboard')));

  // One polite status line for the whole card, kept in place (a live region that is replaced is not reliably
  // announced): "Phone view link copied." or the reason it was not.
  const status = el('p', {
    className: 'audience-links-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  let statusTimer = null;
  function say(message) {
    clearTimeout(statusTimer);
    status.textContent = message;
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, 6000);
  }

  const rows = SURFACES.map((surface) => {
    const url = urls[surface.key];
    const labelId = `audience-links-${surface.key}`;
    const qrHost = surface.qr
      ? el('div', { className: 'audience-links-qr', attrs: { 'aria-hidden': 'true' } })
      : null;

    const copyButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Copy link',
      attrs: { type: 'button', 'aria-describedby': labelId },
    });
    copyButton.addEventListener('click', async () => {
      try {
        await writeToClipboard(url);
        say(`${surface.label} link copied.`);
      } catch {
        say('Could not copy the link. Select it and copy it by hand.');
      }
    });
    const openLink = el('a', {
      className: 'btn btn-outline tap-target',
      text: 'Open',
      attrs: {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-describedby': labelId,
      },
    });
    // The new-tab warning a screen reader would not otherwise get (the same words the nav links carry).
    openLink.appendChild(el('span', { className: 'sr-only', text: ' (opens in a new tab)' }));

    return el(
      'li',
      { className: 'audience-links-item' },
      [
        el('div', { className: 'audience-links-text' }, [
          el('h3', { id: labelId, className: 'audience-links-label', text: surface.label }),
          el('p', { className: 'audience-links-hint', text: surface.hint }),
          el('code', { className: 'audience-links-url', text: url }),
          el('div', { className: 'audience-links-actions' }, [copyButton, openLink]),
        ]),
        qrHost,
      ].filter(Boolean),
    );
  });

  // Fill the QR once the library has arrived. The card is complete without it.
  const qrHost = rows.map((row) => row.querySelector('.audience-links-qr')).find(Boolean);
  const qrUrl = urls[SURFACES.find((surface) => surface.qr).key];
  loadQr()
    .then((qrcode) => {
      const svg = qrSvg(qrcode, qrUrl);
      // Library-generated SVG made from the link (see the file comment), the one deliberate innerHTML use
      // here, as in the Guess the Bean screens.
      if (svg) qrHost.innerHTML = svg;
      else qrHost.hidden = true;
    })
    .catch(() => {
      qrHost.hidden = true;
    });

  return el('div', { className: 'card audience-links-card' }, [
    el('h2', { id: 'audience-links-heading', text: 'Share with your audience' }),
    el('p', {
      className: 'audience-links-intro',
      text: `${orgName ? `These open ${orgName}’s displays. ` : ''}Anyone with a link can watch; nobody needs to sign in.`,
    }),
    el(
      'ul',
      {
        className: 'audience-links-list',
        attrs: { role: 'list', 'aria-labelledby': 'audience-links-heading' },
      },
      rows,
    ),
    status,
  ]);
}
