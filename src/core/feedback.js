// The feedback ladder's three scripted rungs (Petrol Kaizen P4; the inline line is core/dom.js's setFeedback, the
// markup is src/ui/tokens/feedback.css and the rules are DESIGN.md "Feedback ladder"). Format-agnostic: a format
// passes words, a trigger and an `isTest` flag, never a format name.
//
//   toast(message)             routine success only, about 3 s, a polite live region. NEVER an error: a toast is
//                              gone before it is read, so a failure stays on the screen as an inline line.
//   confirmInPlace(trigger, …) a panel beside the button for an action that can be undone or done again. Resolves
//                              true or false. Focus goes to Cancel, Escape closes it, and the trigger carries
//                              aria-expanded / aria-controls while it is open (and neither after).
//   confirmDialog(…)           the native <dialog>, ONLY for a permanent delete. Resolves true or false. Focus starts
//                              on Cancel; Escape cancels.
//
// Both confirms say what will happen and how to undo it (or that it cannot be undone), and show the violet
// "Test event" strip when `isTest` is true, so a rehearsal never looks like the real event.
import { el } from './dom.js';

const TOAST_MS = 3000;
let counter = 0;
const nextId = (prefix) => `${prefix}-${++counter}`;

function actionButton(label, variant, role) {
  return el('button', {
    className: `fb-btn${variant ? ` fb-btn--${variant}` : ''}`,
    text: label,
    attrs: { type: 'button', 'data-feedback-action': role },
  });
}

function testStrip() {
  return el('p', { className: 'feedback-test', text: 'Test event' });
}

// ---- toast ----

let region = null;
let settling = false; // a region made under 50 ms ago: its first messages are added after it is in the page

function toastRegion() {
  if (region?.isConnected) return region;
  // The region exists before its first message, so a screen reader announces the text put into it.
  region = el('div', {
    className: 'toast-region',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' },
  });
  document.body.appendChild(region);
  settling = true;
  setTimeout(() => {
    settling = false;
  }, 50);
  return region;
}

export function toast(message, { duration = TOAST_MS } = {}) {
  const node = el('div', { className: 'toast', text: message });
  const host = toastRegion();
  const delayed = settling;
  // A live region that is inserted with its text already in it is often not announced: when this call made the
  // region, the message goes in a moment later.
  // Every message in that window waits the same time, so they keep their order.
  if (!delayed) host.appendChild(node);
  const addTimer = delayed ? setTimeout(() => host.appendChild(node), 50) : null;
  const timer = setTimeout(() => node.remove(), duration);
  return () => {
    clearTimeout(addTimer);
    clearTimeout(timer);
    node.remove();
  };
}

// ---- confirm in place ----

let closeOpenPanel = null;
let openTrigger = null;

