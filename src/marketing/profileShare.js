// The "Share" control on a Seduh ID person page (T-ID2.C3). A button opens a native <dialog> with the card drawn as a
// preview, two styles ("Whole record", "Latest result") and a "Share picture" button. Drawing happens when the dialog opens
// or the style changes, never on the share tap, so the tap still counts as the user's gesture for navigator.share (which
// browsers refuse after a long wait). Where the browser cannot share a file the picture is saved instead.
// The card is drawn by core/storyCard.js, which this only feeds; no second implementation.
import { el } from '../core/dom.js';
import { renderStoryCard, shareStoryCard, storyThemeFrom } from '../core/storyCard.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { availableStyles, cardPhotoUrl, personStorySpec, personUrl } from './profileStory.js';

const FAILED = 'Could not make the picture. Please try again.';

/**
 * @param {object} profile  a normalised profile with a public name (else this returns null: no card, no control)
 * @param {{ supabaseUrl?: string, render?: Function, share?: Function }} options  `render` and `share` are for tests
 * @returns {HTMLElement|null}
 */
export function buildShareControl(profile, options = {}) {
  const { render = renderStoryCard, share = shareStoryCard } = options;
  const styles = availableStyles(profile); // empty without a public name
  if (styles.length === 0) return null;
  const name = profile.identity.displayName;
  const photoUrl = cardPhotoUrl(profile, options.supabaseUrl ?? import.meta.env?.VITE_SUPABASE_URL);

  const openButton = el('button', {
    className: 'action action-primary',
    text: 'Share',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
  });
  const status = el('p', {
    className: 'profile-share-note',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  // The preview is built on the first successful draw, so the page holds no picture element until a card exists.
  let preview = null;
  const previewSlot = el('div', { className: 'profile-share-slot' });
  const shareButton = el('button', {
    className: 'action action-primary',
    text: 'Share picture',
    attrs: { type: 'button', disabled: '' },
  });
  const closeButton = el('button', {
    className: 'action action-outline',
    text: 'Close',
    attrs: { type: 'button' },
  });
  const titleId = 'profile-share-title';
  const tabs = styles.map((s) =>
    el('button', {
      className: 'profile-share-style',
      text: s.label,
      attrs: { type: 'button', 'aria-pressed': String(s.key === 'record'), 'data-style': s.key },
    }),
  );
  const dialog = el(
    'dialog',
    { className: 'profile-share-dialog', attrs: { 'aria-labelledby': titleId } },
    [
      el('h2', { id: titleId, className: 'profile-section-title', text: 'Share to story' }),
      styles.length > 1
        ? el(
            'div',
            {
              className: 'profile-share-styles',
              attrs: { role: 'group', 'aria-label': 'Card style' },
            },
            tabs,
          )
        : null,
      previewSlot,
      el('p', {
        className: 'profile-share-how',
        text: 'On a phone this opens the share sheet: pick Instagram, then Story. On a computer it saves the picture.',
      }),
      status,
      el('div', { className: 'profile-share-actions' }, [shareButton, closeButton]),
    ].filter(Boolean),
  );

  const blobs = new Map(); // style key -> PNG blob, so switching back is instant and a share tap never waits
  let current = 'record';
  let failed = false; // after a failed draw the main button says Try again and draws again
  let seq = 0; // the newest draw wins; a slower, older one is dropped
  let previewUrl = null;

  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview?.remove();
    preview = null;
  };

  async function draw(key) {
    current = key;
    const mine = ++seq;
    for (const b of tabs) b.setAttribute('aria-pressed', String(b.dataset.style === key));
    failed = false;
    shareButton.textContent = 'Share picture';
    shareButton.disabled = true;
    status.textContent = 'Making the picture…';
    try {
      if (!blobs.has(key)) {
        const theme = storyThemeFrom(openButton.closest('[data-surface]') ?? document.body);
        // A stalled photo or font fetch must not leave the dialog waiting for ever.
        const blob = await raceTimeout(
          render(personStorySpec(profile, key), {
            theme,
            photoUrl,
            qrUrl: personUrl(profile.handle),
          }),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
        blobs.set(key, blob);
      }
      if (mine !== seq) return;
      clearPreview();
      previewUrl = URL.createObjectURL(blobs.get(key));
      preview = el('img', {
        className: 'profile-share-preview',
        attrs: {
          src: previewUrl,
          alt: `Preview of the story card for ${name}`,
          width: '270',
          height: '480',
        },
      });
      previewSlot.append(preview);
      shareButton.disabled = false;
      status.textContent = '';
    } catch {
      if (mine !== seq) return;
      clearPreview();
      failed = true;
      status.textContent = FAILED;
      shareButton.textContent = 'Try again';
      shareButton.disabled = false;
    }
  }

  for (const b of tabs) b.addEventListener('click', () => draw(b.dataset.style));

  let sharing = false;
  shareButton.addEventListener('click', async () => {
    if (failed) return draw(current);
    const blob = blobs.get(current);
    if (!blob || sharing) return;
    sharing = true;
    shareButton.setAttribute('aria-busy', 'true');
    try {
      const result = await share(blob, {
        filename: `seduh-id-${profile.handle}-story.png`,
        title: `${name} on Seduh ID`,
        text: personUrl(profile.handle),
      });
      status.textContent =
        result === 'saved'
          ? 'Picture saved. Add it to your story from your photos.'
          : result === 'shared'
            ? 'Shared.'
            : '';
    } catch {
      status.textContent = FAILED;
    } finally {
      sharing = false;
      shareButton.removeAttribute('aria-busy');
    }
  });

  const close = () => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    seq += 1;
    clearPreview();
    openButton.focus();
  };
  closeButton.addEventListener('click', close);
  // Escape goes through the native event; the preview address is let go either way.
  dialog.addEventListener('close', () => {
    seq += 1;
    clearPreview();
  });
  dialog.addEventListener('click', (event) => {
    // Only a tap on the backdrop closes it; a tap on the dialog's own padding (same target) lands inside its box.
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) close();
  });

  const wrapper = el('div', { className: 'profile-share' }, [openButton]);
  openButton.addEventListener('click', () => {
    if (!dialog.isConnected) wrapper.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    draw(current);
  });

  // The dialog joins the page only on the first tap, so the page itself carries just the button.
  return wrapper;
}
