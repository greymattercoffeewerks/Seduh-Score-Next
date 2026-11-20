// The "Public results" card on Throwdown's results screen (organiser console, never printed). Publishes (and updates, and
// unpublishes) the event's results to the public archive through core/publicResults.js, as Cup Taster's report does.
//
// What an organiser should know, and the card says: publishing puts the podium (or the full standings) on the public
// results page, and is what lets Seduh ID learn the competitors' names. It does NOT create anyone's Seduh ID on the
// spot: the owner reviews a queue first (CONVENTIONS.md, "Seduh ID feed"). A test event is never published; the card
// says so instead of offering a button the database would refuse.
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import {
  findPublishedResultForEvent,
  publishEventResults,
  unpublishEventResults,
} from '../../core/publicResults.js';
import { loadThrowdown } from './data.js';
import {
  buildThrowdownPayload,
  publishBlocker,
  describePublishError,
  BLOCKER_WORDS,
  DEFAULT_PUBLISH_SCOPE,
  PUBLISH_SCOPE_NOTICE,
} from './resultsPublishing.js';

const LEVEL_WORDS = { podium: 'the podium only', full: 'the full standings' };

// event: the events row (id, org_id, is_test); bracket: what the screen already shows, used for the not-ready words.
export function buildPublishCard({ event, bracket, client = getSupabase(), signal }) {
  const card = el('section', {
    className: 'card td-card td-no-print td-publish',
    attrs: { 'aria-labelledby': 'td-publish-h' },
  });
  const heading = el('h2', { id: 'td-publish-h', text: 'Public results' });
  // Appended once and never rebuilt, so a live region is not swapped out in the same tick as its new text.
  const feedback = el('div', {
    className: 'screen-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  const body = el('div', {});
  card.append(heading, body, feedback);

  // A test event is never published (D9): say so and offer nothing.
  if (event.is_test) {
    body.append(
      el('p', {
        className: 'td-note',
        text: 'This is a test event, so its results cannot be published. Test events are never added to the public archive.',
      }),
    );
    return { card, ready: Promise.resolve() };
  }

  let published = null; // null while checking, then true | false
  let publishedScope = null;
  let scope = DEFAULT_PUBLISH_SCOPE;
  let busy = null; // null | 'publishing' | 'unpublishing'
  let pendingFocus = null; // the control to refocus once a busy render is over (a disabled button cannot hold focus)
  let checkFailed = false;

  function setFeedback(message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
    if (tone === 'error') {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  function button(text, onClick, { primary = false, key = null } = {}) {
    const b = el('button', {
      className: `btn ${primary ? 'btn-primary' : 'btn-outline'} tap-target`,
      text,
      attrs: { type: 'button' },
    });
    if (key) b.dataset.focusKey = key;
    b.disabled = busy != null;
    b.addEventListener('click', onClick);
    return b;
  }

  function scopeChoice() {
    const notice = el('p', {
      className: 'td-note',
      id: 'td-publish-notice',
      text: PUBLISH_SCOPE_NOTICE[scope],
    });
    const option = (value, label, hint) => {
      const input = el('input', {
        attrs: {
          type: 'radio',
          name: 'td-publish-scope',
          value,
          id: `td-publish-scope-${value}`,
          'aria-describedby': `td-publish-scope-${value}-hint`,
        },
      });
      input.checked = scope === value;
      input.disabled = busy != null;
      input.addEventListener('change', () => {
        scope = value;
        notice.textContent = PUBLISH_SCOPE_NOTICE[scope];
      });
      return el('div', { className: 'td-publish-option' }, [
        input,
        el('div', {}, [
          el('label', { text: label, attrs: { for: input.id } }),
          el('span', { className: 'td-note', id: `td-publish-scope-${value}-hint`, text: hint }),
        ]),
      ]);
    };
    return el(
      'fieldset',
      { className: 'td-publish-scope', attrs: { 'aria-describedby': 'td-publish-notice' } },
      [
        el('legend', { text: 'What to publish' }),
        option('full', 'Full standings', 'Everyone’s place and the round they reached.'),
        option('podium', 'Podium only', 'The champion, the runner-up and 3rd place.'),
        notice,
      ],
    );
  }

  function render() {
    // Focus follows the control that was pressed (it is rebuilt), found by its stable key.
    const focusKey = busy
      ? null
      : (pendingFocus ?? document.activeElement?.dataset?.focusKey ?? null);
    if (!busy) pendingFocus = null;
    const blocker = publishBlocker(bracket);
    const parts = [];
    if (published == null && !checkFailed) {
      parts.push(el('p', { className: 'td-note', text: 'Checking whether this is published…' }));
    } else if (checkFailed) {
      // Publishing is not offered until the state is known: a blind publish could widen or replace what is public.
      parts.push(
        el('p', {
          className: 'td-note',
          text: 'Could not check whether these results are already published. Check your connection and try again.',
        }),
        button(
          'Check again',
          () => {
            pendingFocus = 'recheck';
            check();
          },
          { key: 'recheck' },
        ),
      );
    } else if (blocker && !published) {
      parts.push(el('p', { className: 'td-note', text: BLOCKER_WORDS[blocker] }));
      const b = button('Publish results', () => {});
      b.disabled = true;
      parts.push(b);
    } else if (published) {
      parts.push(
        el('p', {
          text: `These results are published to the public archive (${LEVEL_WORDS[publishedScope] ?? 'the podium'}).`,
        }),
        scopeChoice(),
        el('div', { className: 'td-publish-actions' }, [
          button(busy === 'unpublishing' ? 'Unpublishing…' : 'Unpublish', handleUnpublish, {
            key: 'unpublish',
          }),
          button(busy === 'publishing' ? 'Updating…' : 'Update published results', handlePublish, {
            primary: true,
            key: 'publish',
          }),
        ]),
      );
    } else {
      parts.push(
        el('p', { className: 'td-note', text: 'Not published to the public archive yet.' }),
        scopeChoice(),
        button(busy === 'publishing' ? 'Publishing…' : 'Publish results', handlePublish, {
          primary: true,
          key: 'publish',
        }),
      );
    }
    parts.push(
      el('p', {
        className: 'td-note',
        text:
          'Phone numbers and emails are never published. Publishing also lets Seduh ID learn the competitors’ names: ' +
          'nobody’s Seduh ID is created until the platform owner has reviewed it.',
      }),
    );
    body.replaceChildren(...parts);
    if (focusKey) body.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  async function handlePublish() {
    if (busy) return;
    const chosenScope = scope;
    pendingFocus = 'publish';
    busy = 'publishing';
    render();
    try {
      // Read the event again at the moment of publishing, so a correction made since this page opened is what goes out
      // (this screen's own copy may be old).
      const fresh = await loadThrowdown(event.id, client);
      if (signal?.aborted) return;
      const blocker = publishBlocker(fresh.bracket);
      bracket = fresh.bracket;
      if (blocker) {
        setFeedback(BLOCKER_WORDS[blocker], 'error');
      } else {
        const payload = buildThrowdownPayload({
          event,
          bracket: fresh.bracket,
          entries: fresh.entries,
          scope: chosenScope,
        });
        await publishEventResults(event.org_id, event.id, payload, client);
        if (signal?.aborted) return;
        const was = published;
        published = true;
        publishedScope = chosenScope;
        setFeedback(
          was
            ? `Updated the published results. They now show ${LEVEL_WORDS[chosenScope]}.`
            : `Published to the public results archive. It shows ${LEVEL_WORDS[chosenScope]}.`,
          'success',
        );
      }
    } catch (err) {
      if (signal?.aborted) return;
      setFeedback(describePublishError(err), 'error');
    }
    busy = null;
    render();
  }

  async function handleUnpublish() {
    if (busy) return;
    pendingFocus = 'publish';
    busy = 'unpublishing';
    render();
    try {
      await unpublishEventResults(event.org_id, event.id, client);
      if (signal?.aborted) return;
      published = false;
      publishedScope = null;
      scope = DEFAULT_PUBLISH_SCOPE;
      setFeedback('Removed from the public results archive.', 'success');
    } catch (err) {
      if (signal?.aborted) return;
      setFeedback(describePublishError(err), 'error');
    }
    busy = null;
    render();
  }

  function check() {
    checkFailed = false;
    published = null;
    render();
    return raceTimeout(findPublishedResultForEvent(event.id, client), DEFAULT_LOAD_TIMEOUT_MS)
      .then((existing) => {
        if (signal?.aborted) return;
        published = Boolean(existing);
        if (existing) {
          publishedScope = Array.isArray(existing.payload?.standings) ? 'full' : 'podium';
          scope = publishedScope;
        }
      })
      .catch(() => {
        if (signal?.aborted) return;
        checkFailed = true;
      })
      .then(() => {
        if (!signal?.aborted) render();
      });
  }

  return { card, ready: check() };
}