// `trigger` is the button that was pressed (falls back to the focused element). The panel is inserted after
// `anchor` (default: the trigger's parent) so it sits beside the button, not in a corner of the page.
// Pressing the same trigger again closes the panel (a toggle), the way a disclosure button behaves.
export function confirmInPlace(
  trigger,
  {
    title,
    body = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'warning',
    isTest = false,
    anchor = null,
  } = {},
) {
  const from =
    trigger ?? (document.activeElement !== document.body ? document.activeElement : null);
  if (closeOpenPanel) {
    const same = openTrigger === from && from !== null;
    closeOpenPanel(false);
    if (same) return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const id = nextId('confirm-panel');
    const titleId = `${id}-title`;
    const cancel = actionButton(cancelLabel, '', 'cancel');
    const accept = actionButton(confirmLabel, tone === 'danger' ? 'danger' : 'primary', 'confirm');
    const panel = el(
      'div',
      {
        className: 'confirm-panel',
        id,
        attrs: { role: 'group', 'aria-labelledby': titleId, 'data-tone': tone },
      },
      [
        ...(isTest ? [testStrip()] : []),
        el('p', { className: 'feedback-title', id: titleId, text: title }),
        ...(body ? [el('p', { className: 'feedback-body', id: `${id}-body`, text: body })] : []),
        el('div', { className: 'fb-actions' }, [cancel, accept]),
      ],
    );
    const host = anchor ?? from?.parentElement ?? document.body;
    if (host === document.body) host.appendChild(panel);
    else host.insertAdjacentElement('afterend', panel);
    if (from) {
      from.setAttribute('aria-expanded', 'true');
      from.setAttribute('aria-controls', id);
    }

    let settled = false;
    const watcher = new MutationObserver(() => {
      if (!panel.isConnected) finish(false, false);
    });
    function onKey(event) {
      if (event.key !== 'Escape') return;
      // A screen that re-rendered under the panel took it with it: there is nothing left to close.
      finish(false, panel.isConnected);
    }
    function finish(answer, restoreFocus = true) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      watcher.disconnect();
      if (closeOpenPanel === finish) {
        closeOpenPanel = null;
        openTrigger = null;
      }
      panel.remove();
      if (from) {
        from.removeAttribute('aria-expanded');
        from.removeAttribute('aria-controls');
        if (restoreFocus && from.isConnected) from.focus();
      }
      resolve(answer);
    }
    closeOpenPanel = finish;
    for (const button of [cancel, accept]) {
      button.setAttribute('aria-describedby', body ? `${titleId} ${id}-body` : titleId);
    }
    openTrigger = from;
    document.addEventListener('keydown', onKey, true);
    // A screen that re-renders under the panel (a toast timer, a refresh) takes the panel with it: settle the
    // question as "no" instead of leaving the caller waiting and the trigger reading aria-expanded="true".
    watcher.observe(document.body, { childList: true, subtree: true });
    cancel.addEventListener('click', () => finish(false));
    accept.addEventListener('click', () => finish(true));
    cancel.focus();
  });
}

// ---- dialog ----

// Permanent deletes only. The native <dialog> gives the focus trap, the inert page behind it and Escape; where
// showModal is missing (an old engine, jsdom) the dialog is opened as a plain `open` box and still works.
export function confirmDialog({
  title,
  body = '',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isTest = false,
} = {}) {
  return new Promise((resolve) => {
    const id = nextId('dialog');
    const returnTo = document.activeElement;
    const cancel = actionButton(cancelLabel, '', 'cancel');
    const accept = actionButton(confirmLabel, 'danger', 'confirm');
    const dialog = el(
      'dialog',
      {
        className: 'dialog',
        id,
        attrs: {
          'aria-labelledby': `${id}-title`,
          ...(body ? { 'aria-describedby': `${id}-body` } : {}),
        },
      },
      [
        ...(isTest ? [testStrip()] : []),
        el('h2', { className: 'feedback-title', id: `${id}-title`, text: title }),
        ...(body ? [el('p', { className: 'feedback-body', id: `${id}-body`, text: body })] : []),
        el('div', { className: 'fb-actions' }, [cancel, accept]),
      ],
    );
    let answer = false;
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.remove();
      if (returnTo?.isConnected && typeof returnTo.focus === 'function') returnTo.focus();
      resolve(answer);
    }
    for (const button of [cancel, accept]) {
      button.setAttribute('aria-describedby', body ? `${id}-title ${id}-body` : `${id}-title`);
    }
    cancel.addEventListener('click', finish);
    accept.addEventListener('click', () => {
      answer = true;
      finish();
    });
    // Escape: the browser fires `cancel` and closes the dialog.
    dialog.addEventListener('cancel', () => {
      answer = false;
    });
    dialog.addEventListener('close', finish);
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    cancel.focus();
  });
}

// ---- empty ----

export const EMPTY_KINDS = ['first-use', 'done', 'no-results'];

// `.empty` with a kind: first-use says what to do, done says nothing needs doing, no-results says what was looked for.
// `title` and `action` are optional; `text` is the sentence. Returns the node, not attached.
export function emptyState({ kind, text, title = null, action = null, tag = 'div' } = {}) {
  if (!EMPTY_KINDS.includes(kind)) throw new Error(`emptyState: unknown kind "${kind}"`);
  return el(tag, { className: 'empty', attrs: { 'data-kind': kind } }, [
    ...(title ? [el('p', { className: 'empty-title', text: title })] : []),
    el('p', { className: 'empty-text', text }),
    ...(action ? [action] : []),
  ]);
}
