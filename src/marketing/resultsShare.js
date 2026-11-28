// The "Share" control on the public Results page. A button opens a native <dialog> with the results story card drawn as
// a preview and a "Share picture" button. Same pipeline as the Seduh ID person card (profileShare.js): the picture is
// drawn when the dialog opens, never on the share tap, so the tap still counts as the gesture for navigator.share;
// where the browser cannot share a file it is saved instead. Drawn by core/resultsStoryCard.js; nothing leaves the device.
import { el } from '../core/dom.js';
import { drawResultsStoryCard, paperStoryTheme } from '../core/resultsStoryCard.js';
import { renderStoryCard, shareStoryCard } from '../core/storyCard.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import {
  RESULTS_ADDRESS,
  canMakeResultsCard,
  resultsStoryFilename,
  resultsStorySpec,
} from './resultsStory.js';

const FAILED = 'Could not make the picture. Please try again.';

let dialogCount = 0;

/**
 * @param {object} event  a published payload (else this returns null: no card, no control)
 * @param {{ formatLabel: Function, formatDate: Function, render?: Function, share?: Function }} options
 * @returns {HTMLElement|null}
 */
export function buildResultsShareControl(event, options) {
  if (!canMakeResultsCard(event)) return null;
  const { formatLabel, formatDate, render = renderStoryCard, share = shareStoryCard } = options;
  const eventName = event.eventName;
  const titleId = `results-share-title-${(dialogCount += 1)}`;

  const openButton = el('button', {
    className: 'action action-outline',
    text: 'Share',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
  });
  openButton.append(el('span', { className: 'sr-only', text: ` the result of ${eventName}` }));
  const status = el('p', {
    className: 'results-share-note',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const previewSlot = el('div', { className: 'results-share-slot' });
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
  const dialog = el(
    'dialog',
    { className: 'results-share-dialog', attrs: { 'aria-labelledby': titleId } },
    [
      el('h2', { id: titleId, className: 'results-share-title', text: 'Share to story' }),
      previewSlot,
      el('p', {
        className: 'results-share-how',
        text: 'On a phone this opens the share sheet: pick Instagram, then Story. On a computer it saves the picture.',
      }),
      status,
      el('div', { className: 'results-share-actions' }, [shareButton, closeButton]),
    ],
  );

  let blob = null;
  let failed = false;
  let seq = 0;
  let preview = null;
  let previewUrl = null;
  const clearPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview?.remove();
    preview = null;
  };

  async function draw() {
    const mine = ++seq;
    failed = false;
    shareButton.textContent = 'Share picture';
    shareButton.disabled = true;
    status.textContent = 'Making the picture…';
    try {
      if (!blob) {
        const spec = resultsStorySpec(event, { formatLabel, formatDate });
        // Paper tokens from the page root: the card is the light look whatever surface the page is in.
        const theme = paperStoryTheme(document.documentElement);
        blob = await raceTimeout(
          render(spec, { theme, draw: drawResultsStoryCard }),
          DEFAULT_LOAD_TIMEOUT_MS,
        );
      }
      if (mine !== seq) return;
      clearPreview();
      previewUrl = URL.createObjectURL(blob);
      preview = el('img', {
        className: 'results-share-preview',
        attrs: {
          src: previewUrl,
          alt: `Preview of the story card for ${eventName}`,
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

  let sharing = false;
  shareButton.addEventListener('click', async () => {
    if (failed) {
      // The button is disabled while it draws again; put keyboard focus back on it afterwards.
      await draw();
      shareButton.focus();
      return;
    }
    if (!blob || sharing) return;
    sharing = true;
    shareButton.setAttribute('aria-busy', 'true');
    try {
      const result = await share(blob, {
        filename: resultsStoryFilename(event),
        title: eventName,
        text: `${eventName}: results on Seduh Score. ${RESULTS_ADDRESS}`,
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
  dialog.addEventListener('close', () => {
    seq += 1;
    clearPreview();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      e.clientX >= box.left &&
      e.clientX <= box.right &&
      e.clientY >= box.top &&
      e.clientY <= box.bottom;
    if (!inside) close();
  });

  const wrapper = el('div', { className: 'results-share' }, [openButton]);
  openButton.addEventListener('click', () => {
    if (!dialog.isConnected) wrapper.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    draw();
  });
  return wrapper;
}
